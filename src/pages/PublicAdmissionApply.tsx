import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { School, Send, LogIn, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { dataService } from '../services/dataService';
import DevCredit from '../components/ui/DevCredit';
import SearchableSelect from '../components/ui/SearchableSelect';
import type { Campus, Class } from '../types';
import { isValidCnic, maskCnicInput, normalizeCnic } from '../utils/cnic';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../context/I18nContext';

export default function PublicAdmissionApply() {
  const { t } = useI18n();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [trackingNo, setTrackingNo] = useState('');
  const [formData, setFormData] = useState({
    campusId: '',
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
    if (!isValidCnic(formData.fatherCnic)) {
      toast.error('Father CNIC (13 digits) is required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await dataService.submitPublicAdmission({ ...formData, fatherCnic: normalizeCnic(formData.fatherCnic) });
      setTrackingNo(result.trackingNo || '');
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
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t('public.apply.received')}</h1>
          {trackingNo && (
            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('public.apply.trackingLabel')}</p>
              <p className="text-2xl font-mono font-black text-primary mt-1">{trackingNo}</p>
              <p className="text-xs text-slate-500 mt-2">{t('public.apply.trackingHint')}</p>
            </div>
          )}
          <p className="text-slate-500 text-sm">{t('public.apply.thankYou')}</p>
          <Link to={`/track${trackingNo ? `?ref=${encodeURIComponent(trackingNo)}` : ''}`} className="vibrant-btn-secondary inline-flex items-center gap-2 px-6 py-3">
            {t('public.apply.trackBtn')}
          </Link>
          <Link to="/login" className="vibrant-btn-primary inline-flex items-center gap-2 px-6 py-3">
            <LogIn className="w-4 h-4" />
            {t('public.apply.staffLoginBtn')}
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 text-primary rounded-2xl">
            <School className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{t('public.apply.title')}</h1>
          <p className="text-slate-500 font-medium">{t('public.apply.subtitle')}</p>
          <Link to="/login" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-1">
            <LogIn className="w-3 h-3" /> {t('public.apply.staffLogin')}
          </Link>
          <span className="text-slate-300">·</span>
          <Link to="/track" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">
            {t('public.apply.trackLink')}
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
                  <SearchableSelect
                    required
                    value={formData.campusId}
                    onChange={(campusId) => setFormData({ ...formData, campusId, classId: '' })}
                    placeholder="Select campus"
                    searchPlaceholder="Search campuses…"
                    options={campuses.map((c) => ({ value: c.id, label: c.campusName }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Preferred class</label>
                  <SearchableSelect
                    value={formData.classId}
                    onChange={(classId) => setFormData({ ...formData, classId })}
                    disabled={!formData.campusId}
                    placeholder="Any / not sure"
                    searchPlaceholder="Search classes…"
                    options={classes.map((c) => ({ value: c.id, label: classLabel(c) }))}
                  />
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
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Father CNIC *</label>
                  <input
                    required
                    className="vibrant-input font-mono"
                    placeholder="#####-#######-#"
                    value={formData.fatherCnic}
                    onChange={(e) => setFormData({ ...formData, fatherCnic: maskCnicInput(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Student B-Form</label>
                  <input
                    className="vibrant-input font-mono"
                    placeholder="B-Form / registration number"
                    value={formData.studentBform}
                    onChange={(e) => setFormData({ ...formData, studentBform: e.target.value })}
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
                  <SearchableSelect
                    value={formData.gender}
                    onChange={(gender) => setFormData({ ...formData, gender })}
                    options={[
                      { value: 'Male', label: 'Male' },
                      { value: 'Female', label: 'Female' },
                    ]}
                  />
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
                    {t('public.apply.submit')}
                  </>
                )}
              </button>
            </>
          )}
        </motion.form>
        <DevCredit />
      </div>
    </div>
  );
}
