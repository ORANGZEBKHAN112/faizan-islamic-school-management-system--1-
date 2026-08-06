/** Common school subjects for exam setup dropdowns. */
export const EXAM_SUBJECT_CATALOG = [
  'English',
  'Urdu',
  'Mathematics',
  'Science',
  'Islamic Studies',
  'Social Studies',
  'Computer',
  'Arts',
  'Physical Education',
  'General Knowledge',
] as const;

export type ExamSubjectDraft = {
  subjectName: string;
  totalMarks: number;
  passingMarks: number;
};

export function emptySubjectDraft(name = ''): ExamSubjectDraft {
  return { subjectName: name, totalMarks: 100, passingMarks: 33 };
}

export function sumSubjectTotals(subjects: ExamSubjectDraft[]): number {
  return subjects.reduce((sum, s) => sum + (Number(s.totalMarks) || 0), 0);
}
