import type { ConnectionPool, Transaction } from "mssql";
import crypto from "crypto";
import sql from "mssql";
import { nextSequence } from "./ledger.js";
import { BookPricingError, assertValidSessionLabel, resolveBookPricesForSession } from "./pricing.js";
import {
  consumeReservationAndIssue,
  createStockReservation,
  expireStaleReservations,
  releaseStockReservation,
} from "./reservations.js";

export type SaleLineInput = { bookId: string; quantity: number; packId?: string | null };

export async function resolveStudentForSale(
  pool: ConnectionPool,
  studentId: string
): Promise<{
  id: string;
  campusId: string;
  classId: string;
  academicSession: string;
  status: string;
  studentName: string;
  rollNumber: string;
  className: string | null;
  campusName: string | null;
}> {
  const r = await pool.request().input("id", studentId).query(`
    SELECT s.id, s.campus_id AS campusId, s.class_id AS classId, s.status,
           s.session AS studentSession, s.student_name AS studentName, s.admission_no AS rollNumber,
           cl.class_name AS className, cp.campus_name AS campusName
    FROM Students s
    LEFT JOIN Classes cl ON cl.id = s.class_id
    LEFT JOIN Campuses cp ON cp.id = s.campus_id
    WHERE s.id = @id
  `);
  const row = r.recordset[0];
  if (!row) throw new Error("Student not found");
  if (String(row.status) !== "Active") {
    throw new Error("Student is not active and cannot purchase books");
  }
  let session = String(row.studentSession || "").trim();
  if (!/^\d{4}-\d{4}$/.test(session)) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    session = month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }
  return {
    id: String(row.id),
    campusId: String(row.campusId),
    classId: String(row.classId),
    academicSession: session,
    status: String(row.status),
    studentName: String(row.studentName || ""),
    rollNumber: String(row.rollNumber || ""),
    className: row.className ? String(row.className) : null,
    campusName: row.campusName ? String(row.campusName) : null,
  };
}

export async function expandPackLines(
  pool: ConnectionPool,
  packId: string,
  student: { campusId: string; classId: string }
): Promise<{ packId: string; packDiscount: number; lines: SaleLineInput[] }> {
  const pack = await pool.request().input("id", packId).query(`SELECT * FROM BookPacks WHERE id = @id AND is_active = 1`);
  const p = pack.recordset[0];
  if (!p) throw new Error("Book pack not found");
  if (String(p.campus_id) !== student.campusId || String(p.class_id) !== student.classId) {
    throw new Error("Pack is not eligible for this student's campus and class");
  }
  const items = await pool.request().input("packId", packId).query(`
    SELECT book_id, quantity FROM BookPackItems WHERE pack_id = @packId
  `);
  if (items.recordset.length === 0) throw new Error("Pack has no items");
  const lines: SaleLineInput[] = items.recordset.map((it: { book_id: string; quantity: number }) => ({
    bookId: String(it.book_id),
    quantity: Number(it.quantity),
    packId,
  }));
  return { packId, packDiscount: Number(p.pack_discount) || 0, lines };
}

export async function buildPricedLines(
  pool: ConnectionPool,
  academicSession: string,
  lines: SaleLineInput[]
): Promise<
  Array<{
    bookId: string;
    packId: string | null;
    quantity: number;
    unitPrice: number;
    unitCost: number;
    lineTotal: number;
  }>
> {
  const session = assertValidSessionLabel(academicSession);
  const bookIds = lines.map((l) => l.bookId);
  const prices = await resolveBookPricesForSession(pool, session, bookIds);
  return lines.map((l) => {
    const p = prices.get(l.bookId)!;
    const unitPrice = p.sellingPrice;
    const unitCost = p.purchaseCost;
    const lineTotal = unitPrice * l.quantity;
    return {
      bookId: l.bookId,
      packId: l.packId ?? null,
      quantity: l.quantity,
      unitPrice,
      unitCost,
      lineTotal,
    };
  });
}

export async function assertNoDuplicatePackSale(
  pool: ConnectionPool,
  studentId: string,
  packId: string,
  academicSession: string
): Promise<void> {
  const dup = await pool.request()
    .input("studentId", studentId)
    .input("packId", packId)
    .input("session", academicSession)
    .query(`
      SELECT TOP 1 bs.id FROM BookSales bs
      INNER JOIN BookSaleItems si ON si.sale_id = bs.id
      WHERE bs.student_id = @studentId AND bs.status = 'posted'
        AND bs.academic_session = @session AND si.pack_id = @packId
    `);
  if (dup.recordset.length > 0) {
    throw new Error("This student already purchased this class pack for the academic session");
  }
}

async function insertLedgerSaleIssue(
  t: Transaction,
  opts: {
    storeId: string;
    bookId: string;
    campusId: string;
    qty: number;
    unitCost: number;
    saleId: string;
    performedBy: string;
  }
) {
  await t.request()
    .input("id", crypto.randomUUID())
    .input("storeId", opts.storeId)
    .input("bookId", opts.bookId)
    .input("campusId", opts.campusId)
    .input("qty", -opts.qty)
    .input("unitCost", opts.unitCost)
    .input("saleId", opts.saleId)
    .input("by", opts.performedBy)
    .query(`
      INSERT INTO BookInventoryLedger (
        id, store_id, book_id, campus_id, txn_type, qty_delta, unit_cost,
        doc_type, doc_id, reason, performed_by, created_at
      ) VALUES (
        @id, @storeId, @bookId, @campusId, 'sale', @qty, @unitCost,
        'book_sale', @saleId, NULL, @by, SYSUTCDATETIME()
      )
    `);
}

export async function executeBookSale(
  pool: ConnectionPool,
  input: {
    studentId: string;
    storeId: string;
    campusId: string;
    academicSession?: string;
    packId?: string | null;
    items?: SaleLineInput[];
    discount?: number;
    payment?: { amount?: number; method?: string; transactionRef?: string };
    reservationId?: string | null;
    idempotencyKey?: string | null;
    allowDiscount?: boolean;
    performedBy: string;
  }
): Promise<{ id: string; invoiceNo: string; total: number; paidAmount: number; paymentStatus: string }> {
  await expireStaleReservations(pool);

  if (input.idempotencyKey) {
    const dup = await pool.request().input("k", input.idempotencyKey).query(`
      SELECT id, invoice_no AS invoiceNo, total, paid_amount AS paidAmount, payment_status AS paymentStatus
      FROM BookSales WHERE idempotency_key = @k
    `);
    if (dup.recordset[0]) {
      const d = dup.recordset[0];
      return {
        id: String(d.id),
        invoiceNo: String(d.invoiceNo),
        total: Number(d.total),
        paidAmount: Number(d.paidAmount),
        paymentStatus: String(d.paymentStatus),
      };
    }
  }

  const student = await resolveStudentForSale(pool, input.studentId);
  if (String(student.campusId) !== String(input.campusId)) {
    throw new Error("Campus does not match student record");
  }

  const session = assertValidSessionLabel(input.academicSession || student.academicSession);

  let packDiscountMax = 0;
  let rawLines: SaleLineInput[];

  if (input.packId) {
    const expanded = await expandPackLines(pool, input.packId, student);
    await assertNoDuplicatePackSale(pool, student.id, input.packId, session);
    packDiscountMax = expanded.packDiscount;
    rawLines = expanded.lines;
  } else if (Array.isArray(input.items) && input.items.length > 0) {
    rawLines = input.items.map((it) => ({
      bookId: String(it.bookId),
      quantity: Number(it.quantity),
      packId: it.packId ?? null,
    }));
  } else {
    throw new Error("packId or items required");
  }

  const pricedLines = await buildPricedLines(pool, session, rawLines);
  const subtotal = pricedLines.reduce((s, l) => s + l.lineTotal, 0);

  let discountAmt = Math.max(0, Number(input.discount) || 0);
  if (discountAmt > 0 && !input.allowDiscount) {
    throw new Error("Discount not permitted for this user");
  }
  const maxDiscount = input.packId ? packDiscountMax : subtotal;
  discountAmt = Math.min(subtotal, discountAmt, maxDiscount);
  const total = subtotal - discountAmt;
  const payAmt = Math.min(total, Math.max(0, Number(input.payment?.amount) ?? total));
  const paymentStatus = payAmt >= total - 0.009 ? "paid" : payAmt > 0 ? "partial" : "unpaid";

  const saleId = crypto.randomUUID();
  const year = new Date().getUTCFullYear();
  const seq = await nextSequence(pool, `invoice-${year}`);
  const invoiceNo = `BK-${year}-${String(seq).padStart(6, "0")}`;

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const costs = await consumeReservationAndIssue(
      tx,
      input.storeId,
      input.reservationId || null,
      pricedLines.map((l) => ({ bookId: l.bookId, quantity: l.quantity }))
    );

    await tx.request()
      .input("id", saleId)
      .input("invoiceNo", invoiceNo)
      .input("studentId", student.id)
      .input("campusId", student.campusId)
      .input("storeId", input.storeId)
      .input("session", session)
      .input("subtotal", subtotal)
      .input("discount", discountAmt)
      .input("total", total)
      .input("paid", payAmt)
      .input("paymentStatus", paymentStatus)
      .input("createdBy", input.performedBy)
      .input("idempotencyKey", input.idempotencyKey || null)
      .input("reservationId", input.reservationId || null)
      .query(`
        INSERT INTO BookSales (
          id, invoice_no, student_id, campus_id, store_id, academic_session,
          status, subtotal, discount, total, paid_amount, payment_status, created_by, idempotency_key, reservation_id
        ) VALUES (
          @id, @invoiceNo, @studentId, @campusId, @storeId, @session,
          'posted', @subtotal, @discount, @total, @paid, @paymentStatus, @createdBy, @idempotencyKey, @reservationId
        )
      `);

    for (const line of pricedLines) {
      const unitCost = costs.get(line.bookId) ?? line.unitCost;
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("saleId", saleId)
        .input("bookId", line.bookId)
        .input("packId", line.packId)
        .input("qty", line.quantity)
        .input("unitPrice", line.unitPrice)
        .input("unitCost", unitCost)
        .input("lineTotal", line.lineTotal)
        .input("session", session)
        .query(`
          INSERT INTO BookSaleItems (id, sale_id, book_id, pack_id, quantity, unit_price, unit_cost, line_total, academic_session)
          VALUES (@id, @saleId, @bookId, @packId, @qty, @unitPrice, @unitCost, @lineTotal, @session)
        `);
      await insertLedgerSaleIssue(tx, {
        storeId: input.storeId,
        bookId: line.bookId,
        campusId: student.campusId,
        qty: line.quantity,
        unitCost,
        saleId,
        performedBy: input.performedBy,
      });
    }

    if (payAmt > 0) {
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("saleId", saleId)
        .input("amount", payAmt)
        .input("method", input.payment?.method || "Cash")
        .input("ref", input.payment?.transactionRef || null)
        .input("by", input.performedBy)
        .query(`
          INSERT INTO BookSalePayments (id, sale_id, amount, payment_method, transaction_ref, recorded_by)
          VALUES (@id, @saleId, @amount, @method, @ref, @by)
        `);
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  return { id: saleId, invoiceNo, total, paidAmount: payAmt, paymentStatus };
}

export async function quotePackForStore(
  pool: ConnectionPool,
  opts: { packId: string; studentId: string; storeId: string; academicSession?: string }
) {
  const student = await resolveStudentForSale(pool, opts.studentId);
  const session = assertValidSessionLabel(opts.academicSession || student.academicSession);
  const { packDiscount, lines } = await expandPackLines(pool, opts.packId, student);
  const priced = await buildPricedLines(pool, session, lines);
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);

  const stockRows = await pool.request().input("storeId", opts.storeId).query(`
    SELECT book_id AS bookId, on_hand AS onHand, reserved FROM BookInventoryBalances WHERE store_id = @storeId
  `);
  const stockMap = new Map<string, { onHand: number; reserved: number }>();
  for (const r of stockRows.recordset) {
    stockMap.set(String(r.bookId), { onHand: Number(r.onHand), reserved: Number(r.reserved) });
  }

  const titles = await pool.request().query(`SELECT id, title FROM BookCatalog WHERE is_active = 1`);
  const titleMap = new Map(titles.recordset.map((t: { id: string; title: string }) => [String(t.id), String(t.title)]));

  const items = priced.map((l) => {
    const st = stockMap.get(l.bookId) || { onHand: 0, reserved: 0 };
    const available = Math.max(0, st.onHand - st.reserved);
    return {
      ...l,
      title: titleMap.get(l.bookId) || l.bookId,
      available,
      sufficient: available >= l.quantity,
    };
  });

  return {
    student,
    academicSession: session,
    packId: opts.packId,
    packDiscount,
    subtotal,
    totalAfterPackDiscount: Math.max(0, subtotal - packDiscount),
    allInStock: items.every((i) => i.sufficient),
    items,
  };
}

export async function computeEnrollmentDemand(
  pool: ConnectionPool,
  opts: { campusId: string; classId: string; academicSession: string; packId: string }
) {
  assertValidSessionLabel(opts.academicSession);
  const enrolled = await pool.request()
    .input("campusId", opts.campusId)
    .input("classId", opts.classId)
    .query(`
      SELECT COUNT(*) AS cnt FROM Students
      WHERE campus_id = @campusId AND class_id = @classId AND status = 'Active'
    `);
  const headcount = Number(enrolled.recordset[0]?.cnt || 0);

  const pack = await pool.request().input("id", opts.packId).query(`
    SELECT campus_id, class_id, academic_session FROM BookPacks WHERE id = @id
  `);
  const p = pack.recordset[0];
  if (!p) throw new Error("Pack not found");
  if (String(p.campus_id) !== opts.campusId || String(p.class_id) !== opts.classId) {
    throw new Error("Pack campus/class mismatch");
  }

  const items = await pool.request().input("packId", opts.packId).query(`
    SELECT i.book_id AS bookId, i.quantity AS qtyPerStudent, bc.title
    FROM BookPackItems i
    JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE i.pack_id = @packId
  `);

  const store = await pool.request().input("campusId", opts.campusId).query(`
    SELECT TOP 1 id FROM BookstoreStores WHERE campus_id = @campusId AND store_type = 'campus'
  `);
  const storeId = store.recordset[0]?.id as string | undefined;

  let balances: Array<{ bookId: string; onHand: number; reserved: number }> = [];
  if (storeId) {
    const bal = await pool.request().input("storeId", storeId).query(`
      SELECT book_id AS bookId, on_hand AS onHand, reserved FROM BookInventoryBalances WHERE store_id = @storeId
    `);
    balances = bal.recordset;
  }
  const balMap = new Map(balances.map((b) => [b.bookId, b]));

  const books = items.recordset.map((it: { bookId: string; qtyPerStudent: number; title: string }) => {
    const required = headcount * Number(it.qtyPerStudent);
    const b = balMap.get(String(it.bookId));
    const available = b ? Math.max(0, b.onHand - b.reserved) : 0;
    return {
      bookId: String(it.bookId),
      title: String(it.title),
      qtyPerStudent: Number(it.qtyPerStudent),
      requiredQuantity: required,
      availableStock: available,
      shortage: Math.max(0, required - available),
    };
  });

  return {
    campusId: opts.campusId,
    classId: opts.classId,
    academicSession: opts.academicSession,
    packId: opts.packId,
    activeEnrollment: headcount,
    storeId: storeId ?? null,
    books,
  };
}

export { createStockReservation, releaseStockReservation };
