import type { Express, Request, Response, NextFunction } from "express";
import type { ConnectionPool } from "mssql";
import crypto from "crypto";
import sql from "mssql";
import { availableStock, postInventoryMovement } from "./ledger.js";
import { BookPricingError, assertValidSessionLabel, resolveBookPricesForSession } from "./pricing.js";
import {
  computeEnrollmentDemand,
  createStockReservation,
  executeBookSale,
  quotePackForStore,
  releaseStockReservation,
  resolveStudentForSale,
} from "./salesLogic.js";

type PermissionAction = "view" | "create" | "update" | "delete";

type AuthUserRow = {
  id: string;
  username: string;
  role: string;
  campusId: string | null;
  campusIds: string[];
};

export type BookstoreRouteDeps = {
  getPool: () => ConnectionPool | null;
  connectToDb: () => Promise<void>;
  loadAuthUser: (req: Request) => Promise<AuthUserRow | null>;
  requireBookstore: (action: PermissionAction) => (req: Request, res: Response, next: NextFunction) => void;
  sendServerError: (res: Response, err: unknown, message: string) => void;
  isSuperAdminRole: (role: string | null | undefined) => boolean;
  canApplyBookstoreDiscount: (req: Request) => Promise<boolean>;
};

function pricingErrorResponse(res: Response, err: unknown) {
  if (err instanceof BookPricingError) {
    return res.status(err.code === "MISSING_PRICE" ? 422 : 400).json({ message: err.message, code: err.code, details: err.details });
  }
  return null;
}

function parsePage(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

function mapBook(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    isbn: row.isbn,
    barcode: row.barcode,
    publisher: row.publisher,
    edition: row.edition,
    subject: row.subject,
    description: row.description,
    unitOfMeasure: row.unit_of_measure,
    imageUrl: row.image_url,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertStoreCampusAccess(
  authUser: AuthUserRow,
  storeId: string,
  pool: ConnectionPool,
  isSuperAdminRole: BookstoreRouteDeps["isSuperAdminRole"]
): Promise<{ ok: boolean; campusId: string | null }> {
  const r = await pool.request().input("id", storeId).query(`
    SELECT store_type, campus_id FROM BookstoreStores WHERE id = @id AND is_active = 1
  `);
  const row = r.recordset[0];
  if (!row) return { ok: false, campusId: null };
  if (row.store_type === "central") {
    return { ok: isSuperAdminRole(authUser.role) || authUser.role === "Admin", campusId: null };
  }
  const campusId = row.campus_id ? String(row.campus_id) : null;
  if (isSuperAdminRole(authUser.role) || authUser.role === "Admin") return { ok: true, campusId };
  if (campusId && authUser.campusIds.includes(campusId)) return { ok: true, campusId };
  return { ok: false, campusId };
}

export function registerBookstoreRoutes(app: Express, deps: BookstoreRouteDeps): void {
  const { getPool, connectToDb, loadAuthUser, requireBookstore, sendServerError, isSuperAdminRole, canApplyBookstoreDiscount } = deps;
  const v = requireBookstore("view");
  const c = requireBookstore("create");
  const u = requireBookstore("update");

  app.get("/api/bookstore/dashboard", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });

      const campusId = req.query.campusId ? String(req.query.campusId) : null;
      let storeFilter = "";
      const request = pool.request();
      if (campusId && campusId !== "all") {
        request.input("campusId", campusId);
        storeFilter = `AND s.campus_id = @campusId`;
      } else if (!isSuperAdminRole(authUser.role) && authUser.role !== "Admin" && authUser.campusIds.length) {
        authUser.campusIds.forEach((id, i) => request.input(`c${i}`, id));
        storeFilter = `AND s.campus_id IN (${authUser.campusIds.map((_, i) => `@c${i}`).join(",")})`;
      }

      const sales = await request.query(`
        SELECT
          COUNT(*) AS saleCount,
          COALESCE(SUM(total), 0) AS grossSales,
          COALESCE(SUM(paid_amount), 0) AS collected,
          COALESCE(SUM(total - paid_amount), 0) AS outstanding
        FROM BookSales bs
        JOIN BookstoreStores s ON s.id = bs.store_id
        WHERE bs.status = 'posted' ${storeFilter.replace(/s\./g, "s.")}
      `);

      const inv = await pool.request().query(`
        SELECT
          COALESCE(SUM(b.on_hand), 0) AS onHand,
          COALESCE(SUM(b.in_transit), 0) AS inTransit,
          COALESCE(SUM(b.on_hand * b.avg_cost), 0) AS inventoryValue
        FROM BookInventoryBalances b
      `);

      const lowStock = await pool.request().query(`
        SELECT TOP 10 bc.title, b.on_hand AS onHand, s.name AS storeName
        FROM BookInventoryBalances b
        JOIN BookCatalog bc ON bc.id = b.book_id
        JOIN BookstoreStores s ON s.id = b.store_id
        WHERE b.on_hand > 0 AND b.on_hand <= 5 AND bc.is_active = 1
        ORDER BY b.on_hand ASC
      `);

      const pendingTransfers = await pool.request().query(`
        SELECT COUNT(*) AS cnt FROM BookStockTransfers
        WHERE status IN ('submitted', 'approved', 'dispatched')
      `);

      res.json({
        sales: sales.recordset[0],
        inventory: inv.recordset[0],
        lowStock: lowStock.recordset,
        pendingTransfers: pendingTransfers.recordset[0]?.cnt ?? 0,
      });
    } catch (err) {
      sendServerError(res, err, "Error loading bookstore dashboard");
    }
  });

  app.get("/api/bookstore/books", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const { page, limit, offset } = parsePage(req);
      const search = String(req.query.search || "").trim();
      const activeOnly = req.query.activeOnly !== "0";
      const request = pool.request();
      let where = "WHERE 1=1";
      if (activeOnly) where += " AND is_active = 1";
      if (search) {
        request.input("q", `%${search}%`);
        where += " AND (title LIKE @q OR isbn LIKE @q OR barcode LIKE @q OR publisher LIKE @q)";
      }
      const total = (await request.query(`SELECT COUNT(*) AS total FROM BookCatalog ${where}`)).recordset[0]?.total ?? 0;
      const rows = await request.query(`
        SELECT * FROM BookCatalog ${where}
        ORDER BY title ASC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);
      res.json({ data: rows.recordset.map(mapBook), page, limit, total });
    } catch (err) {
      sendServerError(res, err, "Error fetching books");
    }
  });

  app.post("/api/bookstore/books", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const body = req.body || {};
      const title = String(body.title || "").trim();
      if (!title) return res.status(400).json({ message: "Title is required" });
      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("title", title)
        .input("isbn", body.isbn || null)
        .input("barcode", body.barcode || null)
        .input("publisher", body.publisher || null)
        .input("edition", body.edition || null)
        .input("subject", body.subject || null)
        .input("description", body.description || null)
        .input("unitOfMeasure", body.unitOfMeasure || "Unit")
        .input("imageUrl", body.imageUrl || null)
        .input("isActive", body.isActive === false ? 0 : 1)
        .query(`
          INSERT INTO BookCatalog (
            id, title, isbn, barcode, publisher, edition, subject, description,
            unit_of_measure, image_url, is_active
          ) VALUES (
            @id, @title, @isbn, @barcode, @publisher, @edition, @subject, @description,
            @unitOfMeasure, @imageUrl, @isActive
          )
        `);
      res.status(201).json({ id, message: "Book created" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UX_BookCatalog/i.test(msg)) {
        return res.status(409).json({ message: "ISBN or barcode already exists" });
      }
      sendServerError(res, err, "Error creating book");
    }
  });

  app.put("/api/bookstore/books/:id", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const { id } = req.params;
      const body = req.body || {};
      await pool.request()
        .input("id", id)
        .input("title", String(body.title || "").trim())
        .input("isbn", body.isbn ?? null)
        .input("barcode", body.barcode ?? null)
        .input("publisher", body.publisher ?? null)
        .input("edition", body.edition ?? null)
        .input("subject", body.subject ?? null)
        .input("description", body.description ?? null)
        .input("unitOfMeasure", body.unitOfMeasure || "Unit")
        .input("imageUrl", body.imageUrl ?? null)
        .input("isActive", body.isActive === false ? 0 : 1)
        .query(`
          UPDATE BookCatalog SET
            title = @title, isbn = @isbn, barcode = @barcode, publisher = @publisher,
            edition = @edition, subject = @subject, description = @description,
            unit_of_measure = @unitOfMeasure, image_url = @imageUrl, is_active = @isActive,
            updated_at = SYSUTCDATETIME()
          WHERE id = @id
        `);
      res.json({ message: "Book updated" });
    } catch (err) {
      sendServerError(res, err, "Error updating book");
    }
  });

  app.post("/api/bookstore/book-prices", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      const { bookId, academicSession, purchaseCost, sellingPrice } = req.body || {};
      if (!bookId || !academicSession) {
        return res.status(400).json({ message: "bookId and academicSession are required" });
      }
      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("bookId", bookId)
        .input("session", String(academicSession))
        .input("purchaseCost", Number(purchaseCost) || 0)
        .input("sellingPrice", Number(sellingPrice) || 0)
        .input("createdBy", authUser?.id ?? null)
        .query(`
          MERGE BookPrices AS t
          USING (SELECT @bookId AS book_id, @session AS academic_session) AS s
          ON t.book_id = s.book_id AND t.academic_session = s.academic_session
          WHEN MATCHED THEN UPDATE SET
            purchase_cost = @purchaseCost, selling_price = @sellingPrice, effective_from = CAST(GETUTCDATE() AS DATE)
          WHEN NOT MATCHED THEN INSERT (id, book_id, academic_session, purchase_cost, selling_price, created_by)
            VALUES (@id, @bookId, @session, @purchaseCost, @sellingPrice, @createdBy);
        `);
      res.json({ message: "Price saved" });
    } catch (err) {
      sendServerError(res, err, "Error saving book price");
    }
  });

  app.get("/api/bookstore/stores", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const rows = await pool.request().query(`
        SELECT id, store_type AS storeType, campus_id AS campusId, name, is_active AS isActive
        FROM BookstoreStores WHERE is_active = 1 ORDER BY store_type, name
      `);
      let data: Array<{ storeType: string; campusId: string | null; id: string; name: string; isActive: boolean }> = [
        ...rows.recordset,
      ];
      if (!isSuperAdminRole(authUser.role) && authUser.role !== "Admin") {
        data = data.filter(
          (s: { storeType: string; campusId: string | null }) =>
            s.storeType === "central" ? false : s.campusId && authUser.campusIds.includes(String(s.campusId))
        );
      }
      res.json(data);
    } catch (err) {
      sendServerError(res, err, "Error fetching stores");
    }
  });

  app.get("/api/bookstore/inventory", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const storeId = req.query.storeId ? String(req.query.storeId) : null;
      if (!storeId) return res.status(400).json({ message: "storeId is required" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const access = await assertStoreCampusAccess(authUser, storeId, pool, isSuperAdminRole);
      if (!access.ok) return res.status(403).json({ message: "Forbidden for this store" });

      const rows = await pool.request().input("storeId", storeId).query(`
        SELECT b.book_id AS bookId, bc.title, b.on_hand AS onHand, b.reserved, b.in_transit AS inTransit,
               b.damaged, b.avg_cost AS avgCost
        FROM BookInventoryBalances b
        JOIN BookCatalog bc ON bc.id = b.book_id
        WHERE b.store_id = @storeId AND (b.on_hand <> 0 OR b.in_transit <> 0 OR b.reserved <> 0)
        ORDER BY bc.title
      `);
      res.json(
        rows.recordset.map((r: Record<string, unknown>) => ({
          ...r,
          available: availableStock(r as { onHand: number; reserved: number }),
        }))
      );
    } catch (err) {
      sendServerError(res, err, "Error fetching inventory");
    }
  });

  app.post("/api/bookstore/inventory/opening-stock", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { storeId, bookId, quantity, unitCost, reason } = req.body || {};
      const qty = Number(quantity);
      if (!storeId || !bookId || !(qty > 0)) {
        return res.status(400).json({ message: "storeId, bookId, and positive quantity required" });
      }
      const access = await assertStoreCampusAccess(authUser, storeId, pool, isSuperAdminRole);
      if (!access.ok) return res.status(403).json({ message: "Forbidden" });

      const docId = crypto.randomUUID();
      await postInventoryMovement(pool, {
        storeId,
        bookId,
        campusId: access.campusId,
        txnType: "opening_stock",
        qtyDelta: qty,
        unitCost: Number(unitCost) || 0,
        docType: "opening_stock",
        docId,
        reason: reason || "Opening stock",
        performedBy: authUser.id,
      });
      res.status(201).json({ message: "Opening stock posted", docId });
    } catch (err) {
      sendServerError(res, err, "Error posting opening stock");
    }
  });

  app.get("/api/bookstore/packs", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const campusId = req.query.campusId ? String(req.query.campusId) : null;
      const session = req.query.academicSession ? String(req.query.academicSession) : null;
      const request = pool.request();
      let where = "WHERE 1=1";
      if (campusId) {
        request.input("campusId", campusId);
        where += " AND p.campus_id = @campusId";
      }
      if (session) {
        request.input("session", session);
        where += " AND p.academic_session = @session";
      }
      const packs = await request.query(`
        SELECT p.*, c.class_name AS className, cp.campus_name AS campusName
        FROM BookPacks p
        LEFT JOIN Classes c ON c.id = p.class_id
        LEFT JOIN Campuses cp ON cp.id = p.campus_id
        ${where}
        ORDER BY p.academic_session DESC, p.name
      `);
      res.json(packs.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching packs");
    }
  });

  app.post("/api/bookstore/packs", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const body = req.body || {};
      const { campusId, classId, academicSession, name, description, packDiscount, items } = body;
      if (!campusId || !classId || !academicSession || !name) {
        return res.status(400).json({ message: "campusId, classId, academicSession, and name are required" });
      }
      const packId = crypto.randomUUID();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await tx.request()
          .input("id", packId)
          .input("campusId", campusId)
          .input("classId", classId)
          .input("session", String(academicSession))
          .input("name", String(name))
          .input("description", description || null)
          .input("discount", Number(packDiscount) || 0)
          .query(`
            INSERT INTO BookPacks (id, campus_id, class_id, academic_session, name, description, pack_discount)
            VALUES (@id, @campusId, @classId, @session, @name, @description, @discount)
          `);
        for (const it of Array.isArray(items) ? items : []) {
          await tx.request()
            .input("id", crypto.randomUUID())
            .input("packId", packId)
            .input("bookId", it.bookId)
            .input("qty", Math.max(1, Number(it.quantity) || 1))
            .query(`
              INSERT INTO BookPackItems (id, pack_id, book_id, quantity) VALUES (@id, @packId, @bookId, @qty)
            `);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
      res.status(201).json({ id: packId, message: "Pack created" });
    } catch (err) {
      sendServerError(res, err, "Error creating pack");
    }
  });

  app.post("/api/bookstore/packs/:id/copy", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const { id } = req.params;
      const newSession = String(req.body?.academicSession || "").trim();
      if (!newSession) return res.status(400).json({ message: "academicSession required" });
      const src = await pool.request().input("id", id).query(`SELECT * FROM BookPacks WHERE id = @id`);
      if (!src.recordset[0]) return res.status(404).json({ message: "Pack not found" });
      const s = src.recordset[0];
      const items = await pool.request().input("packId", id).query(`SELECT * FROM BookPackItems WHERE pack_id = @packId`);
      const newId = crypto.randomUUID();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await tx.request()
          .input("id", newId)
          .input("campusId", s.campus_id)
          .input("classId", s.class_id)
          .input("session", newSession)
          .input("name", `${s.name} (${newSession})`)
          .input("description", s.description)
          .input("discount", s.pack_discount)
          .input("copiedFrom", id)
          .query(`
            INSERT INTO BookPacks (id, campus_id, class_id, academic_session, name, description, pack_discount, copied_from_id)
            VALUES (@id, @campusId, @classId, @session, @name, @description, @discount, @copiedFrom)
          `);
        for (const it of items.recordset) {
          await tx.request()
            .input("id", crypto.randomUUID())
            .input("packId", newId)
            .input("bookId", it.book_id)
            .input("qty", it.quantity)
            .query(`INSERT INTO BookPackItems (id, pack_id, book_id, quantity) VALUES (@id, @packId, @bookId, @qty)`);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
      res.status(201).json({ id: newId, message: "Pack copied to new session" });
    } catch (err) {
      sendServerError(res, err, "Error copying pack");
    }
  });

  app.get("/api/bookstore/prices", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const session = String(req.query.academicSession || "");
      const rawIds = String(req.query.bookIds || "").split(",").map((s) => s.trim()).filter(Boolean);
      const map = await resolveBookPricesForSession(pool, session, rawIds);
      res.json([...map.values()]);
    } catch (err) {
      const pe = pricingErrorResponse(res, err);
      if (pe) return pe;
      sendServerError(res, err, "Error resolving prices");
    }
  });

  app.get("/api/bookstore/pos/student/:studentId", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const student = await resolveStudentForSale(pool, req.params.studentId);
      res.json(student);
    } catch (err) {
      sendServerError(res, err, "Error loading student POS context");
    }
  });

  app.get("/api/bookstore/packs/eligible", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const studentId = String(req.query.studentId || "");
      if (!studentId) return res.status(400).json({ message: "studentId required" });
      const student = await resolveStudentForSale(pool, studentId);
      const session = String(req.query.academicSession || student.academicSession);
      assertValidSessionLabel(session);
      const rows = await pool.request()
        .input("campusId", student.campusId)
        .input("classId", student.classId)
        .input("session", session)
        .query(`
          SELECT p.id, p.name, p.description, p.pack_discount AS packDiscount, p.academic_session AS academicSession
          FROM BookPacks p
          WHERE p.is_active = 1 AND p.campus_id = @campusId AND p.class_id = @classId AND p.academic_session = @session
          ORDER BY p.name
        `);
      res.json({ student, academicSession: session, packs: rows.recordset });
    } catch (err) {
      const pe = pricingErrorResponse(res, err);
      if (pe) return pe;
      sendServerError(res, err, "Error listing eligible packs");
    }
  });

  app.get("/api/bookstore/packs/:id/quote", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const studentId = String(req.query.studentId || "");
      const storeId = String(req.query.storeId || "");
      if (!studentId || !storeId) return res.status(400).json({ message: "studentId and storeId required" });
      const quote = await quotePackForStore(pool, {
        packId: req.params.id,
        studentId,
        storeId,
        academicSession: req.query.academicSession ? String(req.query.academicSession) : undefined,
      });
      res.json(quote);
    } catch (err) {
      const pe = pricingErrorResponse(res, err);
      if (pe) return pe;
      sendServerError(res, err, "Error quoting pack");
    }
  });

  app.get("/api/bookstore/demand", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const { campusId, classId, academicSession, packId } = req.query;
      if (!campusId || !classId || !academicSession || !packId) {
        return res.status(400).json({ message: "campusId, classId, academicSession, and packId required" });
      }
      const data = await computeEnrollmentDemand(pool, {
        campusId: String(campusId),
        classId: String(classId),
        academicSession: String(academicSession),
        packId: String(packId),
      });
      res.json(data);
    } catch (err) {
      sendServerError(res, err, "Error computing demand");
    }
  });

  app.get("/api/bookstore/packs/:id/items", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const session = String(req.query.academicSession || "");
      if (!session) return res.status(400).json({ message: "academicSession query parameter is required" });
      const items = await pool.request().input("packId", req.params.id).query(`
        SELECT i.id, i.book_id AS bookId, i.quantity, bc.title
        FROM BookPackItems i
        JOIN BookCatalog bc ON bc.id = i.book_id
        WHERE i.pack_id = @packId
      `);
      const bookIds = items.recordset.map((r: { bookId: string }) => String(r.bookId));
      const prices = await resolveBookPricesForSession(pool, session, bookIds);
      res.json(
        items.recordset.map((r: { bookId: string; quantity: number; title: string; id: string }) => ({
          ...r,
          sellingPrice: prices.get(String(r.bookId))?.sellingPrice ?? null,
          purchaseCost: prices.get(String(r.bookId))?.purchaseCost ?? null,
        }))
      );
    } catch (err) {
      const pe = pricingErrorResponse(res, err);
      if (pe) return pe;
      sendServerError(res, err, "Error fetching pack items");
    }
  });

  app.post("/api/bookstore/sales/reserve", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const body = req.body || {};
      const { storeId, studentId, packId, academicSession, reservationKey, ttlMinutes } = body;
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const access = await assertStoreCampusAccess(authUser, storeId, pool, isSuperAdminRole);
      if (!access.ok) return res.status(403).json({ message: "Forbidden for store" });

      let lines: Array<{ bookId: string; quantity: number }> = [];
      let session = academicSession ? String(academicSession) : null;
      if (packId && studentId) {
        const student = await resolveStudentForSale(pool, String(studentId));
        session = assertValidSessionLabel(session || student.academicSession);
        const quote = await quotePackForStore(pool, {
          packId: String(packId),
          studentId: String(studentId),
          storeId,
          academicSession: session,
        });
        lines = quote.items.map((l) => ({ bookId: l.bookId, quantity: l.quantity }));
        if (!quote.allInStock) {
          return res.status(409).json({ message: "Insufficient stock for one or more pack items", items: quote.items });
        }
      } else if (Array.isArray(body.lines)) {
        lines = body.lines.map((l: { bookId: string; quantity: number }) => ({
          bookId: String(l.bookId),
          quantity: Number(l.quantity),
        }));
      } else {
        return res.status(400).json({ message: "packId+studentId or lines required" });
      }

      const result = await createStockReservation(pool, {
        storeId,
        studentId: studentId ? String(studentId) : null,
        academicSession: session,
        packId: packId ? String(packId) : null,
        lines,
        reservationKey: reservationKey ? String(reservationKey) : null,
        performedBy: authUser.id,
        ttlMinutes,
      });
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      sendServerError(res, err, "Error creating reservation");
    }
  });

  app.post("/api/bookstore/sales/reserve/:id/release", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      await releaseStockReservation(pool, req.params.id);
      res.json({ message: "Reservation released" });
    } catch (err) {
      sendServerError(res, err, "Error releasing reservation");
    }
  });

  app.post("/api/bookstore/goods-receipts/:id/post", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const grnId = req.params.id;
      const idempotencyKey = String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim() || null;

      const grn = await pool.request().input("id", grnId).query(`SELECT * FROM BookGoodsReceipts WHERE id = @id`);
      const header = grn.recordset[0];
      if (!header) return res.status(404).json({ message: "GRN not found" });
      if (header.status === "posted") {
        return res.json({ message: "Already posted", id: grnId });
      }
      if (idempotencyKey && header.idempotency_key && header.idempotency_key !== idempotencyKey) {
        return res.status(409).json({ message: "Idempotency key mismatch" });
      }

      const items = await pool.request().input("grnId", grnId).query(`SELECT * FROM BookGoodsReceiptItems WHERE grn_id = @grnId`);
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const it of items.recordset) {
          const qty = Number(it.qty_received) - Number(it.qty_damaged);
          if (qty > 0) {
            await postInventoryMovement(pool, {
              storeId: header.store_id,
              bookId: it.book_id,
              txnType: "grn_receipt",
              qtyDelta: qty,
              unitCost: Number(it.unit_cost) || 0,
              docType: "grn",
              docId: grnId,
              performedBy: authUser.id,
            }, tx);
          }
          if (Number(it.qty_damaged) > 0) {
            await postInventoryMovement(pool, {
              storeId: header.store_id,
              bookId: it.book_id,
              txnType: "grn_damaged",
              qtyDelta: 0,
              damagedDelta: Number(it.qty_damaged),
              docType: "grn",
              docId: grnId,
              affectOnHand: false,
              performedBy: authUser.id,
            }, tx);
          }
        }
        await tx.request()
          .input("id", grnId)
          .input("postedBy", authUser.id)
          .input("idempotencyKey", idempotencyKey)
          .query(`
            UPDATE BookGoodsReceipts SET status = 'posted', posted_at = SYSUTCDATETIME(), posted_by = @postedBy,
              idempotency_key = COALESCE(@idempotencyKey, idempotency_key)
            WHERE id = @id AND status <> 'posted'
          `);
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
      res.json({ message: "GRN posted" });
    } catch (err) {
      sendServerError(res, err, "Error posting GRN");
    }
  });

  app.post("/api/bookstore/goods-receipts", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const body = req.body || {};
      const storeId = body.storeId || "store-central";
      const grnId = crypto.randomUUID();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await tx.request()
          .input("id", grnId)
          .input("poId", body.poId || null)
          .input("supplierId", body.supplierId || null)
          .input("storeId", storeId)
          .input("invoiceRef", body.invoiceRef || null)
          .input("receiptDate", body.receiptDate || new Date().toISOString().slice(0, 10))
          .input("notes", body.notes || null)
          .query(`
            INSERT INTO BookGoodsReceipts (id, po_id, supplier_id, store_id, invoice_ref, receipt_date, status, notes)
            VALUES (@id, @poId, @supplierId, @storeId, @invoiceRef, @receiptDate, 'draft', @notes)
          `);
        for (const it of Array.isArray(body.items) ? body.items : []) {
          await tx.request()
            .input("id", crypto.randomUUID())
            .input("grnId", grnId)
            .input("bookId", it.bookId)
            .input("qtyReceived", Number(it.qtyReceived) || 0)
            .input("qtyDamaged", Number(it.qtyDamaged) || 0)
            .input("unitCost", Number(it.unitCost) || 0)
            .query(`
              INSERT INTO BookGoodsReceiptItems (id, grn_id, book_id, qty_received, qty_damaged, unit_cost)
              VALUES (@id, @grnId, @bookId, @qtyReceived, @qtyDamaged, @unitCost)
            `);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
      res.status(201).json({ id: grnId, message: "GRN created (draft). Post to update stock." });
    } catch (err) {
      sendServerError(res, err, "Error creating GRN");
    }
  });

  app.post("/api/bookstore/stock-transfers", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      const body = req.body || {};
      const { fromStoreId, toStoreId, academicSession, notes, items } = body;
      if (!fromStoreId || !toStoreId || fromStoreId === toStoreId) {
        return res.status(400).json({ message: "Valid fromStoreId and toStoreId required" });
      }
      const id = crypto.randomUUID();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await tx.request()
          .input("id", id)
          .input("fromStoreId", fromStoreId)
          .input("toStoreId", toStoreId)
          .input("session", academicSession || null)
          .input("notes", notes || null)
          .input("createdBy", authUser?.id ?? null)
          .query(`
            INSERT INTO BookStockTransfers (id, from_store_id, to_store_id, academic_session, status, notes, created_by)
            VALUES (@id, @fromStoreId, @toStoreId, @session, 'draft', @notes, @createdBy)
          `);
        for (const it of Array.isArray(items) ? items : []) {
          await tx.request()
            .input("id", crypto.randomUUID())
            .input("transferId", id)
            .input("bookId", it.bookId)
            .input("qty", Number(it.qtyRequested) || 0)
            .query(`
              INSERT INTO BookStockTransferItems (id, transfer_id, book_id, qty_requested)
              VALUES (@id, @transferId, @bookId, @qty)
            `);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
      res.status(201).json({ id, message: "Transfer draft created" });
    } catch (err) {
      sendServerError(res, err, "Error creating transfer");
    }
  });

  app.patch("/api/bookstore/stock-transfers/:id/status", u, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });
      const { status } = req.body || {};
      const id = req.params.id;
      const allowed = ["submitted", "approved", "dispatched", "received", "cancelled"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

      const hdr = await pool.request().input("id", id).query(`SELECT * FROM BookStockTransfers WHERE id = @id`);
      const transfer = hdr.recordset[0];
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      const items = await pool.request().input("id", id).query(`SELECT * FROM BookStockTransferItems WHERE transfer_id = @id`);

      if (status === "dispatched") {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          for (const it of items.recordset) {
            const qty = Number(it.qty_requested);
            await postInventoryMovement(pool, {
              storeId: transfer.from_store_id,
              bookId: it.book_id,
              txnType: "transfer_dispatch",
              qtyDelta: -qty,
              docType: "stock_transfer",
              docId: id,
              performedBy: authUser.id,
            }, tx);
            await postInventoryMovement(pool, {
              storeId: transfer.to_store_id,
              bookId: it.book_id,
              txnType: "transfer_in_transit",
              qtyDelta: 0,
              inTransitDelta: qty,
              docType: "stock_transfer",
              docId: id,
              affectOnHand: false,
              performedBy: authUser.id,
            }, tx);
            await tx.request()
              .input("itemId", it.id)
              .input("qty", qty)
              .query(`UPDATE BookStockTransferItems SET qty_dispatched = @qty WHERE id = @itemId`);
          }
          await tx.request().input("id", id).input("by", authUser.id).query(`
            UPDATE BookStockTransfers SET status = 'dispatched', dispatched_at = SYSUTCDATETIME(), dispatched_by = @by WHERE id = @id
          `);
          await tx.commit();
        } catch (e) {
          await tx.rollback();
          throw e;
        }
        return res.json({ message: "Transfer dispatched" });
      }

      if (status === "received") {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          for (const it of items.recordset) {
            const qty = Number(it.qty_dispatched || it.qty_requested);
            await postInventoryMovement(pool, {
              storeId: transfer.to_store_id,
              bookId: it.book_id,
              txnType: "transfer_receive",
              qtyDelta: qty,
              inTransitDelta: -qty,
              docType: "stock_transfer",
              docId: id,
              performedBy: authUser.id,
            }, tx);
            await tx.request()
              .input("itemId", it.id)
              .input("qty", qty)
              .query(`UPDATE BookStockTransferItems SET qty_received = @qty WHERE id = @itemId`);
          }
          await tx.request().input("id", id).input("by", authUser.id).query(`
            UPDATE BookStockTransfers SET status = 'received', received_at = SYSUTCDATETIME(), received_by = @by WHERE id = @id
          `);
          await tx.commit();
        } catch (e) {
          await tx.rollback();
          throw e;
        }
        return res.json({ message: "Transfer received" });
      }

      if (status === "submitted") {
        await pool.request().input("id", id).query(`
          UPDATE BookStockTransfers SET status = 'submitted', submitted_at = SYSUTCDATETIME() WHERE id = @id
        `);
      } else if (status === "approved") {
        await pool.request().input("id", id).input("by", authUser.id).query(`
          UPDATE BookStockTransfers SET status = 'approved', approved_at = SYSUTCDATETIME(), approved_by = @by WHERE id = @id
        `);
      } else if (status === "cancelled") {
        await pool.request().input("id", id).query(`
          UPDATE BookStockTransfers SET status = 'cancelled' WHERE id = @id
        `);
      }
      res.json({ message: `Transfer ${status}` });
    } catch (err) {
      sendServerError(res, err, "Error updating transfer");
    }
  });

  app.get("/api/bookstore/stock-transfers", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const rows = await pool.request().query(`
        SELECT t.*, fs.name AS fromStoreName, ts.name AS toStoreName
        FROM BookStockTransfers t
        JOIN BookstoreStores fs ON fs.id = t.from_store_id
        JOIN BookstoreStores ts ON ts.id = t.to_store_id
        ORDER BY t.created_at DESC
      `);
      res.json(rows.recordset);
    } catch (err) {
      sendServerError(res, err, "Error listing transfers");
    }
  });

  app.post("/api/bookstore/sales", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const authUser = await loadAuthUser(req);
      if (!authUser) return res.status(401).json({ message: "Unauthorized" });

      const body = req.body || {};
      const idempotencyKey = String(req.headers["idempotency-key"] || body.idempotencyKey || "").trim() || null;
      const { studentId, storeId, campusId, academicSession, items, packId, discount, payment, reservationId } = body;

      if (!studentId || !storeId || !campusId) {
        return res.status(400).json({ message: "studentId, storeId, and campusId required" });
      }
      if (!packId && (!Array.isArray(items) || items.length === 0)) {
        return res.status(400).json({ message: "packId or items required" });
      }

      const access = await assertStoreCampusAccess(authUser, storeId, pool, isSuperAdminRole);
      if (!access.ok) return res.status(403).json({ message: "Forbidden for store" });

      const allowDiscount = await canApplyBookstoreDiscount(req);
      const result = await executeBookSale(pool, {
        studentId: String(studentId),
        storeId: String(storeId),
        campusId: String(campusId),
        academicSession: academicSession ? String(academicSession) : undefined,
        packId: packId ? String(packId) : null,
        items: Array.isArray(items)
          ? items.map((it: { bookId: string; quantity: number }) => ({
              bookId: String(it.bookId),
              quantity: Number(it.quantity),
            }))
          : undefined,
        discount: Number(discount) || 0,
        payment,
        reservationId: reservationId ? String(reservationId) : null,
        idempotencyKey,
        allowDiscount,
        performedBy: authUser.id,
      });

      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Insufficient stock|Reservation|already purchased|not active|mismatch|not eligible|not permitted/i.test(msg)) {
        return res.status(409).json({ message: msg });
      }
      const pe = pricingErrorResponse(res, err);
      if (pe) return pe;
      sendServerError(res, err, "Error creating sale");
    }
  });

  app.get("/api/bookstore/sales", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const { page, limit, offset } = parsePage(req);
      const campusId = req.query.campusId ? String(req.query.campusId) : null;
      const request = pool.request();
      let where = "WHERE bs.status = 'posted'";
      if (campusId && campusId !== "all") {
        request.input("campusId", campusId);
        where += " AND bs.campus_id = @campusId";
      }
      const total = (await request.query(`SELECT COUNT(*) AS total FROM BookSales bs ${where}`)).recordset[0]?.total ?? 0;
      const rows = await request.query(`
        SELECT bs.*, s.student_name AS studentName, s.admission_no AS rollNumber
        FROM BookSales bs
        JOIN Students s ON s.id = bs.student_id
        ${where}
        ORDER BY bs.created_at DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `);
      res.json({ data: rows.recordset, page, limit, total });
    } catch (err) {
      sendServerError(res, err, "Error fetching sales");
    }
  });

  app.post("/api/bookstore/suppliers", c, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const body = req.body || {};
      const name = String(body.name || "").trim();
      if (!name) return res.status(400).json({ message: "Supplier name required" });
      const id = crypto.randomUUID();
      await pool.request()
        .input("id", id)
        .input("name", name)
        .input("contact", body.contactPerson || null)
        .input("phone", body.phone || null)
        .input("email", body.email || null)
        .input("address", body.address || null)
        .query(`
          INSERT INTO BookSuppliers (id, name, contact_person, phone, email, address)
          VALUES (@id, @name, @contact, @phone, @email, @address)
        `);
      res.status(201).json({ id });
    } catch (err) {
      sendServerError(res, err, "Error creating supplier");
    }
  });

  app.get("/api/bookstore/suppliers", v, async (_req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const rows = await pool.request().query(`SELECT * FROM BookSuppliers WHERE is_active = 1 ORDER BY name`);
      res.json(rows.recordset);
    } catch (err) {
      sendServerError(res, err, "Error fetching suppliers");
    }
  });

  app.get("/api/bookstore/reports/summary", v, async (req, res) => {
    try {
      if (!getPool()?.connected) await connectToDb();
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Database unavailable" });
      const from = req.query.from ? String(req.query.from) : null;
      const to = req.query.to ? String(req.query.to) : null;
      const request = pool.request();
      let dateFilter = "";
      if (from) {
        request.input("from", from);
        dateFilter += " AND bs.created_at >= @from";
      }
      if (to) {
        request.input("to", to);
        dateFilter += " AND bs.created_at <= @to";
      }
      const sales = await request.query(`
        SELECT
          COUNT(*) AS orders,
          COALESCE(SUM(total), 0) AS gross,
          COALESCE(SUM(discount), 0) AS discounts,
          COALESCE(SUM(paid_amount), 0) AS collected
        FROM BookSales bs WHERE status = 'posted' ${dateFilter}
      `);
      const cogs = await request.query(`
        SELECT COALESCE(SUM(si.quantity * si.unit_cost), 0) AS cogs
        FROM BookSaleItems si
        JOIN BookSales bs ON bs.id = si.sale_id
        WHERE bs.status = 'posted' ${dateFilter}
      `);
      const gross = Number(sales.recordset[0]?.gross || 0);
      const cogsVal = Number(cogs.recordset[0]?.cogs || 0);
      res.json({
        ...sales.recordset[0],
        cogs: cogsVal,
        grossProfit: gross - Number(sales.recordset[0]?.discounts || 0) - cogsVal,
      });
    } catch (err) {
      sendServerError(res, err, "Error generating report");
    }
  });
}
