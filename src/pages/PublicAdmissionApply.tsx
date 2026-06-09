import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { School, Send, LogIn, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { dataService } from '../services/dataService';
import type { Campus, Class } from '../types';

export default function PublicAdmissionApply() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    campusId: '',
    classId: '',
    applicantName: '',
    fatherName: '',
    dateOfBirth: '',
    gender: 'Male',
    contactNumber: '',
    address: '',
    previousSchool: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const data = await dataService.fetchPublicCampuses();
        setCampuses(data);
      } catch {
        toast.error('Could not load campuses');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!formData.campusId) {
      setClasses([]);
      return;
    }
    (async () => {
      try {
        const data = await dataService.fetchPublicClasses(formData.campusId);
        setClasses(data);
      } catch {
        setClasses([]);
      }
    })();
  }, [formData.campusId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.campusId || !formData.applicantName.trim() || !formData.contactNumber.trim()) {
      toast.error('Campus, applicant name, and contact number are required');
      return;
    }
    setSubmitting(true);
    try {
      await dataService.submitPublicAdmission(formData);
      setSubmitted(true);
      toast.success('Application submitted!');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  const classLabel = (c: Class) => {
    const cap = c.capacity ? ` — ${c.enrolledCount ?? 0}/${c.capacity}` : '';
    return `${c.className}${c.sectionName ? ` (${c.sectionName})` : ''}${cap}`;
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="vibrant-card max-w-md w-full p-10 text-center space-y-6"
        >
          <div className="w-20 h-20 bg-success/10 text-success rounded-3xl flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Application Received</h1>
          <p className="text-slate-500 text-sm">
            Thank you for applying to Faizan Islamic School. Our admissions team will review your application and contact you.
          </p>
          <Link to="/login" className="vibrant-btn-primary inline-flex items-center gap-2 px-6 py-3">
            <LogIn className="w-4 h-4" />
            Staff Login
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 text-primary rounded-2xl">
            <School className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Online Admission</h1>
          <p className="text-slate-500 font-medium">Apply for enrollment at Faizan Islamic School</p>
          <Link to="/login" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-1">
            <LogIn className="w-3 h-3" /> Staff login
          </Link>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSubmit}
          className="vibrant-card p-8 space-y-6"
        >
          {loading ? (
            <p className="text-center text-slate-400 py-8">Loading campuses…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Campus *</label>
                  <select
                    required
                    className="vibrant-input appearance-none"
                    value={formData.campusId}
                    onChange={(e) => setFormData({ ...formData, campusId: e.target.value, classId: '' })}
                  >
                    <option value="">Select campus</option>
                    {campuses.map((c) => (
                      <option key={c.id} value={c.id}>{c.campusName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Preferred class</label>
                  <select
                    className="vibrant-input appearance-none"
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    disabled={!formData.campusId}
                  >
                    <option value="">Any / not sure</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{classLabel(c)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Student name *</label>
                  <input
                    required
                    className="vibrant-input"
                    value={formData.applicantName}
                    onChange={(e) => setFormData({ ...formData, applicantName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Father&apos;s name</label>
                  <input
                    className="vibrant-input"
                    value={formData.fatherName}
                    onChange={(e) => setFormData({ ...formData, fatherName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date of birth</label>
                  <input
                    type="date"
                    className="vibrant-input"
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gender</label>
                  <select
                    className="vibrant-input appearance-none"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact number *</label>
                  <input
                    required
                    className="vibrant-input"
                    value={formData.contactNumber}
                    onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Previous school</label>
                  <input
                    className="vibrant-input"
                    value={formData.previousSchool}
                    onChange={(e) => setFormData({ ...formData, previousSchool: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address</label>
                  <textarea
                    className="vibrant-input"
                    rows={3}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="vibrant-btn-primary w-full py-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit application
                  </>
                )}
              </button>
            </>
          )}
        </motion.form>
      </div>
    </div>
  );
}
