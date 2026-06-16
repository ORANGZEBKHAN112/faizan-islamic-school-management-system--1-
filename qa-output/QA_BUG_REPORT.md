# FISS ERP — QA Bug Report (post-fix)

**Date:** 2026-06-16  
**Environment:** `http://localhost:3000`  
**Re-run after bug fixes:** API smoke **0 bugs**, all UI screenshots OK

## Fixes applied

| Bug | Fix |
|-----|-----|
| BUG-001 | `GET /api/admissions` gated with `requireModulePermission` + Express 4-safe async middleware |
| BUG-004 | `tracking_no` / `student_bform` added to schema ELSE branch; early `ensureAdmissionExtendedSchema` |
| BUG-002 | `seedDemoUsers()` on startup (teacher, accountant, campusadmin, superadmin) |
| BUG-003 | `normalizeStaffUsernames` — `STU-2026-0002` → `danish2` |
| BUG-005–007 | i18n on students actions, public apply/track, `data-lang` on language switcher |
| BUG-008 | Student portal shows arrears note; `feeLineBalance` for consistent balance column |
| BUG-009 | `Principle` → `Principal` migration in DB |

## Test accounts

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Super Admin |
| `superadmin` | `superadmin123` | Super Admin |
| `campusadmin` | `campusadmin123` | Admin |
| `teacher` | `teacher123` | Teacher |
| `accountant` | `accountant123` | Accountant |
| `danish2` | `Test@123` | Principal |
| `STU-2026-0001` | `STU-2026-0001` | Student |

## Per-role API (latest)

| Role | Login | Admissions API |
|------|-------|----------------|
| Super Admin | OK | 200 |
| Admin | OK | 200 |
| Accountant | OK | 403 (no admissions permission) |
| Teacher | OK | 403 |
| Principal | OK (`danish2`) | 403 |
| Student | OK | 403 |

## Screenshots

`qa-output/screenshots/` — login-en, login-ur, admin-*, principle-*, student-portal, public-apply, public-track

## Re-run QA

```bash
npm run dev
node scripts/qa-role-smoke.mjs
node scripts/qa-ui-screenshots.mjs
```
