import type { ConnectionPool, Transaction } from "mssql";
import crypto from "crypto";
import sql from "mssql";
import { postInventoryMovement } from "./ledger.js";

export class BookstoreFlowError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ReturnLineInput = { saleItemId: string; quantity: number; condition?: string };

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadSaleForUpdate(tx: Transaction, saleId: string) {
  const sale = await tx.request().input("id", saleId).query(`
    SELECT * FROM BookSales WITH (UPDLOCK, ROWLOCK) WHERE id = @id
  `);
  const row = sale.recordset[0];
  if (!row) throw new BookstoreFlowError(404, "SALE_NOT_FOUND", "Sale not found");
  return row as Record<string, unknown>;
}

async function returnedQtyByItem(tx: Transaction, saleId: string, excludeReturnId?: string) {
  const req = tx.request().input("saleId", saleId);
  let extra = "";
  if (excludeReturnId) {
    req.input("excludeId", excludeReturnId);
    extra = " AND r.id <> @excludeId";
  }
  const rows = await req.query(`
    SELECT i.sale_item_id AS saleItemId, COALESCE(SUM(i.quantity), 0) AS qty
    FROM BookReturnItems i
    JOIN BookReturns r ON r.id = i.return_id
    WHERE r.sale_id = @saleId AND r.status <> 'cancelled' ${extra}
    GROUP BY i.sale_item_id
  `);
  const map = new Map<string, number>();
  for (const r of rows.recordset) map.set(String(r.saleItemId), Number(r.qty));
  return map;
}

export async function getSaleDetail(pool: ConnectionPool, saleId: string) {
  const sale = await pool.request().input("id", saleId).query(`
    SELECT bs.*, s.student_name AS studentName, s.admission_no AS rollNumber,
           c.campus_name AS campusName, st.name AS storeName
    FROM BookSales bs
    JOIN Students s ON s.id = bs.student_id
    LEFT JOIN Campuses c ON c.id = bs.campus_id
    LEFT JOIN BookstoreStores st ON st.id = bs.store_id
    WHERE bs.id = @id
  `);
  const header = sale.recordset[0];
  if (!header) throw new BookstoreFlowError(404, "SALE_NOT_FOUND", "Sale not found");
  const items = await pool.request().input("id", saleId).query(`
    SELECT si.*, bc.title
    FROM BookSaleItems si
    JOIN BookCatalog bc ON bc.id = si.book_id
    WHERE si.sale_id = @id
  `);
  const payments = await pool.request().input("id", saleId).query(`
    SELECT * FROM BookSalePayments WHERE sale_id = @id ORDER BY paid_at
  `);
  const returns = await pool.request().input("id", saleId).query(`
    SELECT r.*, i.id AS itemId, i.sale_item_id, i.book_id, i.quantity AS returnQty,
           i.condition_code, i.restock_qty, bc.title
    FROM BookReturns r
    LEFT JOIN BookReturnItems i ON i.return_id = r.id
    LEFT JOIN BookCatalog bc ON bc.id = i.book_id
    WHERE r.sale_id = @id
    ORDER BY r.created_at
  `);
  const refunds = await pool.request().input("id", saleId).query(`
    SELECT * FROM BookRefunds WHERE sale_id = @id ORDER BY created_at
  `);
  const paid = Number(header.paid_amount || 0);
  const completedRefunds = refunds.recordset
    .filter((r: { status: string }) => r.status === "completed")
    .reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
  const openRefunds = refunds.recordset
    .filter((r: { status: string }) => r.status === "requested")
    .reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
  return {
    sale: header,
    items: items.recordset,
    payments: payments.recordset,
    returns: returns.recordset,
    refunds: refunds.recordset,
    refundableBalance: money(Math.max(0, paid - completedRefunds - openRefunds)),
    completedRefunds: money(completedRefunds),
    outstanding: money(Math.max(0, Number(header.total || 0) - paid)),
  };
}

export async function createBookReturn(
  pool: ConnectionPool,
  input: {
    saleId: string;
    lines: ReturnLineInput[];
    reason: string;
    idempotencyKey?: string | null;
    performedBy: string;
  }
) {
  if (input.idempotencyKey) {
    const existing = await pool.request().input("k", input.idempotencyKey).query(`
      SELECT id, status, return_no AS returnNo FROM BookReturns WHERE idempotency_key = @k
    `);
    if (existing.recordset[0]) return existing.recordset[0];
  }
  if (!input.lines?.length) throw new BookstoreFlowError(400, "NO_LINES", "At least one return line is required");

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const sale = await loadSaleForUpdate(tx, input.saleId);
    if (String(sale.status) !== "posted") {
      throw new BookstoreFlowError(409, "SALE_NOT_RETURNABLE", "Only posted sales can be returned");
    }
    const saleItems = await tx.request().input("saleId", input.saleId).query(`
      SELECT * FROM BookSaleItems WITH (UPDLOCK, ROWLOCK) WHERE sale_id = @saleId
    `);
    const byId = new Map(saleItems.recordset.map((r: { id: string }) => [String(r.id), r]));
    const used = await returnedQtyByItem(tx, input.saleId);
    const returnId = crypto.randomUUID();
    const returnNo = `BR-${Date.now()}`;
    await tx.request()
      .input("id", returnId)
      .input("saleId", input.saleId)
      .input("reason", input.reason || null)
      .input("by", input.performedBy)
      .input("key", input.idempotencyKey || null)
      .input("returnNo", returnNo)
      .input("storeId", sale.store_id)
      .input("campusId", sale.campus_id)
      .query(`
        INSERT INTO BookReturns (
          id, sale_id, status, reason, refund_amount, restock_approved, created_by, idempotency_key,
          return_no, store_id, campus_id
        ) VALUES (
          @id, @saleId, 'draft', @reason, 0, 0, @by, @key, @returnNo, @storeId, @campusId
        )
      `);

    for (const line of input.lines) {
      const qty = Number(line.quantity);
      if (!(qty > 0)) throw new BookstoreFlowError(400, "BAD_QTY", "Return quantity must be greater than zero");
      const sold = byId.get(String(line.saleItemId)) as { id: string; book_id: string; quantity: number } | undefined;
      if (!sold) throw new BookstoreFlowError(400, "BAD_LINE", "Sale line does not belong to this sale");
      const already = used.get(String(sold.id)) || 0;
      if (already + qty > Number(sold.quantity) + 0.0001) {
        throw new BookstoreFlowError(409, "QTY_EXCEEDS_SALE", "Return quantity exceeds the unreturned quantity");
      }
      const condition = line.condition === "damaged" ? "damaged" : "good";
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("returnId", returnId)
        .input("saleItemId", sold.id)
        .input("bookId", sold.book_id)
        .input("qty", qty)
        .input("condition", condition)
        .query(`
          INSERT INTO BookReturnItems (id, return_id, sale_item_id, book_id, quantity, condition_code, restock_qty)
          VALUES (@id, @returnId, @saleItemId, @bookId, @qty, @condition, 0)
        `);
    }
    await tx.commit();
    return { id: returnId, status: "draft", returnNo };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function setReturnStatus(
  pool: ConnectionPool,
  returnId: string,
  from: string[],
  to: string,
  extraSql: string,
  userId: string
) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const row = await tx.request().input("id", returnId).query(`
      SELECT id, status FROM BookReturns WITH (UPDLOCK, ROWLOCK) WHERE id = @id
    `);
    const current = row.recordset[0];
    if (!current) throw new BookstoreFlowError(404, "RETURN_NOT_FOUND", "Return not found");
    if (String(current.status) === to) {
      await tx.commit();
      return { id: returnId, status: to };
    }
    if (!from.includes(String(current.status))) {
      throw new BookstoreFlowError(409, "BAD_STATUS", `Return cannot move from ${current.status} to ${to}`);
    }
    await tx.request().input("id", returnId).input("by", userId).query(`
      UPDATE BookReturns SET status = '${to}' ${extraSql} WHERE id = @id
    `);
    await tx.commit();
    return { id: returnId, status: to };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export function submitBookReturn(pool: ConnectionPool, returnId: string, userId: string) {
  return setReturnStatus(pool, returnId, ["draft"], "submitted", ", submitted_at = SYSUTCDATETIME()", userId);
}

export function approveBookReturn(pool: ConnectionPool, returnId: string, userId: string) {
  return setReturnStatus(
    pool,
    returnId,
    ["submitted"],
    "approved",
    ", approved_by = @by, approved_at = SYSUTCDATETIME()",
    userId
  );
}

export async function postBookReturn(pool: ConnectionPool, returnId: string, userId: string) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const ret = await tx.request().input("id", returnId).query(`
      SELECT * FROM BookReturns WITH (UPDLOCK, ROWLOCK) WHERE id = @id
    `);
    const header = ret.recordset[0];
    if (!header) throw new BookstoreFlowError(404, "RETURN_NOT_FOUND", "Return not found");
    if (String(header.status) === "posted") {
      await tx.commit();
      return { id: returnId, status: "posted", idempotent: true };
    }
    if (String(header.status) !== "approved") {
      throw new BookstoreFlowError(409, "NOT_APPROVED", "Approve the return before posting");
    }
    const sale = await loadSaleForUpdate(tx, String(header.sale_id));
    if (String(sale.status) !== "posted") {
      throw new BookstoreFlowError(409, "SALE_NOT_RETURNABLE", "Sale is not eligible for posting a return");
    }
    const lines = await tx.request().input("id", returnId).query(`
      SELECT i.*, si.quantity AS soldQty, si.unit_cost AS unitCost
      FROM BookReturnItems i
      JOIN BookSaleItems si ON si.id = i.sale_item_id
      WHERE i.return_id = @id
    `);
    const used = await returnedQtyByItem(tx, String(header.sale_id), returnId);
    let anyRestock = false;
    for (const line of lines.recordset) {
      const qty = Number(line.quantity);
      const already = used.get(String(line.sale_item_id)) || 0;
      if (already + qty > Number(line.soldQty) + 0.0001) {
        throw new BookstoreFlowError(409, "QTY_EXCEEDS_SALE", "Return quantity exceeds the unreturned quantity");
      }
      const damaged = String(line.condition_code) === "damaged";
      const restock = damaged ? 0 : qty;
      if (restock > 0) anyRestock = true;
      await tx.request()
        .input("id", line.id)
        .input("restock", restock)
        .query(`UPDATE BookReturnItems SET restock_qty = @restock WHERE id = @id`);
      if (restock > 0) {
        await postInventoryMovement(pool, {
          storeId: String(sale.store_id),
          bookId: String(line.book_id),
          campusId: String(sale.campus_id),
          txnType: "return_restock",
          qtyDelta: restock,
          unitCost: Number(line.unitCost) || 0,
          docType: "book_return",
          docId: returnId,
          reason: "Restock sellable return",
          performedBy: userId,
        }, tx);
      }
      if (damaged) {
        await postInventoryMovement(pool, {
          storeId: String(sale.store_id),
          bookId: String(line.book_id),
          campusId: String(sale.campus_id),
          txnType: "return_damaged",
          qtyDelta: qty,
          unitCost: Number(line.unitCost) || 0,
          docType: "book_return",
          docId: returnId,
          reason: "Damaged return — not sellable",
          performedBy: userId,
          affectOnHand: false,
          damagedDelta: qty,
        }, tx);
      }
    }
    await tx.request()
      .input("id", returnId)
      .input("by", userId)
      .input("restock", anyRestock ? 1 : 0)
      .query(`
        UPDATE BookReturns
        SET status = 'posted', posted_at = SYSUTCDATETIME(), posted_by = @by, restock_approved = @restock
        WHERE id = @id
      `);
    await tx.commit();
    return { id: returnId, status: "posted", idempotent: false };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function createRefund(
  pool: ConnectionPool,
  input: {
    saleId: string;
    returnId?: string | null;
    amount: number;
    method: string;
    idempotencyKey?: string | null;
    performedBy: string;
  }
) {
  const amount = money(Number(input.amount));
  if (!(amount > 0)) throw new BookstoreFlowError(400, "BAD_AMOUNT", "Refund amount must be greater than zero");
  if (input.idempotencyKey) {
    const existing = await pool.request().input("k", input.idempotencyKey).query(`
      SELECT id, status, amount FROM BookRefunds WHERE idempotency_key = @k
    `);
    if (existing.recordset[0]) return existing.recordset[0];
  }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const sale = await loadSaleForUpdate(tx, input.saleId);
    if (String(sale.status) === "cancelled" && Number(sale.paid_amount) <= 0) {
      throw new BookstoreFlowError(409, "NOT_REFUNDABLE", "This sale has no payment to refund");
    }
    if (input.returnId) {
      const ret = await tx.request().input("id", input.returnId).input("saleId", input.saleId).query(`
        SELECT id FROM BookReturns WHERE id = @id AND sale_id = @saleId
      `);
      if (!ret.recordset[0]) throw new BookstoreFlowError(400, "BAD_RETURN", "Return does not belong to this sale");
    }
    const sums = await tx.request().input("saleId", input.saleId).query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('requested', 'completed') THEN amount ELSE 0 END), 0) AS reservedAmt
      FROM BookRefunds WITH (UPDLOCK, ROWLOCK) WHERE sale_id = @saleId
    `);
    const reserved = Number(sums.recordset[0]?.reservedAmt || 0);
    const paid = Number(sale.paid_amount || 0);
    if (reserved + amount > paid + 0.009) {
      throw new BookstoreFlowError(409, "REFUND_EXCEEDS_BALANCE", "Refund exceeds the refundable balance");
    }
    const id = crypto.randomUUID();
    await tx.request()
      .input("id", id)
      .input("saleId", input.saleId)
      .input("returnId", input.returnId || null)
      .input("amount", amount)
      .input("method", input.method || "Cash")
      .input("key", input.idempotencyKey || null)
      .input("by", input.performedBy)
      .query(`
        INSERT INTO BookRefunds (id, sale_id, return_id, amount, payment_method, status, idempotency_key, created_by)
        VALUES (@id, @saleId, @returnId, @amount, @method, 'requested', @key, @by)
      `);
    await tx.commit();
    return { id, status: "requested", amount };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function completeRefund(
  pool: ConnectionPool,
  refundId: string,
  reference: string | null,
  userId: string
) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const row = await tx.request().input("id", refundId).query(`
      SELECT * FROM BookRefunds WITH (UPDLOCK, ROWLOCK) WHERE id = @id
    `);
    const refund = row.recordset[0];
    if (!refund) throw new BookstoreFlowError(404, "REFUND_NOT_FOUND", "Refund not found");
    if (String(refund.status) === "completed") {
      await tx.commit();
      return { id: refundId, status: "completed", idempotent: true };
    }
    if (String(refund.status) !== "requested") {
      throw new BookstoreFlowError(409, "BAD_STATUS", "Only a requested refund can be completed");
    }
    const sale = await loadSaleForUpdate(tx, String(refund.sale_id));
    const done = await tx.request().input("saleId", refund.sale_id).input("id", refundId).query(`
      SELECT COALESCE(SUM(amount), 0) AS amt
      FROM BookRefunds WHERE sale_id = @saleId AND status = 'completed' AND id <> @id
    `);
    const completed = Number(done.recordset[0]?.amt || 0);
    if (completed + Number(refund.amount) > Number(sale.paid_amount) + 0.009) {
      throw new BookstoreFlowError(409, "REFUND_EXCEEDS_BALANCE", "Completing this refund would exceed payments received");
    }
    await tx.request()
      .input("id", refundId)
      .input("by", userId)
      .input("ref", reference)
      .query(`
        UPDATE BookRefunds
        SET status = 'completed', completed_by = @by, completed_at = SYSUTCDATETIME(), transaction_ref = @ref
        WHERE id = @id
      `);
    await tx.commit();
    return { id: refundId, status: "completed", idempotent: false };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function cancelBookSale(pool: ConnectionPool, saleId: string, reason: string, userId: string) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const sale = await loadSaleForUpdate(tx, saleId);
    if (String(sale.status) === "cancelled") {
      await tx.commit();
      return { id: saleId, status: "cancelled", idempotent: true };
    }
    if (String(sale.status) !== "posted") {
      throw new BookstoreFlowError(409, "NOT_CANCELLABLE", "This sale cannot be cancelled");
    }
    const refunds = await tx.request().input("saleId", saleId).query(`
      SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS completed
      FROM BookRefunds WHERE sale_id = @saleId
    `);
    const completed = Number(refunds.recordset[0]?.completed || 0);
    const paid = Number(sale.paid_amount || 0);
    if (paid - completed > 0.009) {
      throw new BookstoreFlowError(
        409,
        "REFUND_REQUIRED",
        "Complete a refund for the amount paid before cancelling this sale"
      );
    }
    const reservationId = sale.reservation_id ? String(sale.reservation_id) : "";
    if (reservationId) {
      const res = await tx.request().input("id", reservationId).query(`
        SELECT id, store_id, status FROM BookStockReservations WITH (UPDLOCK, ROWLOCK) WHERE id = @id
      `);
      const reservation = res.recordset[0];
      if (reservation && String(reservation.status) === "active") {
        const items = await tx.request().input("rid", reservationId).query(`
          SELECT book_id, quantity FROM BookStockReservationItems WHERE reservation_id = @rid
        `);
        for (const it of items.recordset) {
          await tx.request()
            .input("storeId", reservation.store_id)
            .input("bookId", it.book_id)
            .input("qty", it.quantity)
            .query(`
              UPDATE BookInventoryBalances
              SET reserved = CASE WHEN reserved >= @qty THEN reserved - @qty ELSE 0 END, updated_at = SYSUTCDATETIME()
              WHERE store_id = @storeId AND book_id = @bookId
            `);
        }
        await tx.request().input("id", reservationId).query(`
          UPDATE BookStockReservations SET status = 'released' WHERE id = @id AND status = 'active'
        `);
      }
    }

    const lines = await tx.request().input("saleId", saleId).query(`
      SELECT si.id, si.book_id, si.quantity, si.unit_cost,
             COALESCE((
               SELECT SUM(i.quantity) FROM BookReturnItems i
               JOIN BookReturns r ON r.id = i.return_id
               WHERE i.sale_item_id = si.id AND r.status = 'posted'
             ), 0) AS returnedQty
      FROM BookSaleItems si WHERE si.sale_id = @saleId
    `);
    for (const line of lines.recordset) {
      const restore = Number(line.quantity) - Number(line.returnedQty);
      if (restore <= 0.0001) continue;
      await postInventoryMovement(pool, {
        storeId: String(sale.store_id),
        bookId: String(line.book_id),
        campusId: String(sale.campus_id),
        txnType: "sale_reversal",
        qtyDelta: restore,
        unitCost: Number(line.unit_cost) || 0,
        docType: "book_sale_cancel",
        docId: saleId,
        reason: reason || "Sale cancelled",
        performedBy: userId,
      }, tx);
    }
    await tx.request()
      .input("id", saleId)
      .input("reason", reason || null)
      .input("by", userId)
      .query(`
        UPDATE BookSales
        SET status = 'cancelled', cancel_reason = @reason, cancelled_at = SYSUTCDATETIME(), cancelled_by = @by
        WHERE id = @id
      `);
    await tx.commit();
    return { id: saleId, status: "cancelled", idempotent: false };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function buildReceipt(pool: ConnectionPool, saleId: string) {
  const detail = await getSaleDetail(pool, saleId);
  const sale = detail.sale as Record<string, unknown>;
  const items = (detail.items as Array<Record<string, unknown>>).map((line) => ({
    title: line.title,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unit_price),
    lineTotal: Number(line.line_total),
  }));
  const gross = money(items.reduce((s, l) => s + l.lineTotal, 0));
  return {
    invoiceNo: sale.invoice_no,
    soldAt: sale.created_at,
    status: sale.status,
    campusName: sale.campusName,
    storeName: sale.storeName,
    studentName: sale.studentName,
    rollNumber: sale.rollNumber,
    academicSession: sale.academic_session,
    items,
    gross,
    discount: Number(sale.discount || 0),
    total: Number(sale.total || 0),
    paidAmount: Number(sale.paid_amount || 0),
    outstanding: detail.outstanding,
    payments: detail.payments,
    returns: detail.returns,
    refunds: detail.refunds,
    completedRefunds: detail.completedRefunds,
  };
}

export async function buildReconciliation(pool: ConnectionPool, saleId: string) {
  const detail = await getSaleDetail(pool, saleId);
  const ledger = await pool.request().input("id", saleId).query(`
    SELECT * FROM BookInventoryLedger
    WHERE doc_id = @id OR doc_id IN (SELECT id FROM BookReturns WHERE sale_id = @id)
    ORDER BY created_at
  `);
  return { ...detail, ledger: ledger.recordset };
}
