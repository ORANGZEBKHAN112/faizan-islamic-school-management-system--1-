# Phase 1 Changes — P0 Auth & Config

**File modified:** `server.ts` only (no frontend changes).

## 1. Dotenv support

- Added `import "dotenv/config"` as the first import.
- Loads `.env` from project root before `JWT_SECRET` and SQL env vars are read.
- Production guard: exits with code 1 if `NODE_ENV=production` and `JWT_SECRET` is unset.

## 2. Admin password — no reset on startup

- **`seedAdmin()`** (`~430–450`): removed the `else` branch that ran `UPDATE Users SET passwordHash` on every boot.
- Admin is created only when `username = 'admin'` does not exist (default password `admin123` once).

## 3. JWT authentication middleware

- **`JwtPayload`** + `Express.Request.auth` typing.
- **`authenticate()`** — verifies `Authorization: Bearer <token>` with existing `JWT_SECRET` / `jwt.sign` payload shape (`id`, `username`, `role`).
- **`requireAuthForMutatingApi()`** — mounted after `express.json()`:
  - Skips non-`/api` paths.
  - Public: `GET /api/health`, `POST /api/auth/login`.
  - **`GET /api/auth/me`** — requires JWT (exception to GET bypass).
  - **`POST` / `PUT` / `PATCH` / `DELETE`** on `/api/*` — requires JWT.

## 4. `GET /api/auth/me`

- Registered after `/api/health` (before other routes).
- Uses `req.auth` from middleware; loads user from `Users` by `username`.
- Response shape matches login user object (+ `campusId`, `uid`).

## 5. API contracts preserved

| Endpoint | Change |
|----------|--------|
| `POST /api/auth/login` | Unchanged body/response; still public |
| `GET /api/health` | Still public |
| `GET /api/*` (other) | Still public (no auth on GET except `/api/auth/me`) |
| Mutating `/api/*` | Now **401** without valid Bearer token |

## TypeScript

- `npm run lint` (`tsc --noEmit`) — **passes** after `npm install`.

## Not in scope (deferred)

- Frontend token validation on app load
- Role/route alignment
- QuickPay callback exemption
- `server.ts` module split
