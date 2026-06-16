/**
 * Capture UI screenshots per role for QA report.
 * Run: node scripts/qa-ui-screenshots.mjs
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE_URL || 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'qa-output', 'screenshots');

const SCENARIOS = [
  { name: 'login-en', path: '/login', actions: [] },
  { name: 'login-ur', path: '/login', actions: [{ type: 'lang', code: 'ur' }] },
  { name: 'admin-dashboard', login: { u: 'admin', p: 'admin123' }, path: '/' },
  { name: 'admin-students', login: { u: 'admin', p: 'admin123' }, path: '/students' },
  { name: 'admin-admissions', login: { u: 'admin', p: 'admin123' }, path: '/admissions' },
  { name: 'principle-students', login: { u: 'danish2', alt: 'STU-2026-0002', p: 'Test@123' }, path: '/students' },
  { name: 'principle-no-admissions-nav', login: { u: 'danish2', alt: 'STU-2026-0002', p: 'Test@123' }, path: '/admissions' },
  { name: 'student-portal', login: { u: 'STU-2026-0001', p: 'STU-2026-0001' }, path: '/' },
  { name: 'public-apply', path: '/apply' },
  { name: 'public-track', path: '/track' },
];

async function clickLang(page, code) {
  const byData = page.locator(`button[data-lang="${code}"]`);
  if (await byData.count()) {
    await byData.first().click();
  } else {
    const compact = page.locator(`button[data-lang="${code}"], button:has-text("${code.toUpperCase()}")`);
    if (await compact.count()) await compact.first().click();
  }
  await page.waitForTimeout(600);
}

async function doLogin(page, u, p, alt) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#username', u);
  await page.fill('#password', p);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  if (alt && page.url().includes('/login')) {
    await page.fill('#username', alt);
    await page.fill('#password', p);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const s of SCENARIOS) {
    const file = path.join(OUT, `${s.name}.png`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      if (s.login) {
        await doLogin(page, s.login.u, s.login.p, s.login.alt);
      } else {
        await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle' });
      }
      for (const a of s.actions || []) {
        if (a.type === 'lang') await clickLang(page, a.code);
      }
      if (s.login && s.path) {
        await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
      }
      await page.screenshot({ path: file, fullPage: false });
      const url = page.url();
      results.push({ name: s.name, ok: true, url, file });
      console.log('OK', s.name, url);
    } catch (e) {
      results.push({ name: s.name, ok: false, error: String(e.message || e) });
      console.log('FAIL', s.name, e.message);
    }
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
