import crypto from "crypto";
import type { ConnectionPool, Transaction } from "mssql";
import sql from "mssql";
import { nextSequence, postInventoryMovement } from "./ledger.js";
import { assertValidSessionLabel, resolveBookPricesForSession } from "./pricing.js";
import { buildReconciliationPipeline, type PipelineTotals } from "./reconciliationMath.js";
import { loadCourseTitleOrder } from "./courseMaster.js";
import {
  classifyKuickpayDuplicate,
  ensureCourseKuickpayConsumerNumber,
  isValidKuickpayConsumerNumber,
  kuickpayCustomerChargePkr,
  loadKuickpayConfig,
  outstandingPayable,
  paymentError,
} from "../kuickpayBps.js";

export class CourseFlowError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type LinePrice = { unitCost: number; sellingPrice: number };

async function sortByCourseMaster<T extends Record<string, unknown>>(pool: ConnectionPool, rows: T[]): Promise<T[]> {
  const classIds = rows.map((row) => String(row.class_id || row.classId || "")).filter(Boolean);
  const order = await loadCourseTitleOrder(pool, classIds);
  return [...rows].sort((a, b) => {
    const campus = String(a.campusName || a.campus_name || "").localeCompare(String(b.campusName || b.campus_name || ""));
    if (campus) return campus;
    const cls = String(a.className || a.class_name || "").localeCompare(String(b.className || b.class_name || ""));
    if (cls) return cls;
    const ka = order.get(`${a.class_id || a.classId}|${a.book_id || a.bookId}`) ?? 100000;
    const kb = order.get(`${b.class_id || b.classId}|${b.book_id || b.bookId}`) ?? 100000;
    if (ka !== kb) return ka - kb;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

async function pricesOrZero(pool: ConnectionPool, academicSession: string, bookIds: string[]): Promise<Map<string, LinePrice>> {
  const session = assertValidSessionLabel(academicSession);
  const ids = [...new Set(bookIds.filter(Boolean))];
  const map = new Map<string, LinePrice>();
  if (ids.length > 0) {
    const request = pool.request().input("session", session);
    ids.forEach((id, i) => request.input(`b${i}`, id));
    const rows = await request.query(`
      SELECT book_id AS bookId, selling_price AS sellingPrice, purchase_cost AS purchaseCost
      FROM BookPrices
      WHERE academic_session = @session AND book_id IN (${ids.map((_, i) => `@b${i}`).join(", ")})
    `);
    for (const row of rows.recordset) {
      map.set(String(row.bookId), { unitCost: num(row.purchaseCost), sellingPrice: num(row.sellingPrice) });
    }
  }
  for (const id of ids) {
    if (!map.has(id)) map.set(id, { unitCost: 0, sellingPrice: 0 });
  }
  return map;
}

async function requirePrices(pool: ConnectionPool, session: string, bookIds: string[]): Promise<Map<string, LinePrice>> {
  const resolved = await resolveBookPricesForSession(pool, session, bookIds);
  const map = new Map<string, LinePrice>();
  for (const [id, row] of resolved) {
    map.set(id, { unitCost: row.purchaseCost, sellingPrice: row.sellingPrice });
  }
  return map;
}

export async function adjustClassBalance(
  tx: Transaction,
  campusId: string,
  classId: string,
  bookId: string,
  onHandDelta: number,
  damagedDelta = 0
): Promise<void> {
  const sel = await tx.request()
    .input("campusId", campusId)
    .input("classId", classId)
    .input("bookId", bookId)
    .query(`
      SELECT id, on_hand AS onHand, damaged
      FROM CourseClassBalances WITH (UPDLOCK, ROWLOCK)
      WHERE campus_id = @campusId AND class_id = @classId AND book_id = @bookId
    `);
  const row = sel.recordset[0] as { id: string; onHand: number; damaged: number } | undefined;
  const nextOn = (row ? Number(row.onHand) : 0) + onHandDelta;
  const nextDamaged = (row ? Number(row.damaged) : 0) + damagedDelta;
  if (nextOn < -0.0001 || nextDamaged < -0.0001) {
    throw new CourseFlowError(409, "INSUFFICIENT_CLASS_STOCK", "Class stock would go below zero");
  }
  if (!row) {
    await tx.request()
      .input("id", crypto.randomUUID())
      .input("campusId", campusId)
      .input("classId", classId)
      .input("bookId", bookId)
      .input("onHand", nextOn)
      .input("damaged", nextDamaged)
      .query(`
        INSERT INTO CourseClassBalances (id, campus_id, class_id, book_id, on_hand, damaged)
        VALUES (@id, @campusId, @classId, @bookId, @onHand, @damaged)
      `);
    return;
  }
  await tx.request()
    .input("id", row.id)
    .input("onHand", nextOn)
    .input("damaged", nextDamaged)
    .query(`
      UPDATE CourseClassBalances
      SET on_hand = @onHand, damaged = @damaged, updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

async function campusStore(pool: ConnectionPool, campusId: string): Promise<string> {
  const r = await pool.request().input("campusId", campusId).query(`
    SELECT id FROM BookstoreStores WHERE campus_id = @campusId AND store_type = 'campus' AND is_active = 1
  `);
  const id = r.recordset[0]?.id;
  if (!id) throw new CourseFlowError(400, "NO_CAMPUS_STORE", "Campus bookstore is not set up");
  return String(id);
}

async function centralStore(pool: ConnectionPool): Promise<string> {
  const r = await pool.request().query(`
    SELECT TOP 1 id FROM BookstoreStores WHERE store_type = 'central' AND is_active = 1
  `);
  const id = r.recordset[0]?.id;
  if (!id) throw new CourseFlowError(400, "NO_CENTRAL_STORE", "Central warehouse is not set up");
  return String(id);
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function saveProjection(
  pool: ConnectionPool,
  input: {
    academicSession: string;
    campusId: string;
    classId: string;
    bookId: string;
    quantity: number;
    notes?: string;
    createdBy: string;
  }
) {
  const session = assertValidSessionLabel(input.academicSession);
  if (!input.campusId || !input.classId || !input.bookId) {
    throw new CourseFlowError(400, "MISSING_FIELDS", "Campus, class, and title are required");
  }
  if (!(input.quantity > 0)) throw new CourseFlowError(400, "BAD_QTY", "Quantity must be greater than zero");
  const id = crypto.randomUUID();
  await pool.request()
    .input("id", id)
    .input("session", session)
    .input("campusId", input.campusId)
    .input("classId", input.classId)
    .input("bookId", input.bookId)
    .input("qty", input.quantity)
    .input("notes", input.notes || null)
    .input("by", input.createdBy)
    .query(`
      MERGE CourseProjections AS t
      USING (SELECT @session AS academic_session, @campusId AS campus_id, @classId AS class_id, @bookId AS book_id) AS s
      ON t.academic_session = s.academic_session AND t.campus_id = s.campus_id AND t.class_id = s.class_id AND t.book_id = s.book_id
      WHEN MATCHED THEN UPDATE SET quantity = @qty, notes = @notes
      WHEN NOT MATCHED THEN INSERT (id, academic_session, campus_id, class_id, book_id, quantity, notes, created_by)
        VALUES (@id, @session, @campusId, @classId, @bookId, @qty, @notes, @by);
    `);
  return { id };
}

export async function listProjections(pool: ConnectionPool, academicSession?: string, campusId?: string) {
  const req = pool.request();
  let where = "WHERE 1=1";
  if (academicSession) {
    where += " AND p.academic_session = @session";
    req.input("session", assertValidSessionLabel(academicSession));
  }
  if (campusId) {
    where += " AND p.campus_id = @campusId";
    req.input("campusId", campusId);
  }
  const rows = await req.query(`
    SELECT p.*, cp.campus_name AS campusName, cp.region, cl.class_name AS className, bc.title
    FROM CourseProjections p
    JOIN Campuses cp ON cp.id = p.campus_id
    JOIN Classes cl ON cl.id = p.class_id
    JOIN BookCatalog bc ON bc.id = p.book_id
    ${where}
    ORDER BY cp.region, cp.campus_name, cl.class_name, bc.title
  `);
  return sortByCourseMaster(pool, rows.recordset);
}

export async function createPurchaseOrder(
  pool: ConnectionPool,
  input: { projectionIds: string[]; notes?: string; createdBy: string }
) {
  const ids = [...new Set((input.projectionIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) throw new CourseFlowError(400, "NO_LINES", "Select at least one projection line");
  const req = pool.request();
  ids.forEach((id, i) => req.input(`id${i}`, id));
  const lines = await req.query(`
    SELECT p.*, bc.title, cl.class_name, cp.campus_name
    FROM CourseProjections p
    JOIN BookCatalog bc ON bc.id = p.book_id
    JOIN Classes cl ON cl.id = p.class_id
    JOIN Campuses cp ON cp.id = p.campus_id
    WHERE p.id IN (${ids.map((_, i) => `@id${i}`).join(",")})
  `);
  if (lines.recordset.length === 0) throw new CourseFlowError(404, "NOT_FOUND", "Projection lines not found");
  const orderedLines = await sortByCourseMaster(pool, lines.recordset);
  const session = String(orderedLines[0].academic_session);
  if (orderedLines.some((r) => String(r.academic_session) !== session)) {
    throw new CourseFlowError(400, "MIXED_SESSION", "All lines must belong to the same academic session");
  }
  const bookIds = orderedLines.map((r) => String(r.book_id));
  const prices = await pricesOrZero(pool, session, bookIds);
  const seq = await nextSequence(pool, "course-po");
  const year = session.slice(0, 4);
  const orderNo = `PO-${year}-${String(seq).padStart(4, "0")}`;
  const poId = crypto.randomUUID();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await tx.request()
      .input("id", poId)
      .input("orderNo", orderNo)
      .input("session", session)
      .input("notes", input.notes || null)
      .input("by", input.createdBy)
      .query(`
        INSERT INTO CoursePurchaseOrders (id, order_no, academic_session, order_date, status, notes, created_by)
        VALUES (@id, @orderNo, @session, CAST(GETUTCDATE() AS DATE), 'sent', @notes, @by)
      `);
    let order = 0;
    for (const line of orderedLines) {
      const price = prices.get(String(line.book_id)) || { unitCost: 0, sellingPrice: 0 };
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("poId", poId)
        .input("projectionId", line.id)
        .input("campusId", line.campus_id)
        .input("classId", line.class_id)
        .input("bookId", line.book_id)
        .input("qty", line.quantity)
        .input("cost", price.unitCost)
        .input("sale", price.sellingPrice)
        .input("sort", order++)
        .query(`
          INSERT INTO CoursePurchaseOrderItems (
            id, po_id, projection_id, campus_id, class_id, book_id, quantity, unit_cost, selling_price, sort_order
          ) VALUES (
            @id, @poId, @projectionId, @campusId, @classId, @bookId, @qty, @cost, @sale, @sort
          )
        `);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { id: poId, orderNo };
}

export async function listPurchaseOrders(pool: ConnectionPool) {
  const headers = await pool.request().query(`
    SELECT * FROM CoursePurchaseOrders ORDER BY created_at DESC
  `);
  const items = await pool.request().query(`
    SELECT i.*, cp.campus_name AS campusName, cp.region, cl.class_name AS className, bc.title
    FROM CoursePurchaseOrderItems i
    JOIN Campuses cp ON cp.id = i.campus_id
    JOIN Classes cl ON cl.id = i.class_id
    JOIN BookCatalog bc ON bc.id = i.book_id
    ORDER BY i.sort_order, bc.title
  `);
  return headers.recordset.map((h) => ({
    ...h,
    items: items.recordset.filter((it) => it.po_id === h.id),
  }));
}

export async function postWarehouseDispatch(
  pool: ConnectionPool,
  input: {
    poId: string;
    invoiceRef?: string;
    dispatchDate?: string;
    notes?: string;
    items: Array<{ poItemId: string; qtyDispatched: number }>;
    createdBy: string;
  }
) {
  if (!input.poId) throw new CourseFlowError(400, "NO_PO", "Purchase order is required");
  const po = await pool.request().input("id", input.poId).query(`SELECT * FROM CoursePurchaseOrders WHERE id = @id`);
  if (!po.recordset[0]) throw new CourseFlowError(404, "NOT_FOUND", "Purchase order not found");
  const poItems = await pool.request().input("id", input.poId).query(`
    SELECT i.*, bc.title FROM CoursePurchaseOrderItems i
    JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE i.po_id = @id
    ORDER BY bc.title
  `);
  const already = await pool.request().input("id", input.poId).query(`
    SELECT po_item_id, COALESCE(SUM(qty_dispatched), 0) AS qty
    FROM WarehouseDispatchItems di
    JOIN WarehouseDispatches d ON d.id = di.dispatch_id
    WHERE d.po_id = @id
    GROUP BY po_item_id
  `);
  const dispatched = new Map<string, number>(already.recordset.map((r) => [String(r.po_item_id), num(r.qty)]));
  const byId = new Map(poItems.recordset.map((r) => [String(r.id), r]));
  const lines = (input.items || []).filter((it) => num(it.qtyDispatched) > 0);
  if (lines.length === 0) throw new CourseFlowError(400, "NO_LINES", "Enter a dispatched quantity for at least one title");
  for (const line of lines) {
    const src = byId.get(line.poItemId);
    if (!src) throw new CourseFlowError(400, "BAD_LINE", "Dispatch line does not belong to this purchase order");
    const remaining = num(src.quantity) - (dispatched.get(line.poItemId) || 0);
    if (num(line.qtyDispatched) - remaining > 0.0001) {
      throw new CourseFlowError(400, "OVER_DISPATCH", `Cannot dispatch more than ordered for ${src.title}`);
    }
  }
  const seq = await nextSequence(pool, "course-dispatch");
  const dispatchNo = `WD-${String(seq).padStart(4, "0")}`;
  const dispatchId = crypto.randomUUID();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await tx.request()
      .input("id", dispatchId)
      .input("no", dispatchNo)
      .input("poId", input.poId)
      .input("invoice", input.invoiceRef || null)
      .input("date", input.dispatchDate || null)
      .input("notes", input.notes || null)
      .input("by", input.createdBy)
      .query(`
        INSERT INTO WarehouseDispatches (id, dispatch_no, po_id, invoice_ref, dispatch_date, status, notes, created_by)
        VALUES (@id, @no, @poId, @invoice, COALESCE(TRY_CONVERT(date, @date), CAST(GETUTCDATE() AS DATE)), 'posted', @notes, @by)
      `);
    const receivingByCampus = new Map<string, string>();
    let sort = 0;
    const ordered = [...lines].sort((a, b) => num(byId.get(a.poItemId)?.sort_order) - num(byId.get(b.poItemId)?.sort_order));
    for (const line of ordered) {
      const src = byId.get(line.poItemId)!;
      const itemId = crypto.randomUUID();
      await tx.request()
        .input("id", itemId)
        .input("dispatchId", dispatchId)
        .input("poItemId", line.poItemId)
        .input("campusId", src.campus_id)
        .input("classId", src.class_id)
        .input("bookId", src.book_id)
        .input("qty", num(line.qtyDispatched))
        .input("cost", src.unit_cost)
        .input("sale", src.selling_price)
        .input("sort", sort)
        .query(`
          INSERT INTO WarehouseDispatchItems (
            id, dispatch_id, po_item_id, campus_id, class_id, book_id, qty_dispatched, unit_cost, selling_price, sort_order
          ) VALUES (
            @id, @dispatchId, @poItemId, @campusId, @classId, @bookId, @qty, @cost, @sale, @sort
          )
        `);
      let receivingId = receivingByCampus.get(String(src.campus_id));
      if (!receivingId) {
        receivingId = crypto.randomUUID();
        receivingByCampus.set(String(src.campus_id), receivingId);
        await tx.request()
          .input("id", receivingId)
          .input("dispatchId", dispatchId)
          .input("campusId", src.campus_id)
          .query(`
            INSERT INTO CampusReceivings (id, dispatch_id, campus_id, status)
            VALUES (@id, @dispatchId, @campusId, 'pending')
          `);
      }
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("receivingId", receivingId)
        .input("dispatchItemId", itemId)
        .input("bookId", src.book_id)
        .input("classId", src.class_id)
        .input("qty", num(line.qtyDispatched))
        .input("sort", sort)
        .query(`
          INSERT INTO CampusReceivingItems (
            id, receiving_id, dispatch_item_id, book_id, class_id, qty_dispatched, sort_order
          ) VALUES (
            @id, @receivingId, @dispatchItemId, @bookId, @classId, @qty, @sort
          )
        `);
      sort += 1;
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { id: dispatchId, dispatchNo };
}

export async function listDispatches(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT d.*, p.order_no AS orderNo
    FROM WarehouseDispatches d
    JOIN CoursePurchaseOrders p ON p.id = d.po_id
    ORDER BY d.created_at DESC
  `);
  return rows.recordset;
}

export async function listReceiving(pool: ConnectionPool, campusId?: string) {
  const req = pool.request();
  let where = "";
  if (campusId) {
    where = "WHERE r.campus_id = @campusId";
    req.input("campusId", campusId);
  }
  const headers = await req.query(`
    SELECT r.*, d.dispatch_no AS dispatchNo, d.invoice_ref AS invoiceRef, p.order_no AS orderNo,
           cp.campus_name AS campusName, cp.region
    FROM CampusReceivings r
    JOIN WarehouseDispatches d ON d.id = r.dispatch_id
    JOIN CoursePurchaseOrders p ON p.id = d.po_id
    JOIN Campuses cp ON cp.id = r.campus_id
    ${where}
    ORDER BY r.created_at DESC
  `);
  const items = await pool.request().query(`
    SELECT i.*, bc.title,
           (i.qty_dispatched - COALESCE(i.qty_received, 0)) AS difference
    FROM CampusReceivingItems i
    JOIN BookCatalog bc ON bc.id = i.book_id
    ORDER BY i.sort_order, bc.title
  `);
  return headers.recordset.map((h) => ({
    ...h,
    items: items.recordset.filter((it) => it.receiving_id === h.id),
  }));
}

export async function verifyReceivingItem(
  pool: ConnectionPool,
  input: { itemId: string; qtyReceived: number; performedBy: string }
) {
  if (!(input.qtyReceived >= 0)) throw new CourseFlowError(400, "BAD_QTY", "Received quantity cannot be negative");
  const row = await pool.request().input("id", input.itemId).query(`
    SELECT i.*, r.campus_id, r.id AS receivingId, d.unit_cost, d.selling_price
    FROM CampusReceivingItems i
    JOIN CampusReceivings r ON r.id = i.receiving_id
    JOIN WarehouseDispatchItems d ON d.id = i.dispatch_item_id
    WHERE i.id = @id
  `);
  const item = row.recordset[0];
  if (!item) throw new CourseFlowError(404, "NOT_FOUND", "Receiving line not found");
  if (item.verified === true || item.verified === 1) {
    throw new CourseFlowError(409, "ALREADY_VERIFIED", "This title is already verified");
  }
  const storeId = await campusStore(pool, String(item.campus_id));
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await tx.request()
      .input("id", input.itemId)
      .input("qty", input.qtyReceived)
      .input("by", input.performedBy)
      .query(`
        UPDATE CampusReceivingItems
        SET qty_received = @qty, verified = 1, verified_by = @by, verified_at = SYSUTCDATETIME()
        WHERE id = @id AND verified = 0
      `);
    if (input.qtyReceived > 0) {
      await postInventoryMovement(pool, {
        storeId,
        bookId: String(item.book_id),
        campusId: String(item.campus_id),
        txnType: "campus_receive",
        qtyDelta: input.qtyReceived,
        unitCost: num(item.unit_cost),
        docType: "campus_receiving",
        docId: String(item.receivingId),
        reason: "Warehouse receipt verified",
        performedBy: input.performedBy,
      }, tx);
      await adjustClassBalance(tx, String(item.campus_id), String(item.class_id), String(item.book_id), input.qtyReceived, 0);
    }
    const pending = await tx.request().input("receivingId", item.receivingId).query(`
      SELECT
        SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) AS openLines,
        COUNT(*) AS totalLines
      FROM CampusReceivingItems WHERE receiving_id = @receivingId
    `);
    const openLines = num(pending.recordset[0]?.openLines);
    const status = openLines === 0 ? "verified" : "partial";
    await tx.request().input("id", item.receivingId).input("status", status).query(`
      UPDATE CampusReceivings SET status = @status WHERE id = @id
    `);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { verified: true, difference: num(item.qty_dispatched) - input.qtyReceived };
}

type VoucherLine = { bookId: string; quantity: number };

async function resolveVoucherLines(
  pool: ConnectionPool,
  input: { campusId: string; classId: string; mode: string; packId?: string | null; items?: VoucherLine[] }
): Promise<{ packId: string | null; lines: VoucherLine[] }> {
  if (input.mode === "full") {
    if (!input.packId) throw new CourseFlowError(400, "NO_PACK", "Full course needs a class pack");
    const pack = await pool.request().input("id", input.packId).query(`SELECT * FROM BookPacks WHERE id = @id AND is_active = 1`);
    const p = pack.recordset[0];
    if (!p) throw new CourseFlowError(404, "NO_PACK", "Class pack not found");
    if (String(p.campus_id) !== input.campusId || String(p.class_id) !== input.classId) {
      throw new CourseFlowError(400, "PACK_MISMATCH", "Pack does not match this campus and class");
    }
    const items = await pool.request().input("packId", input.packId).query(`
      SELECT i.book_id AS bookId, i.quantity, bc.title
      FROM BookPackItems i
      JOIN BookCatalog bc ON bc.id = i.book_id
      WHERE i.pack_id = @packId
    `);
    if (items.recordset.length === 0) throw new CourseFlowError(400, "EMPTY_PACK", "Class pack has no titles");
    const order = await loadCourseTitleOrder(pool, [input.classId]);
    const lines = items.recordset
      .map((r) => ({ bookId: String(r.bookId), quantity: num(r.quantity), title: String(r.title || "") }))
      .sort((a, b) => {
        const ka = order.get(`${input.classId}|${a.bookId}`) ?? 100000;
        const kb = order.get(`${input.classId}|${b.bookId}`) ?? 100000;
        if (ka !== kb) return ka - kb;
        return a.title.localeCompare(b.title);
      });
    return {
      packId: input.packId,
      lines: lines.map((line) => ({ bookId: line.bookId, quantity: line.quantity })),
    };
  }
  const raw = (input.items || []).filter((it) => it.bookId && num(it.quantity) > 0);
  if (raw.length === 0) throw new CourseFlowError(400, "NO_LINES", "Custom voucher needs at least one title");
  const req = pool.request();
  raw.forEach((it, i) => req.input(`b${i}`, it.bookId));
  const titles = await req.query(`
    SELECT id, title FROM BookCatalog WHERE id IN (${raw.map((_, i) => `@b${i}`).join(",")})
  `);
  const titleOf = new Map(titles.recordset.map((r) => [String(r.id), String(r.title)]));
  const order = await loadCourseTitleOrder(pool, [input.classId]);
  const lines = [...raw].sort((a, b) => {
    const ka = order.get(`${input.classId}|${a.bookId}`) ?? 100000;
    const kb = order.get(`${input.classId}|${b.bookId}`) ?? 100000;
    if (ka !== kb) return ka - kb;
    return String(titleOf.get(a.bookId) || "").localeCompare(String(titleOf.get(b.bookId) || ""));
  });
  return { packId: null, lines };
}

async function stockAlert(
  pool: ConnectionPool,
  campusId: string,
  classId: string,
  lines: VoucherLine[]
): Promise<string | null> {
  const shortages: string[] = [];
  for (const line of lines) {
    const bal = await pool.request()
      .input("campusId", campusId)
      .input("classId", classId)
      .input("bookId", line.bookId)
      .query(`
        SELECT COALESCE(b.on_hand, 0) AS onHand, bc.title
        FROM BookCatalog bc
        LEFT JOIN CourseClassBalances b
          ON b.book_id = bc.id AND b.campus_id = @campusId AND b.class_id = @classId
        WHERE bc.id = @bookId
      `);
    const onHand = num(bal.recordset[0]?.onHand);
    const title = String(bal.recordset[0]?.title || "Title");
    if (onHand + 0.0001 < line.quantity) {
      shortages.push(`${title}: need ${line.quantity}, available ${onHand}`);
    }
  }
  return shortages.length ? `Stock short — arrange before issue. ${shortages.join("; ")}` : null;
}

async function insertVoucher(
  tx: Transaction,
  input: {
    kind: string;
    mode: string;
    studentId: string;
    campusId: string;
    classId: string;
    storeId: string;
    session: string;
    packId: string | null;
    dueDate?: string | null;
    batchId: string | null;
    lines: VoucherLine[];
    prices: Map<string, LinePrice>;
    alert: string | null;
    createdBy: string;
    voucherNo: string;
  }
) {
  const id = crypto.randomUUID();
  let subtotal = 0;
  const priced = input.lines.map((line, index) => {
    const price = input.prices.get(line.bookId);
    if (!price) throw new CourseFlowError(422, "MISSING_PRICE", "Selling price is missing for a voucher title");
    const lineTotal = price.sellingPrice * line.quantity;
    subtotal += lineTotal;
    return { ...line, ...price, lineTotal, sort: index };
  });
  await tx.request()
    .input("id", id)
    .input("no", input.voucherNo)
    .input("batch", input.batchId)
    .input("kind", input.kind)
    .input("mode", input.mode)
    .input("studentId", input.studentId)
    .input("campusId", input.campusId)
    .input("classId", input.classId)
    .input("storeId", input.storeId)
    .input("session", input.session)
    .input("packId", input.packId)
    .input("due", input.dueDate || null)
    .input("subtotal", subtotal)
    .input("total", subtotal)
    .input("alert", input.alert)
    .input("by", input.createdBy)
    .query(`
      INSERT INTO CourseVouchers (
        id, voucher_no, batch_id, kind, mode, student_id, campus_id, class_id, store_id,
        academic_session, pack_id, due_date, subtotal, total, stock_alert, created_by
      ) VALUES (
        @id, @no, @batch, @kind, @mode, @studentId, @campusId, @classId, @storeId,
        @session, @packId, TRY_CONVERT(date, @due), @subtotal, @total, @alert, @by
      )
    `);
  for (const line of priced) {
    await tx.request()
      .input("id", crypto.randomUUID())
      .input("voucherId", id)
      .input("bookId", line.bookId)
      .input("qty", line.quantity)
      .input("price", line.sellingPrice)
      .input("cost", line.unitCost)
      .input("lineTotal", line.lineTotal)
      .input("sort", line.sort)
      .query(`
        INSERT INTO CourseVoucherItems (id, voucher_id, book_id, quantity, unit_price, unit_cost, line_total, sort_order)
        VALUES (@id, @voucherId, @bookId, @qty, @price, @cost, @lineTotal, @sort)
      `);
  }
  return { id, voucherNo: input.voucherNo, total: subtotal, stockAlert: input.alert };
}

export async function createCourseVouchers(
  pool: ConnectionPool,
  input: {
    kind: "bulk" | "individual" | "existing";
    mode: "full" | "custom";
    campusId: string;
    classId: string;
    academicSession: string;
    studentId?: string;
    packId?: string | null;
    dueDate?: string | null;
    items?: VoucherLine[];
    createdBy: string;
  }
) {
  const session = assertValidSessionLabel(input.academicSession);
  if (!["bulk", "individual", "existing"].includes(input.kind)) {
    throw new CourseFlowError(400, "BAD_KIND", "Voucher kind must be bulk, individual, or existing");
  }
  if (!["full", "custom"].includes(input.mode)) {
    throw new CourseFlowError(400, "BAD_MODE", "Choose full course or customize");
  }
  const resolved = await resolveVoucherLines(pool, input);
  const prices = await requirePrices(pool, session, resolved.lines.map((l) => l.bookId));
  const storeId = await campusStore(pool, input.campusId);
  const alert = await stockAlert(pool, input.campusId, input.classId, resolved.lines);

  let students: Array<{ id: string }>;
  if (input.kind === "bulk") {
    const rows = await pool.request()
      .input("campusId", input.campusId)
      .input("classId", input.classId)
      .input("session", session)
      .query(`
        SELECT s.id
        FROM Students s
        WHERE s.campus_id = @campusId AND s.class_id = @classId AND s.status IN ('Active', 'Pending')
          AND EXISTS (
            SELECT 1 FROM AdmissionApplications a
            WHERE a.status = 'Enrolled'
              AND (a.student_id = s.id OR a.linked_student_id = s.id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM CourseVouchers v
            WHERE v.student_id = s.id AND v.academic_session = @session AND v.status = 'open'
          )
        ORDER BY s.student_name
      `);
    students = rows.recordset;
    if (students.length === 0) {
      throw new CourseFlowError(400, "NO_STUDENTS", "No enrolled admissions in this class without an open course voucher");
    }
  } else {
    if (!input.studentId) throw new CourseFlowError(400, "NO_STUDENT", "Student is required");
    const student = await pool.request().input("id", input.studentId).query(`
      SELECT id, campus_id, class_id, status FROM Students WHERE id = @id
    `);
    const s = student.recordset[0];
    if (!s) throw new CourseFlowError(404, "NO_STUDENT", "Student not found");
    const studentStatus = String(s.status);
    if (input.kind === "existing" && studentStatus !== "Active") {
      throw new CourseFlowError(400, "INACTIVE", "Existing-student vouchers are for active students");
    }
    if (input.kind === "individual" && studentStatus !== "Active" && studentStatus !== "Pending") {
      throw new CourseFlowError(400, "INACTIVE", "Student must be active or a pending admission");
    }
    if (input.kind !== "existing" && input.kind !== "individual" && studentStatus !== "Active") {
      throw new CourseFlowError(400, "INACTIVE", "Student is not active");
    }
    if (String(s.campus_id) !== input.campusId || String(s.class_id) !== input.classId) {
      throw new CourseFlowError(400, "STUDENT_MISMATCH", "Student campus or class does not match the voucher");
    }
    students = [{ id: String(s.id) }];
  }

  const batchId = input.kind === "bulk" ? crypto.randomUUID() : null;
  const year = session.slice(0, 4);
  const voucherNos: string[] = [];
  for (let i = 0; i < students.length; i += 1) {
    const seq = await nextSequence(pool, "course-voucher");
    voucherNos.push(`CV-${year}-${String(seq).padStart(4, "0")}`);
  }
  const created: Array<{ id: string; voucherNo: string; total: number; stockAlert: string | null }> = [];
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (let i = 0; i < students.length; i += 1) {
      const student = students[i];
      const voucherNo = voucherNos[i];
      created.push(await insertVoucher(tx, {
        kind: input.kind,
        mode: input.mode,
        studentId: student.id,
        campusId: input.campusId,
        classId: input.classId,
        storeId,
        session,
        packId: resolved.packId,
        dueDate: input.dueDate,
        batchId,
        lines: resolved.lines,
        prices,
        alert,
        createdBy: input.createdBy,
        voucherNo,
      }));
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  for (const voucher of created) {
    await ensureCourseKuickpayConsumerNumber(pool, voucher.id);
  }
  return { count: created.length, vouchers: created, stockAlert: alert };
}

export async function listCourseVouchers(pool: ConnectionPool, campusId?: string) {
  const req = pool.request();
  let where = "";
  if (campusId) {
    where = "WHERE v.campus_id = @campusId";
    req.input("campusId", campusId);
  }
  const rows = await req.query(`
    SELECT v.*, s.student_name AS studentName, s.admission_no AS admissionNo,
           s.course_issue_status AS studentCourseStatus,
           cp.campus_name AS campusName, cl.class_name AS className,
           ISNULL((SELECT TOP 1 kuickpay_customer_charge FROM QuickPayConfig), 0) AS kuickpayCharge
    FROM CourseVouchers v
    JOIN Students s ON s.id = v.student_id
    JOIN Campuses cp ON cp.id = v.campus_id
    JOIN Classes cl ON cl.id = v.class_id
    ${where}
    ORDER BY v.created_at DESC
  `);
  let filled = 0;
  for (const voucher of rows.recordset) {
    if (filled >= 40) break;
    if (String(voucher.status) !== "open" || String(voucher.payment_status) === "paid") continue;
    if (isValidKuickpayConsumerNumber(voucher.kuickpay_consumer_number)) continue;
    const cn = await ensureCourseKuickpayConsumerNumber(pool, String(voucher.id));
    if (cn) {
      voucher.kuickpay_consumer_number = cn;
      filled += 1;
    }
  }
  const items = await pool.request().query(`
    SELECT i.*, bc.title
    FROM CourseVoucherItems i
    JOIN BookCatalog bc ON bc.id = i.book_id
    ORDER BY i.sort_order, bc.title
  `);
  return rows.recordset.map((v) => ({
    ...v,
    items: items.recordset.filter((it) => it.voucher_id === v.id),
  }));
}

export async function recordVoucherPayment(
  pool: ConnectionPool,
  input: { voucherId: string; amount: number; method: string; transactionRef?: string; performedBy?: string }
) {
  if (!(input.amount > 0)) throw new CourseFlowError(400, "BAD_AMOUNT", "Payment amount must be greater than zero");
  const method = String(input.method || "").trim();
  if (!method) throw new CourseFlowError(400, "NO_METHOD", "Payment method is required");
  const found = await pool.request().input("id", input.voucherId).query(`SELECT * FROM CourseVouchers WHERE id = @id`);
  const voucher = found.recordset[0];
  if (!voucher) throw new CourseFlowError(404, "NOT_FOUND", "Course voucher not found");
  if (String(voucher.status) !== "open") throw new CourseFlowError(409, "CLOSED", "Voucher is not open");
  if (String(voucher.issue_status) === "issued") throw new CourseFlowError(409, "ISSUED", "Course is already issued");
  if (input.transactionRef) {
    const dup = await pool.request()
      .input("id", input.voucherId)
      .input("ref", input.transactionRef)
      .query(`SELECT payment_ref FROM CourseVouchers WHERE id = @id AND payment_ref = @ref AND payment_status = 'paid'`);
    if (dup.recordset[0]) return { paymentStatus: "paid", duplicate: true };
  }
  const paid = num(voucher.paid_amount) + input.amount;
  const total = num(voucher.total);
  const status = paid + 0.009 >= total ? "paid" : "partial";
  await pool.request()
    .input("id", input.voucherId)
    .input("paid", status === "paid" ? total : paid)
    .input("status", status)
    .input("method", method)
    .input("ref", input.transactionRef || null)
    .query(`
      UPDATE CourseVouchers SET
        paid_amount = @paid,
        payment_status = @status,
        payment_method = @method,
        payment_ref = COALESCE(@ref, payment_ref),
        paid_at = CASE WHEN @status = 'paid' THEN SYSUTCDATETIME() ELSE paid_at END
      WHERE id = @id
    `);
  return { paymentStatus: status, paidAmount: status === "paid" ? total : paid };
}

export function courseVoucherBill(row: Record<string, unknown>): Record<string, unknown> {
  const total = num(row.total);
  const paid = num(row.paid_amount ?? row.paidAmount);
  const paymentStatus = String(row.payment_status ?? row.paymentStatus ?? "");
  const open = String(row.status || "open") === "open";
  const isPaid = paymentStatus === "paid";
  const dueRaw = row.due_date ?? row.dueDate;
  const dueDate = dueRaw ? new Date(String(dueRaw)) : new Date();
  const month = Number.isNaN(dueDate.getTime()) ? new Date().getUTCMonth() + 1 : dueDate.getUTCMonth() + 1;
  const year = Number.isNaN(dueDate.getTime()) ? new Date().getUTCFullYear() : dueDate.getUTCFullYear();
  return {
    id: row.id,
    student_id: row.student_id ?? row.studentId,
    amount: total,
    balance_amount: isPaid ? 0 : Math.max(0, total - paid),
    paid_amount: paid,
    arrears: 0,
    fine_amount: 0,
    discount_amount: 0,
    status: !open ? "Cancelled" : isPaid ? "Paid" : "Unpaid",
    due_date: dueRaw,
    month,
    year,
    studentName: row.studentName,
    studentContact: row.studentContact,
    payment_date: row.paid_at ?? row.paidAt,
    transaction_ref: row.payment_ref ?? row.paymentRef,
  };
}

export async function findCourseVoucherByConsumerNumber(pool: ConnectionPool, consumerNumber: string) {
  const cn = String(consumerNumber || "").replace(/\D/g, "");
  if (!cn) return null;
  const result = await pool.request().input("cn", cn).query(`
    SELECT TOP 1
      v.*,
      s.student_name AS studentName,
      s.father_mobile AS studentContact
    FROM CourseVouchers v
    JOIN Students s ON s.id = v.student_id
    WHERE v.kuickpay_consumer_number = @cn
  `);
  return result.recordset[0] || null;
}

export async function applyCourseKuickpayPayment(
  pool: ConnectionPool,
  opts: {
    voucher: Record<string, unknown>;
    consumerNumber: string;
    amount: number;
    tranAuthId: string;
    tranDate: string;
    tranTime: string;
    bankMnemonic: string;
    reserved?: string;
  }
) {
  const bill = courseVoucherBill(opts.voucher);
  const cfg = await loadKuickpayConfig(pool);
  const charge = kuickpayCustomerChargePkr(cfg);
  const base = outstandingPayable(bill);
  const expected = base + (charge > 0 ? charge : 0);
  const dup = await classifyKuickpayDuplicate(pool, opts.consumerNumber, opts.tranAuthId, opts.amount, opts.tranDate);
  if (dup === "exact") return paymentError("03", "Duplicate transaction");
  if (dup === "mismatch") return paymentError("04", "Transaction auth already used with different amount or date");
  if (String(bill.status) === "Cancelled") return paymentError("02", "Voucher is blocked or expired");
  if (String(bill.status) === "Paid" || base <= 0) return paymentError("04", "Voucher already paid");
  if (!(opts.amount > 0)) return paymentError("04", "Invalid transaction amount");
  if (Math.abs(opts.amount - expected) > 0.009) {
    return paymentError("04", `Partial payment not supported; full amount required (${expected.toFixed(2)})`);
  }
  await recordVoucherPayment(pool, {
    voucherId: String(opts.voucher.id),
    amount: base,
    method: "KuickPay",
    transactionRef: opts.tranAuthId,
  });
  await pool.request()
    .input("id", crypto.randomUUID())
    .input("fee_id", String(opts.voucher.id))
    .input("student_id", String(opts.voucher.student_id))
    .input("consumer_number", opts.consumerNumber)
    .input("tran_auth_id", opts.tranAuthId)
    .input("amount", opts.amount)
    .input("tran_date", opts.tranDate)
    .input("tran_time", opts.tranTime || null)
    .input("bank_mnemonic", opts.bankMnemonic || null)
    .input("reserved", opts.reserved || null)
    .query(`
      INSERT INTO KuickpayPaymentLog (
        id, fee_id, student_id, consumer_number, tran_auth_id, amount,
        tran_date, tran_time, bank_mnemonic, reserved, created_at
      ) VALUES (
        @id, @fee_id, @student_id, @consumer_number, @tran_auth_id, @amount,
        @tran_date, @tran_time, @bank_mnemonic, @reserved, GETDATE()
      )
    `);
  const receipt = String(Date.now()).slice(-20).padStart(20, "0");
  return {
    response_Code: "00",
    Identification_Parameter: receipt,
    Reserved: String(opts.reserved || "").slice(0, 200),
    status: "Paid",
    balanceAmount: 0,
  };
}

export async function markCourseVoucherPaidById(
  pool: ConnectionPool,
  voucherId: string,
  amount: number,
  transactionId: string
): Promise<{ applied: boolean; paymentStatus?: string }> {
  const exists = await pool.request().input("id", voucherId).query(`
    SELECT id, total, paid_amount AS paidAmount, payment_status AS paymentStatus
    FROM CourseVouchers WHERE id = @id
  `);
  const voucher = exists.recordset[0];
  if (!voucher) return { applied: false };
  if (String(voucher.paymentStatus) === "paid") return { applied: true, paymentStatus: "paid" };
  const due = Math.max(0.01, num(voucher.total) - num(voucher.paidAmount));
  const result = await recordVoucherPayment(pool, {
    voucherId,
    amount: amount > 0 ? amount : due,
    method: "KuickPay",
    transactionRef: transactionId,
  });
  return { applied: true, paymentStatus: result.paymentStatus };
}

export async function issueCourseVoucher(pool: ConnectionPool, voucherId: string, performedBy: string) {
  const found = await pool.request().input("id", voucherId).query(`SELECT * FROM CourseVouchers WHERE id = @id`);
  const voucher = found.recordset[0];
  if (!voucher) throw new CourseFlowError(404, "NOT_FOUND", "Course voucher not found");
  if (String(voucher.issue_status) === "issued") {
    throw new CourseFlowError(409, "ALREADY_ISSUED", "Course is already issued for this voucher");
  }
  if (String(voucher.payment_status) !== "paid") {
    throw new CourseFlowError(409, "UNPAID", "Course can be issued only after payment is paid");
  }
  const items = await pool.request().input("id", voucherId).query(`
    SELECT i.*, bc.title
    FROM CourseVoucherItems i
    JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE i.voucher_id = @id
    ORDER BY i.sort_order, bc.title
  `);
  if (items.recordset.length === 0) throw new CourseFlowError(400, "NO_LINES", "Voucher has no titles");
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const item of items.recordset) {
      await postInventoryMovement(pool, {
        storeId: String(voucher.store_id),
        bookId: String(item.book_id),
        campusId: String(voucher.campus_id),
        txnType: "course_issue",
        qtyDelta: -num(item.quantity),
        unitCost: num(item.unit_cost),
        docType: "course_issue",
        docId: voucherId,
        reason: `Issued against ${voucher.voucher_no}`,
        performedBy,
      }, tx);
      await adjustClassBalance(
        tx,
        String(voucher.campus_id),
        String(voucher.class_id),
        String(item.book_id),
        -num(item.quantity),
        0
      );
    }
    await tx.request()
      .input("id", crypto.randomUUID())
      .input("voucherId", voucherId)
      .input("campusId", voucher.campus_id)
      .input("classId", voucher.class_id)
      .input("studentId", voucher.student_id)
      .input("by", performedBy)
      .query(`
        INSERT INTO CourseIssues (id, voucher_id, campus_id, class_id, student_id, issued_by)
        VALUES (@id, @voucherId, @campusId, @classId, @studentId, @by)
      `);
    await tx.request().input("id", voucherId).input("by", performedBy).query(`
      UPDATE CourseVouchers
      SET issue_status = 'issued', issued_at = SYSUTCDATETIME(), issued_by = @by
      WHERE id = @id
    `);
    await tx.request()
      .input("studentId", voucher.student_id)
      .input("session", voucher.academic_session)
      .query(`
        UPDATE Students
        SET course_issue_status = 'issued', course_issued_session = @session
        WHERE id = @studentId
      `);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    if (e instanceof Error && /Insufficient stock/i.test(e.message)) {
      throw new CourseFlowError(409, "INSUFFICIENT_STOCK", "Available stock is not enough to issue the voucher titles");
    }
    throw e;
  }
  return { issued: true };
}

export async function createStockAdjustment(
  pool: ConnectionPool,
  input: {
    campusId: string;
    classId: string;
    bookId: string;
    adjType: "damage" | "adjustment" | "return_warehouse";
    quantity: number;
    reason: string;
    requestedBy: string;
  }
) {
  const reason = String(input.reason || "").trim();
  if (reason.length < 8) {
    throw new CourseFlowError(400, "REASON_REQUIRED", "Enter a clear reason (at least 8 characters)");
  }
  if (!["damage", "adjustment", "return_warehouse"].includes(input.adjType)) {
    throw new CourseFlowError(400, "BAD_TYPE", "Type must be damage, adjustment, or return to warehouse");
  }
  if (input.adjType === "adjustment") {
    if (!input.quantity || input.quantity === 0) throw new CourseFlowError(400, "BAD_QTY", "Adjustment quantity cannot be zero");
  } else if (!(input.quantity > 0)) {
    throw new CourseFlowError(400, "BAD_QTY", "Quantity must be greater than zero");
  }
  const storeId = await campusStore(pool, input.campusId);
  const seq = await nextSequence(pool, "course-adj");
  const id = crypto.randomUUID();
  const adjustmentNo = `ADJ-${String(seq).padStart(4, "0")}`;
  await pool.request()
    .input("id", id)
    .input("no", adjustmentNo)
    .input("campusId", input.campusId)
    .input("classId", input.classId)
    .input("storeId", storeId)
    .input("bookId", input.bookId)
    .input("type", input.adjType)
    .input("qty", input.quantity)
    .input("reason", reason)
    .input("by", input.requestedBy)
    .query(`
      INSERT INTO CourseStockAdjustments (
        id, adjustment_no, campus_id, class_id, store_id, book_id, adj_type, quantity, reason, requested_by
      ) VALUES (
        @id, @no, @campusId, @classId, @storeId, @bookId, @type, @qty, @reason, @by
      )
    `);
  return { id, adjustmentNo };
}

export async function approveStockAdjustment(
  pool: ConnectionPool,
  input: { id: string; approvedBy: string; allowSelf: boolean }
) {
  const found = await pool.request().input("id", input.id).query(`SELECT * FROM CourseStockAdjustments WHERE id = @id`);
  const row = found.recordset[0];
  if (!row) throw new CourseFlowError(404, "NOT_FOUND", "Adjustment not found");
  if (String(row.status) !== "pending") throw new CourseFlowError(409, "NOT_PENDING", "Adjustment is not pending");
  if (!input.allowSelf && row.requested_by && String(row.requested_by) === input.approvedBy) {
    throw new CourseFlowError(403, "SELF_APPROVAL", "Another authorized user must approve this adjustment");
  }
  const qty = num(row.quantity);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (row.adj_type === "damage") {
      await postInventoryMovement(pool, {
        storeId: String(row.store_id),
        bookId: String(row.book_id),
        campusId: String(row.campus_id),
        txnType: "damage",
        qtyDelta: -qty,
        damagedDelta: qty,
        docType: "stock_adjustment",
        docId: input.id,
        reason: String(row.reason),
        performedBy: input.approvedBy,
      }, tx);
      await adjustClassBalance(tx, String(row.campus_id), String(row.class_id), String(row.book_id), -qty, qty);
    } else if (row.adj_type === "return_warehouse") {
      const central = await centralStore(pool);
      await postInventoryMovement(pool, {
        storeId: String(row.store_id),
        bookId: String(row.book_id),
        campusId: String(row.campus_id),
        txnType: "return_to_warehouse",
        qtyDelta: -qty,
        docType: "stock_adjustment",
        docId: input.id,
        reason: String(row.reason),
        performedBy: input.approvedBy,
      }, tx);
      await postInventoryMovement(pool, {
        storeId: central,
        bookId: String(row.book_id),
        txnType: "warehouse_return_in",
        qtyDelta: qty,
        docType: "stock_adjustment",
        docId: input.id,
        reason: String(row.reason),
        performedBy: input.approvedBy,
      }, tx);
      await adjustClassBalance(tx, String(row.campus_id), String(row.class_id), String(row.book_id), -qty, 0);
    } else {
      await postInventoryMovement(pool, {
        storeId: String(row.store_id),
        bookId: String(row.book_id),
        campusId: String(row.campus_id),
        txnType: "adjustment",
        qtyDelta: qty,
        docType: "stock_adjustment",
        docId: input.id,
        reason: String(row.reason),
        performedBy: input.approvedBy,
      }, tx);
      await adjustClassBalance(tx, String(row.campus_id), String(row.class_id), String(row.book_id), qty, 0);
    }
    await tx.request().input("id", input.id).input("by", input.approvedBy).query(`
      UPDATE CourseStockAdjustments
      SET status = 'approved', approved_by = @by, approved_at = SYSUTCDATETIME()
      WHERE id = @id AND status = 'pending'
    `);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    if (e instanceof CourseFlowError) throw e;
    if (e instanceof Error && /Insufficient stock|below zero/i.test(e.message)) {
      throw new CourseFlowError(409, "INSUFFICIENT_STOCK", "Not enough stock for this adjustment");
    }
    throw e;
  }
  return { approved: true };
}

export async function listAdjustments(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT a.*, bc.title, cp.campus_name AS campusName, cl.class_name AS className,
           ru.username AS requestedByName, au.username AS approvedByName
    FROM CourseStockAdjustments a
    JOIN BookCatalog bc ON bc.id = a.book_id
    JOIN Campuses cp ON cp.id = a.campus_id
    JOIN Classes cl ON cl.id = a.class_id
    LEFT JOIN Users ru ON ru.id = a.requested_by
    LEFT JOIN Users au ON au.id = a.approved_by
    ORDER BY a.created_at DESC
  `);
  return rows.recordset;
}

export async function listClassInventory(pool: ConnectionPool, campusId?: string) {
  const req = pool.request();
  let where = "";
  if (campusId) {
    where = "WHERE b.campus_id = @campusId";
    req.input("campusId", campusId);
  }
  const rows = await req.query(`
    SELECT b.*, cp.region, cp.campus_name AS campusName, cl.class_name AS className, bc.title
    FROM CourseClassBalances b
    JOIN Campuses cp ON cp.id = b.campus_id
    JOIN Classes cl ON cl.id = b.class_id
    JOIN BookCatalog bc ON bc.id = b.book_id
    ${where}
    ORDER BY cp.region, cp.campus_name, cl.class_name, bc.title
  `);
  return sortByCourseMaster(pool, rows.recordset);
}

export async function listStockHistory(pool: ConnectionPool, bookId: string, campusId?: string) {
  const req = pool.request().input("bookId", bookId);
  let where = "WHERE l.book_id = @bookId";
  if (campusId) {
    where += " AND (l.campus_id = @campusId OR s.campus_id = @campusId)";
    req.input("campusId", campusId);
  }
  const rows = await req.query(`
    SELECT l.txn_type AS txnType, l.qty_delta AS qtyDelta, l.reason, l.performed_by AS performedBy,
           l.created_at AS createdAt, l.doc_type AS docType, l.doc_id AS docId, s.name AS storeName
    FROM BookInventoryLedger l
    JOIN BookstoreStores s ON s.id = l.store_id
    ${where}
    ORDER BY l.created_at DESC
  `);
  const labels: Record<string, string> = {
    campus_receive: "Warehouse receipt",
    transfer_dispatch: "Course shuffling out",
    transfer_receive: "Course shuffling in",
    course_issue: "Student issue",
    return_to_warehouse: "Return campus to warehouse",
    warehouse_return_in: "Warehouse return in",
    damage: "Damage",
    adjustment: "Adjustment",
  };
  return rows.recordset.map((r) => ({
    ...r,
    movement: labels[String(r.txnType)] || String(r.txnType),
  }));
}

async function pipelineTotals(pool: ConnectionPool, poId?: string): Promise<PipelineTotals> {
  const poFilter = poId ? "WHERE po.id = @poId" : "";
  const req = () => {
    const r = pool.request();
    if (poId) r.input("poId", poId);
    return r;
  };
  const po = await req().query(`
    SELECT
      COALESCE(SUM(i.quantity), 0) AS qty,
      COALESCE(SUM(i.quantity * i.unit_cost), 0) AS cost,
      COALESCE(SUM(i.quantity * i.selling_price), 0) AS sale
    FROM CoursePurchaseOrderItems i
    JOIN CoursePurchaseOrders po ON po.id = i.po_id
    ${poFilter}
  `);
  const dispatch = await req().query(`
    SELECT
      COALESCE(SUM(di.qty_dispatched), 0) AS qty,
      COALESCE(SUM(di.qty_dispatched * di.unit_cost), 0) AS cost,
      COALESCE(SUM(di.qty_dispatched * di.selling_price), 0) AS sale
    FROM WarehouseDispatchItems di
    JOIN WarehouseDispatches d ON d.id = di.dispatch_id
    JOIN CoursePurchaseOrders po ON po.id = d.po_id
    ${poFilter}
  `);
  const received = await req().query(`
    SELECT
      COALESCE(SUM(ri.qty_received), 0) AS qty,
      COALESCE(SUM(ri.qty_received * di.unit_cost), 0) AS cost,
      COALESCE(SUM(ri.qty_received * di.selling_price), 0) AS sale
    FROM CampusReceivingItems ri
    JOIN CampusReceivings r ON r.id = ri.receiving_id
    JOIN WarehouseDispatches d ON d.id = r.dispatch_id
    JOIN WarehouseDispatchItems di ON di.id = ri.dispatch_item_id
    JOIN CoursePurchaseOrders po ON po.id = d.po_id
    WHERE ri.verified = 1 ${poId ? "AND po.id = @poId" : ""}
  `);
  const issued = await req().query(`
    SELECT
      COALESCE(SUM(vi.quantity), 0) AS qty,
      COALESCE(SUM(vi.quantity * vi.unit_cost), 0) AS cost,
      COALESCE(SUM(vi.line_total), 0) AS sale
    FROM CourseVoucherItems vi
    JOIN CourseVouchers v ON v.id = vi.voucher_id AND v.issue_status = 'issued'
    ${poId ? "WHERE 1=0" : ""}
  `);
  const p = po.recordset[0] || {};
  const d = dispatch.recordset[0] || {};
  const r = received.recordset[0] || {};
  const i = issued.recordset[0] || {};
  return {
    poQty: num(p.qty),
    poCost: num(p.cost),
    poSale: num(p.sale),
    dispatchQty: num(d.qty),
    dispatchCost: num(d.cost),
    dispatchSale: num(d.sale),
    receivedQty: num(r.qty),
    receivedCost: num(r.cost),
    receivedSale: num(r.sale),
    issuedQty: poId ? 0 : num(i.qty),
    issuedCost: poId ? 0 : num(i.cost),
    issuedSale: poId ? 0 : num(i.sale),
  };
}

export async function reconciliationReport(pool: ConnectionPool, poId?: string) {
  const totals = await pipelineTotals(pool, poId);
  if (poId) {
    const issued = await pool.request().input("poId", poId).query(`
      SELECT
        COALESCE(SUM(vi.quantity), 0) AS qty,
        COALESCE(SUM(vi.quantity * vi.unit_cost), 0) AS cost,
        COALESCE(SUM(vi.line_total), 0) AS sale
      FROM CourseVoucherItems vi
      JOIN CourseVouchers v ON v.id = vi.voucher_id AND v.issue_status = 'issued'
      WHERE EXISTS (
        SELECT 1 FROM CoursePurchaseOrderItems poi
        WHERE poi.po_id = @poId AND poi.book_id = vi.book_id AND poi.campus_id = v.campus_id AND poi.class_id = v.class_id
      )
    `);
    totals.issuedQty = num(issued.recordset[0]?.qty);
    totals.issuedCost = num(issued.recordset[0]?.cost);
    totals.issuedSale = num(issued.recordset[0]?.sale);
  }
  return { totals, stages: buildReconciliationPipeline(totals) };
}

export async function courseDashboard(pool: ConnectionPool, campusId?: string) {
  const campusSql = campusId ? "AND campus_id = @campusId" : "";
  const vCampus = campusId ? "AND v.campus_id = @campusId" : "";
  const bCampus = campusId ? "AND b.campus_id = @campusId" : "";
  const bind = () => {
    const r = pool.request();
    if (campusId) r.input("campusId", campusId);
    return r;
  };
  const sales = await bind().query(`
    SELECT
      COALESCE(SUM(total), 0) AS totalSale,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS paidVouchers,
      COALESCE(SUM(CASE WHEN payment_status <> 'paid' THEN 1 ELSE 0 END), 0) AS unpaidVouchers,
      COALESCE(SUM(paid_amount), 0) AS totalCollection
    FROM CourseVouchers v
    WHERE status = 'open' ${vCampus}
  `);
  const inv = await bind().query(`
    SELECT
      COALESCE(SUM(on_hand), 0) AS availableStock,
      COALESCE(SUM(damaged), 0) AS damagedStock,
      COALESCE(SUM(CASE WHEN on_hand > 0 AND on_hand <= 5 THEN 1 ELSE 0 END), 0) AS lowStock,
      COALESCE(SUM(CASE WHEN on_hand > 20 THEN 1 ELSE 0 END), 0) AS excessStock
    FROM CourseClassBalances b
    WHERE 1=1 ${bCampus}
  `);
  const received = await bind().query(`
    SELECT COALESCE(SUM(i.qty_received), 0) AS totalReceived
    FROM CampusReceivingItems i
    JOIN CampusReceivings r ON r.id = i.receiving_id
    WHERE i.verified = 1 ${campusId ? "AND r.campus_id = @campusId" : ""}
  `);
  const issued = await bind().query(`
    SELECT COALESCE(SUM(i.quantity), 0) AS totalIssued
    FROM CourseVoucherItems i
    JOIN CourseVouchers v ON v.id = i.voucher_id AND v.issue_status = 'issued'
    WHERE 1=1 ${vCampus}
  `);
  const projection = await bind().query(`
    SELECT COALESCE(SUM(quantity), 0) AS totalProjection
    FROM CourseProjections
    WHERE 1=1 ${campusSql}
  `);
  const byCampus = await bind().query(`
    SELECT cp.campus_name AS campusName, cp.region,
           COALESCE(sale.sale, 0) AS sale,
           COALESCE(sale.collection, 0) AS collection,
           COALESCE(inv.inventory, 0) AS inventory
    FROM Campuses cp
    LEFT JOIN (
      SELECT campus_id, SUM(total) AS sale, SUM(paid_amount) AS collection
      FROM CourseVouchers
      WHERE status = 'open'
      GROUP BY campus_id
    ) sale ON sale.campus_id = cp.id
    LEFT JOIN (
      SELECT campus_id, SUM(on_hand) AS inventory
      FROM CourseClassBalances
      GROUP BY campus_id
    ) inv ON inv.campus_id = cp.id
    WHERE cp.isActive = 1 ${campusId ? "AND cp.id = @campusId" : ""}
    ORDER BY cp.region, cp.campus_name
  `);
  const byRegion = await bind().query(`
    SELECT ISNULL(cp.region, N'Unassigned') AS region,
           COALESCE(inv.inventory, 0) AS inventory,
           COALESCE(col.collection, 0) AS collection
    FROM (SELECT DISTINCT ISNULL(region, N'Unassigned') AS region FROM Campuses WHERE isActive = 1 ${campusId ? "AND id = @campusId" : ""}) cp
    LEFT JOIN (
      SELECT ISNULL(c.region, N'Unassigned') AS region, SUM(b.on_hand) AS inventory
      FROM CourseClassBalances b
      JOIN Campuses c ON c.id = b.campus_id
      ${campusId ? "WHERE b.campus_id = @campusId" : ""}
      GROUP BY ISNULL(c.region, N'Unassigned')
    ) inv ON inv.region = cp.region
    LEFT JOIN (
      SELECT ISNULL(c.region, N'Unassigned') AS region, SUM(v.paid_amount) AS collection
      FROM CourseVouchers v
      JOIN Campuses c ON c.id = v.campus_id
      WHERE v.status = 'open' ${campusId ? "AND v.campus_id = @campusId" : ""}
      GROUP BY ISNULL(c.region, N'Unassigned')
    ) col ON col.region = cp.region
    ORDER BY region
  `);
  const projQty = num(projection.recordset[0]?.totalProjection);
  const issuedQty = num(issued.recordset[0]?.totalIssued);
  const receivedQty = num(received.recordset[0]?.totalReceived);
  return {
    sales: sales.recordset[0],
    inventory: {
      ...inv.recordset[0],
      totalReceived: receivedQty,
      totalIssued: issuedQty,
    },
    projection: {
      totalProjection: projQty,
      receivedQuantity: receivedQty,
      soldQuantity: issuedQty,
      remainingStock: num(inv.recordset[0]?.availableStock),
    },
    campusPerformance: byCampus.recordset,
    regions: byRegion.recordset,
  };
}

export async function courseExceptions(pool: ConnectionPool) {
  const paidNotIssued = await pool.request().query(`
    SELECT TOP 50 v.voucher_no AS voucherNo, s.student_name AS studentName, s.admission_no AS admissionNo,
           cp.campus_name AS campusName, v.total, v.paid_at AS paidAt
    FROM CourseVouchers v
    JOIN Students s ON s.id = v.student_id
    JOIN Campuses cp ON cp.id = v.campus_id
    WHERE v.payment_status = 'paid' AND v.issue_status <> 'issued' AND v.status = 'open'
    ORDER BY v.paid_at
  `);
  const receivingPending = await pool.request().query(`
    SELECT TOP 50 r.id, d.dispatch_no AS dispatchNo, cp.campus_name AS campusName, bc.title,
           i.qty_dispatched AS qtyDispatched
    FROM CampusReceivingItems i
    JOIN CampusReceivings r ON r.id = i.receiving_id
    JOIN WarehouseDispatches d ON d.id = r.dispatch_id
    JOIN Campuses cp ON cp.id = r.campus_id
    JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE i.verified = 0
    ORDER BY bc.title
  `);
  const stockDifference = await pool.request().query(`
    SELECT TOP 50 d.dispatch_no AS dispatchNo, cp.campus_name AS campusName, bc.title,
           i.qty_dispatched AS qtyDispatched, i.qty_received AS qtyReceived,
           (i.qty_dispatched - COALESCE(i.qty_received, 0)) AS difference
    FROM CampusReceivingItems i
    JOIN CampusReceivings r ON r.id = i.receiving_id
    JOIN WarehouseDispatches d ON d.id = r.dispatch_id
    JOIN Campuses cp ON cp.id = r.campus_id
    JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE i.verified = 1 AND i.qty_dispatched <> i.qty_received
    ORDER BY bc.title
  `);
  const lowExcess = await pool.request().query(`
    SELECT TOP 50 cp.region, cp.campus_name AS campusName, cl.class_name AS className, bc.title,
           b.on_hand AS onHand,
           CASE WHEN b.on_hand <= 5 THEN 'low' ELSE 'excess' END AS flag
    FROM CourseClassBalances b
    JOIN Campuses cp ON cp.id = b.campus_id
    JOIN Classes cl ON cl.id = b.class_id
    JOIN BookCatalog bc ON bc.id = b.book_id
    WHERE b.on_hand <= 5 OR b.on_hand > 20
    ORDER BY bc.title
  `);
  const poVsDispatch = await pool.request().query(`
    SELECT TOP 50 po.order_no AS orderNo, bc.title, cp.campus_name AS campusName,
           i.quantity AS orderedQty, COALESCE(SUM(di.qty_dispatched), 0) AS dispatchedQty,
           i.quantity - COALESCE(SUM(di.qty_dispatched), 0) AS difference
    FROM CoursePurchaseOrderItems i
    JOIN CoursePurchaseOrders po ON po.id = i.po_id
    JOIN BookCatalog bc ON bc.id = i.book_id
    JOIN Campuses cp ON cp.id = i.campus_id
    LEFT JOIN WarehouseDispatchItems di ON di.po_item_id = i.id
    GROUP BY po.order_no, bc.title, cp.campus_name, i.quantity
    HAVING i.quantity <> COALESCE(SUM(di.qty_dispatched), 0)
    ORDER BY bc.title
  `);
  const receivingVsInventory = await pool.request().query(`
    SELECT TOP 50 cp.campus_name AS campusName, bc.title,
           COALESCE(SUM(ri.qty_received), 0) AS receivedQty,
           COALESCE(MAX(led.qty), 0) AS ledgerQty,
           COALESCE(SUM(ri.qty_received), 0) - COALESCE(MAX(led.qty), 0) AS difference
    FROM CampusReceivingItems ri
    JOIN CampusReceivings r ON r.id = ri.receiving_id AND ri.verified = 1
    JOIN Campuses cp ON cp.id = r.campus_id
    JOIN BookCatalog bc ON bc.id = ri.book_id
    LEFT JOIN (
      SELECT campus_id, book_id, SUM(qty_delta) AS qty
      FROM BookInventoryLedger
      WHERE txn_type = 'campus_receive'
      GROUP BY campus_id, book_id
    ) led ON led.campus_id = r.campus_id AND led.book_id = ri.book_id
    GROUP BY cp.campus_name, bc.title, led.qty
    HAVING COALESCE(SUM(ri.qty_received), 0) <> COALESCE(MAX(led.qty), 0)
  `);
  const projectionVsSale = await pool.request().query(`
    SELECT TOP 50 cp.campus_name AS campusName, cl.class_name AS className, bc.title,
           p.quantity AS projectionQty, COALESCE(SUM(vi.quantity), 0) AS issuedQty,
           p.quantity - COALESCE(SUM(vi.quantity), 0) AS difference
    FROM CourseProjections p
    JOIN Campuses cp ON cp.id = p.campus_id
    JOIN Classes cl ON cl.id = p.class_id
    JOIN BookCatalog bc ON bc.id = p.book_id
    LEFT JOIN CourseVouchers v
      ON v.campus_id = p.campus_id AND v.class_id = p.class_id
     AND v.academic_session = p.academic_session AND v.issue_status = 'issued'
    LEFT JOIN CourseVoucherItems vi ON vi.voucher_id = v.id AND vi.book_id = p.book_id
    GROUP BY cp.campus_name, cl.class_name, bc.title, p.quantity
    HAVING p.quantity <> COALESCE(SUM(vi.quantity), 0)
    ORDER BY bc.title
  `);
  return {
    paidNotIssued: paidNotIssued.recordset,
    receivingPending: receivingPending.recordset,
    stockDifference: stockDifference.recordset,
    lowExcess: lowExcess.recordset,
    poVsDispatch: poVsDispatch.recordset,
    receivingVsInventory: receivingVsInventory.recordset,
    projectionVsSale: projectionVsSale.recordset,
  };
}

export async function reportInventory(pool: ConnectionPool) {
  return listClassInventory(pool);
}

export async function reportSales(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT cp.campus_name AS campusName, cp.region, cl.class_name AS className, bc.title,
           v.class_id, vi.book_id,
           SUM(vi.quantity) AS quantity,
           SUM(vi.line_total) AS amount,
           SUM(CASE WHEN v.payment_status = 'paid' THEN vi.line_total ELSE 0 END) AS collected,
           SUM(CASE WHEN v.payment_status = 'paid' THEN 1 ELSE 0 END) AS paidLines,
           SUM(CASE WHEN v.payment_status <> 'paid' THEN 1 ELSE 0 END) AS unpaidLines
    FROM CourseVoucherItems vi
    JOIN CourseVouchers v ON v.id = vi.voucher_id AND v.status = 'open'
    JOIN Campuses cp ON cp.id = v.campus_id
    JOIN Classes cl ON cl.id = v.class_id
    JOIN BookCatalog bc ON bc.id = vi.book_id
    GROUP BY cp.region, cp.campus_name, cl.class_name, bc.title, v.class_id, vi.book_id
  `);
  return sortByCourseMaster(pool, rows.recordset);
}

export async function reportIssuance(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT v.voucher_no AS voucherNo, s.student_name AS studentName, s.admission_no AS admissionNo,
           cl.class_name AS className, cp.campus_name AS campusName, bc.title, vi.quantity, vi.line_total AS amount,
           v.class_id, vi.book_id,
           v.payment_status AS paymentStatus, v.issue_status AS issueStatus, ci.issued_at AS issueDate,
           COALESCE(u.username, ci.issued_by) AS issuedBy
    FROM CourseVoucherItems vi
    JOIN CourseVouchers v ON v.id = vi.voucher_id
    JOIN Students s ON s.id = v.student_id
    JOIN Classes cl ON cl.id = v.class_id
    JOIN Campuses cp ON cp.id = v.campus_id
    JOIN BookCatalog bc ON bc.id = vi.book_id
    LEFT JOIN CourseIssues ci ON ci.voucher_id = v.id
    LEFT JOIN Users u ON u.id = ci.issued_by
  `);
  return sortByCourseMaster(pool, rows.recordset);
}

export async function reportProjection(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT cp.region, cp.campus_name AS campusName, cl.class_name AS className, bc.title,
           p.quantity AS projectionQty,
           COALESCE(rec.qty, 0) AS receivedQty,
           COALESCE(iss.qty, 0) AS issuedQty,
           COALESCE(bal.on_hand, 0) AS availableQty
    FROM CourseProjections p
    JOIN Campuses cp ON cp.id = p.campus_id
    JOIN Classes cl ON cl.id = p.class_id
    JOIN BookCatalog bc ON bc.id = p.book_id
    LEFT JOIN CourseClassBalances bal
      ON bal.campus_id = p.campus_id AND bal.class_id = p.class_id AND bal.book_id = p.book_id
    LEFT JOIN (
      SELECT r.campus_id, i.class_id, i.book_id, SUM(i.qty_received) AS qty
      FROM CampusReceivingItems i
      JOIN CampusReceivings r ON r.id = i.receiving_id
      WHERE i.verified = 1
      GROUP BY r.campus_id, i.class_id, i.book_id
    ) rec ON rec.campus_id = p.campus_id AND rec.class_id = p.class_id AND rec.book_id = p.book_id
    LEFT JOIN (
      SELECT v.campus_id, v.class_id, vi.book_id, SUM(vi.quantity) AS qty
      FROM CourseVoucherItems vi
      JOIN CourseVouchers v ON v.id = vi.voucher_id AND v.issue_status = 'issued'
      GROUP BY v.campus_id, v.class_id, vi.book_id
    ) iss ON iss.campus_id = p.campus_id AND iss.class_id = p.class_id AND iss.book_id = p.book_id
    ORDER BY cp.region, cp.campus_name, cl.class_name, bc.title
  `);
  return rows.recordset;
}

export async function reportTransfers(pool: ConnectionPool) {
  const rows = await pool.request().query(`
    SELECT t.id, fs.name AS sourceStore, ts.name AS receivingStore, t.reason, t.status,
           t.created_by AS requestedBy, t.approved_by AS approvedBy,
           t.dispatched_at AS dispatchedAt, t.received_at AS receivedAt,
           bc.title, i.class_id AS classId, i.qty_requested AS qtyRequested,
           i.qty_dispatched AS qtyDispatched, i.qty_received AS qtyReceived,
           (i.qty_dispatched - i.qty_received) AS difference
    FROM BookStockTransfers t
    JOIN BookStockTransferItems i ON i.transfer_id = t.id
    JOIN BookCatalog bc ON bc.id = i.book_id
    JOIN BookstoreStores fs ON fs.id = t.from_store_id
    JOIN BookstoreStores ts ON ts.id = t.to_store_id
    ORDER BY t.created_at DESC, bc.title
  `);
  return rows.recordset;
}
