import React, { useEffect, useMemo, useState } from 'react';
import { IdCard, Award, Download, Search, Users, UserCircle, CheckCircle } from 'lucide-react';
import { Student, Campus, Class, ExamResult } from '../types';
import { dataService } from '../services/dataService';
import { downloadIdCard, downloadIdCardsBulk, downloadCertificate, downloadSummerCampCertificate } from '../utils/studentDocuments';
import { toast } from 'sonner';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import PageLoader from '../components/ui/PageLoader';

const scopeUser = getStoredUser();

export default function Documents() {
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [batchStudents, setBatchStudents] = useState<Student[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedCampus, setSelectedCampus] = useState(() => scopeUser ? defaultCampusFilter(scopeUser) : 'all');
  const [selectedClass, setSelectedClass] = useState('all');
  const [certType, setCertType] = useState<'Completion' | 'Character' | 'Result' | 'SummerCamp'>('Character');
  const [splitClassId, setSplitClassId] = useState('all');
  const [batchSize, setBatchSize] = useState(200);
  const [batchIndex, setBatchIndex] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);

  useEffect(() => {
    const unsubCampuses = dataService.subscribe('campuses', setCampuses);
    const unsubClasses = dataService.subscribe('classes', setClasses);
    return () => { unsubCampuses(); unsubClasses(); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let cancelled = false;
    const loadStudents = async () => {
      setSearchLoading(true);
      try {
        const result = await dataService.getPaginated('students', {
          page: 1,
          limit: selectedClass !== 'all' ? 200 : 30,
          status: 'Active',
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(selectedCampus !== 'all' ? { campusId: selectedCampus } : {}),
          ...(selectedClass !== 'all' ? { classId: selectedClass } : {}),
        });
        if (!cancelled) setSearchResults(result.data as Student[]);
      } catch (err) {
        console.error('Failed to search students:', err);
        if (!cancelled) {
          setSearchResults([]);
          toast.error('Failed to search students');
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    };
    loadStudents();
    return () => { cancelled = true; };
  }, [debouncedSearch, selectedCampus, selectedClass]);

  useEffect(() => {
    let cancelled = false;
    const loadBatch = async () => {
      if (selectedCampus === 'all' || splitClassId === 'all') {
        setBatchStudents([]);
        setBatchTotal(0);
        setBatchLoading(false);
        return;
      }
      setBatchLoading(true);
      try {
        const result = await dataService.getPaginated('students', {
          page: batchIndex + 1,
          limit: batchSize,
          status: 'Active',
          ...(selectedCampus !== 'all' ? { campusId: selectedCampus } : {}),
          ...(splitClassId !== 'all' ? { classId: splitClassId } : {}),
        });
        if (!cancelled) {
          setBatchStudents(result.data as Student[]);
          setBatchTotal(result.total);
        }
      } catch (err) {
        console.error('Failed to load batch students:', err);
        if (!cancelled) {
          setBatchStudents([]);
          setBatchTotal(0);
        }
      } finally {
        if (!cancelled) setBatchLoading(false);
      }
    };
    loadBatch();
    return () => { cancelled = true; };
  }, [selectedCampus, splitClassId, batchSize, batchIndex]);

  const campusMap = useMemo(() => Object.fromEntries(campuses.map((c) => [c.id, c])), [campuses]);
  const classMap = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);

  const handleIdCard = async (student: Student) => {
    try {
      await downloadIdCard(student, campusMap[student.campusId]);
      toast.success('ID card downloaded');
    } catch {
      toast.error('Failed to generate ID card');
    }
  };

  const totalBatches = Math.max(1, Math.ceil(batchTotal / batchSize));

  const handleBulkIdCards = async () => {
    if (selectedCampus === 'all' || splitClassId === 'all') {
      toast.error('Select a campus and class first');
      return;
    }
    if (batchStudents.length === 0) {
      toast.error('No students in this batch');
      return;
    }
    const selectedClassName = classes.find((c) => c.id === splitClassId)?.className || 'selected class';
    const toastId = toast.loading(`Generating ${batchStudents.length} ID card(s) for ${selectedClassName}...`);
    try {
      await downloadIdCardsBulk(batchStudents, campusMap);
      toast.success('Combined ID card PDF downloaded', { id: toastId });
    } catch {
      toast.error('Failed to generate ID cards', { id: toastId });
    }
  };

  const handleCertificate = async (student: Student) => {
    let examResults: ExamResult[] = [];
    if (certType === 'Result') {
      try {
        const exams = await dataService.getAll('exams', { campusId: student.campusId });
        const classExam = exams.find((e: { classId: string }) => e.classId === student.classId);
        if (classExam) {
          examResults = await dataService.getAll('exam-results', { examId: classExam.id });
          examResults = examResults.filter((r) => r.studentId === student.id);
        }
      } catch {
        // proceed without exam data
      }
    }
    if (certType === 'SummerCamp') {
      downloadSummerCampCertificate(student, campusMap[student.campusId]);
    } else {
      downloadCertificate(student, certType, campusMap[student.campusId], examResults);
    }
    toast.success('Certificate downloaded');
  };

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">ID Cards & Certificates</h2>
        <p className="text-slate-500 font-medium mt-1">Search any student, preview their record, then generate an ID card or certificate.</p>
      </div>

      <div className="vibrant-card p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search student by name or roll number..."
              className="vibrant-input pl-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {(!scopeUser || canPickCampus(scopeUser)) && (
            <select className="vibrant-input" value={selectedCampus} onChange={(e) => { setSelectedCampus(e.target.value); setSelectedClass('all'); setSplitClassId('all'); setBatchIndex(0); }}>
              <option value="all">All Campuses</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
            </select>
          )}
          <select className="vibrant-input" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
            <option value="all">All Classes</option>
            {classes.filter((c) => selectedCampus === 'all' || c.campusId === selectedCampus).map((c) => (
              <option key={c.id} value={c.id}>{c.className} {c.sectionName}</option>
            ))}
          </select>
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-4">
          Search is global by default. Select campus/class only when you want to narrow results.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 vibrant-card overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black">Student Search Results</h3>
              <p className="text-xs text-slate-500">Select a student first, then generate documents.</p>
            </div>
            {searchLoading && <span className="text-[10px] font-black uppercase text-primary">Searching...</span>}
          </div>
          <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {searchLoading && searchResults.length === 0 ? (
              <PageLoader label="Searching students..." />
            ) : searchResults.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <UserCircle className="w-12 h-12 mx-auto mb-3" />
                <p className="font-bold">No students found</p>
                <p className="text-sm">Try searching by full name, father name, or roll number.</p>
              </div>
            ) : searchResults.map((student) => {
              const studentClass = classMap[student.classId];
              const isSelected = selectedStudent?.id === student.id;
              return (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => setSelectedStudent(student)}
                  className={`w-full p-5 flex items-center gap-4 text-left hover:bg-primary/5 transition-all ${isSelected ? 'bg-primary/10 ring-1 ring-primary/20' : ''}`}
                >
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center text-slate-400">
                    {student.profileImage ? (
                      <img src={student.profileImage} alt={student.firstName} className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle className="w-8 h-8" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-slate-900 dark:text-white truncate">{student.firstName} {student.lastName || ''}</p>
                      {isSelected && <CheckCircle className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-xs text-slate-500 font-mono">{student.rollNumber}</p>
                    <p className="text-xs text-slate-400">{studentClass?.className || student.className || 'Class not set'} {studentClass?.sectionName || student.sectionName || ''}</p>
                  </div>
                  <div className="hidden md:block text-right text-xs text-slate-500">
                    <p>{campusMap[student.campusId]?.campusName || student.campusName || 'Campus not set'}</p>
                    <p>{student.status}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="vibrant-card p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 bg-primary/10 rounded-2xl"><IdCard className="w-8 h-8 text-primary" /></div>
              <div>
                <h3 className="text-xl font-black">Selected Student</h3>
                <p className="text-sm text-slate-500">Generate a single ID card or certificate</p>
              </div>
            </div>
            {selectedStudent ? (
              <div className="space-y-5">
                <div className="flex items-center gap-4 p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/50">
                  <div className="w-20 h-24 rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center text-slate-400">
                    {selectedStudent.profileImage ? (
                      <img src={selectedStudent.profileImage} alt={selectedStudent.firstName} className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle className="w-10 h-10" />
                    )}
                  </div>
                  <div>
                    <p className="font-black text-lg">{selectedStudent.firstName} {selectedStudent.lastName || ''}</p>
                    <p className="text-xs font-mono text-slate-500">{selectedStudent.rollNumber}</p>
                    <p className="text-xs text-slate-500">{classMap[selectedStudent.classId]?.className || selectedStudent.className || 'Class not set'}</p>
                  </div>
                </div>
                <button onClick={() => handleIdCard(selectedStudent)} className="vibrant-btn-primary w-full flex items-center justify-center gap-2">
                  <IdCard className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase">Download Single ID Card</span>
                </button>
                <select className="vibrant-input" value={certType} onChange={(e) => setCertType(e.target.value as typeof certType)}>
                  <option value="Character">Character Certificate</option>
                  <option value="Completion">Certificate of Completion</option>
                  <option value="Result">Examination Result Certificate</option>
                  <option value="SummerCamp">Summer Camp Certificate</option>
                </select>
                <button onClick={() => handleCertificate(selectedStudent)} className="vibrant-btn-secondary w-full flex items-center justify-center gap-2">
                  <Award className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase">Download Certificate</span>
                </button>
              </div>
            ) : (
              <div className="text-center py-10 text-slate-400">
                <Search className="w-10 h-10 mx-auto mb-3" />
                <p className="font-bold">Search and select a student</p>
                <p className="text-sm">No campus or class selection is required for single student documents.</p>
              </div>
            )}
          </div>

          <div className="vibrant-card p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-4 bg-accent/10 rounded-2xl"><Users className="w-8 h-8 text-accent" /></div>
            <div>
              <h3 className="text-xl font-black">Batch ID Cards</h3>
              <p className="text-sm text-slate-500">Select campus, then class, then generate one PDF</p>
            </div>
          </div>
          {(!scopeUser || canPickCampus(scopeUser)) && (
            <select
              className="vibrant-input mb-3"
              value={selectedCampus}
              onChange={(e) => {
                setSelectedCampus(e.target.value);
                setSelectedClass('all');
                setSplitClassId('all');
                setBatchIndex(0);
              }}
            >
              <option value="all">Select campus</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
            </select>
          )}
          <select
            className="vibrant-input mb-3"
            value={splitClassId}
            disabled={selectedCampus === 'all'}
            onChange={(e) => {
              setSplitClassId(e.target.value);
              setSelectedClass(e.target.value);
              setSearchTerm('');
              setBatchIndex(0);
            }}
          >
            <option value="all">{selectedCampus === 'all' ? 'Select campus first' : 'Select class'}</option>
            {classes.filter((c) => selectedCampus !== 'all' && c.campusId === selectedCampus).map((c) => (
              <option key={c.id} value={c.id}>{c.className} {c.sectionName}</option>
            ))}
          </select>
          <div className="flex gap-2 mb-3">
            <input type="number" min={5} max={200} className="vibrant-input flex-1" value={batchSize} onChange={(e) => { setBatchSize(Number(e.target.value) || 200); setBatchIndex(0); }} />
            <span className="text-[10px] font-black text-slate-400 uppercase self-center">cards per PDF</span>
          </div>
          <div className="flex gap-2 mb-4">
            <button type="button" disabled={batchIndex <= 0} onClick={() => setBatchIndex((i) => i - 1)} className="flex-1 py-2 rounded-xl border text-[10px] font-black uppercase disabled:opacity-40">Prev</button>
            <span className="text-[10px] font-black text-slate-500 self-center">Batch {batchIndex + 1}/{totalBatches}</span>
            <button type="button" disabled={batchIndex >= totalBatches - 1} onClick={() => setBatchIndex((i) => i + 1)} className="flex-1 py-2 rounded-xl border text-[10px] font-black uppercase disabled:opacity-40">Next</button>
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
            {splitClassId === 'all'
              ? 'Select a class to preview students on the left.'
              : `${batchTotal} student(s) found in selected class.`}
          </p>
          <button onClick={handleBulkIdCards} disabled={batchLoading} className="vibrant-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            <Download className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase">{batchLoading ? 'Loading...' : `Generate PDF (${batchStudents.length})`}</span>
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
