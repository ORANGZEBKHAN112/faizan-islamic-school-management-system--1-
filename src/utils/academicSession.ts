/** Academic year label Apr–Mar, e.g. 2026-2027 */
export function deriveAcademicSession(year: number, month = new Date().getMonth() + 1): string {
  if (month >= 4) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

export function normalizeSessionLabel(raw?: string, fallbackYear?: number, fallbackMonth?: number): string {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{4}$/.test(s)) return s;
  const y = fallbackYear ?? new Date().getFullYear();
  const m = fallbackMonth ?? new Date().getMonth() + 1;
  return deriveAcademicSession(y, m);
}
