import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, UserPlus, CheckCircle, XCircle, GraduationCap, AlertTriangle, Users, Loader2, Eye, FileText, Download, Upload, Trash2 } from 'lucide-react';
import { AdmissionApplication, AdmissionDocument, AdmissionReviewCheckResult, Campus, Class } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { PermissionGate } from '../context/PermissionContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import { useI18n } from '../context/I18nContext';
import EmptyState from '../components/ui/EmptyState';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import { formatCnic, isValidCnic, maskCnicInput, normalizeCnic } from '../utils/cnic';

const scopeUser = getStoredUser();
const STATUSES = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Enrolled'] as const;
const DOC_TYPE_LABELS: Record<string, string> = {
  b_form: 'B-Form',
  birth_certificate: 'Birth certificate',
  previous_school: 'Previous school',
  other: 'Other',
};
const REJECTION_REASONS = [
  'Incomplete documents',
  'Eligibility not met',
  'Failed entrance test',
  'Capacity full',
  'Duplicate application',
  'Already enrolled',
  'Other',
] as const;

function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  return data?.message || data?.error || fallback;
}

const MATCH_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: 'New Student', color: 'bg-success/10 text-success' },
  re_enrollment: { label: 'Re-enrollment', color: 'bg-accent/10 text-accent' },
  sibling: { label: 'Sibling on CNIC', color: 'bg-primary/10 text-primary' },
  duplicate_active: { label: 'Already Active', color: 'bg-danger/10 text-danger' },
  duplicate_application: { label: 'Duplicate App', color: 'bg-accent/10 text-accent' },
};

export default function AdmissionManagement() {
  const confirm = useConfirm();
  const { t } = useI18n();
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [testPassMarks, setTestPassMarks] = useState(40);
  const [detailDocs, setDetailDocs] = useState<AdmissionDocument[]>([]);
  const [docUploadType, setDocUploadType] = useState('b_form');
  const [docUploading, setDocUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMatchType, setFilterMatchType] = useState('all');
  const [filterMissingCnic, setFilterMissingCnic] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<AdmissionApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdmissionApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [approvalTarget, setApprovalTarget] = useState<AdmissionApplication | null>(null);
  const [reviewTarget, setReviewTarget] = useState<AdmissionApplication | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewCheck, setReviewCheck] = useState<AdmissionReviewCheckResult | null>(null);
  const [reviewForm, setReviewForm] = useState({
    fatherCnic: '',
    waiveAdmissionFee: false,
    feeDiscountAmount: 0,
    feeDiscountPercent: 0,
    siblingDiscountPercent: 0,
  });
  const [cnicOnRecord, setCnicOnRecord] = useState(false);
  const [editingCnic, setEditingCnic] = useState(false);
  const [approvalForm, setApprovalForm] = useState({
    interviewAt: '',
    remarks: '',
  });
  const [formData, setFormData] = useState({
    campusId: scopeUser ? (defaultCampusFilter(scopeUser) !== 'all' ? defaultCampusFilter(scopeUser) : '') : '',
    classId: '',
    applicantName: '',
    fatherName: '',
    fatherCnic: '',
    studentBform: '',
    dateOfBirth: '',
    gender: 'Male',
    contactNumber: '',
    address: '',
    previousSchool: '',
    testMarks: 0,
    remarks: '',
  });

  const load = async () => {
    try {
      const data = await dataService.fetchAdmissions();
      setApplications(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load applications');
    }
  };

  useEffect(() => {
    load();
    dataService.fetchAdmissionPolicy().then((p) => setTestPassMarks(p.testPassMarks || 40)).catch(() => {});
    const unsubCampuses = dataService.subscribe('campuses', setCampuses);
    const unsubClasses = dataService.subscribe('classes', setClasses);
    return () => { unsubCampuses(); unsubClasses(); };
  }, []);

  useEffect(() => {
    if (!detailTarget) {
      setDetailDocs([]);
      return;
    }
    dataService.fetchAdmissionDocuments(detailTarget.id)
      .then(setDetailDocs)
      .catch(() => setDetailDocs([]));
  }, [detailTarget?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.applicantName.trim() || !formData.campusId) {
      toast.error('Applicant name and campus are required');
      return;
    }
    if (!isValidCnic(formData.fatherCnic)) {
      toast.error('Father CNIC must be 13 digits');
      return;
    }
    try {
      await dataService.addAdmission({ ...formData, fatherCnic: normalizeCnic(formData.fatherCnic) });
      toast.success('Application submitted');
      await load();
      setIsModalOpen(false);
      setFormData((prev) => ({
        ...prev,
        applicantName: '',
        fatherName: '',
        fatherCnic: '',
        contactNumber: '',
        address: '',
        previousSchool: '',
        classId: '',
      }));
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to submit application');
    }
  };

  const updateStatus = async (app: AdmissionApplication, status: string, payload?: Record<string, unknown>) => {
    try {
      const result = await dataService.updateAdmission(app.id, { ...app, status, ...payload });
      const smsNote = (result as { interviewSmsSent?: boolean; interviewSmsError?: string })?.interviewSmsSent
        ? ' Interview SMS sent.'
        : (result as { interviewSmsError?: string })?.interviewSmsError
        ? ` Status saved, but SMS failed: ${(result as { interviewSmsError?: string }).interviewSmsError}`
        : '';
      toast.success(`Status updated to ${status}.${smsNote}`);
      await load();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to update status');
    }
  };

  const buildReviewOptions = useCallback((app: AdmissionApplication, cnic?: string) => ({
    fatherCnic: normalizeCnic(cnic ?? reviewForm.fatherCnic ?? app.fatherCnic ?? ''),
    classId: app.classId || undefined,
    waiveAdmissionFee: reviewForm.waiveAdmissionFee,
    feeDiscountAmount: reviewForm.feeDiscountAmount,
    feeDiscountPercent: reviewForm.feeDiscountPercent,
    siblingDiscountPercent: reviewForm.siblingDiscountPercent,
  }), [reviewForm]);

  const runCnicCheckForApp = async (app: AdmissionApplication, cnicOverride?: string) => {
    const normalized = normalizeCnic(cnicOverride ?? app.fatherCnic ?? reviewForm.fatherCnic);
    if (normalized.length !== 13) {
      toast.error('Enter a valid 13-digit Father CNIC');
      return null;
    }
    setReviewLoading(true);
    try {
      const result = await dataService.reviewAdmissionCheck(app.id, {
        ...buildReviewOptions(app, normalized),
        fatherCnic: normalized,
      });
      setReviewCheck(result);
      setReviewForm((prev) => {
        const next = {
          ...prev,
          fatherCnic: formatCnic(result.normalizedCnic || normalized),
        };
        if (result.matchType === 're_enrollment') {
          next.waiveAdmissionFee = true;
        }
        if (result.matchType === 'sibling' && result.suggestedSiblingDiscountPercent > 0) {
          next.siblingDiscountPercent = result.suggestedSiblingDiscountPercent;
        }
        return next;
      });
      setCnicOnRecord(true);
      return result;
    } catch (err) {
      toast.error(apiErrorMessage(err, 'CNIC check failed'));
      return null;
    } finally {
      setReviewLoading(false);
    }
  };

  useEffect(() => {
    if (!reviewTarget || !reviewCheck || reviewCheck.matchType === 'duplicate_active' || !reviewTarget.classId) return;
    const t = setTimeout(async () => {
      try {
        const result = await dataService.reviewAdmissionCheck(reviewTarget.id, buildReviewOptions(reviewTarget));
        setReviewCheck((prev) => (prev ? { ...prev, feePreview: result.feePreview } : prev));
      } catch {
        // silent
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    reviewForm.waiveAdmissionFee,
    reviewForm.feeDiscountAmount,
    reviewForm.feeDiscountPercent,
    reviewForm.siblingDiscountPercent,
    reviewTarget?.id,
    reviewTarget?.classId,
    reviewCheck?.matchType,
    buildReviewOptions,
  ]);

  const openReviewModal = async (app: AdmissionApplication) => {
    const storedCnic = normalizeCnic(app.fatherCnic || '');
    const hasStoredCnic = storedCnic.length === 13;
    setReviewTarget(app);
    setReviewCheck(null);
    setCnicOnRecord(hasStoredCnic);
    setEditingCnic(!hasStoredCnic);
    setReviewForm({
      fatherCnic: hasStoredCnic ? formatCnic(storedCnic) : '',
      waiveAdmissionFee: Boolean(app.waiveAdmissionFee),
      feeDiscountAmount: app.feeDiscountAmount || 0,
      feeDiscountPercent: app.feeDiscountPercent || 0,
      siblingDiscountPercent: app.siblingDiscountPercent || 0,
    });
    if (hasStoredCnic) {
      await runCnicCheckForApp(app, storedCnic);
    }
  };

  const runCnicCheck = async () => {
    if (!reviewTarget) return;
    await runCnicCheckForApp(reviewTarget, reviewForm.fatherCnic);
  };

  const confirmReview = async () => {
    if (!reviewTarget || !reviewCheck) return;
    if (reviewCheck.matchType === 'duplicate_active') {
      toast.error('Cannot proceed — student is already active in the system');
      return;
    }
    try {
      await dataService.reviewAdmission(reviewTarget.id, {
        fatherCnic: normalizeCnic(reviewForm.fatherCnic),
        reviewResult: reviewCheck,
        linkedStudentId: reviewCheck.suggestedLinkedStudentId,
        waiveAdmissionFee: reviewForm.waiveAdmissionFee,
        feeDiscountAmount: reviewForm.feeDiscountAmount,
        feeDiscountPercent: reviewForm.feeDiscountPercent,
        siblingDiscountPercent: reviewForm.siblingDiscountPercent,
      });
      toast.success('Application moved to Under Review');
      setReviewTarget(null);
      setReviewCheck(null);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Review failed'));
    }
  };

  const openApproveModal = (app: AdmissionApplication) => {
    if (!app.reviewMatchType) {
      toast.error('Complete CNIC review before approving');
      return;
    }
    if (app.testMarks == null || app.testMarks < testPassMarks) {
      toast.error(`Enter test marks (min ${testPassMarks}) before approving`);
      return;
    }
    const initialInterviewAt = app.interviewAt ? app.interviewAt.replace(' ', 'T').slice(0, 16) : '';
    setApprovalTarget(app);
    setApprovalForm({
      interviewAt: initialInterviewAt,
      remarks: app.remarks || '',
    });
  };

  const approveWithInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalTarget) return;
    if (!approvalForm.interviewAt) {
      toast.error('Interview date/time is required');
      return;
    }
    await updateStatus(approvalTarget, 'Approved', {
      interviewAt: approvalForm.interviewAt.replace('T', ' '),
      remarks: approvalForm.remarks,
    });
    setApprovalTarget(null);
  };

  const confirmReject = async () => {
    if (!rejectTarget || !rejectReason) {
      toast.error('Select a rejection reason');
      return;
    }
    await updateStatus(rejectTarget, 'Rejected', {
      rejectionReason: rejectReason,
      remarks: rejectNotes || rejectTarget.remarks,
    });
    setRejectTarget(null);
    setRejectReason('');
    setRejectNotes('');
  };

  const saveTestMarks = async (app: AdmissionApplication, marks: number) => {
    try {
      await dataService.updateAdmission(app.id, { ...app, testMarks: marks });
      toast.success('Test marks saved');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save test marks'));
    }
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const report = await dataService.fetchAdmissionReport();
      const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Tracking', 'Applicant', 'Campus', 'Class', 'Status', 'Match', 'Test', 'Waived', 'Discount', 'Sibling%', 'Applied'];
      const rows = (report.rows || []).map((r: Record<string, unknown>) => [
        r.trackingNo, r.applicantName, r.campusName, r.className, r.status, r.reviewMatchType,
        r.testMarks, r.waiveAdmissionFee ? 'Yes' : '', r.feeDiscountAmount, r.siblingDiscountPercent, r.appliedOn,
      ]);
      const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `admissions_report_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      toast.success('Report exported');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!detailTarget || !e.target.files?.[0]) return;
    setDocUploading(true);
    try {
      await dataService.uploadAdmissionDocument(detailTarget.id, e.target.files[0], docUploadType);
      const docs = await dataService.fetchAdmissionDocuments(detailTarget.id);
      setDetailDocs(docs);
      toast.success('Document uploaded');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Upload failed'));
    } finally {
      setDocUploading(false);
      e.target.value = '';
    }
  };

  const handleDocDelete = async (docId: string) => {
    if (!detailTarget) return;
    try {
      await dataService.deleteAdmissionDocument(detailTarget.id, docId);
      setDetailDocs((prev) => prev.filter((d) => d.id !== docId));
      toast.success('Document removed');
    } catch {
      toast.error('Failed to delete document');
    }
  };

  const enroll = async (app: AdmissionApplication) => {
    if (!app.classId) {
      toast.error('Assign a class first');
      return;
    }
    const isReEnroll = app.reviewMatchType === 're_enrollment';
    if (!await confirm({
      title: isReEnroll ? 'Reactivate & enroll student?' : 'Enroll student?',
      message: isReEnroll
        ? `${app.applicantName} will be reactivated with existing roll number and arrears carried forward.`
        : `Create a student record for ${app.applicantName} and generate admission fee voucher?`,
      confirmLabel: isReEnroll ? 'Reactivate' : 'Enroll',
    })) return;
    try {
      const result = await dataService.enrollAdmission(app.id);
      const extra = result.reactivated ? ' (reactivated)' : '';
      const dueNote = result.totalDue ? ` Fee due: Rs. ${Number(result.totalDue).toLocaleString()}` : '';
      toast.success(`Enrolled! Roll: ${result.rollNumber}${extra}.${dueNote}`, {
        action: result.feeVoucherId ? { label: 'View fees', onClick: () => { window.location.href = '/fees'; } } : undefined,
      });
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Enrollment failed');
    }
  };

  const missingCnicCount = applications.filter((a) => !isValidCnic(a.fatherCnic)).length;

  const filtered = applications.filter((a) => {
    const matchSearch = a.applicantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.fatherName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.fatherCnic || '').includes(searchTerm.replace(/\D/g, ''));
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    const matchType = filterMatchType === 'all' || a.reviewMatchType === filterMatchType;
    const matchCnic = !filterMissingCnic || !isValidCnic(a.fatherCnic);
    return matchSearch && matchStatus && matchType && matchCnic;
  });

  const statusColor = (s: string) => {
    if (s === 'Enrolled') return 'bg-success/10 text-success';
    if (s === 'Approved') return 'bg-primary/10 text-primary';
    if (s === 'Rejected') return 'bg-danger/10 text-danger';
    if (s === 'Under Review') return 'bg-accent/10 text-accent';
    return 'bg-slate-100 text-slate-500';
  };

  const campusClasses = (campusId: string) => classes.filter((c) => c.campusId === campusId);

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="admissions"
        description={`${t('pages.admissions.description')} · Pass marks: ${testPassMarks}`}
        actions={
          <>
            <PermissionGate module="admissions" action="create">
              <button onClick={() => setIsModalOpen(true)} className="vibrant-btn-primary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
                <Plus className="w-4 h-4" />
                New application
              </button>
            </PermissionGate>
            <PermissionGate module="admissions" action="view">
              <button type="button" onClick={exportReport} disabled={exporting} className="vibrant-btn-secondary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
                <Download className="w-4 h-4" />
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </PermissionGate>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
            className={`vibrant-card p-4 text-left transition-all ${filterStatus === s ? 'ring-2 ring-primary' : ''}`}
          >
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s}</p>
            <p className="text-2xl font-black mt-1">{applications.filter((a) => a.status === s).length}</p>
          </button>
        ))}
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search applicants, CNIC..." className="vibrant-input pl-12" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <SearchableSelect
            className="min-w-[160px]"
            value={filterMatchType}
            onChange={setFilterMatchType}
            placeholder="Match type"
            options={[
              { value: 'all', label: 'All match types' },
              ...Object.entries(MATCH_LABELS).map(([k, v]) => ({ value: k, label: v.label })),
            ]}
          />
          <button
            type="button"
            onClick={() => setFilterMissingCnic(!filterMissingCnic)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap ${filterMissingCnic ? 'bg-danger/10 text-danger ring-2 ring-danger/30' : 'bg-slate-100 text-slate-500'}`}
          >
            Missing CNIC ({missingCnicCount})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-5">Applicant</th>
                <th className="px-8 py-5">Campus / Class</th>
                <th className="px-8 py-5">Applied</th>
                <th className="px-8 py-5">Test</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((app) => (
                <tr key={app.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="px-8 py-5">
                    <button type="button" onClick={() => setDetailTarget(app)} className="text-left group">
                      <p className="font-bold group-hover:text-primary transition-colors">{app.applicantName}</p>
                      <p className="text-xs text-slate-400">{app.fatherName} · {app.contactNumber}</p>
                      {app.trackingNo && (
                        <p className="text-[10px] font-mono text-primary mt-0.5">{app.trackingNo}</p>
                      )}
                      {app.fatherCnic ? (
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{formatCnic(app.fatherCnic)}</p>
                      ) : (
                        <p className="text-[10px] text-danger font-bold mt-0.5">CNIC missing</p>
                      )}
                    </button>
                  </td>
                  <td className="px-8 py-5 text-sm">
                    <p>{app.campusName}</p>
                    <p className="text-slate-400">{app.className || 'Class not assigned'}</p>
                  </td>
                  <td className="px-8 py-5 text-xs text-slate-500">{app.appliedOn ? new Date(app.appliedOn).toLocaleDateString() : '—'}</td>
                  <td className="px-8 py-5">
                    {app.status === 'Under Review' ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={`vibrant-input w-20 text-center font-bold ${app.testMarks != null && app.testMarks < testPassMarks ? 'ring-2 ring-danger/40' : ''}`}
                        placeholder="—"
                        defaultValue={app.testMarks ?? ''}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (!Number.isNaN(val) && val !== app.testMarks) saveTestMarks(app, val);
                        }}
                      />
                    ) : (
                      <span className={`font-bold ${app.testMarks != null && app.testMarks < testPassMarks ? 'text-danger' : ''}`}>
                        {app.testMarks != null ? app.testMarks : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${statusColor(app.status)}`}>{app.status}</span>
                    {app.reviewMatchType && MATCH_LABELS[app.reviewMatchType] && (
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${MATCH_LABELS[app.reviewMatchType].color}`}>
                        {MATCH_LABELS[app.reviewMatchType].label}
                      </span>
                    )}
                    {app.interviewAt && (
                      <p className="text-[10px] text-slate-500 mt-1">
                        Interview: {new Date(app.interviewAt).toLocaleString()}
                      </p>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex justify-end gap-2 flex-wrap">
                      <button type="button" onClick={() => setDetailTarget(app)} className="p-2 text-slate-400 hover:text-primary" title="View details">
                        <Eye className="w-4 h-4" />
                      </button>
                      <PermissionGate module="admissions" action="update">
                        {app.status === 'Pending' && (
                          <button onClick={() => openReviewModal(app)} className="px-3 py-1.5 text-[10px] font-black uppercase bg-accent/10 text-accent rounded-xl">
                            Review
                          </button>
                        )}
                        {app.status === 'Under Review' && (
                          <>
                            <button onClick={() => openApproveModal(app)} className="px-3 py-1.5 text-[10px] font-black uppercase bg-primary/10 text-primary rounded-xl flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Approve
                            </button>
                            <button onClick={() => { setRejectTarget(app); setRejectReason(''); setRejectNotes(''); }} className="px-3 py-1.5 text-[10px] font-black uppercase bg-danger/10 text-danger rounded-xl flex items-center gap-1">
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </>
                        )}
                        {app.status === 'Approved' && (
                          <button onClick={() => enroll(app)} className="vibrant-btn-primary py-2 px-4 text-[10px] font-black uppercase flex items-center gap-1">
                            <GraduationCap className="w-3 h-3" /> Enroll
                          </button>
                        )}
                        {!app.classId && app.status !== 'Enrolled' && app.status !== 'Rejected' && (
                          <SearchableSelect
                            className="text-[10px] font-bold border rounded-xl px-2 py-1 min-h-0"
                            value={app.classId || ''}
                            onChange={async (classId) => {
                              await dataService.updateAdmission(app.id, { ...app, classId });
                              toast.success('Class assigned');
                              await load();
                            }}
                            placeholder="Assign class"
                            searchPlaceholder="Search classes…"
                            options={campusClasses(app.campusId).map((c) => ({
                              value: c.id,
                              label: `${c.className} ${c.sectionName}${c.capacity ? ` (${c.enrolledCount ?? 0}/${c.capacity})` : ''}`,
                            }))}
                          />
                        )}
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8">
              <EmptyState
                compact
                title={searchTerm || filterStatus !== 'all' || filterMatchType !== 'all' || filterMissingCnic ? 'No applications match filters' : 'No applications yet'}
                description="Create a new application or adjust your search and filters."
                icon={UserPlus}
              />
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {reviewTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-6">
                <Users className="w-6 h-6 text-accent" />
                <h3 className="text-2xl font-black">CNIC Review — {reviewTarget.applicantName}</h3>
              </div>

              <div className="space-y-4">
                {cnicOnRecord && !editingCnic ? (
                  <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Father CNIC on application</p>
                      <p className="font-mono font-bold text-lg mt-1">{formatCnic(reviewForm.fatherCnic)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingCnic(true)}
                      className="text-[10px] font-black uppercase text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <input
                      className="vibrant-input flex-1 font-mono"
                      placeholder="Father CNIC (13 digits) *"
                      value={reviewForm.fatherCnic}
                      onChange={(e) => setReviewForm((prev) => ({ ...prev, fatherCnic: maskCnicInput(e.target.value) }))}
                    />
                    <button type="button" onClick={runCnicCheck} disabled={reviewLoading} className="vibrant-btn-secondary px-4 whitespace-nowrap">
                      {reviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check CNIC'}
                    </button>
                  </div>
                )}

                {cnicOnRecord && !editingCnic && !reviewCheck && !reviewLoading && (
                  <button type="button" onClick={() => reviewTarget && runCnicCheckForApp(reviewTarget)} className="text-sm text-primary font-bold hover:underline">
                    Re-run CNIC check
                  </button>
                )}

                {!cnicOnRecord && !reviewLoading && (
                  <p className="text-xs text-slate-500">CNIC was not saved on this application (older record). Enter it above and click Check CNIC.</p>
                )}

                {reviewLoading && (
                  <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching records…</p>
                )}

                {reviewCheck && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-2xl text-sm ${reviewCheck.matchType === 'duplicate_active' ? 'bg-danger/10 text-danger' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                      <p className="font-bold flex items-center gap-2">
                        {reviewCheck.matchType === 'duplicate_active' && <AlertTriangle className="w-4 h-4" />}
                        {reviewCheck.message}
                      </p>
                      {reviewCheck.totalFamilyOutstanding > 0 && (
                        <p className="mt-1 text-xs">Family outstanding: Rs. {reviewCheck.totalFamilyOutstanding.toLocaleString()}</p>
                      )}
                    </div>

                    {reviewCheck.matchedStudents.length > 0 && (
                      <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-[10px] font-black uppercase text-slate-400 bg-slate-50/80">
                              <th className="px-4 py-3">Student</th>
                              <th className="px-4 py-3">Roll</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3 text-right">Outstanding</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {reviewCheck.matchedStudents.map((s) => (
                              <tr key={s.id} className={s.nameScore >= 0.85 ? 'bg-danger/5' : ''}>
                                <td className="px-4 py-3 font-medium">
                                  {s.firstName}
                                  {s.nameScore >= 0.85 && (
                                    <span className="ml-2 text-[9px] font-black uppercase text-danger">Name match</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">{s.rollNumber}</td>
                                <td className="px-4 py-3">
                                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${s.status === 'Active' ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-500'}`}>
                                    {s.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right font-bold">
                                  Rs. {s.unpaidBalance.toLocaleString()}
                                  {s.unpaidMonths?.length > 0 && (
                                    <p className="text-[9px] text-slate-400 font-normal mt-1">
                                      {s.unpaidMonths.slice(0, 3).map((m) => m.label || `${m.month}/${m.year}`).join(', ')}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {reviewCheck.matchType !== 'duplicate_active' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/30">
                          <label className="flex items-center gap-2 text-sm font-bold cursor-pointer sm:col-span-2">
                            <input
                              type="checkbox"
                              checked={reviewForm.waiveAdmissionFee}
                              onChange={(e) => setReviewForm((prev) => ({ ...prev, waiveAdmissionFee: e.target.checked }))}
                            />
                            Waive admission fee
                          </label>
                          {reviewCheck.matchType === 'sibling' && (
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase">Sibling discount (% on tuition)</label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                className="vibrant-input mt-1"
                                value={reviewForm.siblingDiscountPercent}
                                onChange={(e) => setReviewForm((prev) => ({ ...prev, siblingDiscountPercent: Number(e.target.value) || 0 }))}
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase">Extra discount (Rs.)</label>
                            <input
                              type="number"
                              min={0}
                              className="vibrant-input mt-1"
                              value={reviewForm.feeDiscountAmount}
                              onChange={(e) => setReviewForm((prev) => ({ ...prev, feeDiscountAmount: Number(e.target.value) || 0 }))}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase">Extra discount (%)</label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              className="vibrant-input mt-1"
                              value={reviewForm.feeDiscountPercent}
                              onChange={(e) => setReviewForm((prev) => ({ ...prev, feeDiscountPercent: Number(e.target.value) || 0 }))}
                            />
                          </div>
                        </div>

                        {!reviewTarget.classId && (
                          <p className="text-xs text-accent font-bold flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Assign a class to see fee preview
                          </p>
                        )}

                        {reviewCheck.feePreview && (
                          <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5">
                            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" /> Enrollment fee preview
                            </p>
                            <div className="space-y-1 text-sm">
                              {reviewCheck.feePreview.lines.map((line) => (
                                <div key={line.label} className="flex justify-between">
                                  <span className="text-slate-500">{line.label}</span>
                                  <span className={`font-bold ${line.amount < 0 ? 'text-success' : ''}`}>
                                    {line.amount < 0 ? '−' : ''}Rs. {Math.abs(line.amount).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                              <div className="flex justify-between pt-2 border-t border-primary/20 font-black text-primary">
                                <span>Total due on enroll</span>
                                <span>Rs. {reviewCheck.feePreview.totalDue.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-4 pt-2">
                  <button type="button" onClick={() => { setReviewTarget(null); setReviewCheck(null); setEditingCnic(false); }} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button
                    type="button"
                    onClick={confirmReview}
                    disabled={!reviewCheck || reviewCheck.matchType === 'duplicate_active' || reviewLoading}
                    className="flex-1 vibrant-btn-primary disabled:opacity-50"
                  >
                    Proceed to Review
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        {approvalTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-lg p-8">
              <div className="flex items-center gap-3 mb-6">
                <CheckCircle className="w-6 h-6 text-primary" />
                <h3 className="text-2xl font-black">Approve & Schedule Interview</h3>
              </div>
              <form onSubmit={approveWithInterview} className="space-y-4">
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  <p><span className="font-bold">Applicant:</span> {approvalTarget.applicantName}</p>
                  <p><span className="font-bold">Campus:</span> {approvalTarget.campusName}</p>
                  <p><span className="font-bold">SMS To:</span> {approvalTarget.contactNumber || 'No number available'}</p>
                  {approvalTarget.reviewMatchType && (
                    <p><span className="font-bold">CNIC Check:</span> {MATCH_LABELS[approvalTarget.reviewMatchType]?.label || approvalTarget.reviewMatchType}</p>
                  )}
                </div>
                <input
                  type="datetime-local"
                  className="vibrant-input"
                  value={approvalForm.interviewAt}
                  onChange={(e) => setApprovalForm((prev) => ({ ...prev, interviewAt: e.target.value }))}
                  required
                />
                <textarea
                  className="vibrant-input"
                  rows={3}
                  placeholder="Optional notes"
                  value={approvalForm.remarks}
                  onChange={(e) => setApprovalForm((prev) => ({ ...prev, remarks: e.target.value }))}
                />
                <div className="flex gap-4 pt-2">
                  <button type="button" onClick={() => setApprovalTarget(null)} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">Save & Notify</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-6">
                <UserPlus className="w-6 h-6 text-primary" />
                <h3 className="text-2xl font-black">New Admission Application</h3>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {(!scopeUser || canPickCampus(scopeUser)) && (
                  <SearchableSelect
                    required
                    value={formData.campusId}
                    onChange={(campusId) => setFormData({ ...formData, campusId, classId: '' })}
                    placeholder="Select campus"
                    searchPlaceholder="Search campuses…"
                    options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                  />
                )}
                <SearchableSelect
                  value={formData.classId}
                  onChange={(classId) => setFormData({ ...formData, classId })}
                  placeholder="Preferred class (optional)"
                  searchPlaceholder="Search classes…"
                  options={campusClasses(formData.campusId).map((c) => ({
                    value: c.id,
                    label: `${c.className}${c.sectionName ? ` (${c.sectionName})` : ''}${c.capacity ? ` — ${c.enrolledCount ?? 0}/${c.capacity}` : ''}`,
                  }))}
                />
                <input className="vibrant-input" placeholder="Applicant full name *" value={formData.applicantName} onChange={(e) => setFormData({ ...formData, applicantName: e.target.value })} required />
                <input className="vibrant-input" placeholder="Father's name" value={formData.fatherName} onChange={(e) => setFormData({ ...formData, fatherName: e.target.value })} />
                <input className="vibrant-input font-mono" placeholder="Father CNIC (13 digits) *" value={formData.fatherCnic} onChange={(e) => setFormData({ ...formData, fatherCnic: maskCnicInput(e.target.value) })} required />
                <input className="vibrant-input font-mono" placeholder="Student B-Form / registration no." value={formData.studentBform} onChange={(e) => setFormData({ ...formData, studentBform: e.target.value })} />
                <div className="grid grid-cols-2 gap-4">
                  <input type="date" className="vibrant-input" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} />
                  <SearchableSelect
                    value={formData.gender}
                    onChange={(gender) => setFormData({ ...formData, gender })}
                    options={[
                      { value: 'Male', label: 'Male' },
                      { value: 'Female', label: 'Female' },
                    ]}
                  />
                </div>
                <input className="vibrant-input" placeholder="Contact number" value={formData.contactNumber} onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })} />
                <input className="vibrant-input" placeholder="Previous school" value={formData.previousSchool} onChange={(e) => setFormData({ ...formData, previousSchool: e.target.value })} />
                <textarea className="vibrant-input" placeholder="Address" rows={2} value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 vibrant-btn-secondary">Cancel</button>
                  <button type="submit" className="flex-1 vibrant-btn-primary">Submit Application</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
        {rejectTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-md p-8">
              <h3 className="text-xl font-black mb-4">Reject application</h3>
              <p className="text-sm text-slate-500 mb-4">{rejectTarget.applicantName}</p>
              <SearchableSelect
                required
                value={rejectReason}
                onChange={setRejectReason}
                placeholder="Select reason"
                options={REJECTION_REASONS.map((r) => ({ value: r, label: r }))}
              />
              <textarea className="vibrant-input mt-4" rows={3} placeholder="Additional notes (optional)" value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} />
              <div className="flex gap-4 mt-6">
                <button type="button" onClick={() => setRejectTarget(null)} className="flex-1 vibrant-btn-secondary">Cancel</button>
                <button type="button" onClick={confirmReject} className="flex-1 vibrant-btn-primary bg-danger">Confirm reject</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {detailTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="vibrant-card w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-black">{detailTarget.applicantName}</h3>
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${statusColor(detailTarget.status)}`}>{detailTarget.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {detailTarget.trackingNo && (
                  <div className="col-span-2"><p className="text-[10px] font-black text-primary uppercase">Tracking No</p><p className="font-mono font-bold text-primary">{detailTarget.trackingNo}</p></div>
                )}
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Father</p><p className="font-bold">{detailTarget.fatherName || '—'}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Father CNIC</p><p className="font-mono font-bold">{detailTarget.fatherCnic ? formatCnic(detailTarget.fatherCnic) : '—'}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">B-Form</p><p className="font-mono font-bold">{detailTarget.studentBform || '—'}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Test marks</p><p className={`font-bold ${detailTarget.testMarks != null && detailTarget.testMarks < testPassMarks ? 'text-danger' : ''}`}>{detailTarget.testMarks ?? '—'} {detailTarget.testMarks != null ? `(min ${testPassMarks})` : ''}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Campus</p><p className="font-bold">{detailTarget.campusName}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Class</p><p className="font-bold">{detailTarget.className || 'Not assigned'}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">DOB</p><p className="font-bold">{detailTarget.dateOfBirth || '—'}</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Contact</p><p className="font-bold">{detailTarget.contactNumber || '—'}</p></div>
                {detailTarget.reviewMatchType && (
                  <div className="col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase">CNIC review</p><p className="font-bold">{MATCH_LABELS[detailTarget.reviewMatchType]?.label}</p></div>
                )}
                {(detailTarget.waiveAdmissionFee || detailTarget.feeDiscountAmount || detailTarget.siblingDiscountPercent) && (
                  <div className="col-span-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Fee decisions</p>
                    {detailTarget.waiveAdmissionFee && <p>Admission fee waived</p>}
                    {detailTarget.siblingDiscountPercent ? <p>Sibling discount: {detailTarget.siblingDiscountPercent}%</p> : null}
                    {detailTarget.feeDiscountAmount ? <p>Extra discount: Rs. {detailTarget.feeDiscountAmount}</p> : null}
                    {detailTarget.feeDiscountPercent ? <p>Extra discount: {detailTarget.feeDiscountPercent}%</p> : null}
                  </div>
                )}
                {detailTarget.rejectionReason && (
                  <div className="col-span-2"><p className="text-[10px] font-black text-danger uppercase">Rejection</p><p className="font-bold text-danger">{detailTarget.rejectionReason}</p></div>
                )}
                {detailTarget.studentId && (
                  <div className="col-span-2">
                    <Link to="/students" className="text-primary font-bold text-sm hover:underline">View enrolled student →</Link>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Documents</p>
                {detailDocs.length === 0 ? (
                  <p className="text-sm text-slate-400 mb-3">No documents uploaded</p>
                ) : (
                  <ul className="space-y-2 mb-4">
                    {detailDocs.map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-primary hover:underline truncate">
                          {DOC_TYPE_LABELS[doc.docType] || doc.docType}: {doc.fileName || 'file'}
                        </a>
                        <PermissionGate module="admissions" action="update">
                          <button type="button" onClick={() => handleDocDelete(doc.id)} className="p-1 text-danger hover:bg-danger/10 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </PermissionGate>
                      </li>
                    ))}
                  </ul>
                )}
                <PermissionGate module="admissions" action="update">
                  <div className="flex gap-2">
                    <SearchableSelect
                      className="flex-1"
                      value={docUploadType}
                      onChange={setDocUploadType}
                      options={Object.entries(DOC_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                    />
                    <label className="vibrant-btn-secondary px-4 flex items-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      {docUploading ? '…' : 'Upload'}
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleDocUpload} disabled={docUploading} />
                    </label>
                  </div>
                </PermissionGate>
              </div>

              <button type="button" onClick={() => setDetailTarget(null)} className="w-full vibrant-btn-secondary mt-6">Close</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
