/** Display currency the same way on every screen. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const amount = Number.isFinite(n) ? n : 0;
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  return `Rs. ${amount.toLocaleString('en-PK', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  })}`;
}

export function formatMoneyCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const amount = Number.isFinite(n) ? n : 0;
  if (Math.abs(amount) >= 1000) {
    const compact = amount / 1000;
    const digits = Math.abs(compact) >= 10 ? 0 : 1;
    return `Rs. ${compact.toFixed(digits)}k`;
  }
  return formatMoney(amount);
}
