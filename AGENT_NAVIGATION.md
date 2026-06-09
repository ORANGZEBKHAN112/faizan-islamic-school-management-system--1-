# Agent Navigation Guide

Read this after `PROJECT_CONTEXT.md` when you need to move fast in this repo.

## Active Stack

- Frontend: `src/` React 19 + Vite + Tailwind 4.
- Backend/API: `server.ts` Express + raw `mssql`.
- Database source files: `Database/schema.sql` and `Database/setup_and_seed.sql`.
- Run command: `npm run dev`.
- Checks: `npm run lint`, `npm run build`.

Avoid scanning these unless the task explicitly asks:

- `node_modules/`
- `dist/`
- `Frontend/` legacy Angular app
- `Backend/` legacy .NET app
- `Database/FaizanIslamicSchool_MySQL.sql` legacy MySQL reference

## First Files To Open

- `PROJECT_CONTEXT.md`: project rules and source-of-truth overview.
- `server.ts`: API routes, auth middleware, SQL connection, schema patches, `TABLE_MAP`, `COLUMN_MAP`.
- `src/App.tsx`: route gates by role.
- `src/components/Layout.tsx`: sidebar menu gates by role.
- `src/services/dataService.ts`: shared API client and collection endpoint mapping.
- `src/services/authService.ts`: login/register helpers.
- `src/types.ts`: frontend domain types.
- `Database/schema.sql`: intended base schema.
- `Database/setup_and_seed.sql`: fuller fresh setup and seed script.

## Main Frontend Modules

- Dashboard: `src/pages/Dashboard.tsx`
- Campuses: `src/pages/CampusManagement.tsx`
- Classes: `src/pages/ClassManagement.tsx`
- Students and Excel import: `src/pages/StudentManagement.tsx`
- Fee settings: `src/pages/FeeSettings.tsx`
- Fees, vouchers, payment recording, PDF export: `src/pages/FeeManagement.tsx`
- Attendance: `src/pages/Attendance.tsx`
- Expenses: `src/pages/Expenses.tsx`
- Reports: `src/pages/Reports.tsx`
- QuickPay setup and transaction view: `src/pages/QuickPaySetup.tsx`
- Command palette: `src/components/CommandPalette.tsx`
- Error UI: `src/components/ErrorBoundary.tsx`

## Backend Route Map

- Health: `GET /api/health`
- Auth: `POST /api/auth/login`, `GET /api/auth/me`
- Students: `GET|POST|PUT /api/students`, `POST /api/import-students`
- Campuses: `GET|POST|PUT /api/campuses`
- Classes: `GET|POST|PUT /api/classes`
- Fee settings: `GET|POST /api/fee-settings`
- Fees: `GET /api/fees`, `GET /api/feevouchers`, `PUT /api/fees/:id`, `PUT /api/feevouchers/:id`
- Fee generation: `POST /api/generate-monthly-fees`
- QuickPay callback: `POST /api/payments/quickpay-callback`
- Dashboard stats: `GET /api/dashboard-stats`
- Generic CRUD: `GET|POST|PUT|DELETE /api/:collection` for entries in `TABLE_MAP`

## Data Mapping Rules

- UI uses camelCase fields.
- SQL mostly uses snake_case fields.
- Add or change persisted fields in all relevant places:
  - `src/types.ts`
  - `Database/schema.sql`
  - `server.ts` `COLUMN_MAP`
  - `server.ts` `TABLE_MAP` if adding a table
  - dedicated SQL route or generic whitelist if using generic CRUD

Important examples:

- `rollNumber` maps to `admission_no`.
- `firstName` maps to `student_name`.
- `campusId` maps to `campus_id`.
- `classId` maps to `class_id`.
- `outstandingFees` maps to `outstanding_fees`.
- `paidAmount` maps to `paid_amount`.

## Common Change Checklist

For a new page:

1. Add or extend types in `src/types.ts`.
2. Add service calls through `dataService`, not a new axios client.
3. Add a route in `src/App.tsx`.
4. Add a matching menu item in `src/components/Layout.tsx`.
5. Add server route or generic table mapping in `server.ts`.
6. Update SQL schema files if persistence changes.

For a new table:

1. Add SQL to `Database/schema.sql`.
2. Add seed/setup SQL to `Database/setup_and_seed.sql` if useful.
3. Add `TABLE_MAP` entry in `server.ts`.
4. Add `COLUMN_MAP` entries for non-identical field names.
5. Add generic insert whitelist or a dedicated route.

For a workflow bug:

1. Trace the page in `src/pages/`.
2. Trace the collection endpoint in `src/services/dataService.ts`.
3. Trace the exact route in `server.ts`.
4. Compare response/request fields against `src/types.ts` and `COLUMN_MAP`.
5. Check the matching SQL table definition.

## Known Audit Starting Points

Use `PROJECT_AUDIT_REPORT.md` before starting fixes. It lists confirmed issues and recommended priority order from the last full audit.

