# Faizan Islamic School ERP — Kuickpay BPS Integration Sheet

**Document for:** Kuickpay Integration / Merchant Support Team  
**Merchant:** Faizan Islamic School (FISS ERP)  
**Integration model:** Bill Payment System (BPS) — Merchant hosts Bill Inquiry & Bill Payment APIs  
**Date:** September 2026  
**Status:** Implemented — updated per Kuickpay review feedback  

---

## 1. Overview

Parents pay school fee vouchers using an **18-digit Consumer Number** via bank / Kuickpay channels.

Flow:

1. Parent enters **Consumer Number** at bank / Kuickpay.
2. Kuickpay calls merchant **Bill Inquiry** API.
3. Merchant returns bill status and payable amount.
4. After successful payment, Kuickpay calls merchant **Bill Payment** API.
5. Merchant marks the fee voucher as **fully paid** and stores the transaction.

**Important:** KuickPay does **not** support partial payments. The Payment API accepts only the **full outstanding** amount returned on Inquiry.

---

## 2. Production / Staging Base URL

Please configure Kuickpay routing to this public HTTPS base URL:

| Environment | Base URL (fill before share) |
|-------------|------------------------------|
| Production  | `https://YOUR-PUBLIC-DOMAIN` |
| Staging / UAT | `https://YOUR-STAGING-DOMAIN` |

> Replace with the live ERP host. Endpoints must be reachable from Kuickpay over **HTTPS (443)**.

### Kuickpay source IPs (whitelist on merchant firewall if required)

| Env | IP |
|-----|-----|
| DEV | `175.107.222.219` |
| UAT | `125.209.75.66` |
| PROD | `175.107.206.220` |

---

## 3. Endpoints to configure at Kuickpay

| API | Method | Full URL | Auth |
|-----|--------|----------|------|
| Bill Inquiry | `POST` | `{BASE_URL}/api/v1/BillInquiry` | HTTP headers `username` + `password` |
| Bill Payment | `POST` | `{BASE_URL}/api/v1/BillPayment` | HTTP headers `username` + `password` |
| Bill Payment (alias) | `POST` | `{BASE_URL}/api/v1/payment` | Same as Bill Payment |

**Content-Type:** `application/json`

These routes are **public** (no JWT). Security is via BPS username/password headers only.

---

## 4. Authentication

Every Bill Inquiry / Bill Payment request must include:

```http
username: <BPS_USERNAME>
password: <BPS_PASSWORD>
Content-Type: application/json
```

| Field | Source |
|-------|--------|
| `username` | BPS username for UAT and Live — provided by merchant team (configured in ERP Kuickpay Setup) |
| `password` | BPS password for UAT and Live — **alphanumeric**; provided by merchant team |

Invalid credentials → HTTP `401` with `response_Code: "04"`.

---

## 5. Consumer Number format

| Item | Value |
|------|--------|
| Length | **18 digits** |
| Structure | **5-digit institution prefix** + **13-digit serial** |
| Example | `01520` + `0000000000001` → `015200000000000001` |
| Prefix | **Institution Consumer Prefix (5 digits)** — provided by Business Team (**Daniyal Khan**); configured in ERP as Consumer Prefix |

Each unpaid fee voucher in ERP is assigned a unique consumer number. Parents see this number on the fee voucher PDF / slip.

**Preferred test consumer numbers / test bank channel for UAT:** provided by merchant team after prefix + credentials are set.

---

## 6. Bill Inquiry — `POST /api/v1/BillInquiry`

### Request body

```json
{
  "consumer_number": "015200000000000001"
}
```

Accepted aliases: `consumerNumber`, `ConsumerNumber`.

### Success — unpaid (`response_Code: "00"`, `Bill_Status: "U"`)

```json
{
  "response_Code": "00",
  "Consumer_Detail": "STUDENT NAME                  ",
  "Bill_Status": "U",
  "Due_Date": "20260831",
  "Amount_Within_DueDate": "+0000000120000",
  "Amount_After_DueDate": "+0000000120000",
  "email_address": "noreply@school.local",
  "contact_number": "03001234567",
  "Billing_Month": "2608",
  "Date_Paid": "        ",
  "Amount_Paid": "            ",
  "Tran_Auth_Id": "      ",
  "Reserved": "03001234567 | noreply@school.local",
  "consumer_number": "015200000000000001"
}
```

### Paid scenario (`response_Code: "00"`, `Bill_Status: "P"`)

- `Amount_Paid` = **12 numeric digits** (last 2 = paisa). Example: `"000000120000"` = PKR 1,200.00  
- `Date_Paid` = `YYYYMMDD`  
- `Tran_Auth_Id` = 6-digit auth when available  
- Payable amount fields = `+0000000000000`

### Blocked / expired (`response_Code: "02"`, `Bill_Status: "B"`)

Used when the voucher is **blocked** or **expired** (past `validity_date`) so **payment must not be accepted**.

```json
{
  "response_Code": "02",
  "Consumer_Detail": "STUDENT NAME                  ",
  "Bill_Status": "B",
  "Due_Date": "20260831",
  "Amount_Within_DueDate": "+0000000120000",
  "Amount_After_DueDate": "+0000000120000",
  "email_address": "noreply@school.local",
  "contact_number": "03001234567",
  "Billing_Month": "2608",
  "Date_Paid": "        ",
  "Amount_Paid": "            ",
  "Tran_Auth_Id": "      ",
  "Reserved": "03001234567 | noreply@school.local",
  "consumer_number": "015200000000000001",
  "message": "Voucher is blocked or expired"
}
```

### Field notes

| Field | Format / meaning |
|-------|------------------|
| `Bill_Status` | `U` = Unpaid, `P` = Paid, `B` = Blocked (expired / blocked) |
| `Due_Date` | `YYYYMMDD` |
| `Billing_Month` | `YYMM` |
| `Amount_Within_DueDate` / `Amount_After_DueDate` | AN14: `+` + 13 digits, last 2 = paisa |
| `Amount_Paid` (when paid) | **12 digits**, last 2 = paisa (no sign) |
| `Consumer_Detail` | Student name, padded/truncated to 30 chars |

### Error / status codes (Inquiry)

| `response_Code` | Meaning |
|-----------------|---------|
| `00` | Success (Unpaid or Paid) |
| `01` | Consumer number not found |
| `02` | Blocked / expired voucher (`Bill_Status` = `B`) |
| `04` | Invalid credentials / bad request |
| `05` | Processing / system error (or Kuickpay not enabled) |

---

## 7. Bill Payment — `POST /api/v1/BillPayment`

### Request body

```json
{
  "consumer_number": "015200000000000001",
  "tran_auth_id": "123456",
  "transaction_amount": "0000000120000",
  "tran_date": "20260827",
  "tran_time": "143055",
  "bank_mnemonic": "HBL",
  "Reserved": ""
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `consumer_number` | Yes | 18-digit consumer number |
| `tran_auth_id` | Yes | 6-digit auth / STAN |
| `transaction_amount` | Yes | **13 numeric digits, NO `+` sign**. Last 2 = paisa. Example: `"0000000120000"` = PKR 1,200.00. Must equal **full** outstanding from Inquiry. |
| `tran_date` | Yes | `YYYYMMDD` (Date Paid) |
| `tran_time` | Optional | `HHMMSS` |
| `bank_mnemonic` | **Optional** | Bank code / mnemonic |
| `Reserved` | Optional | Free text |

Aliases accepted: `consumerNumber`, `tranAuthId`, `transactionAmount`, `tranDate`, `tranTime`, `bankMnemonic`.

> Parser also accepts legacy `+`-prefixed AN14 for compatibility, but Kuickpay should send **without** `+`.

### Success response (`response_Code: "00"`)

```json
{
  "response_Code": "00",
  "Identification_Parameter": "00000001725123456789",
  "Reserved": ""
}
```

On success, ERP:

- Marks the fee voucher **Paid** (full amount only)
- Stores payment method = `Kuickpay`
- Writes `KuickpayPaymentLog` + transaction log

### Duplicate transaction rule (`03` vs `04`)

`03` (Duplicate Transaction) is returned **only** when **all four** match a prior payment log entry:

1. Consumer Number  
2. Tran_Auth_ID  
3. Amount Paid  
4. Date Paid (`tran_date`)

If the same Consumer Number + Tran_Auth_ID exist but **Amount** or **Date** (or any of the four) **mismatch** → **`04`**.

Already-paid voucher with a **new** (non-matching) attempt → **`04`** (not `03`).

### Error codes (Payment)

| `response_Code` | Meaning |
|-----------------|---------|
| `00` | Success |
| `01` | Voucher / consumer number does not exist |
| `02` | Voucher blocked or expired |
| `03` | Duplicate transaction (all four fields match) |
| `04` | Invalid credentials / invalid or partial amount / field mismatch on duplicate auth / already paid / missing required fields |
| `05` | Processing / system error (or Kuickpay not enabled) |

---

## 8. Amount encoding

### Inquiry payable (`Amount_Within_DueDate` / `Amount_After_DueDate`)

AN14: `+` + 13 digits, last 2 = paisa.

| PKR | Value |
|-----|--------|
| 1,200.00 | `+0000000120000` |

### Payment request (`transaction_amount`)

**13 digits, no `+`:**

| PKR | Value |
|-----|--------|
| 1,200.00 | `0000000120000` |

### Inquiry paid (`Amount_Paid`)

**12 digits, no sign**, last 2 = paisa:

| PKR | Value |
|-----|--------|
| 1,200.00 | `000000120000` |

---

## 9. Merchant checklist (for Kuickpay / Business)

| Item | Owner / status |
|------|----------------|
| Institution Consumer Prefix (5 digits) | Business Team — **Daniyal Khan** |
| BPS Username (Sandbox + Live) | Merchant team (ERP Kuickpay Setup) |
| BPS Password (Sandbox + Live, alphanumeric) | Merchant team |
| Whitelist Kuickpay IPs (DEV / UAT / PROD) | Merchant infra if required — see §2 |
| Preferred test consumer numbers / test bank channel (UAT) | Merchant team (after prefix + credentials) |
| Go-live date and cutover window | Joint |

---

## 10. Merchant checklist (our side — done)

- [x] Host Bill Inquiry API  
- [x] Host Bill Payment API  
- [x] Username/password header authentication  
- [x] 18-digit consumer number generation (prefix + serial)  
- [x] Print consumer number on fee voucher PDF  
- [x] Full-amount payment only (no partial)  
- [x] Inquiry `02` + `Bill_Status` `B` for blocked/expired  
- [x] Paid Inquiry `Amount_Paid` as 12 digits  
- [x] Payment `transaction_amount` without `+`  
- [x] Duplicate `03` only on four-field match; otherwise `04`  
- [x] `bank_mnemonic` optional  
- [x] Enable/disable Kuickpay from ERP admin screen  

---

## 11. Sample cURL (for connectivity test)

### Inquiry

```bash
curl -X POST "https://YOUR-PUBLIC-DOMAIN/api/v1/BillInquiry" \
  -H "Content-Type: application/json" \
  -H "username: YOUR_BPS_USERNAME" \
  -H "password: YOUR_BPS_PASSWORD" \
  -d "{\"consumer_number\":\"015200000000000001\"}"
```

### Payment

```bash
curl -X POST "https://YOUR-PUBLIC-DOMAIN/api/v1/BillPayment" \
  -H "Content-Type: application/json" \
  -H "username: YOUR_BPS_USERNAME" \
  -H "password: YOUR_BPS_PASSWORD" \
  -d "{
    \"consumer_number\":\"015200000000000001\",
    \"tran_auth_id\":\"123456\",
    \"transaction_amount\":\"0000000120000\",
    \"tran_date\":\"20260827\",
    \"tran_time\":\"143055\",
    \"bank_mnemonic\":\"HBL\"
  }"
```

---

## 12. Technical contact

| Role | Name | Email / Phone |
|------|------|---------------|
| School / Merchant contact | *(fill)* | *(fill)* |
| ERP / Technical contact | *(fill)* | *(fill)* |
| Kuickpay Business (prefix) | Daniyal Khan | *(fill)* |

---

## 13. Notes

- Kuickpay must be **enabled** in ERP admin (Kuickpay Setup) before Inquiry/Payment accept traffic.  
- Amounts on Inquiry are the **full outstanding** balance of the voucher.  
- **Partial payments are not supported** — Payment must post the full outstanding; otherwise `04`.  
- Expired vouchers (past validity date) and blocked statuses return Inquiry `02` / `Bill_Status` `B`; Payment against them returns `02`.  
- Legacy webhook `POST /api/payments/quickpay-callback` is **not** the primary BPS path; use Bill Inquiry + Bill Payment as above.

---

*Prepared for Kuickpay merchant onboarding / UAT. Updated per Kuickpay review (transaction_amount without +, blocked 02/B, no partial pay, Amount_Paid 12 digits, duplicate 03 four-field rule, optional bank_mnemonic).*
