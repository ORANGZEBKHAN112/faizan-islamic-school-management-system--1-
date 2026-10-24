import type { ConnectionPool, Transaction } from "mssql";
import crypto from "crypto";
import sql from "mssql";

export type LedgerPostInput = {
  storeId: string;
  bookId: string;
  campusId?: string | null;
  txnType: string;
  qtyDelta: number;
  unitCost?: number;
  docType: string;
  docId: string;
  reason?: string;
  performedBy?: string;
  /** When true, qtyDelta reduces on_hand; when false, may affect in_transit/damaged/reserved via txnType */
  affectOnHand?: boolean;
  inTransitDelta?: number;
  damagedDelta?: number;
};

async function ensureBalance(
  tx: Transaction,
  storeId: string,
  bookId: string
): Promise<{ id: string; onHand: number; avgCost: number }> {
  const sel = await tx.request()
    .input("storeId", storeId)
    .input("bookId", bookId)
    .query(`
      SELECT id, on_hand AS onHand, avg_cost AS avgCost
      FROM BookInventoryBalances WITH (UPDLOCK, ROWLOCK)
      WHERE store_id = @storeId AND book_id = @bookId
    `);
  if (sel.recordset[0]) {
    return {
      id: String(sel.recordset[0].id),
      onHand: Number(sel.recordset[0].onHand),
      avgCost: Number(sel.recordset[0].avgCost),
    };
  }
  const id = crypto.randomUUID();
  await tx.request()
    .input("id", id)
    .input("storeId", storeId)
    .input("bookId", bookId)
    .query(`
      INSERT INTO BookInventoryBalances (id, store_id, book_id, on_hand, reserved, in_transit, damaged, avg_cost)
      VALUES (@id, @storeId, @bookId, 0, 0, 0, 0, 0)
    `);
  return { id, onHand: 0, avgCost: 0 };
}

/** Weighted-average cost on positive receipts; COGS uses avg_cost on issues. */
export async function postInventoryMovement(
  pool: ConnectionPool,
  input: LedgerPostInput,
  outerTx?: Transaction
): Promise<void> {
  const run = async (tx: Transaction) => {
    const bal = await ensureBalance(tx, input.storeId, input.bookId);
    const qty = Number(input.qtyDelta);
    const unitCost = Number(input.unitCost ?? 0);
    let newOnHand = bal.onHand;
    let newAvg = bal.avgCost;

    const inTransitDelta = Number(input.inTransitDelta ?? 0);
    const damagedDelta = Number(input.damagedDelta ?? 0);
    const affectOnHand = input.affectOnHand !== false;

    if (affectOnHand && qty !== 0) {
      newOnHand = bal.onHand + qty;
      if (newOnHand < -0.0001) {
        throw new Error("Insufficient stock");
      }
      if (qty > 0 && unitCost >= 0) {
        const totalValue = bal.onHand * bal.avgCost + qty * unitCost;
        newAvg = newOnHand > 0 ? totalValue / newOnHand : unitCost;
      }
    }

    const upd = tx.request()
      .input("id", bal.id)
      .input("avgCost", newAvg)
      .input("inTransitDelta", inTransitDelta)
      .input("damagedDelta", damagedDelta);
    if (affectOnHand) {
      upd.input("onHand", newOnHand);
      await upd.query(`
        UPDATE BookInventoryBalances SET
          on_hand = @onHand,
          avg_cost = @avgCost,
          in_transit = in_transit + @inTransitDelta,
          damaged = damaged + @damagedDelta,
          updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);
    } else {
      await upd.query(`
        UPDATE BookInventoryBalances SET
          avg_cost = @avgCost,
          in_transit = in_transit + @inTransitDelta,
          damaged = damaged + @damagedDelta,
          updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);
    }

    await tx.request()
      .input("id", crypto.randomUUID())
      .input("storeId", input.storeId)
      .input("bookId", input.bookId)
      .input("campusId", input.campusId ?? null)
      .input("txnType", input.txnType)
      .input("qtyDelta", qty)
      .input("unitCost", unitCost || newAvg)
      .input("docType", input.docType)
      .input("docId", input.docId)
      .input("reason", input.reason ?? null)
      .input("performedBy", input.performedBy ?? null)
      .query(`
        INSERT INTO BookInventoryLedger (
          id, store_id, book_id, campus_id, txn_type, qty_delta, unit_cost,
          doc_type, doc_id, reason, performed_by, created_at
        ) VALUES (
          @id, @storeId, @bookId, @campusId, @txnType, @qtyDelta, @unitCost,
          @docType, @docId, @reason, @performedBy, SYSUTCDATETIME()
        )
      `);
  };

  if (outerTx) {
    await run(outerTx);
    return;
  }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await run(tx);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function nextSequence(pool: ConnectionPool, seqKey: string): Promise<number> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const row = await tx.request()
      .input("key", seqKey)
      .query(`
        SELECT next_val FROM BookstoreSequences WITH (UPDLOCK, ROWLOCK) WHERE seq_key = @key
      `);
    let n: number;
    if (!row.recordset[0]) {
      n = 1;
      await tx.request()
        .input("key", seqKey)
        .input("n", 2)
        .query(`INSERT INTO BookstoreSequences (seq_key, next_val) VALUES (@key, @n)`);
    } else {
      n = Number(row.recordset[0].next_val);
      await tx.request()
        .input("key", seqKey)
        .input("n", n + 1)
        .query(`UPDATE BookstoreSequences SET next_val = @n, updated_at = SYSUTCDATETIME() WHERE seq_key = @key`);
    }
    await tx.commit();
    return n;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export function availableStock(row: {
  onHand?: number;
  on_hand?: number;
  reserved?: number;
  reserved_qty?: number;
}): number {
  const onHand = Number(row.onHand ?? row.on_hand ?? 0);
  const reserved = Number(row.reserved ?? row.reserved_qty ?? 0);
  return Math.max(0, onHand - reserved);
}
