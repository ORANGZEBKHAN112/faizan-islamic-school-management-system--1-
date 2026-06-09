# Priority Fixes

Ordered by production impact. Estimate: **P0 ~1–2 days**, **P1 ~2–3 days**, **P2 ~3–5 days**.

---

## P0 — Ship blockers (do first)

### 1. API authentication [Critical]
- **Files:** `server.ts` (after line 422), all mutating routes
- **Action:** Add JWT middleware; reject unauthenticated writes.
```ts
function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  try {
    (req as any).user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ message: 'Invalid token' }); }
}
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  return authenticate(req, res, next);
});
```

### 2. Stop admin password reset on boot [Critical]
- **File:** `server.ts:395-402`
- **Action:** Remove the `UPDATE passwordHash` branch; only `INSERT` when user missing.

### 3. Secrets & env loading [Critical]
- **Files:** `server.ts:1`, `.env.example`
- **Action:** `import 'dotenv/config'`; fail if `!process.env.JWT_SECRET` in production; replace example credentials with placeholders.

### 4. Role/route alignment [Critical]
- **Files:** `App.tsx:54-68`, `Layout.tsx:67-77`
- **Action:** Register routes for Teacher (`/students`), Accountant (`/fees`, `/expenses`, `/reports`) OR remove from menu.

### 5. Client auth trust [Critical]
- **Files:** `App.tsx:22-28`, new `GET /api/auth/me`
- **Action:** On load, verify JWT server-side; clear storage if invalid.

### 6. Login when DB down [High→P0]
- **File:** `server.ts:1588`
- **Action:** Guard `if (!pool?.connected) return res.status(503).json(...)`.

---

## P1 — High impact (week 1)

### 7. QuickPay callback hardening [High]
- **File:** `server.ts:903-925`
- **Action:** Verify signature; set `paid_amount`, `balance_amount`; idempotency on `transaction_id`.

### 8. Fee-settings `campusId=all` [High]
- **Files:** `FeeManagement.tsx:69-75`, `server.ts:652-655`
- **Action:** Don't call API when `selectedCampus === 'all'`.

### 9. Fee settings exam/transport/misc [High]
- **Files:** `server.ts:657-708`, `FeeSettings.tsx`
- **Action:** Include `exam_fee`, `transport_fee`, `misc_fee` in GET/POST/UPDATE.

### 10. Fix financial stats [High]
- **Files:** `Dashboard.tsx:104-105`, `FeeManagement.tsx:36-37`, `Reports.tsx:58-59`
- **Action:** Sum `paidAmount` for collected; `balanceAmount` or `Unpaid`+`Partially Paid` for outstanding.

### 11. Replace 5s polling [High]
- **File:** `dataService.ts:121-134`
- **Action:** Remove `setInterval`; fetch on mount + after mutations; optional 60s refresh on Dashboard only.

### 12. Fee generation N+1 [High]
- **File:** `server.ts:977-1052`
- **Action:** Preload existing `(student_id, month, year)` set; bulk insert new rows in one transaction.

### 13. Restrict generic CRUD [High]
- **File:** `server.ts:1491-1579`
- **Action:** Remove `users` from `TABLE_MAP`; require admin role for DELETE.

### 14. Fix `/api/import-excel` or remove [High]
- **File:** `server.ts:1174`
- **Action:** `XLSX.read(req.file.buffer, { type: 'buffer' })` or delete route.

### 15. `PUT /api/feevouchers` body loss [Medium]
- **File:** `server.ts:897-900`
- **Action:** Invoke fee update handler directly instead of `res.redirect`.

---

## P2 — Stability & quality (week 2+)

| # | Item | File(s) |
|---|------|---------|
| 16 | Add pagination to list endpoints | `server.ts` generic + students/fees |
| 17 | Whitelist generic INSERT columns | `server.ts:1524-1536` |
| 18 | Unique index on `Students.admission_no` | `Database/schema.sql` |
| 19 | Attendance route or remove dead page | `App.tsx`, `Layout.tsx` |
| 20 | `express.json` size limit + multer `fileSize` | `server.ts:422`, multer config |
| 21 | Split `server.ts` into modules | new `routes/`, `db/pool.ts` |
| 22 | Sync `Fee.status` type with server | `types.ts:85` |
| 23 | Fix `axios` version + dedupe `vite` | `package.json` |
| 24 | CORS allowlist | `server.ts:421` |
| 25 | Health check includes DB status | `server.ts:426` |

---

## Suggested sprint plan

| Day | Focus |
|-----|--------|
| 1 | P0 items 1–3, 6 |
| 2 | P0 items 4–5 |
| 3 | P1 items 7–10 |
| 4 | P1 items 11–14 |
| 5 | P2 + regression test (login, fees, import, roles) |

---

## Verification checklist

- [ ] Unauthenticated `DELETE /api/students/:id` → 401
- [ ] Change admin password → restart server → password **unchanged**
- [ ] Teacher login → Students page loads
- [ ] Accountant login → Fees page loads
- [ ] Record partial payment → status `Partially Paid` → dashboard totals correct
- [ ] Excel import via Student Management succeeds
- [ ] No request every 5s when idle on Reports (after polling fix)
