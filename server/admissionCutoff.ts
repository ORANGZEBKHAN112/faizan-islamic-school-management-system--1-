/**
 * Admission billing month cut-off (#33) — server mirror of src/utils/admissionCutoff.ts
 * Days 1–16 → that month; days 17+ → next month.
 */
export function admissionStatsMonthYear(admissionDate: Date | string): { month: number; year: number } {
  const d = admissionDate instanceof Date ? admissionDate : new Date(admissionDate);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }
  let month = d.getMonth() + 1;
  let year = d.getFullYear();
  const day = d.getDate();
  if (day >= 17) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { month, year };
}

export function admissionCountsInPeriod(
  admissionDate: Date | string | null | undefined,
  month: number,
  year: number,
): boolean {
  if (!admissionDate) return false;
  const mapped = admissionStatsMonthYear(admissionDate);
  return mapped.month === month && mapped.year === year;
}
