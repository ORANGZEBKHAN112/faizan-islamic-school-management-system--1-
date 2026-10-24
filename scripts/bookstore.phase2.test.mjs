import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000/api';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin123';

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
  assert.equal(result.ok, true, `login failed: ${JSON.stringify(result.data)}`);
  return result.data.token;
}

test('bookstore phase 2 — pricing and session validation', async (t) => {
  const token = await login();

  await t.test('invalid academic session rejected', async () => {
    const res = await api('/bookstore/prices?academicSession=bad&bookIds=x', { token });
    assert.equal(res.status, 400);
  });

  await t.test('missing price returns 422 not silent fallback', async () => {
    const session = '2099-2099';
    const res = await api(`/bookstore/prices?academicSession=${session}&bookIds=nonexistent-book-id`, { token });
    assert.equal(res.status, 422);
    assert.equal(res.data?.code, 'MISSING_PRICE');
  });
});

test('bookstore phase 2 — sale rejects client price', async (t) => {
  const token = await login();
  const stores = await api('/bookstore/stores', { token });
  if (!stores.ok || !stores.data?.length) {
    t.skip('no stores');
    return;
  }
  const students = await api('/students?limit=1&status=Active', { token });
  const student = students.data?.data?.[0] || students.data?.[0];
  if (!student?.id) {
    t.skip('no active student');
    return;
  }
  const store = stores.data.find((s) => s.storeType === 'campus') || stores.data[0];
  const res = await api('/bookstore/sales', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': `phase2-noprice-${Date.now()}` },
    body: {
      studentId: student.id,
      storeId: store.id,
      campusId: student.campusId,
      academicSession: '2099-2099',
      items: [{ bookId: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
    },
  });
  assert.ok(res.status === 422 || res.status === 409, `expected pricing/stock error got ${res.status}`);
});
