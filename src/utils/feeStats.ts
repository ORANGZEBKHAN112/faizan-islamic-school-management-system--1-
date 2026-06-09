import type { Fee } from '../types';

/** Total cash collected across vouchers (uses paid_amount, not full voucher amount). */
export function feeCollectedTotal(fees: Fee[]): number {
  return fees.reduce((sum, f) => sum + (Number(f.paidAmount) || 0), 0);
}

/** Outstanding balance (balance_amount when set, else unpaid / partial remainder). */
export function feeOutstandingTotal(fees: Fee[]): number {
  return fees.reduce((sum, f) => {
    const balance = Number(f.balanceAmount);
    if (!Number.isNaN(balance) && balance > 0) return sum + balance;
    if (f.status === 'Unpaid' || f.status === 'Partially Paid') {
      const base = (Number(f.amount) || 0) + (Number(f.arrears) || 0);
      const paid = Number(f.paidAmount) || 0;
      return sum + Math.max(0, base - paid);
    }
    return sum;
  }, 0);
}

export function feeMonthlyChartTotals(fees: Fee[], month: number) {
  const monthFees = fees.filter((f) => f.month === month);
  return {
    collected: monthFees.reduce((acc, f) => acc + (Number(f.paidAmount) || 0), 0),
    pending: monthFees.reduce((acc, f) => {
      const balance = Number(f.balanceAmount);
      if (!Number.isNaN(balance) && balance > 0) return acc + balance;
      if (f.status === 'Unpaid' || f.status === 'Partially Paid') {
        const base = (Number(f.amount) || 0) + (Number(f.arrears) || 0);
        return acc + Math.max(0, base - (Number(f.paidAmount) || 0));
      }
      return acc;
    }, 0),
  };
}
