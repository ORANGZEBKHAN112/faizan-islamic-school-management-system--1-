/** Standard percentage-based grade scale used across exams UI and API. */
export function gradeFromPercentage(percentage: number): string {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  if (percentage > 0) return 'F';
  return '';
}

export function gradeFromMarks(obtained: number, total: number): string {
  if (!total || total <= 0) return '';
  const pct = (obtained / total) * 100;
  return gradeFromPercentage(pct);
}
