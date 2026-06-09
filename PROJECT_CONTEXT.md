# Faizan Islamic School ERP — Project Context

> **Primary reference for AI/codegen.** Read this before implementing features.

## Active vs legacy stack

| | **Active (use this)** | **Legacy (reference only)** |
|---|---|---|
| UI | React 19 + Vite 6 + Tailwind 4 | `Frontend/` Angular 17 |
| API | Express 4 in `server.ts` | `Backend/` .NET 8 Web API |
| DB | SQL Server (`mssql`) | MySQL (`Database/*.sql`) |
| Run | `npm run dev` → `tsx server.ts` | See `README_FaizanIslamicSchool.md` |

`tsconfig.json` excludes `Frontend/`. Do not mix stacks unless explicitly migrating.

---

## 1. Tech stack

- **Runtime:** Node.js, ESM (`"type": "module"`)
- **Frontend:** React 19, React Router 7, TypeScript 5.8, Tailwind CSS 4 (`@tailwindcss/vite`)
- **Backend:** Express, `mssql`, JWT (`jsonwebtoken`), bcrypt, multer, `xlsx`, `date-fns`
- **UI libs:** `lucide-react`, `motion`, `sonner`, `recharts`, `jspdf` + autotable, `axios`, `clsx` / `tailwind-merge`
- **Dev:** `tsx`, Vite middleware embedded in Express (dev) or static `dist/` (prod)
- **Optional:** `@google/genai` via `GEMINI_API_KEY` in Vite env

---

## 2. Folder structure

```
/
├── server.ts              # Express API + DB + Vite/static (main backend)
├── seed.ts                # Sample data via dataService (optional)
├── package.json
├── vite.config.ts
├── tsconfig.json          # paths: @/* → project root
├── .env.example           # SQL_* vars
├── src/
│   ├── main.tsx, App.tsx, index.css, types.ts
│   ├── components/        # Layout, CommandPalette, ErrorBoundary
│   ├── pages/             # Feature screens (Dashboard, Students, Fees, …)
│   └── services/          # authService, dataService
├── Database/              # SQL Server schema + seeds (schema.sql, setup_and_seed.sql)
├── Backend/               # .NET layered API (not active path)
├── Frontend/              # Angular app (not active path)
└── web.config             # IIS SPA rewrite (production)
```

---

## 3. Architecture pattern

- **Monolith:** Single Node process — REST API + SPA host.
- **No ORM:** Raw SQL in `server.ts` via connection pool; startup runs schema patches / default admin seed.
- **API shape:** Dedicated routes for core domains + **generic** `GET|POST|PUT|DELETE /api/:collection` backed by `TABLE_MAP`.
- **DTO mapping:** `COLUMN_MAP` translates camelCase (frontend) ↔ snake_case (SQL columns).
- **Frontend:** Page-level components; shared `dataService` for HTTP; role-gated routes in `App.tsx` + `Layout` nav.
- **Auth:** JWT issued on login; token stored in `localStorage`; axios interceptor adds `Bearer` — **API routes are not JWT-guarded yet** (client-side gating only).

---

## 4. Coding conventions

- **Language:** TypeScript throughout; functional React components + hooks.
- **Imports:** Relative paths in `src/`; `@/` alias available (root).
- **Styling:** Tailwind utility classes; theme tokens in `src/index.css` (`primary`, `vibrant-card`, dark mode via `class` on `<html>`).
- **Feedback:** `toast` from `sonner` for user messages; `motion` for modals/sidebar.
- **API client:** Use `dataService` with collection names (`'students'`, `'campuses'`, …) — do not duplicate axios setup.
- **Types:** Domain interfaces in `src/types.ts`; keep frontend fields camelCase.
- **Password field:** Login sends plain password in `passwordHash` property; server bcrypt-compares to DB `passwordHash`.
- **IDs:** `crypto.randomUUID()` (or similar) for new SQL rows.
- **Lint:** `npm run lint` → `tsc --noEmit`.

---

## 5. Main business modules

| Module | Page | Backend focus |
|--------|------|----------------|
| Auth | `Login.tsx` | `/api/auth/login`, Users table |
| Dashboard | `Dashboard.tsx` | `/api/dashboard-stats` |
| Campuses | `CampusManagement.tsx` | `/api/campuses` |
| Classes | `ClassManagement.tsx` | `/api/classes` |
| Students | `StudentManagement.tsx` | `/api/students`, Excel import |
| Fee settings | `FeeSettings.tsx` | `/api/fee-settings` (Super Admin) |
| Fees / vouchers | `FeeManagement.tsx` | `/api/fees`, `/api/generate-monthly-fees` |
| QuickPay | `QuickPaySetup.tsx` | `quickpay-config`, callback |
| Attendance | `Attendance.tsx` | `attendance` collection |
| Expenses | `Expenses.tsx` | `expenses` collection |
| Reports | `Reports.tsx` | Aggregations + export (client PDF/Excel) |

**Roles:** `Super Admin` | `Admin` | `Teacher` | `Accountant` | `Student` — enforced in `App.tsx` routes and `Layout` menu.

---

## 6. Important APIs / services

### HTTP (`server.ts`)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | DB connectivity |
| POST | `/api/auth/login` | JWT + user |
| GET | `/api/students` | Joins campus/class names |
| CRUD | `/api/campuses`, `/api/classes` | Custom handlers |
| GET/POST | `/api/fee-settings` | Per-class fee config |
| GET/PUT | `/api/fees`, `/api/feevouchers` | Payment updates, outstanding balance |
| POST | `/api/generate-monthly-fees` | Bulk fee generation |
| POST | `/api/payments/quickpay-callback` | Payment webhook |
| POST | `/api/import-excel`, `/api/import-students` | multer + xlsx |
| GET | `/api/dashboard-stats` | KPIs |
| * | `/api/:collection` | Generic CRUD (`TABLE_MAP`) |

### Frontend services

- **`src/services/dataService.ts`** — axios instance, `add|update|delete|getAll|upload|subscribe` (5s poll), endpoint map.
- **`src/services/authService.ts`** — login/register/me (`register`/`me` may lack server handlers — prefer login).

### Config

- Env: `SQL_SERVER`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DATABASE`, `SQL_PORT`, `JWT_SECRET`
- Fallback: parses `Backend/.../appsettings.json` connection string if present

---

## 7. Database structure / models

**Engine:** SQL Server. Scripts: `Database/schema.sql`, `setup_and_seed.sql`.

**Core tables:** `Campuses`, `Classes`, `Students`, `Users`, `Staff`, `FeeSettings`, `Fees`, `FeeVouchers`, `Transactions`, `Attendance`, `Expenses`, `Inventory`, `QuickPayConfig` (via generic map).

**Key mappings** (`COLUMN_MAP` in `server.ts`):

- `rollNumber` → `admission_no`, `firstName` → `student_name`, `campusId` → `campus_id`, `classId` → `class_id`
- Fee fields: `paidAmount`, `balanceAmount`, `paymentHistory`, component fees (`tuition_fee`, etc.)

**Frontend models:** `src/types.ts` (`User`, `Student`, `Fee`, `Campus`, `Class`, …).

Default admin seeded at startup (username `admin` — see server boot logic).

---

## 8. Reusable components / utilities

| Asset | Location | Use |
|-------|----------|-----|
| `dataService` | `src/services/dataService.ts` | All CRUD + polling |
| `authService` | `src/services/authService.ts` | Login flow |
| `Layout` | `src/components/Layout.tsx` | Shell, sidebar, dark mode, logout |
| `CommandPalette` | `src/components/CommandPalette.tsx` | Ctrl/Cmd+K navigation |
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Error UI |
| `types.ts` | `src/types.ts` | Shared interfaces |
| CSS utilities | `src/index.css` | `vibrant-card`, theme colors |
| `TABLE_MAP` / `COLUMN_MAP` | `server.ts` | New collections / columns |
| Excel helpers | `server.ts` | `parseExcelDate`, `getVal` |

**Patterns in pages:** local `useState` + `useEffect`/`dataService.subscribe`; modals with `motion`; tables with lucide icons; filters + pagination (see `StudentManagement.tsx`).

---

## Commands

```bash
npm install
npm run dev      # API + Vite on one port
npm run build    # Vite → dist/
npm run lint
```

## Do not scan / edit casually

`node_modules/`, `dist/`, `build/`, `bin/`, `obj/`, `Frontend/node_modules/`

## Implementation checklist

1. Extend `types.ts` if new fields.
2. Add SQL + `COLUMN_MAP` / `TABLE_MAP` if new persistence.
3. Prefer dedicated route if logic is non-trivial; else generic `/api/:collection`.
4. Page UI: match existing Tailwind + `dataService` patterns.
5. Gate by role in `App.tsx` and `Layout` menu.
