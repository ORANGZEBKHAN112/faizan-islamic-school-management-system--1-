import { useEffect, useState } from 'react';
import { User, StudentPortalData as PortalData } from '../types';
import { dataService } from '../services/dataService';
import { feeCollectedTotal, feeOutstandingTotal } from '../utils/feeStats';
import { User as UserIcon, CreditCard, CalendarCheck, School, AlertCircle } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { motion } from 'motion/react';

interface StudentPortalProps {
  user: User;
}

export default function StudentPortal({ user }: StudentPortalProps) {
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
          <p className="font-black uppercase tracking-widest text-sm">Portal unavailable</p>
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
        title="Student Portal"
        description={<>Welcome, <span className="text-primary font-bold">{user.fullName}</span></>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="vibrant-card p-8">
          <UserIcon className="w-8 h-8 text-primary mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profile</p>
          <p className="text-xl font-black mt-2">{student.firstName}</p>
          <p className="text-sm text-slate-500 mt-2">Roll: {student.rollNumber}</p>
          <p className="text-sm text-slate-500">{student.className} · {student.campusName}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="vibrant-card p-8">
          <CreditCard className="w-8 h-8 text-success mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fees</p>
          <p className="text-xl font-black mt-2 text-success">Rs. {collected.toLocaleString()} paid</p>
          <p className="text-sm text-danger mt-2">Rs. {outstanding.toLocaleString()} outstanding</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="vibrant-card p-8">
          <CalendarCheck className="w-8 h-8 text-accent mb-4" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Attendance</p>
          <p className="text-xl font-black mt-2">{attendanceSummary.present} present</p>
          <p className="text-sm text-slate-500 mt-2">{attendanceSummary.absent} absent · {attendanceSummary.total} total days</p>
        </motion.div>
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <School className="w-5 h-5 text-primary" />
          <h3 className="font-black uppercase tracking-widest text-sm">Fee Vouchers</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-8 py-4">Month/Year</th>
                <th className="px-8 py-4">Amount</th>
                <th className="px-8 py-4">Paid</th>
                <th className="px-8 py-4">Balance</th>
                <th className="px-8 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {fees.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-8 text-center text-slate-400">No fee vouchers yet</td></tr>
              ) : fees.map((f) => (
                <tr key={f.id}>
                  <td className="px-8 py-4 font-bold">{f.month}/{f.year}</td>
                  <td className="px-8 py-4">Rs. {(f.amount || 0).toLocaleString()}</td>
                  <td className="px-8 py-4 text-success">Rs. {(f.paidAmount || 0).toLocaleString()}</td>
                  <td className="px-8 py-4 text-danger">Rs. {(f.balanceAmount || 0).toLocaleString()}</td>
                  <td className="px-8 py-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${f.status === 'Paid' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
