import React, { useEffect, useState } from 'react';
import { Plus, Search, UserPlus, CheckCircle, XCircle, GraduationCap } from 'lucide-react';
import { AdmissionApplication, Campus, Class } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';

const scopeUser = getStoredUser();
const STATUSES = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Enrolled'] as const;

export default function AdmissionManagement() {
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<AdmissionApplication | null>(null);
  const [approvalForm, setApprovalForm] = useState({
    interviewAt: '',
    remarks: '',
  });
  const [formData, setFormData] = useState({
    campusId: scopeUser ? (defaultCampusFilter(scopeUser) !== 'all' ? defaultCampusFilter(scopeUser) : '') : '',
    classId: '',
    applicantName: '',
    fatherName: '',
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
    const unsubCampuses = dataService.subscribe('campuses', setCampuses);
    const unsubClasses = dataService.subscribe('classes', setClasses);
    return () => { unsubCampuses(); unsubClasses(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.applicantName.trim() || !formData.campusId) {
      toast.error('Applicant name and campus are required');
      return;
    }
    try {
      await dataService.addAdmission(formData);
      toast.success('Application submitted');
      await load();
      setIsModalOpen(false);
      setFormData((prev) => ({ ...prev, applicantName: '', fatherName: '', contactNumber: '', address: '', previousSchool: '', classId: '' }));
    } catch (err) {
      console.error(err);
      toast.error('Failed to submit application');
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

  const openApproveModal = (app: AdmissionApplication) => {
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

  const enroll = async (app: AdmissionApplication) => {
    if (!app.classId) {
      toast.error('Assign a class first (edit application)');
      return;
    }
    if (!window.confirm(`Enroll ${app.applicantName} as a student?`)) return;
    try {
      const result = await dataService.enrollAdmission(app.id);
      toast.success(`Enrolled! Roll number: ${result.rollNumber}`);
      await load();
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Enrollment failed');
    }
  };

  const filtered = applications.filter((a) => {
    const matchSearch = a.applicantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.fatherName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchSearch && matchStatus;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Admissions</h2>
          <p className="text-slate-500 font-medium mt-1">Application → review → test → enroll workflow</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="vibrant-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          <span className="text-[10px] font-black uppercase tracking-widest">New Application</span>
        </button>
      </div>

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
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search applicants..." className="vibrant-input pl-12" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
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
                    <p className="font-bold">{app.applicantName}</p>
                    <p className="text-xs text-slate-400">{app.fatherName} · {app.contactNumber}</p>
                  </td>
                  <td className="px-8 py-5 text-sm">
                    <p>{app.campusName}</p>
                    <p className="text-slate-400">{app.className || 'Class not assigned'}</p>
                  </td>
                  <td className="px-8 py-5 text-xs text-slate-500">{app.appliedOn ? new Date(app.appliedOn).toLocaleDateString() : '—'}</td>
                  <td className="px-8 py-5 font-bold">{app.testMarks != null ? app.testMarks : '—'}</td>
                  <td className="px-8 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${statusColor(app.status)}`}>{app.status}</span>
                    {app.interviewAt && (
                      <p className="text-[10px] text-slate-500 mt-1">
                        Interview: {new Date(app.interviewAt).toLocaleString()}
                      </p>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex justify-end gap-2 flex-wrap">
                      {app.status === 'Pending' && (
                        <button onClick={() => updateStatus(app, 'Under Review')} className="px-3 py-1.5 text-[10px] font-black uppercase bg-accent/10 text-accent rounded-xl">Review</button>
                      )}
                      {['Pending', 'Under Review'].includes(app.status) && (
                        <>
                          <button onClick={() => openApproveModal(app)} className="px-3 py-1.5 text-[10px] font-black uppercase bg-primary/10 text-primary rounded-xl flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Approve
                          </button>
                          <button onClick={() => updateStatus(app, 'Rejected')} className="px-3 py-1.5 text-[10px] font-black uppercase bg-danger/10 text-danger rounded-xl flex items-center gap-1">
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
                        <select
                          className="text-[10px] font-bold border rounded-xl px-2 py-1"
                          value={app.classId || ''}
                          onChange={async (e) => {
                            await dataService.updateAdmission(app.id, { ...app, classId: e.target.value });
                            toast.success('Class assigned');
                            await load();
                          }}
                        >
                          <option value="">Assign class</option>
                          {campusClasses(app.campusId).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.className} {c.sectionName}{c.capacity ? ` (${c.enrolledCount ?? 0}/${c.capacity})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-12 text-center text-slate-400 font-bold">No applications found</p>
          )}
        </div>
      </div>

      <AnimatePresence>
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
                  <select className="vibrant-input" value={formData.campusId} onChange={(e) => setFormData({ ...formData, campusId: e.target.value, classId: '' })} required>
                    <option value="">Select campus</option>
                    {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
                  </select>
                )}
                <select className="vibrant-input" value={formData.classId} onChange={(e) => setFormData({ ...formData, classId: e.target.value })}>
                  <option value="">Preferred class (optional)</option>
                  {campusClasses(formData.campusId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.className}{c.sectionName ? ` (${c.sectionName})` : ''}{c.capacity ? ` — ${c.enrolledCount ?? 0}/${c.capacity}` : ''}
                    </option>
                  ))}
                </select>
                <input className="vibrant-input" placeholder="Applicant full name *" value={formData.applicantName} onChange={(e) => setFormData({ ...formData, applicantName: e.target.value })} required />
                <input className="vibrant-input" placeholder="Father's name" value={formData.fatherName} onChange={(e) => setFormData({ ...formData, fatherName: e.target.value })} />
                <div className="grid grid-cols-2 gap-4">
                  <input type="date" className="vibrant-input" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} />
                  <select className="vibrant-input" value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
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
      </AnimatePresence>
    </div>
  );
}
