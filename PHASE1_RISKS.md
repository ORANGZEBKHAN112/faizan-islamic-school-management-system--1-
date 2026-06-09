# Phase 1 Risks & Follow-ups

## Immediate risks

| Risk | Severity | Detail | Mitigation |
|------|----------|--------|------------|
| **GET APIs still public** | High | Any client can read students, fees, campuses without a token | Phase 2: protect GET `/api/*` or add read-scoped tokens |
| **QuickPay callback** | High | `POST /api/payments/quickpay-callback` now requires JWT; external gateway cannot call it | Add signed webhook exemption or service API key |
| **Excel import** | Medium | `POST /api/import-students` requires auth — OK if UI sends token; breaks unauthenticated scripts | Document; use Bearer in integrations |
| **Default JWT secret** | High (dev) | Non-production still falls back to hardcoded secret | Set `JWT_SECRET` in `.env` for all environments |
| **Login without DB guard** | Medium | `pool` undefined → 500 on login if DB down | P0 item 6 in `PRIORITY_FIXES.md` |
| **`.env` secrets** | Critical | `.env.example` may contain real credentials if committed | Rotate credentials; use placeholders only |

## Operational

| Item | Notes |
|------|--------|
| Server restart required | Middleware not active until `tsx server.ts` restarted |
| Port 3000 conflict | `EADDRINUSE` if old process still running — stop before `npm run dev` |
| `authService.getCurrentUser` | Still calls `/api/auth/me/:username` (not implemented); frontend unchanged — use `/api/auth/me` in Phase 2 |
| CORS | Still wide open; unrelated to this phase |

## Regression watchlist

- Third-party POST webhooks (QuickPay)
- Cron/scripts hitting mutating APIs without `Authorization`
- First-time deploy: admin seeded once with `admin123` only if user missing

## Recommended Phase 2 (not done here)

1. Validate JWT on app load via `GET /api/auth/me`
2. Align `authService` with `/api/auth/me` (no `:username` in path)
3. Exempt or sign QuickPay callback
4. Optional: protect sensitive GET routes (students, fees, users)
5. Login `503` when database unavailable
