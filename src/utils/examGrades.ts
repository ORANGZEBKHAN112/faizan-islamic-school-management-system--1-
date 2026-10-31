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

export type ExamResultStatus = 'Pass' | 'Fail' | 'Absent' | 'Withheld';

export function overallOutcome(args: {
  absent?: boolean;
  withheld?: boolean;
  obtained: number;
  total: number;
  subjects?: Array<{ obtained: number; passing: number }>;
}): { grade: string; resultStatus: ExamResultStatus } {
  if (args.absent) return { grade: 'AB', resultStatus: 'Absent' };
  const subjectFail = (args.subjects || []).length > 0
    && (args.subjects || []).some((subject) => subject.obtained < subject.passing);
  const percentFail = !(args.subjects || []).length && args.total > 0 && (args.obtained / args.total) * 100 < 50;
  const failed = subjectFail || percentFail;
  return {
    grade: failed ? 'F' : gradeFromMarks(args.obtained, args.total),
    resultStatus: args.withheld ? 'Withheld' : failed ? 'Fail' : 'Pass',
  };
}
