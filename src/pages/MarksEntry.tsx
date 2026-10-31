import { useEffect, useMemo, useState } from 'react';
import { Building, Users, Save, Download, Search, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { Campus, Class, Exam, ExamResult, ExamSubject, Student } from '../types';
import { dataService } from '../services/dataService';
import { useCollection } from '../hooks/useCollection';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import PageLoader from '../components/ui/PageLoader';
import EmptyState from '../components/ui/EmptyState';
import { PermissionGate } from '../context/PermissionContext';
import { gradeFromMarks, overallOutcome } from '../utils/examGrades';
import { downloadExamProgressReport, downloadExamReportCards, downloadExamResultSheet } from '../utils/studentDocuments';

function inferEducationLevel(className?: string): 'Pre-Primary' | 'Primary' | 'Secondary' {
  const n = String(className || '').toLowerCase();
  if (/nursery|kg|prep|play|pre-?primary|montessori|ece|playgroup/.test(n)) return 'Pre-Primary';
  if (/\b(6|7|8|9|10|11|12|vi|vii|viii|ix|x|secondary|matric)\b/.test(n)) return 'Secondary';
  return 'Primary';
}

function assignRanks(values: Array<{ id: string; marks: number }>): Record<string, number> {
  const sorted = [...values].sort((a, b) => b.marks - a.marks);
  const ranks: Record<string, number> = {};
  let rank = 0;
  let prev = Number.NaN;
  sorted.forEach((row, idx) => {
    if (row.marks !== prev) {
      rank = idx + 1;
      prev = row.marks;
    }
    ranks[row.id] = rank;
  });
  return ranks;
}

type StudentMarksState = {
  obtainedMarks: number;
  grade: string;
  remarks: string;
  subjectMarks: Record<string, number>;
};

export default function MarksEntry() {
  const [selectedCampus, setSelectedCampus] = useState('');
  const [selectedClassName, setSelectedClassName] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedExamId, setSelectedExamId] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState<ExamSubject[]>([]);
  const [results, setResults] = useState<Record<string, StudentMarksState>>({});
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  const { data: classes, loading: classesLoading } = useCollection<Class>('classes');
  const { data: exams, loading: examsLoading } = useCollection<Exam>('exams');

  const campusClasses = useMemo(
    () => classes.filter((c) => !selectedCampus || c.campusId === selectedCampus),
    [classes, selectedCampus]
  );

  const classNames = useMemo(
    () => Array.from(new Set(campusClasses.map((c) => c.className).filter(Boolean))).sort(),
    [campusClasses]
  );

  const sectionOptions = useMemo(
    () =>
      campusClasses
        .filter((c) => !selectedClassName || c.className === selectedClassName)
        .map((c) => c.sectionName || '')
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort(),
    [campusClasses, selectedClassName]
  );

  const matchingClassIds = useMemo(
    () =>
      campusClasses
        .filter((c) => {
          if (selectedClassName && c.className !== selectedClassName) return false;
          if (selectedSection && (c.sectionName || '') !== selectedSection) return false;
          return true;
        })
        .map((c) => c.id),
    [campusClasses, selectedClassName, selectedSection]
  );

  const availableExams = useMemo(
    () => exams.filter((e) => !matchingClassIds.length || matchingClassIds.includes(e.classId)),
    [exams, matchingClassIds]
  );

  const selectedExam = availableExams.find((e) => e.id === selectedExamId) || exams.find((e) => e.id === selectedExamId) || null;
  const examClass = classes.find((c) => c.id === selectedExam?.classId);
  const educationLevel = inferEducationLevel(selectedExam?.className || examClass?.className);
  const showRanks = educationLevel !== 'Pre-Primary';
  const subjectsTotal = useMemo(
    () => subjects.reduce((sum, s) => sum + Number(s.totalMarks || 0), 0),
    [subjects]
  );
  const examTotalMarks = subjectsTotal > 0 ? subjectsTotal : (selectedExam?.totalMarks || 0);

  const { data: students, loading: studentsLoading } = useCollection<Student>('students', {
    params: {
      ...(selectedExam?.classId ? { classId: selectedExam.classId } : {}),
      status: 'Active',
      limit: 500,
    },
    paginated: true,
  });

  useEffect(() => {
    if (!selectedExamId) {
      setResults({});
      setSubjects([]);
      return;
    }
    (async () => {
      try {
        const [subs, existing, attendance] = await Promise.all([
          dataService.fetchExamSubjects(selectedExamId),
          dataService.getAll('exam-results', { examId: selectedExamId }) as Promise<ExamResult[]>,
          dataService.fetchExamAttendance(selectedExamId),
        ]);
        setSubjects(subs || []);
        setAbsentIds(new Set(
          (attendance as Array<{ personType: string; personId: string; status: string }>)
            .filter((row) => row.personType === 'Student' && row.status === 'Absent')
            .map((row) => row.personId)
        ));
        const map: Record<string, StudentMarksState> = {};
        (existing || []).forEach((r) => {
          map[r.studentId] = {
            obtainedMarks: r.obtainedMarks,
            grade: r.grade || '',
            remarks: r.remarks || '',
            subjectMarks: { ...(r.subjectMarks || {}) },
          };
        });
        setResults(map);
      } catch {
        setSubjects([]);
        setResults({});
        setAbsentIds(new Set());
      }
    })();
  }, [selectedExamId, reloadKey]);

  const examStudents = useMemo(() => {
    if (!selectedExam) return [];
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => s.classId === selectedExam.classId && s.status === 'Active')
      .filter((s) => {
        if (selectedSection) {
          const sec = s.sectionName || examClass?.sectionName || '';
          if (sec !== selectedSection) return false;
        }
        if (!q) return true;
        return (
          s.firstName?.toLowerCase().includes(q) ||
          s.rollNumber?.toLowerCase().includes(q) ||
          s.fatherName?.toLowerCase().includes(q)
        );
      });
  }, [students, selectedExam, selectedSection, examClass, search]);

  const studentTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    examStudents.forEach((s) => {
      if (subjects.length) {
        totals[s.id] = subjects.reduce(
          (sum, sub) => sum + Number(results[s.id]?.subjectMarks?.[sub.id] || 0),
          0
        );
      } else {
        totals[s.id] = Number(results[s.id]?.obtainedMarks || 0);
      }
    });
    return totals;
  }, [examStudents, subjects, results]);

  const marksLocked = !!selectedExam && (selectedExam.status || 'Draft') !== 'Draft';

  const classRanks = useMemo(() => {
    if (!showRanks || !selectedExam) return {} as Record<string, number>;
    return assignRanks(
      students
        .filter((s) => s.classId === selectedExam.classId && s.status === 'Active' && !absentIds.has(s.id))
        .map((s) => ({
          id: s.id,
          marks: subjects.length
            ? subjects.reduce((sum, sub) => sum + Number(results[s.id]?.subjectMarks?.[sub.id] || 0), 0)
            : Number(results[s.id]?.obtainedMarks || 0),
        }))
    );
  }, [students, results, selectedExam, showRanks, subjects, absentIds]);

  const sectionRanks = useMemo(() => {
    if (!showRanks) return {} as Record<string, number>;
    return assignRanks(examStudents.filter((s) => !absentIds.has(s.id)).map((s) => ({ id: s.id, marks: studentTotals[s.id] || 0 })));
  }, [examStudents, studentTotals, showRanks, absentIds]);

  const setSubjectMark = (studentId: string, subjectId: string, marks: number, subjectTotal: number) => {
    const clamped = Math.max(0, Math.min(subjectTotal, marks));
    setResults((prev) => {
      const current = prev[studentId] || { obtainedMarks: 0, grade: '', remarks: '', subjectMarks: {} };
      const subjectMarks = { ...current.subjectMarks, [subjectId]: clamped };
      const obtainedMarks = subjects.reduce((sum, sub) => sum + Number(subjectMarks[sub.id] || 0), 0);
      return {
        ...prev,
        [studentId]: {
          ...current,
          subjectMarks,
          obtainedMarks,
          grade: gradeFromMarks(obtainedMarks, examTotalMarks),
        },
      };
    });
  };

  const saveResults = async () => {
    if (!selectedExam) return toast.error('Select an exam');
    if (marksLocked) return toast.error('This exam is locked. Reopen it on the Exams page before editing marks.');
    setSaving(true);
    try {
      const payload = examStudents.map((s) => {
        const row = results[s.id];
        if (subjects.length) {
          return {
            studentId: s.id,
            remarks: row?.remarks,
            subjectMarks: subjects.map((sub) => ({
              subjectId: sub.id,
              obtainedMarks: Number(row?.subjectMarks?.[sub.id] || 0),
            })),
          };
        }
        return {
          studentId: s.id,
          obtainedMarks: row?.obtainedMarks ?? 0,
          grade: row?.grade || undefined,
          remarks: row?.remarks || undefined,
        };
      });
      await dataService.saveExamResults(selectedExam.id, payload);
      setReloadKey((key) => key + 1);
      toast.success(`Saved marks for ${payload.length} student(s)`);
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save marks');
    } finally {
      setSaving(false);
    }
  };

  const loading = campusesLoading || classesLoading || examsLoading;

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader module="marks-entry" />

      <div className="filter-bar">
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
          <Building className="w-4 h-4 text-slate-400" />
          <SearchableSelect
            variant="inline"
            value={selectedCampus}
            onChange={(id) => {
              setSelectedCampus(id);
              setSelectedClassName('');
              setSelectedSection('');
              setSelectedExamId('');
            }}
            placeholder="Campus"
            options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
          />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
          <Users className="w-4 h-4 text-slate-400" />
          <SearchableSelect
            variant="inline"
            value={selectedClassName}
            onChange={(name) => {
              setSelectedClassName(name);
              setSelectedSection('');
              setSelectedExamId('');
            }}
            disabled={!selectedCampus}
            placeholder={!selectedCampus ? 'Select campus first' : 'Class'}
            options={classNames.map((n) => ({ value: n, label: n }))}
          />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
          <ClipboardList className="w-4 h-4 text-slate-400" />
          <SearchableSelect
            variant="inline"
            value={selectedSection}
            onChange={(sec) => {
              setSelectedSection(sec);
              setSelectedExamId('');
            }}
            disabled={!selectedClassName}
            placeholder={!selectedClassName ? 'Select class first' : 'Section'}
            options={[
              { value: '', label: 'All sections' },
              ...sectionOptions.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl min-w-[220px]">
          <SearchableSelect
            variant="inline"
            value={selectedExamId}
            onChange={setSelectedExamId}
            disabled={!selectedClassName}
            placeholder="Select exam"
            options={availableExams.map((e) => ({
              value: e.id,
              label: `${e.title} · ${e.examDate || 'TBD'}`,
            }))}
          />
        </div>
      </div>

      {loading && <PageLoader label="Loading marks entry…" />}

      {!selectedExam ? (
        <EmptyState
          icon={Users}
          title="Select campus, class, section, and exam"
          description="Enter subject-wise marks when the exam has subjects configured."
        />
      ) : (
        <div className="vibrant-card overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-black uppercase tracking-widest text-sm">{selectedExam.title}</h3>
              <p className="mt-2 inline-flex rounded-lg bg-success/10 px-3 py-1 text-sm font-black text-success">
                Total Marks: {examTotalMarks}
                {subjects.length ? ` · ${subjects.length} subjects` : ''}
                {` · ${selectedExam.status || 'Draft'}`}
              </p>
              {marksLocked && (
                <p className="text-xs text-amber-700 mt-2">Marks are locked. Reopen the exam from the Exams page to edit them.</p>
              )}
              {subjects.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">No subjects on this exam. Create a new exam with Subjects & Marks Setup, or enter a single total below.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="vibrant-input ps-9 py-2 w-48"
                  placeholder="Search students…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4"
                onClick={async () => {
                  try {
                    const report = await dataService.fetchExamReport(selectedExam.id);
                    if (!downloadExamReportCards(report)) return toast.error('Save marks before downloading report cards');
                    toast.success('Report cards downloaded');
                  } catch (err) {
                    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
                    toast.error(msg || 'Could not build report cards');
                  }
                }}
              >
                <Download className="w-4 h-4" /> Report cards
              </button>
              <button
                type="button"
                className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4"
                onClick={() => {
                  downloadExamResultSheet(
                    selectedExam.title,
                    selectedExam.className || '',
                    examStudents.map((s) => ({
                      studentName: s.firstName,
                      rollNumber: s.rollNumber,
                      obtainedMarks: studentTotals[s.id] || 0,
                      grade: gradeFromMarks(studentTotals[s.id] || 0, examTotalMarks),
                      totalMarks: examTotalMarks,
                    }))
                  );
                  toast.success('Results PDF downloaded');
                }}
              >
                <Download className="w-4 h-4" /> PDF
              </button>
              <button
                type="button"
                className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4"
                onClick={() => {
                  downloadExamProgressReport(
                    selectedExam.title,
                    selectedExam.className || '',
                    selectedSection || examClass?.sectionName || '',
                    educationLevel,
                    examTotalMarks,
                    examStudents.map((s) => ({
                      studentName: s.firstName,
                      rollNumber: s.rollNumber,
                      obtainedMarks: studentTotals[s.id] || 0,
                      grade: gradeFromMarks(studentTotals[s.id] || 0, examTotalMarks),
                      classRank: showRanks ? classRanks[s.id] ?? null : null,
                      sectionRank: showRanks ? sectionRanks[s.id] ?? null : null,
                    }))
                  );
                  toast.success('Progress PDF downloaded');
                }}
              >
                <Download className="w-4 h-4" /> Progress
              </button>
              <PermissionGate module="exams" action="update">
                <button type="button" disabled={saving || studentsLoading || marksLocked} onClick={saveResults} className="vibrant-btn-primary flex items-center gap-2 py-2 px-4">
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save marks'}
                </button>
              </PermissionGate>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            {studentsLoading ? (
              <p className="p-8 text-center text-slate-400">Loading students…</p>
            ) : examStudents.length === 0 ? (
              <p className="p-8 text-center text-slate-400">No students found for this class/section</p>
            ) : (
              <table className="w-full text-start">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest sticky top-0">
                    <th className="px-4 py-4">Student</th>
                    {subjects.map((sub) => (
                      <th key={sub.id} className="px-3 py-4 whitespace-nowrap">
                        <div>{sub.subjectName}</div>
                        <div className="text-success normal-case font-bold">/ {sub.totalMarks} · pass {sub.passingMarks}</div>
                        <div className="normal-case">{sub.component || 'Written'}{sub.gradingMode === 'Hifz' ? ' · paras' : ''}</div>
                      </th>
                    ))}
                    {!subjects.length && (
                      <th className="px-4 py-4">
                        <span className="rounded bg-success/10 px-2 py-1 text-success">
                          Marks / {examTotalMarks}
                        </span>
                      </th>
                    )}
                    <th className="px-4 py-4">Obtained</th>
                    <th className="px-4 py-4">%</th>
                    <th className="px-4 py-4">Grade</th>
                    <th className="px-4 py-4">Result</th>
                    {showRanks && <th className="px-4 py-4">Class Rank</th>}
                    {showRanks && <th className="px-4 py-4">Section Rank</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {examStudents.map((s) => {
                    const absent = absentIds.has(s.id);
                    const total = absent ? 0 : (studentTotals[s.id] || 0);
                    const pct = !absent && examTotalMarks > 0 ? Math.round((total / examTotalMarks) * 1000) / 10 : 0;
                    const hasEntry = absent || !!results[s.id];
                    const outcome = hasEntry ? overallOutcome({
                      absent,
                      obtained: total,
                      total: examTotalMarks,
                      subjects: subjects.map((sub) => ({
                        obtained: Number(results[s.id]?.subjectMarks?.[sub.id] || 0),
                        passing: Number(sub.passingMarks) || 0,
                      })),
                    }) : { grade: '', resultStatus: '' };
                    return (
                      <tr key={s.id}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-sm">{s.firstName}</p>
                          <p className="text-xs text-slate-400">{s.rollNumber}{absent ? ' · Absent' : ''}</p>
                        </td>
                        {subjects.map((sub) => {
                          const mark = Number(results[s.id]?.subjectMarks?.[sub.id] || 0);
                          const below = !absent && mark < Number(sub.passingMarks || 0);
                          return (
                          <td key={sub.id} className="px-3 py-3">
                            <input
                              type="number"
                              min={0}
                              max={sub.totalMarks}
                              disabled={marksLocked || absent}
                              className={`vibrant-input w-20 py-2 ${below ? 'border-rose-400' : ''}`}
                              value={absent ? '' : (results[s.id]?.subjectMarks?.[sub.id] ?? '')}
                              onChange={(e) => setSubjectMark(s.id, sub.id, parseFloat(e.target.value) || 0, sub.totalMarks)}
                            />
                          </td>
                          );
                        })}
                        {!subjects.length && (
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              max={examTotalMarks}
                              disabled={marksLocked || absent}
                              className="vibrant-input w-24 py-2"
                              value={absent ? '' : (results[s.id]?.obtainedMarks ?? '')}
                              onChange={(e) => {
                                const obtained = parseFloat(e.target.value) || 0;
                                setResults({
                                  ...results,
                                  [s.id]: {
                                    obtainedMarks: obtained,
                                    grade: gradeFromMarks(obtained, examTotalMarks),
                                    remarks: results[s.id]?.remarks || '',
                                    subjectMarks: {},
                                  },
                                });
                              }}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 font-black">{absent ? '—' : total}</td>
                        <td className="px-4 py-3">{absent ? '—' : `${pct}%`}</td>
                        <td className="px-4 py-3 font-bold">{outcome.grade || '—'}</td>
                        <td className="px-4 py-3 font-bold">{outcome.resultStatus || '—'}</td>
                        {showRanks && <td className="px-4 py-3 font-black text-primary">{classRanks[s.id] ?? '—'}</td>}
                        {showRanks && <td className="px-4 py-3 font-black">{sectionRanks[s.id] ?? '—'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
