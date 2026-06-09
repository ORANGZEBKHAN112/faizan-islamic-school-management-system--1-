export type FieldErrors = Record<string, string>;

export function required(value: string | undefined | null, label: string): string | null {
  if (!value?.trim()) return `${label} is required`;
  return null;
}

export function minLength(value: string, min: number, label: string): string | null {
  if (value.trim().length < min) return `${label} must be at least ${min} characters`;
  return null;
}

export function email(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address';
  return null;
}

export function phone(value: string): string | null {
  if (!value.trim()) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return 'Enter a valid phone number (10–15 digits)';
  return null;
}

export function positiveNumber(value: number | string, label: string): string | null {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return `${label} must be a valid positive number`;
  return null;
}

/** Collect first error per field from rule results */
export function collectErrors(rules: Record<string, string | null>): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, msg] of Object.entries(rules)) {
    if (msg) errors[field] = msg;
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
