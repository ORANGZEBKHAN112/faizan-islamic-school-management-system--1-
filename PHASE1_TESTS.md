# Phase 1 Tests

## Automated

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npm run lint` | **PASS** |

## Runtime (localhost:3000)

Server must be restarted after pulling changes: `npm run dev`.

### Executed (2026-05-17)

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | `GET /api/health` | 200 | **200** |
| 2 | `POST /api/campuses` no `Authorization` | 401 | **401** |
| 3 | `PUT /api/campuses/:id` no token | 401 | **401** |
| 4 | `DELETE /api/campuses/:id` no token | 401 | **401** |
| 5 | `GET /api/auth/me` no token | 401 | **401** |
| 6 | `GET /api/students` no token | 200 (public GET) | **200** |

### Blocked (DB unavailable in audit environment)

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 7 | `POST /api/auth/login` `{username, passwordHash}` | 200 + token | **500** — `Connection is closed` / SQL login failed |
| 8 | `GET /api/auth/me` with Bearer token | 200 + user | Not run (no token) |
| 9 | Admin password unchanged after restart | Hash stable | **Code verified** — UPDATE removed; needs DB to compare hash before/after restart |

## Manual commands (PowerShell)

```powershell
# Public health
Invoke-RestMethod http://localhost:3000/api/health

# Unauthorized mutate
Invoke-WebRequest http://localhost:3000/api/campuses -Method POST `
  -ContentType "application/json" -Body '{"campusName":"Test"}' `
  -SkipHttpErrorCheck | Select-Object StatusCode

# Login (requires working SQL Server)
$login = Invoke-RestMethod http://localhost:3000/api/auth/login -Method POST `
  -ContentType "application/json" `
  -Body '{"username":"admin","passwordHash":"admin123"}'

# auth/me
Invoke-RestMethod http://localhost:3000/api/auth/me `
  -Headers @{ Authorization = "Bearer $($login.token)" }

# Authorized POST
Invoke-RestMethod http://localhost:3000/api/campuses -Method POST `
  -Headers @{ Authorization = "Bearer $($login.token)" } `
  -ContentType "application/json" `
  -Body '{"campusName":"Test Campus","city":"Multan"}'
```

## Frontend smoke (unchanged UI)

1. Login as `admin` / `admin123` — should still work when DB is up (axios already sends Bearer on API calls).
2. Create campus/student/fee — should work with token from login.
3. If mutations fail with 401 after login, confirm `localStorage.token` is set and server was restarted.

## Admin password restart test

```sql
-- Before restart: note hash
SELECT passwordHash FROM Users WHERE username = 'admin';
-- Restart server (npm run dev)
-- After restart: hash must be identical
SELECT passwordHash FROM Users WHERE username = 'admin';
```
