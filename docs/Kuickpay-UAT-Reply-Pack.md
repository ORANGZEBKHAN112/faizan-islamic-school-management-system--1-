# Kuickpay UAT pack — what to send them

Kuickpay asked for:
1. **API collection**
2. **Unpaid vouchers** (consumer numbers) for testing

## Files to share

| File | Purpose |
|------|---------|
| `docs/Kuickpay-BPS.postman_collection.json` | Import into Postman |
| `docs/Kuickpay-BPS-Integration-Sheet.md` | Spec (already reviewed) |

Before sending, fill collection variables:

- `baseUrl` — live HTTPS ERP URL (example: `https://erp.yourdomain.com`)
- `bpsUsername` / `bpsPassword` — from ERP **Kuickpay Setup** (same values Kuickpay will use in headers)
- `consumerNumber` — real unpaid 18-digit numbers from the table below

## Suggested email / WhatsApp reply

```text
Thank you for the confirmation.

Please find attached:
1. Postman collection — Kuickpay-BPS.postman_collection.json
2. Unpaid test vouchers (consumer numbers) below

Base URL:
http://31.97.105.2:3000

Endpoints:
- POST http://31.97.105.2:3000/api/v1/BillInquiry
- POST http://31.97.105.2:3000/api/v1/BillPayment
- POST http://31.97.105.2:3000/api/v1/payment   (alias)

Auth (HTTP headers on every call):
username: <BPS_USERNAME>
password: <BPS_PASSWORD>

Test unpaid consumer numbers (UAT):
| # | Consumer Number (18) | Student / note | Approx. amount (PKR) |
|---|----------------------|----------------|----------------------|
| 1 | ____________________ |                |                      |
| 2 | ____________________ |                |                      |
| 3 | ____________________ |                |                      |

Notes:
- Partial payments are not supported — Payment amount must equal Inquiry outstanding (13 digits, no +).
- Please run Inquiry first, then Payment with the amount returned.
- Kindly confirm when UAT connectivity tests are done.
```

## How to pull unpaid vouchers (ERP / SQL)

On the live DB (VPS), run:

```sql
SELECT TOP 10
  f.id AS fee_id,
  f.kuickpay_consumer_number AS consumer_number,
  f.status,
  f.total_amount,
  f.paid_amount,
  (ISNULL(f.total_amount, 0) - ISNULL(f.paid_amount, 0)) AS outstanding,
  f.due_date,
  s.student_name,
  s.admission_no
FROM Fees f
LEFT JOIN Students s ON s.id = f.student_id
WHERE f.kuickpay_consumer_number IS NOT NULL
  AND LTRIM(RTRIM(f.kuickpay_consumer_number)) <> ''
  AND UPPER(LTRIM(RTRIM(f.status))) IN ('UNPAID', 'PARTIAL', 'PENDING', 'GENERATED')
  AND (ISNULL(f.total_amount, 0) - ISNULL(f.paid_amount, 0)) > 0
ORDER BY f.due_date DESC;
```

Or in ERP UI:

1. Open **Fee Management**
2. Filter **Unpaid**
3. Open voucher / PDF — copy **Consumer Number** (18 digits)
4. Confirm **Kuickpay Setup** is enabled and prefix + BPS user/pass are set

If consumer numbers are blank on unpaid fees, open **Kuickpay Setup**, ensure prefix is set, then regenerate / open vouchers so numbers are assigned.

## Checklist before you hit Send

- [ ] Public HTTPS `baseUrl` works (`GET /api/health`)
- [ ] Kuickpay IPs can reach the host (whitelist if needed)
- [ ] BPS username/password match ERP Kuickpay Setup
- [ ] At least 2–3 **unpaid** consumer numbers with known amounts
- [ ] Do **not** send production passwords in chat groups if avoidable — share securely
