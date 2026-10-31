/**
 * Admission billing month cut-off — server mirror of src/utils/admissionCutoff.ts
 * Days 1–18 stay in that month. After the 18th, the student and fees count in the next month.
 */
const ADMISSION_BILLING_CUTOFF_DAY = 18;

function calendarDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return new Date();
    const utcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    if (utcMidnight) return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    return value;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function formatCalendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function admissionStatsMonthYear(admissionDate: Date | string): { month: number; year: number } {
  const d = calendarDate(admissionDate);
  let month = d.getMonth() + 1;
  let year = d.getFullYear();
  if (d.getDate() > ADMISSION_BILLING_CUTOFF_DAY) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { month, year };
}

/** Due date is the 10th of the billing month. Expiry is the last day of that month. */
export function admissionBillingPeriod(admissionDate: Date | string): {
  month: number;
  year: number;
  dueDate: string;
  validityDate: string;
} {
  const { month, year } = admissionStatsMonthYear(admissionDate);
  return {
    month,
    year,
    dueDate: formatCalendarDate(new Date(year, month - 1, 10)),
    validityDate: formatCalendarDate(new Date(year, month, 0)),
  };
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
