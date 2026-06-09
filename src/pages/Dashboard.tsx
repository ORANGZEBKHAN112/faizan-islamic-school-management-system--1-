import { useEffect, useState } from 'react';
import {
  Users, School, Building, CreditCard, AlertCircle, TrendingUp, BarChart3,
  Calendar, ArrowRight, Clock, History as HistoryIcon, TrendingDown,
  GraduationCap, ClipboardList, UserPlus,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { User, Campus, DashboardStats } from '../types';
import { dataService } from '../services/dataService';
import { canPickCampus, campusQueryParam, defaultCampusFilter } from '../utils/campusScope';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';

interface DashboardProps {
  user: User;
}

const emptyStats: DashboardStats = {
  activeStudents: 0, totalCollected: 0, totalOutstanding: 0, campusCount: 0,
  classCount: 0, defaulters: 0, pendingAdmissions: 0, examsScheduled: 0,
  onlineCollections: 0, totalExpenses: 0, monthlyFees: [], recentPayments: [],
};

export default function Dashboard({ user }: DashboardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedCampus, setSelectedCampus] = useState(() => defaultCampusFilter(user));
  const [campusOptions, setCampusOptions] = useState<Campus[]>([]);
  const campusParams = campusQueryParam(user, selectedCampus);

  useEffect(() => {
    dataService.subscribe('campuses', setCampusOptions);
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
  }, [user, selectedCampus]);

  const cards = [
    { title: 'Active Students', value: stats.activeStudents, icon: Users, color: 'bg-success', path: '/students' },
    { title: 'Fees Collected', value: `Rs. ${stats.totalCollected.toLocaleString()}`, icon: CreditCard, color: 'bg-teal-500', path: '/fees' },
    { title: 'Outstanding', value: `Rs. ${stats.totalOutstanding.toLocaleString()}`, icon: AlertCircle, color: 'bg-danger', path: '/fees' },
    { title: 'Fee Defaulters', value: stats.defaulters, icon: AlertCircle, color: 'bg-rose-500', path: '/fees' },
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

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Dashboard</h2>
          <p className="text-slate-500 font-medium">Welcome back, <span className="text-primary font-bold">{user.fullName}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canPickCampus(user) && (
            <div className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
              <Building className="w-4 h-4 text-primary" />
              <select className="vibrant-select py-2 px-3 text-[10px] font-black uppercase tracking-widest border-none bg-transparent focus:ring-0 cursor-pointer min-w-[140px]"
                value={selectedCampus} onChange={(e) => setSelectedCampus(e.target.value)}>
                <option value="all">All Campuses</option>
                {campusOptions.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white dark:bg-slate-900 px-6 py-3 rounded-2xl border border-slate-100 dark:border-slate-800">
            <Calendar className="w-4 h-4 text-primary" />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

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
                  <Bar dataKey="collected" fill="#00a99d" name="Collected" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="pending" fill="#003b5c" name="Pending" radius={[8, 8, 0, 0]} />
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
          <button onClick={() => navigate('/fees')} className="mt-6 w-full vibrant-btn-secondary text-[10px] font-black uppercase">
            View All Fees
          </button>
        </div>
      </div>
    </div>
  );
}
