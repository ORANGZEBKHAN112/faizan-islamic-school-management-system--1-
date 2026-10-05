import type { Fee } from '../types';

/** Matches server `kuickpayCustomerChargePkr`. */
export function normalizeKuickpayCustomerCharge(raw: unknown): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Matches server `outstandingPayable` (fee balance before Kuickpay surcharge). */
export function voucherOutstandingPayable(voucher: Fee): number {
  const balance = Number(voucher.balanceAmount);
  if (Number.isFinite(balance) && balance >= 0) return balance;
  const amount =
    Number(voucher.amount || 0) +
    Number(voucher.arrears || 0) +
    Number(voucher.fineAmount || 0) -
    Number(voucher.discountAmount || 0);
  const paid = Number(voucher.paidAmount || 0);
  return Math.max(0, amount - paid);
}

/** Total customer pays via Kuickpay (fee balance + configurable charge). Matches `bpsPayableTotal`. */
export function kuickpayPayableTotal(voucher: Fee, customerChargePkr = 0): number {
  const base = voucherOutstandingPayable(voucher);
  const charge = normalizeKuickpayCustomerCharge(customerChargePkr);
  if (base <= 0) return 0;
  return base + charge;
}
