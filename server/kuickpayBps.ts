import type { ConnectionPool } from "mssql";
import crypto from "crypto";

export type KuickpayBillStatus = "U" | "P" | "B" | "T";

export interface KuickpayConfigRow {
  id?: string;
  merchant_id?: string;
  api_key?: string;
  bps_username?: string;
  bps_password?: string;
  consumer_prefix?: string;
  next_consumer_seq?: number;
  isEnabled?: boolean | number;
  mode?: string;
}

/** Inquiry payable amount — AN14: sign + 13 digits (last 2 = paisa). */
export function formatAmountWithinDueDate(amountPkr: number): string {
  const cents = Math.round(Math.max(0, amountPkr) * 100);
  const body = String(cents).padStart(13, "0").slice(-13);
  return `+${body}`;
}

/**
 * Payment API transaction_amount — 13 numeric digits, NO "+" sign.
 * Example: "0000000120000" = PKR 1,200.00
 */
export function formatTransactionAmount(amountPkr: number): string {
  const cents = Math.round(Math.max(0, amountPkr) * 100);
  return String(cents).padStart(13, "0").slice(-13);
}

/** Inquiry Amount_Paid — 12 numeric digits (last 2 = paisa), no sign. */
export function formatAmountPaid(amountPkr: number): string {
  const cents = Math.round(Math.max(0, amountPkr) * 100);
  return String(cents).padStart(12, "0").slice(-12);
}

/** Parse Kuickpay amount (+0000000012000, 0000000120000, or plain number) to PKR. */
export function parseKuickpayAmount(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  if (/^[+-]?\d+$/.test(s) && s.length >= 12) {
    const digits = s.replace(/^[+-]/, "");
    return Number(digits) / 100;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function padConsumerDetail(name: string): string {
  const clean = String(name || "STUDENT")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .slice(0, 30);
  return clean.padEnd(30, " ");
}

export function formatDueDateYmd(d: Date | string | null | undefined): string {
  if (!d) {
    const n = new Date();
    return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, "0")}${String(n.getDate()).padStart(2, "0")}`;
  }
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return formatDueDateYmd(null);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
}

export function formatBillingMonth(month: number, year: number): string {
  if (!month || !year) {
    const n = new Date();
    return `${String(n.getFullYear()).slice(-2)}${String(n.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(year).slice(-2)}${String(month).padStart(2, "0")}`;
}

export function todayYmd(): string {
  return formatDueDateYmd(new Date());
}

/** Blocked / cancelled statuses, or expired past validity_date. */
export function isVoucherBlockedOrExpired(fee: Record<string, unknown>): boolean {
  const status = String(fee.status || "").trim().toLowerCase();
  if (status === "blocked" || status === "cancelled" || status === "canceled" || status === "void") {
    return true;
  }
  const validityRaw = fee.validity_date ?? fee.validityDate;
  if (!validityRaw) return false;
  const validity = formatDueDateYmd(validityRaw as string);
  return Boolean(validity) && validity < todayYmd();
}

export function billStatusFromFee(fee: Record<string, unknown>, balance: number): KuickpayBillStatus {
  if (isVoucherBlockedOrExpired(fee)) return "B";
  const s = String(fee.status || "");
  if (s === "Paid" || balance <= 0) return "P";
  return "U";
}

export function isKuickpayEnabled(cfg: KuickpayConfigRow | null | undefined): boolean {
  const v = cfg?.isEnabled as unknown;
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (Buffer.isBuffer(v)) return v.length > 0 && v[0] === 1;
  return false;
}

export async function loadKuickpayConfig(pool: ConnectionPool): Promise<KuickpayConfigRow | null> {
  const result = await pool.request().query(`
    SELECT TOP 1 *
    FROM QuickPayConfig
    ORDER BY CASE WHEN ISNULL(isEnabled, 0) = 1 THEN 0 ELSE 1 END
  `);
  return (result.recordset[0] as KuickpayConfigRow) || null;
}

export function resolveBpsCredentials(cfg: KuickpayConfigRow | null): { username: string; password: string } {
  const username = String(cfg?.bps_username || cfg?.merchant_id || "").trim();
  const password = String(cfg?.bps_password || cfg?.api_key || "").trim();
  return { username, password };
}

export function authFromHeaders(req: { headers: Record<string, unknown> }): { username: string; password: string } {
  const h = req.headers || {};
  const username = String(h.username || h.Username || "").trim();
  const password = String(h.password || h.Password || "").trim();
  return { username, password };
}

export function credentialsMatch(
  provided: { username: string; password: string },
  expected: { username: string; password: string }
): boolean {
  if (!expected.username || !expected.password) return false;
  return provided.username === expected.username && provided.password === expected.password;
}

function normalizePrefix(raw: string | null | undefined): string {
  const digits = String(raw || "01520").replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits.padStart(5, "0");
}

/** Allocate a unique 18-digit Kuickpay consumer number for a fee voucher. */
export async function ensureKuickpayConsumerNumber(
  pool: ConnectionPool,
  feeId: string
): Promise<string | null> {
  const existing = await pool.request()
    .input("id", feeId)
    .query(`SELECT kuickpay_consumer_number AS cn FROM Fees WHERE id = @id`);
  const current = existing.recordset[0]?.cn;
  if (current && String(current).length === 18) return String(current);

  const cfg = await loadKuickpayConfig(pool);
  const prefix = normalizePrefix(cfg?.consumer_prefix);

  for (let attempt = 0; attempt < 5; attempt++) {
    const seqResult = await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM QuickPayConfig)
      BEGIN
        INSERT INTO QuickPayConfig (id, merchant_id, api_key, callback_url, mode, isEnabled, consumer_prefix, next_consumer_seq)
        VALUES (CONVERT(NVARCHAR(50), NEWID()), '', '', '', 'Sandbox', 0, '01520', 1);
      END
      UPDATE TOP (1) QuickPayConfig
      SET next_consumer_seq = ISNULL(next_consumer_seq, 1) + 1
      OUTPUT DELETED.next_consumer_seq AS usedSeq
    `);
    let seq = Number(seqResult.recordset[0]?.usedSeq || 1);
    if (!Number.isFinite(seq) || seq < 1) seq = 1;
    const consumer = `${prefix}${String(seq).padStart(13, "0")}`;

    try {
      await pool.request()
        .input("id", feeId)
        .input("cn", consumer)
        .query(`
          UPDATE Fees
          SET kuickpay_consumer_number = @cn
          WHERE id = @id AND (kuickpay_consumer_number IS NULL OR LTRIM(RTRIM(kuickpay_consumer_number)) = '')
        `);
      const check = await pool.request()
        .input("id", feeId)
        .query(`SELECT kuickpay_consumer_number AS cn FROM Fees WHERE id = @id`);
      const saved = check.recordset[0]?.cn;
      if (saved) return String(saved);
    } catch {
      // unique collision — retry
    }
  }
  return null;
}

export async function findFeeByConsumerNumber(
  pool: ConnectionPool,
  consumerNumber: string
): Promise<Record<string, unknown> | null> {
  const cn = String(consumerNumber || "").replace(/\D/g, "");
  if (!cn) return null;
  const result = await pool.request()
    .input("cn", cn)
    .query(`
      SELECT TOP 1
        f.*,
        s.student_name AS studentName,
        s.father_mobile AS studentContact,
        CAST(NULL AS NVARCHAR(100)) AS studentEmail,
        s.campus_id AS campusId
      FROM Fees f
      JOIN Students s ON s.id = f.student_id
      WHERE f.kuickpay_consumer_number = @cn
    `);
  return result.recordset[0] || null;
}

export function outstandingPayable(fee: Record<string, unknown>): number {
  const balance = Number(fee.balance_amount);
  if (Number.isFinite(balance) && balance >= 0) return balance;
  const amount =
    Number(fee.amount || 0) +
    Number(fee.arrears || 0) +
    Number(fee.fine_amount || 0) -
    Number(fee.discount_amount || 0);
  const paid = Number(fee.paid_amount || 0);
  return Math.max(0, amount - paid);
}

function inquiryCommonFields(fee: Record<string, unknown>, consumerNumber: string) {
  const balance = outstandingPayable(fee);
  const status = billStatusFromFee(fee, balance);
  const paid = Number(fee.paid_amount || 0);
  const due = formatDueDateYmd(fee.due_date as string | null);
  const billingMonth = formatBillingMonth(Number(fee.month || 0), Number(fee.year || 0));
  const name = padConsumerDetail(String(fee.studentName || "STUDENT"));
  const email = String(fee.studentEmail || "noreply@school.local").slice(0, 30);
  const contact =
    String(fee.studentContact || "00000000000").replace(/\D/g, "").slice(0, 15) || "00000000000";
  const payableShown = status === "P" || status === "B" ? (status === "B" ? balance : 0) : balance;

  return {
    Consumer_Detail: name,
    Bill_Status: status,
    Due_Date: due,
    Amount_Within_DueDate: formatAmountWithinDueDate(status === "P" ? 0 : payableShown),
    Amount_After_DueDate: formatAmountWithinDueDate(status === "P" ? 0 : payableShown),
    email_address: email,
    contact_number: contact,
    Billing_Month: billingMonth,
    Date_Paid: status === "P" && fee.payment_date ? formatDueDateYmd(fee.payment_date as string) : "        ",
    Amount_Paid: status === "P" ? formatAmountPaid(paid || Number(fee.amount || 0)) : "            ",
    Tran_Auth_Id:
      status === "P" && fee.transaction_ref
        ? String(fee.transaction_ref).replace(/\D/g, "").slice(-6).padStart(6, "0")
        : "      ",
    Reserved: `${contact} | ${email}`.slice(0, 200),
    consumer_number: consumerNumber,
  };
}

/**
 * Build Inquiry response.
 * - Unpaid / Paid → response_Code 00
 * - Blocked / expired → response_Code 02 + Bill_Status B (payment must not proceed)
 */
export function buildInquirySuccess(fee: Record<string, unknown>, consumerNumber: string) {
  const fields = inquiryCommonFields(fee, consumerNumber);
  if (fields.Bill_Status === "B") {
    return {
      response_Code: "02",
      ...fields,
      message: "Voucher is blocked or expired",
    };
  }
  return {
    response_Code: "00",
    ...fields,
  };
}

export function inquiryError(code: string, message?: string) {
  return { response_Code: code, message: message || undefined };
}

export function paymentError(code: string, message?: string) {
  return { response_Code: code, message: message || undefined };
}

export type DuplicateClass = "exact" | "mismatch" | "none";

/**
 * 03 only when Consumer Number + Tran_Auth_ID + Amount Paid + Date Paid all match.
 * Same auth with any field mismatch → 04.
 */
export async function classifyKuickpayDuplicate(
  pool: ConnectionPool,
  consumerNumber: string,
  tranAuthId: string,
  amount: number,
  tranDate: string
): Promise<DuplicateClass> {
  const byAuth = await pool.request()
    .input("cn", consumerNumber)
    .input("auth", tranAuthId)
    .query(`
      SELECT TOP 5 amount, tran_date AS tranDate
      FROM KuickpayPaymentLog
      WHERE consumer_number = @cn AND tran_auth_id = @auth
      ORDER BY created_at DESC
    `);

  if (byAuth.recordset.length === 0) return "none";

  const exact = byAuth.recordset.some(
    (row: { amount: number; tranDate: string }) =>
      Math.abs(Number(row.amount) - amount) < 0.01 && String(row.tranDate) === String(tranDate)
  );
  return exact ? "exact" : "mismatch";
}

/** @deprecated use classifyKuickpayDuplicate */
export async function isDuplicateKuickpayPayment(
  pool: ConnectionPool,
  consumerNumber: string,
  tranAuthId: string,
  amount: number,
  tranDate: string
): Promise<boolean> {
  return (await classifyKuickpayDuplicate(pool, consumerNumber, tranAuthId, amount, tranDate)) === "exact";
}

export async function applyKuickpayPayment(
  pool: ConnectionPool,
  opts: {
    fee: Record<string, unknown>;
    consumerNumber: string;
    amount: number;
    tranAuthId: string;
    tranDate: string;
    tranTime: string;
    bankMnemonic: string;
    reserved?: string;
    recomputeStudentOutstanding: (studentId: string) => Promise<void>;
  }
): Promise<{
  response_Code: string;
  Identification_Parameter?: string;
  Reserved?: string;
  status?: string;
  balanceAmount?: number;
  message?: string;
}> {
  const { fee, consumerNumber, amount, tranAuthId, tranDate, tranTime, bankMnemonic, reserved } = opts;
  const feeId = String(fee.id);
  const studentId = String(fee.student_id);
  const balance = outstandingPayable(fee);
  const statusNow = billStatusFromFee(fee, balance);

  const dup = await classifyKuickpayDuplicate(pool, consumerNumber, tranAuthId, amount, tranDate);
  if (dup === "exact") return paymentError("03", "Duplicate transaction");
  if (dup === "mismatch") {
    return paymentError("04", "Transaction auth already used with different amount or date");
  }

  if (statusNow === "B") return paymentError("02", "Voucher is blocked or expired");
  if (statusNow === "P" || balance <= 0) {
    return paymentError("04", "Voucher already paid");
  }
  if (!(amount > 0)) return paymentError("04", "Invalid transaction amount");

  // KuickPay does not support partial payments — full outstanding only
  if (Math.abs(amount - balance) > 0.009) {
    return paymentError(
      "04",
      `Partial payment not supported; full outstanding required (${balance.toFixed(2)})`
    );
  }

  const prevPaid = Number(fee.paid_amount || 0);
  const totalPaid = prevPaid + amount;
  const newBalance = 0;
  const newStatus = "Paid";

  let history: unknown[] = [];
  try {
    history = JSON.parse(String(fee.payment_history || "[]"));
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  history.push({
    date: new Date().toISOString(),
    amount,
    discount: 0,
    fine: 0,
    method: "Kuickpay",
    ref: tranAuthId,
    bankMnemonic: bankMnemonic || null,
    tranDate,
    tranTime,
  });

  await pool.request()
    .input("id", feeId)
    .input("status", newStatus)
    .input("transaction_ref", tranAuthId)
    .input("paid_amount", totalPaid)
    .input("balance_amount", newBalance)
    .input("payment_history", JSON.stringify(history))
    .query(`
      UPDATE Fees SET
        status = @status,
        transaction_ref = @transaction_ref,
        payment_method = 'Kuickpay',
        payment_date = GETDATE(),
        paid_amount = @paid_amount,
        balance_amount = @balance_amount,
        payment_history = @payment_history
      WHERE id = @id
    `);

  await pool.request()
    .input("id", crypto.randomUUID())
    .input("fee_id", feeId)
    .input("student_id", studentId)
    .input("consumer_number", consumerNumber)
    .input("tran_auth_id", tranAuthId)
    .input("amount", amount)
    .input("tran_date", tranDate)
    .input("tran_time", tranTime || null)
    .input("bank_mnemonic", bankMnemonic || null)
    .input("reserved", reserved || null)
    .query(`
      INSERT INTO KuickpayPaymentLog (
        id, fee_id, student_id, consumer_number, tran_auth_id, amount,
        tran_date, tran_time, bank_mnemonic, reserved, created_at
      ) VALUES (
        @id, @fee_id, @student_id, @consumer_number, @tran_auth_id, @amount,
        @tran_date, @tran_time, @bank_mnemonic, @reserved, GETDATE()
      )
    `);

  try {
    await pool.request()
      .input("id", crypto.randomUUID())
      .input("student_id", studentId)
      .input("voucher_id", feeId)
      .input("amount", amount)
      .input("status", "Success")
      .input("transaction_ref", tranAuthId)
      .input("payment_method", "Kuickpay")
      .query(`
        INSERT INTO Transactions (id, student_id, voucher_id, amount, status, transaction_ref, payment_method, transaction_date)
        VALUES (@id, @student_id, @voucher_id, @amount, @status, @transaction_ref, @payment_method, GETDATE())
      `);
  } catch {
    // optional log
  }

  await opts.recomputeStudentOutstanding(studentId);

  const receipt = String(Date.now()).slice(-20).padStart(20, "0");
  return {
    response_Code: "00",
    Identification_Parameter: receipt,
    Reserved: String(reserved || "").slice(0, 200),
    status: newStatus,
    balanceAmount: newBalance,
  };
}

export async function backfillKuickpayConsumerNumbers(
  pool: ConnectionPool,
  limit = 500
): Promise<number> {
  const result = await pool.request().input("limit", limit).query(`
    SELECT TOP (@limit) id FROM Fees
    WHERE kuickpay_consumer_number IS NULL OR LTRIM(RTRIM(kuickpay_consumer_number)) = ''
    ORDER BY created_at DESC
  `);
  let n = 0;
  for (const row of result.recordset) {
    const cn = await ensureKuickpayConsumerNumber(pool, String(row.id));
    if (cn) n++;
  }
  return n;
}
