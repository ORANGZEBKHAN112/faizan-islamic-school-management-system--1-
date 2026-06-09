import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000/api';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';
const CAMPUS_ID = process.env.TEST_CAMPUS_ID || 'all';

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

async function login() {
  const result = await api('/auth/login', {
    method: 'POST',
    body: { username: USERNAME, passwordHash: PASSWORD },
  });
  assert.equal(result.ok, true, `login failed (${result.status}): ${JSON.stringify(result.data)}`);
  assert.ok(result.data?.token, 'token missing in login response');
  return result.data.token;
}

test('fee module smoke checks', async (t) => {
  const token = await login();
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  await t.test('generation idempotency', async () => {
    const payload = {
      campusId: CAMPUS_ID,
      months: [month],
      year,
      includeAdmissions: true,
      includeArrears: false,
    };
    const first = await api('/generate-monthly-fees', { method: 'POST', token, body: payload });
    assert.equal(first.ok, true, `first generate failed: ${JSON.stringify(first.data)}`);
    const second = await api('/generate-monthly-fees', { method: 'POST', token, body: payload });
    assert.equal(second.ok, true, `second generate failed: ${JSON.stringify(second.data)}`);
    assert.equal(Number(second.data?.processedCount || 0), 0, 'second run should be idempotent with zero new vouchers');
  });

  await t.test('partial then full payment update', async () => {
    const feesRes = await api(`/fees${CAMPUS_ID !== 'all' ? `?campusId=${encodeURIComponent(CAMPUS_ID)}` : ''}`, { token });
    assert.equal(feesRes.ok, true, `fees fetch failed: ${JSON.stringify(feesRes.data)}`);
    const unpaid = (feesRes.data || []).find((f) => ['Unpaid', 'Partially Paid'].includes(f.status));
    assert.ok(unpaid, 'no unpaid voucher available for payment test');
    const currentBalance = Number(unpaid.balanceAmount ?? unpaid.amount ?? 0);
    assert.ok(currentBalance > 0, 'voucher balance should be > 0');

    const firstPay = Math.max(1, Math.floor(currentBalance / 2));
    const partial = await api(`/fees/${unpaid.id}`, {
      method: 'PUT',
      token,
      body: { receivedAmount: firstPay, discountAmount: 0, fineAmount: 0, paymentMethod: 'Cash', transactionRef: `SMK-P1-${Date.now()}` },
    });
    assert.equal(partial.ok, true, `partial payment failed: ${JSON.stringify(partial.data)}`);

    const refresh1 = await api(`/fees${CAMPUS_ID !== 'all' ? `?campusId=${encodeURIComponent(CAMPUS_ID)}` : ''}`, { token });
    const afterPartial = (refresh1.data || []).find((f) => f.id === unpaid.id);
    assert.ok(afterPartial, 'voucher missing after partial payment');
    assert.equal(afterPartial.status, 'Partially Paid', 'voucher should become Partially Paid');
    const remaining = Number(afterPartial.balanceAmount || 0);
    assert.ok(remaining > 0, 'remaining balance should be > 0 after partial payment');

    const full = await api(`/fees/${unpaid.id}`, {
      method: 'PUT',
      token,
      body: { receivedAmount: remaining, discountAmount: 0, fineAmount: 0, paymentMethod: 'Cash', transactionRef: `SMK-P2-${Date.now()}` },
    });
    assert.equal(full.ok, true, `full payment failed: ${JSON.stringify(full.data)}`);

    const refresh2 = await api(`/fees${CAMPUS_ID !== 'all' ? `?campusId=${encodeURIComponent(CAMPUS_ID)}` : ''}`, { token });
    const afterFull = (refresh2.data || []).find((f) => f.id === unpaid.id);
    assert.ok(afterFull, 'voucher missing after full payment');
    assert.equal(afterFull.status, 'Paid', 'voucher should become Paid');
    assert.equal(Number(afterFull.balanceAmount || 0), 0, 'balance should be zero after full payment');
  });

  await t.test('quickpay callback duplicate idempotency', async (ctx) => {
    const feesRes = await api(`/fees${CAMPUS_ID !== 'all' ? `?campusId=${encodeURIComponent(CAMPUS_ID)}` : ''}`, { token });
    assert.equal(feesRes.ok, true, `fees fetch failed: ${JSON.stringify(feesRes.data)}`);
    const candidate = (feesRes.data || []).find((f) => ['Unpaid', 'Partially Paid'].includes(f.status) && Number(f.balanceAmount || 0) > 0);
    if (!candidate) ctx.skip('no unpaid voucher available for quickpay callback test');

    const txn = `SMK-QP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const amount = Number(candidate.balanceAmount || candidate.amount || 0);

    const first = await api('/payments/quickpay-callback', {
      method: 'POST',
      body: { transaction_id: txn, fee_id: candidate.id, amount },
    });
    if (!first.ok && first.status === 401) {
      ctx.skip('QuickPay signature is enforced in this environment');
    }
    assert.equal(first.ok, true, `quickpay first callback failed: ${JSON.stringify(first.data)}`);

    const second = await api('/payments/quickpay-callback', {
      method: 'POST',
      body: { transaction_id: txn, fee_id: candidate.id, amount },
    });
    assert.equal(second.ok, true, `quickpay second callback failed: ${JSON.stringify(second.data)}`);
    assert.equal(Boolean(second.data?.duplicate), true, 'second callback should be marked duplicate');
  });

  await t.test('advance-year allocation correctness', async (ctx) => {
    const feesRes = await api(`/fees${CAMPUS_ID !== 'all' ? `?campusId=${encodeURIComponent(CAMPUS_ID)}` : ''}`, { token });
    assert.equal(feesRes.ok, true, `fees fetch failed: ${JSON.stringify(feesRes.data)}`);
    const currentYearUnpaid = (feesRes.data || []).filter((f) =>
      f.year === year &&
      ['Unpaid', 'Partially Paid'].includes(f.status) &&
      ['Monthly', 'Admission'].includes(f.feeType) &&
      Number(f.balanceAmount || 0) > 0
    );
    if (currentYearUnpaid.length === 0) ctx.skip('no unpaid monthly/admission vouchers for current year');

    const studentId = currentYearUnpaid[0].studentId;
    const studentVouchers = currentYearUnpaid.filter((f) => f.studentId === studentId).sort((a, b) => a.month - b.month);
    if (studentVouchers.length === 0) ctx.skip('no suitable student vouchers for advance-year test');

    const targetAmount = studentVouchers.slice(0, 2).reduce((sum, f) => sum + Number(f.balanceAmount || 0), 0);
    if (targetAmount <= 0) ctx.skip('computed advance payment amount is zero');

    const adv = await api('/fees/advance-year-payment', {
      method: 'POST',
      token,
      body: {
        studentId,
        year,
        receivedAmount: targetAmount,
        paymentMethod: 'Cash',
        transactionRef: `SMK-ADV-${Date.now()}`,
      },
    });
    assert.equal(adv.ok, true, `advance payment failed: ${JSON.stringify(adv.data)}`);
    assert.ok(Number(adv.data?.amountApplied || 0) > 0, 'advance payment should apply positive amount');
    assert.ok(Number(adv.data?.vouchersUpdated || 0) >= 1, 'advance payment should update at least one voucher');
  });
});

