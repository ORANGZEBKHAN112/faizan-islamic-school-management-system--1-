import React, { useEffect, useMemo, useState } from 'react';
import { Plus, ClipboardList, Save, Trash2, GraduationCap, Download } from 'lucide-react';
import { downloadExamProgressReport, downloadExamResultSheet } from '../utils/studentDocuments';
import { Exam, ExamResult, Campus, Class, Student } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import { gradeFromMarks } from '../utils/examGrades';
import { EXAM_SUBJECT_CATALOG, emptySubjectDraft, sumSubjectTotals, type ExamSubjectDraft } from '../utils/examSubjects';

const scopeUser = getStoredUser();

const EXAM_REGIONS = [
  'Karachi',
  'Interior Sindh',
  'Punjab',
  'KPK',
  'Balochistan',
  'Kashmir',
  'Winter Zone',
] as const;

const EDUCATION_LEVELS = ['Pre-Primary', 'Primary', 'Secondary'] as const;

function inferEducationLevel(className?: string): (typeof EDUCATION_LEVELS)[number] {
  const n = String(className || '').toLowerCase();
  if (/nursery|kg|prep|play|pre-?primary|montessori|ece|playgroup/.test(n)) return 'Pre-Primary';
  if (/\b(6|7|8|9|10|11|12|vi|vii|viii|ix|x|secondary|matric)\b/.test(n)) return 'Secondary';
  return 'Primary';
}

function classMatchesLevel(className: string, level: string): boolean {
  return inferEducationLevel(className) === level;
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

export default function Exams() {
  const confirm = useConfirm();
  const [exams, setExams] = useState<Exam[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [sectionFilter, setSectionFilter] = useState('all');
  const [results, setResults] = useState<Record<string, { obtainedMarks: number; grade: string; remarks: string }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'region' | 'campus'>('region');
  const [subjectPick, setSubjectPick] = useState('');
  const [subjects, setSubjects] = useState<ExamSubjectDraft[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    examType: 'Monthly',
    region: '',
    educationLevel: 'Primary' as (typeof EDUCATION_LEVELS)[number],
    className: '',
    campusId: scopeUser ? (defaultCampusFilter(scopeUser) !== 'all' ? defaultCampusFilter(scopeUser) : '') : '',
    classId: '',
    examDate: new Date().toISOString().split('T')[0],
    totalMarks: 100,
  });

  const subjectsTotal = sumSubjectTotals(subjects);

  const loadExams = async () => {
    try {
      const data = await dataService.getAll('exams');
      setExams(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load exams');
    }
  };

  useEffect(() => {
    loadExams();
    const unsubCampuses = dataService.subscribe('campuses', setCampuses);
    const unsubClasses = dataService.subscribe('classes', setClasses);
    return () => {
      unsubCampuses();
      unsubClasses();
    };
  }, []);

  useEffect(() => {
    if (!selectedExam?.classId) {
      setStudents([]);
      return;
    }
    setSectionFilter('all');
    (async () => {
      try {
        const rows = await dataService.getPaginated('students', {
          classId: selectedExam.classId,
          status: 'Active',
          limit: 500,
          page: 1,
        });
        setStudents(rows.data);
      } catch {
        setStudents([]);
      }
    })();
  }, [selectedExam?.classId]);

  const campusClasses = classes.filter((c) => !formData.campusId || c.campusId === formData.campusId);
  const distinctClassNames: string[] = Array.from(
    new Set<string>(
      classes
        .filter((c) => {
          if (!classMatchesLevel(c.className || '', formData.educationLevel)) return false;
          if (scheduleMode !== 'region' || !formData.region) return true;
          const campus = campuses.find((x) => x.id === c.campusId);
          const region = (campus?.region || '').trim().toLowerCase();
          const wanted = formData.region.trim().toLowerCase();
          if (wanted === 'winter zone') {
            return region.includes('winter') || region.includes('balochistan – winter');
          }
          if (wanted === 'balochistan') {
            return region.includes('balochistan') && !region.includes('winter');
          }
          return region === wanted || region.includes(wanted);
        })
        .map((c) => String(c.className || ''))
        .filter((n) => n.length > 0)
    )
  ).sort();

  const examClass = classes.find((c) => c.id === selectedExam?.classId);
  const educationLevel = inferEducationLevel(selectedExam?.className || examClass?.className);
  const showRanks = educationLevel !== 'Pre-Primary';

  const sectionOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      const sec = (s as Student & { sectionName?: string }).sectionName || examClass?.sectionName || '';
      if (sec) set.add(sec);
    });
    if (examClass?.sectionName) set.add(examClass.sectionName);
    return Array.from(set).sort();
  }, [students, examClass]);

  const examStudents = selectedExam
    ? students.filter((s) => {
        if (s.classId !== selectedExam.classId || s.status !== 'Active') return false;
        if (sectionFilter === 'all') return true;
        const sec = (s as Student & { sectionName?: string }).sectionName || examClass?.sectionName || '';
        return sec === sectionFilter;
      })
    : [];

  const classRanks = useMemo(() => {
    if (!showRanks) return {} as Record<string, number>;
    return assignRanks(
      students
        .filter((s) => s.classId === selectedExam?.classId && s.status === 'Active')
        .map((s) => ({ id: s.id, marks: results[s.id]?.obtainedMarks ?? 0 }))
    );
  }, [students, results, selectedExam?.classId, showRanks]);

  const sectionRanks = useMemo(() => {
    if (!showRanks) return {} as Record<string, number>;
    return assignRanks(examStudents.map((s) => ({ id: s.id, marks: results[s.id]?.obtainedMarks ?? 0 })));
  }, [examStudents, results, showRanks]);

  const openResults = async (exam: Exam) => {
    setSelectedExam(exam);
    try {
      const existing: ExamResult[] = await dataService.getAll('exam-results', { examId: exam.id });
      const map: Record<string, { obtainedMarks: number; grade: string; remarks: string }> = {};
      existing.forEach((r) => {
        map[r.studentId] = {
          obtainedMarks: r.obtainedMarks,
          grade: r.grade || '',
          remarks: r.remarks || '',
        };
      });
      setResults(map);
    } catch {
      setResults({});
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Exam title is required');
      return;
    }
    if (subjects.length === 0) {
      toast.error('Add at least one subject with total marks');
      return;
    }
    const totalMarks = subjectsTotal > 0 ? subjectsTotal : formData.totalMarks;
    const subjectPayload = subjects.map((s) => ({
      subjectName: s.subjectName,
      totalMarks: Number(s.totalMarks) || 0,
      passingMarks: Number(s.passingMarks) || 0,
    }));
    try {
      if (scheduleMode === 'region') {
        if (!formData.region || !formData.educationLevel) {
          toast.error('Region and education level are required');
          return;
        }
        const classNames = formData.className
          ? [formData.className]
          : distinctClassNames;
        if (classNames.length === 0) {
          toast.error('No classes found for this education level in the region');
          return;
        }
        let created = 0;
        const skipped: string[] = [];
        for (const className of classNames) {
          const result = await dataService.addExamsByRegion({
            title: formData.title,
            examType: formData.examType,
            region: formData.region,
            className,
            examDate: formData.examDate,
            totalMarks,
            subjects: subjectPayload,
          });
          created += result.createdCount || 0;
          if (result.skipped?.length) skipped.push(...result.skipped);
        }
        toast.success(`Created ${created} exam(s) for ${formData.educationLevel}`);
        if (skipped.length) {
          toast.message(`Skipped ${skipped.length} campus(es)`, { description: skipped.slice(0, 3).join('; ') });
        }
      } else {
        if (!formData.campusId || !formData.classId) {
          toast.error('Campus and class are required');
          return;
        }
        await dataService.addExam({
          title: formData.title,
          examType: formData.examType,
          campusId: formData.campusId,
          classId: formData.classId,
          examDate: formData.examDate,
          totalMarks,
          subjects: subjectPayload,
        });
        toast.success('Exam created');
      }
      await loadExams();
      setIsModalOpen(false);
      setSubjects([]);
      setSubjectPick('');
      setFormData((prev) => ({ ...prev, title: '', classId: '', className: '', totalMarks: 100 }));
    } catch (err) {
      console.error(err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create exam');
    }
  };

  const saveResults = async () => {
    if (!selectedExam) return;
    const payload = examStudents.map((s) => ({
      studentId: s.id,
      obtainedMarks: results[s.id]?.obtainedMarks ?? 0,
      grade: results[s.id]?.grade || undefined,
      remarks: results[s.id]?.remarks || undefined,
    }));
    try {
      await dataService.saveExamResults(selectedExam.id, payload);
      toast.success('Results saved');
    } catch (err) {
      console.error(err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save results');
    }
  };

  const handleDeleteExam = async (id: string) => {
    if (!await confirm({
      title: 'Delete exam?',
      message: 'This removes the exam and all saved results permanently.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })) return;
    try {
      await dataService.deleteExam(id);
      toast.success('Exam deleted');
      if (selectedExam?.id === id) setSelectedExam(null);
      await loadExams();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete exam');
    }
  };

  const downloadProgress = () => {
    if (!selectedExam) return;
    const rows = examStudents.map((s) => ({
      studentName: s.firstName,
      rollNumber: s.rollNumber,
      obtainedMarks: results[s.id]?.obtainedMarks ?? 0,
      grade: results[s.id]?.grade,
      classRank: showRanks ? classRanks[s.id] ?? null : null,
      sectionRank: showRanks ? sectionRanks[s.id] ?? null : null,
    }));
    downloadExamProgressReport(
      selectedExam.title,
      selectedExam.className || '',
      sectionFilter === 'all' ? (examClass?.sectionName || '') : sectionFilter,
      educationLevel,
      selectedExam.totalMarks,
      rows
    );
    toast.success('Progress report downloaded');
  };

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="exams"
        actions={
          <PermissionGate module="exams" action="create">
            <button onClick={() => setIsModalOpen(true)} className="vibrant-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
              <Plus className="w-4 h-4" />
              New exam
            </button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="vibrant-card overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-primary" />
            <h3 className="font-black uppercase tracking-widest text-sm">Scheduled Exams</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[480px] overflow-y-auto">
            {exams.length === 0 ? (
              <p className="p-8 text-center text-slate-400">No exams yet</p>
            ) : exams.map((exam) => (
              <button
                key={exam.id}
                onClick={() => openResults(exam)}
                className={`w-full text-left p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedExam?.id === exam.id ? 'bg-primary/5 border-l-4 border-primary' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{exam.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{exam.className} · {exam.campusName}{exam.region ? ` · ${exam.region}` : ''}</p>
                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-2">{exam.examType} · {exam.examDate || 'TBD'} · {inferEducationLevel(exam.className)}</p>
                  </div>
                  <PermissionGate module="exams" action="delete">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDeleteExam(exam.id); }}
                      className="p-2 text-slate-400 hover:text-danger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </PermissionGate>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="vibrant-card overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-black uppercase tracking-widest text-sm">
                  {selectedExam ? `Marks: ${selectedExam.title}` : 'Select an exam'}
                </h3>
                {selectedExam && (
                  <p className="mt-1 inline-flex items-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40 px-3 py-1 text-sm font-black text-emerald-800 dark:text-emerald-200">
                    Total Marks: {selectedExam.totalMarks}
                  </p>
                )}
              </div>
            </div>
            {selectedExam && (
              <div className="flex flex-wrap gap-2">
                {sectionOptions.length > 0 && (
                  <SearchableSelect
                    className="min-w-[140px]"
                    value={sectionFilter}
                    onChange={setSectionFilter}
                    options={[
                      { value: 'all', label: 'All sections' },
                      ...sectionOptions.map((s) => ({ value: s, label: `Section ${s}` })),
                    ]}
                  />
                )}
                <button
                  onClick={() => {
                    const rows = examStudents.map((s) => ({
                      studentName: s.firstName,
                      rollNumber: s.rollNumber,
                      obtainedMarks: results[s.id]?.obtainedMarks ?? 0,
                      grade: results[s.id]?.grade,
                      totalMarks: selectedExam.totalMarks,
                    }));
                    downloadExamResultSheet(selectedExam.title, selectedExam.className || '', rows);
                    toast.success('Result sheet downloaded');
                  }}
                  className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase">Results PDF</span>
                </button>
                <button onClick={downloadProgress} className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4">
                  <Download className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase">Progress PDF</span>
                </button>
                <PermissionGate module="exams" action="update">
                  <button onClick={saveResults} className="vibrant-btn-primary flex items-center gap-2 py-2 px-4">
                    <Save className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase">Save</span>
                  </button>
                </PermissionGate>
              </div>
            )}
          </div>
          {!selectedExam ? (
            <p className="p-8 text-center text-slate-400">Click an exam to enter marks</p>
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest sticky top-0">
                    <th className="px-6 py-4">Student</th>
                    <th className="px-6 py-4">
                      <span className="rounded bg-emerald-100 dark:bg-emerald-900/50 px-2 py-1 text-emerald-800 dark:text-emerald-200">
                        Marks / {selectedExam.totalMarks}
                      </span>
                    </th>
                    <th className="px-6 py-4">Grade</th>
                    {showRanks && <th className="px-6 py-4">Class Rank</th>}
                    {showRanks && <th className="px-6 py-4">Section Rank</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {examStudents.map((s) => (
                    <tr key={s.id}>
                      <td className="px-6 py-3">
                        <p className="font-bold text-sm">{s.firstName}</p>
                        <p className="text-xs text-slate-400">{s.rollNumber}</p>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          min={0}
                          max={selectedExam.totalMarks}
                          className="vibrant-input w-24 py-2"
                          value={results[s.id]?.obtainedMarks ?? ''}
                          onChange={(e) => {
                            const obtained = parseFloat(e.target.value) || 0;
                            const grade = gradeFromMarks(obtained, selectedExam.totalMarks);
                            setResults({
                              ...results,
                              [s.id]: { ...results[s.id], obtainedMarks: obtained, grade, remarks: results[s.id]?.remarks || '' },
                            });
                          }}
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          className="vibrant-input w-20 py-2"
                          placeholder="A+"
                          value={results[s.id]?.grade ?? ''}
                          onChange={(e) => setResults({
                            ...results,
                            [s.id]: { obtainedMarks: results[s.id]?.obtainedMarks ?? 0, grade: e.target.value, remarks: results[s.id]?.remarks || '' },
                          })}
                        />
                      </td>
                      {showRanks && (
                        <td className="px-6 py-3 font-black text-primary">{classRanks[s.id] ?? '—'}</td>
                      )}
                      {showRanks && (
                        <td className="px-6 py-3 font-black">{sectionRanks[s.id] ?? '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="vibrant-card w-full max-w-xl p-8 max-h-[90vh] overflow-y-auto">
              <h3 className="text-2xl font-black mb-6">Schedule Exam</h3>
              <form onSubmit={handleCreateExam} className="space-y-4">
                <input className="vibrant-input" placeholder="Exam title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required />
                <SearchableSelect
                  value={formData.examType}
                  onChange={(examType) => setFormData({ ...formData, examType })}
                  searchPlaceholder="Search type…"
                  options={['Monthly', 'Midterm', 'Final', 'Quiz'].map((t) => ({ value: t, label: t }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('region')}
                    className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${scheduleMode === 'region' ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
                  >
                    Region / State
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('campus')}
                    className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${scheduleMode === 'campus' ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
                  >
                    Single Campus
                  </button>
                </div>
                {scheduleMode === 'region' ? (
                  <>
                    <SearchableSelect
                      required
                      className="w-full"
                      value={formData.region}
                      onChange={(region) => setFormData({ ...formData, region, className: '' })}
                      placeholder="Select region / state"
                      searchPlaceholder="Search region…"
                      options={EXAM_REGIONS.map((r) => ({ value: r, label: r }))}
                    />
                    <SearchableSelect
                      required
                      className="w-full"
                      value={formData.educationLevel}
                      onChange={(educationLevel) => setFormData({
                        ...formData,
                        educationLevel: educationLevel as (typeof EDUCATION_LEVELS)[number],
                        className: '',
                      })}
                      placeholder="Education level"
                      options={EDUCATION_LEVELS.map((l) => ({ value: l, label: l }))}
                    />
                    <SearchableSelect
                      className="w-full"
                      value={formData.className}
                      onChange={(className) => setFormData({ ...formData, className })}
                      placeholder="All classes in level (optional)"
                      searchPlaceholder="Search classes…"
                      options={[
                        { value: '', label: 'All classes in this level' },
                        ...distinctClassNames.map((n) => ({ value: n, label: n })),
                      ]}
                    />
                    <p className="text-[11px] text-slate-500">
                      Schedules by education level across the region. Leave class blank to create for every matching class.
                    </p>
                  </>
                ) : (
                  <>
                    {(!scopeUser || canPickCampus(scopeUser)) ? (
                      <SearchableSelect
                        required
                        className="w-full"
                        value={formData.campusId}
                        onChange={(campusId) => setFormData({ ...formData, campusId, classId: '' })}
                        placeholder="Select campus"
                        searchPlaceholder="Search campuses…"
                        options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                      />
                    ) : null}
                    <SearchableSelect
                      className="w-full"
                      value={formData.educationLevel}
                      onChange={(educationLevel) => setFormData({
                        ...formData,
                        educationLevel: educationLevel as (typeof EDUCATION_LEVELS)[number],
                        classId: '',
                      })}
                      options={EDUCATION_LEVELS.map((l) => ({ value: l, label: l }))}
                    />
                    <SearchableSelect
                      required
                      className="w-full"
                      value={formData.classId}
                      onChange={(classId) => setFormData({ ...formData, classId })}
                      placeholder="Select class / section"
                      searchPlaceholder="Search classes…"
                      options={campusClasses
                        .filter((c) => classMatchesLevel(c.className || '', formData.educationLevel))
                        .map((c) => ({ value: c.id, label: `${c.className} ${c.sectionName}` }))}
                    />
                  </>
                )}
                <div>
                  <input type="date" className="vibrant-input" value={formData.examDate} onChange={(e) => setFormData({ ...formData, examDate: e.target.value })} />
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subjects &amp; Marks Setup</h4>
                    <span className="rounded-lg bg-emerald-100 dark:bg-emerald-900/40 px-2 py-1 text-xs font-black text-emerald-800 dark:text-emerald-200">
                      Total: {subjectsTotal || 0}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="flex-1 min-w-[160px]">
                      <SearchableSelect
                        value={subjectPick}
                        onChange={setSubjectPick}
                        placeholder="Select subject"
                        options={EXAM_SUBJECT_CATALOG
                          .filter((name) => !subjects.some((s) => s.subjectName === name))
                          .map((name) => ({ value: name, label: name }))}
                      />
                    </div>
                    <button
                      type="button"
                      className="vibrant-btn-secondary px-4"
                      onClick={() => {
                        if (!subjectPick) return toast.error('Select a subject first');
                        if (subjects.some((s) => s.subjectName === subjectPick)) {
                          return toast.error('Subject already added');
                        }
                        setSubjects((prev) => [...prev, emptySubjectDraft(subjectPick)]);
                        setSubjectPick('');
                      }}
                    >
                      Add Subject
                    </button>
                  </div>
                  {subjects.length === 0 ? (
                    <p className="text-xs text-slate-400">Add subjects (English, Urdu, Mathematics…) with total and passing marks before creating the exam.</p>
                  ) : (
                    <div className="space-y-2">
                      {subjects.map((s, idx) => (
                        <div key={`${s.subjectName}-${idx}`} className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-4">
                            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Subject</label>
                            <input className="vibrant-input py-2" value={s.subjectName} readOnly />
                          </div>
                          <div className="col-span-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Total marks</label>
                            <input
                              type="number"
                              min={1}
                              className="vibrant-input py-2 font-black"
                              value={s.totalMarks}
                              onChange={(e) => {
                                const totalMarks = Number(e.target.value) || 0;
                                setSubjects((prev) => prev.map((row, i) => i === idx ? {
                                  ...row,
                                  totalMarks,
                                  passingMarks: row.passingMarks > totalMarks ? totalMarks : row.passingMarks,
                                } : row));
                              }}
                            />
                          </div>
                          <div className="col-span-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Passing marks</label>
                            <input
                              type="number"
                              min={0}
                              className="vibrant-input py-2"
                              value={s.passingMarks}
                              onChange={(e) => {
                                const passingMarks = Number(e.target.value) || 0;
                                setSubjects((prev) => prev.map((row, i) => i === idx ? { ...row, passingMarks } : row));
                              }}
                            />
                          </div>
                          <div className="col-span-2">
                            <button
                              type="button"
                              className="w-full vibrant-btn-secondary py-2 text-danger"
                              onClick={() => setSubjects((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">Create</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
