import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Edit2, Trash2, UserCircle, Filter, Eye, XCircle, CreditCard, FileText, Download, Share2, AlertCircle, Camera, Upload } from 'lucide-react';
import { Student, Campus, Class, Fee } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStoredUser } from '../utils/campusScope';
import { useCollection } from '../hooks/useCollection';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import TableSkeleton from '../components/ui/TableSkeleton';
import Pagination from '../components/ui/Pagination';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import { usePermissions } from '../context/PermissionContext';
import { useI18n } from '../context/I18nContext';

const scopeUser = getStoredUser();

export default function StudentManagement() {
  const navigate = useNavigate();
  const { canCreate, canUpdate, canDelete } = usePermissions();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vouchers, setVouchers] = useState<Fee[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'fees'>('profile');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCampus, setSelectedCampus] = useState<string>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  
  const [formData, setFormData] = useState({
    campusId: '',
    classId: '',
    serialNo: '',
    rollNumber: '',
    firstName: '',
    lastName: '',
    fatherName: '',
    dateOfBirth: '',
    gender: 'Male',
    contactNumber: '',
    cnicBForm: '',
    address: '',
    admissionDate: new Date().toISOString().split('T')[0],
    registrationDate: new Date().toISOString().split('T')[0],
    studentCode: '',
    campusName: '',
    country: 'Pakistan',
    province: 'Punjab',
    city: 'Multan',
    tehsil: '',
    className: '',
    sectionName: '',
    session: '2022',
    status: 'Active' as const,
    outstandingFees: 0,
    campusType: 'Physical Campus',
    profileImage: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const studentParams = useMemo(
    () => ({
      page: currentPage,
      limit: itemsPerPage,
      ...(selectedCampus !== 'all' ? { campusId: selectedCampus } : {}),
      ...(selectedClass !== 'all' ? { classId: selectedClass } : {}),
      ...(selectedStatus !== 'all' && selectedStatus !== 'unpaid' ? { status: selectedStatus } : {}),
      ...(debouncedSearchTerm.trim() ? { search: debouncedSearchTerm.trim() } : {}),
    }),
    [currentPage, selectedCampus, selectedClass, selectedStatus, debouncedSearchTerm]
  );

  const {
    data: students,
    loading: studentsLoading,
    total: studentsTotal,
  } = useCollection<Student>('students', { params: studentParams, paginated: true });
  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  const { data: classes, loading: classesLoading } = useCollection<Class>('classes');

  const outstandingByStudent = useMemo(() => {
    const totals = new Map<string, number>();
    for (const v of vouchers) {
      const balance = Number(
        v.balanceAmount ??
        (Number(v.amount || 0) + Number(v.arrears || 0) - Number(v.paidAmount || 0))
      );
      if (!v.studentId || Number.isNaN(balance) || balance <= 0) continue;
      totals.set(v.studentId, (totals.get(v.studentId) || 0) + balance);
    }
    return totals;
  }, [vouchers]);

  const getStudentOutstanding = (student: Student) => {
    const fromStudent = Number(student.outstandingFees || 0);
    const fromVouchers = Number(outstandingByStudent.get(student.id) || 0);
    return Math.max(fromStudent, fromVouchers);
  };

  const filteredStudents = useMemo(() => {
    if (selectedStatus !== 'unpaid') return students;
    return students.filter((s) => getStudentOutstanding(s) > 0);
  }, [students, selectedStatus, outstandingByStudent]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCampus, selectedClass, selectedStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (selectedCampus !== 'all' && selectedClass !== 'all') {
      const classStillVisible = classes.some((c) => c.id === selectedClass && c.campusId === selectedCampus);
      if (!classStillVisible) setSelectedClass('all');
    }
  }, [selectedCampus, selectedClass, classes]);

  useEffect(() => {
    if (!selectedStudent?.id) {
      setVouchers([]);
      return;
    }
    (async () => {
      try {
        const rows = await dataService.getPaginated('fees', {
          studentId: selectedStudent.id,
          limit: 200,
          page: 1,
        });
        setVouchers(rows.data);
      } catch {
        setVouchers([]);
      }
    })();
  }, [selectedStudent?.id]);

  useEffect(() => {
    const studentId = searchParams.get('id');
    if (studentId && students.length > 0) {
      const student = students.find(s => s.id === studentId);
      if (student) {
        setSelectedStudent(student);
        setIsProfileModalOpen(true);
      }
    }
  }, [searchParams, students]);

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => () => stopCamera(), []);

  const exportToCSV = () => {
    const headers = ['Roll Number', 'First Name', 'Last Name', 'Father Name', 'Class', 'Campus', 'Mobile', 'Status', 'Outstanding Fees'];
    const csvData = filteredStudents.map(s => [
      s.rollNumber,
      s.firstName,
      s.lastName,
      s.fatherName,
      classes.find(c => c.id === s.classId)?.className || 'N/A',
      campuses.find(c => c.id === s.campusId)?.campusName || 'N/A',
      s.contactNumber,
      s.status,
      getStudentOutstanding(s)
    ]);

    const csvContent = [headers, ...csvData].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Students_Export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalRows = selectedStatus === 'unpaid' ? filteredStudents.length : studentsTotal;
  const totalPages = Math.max(1, Math.ceil(totalRows / itemsPerPage));
  const paginatedStudents = filteredStudents;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.campusId) {
      toast.error('Please select a campus');
      return;
    }
    if (!formData.classId) {
      toast.error('Please select a class');
      return;
    }
    if (!formData.firstName.trim()) {
      toast.error('First name is required');
      return;
    }
    if (!formData.fatherName.trim()) {
      toast.error('Father\'s name is required');
      return;
    }
    if (!formData.contactNumber.trim()) {
      toast.error('Contact number is required');
      return;
    }

    try {
      let finalRollNumber = formData.rollNumber;
      if (!editingId && !finalRollNumber) {
        const year = new Date().getFullYear();
        const random = Math.floor(1000 + Math.random() * 9000);
        finalRollNumber = `STU-${year}-${random}`;
      }

      const studentData = { 
        ...formData, 
        rollNumber: finalRollNumber,
        outstandingFees: Number(formData.outstandingFees) || 0
      };

      if (editingId) {
        await dataService.update('students', editingId, studentData);
        if (pendingPhotoFile) {
          const { profileImage } = await dataService.uploadStudentPhoto(editingId, pendingPhotoFile);
          setFormData((prev) => ({ ...prev, profileImage }));
          setPendingPhotoFile(null);
        }
        toast.success('Student record updated successfully');
      } else {
        const created = await dataService.add('students', studentData) as { id?: string };
        const newStudentId = created?.id;
        if (newStudentId && pendingPhotoFile) {
          try {
            await dataService.uploadStudentPhoto(newStudentId, pendingPhotoFile);
          } catch (photoErr) {
            console.error('Photo upload failed:', photoErr);
            toast.warning('Student saved but photo upload failed');
          }
          setPendingPhotoFile(null);
        }
        if (newStudentId) {
          // Create a login account for the student. Failure here should not
          // discard the saved student record, so handle it independently.
          try {
            await dataService.add('users', {
              fullName: `${formData.firstName} ${formData.lastName}`,
              username: finalRollNumber,
              email: `${finalRollNumber.toLowerCase()}@faizan.com`,
              role: 'Student',
              campusId: formData.campusId,
              isActive: true,
              createdOn: new Date().toISOString()
            });
            toast.success('Student registered successfully (login account created)');
          } catch (userErr) {
            console.error('Student saved, but login account creation failed:', userErr);
            toast.success('Student registered successfully');
            toast.warning('Login account was not created for this student.');
          }
        }
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({
        campusId: '', classId: '', serialNo: '', rollNumber: '', firstName: '', lastName: '',
        fatherName: '', dateOfBirth: '', gender: 'Male', contactNumber: '', cnicBForm: '',
        address: '', admissionDate: new Date().toISOString().split('T')[0], registrationDate: new Date().toISOString().split('T')[0],
        studentCode: '', campusName: '', country: 'Pakistan', province: 'Punjab', city: 'Multan',
        tehsil: '', className: '', sectionName: '', session: '2022', status: 'Active', outstandingFees: 0, campusType: 'Physical Campus',
        profileImage: '',
      });
      setPendingPhotoFile(null);
    } catch (error: unknown) {
      console.error('Error saving student:', error);
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save student record');
    }
  };

  const handleEdit = (student: Student) => {
    setEditingId(student.id);
    setFormData({
      campusId: student.campusId,
      classId: student.classId,
      serialNo: student.serialNo || '',
      rollNumber: student.rollNumber,
      firstName: student.firstName,
      lastName: student.lastName || '',
      fatherName: student.fatherName || '',
      dateOfBirth: student.dateOfBirth || '',
      gender: student.gender || 'Male',
      contactNumber: student.contactNumber || '',
      cnicBForm: student.cnicBForm || '',
      address: student.address || '',
      admissionDate: student.admissionDate || '',
      registrationDate: student.registrationDate || '',
      studentCode: student.studentCode || '',
      campusName: student.campusName || '',
      country: student.country || 'Pakistan',
      province: student.province || 'Punjab',
      city: student.city || 'Multan',
      tehsil: student.tehsil || '',
      className: student.className || '',
      sectionName: student.sectionName || '',
      session: student.session || '2022',
      status: student.status,
      outstandingFees: student.outstandingFees || 0,
      campusType: student.campusType || 'Physical Campus',
      profileImage: student.profileImage || '',
    });
    setPendingPhotoFile(null);
    setIsModalOpen(true);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handlePhotoFile(file);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const handlePhotoFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (editingId) {
      setUploadingPhoto(true);
      try {
        const { profileImage } = await dataService.uploadStudentPhoto(editingId, file);
        setFormData((prev) => ({ ...prev, profileImage }));
        toast.success('Photo uploaded');
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast.error(msg || 'Photo upload failed');
      } finally {
        setUploadingPhoto(false);
      }
    } else {
      setPendingPhotoFile(file);
      setFormData((prev) => ({ ...prev, profileImage: URL.createObjectURL(file) }));
      toast.success('Photo will be uploaded when student is saved');
    }
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera is not supported in this browser. Please use file upload.');
      return;
    }
    try {
      setCameraLoading(true);
      setIsCameraOpen(true);
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera open failed:', err);
      toast.error('Unable to open camera. Please allow camera permission or check the connected camera.');
      setIsCameraOpen(false);
      stopCamera();
    } finally {
      setCameraLoading(false);
    }
  };

  const closeCamera = () => {
    stopCamera();
    setIsCameraOpen(false);
  };

  const captureCameraPhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error('Failed to capture photo');
        return;
      }
      const file = new File([blob], `student-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      await handlePhotoFile(file);
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  const classOptionLabel = (c: Class) => {
    const cap = c.capacity ? ` (${c.enrolledCount ?? 0}/${c.capacity})` : '';
    return `${c.className} - ${c.sectionName}${cap}`;
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.xlsx$/i)) {
      toast.error('Please upload an Excel workbook (.xlsx)');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsImporting(true);
    const toastId = toast.loading(`Importing ${file.name}… Large files (~7,000+ rows) may take up to 15 minutes. Please keep this tab open.`);

    try {
      const response = await dataService.importStudents(file);
      const { imported, updated = 0, skipped = 0, totalRows, failed, newCampuses, newClasses, arrearsVouchers, errorDetails } = response;

      if (failed > 0) {
        toast.warning(`Import done: ${imported} new, ${updated} updated, ${failed} failed (${totalRows} rows).`, {
          id: toastId,
          duration: 12000,
          description: errorDetails?.length ? errorDetails.slice(0, 2).join(' | ') : undefined,
        });
      } else {
        toast.success(
          `Imported ${imported} students (${updated} updated). Campuses: +${newCampuses ?? 0}, Classes: +${newClasses ?? 0}, Arrears vouchers: ${arrearsVouchers ?? 0}.`,
          { id: toastId, duration: 8000 }
        );
      }
      if (skipped > 0) {
        toast.info(`${skipped} empty rows skipped.`);
      }

      dataService.invalidateCollection('students');
      dataService.invalidateCollection('classes');
      dataService.invalidateCollection('campuses');
      setCurrentPage(1);
    } catch (error: unknown) {
      console.error('Import failed:', error);
      const err = error as { response?: { data?: { message?: string } }; message?: string; code?: string };
      const errorMessage = err.response?.data?.message || err.message || 'Failed to import students';
      toast.error(errorMessage, {
        id: toastId,
        duration: 10000,
        description: err.code === 'ECONNABORTED' ? 'Import timed out — try again or split the file.' : undefined,
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = (id: string) => {
    setStudentToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!studentToDelete) return;
    
    try {
      await dataService.delete('students', studentToDelete);
      toast.success('Student record deleted successfully');
      setIsDeleteModalOpen(false);
      setStudentToDelete(null);
    } catch (error) {
      console.error('Error deleting student:', error);
      toast.error('Failed to delete student record');
    }
  };

  const hasActiveFilters =
    !!debouncedSearchTerm.trim() ||
    selectedCampus !== 'all' ||
    selectedClass !== 'all' ||
    selectedStatus !== 'all';

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="students"
        actions={
          <>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportExcel}
              accept=".xlsx"
              className="hidden"
            />
            {canCreate('students') && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                className="vibrant-btn-secondary px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                {isImporting ? t('pages.students.importing') : t('pages.students.importStudents')}
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={exportToCSV}
              className="vibrant-btn-secondary px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold"
            >
              <Download className="w-4 h-4" />
              {t('pages.students.export')}
            </motion.button>
            {canCreate('students') && (
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setEditingId(null);
                  setIsModalOpen(true);
                }}
                className="vibrant-btn-primary px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-semibold shadow-xl shadow-primary/20"
              >
                <Plus className="w-4 h-4" />
                {t('pages.students.registerStudent')}
              </motion.button>
            )}
          </>
        }
      />

      <div className="vibrant-card">
        <div className="p-8 border-b border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-6 bg-slate-50/50 dark:bg-slate-900/50 overflow-visible">
          <div className="relative group col-span-1 md:col-span-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder={t('pages.students.searchPlaceholder')}
              className="vibrant-input pl-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <SearchableSelect
            variant="compact"
            value={selectedCampus}
            onChange={setSelectedCampus}
            disabled={campusesLoading}
            loading={campusesLoading}
            loadingText="Loading campuses…"
            placeholder="All Campuses"
            searchPlaceholder="Search campuses…"
            options={[
              { value: 'all', label: 'All Campuses' },
              ...campuses.map((c) => ({ value: c.id, label: c.campusName })),
            ]}
          />
          <SearchableSelect
            variant="compact"
            value={selectedClass}
            onChange={setSelectedClass}
            disabled={classesLoading}
            loading={classesLoading}
            loadingText="Loading classes…"
            placeholder="All Classes"
            searchPlaceholder="Search classes…"
            options={[
              { value: 'all', label: 'All Classes' },
              ...classes
                .filter((c) => selectedCampus === 'all' || c.campusId === selectedCampus)
                .map((c) => ({ value: c.id, label: `${c.className} - ${c.sectionName}` })),
            ]}
          />
          <SearchableSelect
            variant="compact"
            value={selectedStatus}
            onChange={setSelectedStatus}
            placeholder="All Status"
            searchPlaceholder="Search status…"
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'Active', label: 'Active Only' },
              { value: 'unpaid', label: 'Has Dues' },
              { value: 'Left', label: 'Left' },
              { value: 'Graduated', label: 'Graduated' },
            ]}
          />
        </div>

        {studentsLoading ? (
          <div className="px-8 py-6">
            <TableSkeleton rows={8} columns={7} />
          </div>
        ) : (
        <TableShell>
          <table className="w-full min-w-[880px] text-left border-collapse table-sticky-head">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Roll #</th>
                <th className="px-8 py-5">Student Name</th>
                <th className="px-8 py-5">Class</th>
                <th className="px-8 py-5">Father Name</th>
                <th className="px-8 py-5">Outstanding</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedStudents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6">
                    <EmptyState
                      compact
                      icon={UserCircle}
                      title={hasActiveFilters ? 'No students match your filters' : 'No students yet'}
                      description={
                        hasActiveFilters
                          ? 'Try clearing search or filters to see more results.'
                          : 'Register your first student or import a list from Excel.'
                      }
                      actionLabel={!hasActiveFilters && canCreate('students') ? 'Register student' : undefined}
                      onAction={
                        !hasActiveFilters && canCreate('students')
                          ? () => {
                              setEditingId(null);
                              setIsModalOpen(true);
                            }
                          : undefined
                      }
                    />
                  </td>
                </tr>
              )}
              {paginatedStudents.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="px-8 py-5 font-mono text-sm text-primary font-black">{student.rollNumber}</td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:scale-110 transition-transform duration-300 overflow-hidden">
                        {student.profileImage ? (
                          <img
                            src={student.profileImage}
                            alt={`${student.firstName} ${student.lastName || ''}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserCircle className="w-7 h-7" />
                        )}
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white">{student.firstName} {student.lastName}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-sm font-medium text-slate-500 dark:text-slate-400">
                    {classes.find(c => c.id === student.classId)?.className || 'N/A'}
                  </td>
                  <td className="px-8 py-5 text-sm font-medium text-slate-500 dark:text-slate-400">{student.fatherName}</td>
                  <td className="px-8 py-5 text-sm font-black text-danger">Rs. {getStudentOutstanding(student)}</td>
                  <td className="px-8 py-5">
                    <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                      student.status === 'Active' ? 'bg-success/10 text-success' : 
                      student.status === 'Left' ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'
                    }`}>
                      {student.status}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          setSelectedStudent(student);
                          setIsProfileModalOpen(true);
                        }} 
                        className="p-2.5 text-slate-400 hover:text-success hover:bg-success/10 rounded-xl transition-all"
                        title="View Profile"
                      >
                        <Eye className="w-5 h-5" />
                      </motion.button>
                      {canUpdate('students') && (
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleEdit(student)} 
                        className="p-2.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-xl transition-all"
                      >
                        <Edit2 className="w-5 h-5" />
                      </motion.button>
                      )}
                      {canDelete('students') && (
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDelete(student.id)} 
                        className="p-2.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-xl transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </motion.button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        )}
        
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalRows}
          itemsPerPage={itemsPerPage}
          itemLabel="Students"
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {isProfileModalOpen && selectedStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="vibrant-card w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col border-none shadow-2xl"
            >
              <div className="p-10 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-primary text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 -mr-20 -mt-20 rounded-full blur-3xl"></div>
                <div className="flex items-center gap-8 relative z-10">
                  <div className="w-24 h-24 rounded-3xl bg-white/20 backdrop-blur-xl flex items-center justify-center text-white shadow-2xl">
                    <UserCircle className="w-16 h-16" />
                  </div>
                  <div>
                    <h3 className="text-4xl font-black tracking-tight">{selectedStudent.firstName} {selectedStudent.lastName}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="px-3 py-1 bg-white/20 rounded-lg text-[10px] font-black uppercase tracking-widest">{selectedStudent.rollNumber}</span>
                      <span className="px-3 py-1 bg-white/20 rounded-lg text-[10px] font-black uppercase tracking-widest">{selectedStudent.status}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => {
                  setIsProfileModalOpen(false);
                  setSearchParams({});
                }} className="text-white/60 hover:text-white transition-colors relative z-10">
                  <XCircle className="w-10 h-10" />
                </button>
              </div>

              <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-10">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`px-8 py-6 text-[10px] font-black uppercase tracking-widest transition-all border-b-4 ${
                    activeTab === 'profile' ? 'border-primary text-primary' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Student Profile
                </button>
                <button
                  onClick={() => setActiveTab('fees')}
                  className={`px-8 py-6 text-[10px] font-black uppercase tracking-widest transition-all border-b-4 ${
                    activeTab === 'fees' ? 'border-primary text-primary' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Fees & Vouchers
                </button>
              </div>

              <div className="p-10 overflow-y-auto flex-1 bg-white dark:bg-slate-900">
                {activeTab === 'profile' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div className="space-y-6">
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Father's Name</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.fatherName}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">CNIC / B-Form</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.cnicBForm}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Date of Birth</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.dateOfBirth}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Contact Number</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.contactNumber}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Admission Date</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.admissionDate}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Registration Date</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white">{selectedStudent.registrationDate}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Location</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white text-xs">{selectedStudent.tehsil}, {selectedStudent.city}, {selectedStudent.province}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Address</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white text-xs leading-relaxed">{selectedStudent.address}</p>
                        </div>
                      </div>
                      <div className="group">
                        <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Campus Info</p>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group-hover:border-primary/30 transition-colors">
                          <p className="font-bold text-slate-900 dark:text-white text-xs">{selectedStudent.campusName} ({selectedStudent.campusType})</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-10">
                    <div className="p-8 bg-danger/5 border border-danger/10 rounded-3xl flex items-center justify-between relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-danger/5 -mr-16 -mt-16 rounded-full blur-2xl"></div>
                      <div className="flex items-center gap-6 text-danger relative z-10">
                        <div className="w-16 h-16 rounded-2xl bg-danger/10 flex items-center justify-center shadow-xl shadow-danger/10">
                          <CreditCard className="w-8 h-8" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Total Outstanding</p>
                          <p className="text-4xl font-black tracking-tight">Rs. {getStudentOutstanding(selectedStudent)}</p>
                        </div>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          setIsProfileModalOpen(false);
                          navigate(`/fees?studentId=${selectedStudent.id}`);
                        }}
                        className="vibrant-btn-primary bg-danger hover:bg-danger/90 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-danger/20 relative z-10"
                      >
                        Collect Fee
                      </motion.button>
                    </div>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-black text-slate-900 dark:text-white flex items-center gap-3 uppercase tracking-widest text-xs">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <FileText className="w-4 h-4 text-primary" />
                          </div>
                          Fee Vouchers History
                        </h4>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{vouchers.filter(v => v.studentId === selectedStudent.id).length} Records</span>
                      </div>
                      <div className="border border-slate-100 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                            <tr>
                              <th className="px-8 py-4">Month/Year</th>
                              <th className="px-8 py-4">Fee Type</th>
                              <th className="px-8 py-4">Amount</th>
                              <th className="px-8 py-4">Status</th>
                              <th className="px-8 py-4">Payment Info</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {vouchers.filter(v => v.studentId === selectedStudent.id).length === 0 && (
                              <tr>
                                <td colSpan={5} className="px-8 py-12 text-center text-sm text-slate-400 font-medium italic">No vouchers found.</td>
                              </tr>
                            )}
                            {vouchers.filter(v => v.studentId === selectedStudent.id).map(v => (
                              <tr key={v.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                <td className="px-8 py-5 font-bold text-slate-700 dark:text-slate-300">
                                  {v.month === 0 ? 'Past Arrears' : `${v.month}/${v.year}`}
                                </td>
                                <td className="px-8 py-5">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{v.feeType || 'Monthly'}</span>
                                </td>
                                <td className="px-8 py-5 font-black text-slate-900 dark:text-white">Rs. {v.amount}</td>
                                <td className="px-8 py-5">
                                  <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                                    v.status === 'Paid' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                                  }`}>
                                    {v.status}
                                  </span>
                                </td>
                                <td className="px-8 py-5 text-xs">
                                  {v.status === 'Paid' ? (
                                    <div className="flex flex-col">
                                      <span className="font-bold text-slate-700 dark:text-slate-300">{new Date(v.paymentDate!).toLocaleDateString()}</span>
                                      <span className="text-[10px] text-slate-400 uppercase font-black">{v.paymentMethod}</span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">Pending</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="vibrant-card w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col border-none shadow-2xl"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <UserCircle className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">{editingId ? 'Edit Student' : 'Register Student'}</h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-10 space-y-8 overflow-y-auto bg-white dark:bg-slate-900">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Campus</label>
                    <SearchableSelect
                      required
                      value={formData.campusId}
                      onChange={(campusId) => setFormData({ ...formData, campusId, classId: '' })}
                      disabled={campusesLoading}
                      loading={campusesLoading}
                      loadingText="Loading campuses…"
                      placeholder="Select Campus"
                      searchPlaceholder="Search campuses…"
                      options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Class</label>
                    <SearchableSelect
                      required
                      value={formData.classId}
                      onChange={(classId) => setFormData({ ...formData, classId })}
                      disabled={classesLoading || !formData.campusId}
                      loading={classesLoading}
                      loadingText="Loading classes…"
                      placeholder={!formData.campusId ? 'Select campus first' : 'Select Class'}
                      searchPlaceholder="Search classes…"
                      options={classes
                        .filter((c) => c.campusId === formData.campusId)
                        .map((c) => ({ value: c.id, label: classOptionLabel(c) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Roll Number</label>
                    <input className="vibrant-input" value={formData.rollNumber} onChange={(e) => setFormData({ ...formData, rollNumber: e.target.value })} placeholder="Auto-generated if empty" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Student Code</label>
                    <input className="vibrant-input" value={formData.studentCode} onChange={(e) => setFormData({ ...formData, studentCode: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Serial Number</label>
                    <input className="vibrant-input" value={formData.serialNo} onChange={(e) => setFormData({ ...formData, serialNo: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">First Name</label>
                    <input required className="vibrant-input" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Last Name</label>
                    <input className="vibrant-input" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Father's Name</label>
                    <input className="vibrant-input" value={formData.fatherName} onChange={(e) => setFormData({ ...formData, fatherName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">CNIC / B-Form</label>
                    <input className="vibrant-input" value={formData.cnicBForm} onChange={(e) => setFormData({ ...formData, cnicBForm: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date of Birth</label>
                    <input type="date" className="vibrant-input" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Gender</label>
                    <SearchableSelect
                      value={formData.gender}
                      onChange={(gender) => setFormData({ ...formData, gender })}
                      placeholder="Select gender"
                      options={[
                        { value: 'Male', label: 'Male' },
                        { value: 'Female', label: 'Female' },
                        { value: 'Other', label: 'Other' },
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contact Number</label>
                    <input className="vibrant-input" value={formData.contactNumber} onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Admission Date</label>
                    <input type="date" className="vibrant-input" value={formData.admissionDate} onChange={(e) => setFormData({ ...formData, admissionDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registration Date</label>
                    <input type="date" className="vibrant-input" value={formData.registrationDate} onChange={(e) => setFormData({ ...formData, registrationDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Session</label>
                    <input className="vibrant-input" value={formData.session} onChange={(e) => setFormData({ ...formData, session: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Campus Type</label>
                    <input className="vibrant-input" value={formData.campusType} onChange={(e) => setFormData({ ...formData, campusType: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status</label>
                    <SearchableSelect
                      value={formData.status}
                      onChange={(status) => setFormData({ ...formData, status: status as Student['status'] })}
                      placeholder="Select status"
                      options={[
                        { value: 'Active', label: 'Active' },
                        { value: 'Left', label: 'Left' },
                        { value: 'Graduated', label: 'Graduated' },
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Outstanding Fees (Rs.)</label>
                    <input type="number" className="vibrant-input font-black text-primary" value={formData.outstandingFees} onChange={(e) => setFormData({ ...formData, outstandingFees: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Country</label>
                    <input className="vibrant-input" value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Province</label>
                    <input className="vibrant-input" value={formData.province} onChange={(e) => setFormData({ ...formData, province: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">City</label>
                    <input className="vibrant-input" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tehsil / Area</label>
                    <input className="vibrant-input" value={formData.tehsil} onChange={(e) => setFormData({ ...formData, tehsil: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
                  <textarea className="vibrant-input" rows={3} value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                </div>
                {(canCreate('students') || canUpdate('students')) && (
                  <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Profile photo (ID card)</label>
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-24 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                        {formData.profileImage ? (
                          <img src={formData.profileImage} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-8 h-8 text-slate-300" />
                        )}
                      </div>
                      <div>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          onChange={handlePhotoSelect}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={uploadingPhoto}
                            onClick={openCamera}
                            className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Camera className="w-4 h-4" />
                            {uploadingPhoto ? 'Uploading…' : 'Open camera'}
                          </button>
                          <button
                            type="button"
                            disabled={uploadingPhoto}
                            onClick={() => photoInputRef.current?.click()}
                            className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingPhoto ? 'Uploading…' : 'Upload file'}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2">Camera or JPEG/PNG/WebP/GIF file, max 2 MB. Used on student ID cards.</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex gap-4 pt-10 border-t border-slate-100 dark:border-slate-800">
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button" 
                    onClick={() => setIsModalOpen(false)} 
                    className="flex-1 px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit" 
                    className="vibrant-btn-primary flex-1 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20"
                  >
                    {editingId ? 'Update Record' : 'Register Student'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Camera Capture Modal */}
      <AnimatePresence>
        {isCameraOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="vibrant-card w-full max-w-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">Capture Student Photo</h3>
                  <p className="text-xs text-slate-500 mt-1">Allow camera permission, then capture a clear front-facing photo.</p>
                </div>
                <button type="button" onClick={closeCamera} className="text-slate-400 hover:text-slate-600">
                  <XCircle className="w-8 h-8" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="aspect-video rounded-3xl overflow-hidden bg-slate-950 flex items-center justify-center">
                  {cameraLoading && (
                    <div className="text-white text-sm font-bold">Opening camera…</div>
                  )}
                  <video
                    ref={videoRef}
                    className={`w-full h-full object-cover ${cameraLoading ? 'hidden' : ''}`}
                    playsInline
                    muted
                  />
                  <canvas ref={canvasRef} className="hidden" />
                </div>
                <div className="flex gap-4">
                  <button type="button" onClick={closeCamera} className="flex-1 vibrant-btn-secondary py-3">
                    Cancel
                  </button>
                  <button type="button" onClick={captureCameraPhoto} disabled={cameraLoading || uploadingPhoto} className="flex-1 vibrant-btn-primary py-3 disabled:opacity-60">
                    {uploadingPhoto ? 'Uploading…' : 'Capture Photo'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="vibrant-card max-w-sm w-full p-8 text-center space-y-6 shadow-2xl border-none"
            >
              <div className="w-20 h-20 bg-danger/10 text-danger rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-danger/10">
                <AlertCircle className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Confirm Delete</h3>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">Are you sure you want to delete this student record? This action cannot be undone.</p>
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-6 py-4 bg-danger text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-danger/20 transition-all hover:bg-danger/90"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
