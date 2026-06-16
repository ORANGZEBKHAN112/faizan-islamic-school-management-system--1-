import { useEffect, useState } from 'react';
import { User, StudentPortalData as PortalData } from '../types';
import { dataService } from '../services/dataService';
import { feeCollectedTotal, feeLineBalance, feeOutstandingTotal } from '../utils/feeStats';
import { User as UserIcon, CreditCard, CalendarCheck, School, AlertCircle } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { motion } from 'motion/react';
import { useI18n } from '../context/I18nContext';

interface StudentPortalProps {
  user: User;
}

export default function StudentPortal({ user }: StudentPortalProps) {
  const { t } = useI18n();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const portal = await dataService.fetchStudentPortal();
        setData(portal);
      } catch (err) {
        console.error(err);
        setError('Could not load your student profile. Ensure your login username matches your roll number.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="vibrant-card p-10 flex items-center gap-4 text-danger">
        <AlertCircle className="w-8 h-8 shrink-0" />
        <div>
          <p className="font-black uppercase tracking-widest text-sm">{t('pages.studentPortal.portalUnavailable')}</p>
          <p className="text-sm opacity-80 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const { student, fees, attendanceSummary } = data;
  const collected = feeCollectedTotal(fees);
  const outstanding = feeOutstandingTotal(fees);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title={t('pages.studentPortal.title')}
        description={<>{t('pages.studentPortal.welcome')} <span className="text-primary font-bold">{user.fullName}</span></>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="vibrant-card p-8">
          <UserIcon className="w-8 h-8 text-primary mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('pages.studentPortal.profile')}</p>
          <p className="text-xl font-black mt-2">{student.firstName}</p>
          <p className="text-sm text-slate-500 mt-2">Roll: {student.rollNumber}</p>
          <p className="text-sm text-slate-500">{student.className} · {student.campusName}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="vibrant-card p-8">
          <CreditCard className="w-8 h-8 text-success mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('pages.studentPortal.fees')}</p>
          <p className="text-xl font-black mt-2 text-success">Rs. {collected.toLocaleString()} {t('pages.studentPortal.paid')}</p>
          <p className="text-sm text-danger mt-2">Rs. {outstanding.toLocaleString()} {t('pages.studentPortal.outstanding')}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="vibrant-card p-8">
          <CalendarCheck className="w-8 h-8 text-accent mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('pages.studentPortal.attendance')}</p>
          <p className="text-xl font-black mt-2">{attendanceSummary.present} {t('pages.studentPortal.present')}</p>
          <p className="text-sm text-slate-500 mt-2">
            {attendanceSummary.absent} {t('pages.studentPortal.absent')} · {attendanceSummary.total} {t('pages.studentPortal.totalDays')}
          </p>
        </motion.div>
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <School className="w-5 h-5 text-primary" />
          <h3 className="font-black uppercase tracking-widest text-sm">{t('pages.studentPortal.feeVouchers')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-4">{t('pages.studentPortal.monthYear')}</th>
                <th className="px-8 py-4">{t('pages.studentPortal.amount')}</th>
                <th className="px-8 py-4">{t('pages.studentPortal.paidCol')}</th>
                <th className="px-8 py-4">{t('pages.studentPortal.balance')}</th>
                <th className="px-8 py-4">{t('pages.studentPortal.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {fees.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-8 text-center text-slate-400">{t('pages.studentPortal.noVouchers')}</td></tr>
              ) : fees.map((f) => {
                const arrears = Number(f.arrears) || 0;
                const lineBalance = feeLineBalance(f);
                return (
                  <tr key={f.id}>
                    <td className="px-8 py-4 font-bold">{f.month}/{f.year}</td>
                    <td className="px-8 py-4">
                      <span>Rs. {(f.amount || 0).toLocaleString()}</span>
                      {arrears > 0 && (
                        <span className="block text-[10px] text-slate-400 font-semibold mt-0.5">
                          {t('pages.studentPortal.arrearsNote', { amount: arrears.toLocaleString() })}
                        </span>
                      )}
                    </td>
                    <td className="px-8 py-4 text-success">Rs. {(f.paidAmount || 0).toLocaleString()}</td>
                    <td className="px-8 py-4 text-danger">Rs. {lineBalance.toLocaleString()}</td>
                    <td className="px-8 py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${f.status === 'Paid' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                        {f.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
