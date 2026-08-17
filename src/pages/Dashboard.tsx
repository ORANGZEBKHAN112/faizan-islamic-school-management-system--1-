import { useEffect, useState } from 'react';
import {
  Users, School, Building, CreditCard, AlertCircle, TrendingUp, BarChart3,
  Calendar, ArrowRight, Clock, History as HistoryIcon, TrendingDown,
  GraduationCap, ClipboardList, UserPlus, Undo2, FileDiff,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { User, Campus, DashboardStats, FeeAuditLogEntry, FeeAuditSummary } from '../types';
import { dataService } from '../services/dataService';
import { canPickCampus, campusQueryParam, defaultCampusFilter, pathWithCampus } from '../utils/campusScope';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import SetupChecklist from '../components/ui/SetupChecklist';
import TableShell from '../components/ui/TableShell';
import { CHART_PRIMARY, CHART_SECONDARY } from '../utils/chartTheme';
import { motion } from 'motion/react';
import { useI18n } from '../context/I18nContext';
import { toast } from 'sonner';
import { formatRollNumberForDisplay } from '../utils/rollNumber';

interface DashboardProps {
  user: User;
}

const emptyStats: DashboardStats = {
  activeStudents: 0, totalCollected: 0, totalOutstanding: 0, campusCount: 0,
  classCount: 0, defaulters: 0, pendingAdmissions: 0, examsScheduled: 0,
  onlineCollections: 0, totalExpenses: 0, monthlyFees: [], recentPayments: [],
};

const emptyAuditSummary: FeeAuditSummary = {
  totalReversed: 0,
  collectionReversed: 0,
  incomeReversed: 0,
  totalIncrease: 0,
  totalDecrease: 0,
  totalPaymentsLogged: 0,
  totalEvents: 0,
  affectedStudents: 0,
};

function actionLabel(actionType: string) {
  switch (actionType) {
    case 'adjustment_increase': return 'Increase';
    case 'adjustment_decrease': return 'Decrease';
    case 'collection_reversal': return 'Collection Reversal';
    case 'income_reversal': return 'Income Reversal';
    case 'payment': return 'Payment Update';
    default: return actionType;
  }
}

export default function Dashboard({ user }: DashboardProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedCampus, setSelectedCampus] = useState(() => defaultCampusFilter(user));
  const [campusOptions, setCampusOptions] = useState<Campus[]>([]);
  const [statsTick, setStatsTick] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'reversals' | 'voucher-changes'>('overview');
  const [auditSummary, setAuditSummary] = useState<FeeAuditSummary>(emptyAuditSummary);
  const [reversalRows, setReversalRows] = useState<FeeAuditLogEntry[]>([]);
  const [changeRows, setChangeRows] = useState<FeeAuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const campusParams = campusQueryParam(user, selectedCampus);
  const feesPath = pathWithCampus('/fees', user, selectedCampus);
  const canSeeAudit = ['Super Admin', 'Admin', 'Accountant'].includes(user.role);

  useEffect(() => {
    dataService.subscribe('campuses', setCampusOptions);
  }, []);

  useEffect(() => {
    const onFocus = () => setStatsTick((n) => n + 1);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setDbError(null);
      try {
        const data = await dataService.fetchDashboardStats(campusParams);
        if (!cancelled) setStats({ ...emptyStats, ...data });
      } catch (error) {
        console.error(error);
        if (!cancelled) setDbError('Could not load dashboard data. Check database connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, selectedCampus, campusParams, statsTick]);

  useEffect(() => {
    if (!canSeeAudit || activeTab === 'overview') return;
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const campusId = selectedCampus !== 'all' ? selectedCampus : undefined;
        const [summary, reversals, changes] = await Promise.all([
          dataService.fetchFeeAuditSummary({ campusId }),
          dataService.fetchFeeAuditLog({ campusId, tab: 'reversals', limit: 80 }),
          dataService.fetchFeeAuditLog({ campusId, tab: 'voucher-changes', limit: 100 }),
        ]);
        if (!cancelled) {
          setAuditSummary({ ...emptyAuditSummary, ...summary });
          setReversalRows(reversals as unknown as FeeAuditLogEntry[]);
          setChangeRows(changes as unknown as FeeAuditLogEntry[]);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load fee audit data');
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canSeeAudit, activeTab, selectedCampus, statsTick]);

  const cards = [
    { title: 'Active Students', value: stats.activeStudents, icon: Users, color: 'bg-success', path: '/students' },
    { title: 'Fees Collected', value: `Rs. ${stats.totalCollected.toLocaleString()}`, icon: CreditCard, color: 'bg-teal-500', path: feesPath },
    { title: 'Outstanding', value: `Rs. ${stats.totalOutstanding.toLocaleString()}`, icon: AlertCircle, color: 'bg-danger', path: feesPath },
    { title: 'Fee Defaulters', value: stats.defaulters, icon: AlertCircle, color: 'bg-rose-500', path: feesPath },
    { title: 'Pending Admissions', value: stats.pendingAdmissions, icon: UserPlus, color: 'bg-accent', path: '/admissions' },
    { title: 'Exams This Month', value: stats.examsScheduled, icon: ClipboardList, color: 'bg-primary', path: '/exams' },
    { title: 'Campuses', value: stats.campusCount, icon: School, color: 'bg-primary', path: '/campuses' },
    { title: 'Classes', value: stats.classCount, icon: GraduationCap, color: 'bg-secondary', path: '/classes' },
    { title: 'Online Payments', value: `Rs. ${stats.onlineCollections.toLocaleString()}`, icon: TrendingUp, color: 'bg-accent', path: '/quickpay' },
  ];

  const recentActivity = (stats.recentPayments || []).map((t) => ({
    id: t.id,
    title: `${t.studentName || 'Student'} — Rs. ${t.amount.toLocaleString()}`,
    time: t.transactionDate ? new Date(t.transactionDate).toLocaleString() : 'Recent',
    icon: CreditCard,
    color: 'text-green-500',
  }));

  const setupSteps = [
    {
      id: 'campuses',
      title: 'Add campuses',
      description: 'Create at least one active campus in the network.',
      href: '/campuses',
      done: stats.campusCount > 0,
    },
    {
      id: 'classes',
      title: 'Create classes',
      description: 'Set up classes and sections for each campus.',
      href: '/classes',
      done: stats.classCount > 0,
    },
    ...(user.role === 'Super Admin'
      ? [{
          id: 'fee-session',
          title: 'Configure fee session',
          description: 'Set campus fee structure for the current academic session.',
          href: '/fee-settings',
          done: (stats.monthlyFees || []).some((m) => m.collected > 0),
        }]
      : []),
    {
      id: 'students',
      title: 'Enroll students',
      description: 'Register students or import from Excel.',
      href: '/students',
      done: stats.activeStudents > 0,
    },
    {
      id: 'vouchers',
      title: 'Generate fee vouchers',
      description: 'Run monthly fee generation for your campus.',
      href: feesPath,
      done: stats.totalCollected > 0,
    },
  ];

  const showSetup = user.role === 'Super Admin' || user.role === 'Admin';
  const netAdjustment = Number(auditSummary.totalIncrease || 0) - Number(auditSummary.totalDecrease || 0);

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-12 w-64 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {dbError && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-danger/10 border border-danger/20 rounded-3xl flex items-center gap-4 text-danger">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <p className="text-sm font-medium flex-1">{dbError}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-danger text-white rounded-xl text-[10px] font-black uppercase">Retry</button>
        </motion.div>
      )}

      <PageHeader
        title={t('pages.dashboard.title')}
        description={<>{t('pages.dashboard.welcome')} <span className="text-primary font-bold">{user.fullName}</span></>}
        filters={
          <>
            {canPickCampus(user) && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <Building className="w-4 h-4 text-primary shrink-0" />
                <SearchableSelect
                  variant="inline"
                  value={selectedCampus}
                  onChange={setSelectedCampus}
                  options={[
                    { value: 'all', label: 'All campuses' },
                    ...campusOptions.map((c) => ({ value: c.id, label: c.campusName })),
                  ]}
                  placeholder="All campuses"
                  searchPlaceholder="Search campuses…"
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-2xl border border-slate-100 dark:border-slate-800">
              <Calendar className="w-4 h-4 text-primary shrink-0" />
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </>
        }
      />

      {canSeeAudit && (
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
            { id: 'reversals' as const, label: 'Reversals', icon: Undo2 },
            { id: 'voucher-changes' as const, label: 'Voucher Changes', icon: FileDiff },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-100 dark:border-slate-800 hover:text-primary'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'overview' && (
        <>
          {showSetup && <SetupChecklist steps={setupSteps} />}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cards.map((card, i) => (
              <motion.button key={i} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }} onClick={() => navigate(card.path)}
                className="vibrant-card p-6 flex items-center gap-5 text-left group">
                <div className={`${card.color} p-4 rounded-2xl text-white shadow-lg`}>
                  <card.icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{card.title}</p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white truncate">{card.value}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-primary transition-colors shrink-0" />
              </motion.button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 vibrant-card p-8">
              <div className="flex items-center gap-3 mb-8">
                <BarChart3 className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-black">Fee Collection — {new Date().getFullYear()}</h3>
              </div>
              <div className="h-[360px]">
                {stats.monthlyFees?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.monthlyFees}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis dataKey="monthName" tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `Rs.${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                      <Tooltip formatter={(v: number) => [`Rs. ${v.toLocaleString()}`, '']} />
                      <Bar dataKey="collected" fill={CHART_PRIMARY} name="Collected" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="pending" fill={CHART_SECONDARY} name="Pending" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 font-bold">No fee data for this year yet</div>
                )}
              </div>
            </div>

            <div className="vibrant-card p-8">
              <div className="flex items-center gap-3 mb-6">
                <HistoryIcon className="w-6 h-6 text-secondary" />
                <h3 className="text-xl font-black">Recent Payments</h3>
              </div>
              <div className="space-y-6">
                {recentActivity.length > 0 ? recentActivity.map((a, i) => (
                  <div key={i} className="flex gap-4">
                    <div className={`p-2 rounded-xl bg-slate-50 dark:bg-slate-800 ${a.color}`}>
                      <a.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold">{a.title}</p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" /> {a.time}
                      </p>
                    </div>
                  </div>
                )) : (
                  <p className="text-slate-400 text-sm text-center py-8">No recent payments</p>
                )}
              </div>
              <button onClick={() => navigate(feesPath)} className="mt-6 w-full vibrant-btn-secondary text-[10px] font-black uppercase">
                View All Fees
              </button>
            </div>
          </div>
        </>
      )}

      {activeTab === 'reversals' && canSeeAudit && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Reversed', value: auditSummary.totalReversed, color: 'text-rose-600', bg: 'bg-rose-500/10' },
              { label: 'Collection Reversed', value: auditSummary.collectionReversed, color: 'text-amber-600', bg: 'bg-amber-500/10' },
              { label: 'Income Reversed', value: auditSummary.incomeReversed, color: 'text-orange-600', bg: 'bg-orange-500/10' },
              { label: 'Affected Students', value: auditSummary.affectedStudents, color: 'text-primary', bg: 'bg-primary/10', plain: true },
            ].map((card) => (
              <div key={card.label} className="vibrant-card p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</p>
                <p className={`text-2xl font-black mt-2 ${card.color}`}>
                  {card.plain ? card.value : `Rs. ${Number(card.value || 0).toLocaleString()}`}
                </p>
              </div>
            ))}
          </div>

          <div className="vibrant-card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black uppercase tracking-tight">Reversal Audit Log</h3>
              <p className="text-xs font-bold text-slate-400 mt-1">Collection and income reversals with before/after paid amounts</p>
            </div>
            <TableShell hint="Swipe to see all audit columns">
              <table className="w-full min-w-[900px] text-left border-collapse table-sticky-head">
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                    <th className="px-5 py-4">When</th>
                    <th className="px-5 py-4">Student</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Amount</th>
                    <th className="px-5 py-4">Paid Before → After</th>
                    <th className="px-5 py-4">By</th>
                    <th className="px-5 py-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLoading ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Loading…</td></tr>
                  ) : reversalRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">No reversals yet</td></tr>
                  ) : reversalRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-5 py-4 text-xs text-slate-500">{row.performedOn ? new Date(row.performedOn).toLocaleString() : '—'}</td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900 dark:text-white">{row.studentName || '—'}</div>
                        <div className="text-[10px] font-mono text-slate-400">{formatRollNumberForDisplay(row.rollNumber)}</div>
                      </td>
                      <td className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-rose-600">{actionLabel(row.actionType)}</td>
                      <td className="px-5 py-4 font-black">Rs. {Number(row.amount || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                        {Number(row.previousPaid ?? 0).toLocaleString()} → {Number(row.newPaid ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-500">{row.performedBy || '—'}</td>
                      <td className="px-5 py-4 text-xs text-slate-500 max-w-[220px] truncate" title={row.reason || ''}>{row.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
        </div>
      )}

      {activeTab === 'voucher-changes' && canSeeAudit && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Increases', value: auditSummary.totalIncrease, color: 'text-emerald-600' },
              { label: 'Decreases', value: auditSummary.totalDecrease, color: 'text-amber-600' },
              { label: 'Net Adjustment', value: netAdjustment, color: netAdjustment >= 0 ? 'text-primary' : 'text-rose-600' },
              { label: 'Payments Logged', value: auditSummary.totalPaymentsLogged, color: 'text-teal-600' },
            ].map((card) => (
              <div key={card.label} className="vibrant-card p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</p>
                <p className={`text-2xl font-black mt-2 ${card.color}`}>Rs. {Number(card.value || 0).toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="vibrant-card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black uppercase tracking-tight">Students With Voucher Updates</h3>
              <p className="text-xs font-bold text-slate-400 mt-1">Payments, adjustments, and income/collection reversals — for audit</p>
            </div>
            <TableShell hint="Swipe to review voucher change history">
              <table className="w-full min-w-[980px] text-left border-collapse table-sticky-head">
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                    <th className="px-5 py-4">When</th>
                    <th className="px-5 py-4">Student</th>
                    <th className="px-5 py-4">Action</th>
                    <th className="px-5 py-4">Amount</th>
                    <th className="px-5 py-4">Voucher</th>
                    <th className="px-5 py-4">Paid</th>
                    <th className="px-5 py-4">Balance</th>
                    <th className="px-5 py-4">By / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLoading ? (
                    <tr><td colSpan={8} className="px-5 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Loading…</td></tr>
                  ) : changeRows.length === 0 ? (
                    <tr><td colSpan={8} className="px-5 py-8 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">No voucher changes logged yet</td></tr>
                  ) : changeRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-5 py-4 text-xs text-slate-500">{row.performedOn ? new Date(row.performedOn).toLocaleString() : '—'}</td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900 dark:text-white">{row.studentName || '—'}</div>
                        <div className="text-[10px] font-mono text-slate-400">{formatRollNumberForDisplay(row.rollNumber)}</div>
                        <div className="text-[10px] text-slate-400">{row.campusName || ''}</div>
                      </td>
                      <td className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-primary">{actionLabel(row.actionType)}</td>
                      <td className="px-5 py-4 font-black">Rs. {Number(row.amount || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                        {row.previousAmount != null && row.newAmount != null
                          ? `${Number(row.previousAmount).toLocaleString()} → ${Number(row.newAmount).toLocaleString()}`
                          : '—'}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                        {Number(row.previousPaid ?? 0).toLocaleString()} → {Number(row.newPaid ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                        {Number(row.previousBalance ?? 0).toLocaleString()} → {Number(row.newBalance ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-xs font-bold text-slate-500">{row.performedBy || '—'}</div>
                        <div className="text-xs text-slate-400 max-w-[200px] truncate" title={row.reason || ''}>{row.reason || '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          </div>
        </div>
      )}
    </div>
  );
}
