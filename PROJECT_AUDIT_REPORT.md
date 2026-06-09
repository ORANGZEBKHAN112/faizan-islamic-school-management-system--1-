# Project Audit Report

Audit date: 2026-06-06

## Current State

The active project is a React 19 + Vite + Tailwind 4 frontend in `src/` served by a single Express + SQL Server process in `server.ts`. The legacy Angular `Frontend/` and .NET `Backend/` folders are present but are not the active runtime path.

What is already working or substantially implemented:

- Single command development flow through `npm run dev`, with Express serving both `/api` and the Vite app.
- Login flow with JWT issue, `localStorage` persistence, and `/api/auth/me` session verification.
- Main admin UI shell with role-filtered navigation, dark mode, command palette, toasts, and animated modals.
- Core modules for campuses, classes, students, fee settings, fee vouchers, attendance, expenses, reports, dashboard, QuickPay setup, and Excel student import.
- Dedicated server routes exist for students, campuses, classes, fee settings, fee retrieval/update, monthly fee generation, QuickPay callback, dashboard stats, and Excel import.
- TypeScript check passes: `npm run lint`.
- Production build succeeds: `npm run build`.

## Confirmed Checks

- `npm run lint` completed successfully with `tsc --noEmit`.
- `npm run build` completed successfully with Vite.
- Build warning: the main generated JS chunk is about `1,735.85 kB` before gzip, above Vite's default 500 kB warning threshold.

## Highest Priority Issues

1. `README.md` describes Firebase, Google login, and setup through the legacy `.NET` appsettings file. That does not match the current Express + SQL Server app, so a new developer or deployment agent can follow the wrong setup.

2. `.env.example` contains real-looking SQL Server host, username, password, and database values. Even in an example file, this should be treated as a credential exposure risk and replaced with safe placeholders.

3. `Database/schema.sql` is stale compared with `server.ts` and `Database/setup_and_seed.sql`. It uses `outstandingFees` instead of `outstanding_fees`, lacks several active tables or columns, and does not represent the current QuickPay, attendance, expenses, or fee tracking model.

4. Expense creation is likely broken. `src/pages/Expenses.tsx` submits a required `title`, but `server.ts` generic insert whitelist for `Expenses` does not allow `title`. Since `Database/setup_and_seed.sql` defines `Expenses.title` as `NOT NULL`, adding an expense can fail at the database layer.

5. Student creation partially succeeds then fails when creating a linked user. `StudentManagement.tsx` calls `dataService.add('users')`, which maps to `/api/auth/register`, but `server.ts` has no `/api/auth/register` route. The payload also does not include `passwordHash`, while the `Users` table requires it.

6. Attendance displays blank student identity fields. `src/pages/Attendance.tsx` renders `student.admissionNo` and `student.studentName`, but the active student DTO uses `rollNumber` and `firstName`.

7. Command palette contains dead navigation. `src/components/CommandPalette.tsx` links to `/exams`, but `src/App.tsx` has no exams route, so selecting it falls back to `/`.

8. QuickPay callback path is inconsistent. `QuickPaySetup.tsx` suggests `/api/quickpay/callback`, but the server exposes `/api/payments/quickpay-callback`.

9. QuickPay transactions may fail on fresh databases. The UI and callback insert `transaction_ref` and `payment_method`, but the active setup script's `Transactions` table does not include those columns, and startup migration does not add them.

10. API authorization is incomplete. `server.ts` protects mutating API requests and `/api/auth/me`, but most `GET /api/*` data endpoints remain public if the server is reachable.

11. `GET /api/quickpay-config` can expose `api_key` through the generic unauthenticated `GET /api/:collection` route.

12. The Fee Structures tab is not backed by a reliable table. `FeeManagement.tsx` uses `feeStructures`, but `FeeStructures` is not present in the active SQL Server setup files.

13. QuickPay transaction inserts use `transaction_ref` and `payment_method`, but the active transaction table definitions do not consistently include those columns.

14. Student “Has Dues” filtering is broken because it compares the student status enum to `unpaid`, which is not a valid student status.

15. Command palette student search navigates to `/students?search=...`, but `StudentManagement.tsx` only reads an `id` query parameter.

16. Campus code and active status are not persisted correctly: the UI collects them, but the dedicated campus SQL routes ignore them, and campus code is read back as the campus name.

17. App route access and sidebar nav access diverge for some roles, such as Admin campuses/expenses access.

18. Dashboard and QuickPay contain dead UI controls, including “View Gallery”, period selector, and “Reconcile All”.

## Other Risks

- Generic `PUT /api/:collection/:id` can generate invalid SQL if called with an empty request body.
- Generic CRUD returns full tables without pagination unless a dedicated route implements it.
- `authService.ts` creates its own axios client instead of reusing the shared API client, so auth behavior can drift from `dataService`.
- `dataService.fetchCampuses()` logs API data to the console.
- `dataService.getAll()` catches errors and returns `[]`, which makes 401/404/503 and missing-table failures look like empty data.
- Login and dashboard use remote `picsum.photos` images, which can fail offline and may be unsuitable for production branding.
- Attendance saves by deleting all existing records for a class/date and then inserting new ones. A failure halfway through can leave partial attendance.
- Role gates are client-driven. Server-side role authorization is limited and should not be considered complete protection.
- QuickPay webhook signature validation is optional when a signature or API key is missing.
- Inactive users can still log in because login does not check `isActive`.
- `package.json` has a Unix-only `clean` script (`rm -rf dist`), which will not work in default Windows PowerShell.
- No automated unit, integration, or workflow tests are configured beyond TypeScript compilation.

## Recommended Next Work

Start with the items that break real workflows:

- Replace `.env.example` secrets with placeholders.
- Make `Database/schema.sql` the current SQL Server source of truth and align it with `setup_and_seed.sql`, `TABLE_MAP`, and `COLUMN_MAP`.
- Fix expense inserts by allowing `title` and any required columns.
- Either implement `/api/auth/register` safely or remove automatic user creation from student registration until the workflow is designed.
- Fix attendance display fields to use `rollNumber` and `firstName`.
- Remove or implement the `/exams` route.
- Align the QuickPay callback URL and transaction columns.
- Fix the student dues filter, command palette query parameter, campus persistence, and App/Layout role mismatch.
- Remove or wire dead UI controls.

Then harden the platform:

- Add server-side auth and role checks for sensitive `GET` routes.
- Add a dedicated safe QuickPay config route that never returns secrets.
- Require QuickPay webhook signatures when QuickPay is enabled.
- Replace delete-and-reinsert attendance with an upsert transaction.
- Add focused workflow tests for login, student creation, expense CRUD, attendance save, fee generation, and payment recording.
- Update `README.md` to match the active stack and deployment model.
- Add route-level code splitting to reduce the production bundle warning.

