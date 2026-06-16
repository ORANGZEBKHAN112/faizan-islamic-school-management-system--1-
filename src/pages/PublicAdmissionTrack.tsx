import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, School, LogIn, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { dataService } from '../services/dataService';
import DevCredit from '../components/ui/DevCredit';
import type { AdmissionTrackResult } from '../types';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../context/I18nContext';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-600',
  'Under Review': 'bg-accent/10 text-accent',
  Approved: 'bg-primary/10 text-primary',
  Rejected: 'bg-danger/10 text-danger',
  Enrolled: 'bg-success/10 text-success',
};

export default function PublicAdmissionTrack() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [trackingNo, setTrackingNo] = useState('');
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdmissionTrackResult | null>(null);

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) setTrackingNo(ref.toUpperCase());
  }, [searchParams]);

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingNo.trim() || !contact.trim()) {
      toast.error('Tracking number and contact number are required');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await dataService.trackPublicAdmission(trackingNo.trim().toUpperCase(), contact.trim());
      setResult(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not find application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-6">
      <div className="max-w-lg mx-auto space-y-8">
        <div className="flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 text-primary rounded-2xl">
            <School className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{t('public.track.title')}</h1>
          <p className="text-slate-500 font-medium">{t('public.track.subtitle')}</p>
          <div className="flex justify-center gap-4 text-[10px] font-black uppercase tracking-widest">
            <Link to="/apply" className="text-primary hover:underline">{t('public.track.newApplication')}</Link>
            <Link to="/login" className="text-slate-400 hover:underline inline-flex items-center gap-1">
              <LogIn className="w-3 h-3" /> {t('public.track.staffLogin')}
            </Link>
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleTrack}
          className="vibrant-card p-8 space-y-6"
        >
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('public.track.trackingNo')} *</label>
            <input
              required
              className="vibrant-input font-mono uppercase"
              placeholder={t('public.track.trackingPlaceholder')}
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('public.track.contact')} *</label>
            <input
              required
              className="vibrant-input"
              placeholder="Phone used on application"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="vibrant-btn-primary w-full py-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? t('public.track.searching') : t('public.track.search')}
          </button>
        </motion.form>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="vibrant-card p-8 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase">Applicant</p>
                <p className="text-xl font-black">{result.applicantName}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${STATUS_COLORS[result.status] || 'bg-slate-100 text-slate-500'}`}>
                {result.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase">Tracking</p>
                <p className="font-mono font-bold">{result.trackingNo}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase">Campus</p>
                <p className="font-bold">{result.campusName || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase">Class</p>
                <p className="font-bold">{result.className || 'Not assigned'}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase">Applied</p>
                <p className="font-bold">{result.appliedOn ? new Date(result.appliedOn).toLocaleDateString() : '—'}</p>
              </div>
            </div>
            {result.interviewAt && (
              <p className="text-sm p-3 rounded-xl bg-primary/5 text-primary font-bold">
                Interview: {new Date(result.interviewAt).toLocaleString()}
              </p>
            )}
            {result.rejectionReason && (
              <p className="text-sm p-3 rounded-xl bg-danger/5 text-danger font-bold">
                Reason: {result.rejectionReason}
              </p>
            )}
          </motion.div>
        )}

        <DevCredit />
      </div>
    </div>
  );
}
