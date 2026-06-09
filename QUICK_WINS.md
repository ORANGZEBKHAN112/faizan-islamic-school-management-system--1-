# Quick Wins

Low-effort fixes (&lt;30 min each). High impact marked with ★.

---

## ★ Security & config

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 1 | Add `import 'dotenv/config'` as first import | `server.ts:1` | 1 min |
| 2 | Remove real password from `.env.example`; use `your_password_here` | `.env.example:3` | 2 min |
| 3 | Only seed admin if missing (delete UPDATE block) | `server.ts:395-402` | 5 min |
| 4 | Require `JWT_SECRET` in prod: `if (!process.env.JWT_SECRET && process.env.NODE_ENV==='production') process.exit(1)` | `server.ts:14` | 5 min |

---

## ★ Bugs

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 5 | Guard login: `if (!pool?.connected) return res.status(503)...` | `server.ts:1588` | 3 min |
| 6 | Skip fee-settings poll when campus is `'all'` | `FeeManagement.tsx:69-75` | 5 min |
| 7 | Replace `feevouchers` PUT redirect with direct handler call | `server.ts:897-900` | 5 min |
| 8 | Add `Attendance` route or remove unused import | `App.tsx:13` | 5 min |
| 9 | Add `'Partially Paid'` to `Fee['status']` | `types.ts:85` | 1 min |

---

## ★ Data accuracy

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 10 | Dashboard collected: use `paidAmount ?? amount` | `Dashboard.tsx:104` | 5 min |
| 11 | FeeManagement stats: same for `totalPaid` | `FeeManagement.tsx:36` | 5 min |
| 12 | Include `exam_fee`, `transport_fee`, `misc_fee` in fee-settings GET/UPDATE | `server.ts:657-708` | 15 min |

---

## Performance

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 13 | Change poll interval `5000` → `60000` (interim) | `dataService.ts:133` | 1 min |
| 14 | Remove `console.log('Campuses from API')` | `dataService.ts:83` | 1 min |

---

## API / DX

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 15 | Health: `{ status, db: pool?.connected ?? false }` | `server.ts:426-428` | 5 min |
| 16 | `getAll`: rethrow on 5xx instead of `return []` | `dataService.ts:71-74` | 5 min |
| 17 | Rename login field `passwordHash` → `password` (client + server) | `Login.tsx:30`, `server.ts:1590` | 10 min |

---

## Cleanup

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 18 | Remove unused deps: `clsx`, `tailwind-merge`, `@google/genai` (if unused) | `package.json` | 5 min |
| 19 | Fix `axios` to `^1.7.9`; dedupe `vite` to devDependencies only | `package.json` | 5 min |
| 20 | Rename package `react-example` → `faizan-school-erp` | `package.json:2` | 1 min |
| 21 | Delete or fix broken `/api/import-excel` | `server.ts:1168` | 10 min |
| 22 | Use `dataService.update` in FeeManagement payment | `FeeManagement.tsx:107` | 5 min |

---

## UI polish

| # | Fix | File:Line | Effort |
|---|-----|-----------|--------|
| 23 | Loading spinner: `gray-*` → `slate-*` | `App.tsx:39` | 2 min |
| 24 | `bg-error` → `bg-danger` | `QuickPaySetup.tsx:267` | 2 min |

---

## Suggested 2-hour batch

Do **#1, 3, 5, 6, 9, 10, 13, 15** first (~35 min) — covers env, admin lockout, login safety, polling relief, and stats sanity.

Then **#12** (~15 min) for fee settings completeness.
