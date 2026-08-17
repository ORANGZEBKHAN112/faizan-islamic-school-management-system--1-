/** Title-case words for name-like text fields (#40). */
export function toTitleCase(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-zà-ÿ])/gi, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Apply title case on blur for controlled inputs. */
export function titleCaseOnBlur(value: string, setter: (next: string) => void): void {
  const next = toTitleCase(value);
  if (next !== value) setter(next);
}
