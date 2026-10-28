/**
 * Phase 3 bookstore returns, refunds, cancellation, receipts.
 * Prerequisite: npm run dev with a reachable SQL Server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000/api';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const SESSION = '2026-2027';

async function api(path, { method = 'GET', token, body, headers } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data };
}

async function login() {
  const result = await api('/auth/login', { method: 'POST', body: { username: USERNAME, passwordHash: PASSWORD } });
  assert.equal(result.ok, true, `login failed: ${JSON.stringify(result.data)}`);
  return result.data.token;
}

async function setupSale(token, { pay = 0, qty = 2 } = {}) {
  const title = `Phase3 Book ${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const book = await api('/bookstore/books', { method: 'POST', token, body: { title } });
  assert.equal(book.status, 201, JSON.stringify(book.data));
  const price = await api('/bookstore/book-prices', {
    method: 'POST', token,
    body: { bookId: book.data.id, academicSession: SESSION, sellingPrice: 100, purchaseCost: 40 },
  });
  assert.equal(price.ok, true, JSON.stringify(price.data));
  const stores = await api('/bookstore/stores', { token });
  const store = stores.data.find((s) => s.storeType === 'campus') || stores.data[0];
  const students = await api('/students?limit=20', { token });
  const list = students.data?.data || students.data || [];
  const student = list.find((s) => String(s.campusId) === String(store.campusId) && String(s.status || 'Active') === 'Active') || list[0];
  assert.ok(student?.id, 'need a student');
  const stock = await api('/bookstore/inventory/opening-stock', {
    method: 'POST', token,
    body: { storeId: store.id, bookId: book.data.id, quantity: 10, unitCost: 40 },
  });
  assert.equal(stock.ok, true, JSON.stringify(stock.data));
  const sale = await api('/bookstore/sales', {
    method: 'POST', token,
    headers: { 'Idempotency-Key': `p3-sale-${book.data.id}` },
    body: {
      studentId: student.id,
      storeId: store.id,
      campusId: student.campusId || store.campusId,
      academicSession: SESSION,
      items: [{ bookId: book.data.id, quantity: qty }],
      payment: { amount: pay, method: 'Cash' },
    },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const detail = await api(`/bookstore/sales/${sale.data.id}`, { token });
  assert.equal(detail.ok, true, JSON.stringify(detail.data));
  return { token, store, bookId: book.data.id, sale: sale.data, line: detail.data.items[0], detail: detail.data };
}

async function postReturn(token, saleId, lines) {
  const created = await api('/bookstore/returns', {
    method: 'POST', token,
    headers: { 'Idempotency-Key': `p3-ret-${saleId}-${lines.map((l) => l.quantity).join('-')}-${Date.now()}` },
    body: { saleId, lines, reason: 'test' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await api(`/bookstore/returns/${created.data.id}/submit`, { method: 'POST', token })).ok, true);
  assert.equal((await api(`/bookstore/returns/${created.data.id}/approve`, { method: 'POST', token })).ok, true);
  const posted = await api(`/bookstore/returns/${created.data.id}/post`, { method: 'POST', token });
  assert.equal(posted.ok, true, JSON.stringify(posted.data));
  return { created: created.data, posted: posted.data };
}

test('bookstore phase 3 — returns, refunds, cancel, receipt', async (t) => {
  let token;
  try {
    token = await login();
  } catch (err) {
    t.skip(`server/database unavailable: ${err instanceof Error ? err.message : err}`);
    return;
  }

  await t.test('partial return then remaining return', async () => {
    const ctx = await setupSale(token, { pay: 0, qty: 2 });
    await postReturn(token, ctx.sale.id, [{ saleItemId: ctx.line.id, quantity: 1, condition: 'good' }]);
    await postReturn(token, ctx.sale.id, [{ saleItemId: ctx.line.id, quantity: 1, condition: 'good' }]);
    const over = await api('/bookstore/returns', {
      method: 'POST', token,
      body: { saleId: ctx.sale.id, lines: [{ saleItemId: ctx.line.id, quantity: 1 }], reason: 'too many' },
    });
    assert.equal(over.status, 409);
    assert.equal(over.data.code, 'QTY_EXCEEDS_SALE');
  });

  await t.test('concurrent returns cannot both take the remaining quantity', async () => {
    const ctx = await setupSale(token, { pay: 0, qty: 1 });
    const body = { saleId: ctx.sale.id, lines: [{ saleItemId: ctx.line.id, quantity: 1 }], reason: 'race' };
    const [a, b] = await Promise.all([
      api('/bookstore/returns', { method: 'POST', token, body }),
      api('/bookstore/returns', { method: 'POST', token, body }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
  });

  await t.test('posting a return twice does not restock twice', async () => {
    const ctx = await setupSale(token, { pay: 0, qty: 1 });
    const before = await api(`/bookstore/inventory?storeId=${ctx.store.id}`, { token });
    const onHandBefore = Number((before.data || []).find((r) => r.bookId === ctx.bookId || r.book_id === ctx.bookId)?.onHand ?? (before.data || []).find((r) => r.bookId === ctx.bookId)?.on_hand ?? 0);
    const created = await api('/bookstore/returns', {
      method: 'POST', token,
      body: { saleId: ctx.sale.id, lines: [{ saleItemId: ctx.line.id, quantity: 1, condition: 'good' }], reason: 'once' },
    });
    await api(`/bookstore/returns/${created.data.id}/submit`, { method: 'POST', token });
    await api(`/bookstore/returns/${created.data.id}/approve`, { method: 'POST', token });
    const first = await api(`/bookstore/returns/${created.data.id}/post`, { method: 'POST', token });
    const second = await api(`/bookstore/returns/${created.data.id}/post`, { method: 'POST', token });
    assert.equal(first.data.idempotent, false);
    assert.equal(second.data.idempotent, true);
    const after = await api(`/bookstore/inventory?storeId=${ctx.store.id}`, { token });
    const row = (after.data || []).find((r) => r.bookId === ctx.bookId || r.book_id === ctx.bookId);
    const onHand = Number(row?.onHand ?? row?.on_hand ?? 0);
    assert.equal(onHand, onHandBefore + 1);
  });

  await t.test('partial refund, full refund, and over-refund rejected', async () => {
    const ctx = await setupSale(token, { pay: 200, qty: 2 });
    const first = await api('/bookstore/refunds', {
      method: 'POST', token,
      headers: { 'Idempotency-Key': `rf-a-${ctx.sale.id}` },
      body: { saleId: ctx.sale.id, amount: 50, method: 'Cash' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.data.status, 'requested');
    const dup = await api('/bookstore/refunds', {
      method: 'POST', token,
      headers: { 'Idempotency-Key': `rf-a-${ctx.sale.id}` },
      body: { saleId: ctx.sale.id, amount: 50, method: 'Cash' },
    });
    assert.equal(dup.data.id, first.data.id);
    const done = await api(`/bookstore/refunds/${first.data.id}/complete`, { method: 'POST', token, body: { reference: 'cash-1' } });
    assert.equal(done.data.status, 'completed');
    const rest = await api('/bookstore/refunds', {
      method: 'POST', token,
      body: { saleId: ctx.sale.id, amount: 150, method: 'Cash' },
    });
    assert.equal(rest.status, 201);
    await api(`/bookstore/refunds/${rest.data.id}/complete`, { method: 'POST', token, body: { reference: 'cash-2' } });
    const over = await api('/bookstore/refunds', {
      method: 'POST', token,
      body: { saleId: ctx.sale.id, amount: 1, method: 'Cash' },
    });
    assert.equal(over.status, 409);
    assert.equal(over.data.code, 'REFUND_EXCEEDS_BALANCE');
  });

  await t.test('over-return does not change stock', async () => {
    const ctx = await setupSale(token, { pay: 0, qty: 1 });
    const before = await api(`/bookstore/inventory?storeId=${ctx.store.id}`, { token });
    const rowBefore = (before.data || []).find((r) => r.bookId === ctx.bookId || r.book_id === ctx.bookId);
    const bad = await api('/bookstore/returns', {
      method: 'POST', token,
      body: { saleId: ctx.sale.id, lines: [{ saleItemId: ctx.line.id, quantity: 5 }], reason: 'no' },
    });
    assert.equal(bad.status, 409);
    const after = await api(`/bookstore/inventory?storeId=${ctx.store.id}`, { token });
    const rowAfter = (after.data || []).find((r) => r.bookId === ctx.bookId || r.book_id === ctx.bookId);
    assert.equal(Number(rowAfter?.onHand ?? rowAfter?.on_hand), Number(rowBefore?.onHand ?? rowBefore?.on_hand));
  });

  await t.test('active reservation can be released and unpaid sale can be cancelled once', async () => {
    const ctx = await setupSale(token, { pay: 0, qty: 1 });
    const reserve = await api('/bookstore/sales/reserve', {
      method: 'POST', token,
      headers: { 'Idempotency-Key': `res-${ctx.bookId}` },
      body: { storeId: ctx.store.id, studentId: ctx.detail.sale.student_id, lines: [{ bookId: ctx.bookId, quantity: 1 }] },
    });
    if (reserve.ok) {
      const released = await api(`/bookstore/sales/reserve/${reserve.data.reservationId}/release`, { method: 'POST', token });
      assert.equal(released.ok, true);
    }
    const cancel = await api(`/bookstore/sales/${ctx.sale.id}/cancel`, { method: 'POST', token, body: { reason: 'test cancel' } });
    assert.equal(cancel.ok, true, JSON.stringify(cancel.data));
    const again = await api(`/bookstore/sales/${ctx.sale.id}/cancel`, { method: 'POST', token, body: { reason: 'test cancel' } });
    assert.equal(again.data.idempotent, true);
  });

  await t.test('paid sale cannot be cancelled until refunded', async () => {
    const ctx = await setupSale(token, { pay: 100, qty: 1 });
    const blocked = await api(`/bookstore/sales/${ctx.sale.id}/cancel`, { method: 'POST', token, body: { reason: 'no' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'REFUND_REQUIRED');
  });

  await t.test('unknown sale is not visible and receipt totals match the sale', async () => {
    const missing = await api('/bookstore/sales/00000000-0000-0000-0000-000000000099', { token });
    assert.equal(missing.status, 404);
    const ctx = await setupSale(token, { pay: 100, qty: 1 });
    const receipt = await api(`/bookstore/sales/${ctx.sale.id}/receipt`, { token });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.data.total, ctx.sale.total);
    assert.equal(receipt.data.paidAmount, ctx.sale.paidAmount);
    assert.equal(receipt.data.gross, receipt.data.items.reduce((s, l) => s + l.lineTotal, 0));
    const recon = await api(`/bookstore/reports/reconciliation?saleId=${ctx.sale.id}`, { token });
    assert.equal(recon.ok, true);
    assert.ok(Array.isArray(recon.data.ledger));
    assert.ok(recon.data.refundableBalance <= ctx.sale.paidAmount);
  });
});
