/** Derive ledger Transaction Type labels (#34). */
export function feeVoucherTransactionType(fee: {
  feeType?: string | null;
  status?: string | null;
  discountAmount?: number | null;
  arrears?: number | null;
}): string {
  const type = String(fee.feeType || '').trim();
  const status = String(fee.status || '').trim();
  if (type === 'Arrears') return 'Arrears';
  if (type === 'Fine') return 'Other Charges';
  if (type === 'Admission') return 'Fee Voucher';
  if ((Number(fee.discountAmount) || 0) > 0 && status === 'Paid') return 'Discount';
  if (status === 'Partially Paid') return 'Partial Payment';
  if (status === 'Paid') return 'Payment';
  if (type === 'Monthly' || type === 'Security Deposit' || type === 'Summer Camp' || type === 'ID Card' || type === 'Educational Trip') {
    return 'Fee Voucher';
  }
  if (type) return type;
  return 'Fee Voucher';
}

export function paymentTransactionType(tx: {
  status?: string | null;
  paymentMethod?: string | null;
  amount?: number | null;
}): string {
  const status = String(tx.status || '').trim().toLowerCase();
  if (status === 'reversed') return 'Refund';
  if (status === 'partial' || status === 'partially paid') return 'Partial Payment';
  if (status === 'success' || status === 'paid' || status === 'completed') return 'Payment';
  if (status === 'adjustment') return 'Adjustment';
  return 'Payment';
}
