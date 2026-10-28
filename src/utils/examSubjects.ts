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
  'Hifz',
  'Nazra',
] as const;

export const EXAM_COMPONENTS = ['Written', 'Practical', 'Oral', 'Hifz'] as const;

export type ExamSubjectDraft = {
  subjectName: string;
  totalMarks: number;
  passingMarks: number;
  examDate: string;
  startTime: string;
  component: (typeof EXAM_COMPONENTS)[number];
  gradingMode: 'Marks' | 'Hifz';
};

export function emptySubjectDraft(name = ''): ExamSubjectDraft {
  return {
    subjectName: name,
    totalMarks: 100,
    passingMarks: 33,
    examDate: '',
    startTime: '',
    component: 'Written',
    gradingMode: 'Marks',
  };
}

export function defaultExamWeight(examType: string): number {
  if (examType === 'Final') return 50;
  if (examType === 'Midterm') return 30;
  if (examType === 'Quiz') return 10;
  return 20;
}

export function currentAcademicSession(date = new Date()): string {
  const year = date.getFullYear();
  const start = date.getMonth() >= 3 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export function sumSubjectTotals(subjects: ExamSubjectDraft[]): number {
  return subjects.reduce((sum, s) => sum + (Number(s.totalMarks) || 0), 0);
}
