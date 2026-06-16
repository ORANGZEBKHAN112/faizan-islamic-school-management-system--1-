import React, { useEffect, useState } from 'react';
import { Plus, ClipboardList, Save, Trash2, GraduationCap, Download, Edit2 } from 'lucide-react';
import { downloadExamResultSheet } from '../utils/studentDocuments';
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

const scopeUser = getStoredUser();

export default function Exams() {
  const confirm = useConfirm();
  const [exams, setExams] = useState<Exam[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [results, setResults] = useState<Record<string, { obtainedMarks: number; grade: string; remarks: string }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    examType: 'Monthly',
    campusId: scopeUser ? (defaultCampusFilter(scopeUser) !== 'all' ? defaultCampusFilter(scopeUser) : '') : '',
    classId: '',
    examDate: new Date().toISOString().split('T')[0],
    totalMarks: 100,
  });

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
    (async () => {
      try {
        const rows = await dataService.getPaginated('students', {
          classId: selectedExam.classId,
          status: 'Active',
          limit: 200,
          page: 1,
        });
        setStudents(rows.data);
      } catch {
        setStudents([]);
      }
    })();
  }, [selectedExam?.classId]);

  const campusClasses = classes.filter((c) => !formData.campusId || c.campusId === formData.campusId);
  const examStudents = selectedExam
    ? students.filter((s) => s.classId === selectedExam.classId && s.status === 'Active')
    : [];

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
    if (!formData.title.trim() || !formData.campusId || !formData.classId) {
      toast.error('Title, campus, and class are required');
      return;
    }
    try {
      await dataService.addExam(formData);
      toast.success('Exam created');
      await loadExams();
      setIsModalOpen(false);
      setFormData((prev) => ({ ...prev, title: '', classId: '' }));
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.response?.data?.message;
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
      const msg = (err as any)?.response?.data?.message;
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
                    <p className="text-xs text-slate-500 mt-1">{exam.className} · {exam.campusName}</p>
                    <p className="text-[10px] font-black text-primary uppercase tracking-widest mt-2">{exam.examType} · {exam.examDate || 'TBD'}</p>
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
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-primary" />
              <h3 className="font-black uppercase tracking-widest text-sm">
                {selectedExam ? `Results: ${selectedExam.title}` : 'Select an exam'}
              </h3>
            </div>
            {selectedExam && (
              <div className="flex gap-2">
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
                  <span className="text-[10px] font-black uppercase">PDF</span>
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
                    <th className="px-6 py-4">Marks / {selectedExam.totalMarks}</th>
                    <th className="px-6 py-4">Grade</th>
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
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="vibrant-card w-full max-w-md p-8">
              <h3 className="text-2xl font-black mb-6">Schedule Exam</h3>
              <form onSubmit={handleCreateExam} className="space-y-4">
                <input className="vibrant-input" placeholder="Exam title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required />
                <SearchableSelect
                  value={formData.examType}
                  onChange={(examType) => setFormData({ ...formData, examType })}
                  searchPlaceholder="Search type…"
                  options={['Monthly', 'Midterm', 'Final', 'Quiz'].map((t) => ({ value: t, label: t }))}
                />
                {(!scopeUser || canPickCampus(scopeUser)) ? (
                  <SearchableSelect
                    required
                    value={formData.campusId}
                    onChange={(campusId) => setFormData({ ...formData, campusId, classId: '' })}
                    placeholder="Select campus"
                    searchPlaceholder="Search campuses…"
                    options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                  />
                ) : null}
                <SearchableSelect
                  required
                  value={formData.classId}
                  onChange={(classId) => setFormData({ ...formData, classId })}
                  placeholder="Select class"
                  searchPlaceholder="Search classes…"
                  options={campusClasses.map((c) => ({ value: c.id, label: `${c.className} ${c.sectionName}` }))}
                />
                <div className="grid grid-cols-2 gap-4">
                  <input type="date" className="vibrant-input" value={formData.examDate} onChange={(e) => setFormData({ ...formData, examDate: e.target.value })} />
                  <input type="number" className="vibrant-input" placeholder="Total marks" value={formData.totalMarks} onChange={(e) => setFormData({ ...formData, totalMarks: parseInt(e.target.value) || 100 })} />
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
