/** Normalize Pakistani CNIC to 13 digits (strips dashes/spaces). */
export function normalizeCnic(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
}

/** Format 13-digit CNIC as #####-#######-# */
export function formatCnic(digits: string): string {
  const n = normalizeCnic(digits);
  if (n.length !== 13) return digits;
  return `${n.slice(0, 5)}-${n.slice(5, 12)}-${n.slice(12)}`;
}

/** Live format while typing */
export function maskCnicInput(value: string): string {
  const digits = normalizeCnic(value).slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return formatCnic(digits);
}

export function isValidCnic(raw: string | null | undefined): boolean {
  return normalizeCnic(raw).length === 13;
}

/** Simple name similarity 0–1 for duplicate detection. */
export function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(na.split(/\s+/).filter(Boolean));
  const tb = new Set(nb.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((t) => { if (tb.has(t)) overlap++; });
  return overlap / Math.max(ta.size, tb.size);
}
