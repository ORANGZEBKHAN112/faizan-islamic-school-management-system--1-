# Agent Map - Faizan Islamic School ERP

Routing index for agents. For architecture and conventions, read `PROJECT_CONTEXT.md` before coding. Always-on guardrails live in `.cursor/rules/project.mdc`.

## Stack

- Active frontend: `src/` React 19 + Vite + Tailwind 4.
- Active backend: `server.ts` Express + raw `mssql`.
- Active DB docs: `Database/schema.sql`, `Database/setup_and_seed.sql`.
- Run: `npm run dev` serves API and SPA from one process.

Do not scan first: `node_modules/`, `dist/`, `Frontend/`, `Backend/`, `Frontend/node_modules/`, legacy MySQL scripts.

## Active File Map

- `server.ts`: API routes, DB pool, auth middleware, SQL mapping, startup schema patches.
- `src/App.tsx`: routes and role gates.
- `src/components/Layout.tsx`: shell and sidebar `menuItems`.
- `src/components/CommandPalette.tsx`: Ctrl+K navigation.
- `src/components/ErrorBoundary.tsx`: crash UI.
- `src/services/dataService.ts`: shared API client and endpoint mapping.
- `src/services/authService.ts`: login helper; register/current-user paths are currently not reliable.
- `src/types.ts`: frontend domain interfaces.
- `src/utils/feeStats.ts`: fee aggregation helpers.
- `src/pages/Dashboard.tsx`: dashboard KPIs and charts.
- `src/pages/CampusManagement.tsx`: campus CRUD UI.
- `src/pages/ClassManagement.tsx`: class CRUD UI.
- `src/pages/StudentManagement.tsx`: students, import, profile, student fee history.
- `src/pages/FeeSettings.tsx`: per-class fee settings.
- `src/pages/FeeManagement.tsx`: vouchers, generation, payment, PDF export.
- `src/pages/Attendance.tsx`: daily attendance.
- `src/pages/Expenses.tsx`: expenses.
- `src/pages/Reports.tsx`: finance/report exports.
- `src/pages/QuickPaySetup.tsx`: QuickPay config and transaction logs.
- `Database/schema.sql`: intended SQL Server DDL, but currently stale.
- `Database/setup_and_seed.sql`: fuller fresh setup script.

## Task To File Routing

- New page or nav item: open `src/pages/`, `src/App.tsx`, `src/components/Layout.tsx`, `src/types.ts`.
- CRUD collection bug: open `src/services/dataService.ts`, `server.ts` `TABLE_MAP`, `COLUMN_MAP`, and relevant page.
- New table or column: update `Database/schema.sql`, `server.ts` `TABLE_MAP`, `COLUMN_MAP`, and generic insert whitelist or a dedicated route.
- Auth/session: open `src/pages/Login.tsx`, `src/services/dataService.ts` `verifySession`, and `server.ts` auth middleware/login.
- Fees/vouchers: open `src/pages/FeeManagement.tsx`, `src/pages/FeeSettings.tsx`, `src/utils/feeStats.ts`, and fee routes in `server.ts`.
- Students/import: open `src/pages/StudentManagement.tsx` and student/import routes in `server.ts`.
- QuickPay: open `src/pages/QuickPaySetup.tsx`, `quickpay-config` collection, and `/api/payments/quickpay-callback`.
- Attendance/expenses: open the page plus generic CRUD and whitelists in `server.ts`.
- Dashboard KPIs: open `src/pages/Dashboard.tsx` and `/api/dashboard-stats`.

## `server.ts` Anchors

- `1-96`: dotenv, JWT middleware, public route rules.
- `257-350`: `TABLE_MAP`, `COLUMN_MAP`, `TABLE_INSERT_WHITELIST`.
- `354-524`: DB connect, schema patches, `seedAdmin`.
- `525-552`: server startup and middleware.
- `553-602`: health and `/api/auth/me`.
- `603-832`: students, campuses, classes.
- `833-1213`: fee settings, fees, vouchers, QuickPay callback.
- `1214-1355`: monthly fee generation.
- `1357-1635`: student POST/PUT, import, dashboard stats.
- `1661-1765`: generic CRUD.
- `1766+`: login, SPA hosting, listen.

Refresh anchors when `server.ts` changes materially.

## API And Auth Reality

- Public: `GET /api/health`, `POST /api/auth/login`, `POST /api/payments/quickpay-callback`.
- Authenticated: all other `/api/*` routes require a valid JWT.
- Role-gated writes: dedicated routes and generic CRUD use `requireRoles` / `requireAdmin`; QuickPay config never returns `api_key`.
- Admin-only today: generic `DELETE /api/:collection/:id`.
- Generic collections include `students`, `campuses`, `classes`, `fees`, `feevouchers`, `transactions`, `feestructures`, `fee-settings`, `quickpay-config`, `attendance`, `expenses`.

Use `dataService` for page HTTP calls. Do not add page-local axios clients.

## Roles

- Super Admin: all admin routes, including fee settings.
- Admin: campuses, classes, students, fees, expenses, reports, quickpay, attendance in `App.tsx`; check `Layout.tsx` because nav can diverge.
- Teacher: students.
- Accountant: fees, expenses, reports.
- Student: dashboard only; no real portal routes yet.

When access changes, update both `src/App.tsx` and `src/components/Layout.tsx`.

## New Feature Checklist

1. Extend `src/types.ts`.
2. Add SQL to `Database/schema.sql`.
3. Update `server.ts` `TABLE_MAP`, `COLUMN_MAP`, and whitelist if generic CRUD is used.
4. Prefer a dedicated server route for joins, validation, or transactions.
5. Use `dataService` from the page.
6. Gate routes in `App.tsx` and nav in `Layout.tsx`.
7. Run `npm run lint` and `npm run build`.

## Deep Docs

- `PROJECT_CONTEXT.md`: source of truth before coding.
- `PROJECT_AUDIT_REPORT.md`: latest audit findings and fix order.
- `AGENT_NAVIGATION.md`: longer navigation guide retained for detail.
- `.cursor/rules/project.mdc`: applied project rules.

