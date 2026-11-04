export function currentAcademicSession(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function lastYearAcademicSession(date = new Date()) {
  const start = Number(currentAcademicSession(date).slice(0, 4)) - 1;
  return `${start}-${start + 1}`;
}

export function apiError(err: unknown, fallback: string) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || fallback;
}

export function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
