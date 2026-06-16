import React, { useEffect, useState } from 'react';
import { ClipboardList, Users, Briefcase, Save, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Exam, Student, StaffMember } from '../types';
import { dataService } from '../services/dataService';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';

type AttStatus = 'Present' | 'Absent' | 'Leave' | 'Late';

export default function ExamAttendance() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [personTab, setPersonTab] = useState<'Student' | 'Staff'>('Student');
  const [records, setRecords] = useState<Record<string, AttStatus>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dataService.getAll('exams').then(setExams).catch(() => toast.error('Failed to load exams'));
    const unsubStaff = dataService.subscribe('staff', setStaff);
    return () => { unsubStaff(); };
  }, []);

  const selectedExam = exams.find((e) => e.id === selectedExamId);

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

  const examStudents = students;
  const examStaff = selectedExam
    ? staff.filter((m) => m.isActive && m.campusId === selectedExam.campusId)
    : [];

  useEffect(() => {
    if (!selectedExamId) {
      setRecords({});
      return;
    }
    (async () => {
      try {
        const existing = await dataService.fetchExamAttendance(selectedExamId);
        const map: Record<string, AttStatus> = {};
        existing.forEach((r: { personType: string; personId: string; status: AttStatus }) => {
          map[`${r.personType}:${r.personId}`] = r.status;
        });
        setRecords(map);
      } catch {
        setRecords({});
      }
    })();
  }, [selectedExamId]);

  const list = personTab === 'Student' ? examStudents : examStaff;
  const keyFor = (type: string, id: string) => `${type}:${id}`;

  const setStatus = (type: string, id: string, status: AttStatus) => {
    setRecords((prev) => ({ ...prev, [keyFor(type, id)]: status }));
  };

  const markAll = (status: AttStatus) => {
    const next: Record<string, AttStatus> = { ...records };
    list.forEach((p) => {
      next[keyFor(personTab, p.id)] = status;
    });
    setRecords(next);
  };

  const save = async () => {
    if (!selectedExamId) return;
    const payload = Object.entries(records).map(([key, status]) => {
      const [personType, personId] = key.split(':');
      return { personType, personId, status: status as string };
    });
    if (payload.length === 0) {
      toast.error('Mark attendance before saving');
      return;
    }
    setSaving(true);
    try {
      await dataService.saveExamAttendance(selectedExamId, payload);
      toast.success('Exam attendance saved');
    } catch {
      toast.error('Failed to save exam attendance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader module="exam-attendance" />

      <div className="vibrant-card p-6 flex flex-wrap items-center gap-4">
        <ClipboardList className="w-5 h-5 text-primary" />
        <SearchableSelect
          className="flex-1 min-w-[200px]"
          value={selectedExamId}
          onChange={setSelectedExamId}
          placeholder="Select exam"
          searchPlaceholder="Search exams…"
          options={exams.map((e) => ({
            value: e.id,
            label: `${e.title} — ${e.className} (${e.examDate || 'TBD'})`,
          }))}
        />
        <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => setPersonTab('Student')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${personTab === 'Student' ? 'bg-white dark:bg-slate-900 text-primary shadow-sm' : 'text-slate-500'}`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1" /> Students
          </button>
          <button
            type="button"
            onClick={() => setPersonTab('Staff')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${personTab === 'Staff' ? 'bg-white dark:bg-slate-900 text-primary shadow-sm' : 'text-slate-500'}`}
          >
            <Briefcase className="w-3.5 h-3.5 inline mr-1" /> Staff
          </button>
        </div>
      </div>

      {!selectedExamId ? (
        <p className="text-center text-slate-400 py-16">Select an exam to mark attendance</p>
      ) : (
        <>
          <div className="vibrant-card p-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2">
              <button onClick={() => markAll('Present')} className="px-4 py-2 bg-success/10 text-success rounded-xl text-[10px] font-black uppercase">Mark All Present</button>
              <button onClick={() => markAll('Absent')} className="px-4 py-2 bg-danger/10 text-danger rounded-xl text-[10px] font-black uppercase">Mark All Absent</button>
            </div>
            <PermissionGate module="exam-attendance" action="update">
              <motion.button whileTap={{ scale: 0.98 }} onClick={save} disabled={saving} className="vibrant-btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save Attendance'}
              </motion.button>
            </PermissionGate>
          </div>

          <div className="vibrant-card overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-black uppercase text-slate-400">
                <tr>
                  <th className="px-8 py-4">{personTab === 'Student' ? 'Roll / Name' : 'Staff Name'}</th>
                  <th className="px-8 py-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.length === 0 ? (
                  <tr><td colSpan={2} className="px-8 py-12 text-center text-slate-400">No {personTab.toLowerCase()} found for this exam</td></tr>
                ) : list.map((p) => {
                  const label = personTab === 'Student'
                    ? `${(p as Student).rollNumber} — ${(p as Student).firstName}`
                    : (p as StaffMember).fullName;
                  const status = records[keyFor(personTab, p.id)] || 'Present';
                  return (
                    <tr key={p.id}>
                      <td className="px-8 py-4 font-bold text-sm">{label}</td>
                      <td className="px-8 py-4">
                        <div className="flex justify-center gap-1">
                          {(['Present', 'Absent', 'Leave', 'Late'] as AttStatus[]).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(personTab, p.id, s)}
                              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase ${status === s ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-slate-50'}`}
                            >
                              {s === 'Present' && <CheckCircle2 className="w-3 h-3 inline" />}
                              {s === 'Absent' && <XCircle className="w-3 h-3 inline" />}
                              {s === 'Late' && <Clock className="w-3 h-3 inline" />}
                              {' '}{s}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
