import React, { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, Users, CheckCircle2, XCircle, Clock, Save, FileText, ChevronRight, Search, Building } from 'lucide-react';
import { Student, Campus, Class, Attendance } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useCollection } from '../hooks/useCollection';
import PageLoader from '../components/ui/PageLoader';
import SearchableSelect from '../components/ui/SearchableSelect';
import TableSkeleton from '../components/ui/TableSkeleton';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { PermissionGate } from '../context/PermissionContext';

export default function AttendancePage() {
  const [saving, setSaving] = useState(false);

  const [selectedCampus, setSelectedCampus] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, 'Present' | 'Absent' | 'Leave' | 'Late'>>({});

  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  const { data: classes, loading: classesLoading } = useCollection<Class>('classes');
  const { data: attendance, loading: attendanceLoading } = useCollection<Attendance>('attendance');
  const { data: students, loading: studentsLoading } = useCollection<Student>('students', {
    params: {
      ...(selectedCampus ? { campusId: selectedCampus } : {}),
      ...(selectedClass ? { classId: selectedClass } : {}),
      status: 'Active',
      limit: 200,
    },
    paginated: true,
  });

  // Filter students by selected campus and class
  const filteredStudents = students.filter(s => 
    s.campusId === selectedCampus && s.classId === selectedClass && s.status === 'Active'
  );

  // Load existing attendance for selected class and date
  useEffect(() => {
    if (selectedClass && selectedDate) {
      const existing = attendance.filter(a => 
        a.classId === selectedClass && a.date.split('T')[0] === selectedDate
      );
      
      const records: Record<string, 'Present' | 'Absent' | 'Leave' | 'Late'> = {};
      existing.forEach(a => {
        records[a.studentId] = a.status;
      });
      
      // If no records found, default to nothing (or 'Present' if users prefer)
      setAttendanceRecords(records);
    }
  }, [selectedClass, selectedDate, attendance]);

  const handleStatusChange = (studentId: string, status: 'Present' | 'Absent' | 'Leave' | 'Late') => {
    setAttendanceRecords(prev => ({
      ...prev,
      [studentId]: status
    }));
  };

  const markAll = (status: 'Present' | 'Absent' | 'Leave' | 'Late') => {
    const records: Record<string, 'Present' | 'Absent' | 'Leave' | 'Late'> = {};
    filteredStudents.forEach(s => {
      records[s.id] = status;
    });
    setAttendanceRecords(records);
  };

  const saveAttendance = async () => {
    if (!selectedClass || !selectedDate) {
      toast.error('Please select class and date');
      return;
    }

    if (Object.keys(attendanceRecords).length === 0) {
      toast.error('No attendance marked');
      return;
    }

    setSaving(true);
    try {
      // Find existing records to delete/update
      const existing = attendance.filter(a => 
        a.classId === selectedClass && a.date.split('T')[0] === selectedDate
      );

      // Simple implementation: delete existing and insert new
      // (In production, you'd use a more surgical update/upsert)
      for (const record of existing) {
        await dataService.delete('attendance', record.id);
      }

      for (const [studentId, status] of Object.entries(attendanceRecords)) {
        await dataService.add('attendance', {
          studentId,
          classId: selectedClass,
          date: selectedDate,
          status,
          recordedBy: 'Admin' // Should be current user
        });
      }

      toast.success(`Attendance saved for ${selectedDate}`);
    } catch (err) {
      console.error('Save attendance error:', err);
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  const activeCampuses = campuses;
  const currentClasses = classes.filter(c => c.campusId === selectedCampus);
  const loading = campusesLoading || classesLoading || studentsLoading || attendanceLoading;

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader module="attendance" />

      <div className="flex flex-wrap items-center gap-4 bg-white/50 dark:bg-slate-900/50 p-2 rounded-3xl border border-slate-100 dark:border-slate-800 backdrop-blur-md">
           <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <Building className="w-4 h-4 text-slate-400" />
            <SearchableSelect
              variant="inline"
              value={selectedCampus}
              onChange={(campusId) => {
                setSelectedCampus(campusId);
                setSelectedClass('');
              }}
              disabled={campusesLoading}
              loading={campusesLoading}
              loadingText="Loading campuses…"
              placeholder="Select Campus"
              searchPlaceholder="Search campuses…"
              options={activeCampuses.map((c) => ({ value: c.id, label: c.campusName }))}
            />
          </div>

          <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <Users className="w-4 h-4 text-slate-400" />
            <SearchableSelect
              variant="inline"
              value={selectedClass}
              onChange={setSelectedClass}
              disabled={!selectedCampus || classesLoading}
              loading={classesLoading}
              loadingText="Loading classes…"
              placeholder={!selectedCampus ? 'Select Campus First' : 'Select Class'}
              searchPlaceholder="Search classes…"
              options={currentClasses.map((c) => ({ value: c.id, label: `${c.className} - ${c.sectionName}` }))}
            />
          </div>

          <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <CalendarIcon className="w-4 h-4 text-slate-400" />
            <input 
              type="date"
              className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:ring-0 cursor-pointer"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

      {loading && <PageLoader label="Loading attendance data…" />}
      <AnimatePresence mode="wait">
        {!selectedClass ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center p-20 text-center space-y-4 bg-slate-50/50 dark:bg-slate-900/50 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[40px]"
          >
            <div className="w-20 h-20 bg-primary/10 text-primary rounded-3xl flex items-center justify-center mb-4">
              <Users className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Select Class & Campus</h3>
            <p className="max-w-xs text-slate-400 font-medium">Please select a campus and class from the filters above to mark or view attendance records.</p>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Bulk Actions & Summary */}
            <div className="vibrant-card p-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => markAll('Present')}
                  className="px-6 py-3 bg-green-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-green-500/20 hover:bg-green-600 transition-all"
                >
                  Mark All Present
                </button>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-2" />
                <div className="flex gap-2">
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Students: <span className="text-slate-900 dark:text-white">{filteredStudents.length}</span>
                  </div>
                  <div className="px-4 py-2 bg-green-500/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-green-500">
                    Present: <span className="text-green-600">{Object.values(attendanceRecords).filter(s => s === 'Present').length}</span>
                  </div>
                  <div className="px-4 py-2 bg-rose-500/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-rose-500">
                    Absent: <span className="text-rose-600">{Object.values(attendanceRecords).filter(s => s === 'Absent').length}</span>
                  </div>
                </div>
              </div>

              <PermissionGate module="attendance" action="update">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={saveAttendance}
                  disabled={saving || filteredStudents.length === 0}
                  className="w-full md:w-auto px-8 py-3 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Clock className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save Attendance'}
                </motion.button>
              </PermissionGate>
            </div>

            {/* Attendance Table */}
            <div className="vibrant-card overflow-hidden">
              {studentsLoading ? (
                <div className="p-6">
                  <TableSkeleton rows={6} columns={3} />
                </div>
              ) : (
               <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50/50 dark:bg-slate-800/50">
                    <tr className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                      <th className="px-8 py-5">Roll #</th>
                      <th className="px-8 py-5">Student Name</th>
                      <th className="px-8 py-5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-8 py-20 text-center text-sm font-medium text-slate-400 italic">No active students found in this class.</td>
                      </tr>
                    ) : (
                      filteredStudents.map((student) => (
                        <tr key={student.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group">
                          <td className="px-8 py-5">
                            <span className="text-xs font-black text-slate-400 group-hover:text-primary transition-colors">{student.rollNumber}</span>
                          </td>
                          <td className="px-8 py-5">
                            <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">{`${student.firstName}${student.lastName ? ' ' + student.lastName : ''}`}</div>
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{student.fatherName}</div>
                          </td>
                          <td className="px-8 py-5 text-center">
                            <div className="flex items-center justify-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-2xl w-fit mx-auto border border-slate-100 dark:border-slate-800 shadow-sm">
                              {[
                                { status: 'Present', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
                                { status: 'Absent', icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
                                { status: 'Leave', icon: FileText, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                                { status: 'Late', icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10' }
                              ].map((opt) => (
                                <button
                                  key={opt.status}
                                  onClick={() => handleStatusChange(student.id, opt.status as any)}
                                  className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                                    attendanceRecords[student.id] === opt.status 
                                      ? `${opt.bg} ${opt.color} shadow-lg shadow-${opt.color.split('-')[1]}/10` 
                                      : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <opt.icon className="w-3.5 h-3.5" />
                                  <span className={attendanceRecords[student.id] === opt.status ? 'inline' : 'hidden md:inline'}>{opt.status}</span>
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
