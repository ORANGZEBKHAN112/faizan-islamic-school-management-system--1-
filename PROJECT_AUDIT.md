# Project Audit — Faizan Islamic School ERP

**Scope:** Active stack (`server.ts`, `src/`, `Database/`, config). Excludes `node_modules`, `dist`, legacy `Backend/`, `Frontend/` unless noted.

**Summary:** 38 distinct issues — **6 Critical**, **12 High**, **14 Medium**, **6 Low**.

---

## 1. Security vulnerabilities

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Critical** | `server.ts:14`, `.env.example:2-6` | Hardcoded JWT secret; real DB password in `.env.example` | Defaults committed; `dotenv` never loaded | `import 'dotenv/config'`; require `JWT_SECRET` in prod; replace `.env.example` with placeholders |
| **Critical** | `server.ts:371-402` | Admin password reset to `admin123` on **every** startup | `seedAdmin()` always runs `UPDATE passwordHash` | Only seed when user missing; never overwrite existing hash |
| **Critical** | All `/api/*` except login | No JWT/auth middleware | Token issued but never verified | Add `authenticate` middleware on mutating routes |
| **Critical** | `App.tsx:22-28` | Client-only auth; `localStorage.user` can be forged | No server session check on load | Validate JWT on app init (`/api/auth/me`); drop trust of stored role |
| **High** | `server.ts:421`, `903-925` | Open CORS; unauthenticated QuickPay callback | No origin check; no HMAC/signature | Restrict CORS; verify gateway signature + idempotency |
| **High** | `server.ts:1491-1579` | Generic CRUD exposes all `TABLE_MAP` tables (Users, etc.) | No RBAC on generic routes | Remove `users` from map or protect; whitelist per role |
| **High** | `Login.tsx:30`, `server.ts:1590` | Plain password sent as `passwordHash` over HTTP | Misnamed field; no TLS enforcement | Rename to `password`; enforce HTTPS in prod |
| **Medium** | `server.ts:423` | `/uploads` static, no auth | Public file serving | Auth gate or signed URLs |
| **Medium** | `server.ts:1634-1636` | Stack traces in API errors when `NODE_ENV=development` | Error handler leaks `err` | Never return stack to client |

---

## 2. Bugs & runtime errors

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Critical** | `App.tsx:55-68`, `Layout.tsx:67-77` | Teacher/Accountant see nav items but routes **not registered** | Routes gated to Admin/Super Admin only | Align `App.tsx` routes with `menuItems.roles` |
| **High** | `server.ts:647-655`, `FeeManagement.tsx:75` | `GET /api/fee-settings` 400 when `campusId=all` | API requires campusId; UI polls with `'all'` | Skip subscribe when `all`; or support all-campuses query |
| **High** | `server.ts:1588-1594` | Login throws if DB connection failed | `pool` undefined; no guard | Return 503 if `!pool?.connected` |
| **High** | `FeeSettings.tsx:63-65`, `server.ts:657-708` | Exam/transport/misc fees in UI never read or saved | GET omits columns; POST UPDATE ignores them | Extend SELECT/INSERT/UPDATE for `exam_fee`, `transport_fee`, `misc_fee` |
| **High** | `server.ts:1174`, `17-18` | `/api/import-excel` calls `XLSX.readFile(req.file.path)` | Multer uses `memoryStorage` — no `path` | Use `XLSX.read(req.file.buffer)` like `import-students` |
| **Medium** | `server.ts:897-900` | `PUT /api/feevouchers/:id` 307 redirect drops body | Redirect alias for PUT | Call same handler directly (no redirect) |
| **Medium** | `server.ts:831-836` | Status `Partially Paid` not in `types.ts` | Server sets value outside union | Add to `Fee.status` type + filters |
| **Medium** | `Dashboard.tsx:104-105`, `FeeManagement.tsx:36-37` | Stats use `amount` not `paidAmount` | Wrong field for partial payments | Use `paidAmount` / `balanceAmount` |
| **Medium** | `server.ts:485` | `campusCode` duplicated from `campusName` | Alias bug in SELECT | Add real `campus_code` column or remove field |
| **Low** | `authService.ts:12-19` | `register` / `getCurrentUser` — no server routes | Dead client API | Implement routes or remove methods |
| **Low** | `dataService.ts:25` | `users` → `/auth/register` (404) | Wrong endpoint mapping | Remove or implement register |

---

## 3. Performance issues

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `dataService.ts:133`, multiple pages | 5s polling per subscription; Dashboard = **5 intervals** | `subscribe()` uses `setInterval` | Fetch on mount + manual refresh; or single shared poll |
| **High** | `server.ts:977-1052` | Fee generation: 2+ queries **per student** in loop | N+1 pattern | Batch SELECT existing fees; bulk INSERT |
| **Medium** | `server.ts:1499` | Generic `SELECT *` no pagination | Full table scans | Add `limit`/`offset` query params |
| **Medium** | `Reports.tsx:25-29` | 5 concurrent pollers on one page | Same subscribe pattern | One combined fetch |
| **Low** | `dataService.ts:82-84` | `console.log` on every campus fetch | Debug leftover | Remove |

---

## 4. Database / query inefficiencies

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `server.ts:977-1052` | Sequential per-row INSERT in fee generation | No transaction/bulk | `sql.Table` bulk insert or single transaction |
| **Medium** | `server.ts:1517-1536` | Generic INSERT uses all `req.body` keys | Join/display fields may hit DB | Whitelist columns per table |
| **Medium** | `import-students` / students POST | No unique constraint on `admission_no` | Duplicates on re-import | `UNIQUE` index + MERGE/upsert |
| **Medium** | `server.ts:352-358` | Migration UPDATE runs on **every** connect | Startup side effects | One-time migration flag/table |
| **Low** | `TABLE_MAP:165` | `FeeStructures` table may not exist in `schema.sql` | Schema drift | Align schema or remove subscription |

---

## 5. API issues

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Critical** | `server.ts` (auth) | JWT never validated on protected routes | Missing middleware | `jwt.verify` middleware |
| **High** | `server.ts:1491` | `GET /api/:collection` can shadow intent (e.g. typo → 404) | Catch-all generic route | Document allowed collections; validate |
| **Medium** | `dataService.ts:66-74` | `getAll` swallows errors → `[]` | Silent failure | Re-throw or return `{ error }` |
| **Medium** | `server.ts:426-428` | `/api/health` doesn’t check DB | Misleading “ok” | Include `pool.connected` |
| **Low** | `server.ts:792-795` | `feevouchers` GET 307 redirect | Unnecessary hop | Internal handler reuse |

---

## 6. Exception handling

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `server.ts:365-368, 415-417` | Server starts when DB connect fails | `connectToDb` catches, continues | Fail fast or disable API routes |
| **Medium** | `server.ts:1626-1628` | Login errors hit generic handler via `next(error)` | Inconsistent with other routes | Local try/catch + 401/503 |
| **Medium** | `dataService.ts:40-43` | Some methods throw, `getAll` does not | Inconsistent | Unified error type |
| **Low** | Multiple pages | `catch (error: any)` without user detail | Generic toasts | Surface `response.data.message` |

---

## 7. Missing validations

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `server.ts:903-923` | QuickPay callback: no amount/signature check | Trusts body | Verify with gateway; update `paid_amount` |
| **Medium** | `server.ts:1067+` | Student POST: no required field checks | Missing server validation | Validate campusId, classId, admission_no |
| **Medium** | `server.ts:1517` | Generic POST: no schema validation | Accepts arbitrary JSON | Zod/joi per collection |
| **Medium** | `FeeManagement.tsx:107` | Payment amounts not validated server-side | Negative/overpay possible | Clamp `receivedAmount` ≤ balance |
| **Low** | `Login.tsx` | Client-only required fields | No server rate limit | Add rate limiting on login |

---

## 8. Memory leaks / resource leaks

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Medium** | `Dashboard.tsx:52-146` | If `getAll('dashboard-stats')` throws before return cleanup, intervals may leak | Cleanup inside try after subscriptions | Register subscriptions after successful setup; cleanup in `finally` |
| **Low** | `CommandPalette.tsx:37-38` | Global keydown listener | Properly cleaned on unmount | OK — already has cleanup |
| **Low** | `dataService.ts:133` | Intervals stack if `subscribe` called without cleanup | Caller responsibility | Document; use `useRef` guard |

---

## 9. Dead / unreachable code

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Medium** | `App.tsx:13`, no route | `Attendance` imported, never routed | Incomplete feature | Add route + menu or remove import |
| **Medium** | `server.ts:1168-1285` | `/api/import-excel` broken (memory multer) | Dead/broken endpoint | Fix or delete |
| **Low** | `seed.ts` | Not wired to `npm` scripts | Orphan file | Add `npm run seed` or remove |
| **Low** | `package.json` | `clsx`, `tailwind-merge`, `@google/genai` unused in `src/` | Dead dependencies | Remove or use |

---

## 10. Duplicate / redundant code

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Medium** | `server.ts` | Campus/class/student CRUD duplicated vs generic routes | Parallel implementations | Keep specialized routes; thin wrappers |
| **Medium** | `FeeManagement.tsx:107` vs `dataService.update` | Direct `axios.put` bypasses service | Inconsistency | Use `dataService.update('fees', ...)` |
| **Low** | `server.ts:792-900` | `feevouchers` aliases duplicate `fees` | Legacy naming | Single endpoint name in client |

---

## 11. Bad coding practices

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `server.ts` (~1662 lines) | God file — all API + DB + migrations | No separation | Split `routes/`, `db/`, `middleware/` |
| **Medium** | Widespread `any` | `dataService`, pages, generic CRUD | No typing on collections | Generics or per-entity services |
| **Medium** | `server.ts` — no `dotenv` | `.env` ignored at runtime | Missing import | `import 'dotenv/config'` at top |
| **Low** | `package.json:1` | Project name `react-example` | Template leftover | Rename package |
| **Low** | `FeeManagement.tsx:5` | Extra `axios` import | Bypasses shared instance | Use `dataService` api |

---

## 12. UI/UX inconsistencies

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `Layout.tsx` vs `App.tsx` | Role menus promise pages that 404/redirect | Route/menu mismatch | Single source of truth for RBAC |
| **Medium** | `types.ts:85` vs server | Fee status `Partially Paid` missing from type | Drift | Sync types |
| **Medium** | `App.tsx:39` vs `index.css` | Loading spinner uses `gray-*`; app uses `slate-*` | Inconsistent tokens | Use theme classes |
| **Low** | External `picsum.photos` images | Login depends on third-party CDN | Offline broken images | Local assets in `public/` |
| **Low** | `QuickPaySetup.tsx:266` | Uses `bg-error` (non-theme) | Invalid Tailwind token | Use `danger` |

---

## 13. Scalability concerns

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **High** | `server.ts:419`, `75-78` | Single process, hardcoded port, pool max 10 | Monolith limits | Env `PORT`; tune pool; horizontal scale + reverse proxy |
| **Medium** | Polling architecture | O(users × pages × 12 req/min) | No WebSocket/cache | SSE or React Query with staleTime |
| **Medium** | `server.ts:239-245` | `connectToDb` may create multiple pools | Re-call on each route | Singleton pool with reconnect logic |
| **Low** | In-memory multer | Large Excel loads full file in RAM | No size limit | `limits: { fileSize }` on multer |

---

## 14. Dependency / version issues

| Sev | Location | Issue | Root cause | Fix |
|-----|----------|-------|------------|-----|
| **Medium** | `package.json:19` | `axios@^1.14.0` — version may not exist on npm | Typo / invalid range | Pin `^1.7.9` (verify with `npm install`) |
| **Medium** | `package.json:39,49` | `vite` in dependencies **and** devDependencies | Duplicate declaration | Keep in devDependencies only |
| **Low** | `package.json:16-17` | `@types/*` in dependencies | Should be devDependencies | Move to devDependencies |
| **Low** | `xlsx@0.18.5` | Known prototype pollution advisories | Old package | Migrate to `sheetjs` CE or validate inputs |

---

## 15. Production-impacting quick reference

| Priority | Count | Top items |
|----------|-------|-----------|
| P0 | 6 | No API auth, admin password reset, forged roles, broken roles/routes, `.env`/secrets, login without DB guard |
| P1 | 12 | Polling load, fee stats wrong, fee-settings bug, import-excel broken, N+1 fee gen, CORS/QuickPay |
| P2 | 14+ | Validations, pagination, dead code, UX tokens, schema drift |

See **`PRIORITY_FIXES.md`** for ordered remediation and **`QUICK_WINS.md`** for fast patches.
