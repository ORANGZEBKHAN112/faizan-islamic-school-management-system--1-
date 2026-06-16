/**
 * Role-based API + route smoke QA. Run: node scripts/qa-role-smoke.mjs
 * Requires dev server on BASE_URL (default http://localhost:3000)
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.QA_BASE_URL || 'http://localhost:3000';

const TEST_USERS = [
  { label: 'Super Admin', username: 'admin', password: 'admin123', role: 'Super Admin' },
  { label: 'Super Admin 2', username: 'superadmin', password: 'superadmin123', role: 'Super Admin' },
  { label: 'Admin', username: 'campusadmin', password: 'campusadmin123', role: 'Admin' },
  { label: 'Accountant', username: 'accountant', password: 'accountant123', role: 'Accountant' },
  { label: 'Teacher', username: 'teacher', password: 'teacher123', role: 'Teacher' },
  { label: 'Principal (custom)', username: 'danish2', password: 'Test@123', role: 'Principal', altUsername: 'STU-2026-0002' },
  { label: 'Student', username: 'STU-2026-0001', password: 'STU-2026-0001', role: 'Student' },
];

const API_CHECKS = [
  { name: 'health', path: '/api/health', auth: false, expect: 200 },
  { name: 'dashboard-stats', path: '/api/dashboard-stats', auth: true },
  { name: 'students', path: '/api/students', auth: true },
  { name: 'campuses', path: '/api/campuses', auth: true },
  { name: 'classes', path: '/api/classes', auth: true },
  { name: 'fees', path: '/api/fees', auth: true },
  { name: 'admissions', path: '/api/admissions', auth: true },
  { name: 'users', path: '/api/users', auth: true, superOnly: true },
  { name: 'roles', path: '/api/app-roles', auth: true, superOnly: true },
  { name: 'quickpay-config', path: '/api/quickpay-config', auth: true },
  { name: 'public-track', path: '/api/public/admissions/track?trackingNo=TEST-0000', auth: false },
];

async function request(method, urlPath, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(username, password) {
  const res = await request('POST', '/api/auth/login', null, {
    username,
    passwordHash: password,
  });
  if (res.status !== 200 || !res.data?.token) {
    return { ok: false, error: res.data?.message || res.data || `HTTP ${res.status}` };
  }
  const me = await request('GET', '/api/auth/me', res.data.token);
  return {
    ok: true,
    token: res.data.token,
    user: me.data,
    meStatus: me.status,
  };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    health: null,
    logins: [],
    apiByRole: [],
    bugs: [],
  };

  try {
    const health = await request('GET', '/api/health');
    report.health = health;
    if (health.status !== 200) {
      report.bugs.push({
        severity: 'critical',
        area: 'Server',
        title: 'Health endpoint not OK',
        detail: `GET /api/health returned ${health.status}`,
      });
    }
  } catch (e) {
    report.bugs.push({
      severity: 'critical',
      area: 'Server',
      title: 'Cannot reach dev server',
      detail: String(e.message || e),
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  for (const u of TEST_USERS) {
    const entry = { user: u.label, username: u.username, login: null, checks: [] };
    let loginResult = await login(u.username, u.password);
    if (!loginResult.ok && u.altUsername) {
      loginResult = await login(u.altUsername, u.password);
      if (loginResult.ok) entry.username = u.altUsername;
    }
    entry.login = loginResult;
    if (!loginResult.ok) {
      report.bugs.push({
        severity: 'high',
        area: 'Auth',
        title: `Login failed: ${u.label}`,
        detail: `${u.username}: ${loginResult.error}`,
      });
      report.logins.push(entry);
      continue;
    }
    if (loginResult.meStatus !== 200) {
      report.bugs.push({
        severity: 'high',
        area: 'Auth',
        title: `/api/auth/me failed for ${u.label}`,
        detail: `Status ${loginResult.meStatus}`,
      });
    }
    const role = loginResult.user?.role;
    if (role && role !== u.role && role !== 'Principle' && u.role !== 'Principal') {
      report.bugs.push({
        severity: 'medium',
        area: 'Auth',
        title: `Role mismatch for ${entry.username}`,
        detail: `Expected ${u.role}, got ${role}`,
      });
    }
    const perms = loginResult.user?.permissions;
    if (!perms && role !== 'Super Admin') {
      report.bugs.push({
        severity: 'high',
        area: 'Permissions',
        title: `No permissions loaded for ${u.label}`,
        detail: 'verifySession returned empty permissions — may show empty nav',
      });
    }

    for (const check of API_CHECKS) {
      if (check.auth && !loginResult.token) continue;
      const res = await request('GET', check.path, check.auth ? loginResult.token : null);
      const expectedOk = check.expect ?? 200;
      const ok = res.status === expectedOk || (res.status >= 200 && res.status < 300);
      let note = '';
      if (check.superOnly && role !== 'Super Admin' && res.status === 200) {
        note = 'Non-super got 200 — possible auth gap';
        report.bugs.push({
          severity: 'medium',
          area: 'API Auth',
          title: `${check.name} accessible to ${role}`,
          detail: `${entry.username} got ${res.status} on ${check.path}`,
        });
      }
      if (check.name === 'admissions' && perms && !perms.admissions?.view && res.status === 200) {
        const count = Array.isArray(res.data) ? res.data.length : 0;
        note = `Admissions leak: ${count} rows`;
        report.bugs.push({
          severity: 'critical',
          area: 'API Auth',
          title: 'GET /api/admissions ignores module permissions',
          detail: `${entry.username} (${role}) got 200 with ${count} applications`,
        });
      }
      if (check.name === 'admissions' && perms && !perms.admissions?.view && res.status === 403) {
        note = 'Correctly denied';
      }
      if (check.auth && res.status === 401) {
        report.bugs.push({
          severity: 'high',
          area: 'API',
          title: `${check.name} unauthorized for logged-in ${role}`,
          detail: `${check.path} → ${res.status}`,
        });
      }
      if (check.auth && res.status === 500) {
        const msg = typeof res.data === 'object' ? res.data?.message || JSON.stringify(res.data) : res.data;
        report.bugs.push({
          severity: 'high',
          area: 'API',
          title: `${check.name} server error for ${u.label}`,
          detail: `${check.path}: ${msg?.slice?.(0, 200) || msg}`,
        });
      }
      entry.checks.push({ name: check.name, path: check.path, status: res.status, ok, note });
    }
    report.logins.push(entry);
    report.apiByRole.push({ role: loginResult.user?.role, username: entry.username, checks: entry.checks });
  }

  const outDir = path.join(process.cwd(), 'qa-output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'qa-api-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(`Bugs found: ${report.bugs.length}`);
  for (const b of report.bugs) {
    console.log(`[${b.severity}] ${b.title} — ${b.detail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
