import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ConnectionPool } from "mssql";
import sql from "mssql";
import { assertValidSessionLabel } from "./pricing.js";
import { CourseFlowError } from "./courseFlow.js";

const SOURCE = "software-working-v1";

type MasterItem = {
  title: string;
  publisher: string | null;
  quantity: number;
  sort: number;
  sharedStationery?: boolean;
};

type MasterClass = { grade: string; items: MasterItem[] };
type MasterRegion = { name: string; classes: MasterClass[] };
type MasterFile = { source: string; regions: MasterRegion[] };

function loadSeed(): MasterFile {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "courseMasterSeed.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as MasterFile;
}

export function canonicalCourseGrade(className: string): string | null {
  const s = className.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\bpre\b/.test(s) && s.includes("nursery")) return "Pre-Nursery";
  if (s === "nursery" || s.startsWith("nursery ")) return "Nursery";
  if (s === "kg" || s.startsWith("kg ") || s.includes("kindergarten")) return "KG";
  const labeled = s.match(/\b(?:class|grade|std|standard)\s*(\d{1,2})\b/);
  if (labeled) {
    const n = Number(labeled[1]);
    if (n >= 1 && n <= 12) return `Class ${n}`;
  }
  return null;
}

/** classId|bookId → Excel course-list position, so PO, dispatch, voucher, and reports share one title order. */
export async function loadCourseTitleOrder(pool: ConnectionPool, classIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(classIds.map(String).filter(Boolean))];
  const map = new Map<string, number>();
  if (unique.length === 0) return map;
  const classReq = pool.request();
  unique.forEach((id, i) => classReq.input(`c${i}`, id));
  const classes = await classReq.query(`
    SELECT cl.id, cl.class_name AS className, cp.region
    FROM Classes cl
    JOIN Campuses cp ON cp.id = cl.campus_id
    WHERE cl.id IN (${unique.map((_, i) => `@c${i}`).join(", ")})
  `);
  const lines = await pool.request().query(`
    SELECT region_name AS regionName, class_name AS className, title, sort_order AS sortOrder
    FROM CourseMasterLines
  `);
  const books = await pool.request().query(`SELECT id, title FROM BookCatalog`);
  const byTitle = new Map<string, string>();
  for (const book of books.recordset) {
    byTitle.set(String(book.title || "").trim().toUpperCase(), String(book.id));
  }
  for (const cls of classes.recordset) {
    const grade = canonicalCourseGrade(String(cls.className || ""));
    const region = courseRegionForCampus(cls.region);
    if (!grade) continue;
    for (const line of lines.recordset) {
      if (String(line.className) !== grade) continue;
      if (region && String(line.regionName) !== region) continue;
      const bookId = byTitle.get(String(line.title || "").trim().toUpperCase());
      if (!bookId) continue;
      const key = `${cls.id}|${bookId}`;
      const sort = Number(line.sortOrder);
      const prev = map.get(key);
      if (prev == null || sort < prev) map.set(key, sort);
    }
  }
  return map;
}

export function courseRegionForCampus(region?: string | null): string | null {
  const r = String(region || "").toLowerCase();
  if (!r) return null;
  if (r.includes("karachi") || r.includes("sindh")) return "Karachi, Interior Sindh";
  if (
    r.includes("punjab")
    || r.includes("kpk")
    || r.includes("khyber")
    || r.includes("ajk")
    || r.includes("kashmir")
    || r.includes("blc")
    || r.includes("baloch")
  ) {
    return "BLC, Punjab, KPK & AJK";
  }
  return null;
}

/** Put every Excel title into BookCatalog so the Titles screen shows the working file, not only class sets. */
async function syncCourseTitlesIntoCatalog(
  pool: ConnectionPool,
  lines: Array<{ title: string; publisher: string | null }>
) {
  const existing = await pool.request().query(`
    SELECT UPPER(LTRIM(RTRIM(title))) AS title FROM BookCatalog
  `);
  const have = new Set(existing.recordset.map((row) => String(row.title || "")));
  const pending = new Map<string, { title: string; publisher: string | null }>();
  for (const line of lines) {
    const title = String(line.title || "").trim();
    const key = title.toUpperCase();
    if (!key || have.has(key) || pending.has(key)) continue;
    pending.set(key, { title, publisher: line.publisher ? String(line.publisher) : null });
  }
  if (pending.size === 0) return;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const item of pending.values()) {
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("title", item.title)
        .input("publisher", item.publisher)
        .query(`
          INSERT INTO BookCatalog (id, title, publisher, is_active)
          VALUES (@id, @title, @publisher, 1)
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function seedCourseMaster(pool: ConnectionPool): Promise<void> {
  const existing = await pool.request().input("source", SOURCE).query(`
    SELECT line_count AS lineCount FROM CourseMasterMeta WHERE source_name = @source
  `);
  const seed = loadSeed();
  const lines = seed.regions.flatMap((region) =>
    region.classes.flatMap((cls) => cls.items.map((item) => ({ region: region.name, grade: cls.grade, ...item })))
  );
  if (Number(existing.recordset[0]?.lineCount) !== lines.length) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request().query(`DELETE FROM CourseMasterLines`);
      for (const line of lines) {
        await tx.request()
          .input("id", crypto.randomUUID())
          .input("region", line.region)
          .input("className", line.grade)
          .input("title", line.title)
          .input("publisher", line.publisher)
          .input("qty", line.quantity)
          .input("sort", line.sort)
          .input("shared", line.sharedStationery ? 1 : 0)
          .query(`
            INSERT INTO CourseMasterLines (id, region_name, class_name, title, publisher, quantity, sort_order, shared_stationery)
            VALUES (@id, @region, @className, @title, @publisher, @qty, @sort, @shared)
          `);
      }
      await tx.request().input("source", SOURCE).input("count", lines.length).query(`
        DELETE FROM CourseMasterMeta;
        INSERT INTO CourseMasterMeta (source_name, line_count) VALUES (@source, @count);
      `);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }
  await syncCourseTitlesIntoCatalog(pool, lines);
}

export async function listCourseMaster(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT region_name AS regionName, class_name AS className, title, publisher,
           quantity, sort_order AS sortOrder, shared_stationery AS sharedStationery
    FROM CourseMasterLines
    ORDER BY region_name, class_name, sort_order
  `);
  const regions = new Map<string, Map<string, Array<Record<string, unknown>>>>();
  for (const row of rows.recordset) {
    const region = String(row.regionName);
    const grade = String(row.className);
    if (!regions.has(region)) regions.set(region, new Map());
    const classes = regions.get(region)!;
    if (!classes.has(grade)) classes.set(grade, []);
    classes.get(grade)!.push(row);
  }
  const gradeOrder = ['Pre-Nursery', 'Nursery', 'KG', ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];
  const regionOrder = ['Karachi, Interior Sindh', 'BLC, Punjab, KPK & AJK'];
  return [...regions.entries()]
    .sort((a, b) => regionOrder.indexOf(a[0]) - regionOrder.indexOf(b[0]))
    .map(([name, classes]) => ({
      name,
      classes: [...classes.entries()]
        .sort((a, b) => gradeOrder.indexOf(a[0]) - gradeOrder.indexOf(b[0]))
        .map(([grade, items]) => ({ grade, items })),
    }));
}

async function ensureBook(tx: sql.Transaction, title: string, publisher: string | null, cache: Map<string, string>) {
  const key = title.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const found = await tx.request().input("title", title).query(`
    SELECT TOP 1 id FROM BookCatalog WHERE UPPER(LTRIM(RTRIM(title))) = UPPER(LTRIM(RTRIM(@title)))
  `);
  if (found.recordset[0]) {
    const id = String(found.recordset[0].id);
    cache.set(key, id);
    return id;
  }
  const id = crypto.randomUUID();
  await tx.request()
    .input("id", id)
    .input("title", title)
    .input("publisher", publisher)
    .query(`
      INSERT INTO BookCatalog (id, title, publisher, is_active)
      VALUES (@id, @title, @publisher, 1)
    `);
  cache.set(key, id);
  return id;
}

export async function applyCourseMasterToCampus(
  pool: ConnectionPool,
  input: { campusId: string; academicSession: string; regionName?: string }
) {
  const session = assertValidSessionLabel(input.academicSession);
  const campus = await pool.request().input("id", input.campusId).query(`
    SELECT id, campus_name AS campusName, region FROM Campuses WHERE id = @id
  `);
  const campusRow = campus.recordset[0];
  if (!campusRow) throw new CourseFlowError(404, "NO_CAMPUS", "Campus not found");
  const regionName = input.regionName || courseRegionForCampus(campusRow.region);
  if (!regionName) {
    throw new CourseFlowError(400, "NO_REGION", "Choose Karachi & Interior Sindh, or BLC, Punjab, KPK & AJK");
  }
  const master = await pool.request().input("region", regionName).query(`
    SELECT class_name AS className, title, publisher, quantity, sort_order AS sortOrder
    FROM CourseMasterLines
    WHERE region_name = @region
    ORDER BY class_name, sort_order
  `);
  if (master.recordset.length === 0) {
    throw new CourseFlowError(404, "NO_MASTER", "Course list for this region is not loaded");
  }
  const classes = await pool.request().input("campusId", input.campusId).query(`
    SELECT id, class_name AS className, section_name AS sectionName
    FROM Classes WHERE campus_id = @campusId
  `);
  const byGrade = new Map<string, Array<{ id: string; className: string; sectionName: string | null }>>();
  const unmatched: string[] = [];
  for (const row of classes.recordset) {
    const grade = canonicalCourseGrade(String(row.className || ""));
    const label = `${row.className}${row.sectionName ? ` ${row.sectionName}` : ""}`;
    if (!grade) {
      unmatched.push(label);
      continue;
    }
    if (!byGrade.has(grade)) byGrade.set(grade, []);
    byGrade.get(grade)!.push({
      id: String(row.id),
      className: String(row.className),
      sectionName: row.sectionName ? String(row.sectionName) : null,
    });
  }

  const linesByGrade = new Map<string, Array<{ title: string; publisher: string | null; quantity: number }>>();
  for (const row of master.recordset) {
    const grade = String(row.className);
    if (!linesByGrade.has(grade)) linesByGrade.set(grade, []);
    linesByGrade.get(grade)!.push({
      title: String(row.title),
      publisher: row.publisher ? String(row.publisher) : null,
      quantity: Number(row.quantity) || 1,
    });
  }

  const bookCache = new Map<string, string>();
  let packs = 0;
  const missingGrades: string[] = [];
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const [grade, lines] of linesByGrade) {
      const targets = byGrade.get(grade) || [];
      if (targets.length === 0) {
        missingGrades.push(grade);
        continue;
      }
      const bookIds: Array<{ bookId: string; quantity: number; sort: number }> = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const bookId = await ensureBook(tx, line.title, line.publisher, bookCache);
        bookIds.push({ bookId, quantity: line.quantity, sort: i });
      }
      for (const target of targets) {
        const packName = `Full course · ${grade}`;
        const existing = await tx.request()
          .input("campusId", input.campusId)
          .input("classId", target.id)
          .input("session", session)
          .input("name", packName)
          .query(`
            SELECT id FROM BookPacks
            WHERE campus_id = @campusId AND class_id = @classId AND academic_session = @session AND name = @name
          `);
        let packId = existing.recordset[0] ? String(existing.recordset[0].id) : "";
        if (!packId) {
          packId = crypto.randomUUID();
          await tx.request()
            .input("id", packId)
            .input("campusId", input.campusId)
            .input("classId", target.id)
            .input("session", session)
            .input("name", packName)
            .input("description", `Client course list · ${regionName}`)
            .query(`
              INSERT INTO BookPacks (id, campus_id, class_id, academic_session, name, description, pack_discount, is_active)
              VALUES (@id, @campusId, @classId, @session, @name, @description, 0, 1)
            `);
        } else {
          await tx.request().input("packId", packId).query(`DELETE FROM BookPackItems WHERE pack_id = @packId`);
        }
        for (const item of bookIds) {
          await tx.request()
            .input("id", crypto.randomUUID())
            .input("packId", packId)
            .input("bookId", item.bookId)
            .input("qty", item.quantity)
            .input("sort", item.sort)
            .query(`
              INSERT INTO BookPackItems (id, pack_id, book_id, quantity, sort_order)
              VALUES (@id, @packId, @bookId, @qty, @sort)
            `);
        }
        packs += 1;
      }
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return {
    regionName,
    campusName: String(campusRow.campusName),
    packs,
    titles: bookCache.size,
    missingGrades,
    unmatchedClasses: unmatched,
  };
}
