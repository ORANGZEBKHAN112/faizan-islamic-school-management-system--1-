/** Display roll number without embedded academic session (e.g. STU-2026-9807 → STD-9807). */
export function formatRollNumberForDisplay(rollNumber?: string | null): string {
  if (!rollNumber) return 'N/A';
  const trimmed = rollNumber.trim();
  const match = trimmed.match(/^STU-\d{4}-(\d+)$/i);
  if (match) return `STD-${match[1]}`;
  const generic = trimmed.match(/^[A-Z]+-(\d{4})-(\d+)$/i);
  if (generic) return `STD-${generic[2]}`;
  return trimmed;
}
