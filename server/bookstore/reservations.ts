import type { ConnectionPool, Transaction } from "mssql";
import crypto from "crypto";
import sql from "mssql";
import { availableStock } from "./ledger.js";

const DEFAULT_RESERVE_TTL_MIN = 15;

export async function expireStaleReservations(pool: ConnectionPool, tx?: Transaction): Promise<void> {
  const run = async (t: Transaction) => {
    const expired = await t.request().query(`
      SELECT id, store_id FROM BookStockReservations
      WHERE status = 'active' AND expires_at < SYSUTCDATETIME()
    `);
    for (const row of expired.recordset) {
      const items = await t.request().input("rid", row.id).query(`
        SELECT book_id, quantity FROM BookStockReservationItems WHERE reservation_id = @rid
      `);
      for (const it of items.recordset) {
        await releaseReservedQty(t, String(row.store_id), String(it.book_id), Number(it.quantity));
      }
      await t.request().input("id", row.id).query(`
        UPDATE BookStockReservations SET status = 'expired' WHERE id = @id
      `);
    }
  };
  if (tx) await run(tx);
  else {
    const t = new sql.Transaction(pool);
    await t.begin();
    try {
      await run(t);
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }
}

async function lockBalance(t: Transaction, storeId: string, bookId: string) {
  const sel = await t.request()
    .input("storeId", storeId)
    .input("bookId", bookId)
    .query(`
      SELECT id, on_hand AS onHand, reserved, avg_cost AS avgCost
      FROM BookInventoryBalances WITH (UPDLOCK, ROWLOCK)
      WHERE store_id = @storeId AND book_id = @bookId
    `);
  if (sel.recordset[0]) return sel.recordset[0];
  const id = crypto.randomUUID();
  await t.request()
    .input("id", id)
    .input("storeId", storeId)
    .input("bookId", bookId)
    .query(`
      INSERT INTO BookInventoryBalances (id, store_id, book_id, on_hand, reserved, in_transit, damaged, avg_cost)
      VALUES (@id, @storeId, @bookId, 0, 0, 0, 0, 0)
    `);
  return { id, onHand: 0, reserved: 0, avgCost: 0 };
}

async function addReservedQty(t: Transaction, storeId: string, bookId: string, qty: number) {
  const bal = await lockBalance(t, storeId, bookId);
  const onHand = Number(bal.onHand);
  const reserved = Number(bal.reserved);
  const av = availableStock({ onHand, reserved });
  if (av < qty) throw new Error("Insufficient available stock to reserve");
  const newReserved = reserved + qty;
  await t.request()
    .input("id", bal.id)
    .input("reserved", newReserved)
    .query(`UPDATE BookInventoryBalances SET reserved = @reserved, updated_at = SYSUTCDATETIME() WHERE id = @id`);
}

async function releaseReservedQty(t: Transaction, storeId: string, bookId: string, qty: number) {
  const bal = await lockBalance(t, storeId, bookId);
  const reserved = Number(bal.reserved);
  const release = Math.min(reserved, qty);
  if (release <= 0) return;
  await t.request()
    .input("id", bal.id)
    .input("reserved", reserved - release)
    .query(`UPDATE BookInventoryBalances SET reserved = @reserved, updated_at = SYSUTCDATETIME() WHERE id = @id`);
}

export async function createStockReservation(
  pool: ConnectionPool,
  opts: {
    storeId: string;
    studentId?: string | null;
    academicSession?: string | null;
    packId?: string | null;
    lines: Array<{ bookId: string; quantity: number }>;
    reservationKey?: string | null;
    performedBy?: string;
    ttlMinutes?: number;
  }
): Promise<{ reservationId: string; expiresAt: string; duplicate?: boolean }> {
  await expireStaleReservations(pool);

  if (opts.reservationKey) {
    const dup = await pool.request().input("k", opts.reservationKey).query(`
      SELECT id, expires_at AS expiresAt, status FROM BookStockReservations WHERE reservation_key = @k
    `);
    if (dup.recordset[0]?.status === "active") {
      return {
        reservationId: String(dup.recordset[0].id),
        expiresAt: new Date(dup.recordset[0].expiresAt).toISOString(),
        duplicate: true,
      };
    }
  }

  const reservationId = crypto.randomUUID();
  const ttl = Math.min(60, Math.max(5, opts.ttlMinutes ?? DEFAULT_RESERVE_TTL_MIN));
  const expiresAt = new Date(Date.now() + ttl * 60_000);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const line of opts.lines) {
      await addReservedQty(tx, opts.storeId, line.bookId, line.quantity);
    }
    await tx.request()
      .input("id", reservationId)
      .input("key", opts.reservationKey || null)
      .input("storeId", opts.storeId)
      .input("studentId", opts.studentId || null)
      .input("session", opts.academicSession || null)
      .input("packId", opts.packId || null)
      .input("expires", expiresAt)
      .input("by", opts.performedBy || null)
      .query(`
        INSERT INTO BookStockReservations (id, reservation_key, store_id, student_id, academic_session, pack_id, status, expires_at, created_by)
        VALUES (@id, @key, @storeId, @studentId, @session, @packId, 'active', @expires, @by)
      `);
    for (const line of opts.lines) {
      await tx.request()
        .input("id", crypto.randomUUID())
        .input("rid", reservationId)
        .input("bookId", line.bookId)
        .input("qty", line.quantity)
        .query(`
          INSERT INTO BookStockReservationItems (id, reservation_id, book_id, quantity)
          VALUES (@id, @rid, @bookId, @qty)
        `);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  return { reservationId, expiresAt: expiresAt.toISOString() };
}

export async function releaseStockReservation(pool: ConnectionPool, reservationId: string): Promise<void> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const hdr = await tx.request().input("id", reservationId).query(`
      SELECT id, store_id, status FROM BookStockReservations WHERE id = @id
    `);
    const row = hdr.recordset[0];
    if (!row || row.status !== "active") {
      await tx.commit();
      return;
    }
    const items = await tx.request().input("rid", reservationId).query(`
      SELECT book_id, quantity FROM BookStockReservationItems WHERE reservation_id = @rid
    `);
    for (const it of items.recordset) {
      await releaseReservedQty(tx, String(row.store_id), String(it.book_id), Number(it.quantity));
    }
    await tx.request().input("id", reservationId).query(`
      UPDATE BookStockReservations SET status = 'released' WHERE id = @id
    `);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/** Issue stock: reduce on_hand and reserved (from active reservation) atomically. */
export async function consumeReservationAndIssue(
  t: Transaction,
  storeId: string,
  reservationId: string | null,
  lines: Array<{ bookId: string; quantity: number }>
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  const reservedByBook = new Map<string, number>();

  if (reservationId) {
    const hdr = await t.request().input("id", reservationId).query(`
      SELECT id, store_id, status, expires_at FROM BookStockReservations WHERE id = @id
    `);
    const res = hdr.recordset[0];
    if (!res || res.status !== "active") throw new Error("Reservation not active");
    if (new Date(res.expires_at).getTime() < Date.now()) throw new Error("Reservation expired");
    if (String(res.store_id) !== storeId) throw new Error("Reservation store mismatch");
    const items = await t.request().input("rid", reservationId).query(`
      SELECT book_id, quantity FROM BookStockReservationItems WHERE reservation_id = @rid
    `);
    for (const it of items.recordset) {
      reservedByBook.set(String(it.book_id), Number(it.quantity));
    }
  }

  for (const line of lines) {
    const bal = await lockBalance(t, storeId, line.bookId);
    const onHand = Number(bal.onHand);
    const reserved = Number(bal.reserved);
    const needReserve = reservedByBook.get(line.bookId) || 0;
    const av = availableStock({ onHand, reserved });
    if (needReserve > 0) {
      if (Math.abs(needReserve - line.quantity) > 0.0001) {
        throw new Error("Reservation quantity mismatch");
      }
    } else if (av < line.quantity) {
      throw new Error("Insufficient stock");
    }
    const newOnHand = onHand - line.quantity;
    if (newOnHand < -0.0001) throw new Error("Insufficient stock");
    const newReserved = needReserve > 0 ? Math.max(0, reserved - line.quantity) : reserved;
    await t.request()
      .input("id", bal.id)
      .input("onHand", newOnHand)
      .input("reserved", newReserved)
      .query(`
        UPDATE BookInventoryBalances SET on_hand = @onHand, reserved = @reserved, updated_at = SYSUTCDATETIME() WHERE id = @id
      `);
    costs.set(line.bookId, Number(bal.avgCost) || 0);
  }

  if (reservationId) {
    await t.request().input("id", reservationId).query(`
      UPDATE BookStockReservations SET status = 'consumed' WHERE id = @id
    `);
  }

  return costs;
}
