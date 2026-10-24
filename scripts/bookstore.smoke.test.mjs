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

test('bookstore API smoke', async (t) => {
  const token = await login();

  await t.test('dashboard and stores', async () => {
    const dash = await api('/bookstore/dashboard', { token });
    assert.equal(dash.ok, true, JSON.stringify(dash.data));
    const stores = await api('/bookstore/stores', { token });
    assert.equal(stores.ok, true);
    assert.ok(Array.isArray(stores.data));
  });

  await t.test('book catalog CRUD guard', async () => {
    const title = `Smoke Book ${Date.now()}`;
    const created = await api('/bookstore/books', {
      method: 'POST',
      token,
      body: { title, isbn: `978${Date.now()}`.slice(0, 13) },
    });
    assert.equal(created.ok, true, JSON.stringify(created.data));
    const list = await api('/bookstore/books?search=' + encodeURIComponent(title), { token });
    assert.equal(list.ok, true);
    assert.ok((list.data?.data || []).some((b) => b.title === title));
  });
});
