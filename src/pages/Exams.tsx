import React, { useEffect, useState } from 'react';
import { Plus, ClipboardList, Trash2, GraduationCap, Download, Lock, Unlock, Send } from 'lucide-react';
import { downloadExamDateSheet, downloadExamReportCards } from '../utils/studentDocuments';
import { Exam, Campus, Class, ExamReport, ExamMeritRow, ExamCumulative } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import { EXAM_COMPONENTS, EXAM_SUBJECT_CATALOG, currentAcademicSession, defaultExamWeight, emptySubjectDraft, sumSubjectTotals, type ExamSubjectDraft } from '../utils/examSubjects';

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

export default function Exams() {
  const confirm = useConfirm();
  const [exams, setExams] = useState<Exam[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [report, setReport] = useState<ExamReport | null>(null);
  const [merit, setMerit] = useState<ExamMeritRow[] | null>(null);
  const [cumulative, setCumulative] = useState<ExamCumulative | null>(null);
  const [deskLoading, setDeskLoading] = useState(false);
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
    academicSession: currentAcademicSession(),
    weightPercent: defaultExamWeight('Monthly'),
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

  const openExam = async (exam: Exam) => {
    setSelectedExam(exam);
    setMerit(null);
    setCumulative(null);
    setDeskLoading(true);
    try {
      setReport(await dataService.fetchExamReport(exam.id));
    } catch (err) {
      console.error(err);
      setReport(null);
      toast.error('Failed to load exam desk');
    } finally {
      setDeskLoading(false);
    }
  };

  const changeStatus = async (action: 'lock' | 'publish' | 'reopen') => {
    if (!selectedExam) return;
    try {
      await dataService.setExamStatus(selectedExam.id, action);
      toast.success(action === 'lock' ? 'Exam locked' : action === 'publish' ? 'Result published' : 'Exam reopened');
      const data = await dataService.getAll('exams');
      setExams(data);
      const updated = (data as Exam[]).find((exam) => exam.id === selectedExam.id);
      if (updated) await openExam(updated);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not update exam status');
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
      examDate: s.examDate || undefined,
      startTime: s.startTime || undefined,
      component: s.component,
      gradingMode: s.component === 'Hifz' ? 'Hifz' : 'Marks',
    }));
    const scheduleFields = {
      academicSession: formData.academicSession,
      weightPercent: Number(formData.weightPercent) || 0,
    };
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
            ...scheduleFields,
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
          ...scheduleFields,
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
      if (selectedExam?.id === id) {
        setSelectedExam(null);
        setReport(null);
        setMerit(null);
        setCumulative(null);
      }
      await loadExams();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete exam');
    }
  };

  const examStatus = selectedExam?.status || 'Draft';

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
                onClick={() => openExam(exam)}
                className={`w-full text-left p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedExam?.id === exam.id ? 'bg-primary/5 border-l-4 border-primary' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{exam.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{exam.className} · {exam.campusName}{exam.region ? ` · ${exam.region}` : ''}</p>
                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-2">{exam.examType} · {exam.status || 'Draft'} · {exam.examDate || 'TBD'} · {inferEducationLevel(exam.className)}</p>
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
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-black uppercase tracking-widest text-sm">
                  {selectedExam ? selectedExam.title : 'Exam desk'}
                </h3>
                {selectedExam && (
                  <p className="text-xs text-slate-500 mt-1">
                    {examStatus} · weight {selectedExam.weightPercent ?? '—'}% · {selectedExam.academicSession || 'No session'}
                  </p>
                )}
              </div>
            </div>
            {selectedExam && (
              <div className="flex flex-wrap gap-2">
                <PermissionGate module="exams" action="update">
                  {examStatus === 'Draft' && (
                    <button type="button" onClick={() => changeStatus('lock')} className="vibrant-btn-secondary flex items-center gap-2 py-2 px-3">
                      <Lock className="w-4 h-4" /> Lock
                    </button>
                  )}
                  {examStatus !== 'Published' && (
                    <button type="button" onClick={() => changeStatus('publish')} className="vibrant-btn-primary flex items-center gap-2 py-2 px-3">
                      <Send className="w-4 h-4" /> Publish
                    </button>
                  )}
                  {examStatus !== 'Draft' && (
                    <button type="button" onClick={() => changeStatus('reopen')} className="vibrant-btn-secondary flex items-center gap-2 py-2 px-3">
                      <Unlock className="w-4 h-4" /> Reopen
                    </button>
                  )}
                </PermissionGate>
                <button
                  type="button"
                  className="vibrant-btn-secondary flex items-center gap-2 py-2 px-3"
                  onClick={() => {
                    if (!report) return;
                    downloadExamDateSheet(report);
                    toast.success('Date sheet downloaded');
                  }}
                >
                  <Download className="w-4 h-4" /> Date sheet
                </button>
                <button
                  type="button"
                  className="vibrant-btn-secondary flex items-center gap-2 py-2 px-3"
                  onClick={() => {
                    if (!report || !downloadExamReportCards(report)) return toast.error('Save marks before downloading report cards');
                    toast.success('Report cards downloaded');
                  }}
                >
                  <Download className="w-4 h-4" /> Report cards
                </button>
                <button
                  type="button"
                  className="vibrant-btn-secondary py-2 px-3"
                  onClick={async () => {
                    if (!selectedExam.className) return;
                    try {
                      const data = await dataService.fetchExamMerit({
                        title: selectedExam.title,
                        className: selectedExam.className,
                        region: selectedExam.region || undefined,
                      });
                      setMerit(data.rows);
                    } catch (err) {
                      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
                      toast.error(msg || 'Could not load region merit');
                    }
                  }}
                >
                  Region merit
                </button>
                <button
                  type="button"
                  className="vibrant-btn-secondary py-2 px-3"
                  onClick={async () => {
                    try {
                      const data = await dataService.fetchExamCumulative({
                        classId: selectedExam.classId,
                        session: selectedExam.academicSession || undefined,
                      });
                      setCumulative(data);
                    } catch (err) {
                      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
                      toast.error(msg || 'Could not load term total');
                    }
                  }}
                >
                  Term total
                </button>
              </div>
            )}
          </div>
          {!selectedExam ? (
            <p className="p-8 text-center text-slate-400">Select an exam to see the date sheet, pass rate, and publish controls. Marks are entered on Marks Entry.</p>
          ) : deskLoading ? (
            <p className="p-8 text-center text-slate-400">Loading exam desk…</p>
          ) : (
            <div className="p-6 space-y-5 max-h-[560px] overflow-y-auto">
              {report && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 p-3">
                    <p className="text-lg font-black text-emerald-700">{report.summary.pass}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Pass</p>
                  </div>
                  <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 p-3">
                    <p className="text-lg font-black text-rose-700">{report.summary.fail}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Fail</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3">
                    <p className="text-lg font-black">{report.summary.absent}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Absent</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 p-3">
                    <p className="text-lg font-black text-amber-700">{report.summary.average}%</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Average</p>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">Enter subject marks on Marks Entry. A student fails if any paper is below its passing marks. An exam-day absence is saved as Absent and is left out of the rank. Publishing holds the result when a fee voucher is still unpaid.</p>
              {report && report.subjectStats.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Subject pass rate</p>
                  {report.subjectStats.map((subject) => (
                    <div key={subject.subjectId} className="flex items-center justify-between text-sm">
                      <span>{subject.subjectName}</span>
                      <span className="font-bold">{subject.passPercent}% pass · avg {subject.average}</span>
                    </div>
                  ))}
                </div>
              )}
              {merit && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Region merit</p>
                  {merit.length === 0 ? <p className="text-sm text-slate-400">No saved results for this paper yet.</p> : merit.slice(0, 12).map((row) => (
                    <div key={`${row.campusName}-${row.rollNumber}`} className="flex justify-between text-sm gap-3">
                      <span>{row.rank ?? '—'} · {row.studentName}</span>
                      <span className="text-slate-500">{row.campusName} · {row.percentage}%</span>
                    </div>
                  ))}
                </div>
              )}
              {cumulative && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Weighted total · {cumulative.exams.map((exam) => `${exam.examType} ${exam.weightPercent}%`).join(', ') || 'no exams'}
                  </p>
                  {cumulative.students.slice(0, 12).map((row) => (
                    <div key={row.studentId} className="flex justify-between text-sm">
                      <span>{row.studentName}</span>
                      <span className="font-bold">{row.weightedPercentage}% · {row.grade}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="vibrant-card w-full max-w-3xl p-8 max-h-[90vh] overflow-y-auto">
              <h3 className="text-2xl font-black mb-6">Schedule Exam</h3>
              <form onSubmit={handleCreateExam} className="space-y-4">
                <input className="vibrant-input" placeholder="Exam title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required />
                <SearchableSelect
                  value={formData.examType}
                  onChange={(examType) => setFormData({ ...formData, examType, weightPercent: defaultExamWeight(examType) })}
                  searchPlaceholder="Search type…"
                  options={['Monthly', 'Midterm', 'Final', 'Quiz'].map((t) => ({ value: t, label: t }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input className="vibrant-input" placeholder="Session 2026-2027" value={formData.academicSession} onChange={(e) => setFormData({ ...formData, academicSession: e.target.value })} />
                  <input type="number" min={0} max={100} className="vibrant-input" placeholder="Weight %" value={formData.weightPercent} onChange={(e) => setFormData({ ...formData, weightPercent: Number(e.target.value) })} />
                </div>
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
                        const hifz = /hifz|nazra/i.test(subjectPick);
                        setSubjects((prev) => [...prev, {
                          ...emptySubjectDraft(subjectPick),
                          component: hifz ? 'Hifz' : 'Written',
                          gradingMode: hifz ? 'Hifz' : 'Marks',
                          totalMarks: hifz ? 30 : 100,
                          passingMarks: hifz ? 15 : 33,
                        }]);
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
                        <div key={`${s.subjectName}-${idx}`} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                          <div className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-4">
                              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Subject</label>
                              <input className="vibrant-input py-2" value={s.subjectName} readOnly />
                            </div>
                            <div className="col-span-3">
                              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">{s.component === 'Hifz' ? 'Paras' : 'Total marks'}</label>
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
                              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Passing</label>
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
                          <div className="grid grid-cols-12 gap-2">
                            <input type="date" className="vibrant-input py-2 col-span-4" value={s.examDate} onChange={(e) => setSubjects((prev) => prev.map((row, i) => i === idx ? { ...row, examDate: e.target.value } : row))} />
                            <input type="time" className="vibrant-input py-2 col-span-3" value={s.startTime} onChange={(e) => setSubjects((prev) => prev.map((row, i) => i === idx ? { ...row, startTime: e.target.value } : row))} />
                            <select
                              className="vibrant-input py-2 col-span-5"
                              value={s.component}
                              onChange={(e) => {
                                const component = e.target.value as ExamSubjectDraft['component'];
                                setSubjects((prev) => prev.map((row, i) => i === idx ? {
                                  ...row,
                                  component,
                                  gradingMode: component === 'Hifz' ? 'Hifz' : 'Marks',
                                } : row));
                              }}
                            >
                              {EXAM_COMPONENTS.map((component) => <option key={component} value={component}>{component}</option>)}
                            </select>
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
