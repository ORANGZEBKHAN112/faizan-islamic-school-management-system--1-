import React, { useEffect, useState } from 'react';
import { FileText, Download, Filter, TrendingUp, TrendingDown, Users, Building, AlertCircle, PieChart, BarChart, Phone, User, CalendarDays, DollarSign } from 'lucide-react';
import { Campus } from '../types';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CHART_PALETTE, CHART_PRIMARY, CHART_SECONDARY } from '../utils/chartTheme';
import { useNavigate } from 'react-router-dom';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import { useCollection } from '../hooks/useCollection';
import PageHeader from '../components/ui/PageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import PageLoader from '../components/ui/PageLoader';
import TableShell from '../components/ui/TableShell';
import { toast } from 'sonner';

type ReportSummary = {
  totalExpected: number;
  totalCollected: number;
  totalPending: number;
  totalExpenses: number;
  defaulters: number;
  netProfit: number;
  monthlyData: Array<{ month: string; Collected: number; Pending: number }>;
  campusBreakdown: Array<{ campusId: string; campusName: string; collected: number; pending: number; defaulters: number }>;
};

export default function Reports() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  
  const [filterCampus, setFilterCampus] = useState(() => (user ? defaultCampusFilter(user) : 'all'));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await dataService.fetchReportSummary({
          campusId: filterCampus !== 'all' ? filterCampus : undefined,
          year: filterYear,
        });
        if (!cancelled) setSummary(data);
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load report data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filterCampus, filterYear]);

  const stats = summary || {
    totalExpected: 0, totalCollected: 0, totalPending: 0, totalExpenses: 0, defaulters: 0, netProfit: 0,
  };
  const monthlyData = summary?.monthlyData || [];
  const campusBreakdown = summary?.campusBreakdown || [];

  const campusData = (filterCampus === 'all' ? campusBreakdown : campusBreakdown.filter((c) => c.campusId === filterCampus))
    .map((c) => ({ name: c.campusName, value: Number(c.collected || 0) }))
    .filter((c) => c.value > 0);

  const COLORS = CHART_PALETTE;

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('Financial Report - Faizan Islamic School', 15, 20);
    doc.setFontSize(12);
    doc.text(`Year: ${filterYear} | Campus: ${filterCampus === 'all' ? 'All' : campuses.find(c => c.id === filterCampus)?.campusName}`, 15, 30);
    
    doc.text(`Total Expected: Rs. ${stats.totalExpected.toLocaleString()}`, 15, 45);
    doc.text(`Total Collected: Rs. ${stats.totalCollected.toLocaleString()}`, 15, 52);
    doc.text(`Total Pending: Rs. ${stats.totalPending.toLocaleString()}`, 15, 59);

    const tableData = monthlyData.map((m: any) => [
      m.month,
      `Rs. ${m.Collected.toLocaleString()}`,
      `Rs. ${m.Pending.toLocaleString()}`,
      `Rs. ${(m.Collected + m.Pending).toLocaleString()}`
    ]);

    autoTable(doc, {
      startY: 70,
      head: [['Month', 'Collected', 'Pending', 'Total']],
      body: tableData,
    });

    doc.save(`Report_${filterYear}_${filterCampus}.pdf`);
  };

  const exportToCsv = () => {
    const escapeCsv = (value: string | number) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [
      ['Month', 'Collected', 'Pending', 'Total'],
      ...monthlyData.map((m: any) => [
        m.month,
        m.Collected,
        m.Pending,
        m.Collected + m.Pending,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Report_${filterYear}_${filterCampus}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <PageLoader label="Loading reports…" />;
  }

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Reports"
        description="Analyze school financial performance and metrics."
        filters={
          <div className="flex flex-wrap items-center gap-3 bg-white/50 dark:bg-slate-900/50 p-2 rounded-2xl border border-slate-100 dark:border-slate-800">
            {(!user || canPickCampus(user)) && (
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <Building className="w-4 h-4 text-slate-400 shrink-0" />
                <SearchableSelect
                  variant="inline"
                  value={filterCampus}
                  onChange={setFilterCampus}
                  placeholder="All campuses"
                  searchPlaceholder="Search campuses…"
                  options={[
                    { value: 'all', label: 'All campuses' },
                    ...campuses.map((c) => ({ value: c.id, label: c.campusName })),
                  ]}
                />
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
              <SearchableSelect
                variant="inline"
                value={filterYear}
                onChange={setFilterYear}
                searchPlaceholder="Search year…"
                options={[2023, 2024, 2025, 2026].map((y) => ({ value: String(y), label: String(y) }))}
              />
            </div>
            <button
              onClick={exportToPDF}
              className="p-2.5 bg-primary/10 text-primary rounded-xl hover:bg-primary hover:text-white transition-all"
              title="Export PDF"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={exportToCsv}
              className="p-2.5 bg-secondary/10 text-secondary rounded-xl hover:bg-secondary hover:text-white transition-all"
              title="Export CSV"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Collected', value: stats.totalCollected, icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10', isAmount: true },
          { label: 'Total Expenses', value: stats.totalExpenses, icon: TrendingDown, color: 'text-rose-500', bg: 'bg-rose-500/10', isAmount: true },
          { label: 'Net Profit/Loss', value: stats.netProfit, icon: DollarSign, color: stats.netProfit >= 0 ? 'text-primary' : 'text-rose-600', bg: stats.netProfit >= 0 ? 'bg-primary/10' : 'bg-rose-600/10', isAmount: true },
          { label: 'Outstanding Fees', value: stats.totalPending, icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10', isAmount: true }
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="vibrant-card p-6"
          >
            <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center mb-4 shadow-xl`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
              {stat.isAmount === false ? stat.value : `Rs. ${stat.value.toLocaleString()}`}
            </h3>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Monthly Trend */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="vibrant-card p-8"
        >
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Monthly Trends</h3>
              <p className="text-xs font-bold text-slate-400 mt-1">Collection vs Outstanding</p>
            </div>
            <BarChart className="text-slate-300 w-8 h-8" />
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ReBarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} tickFormatter={(v) => `Rs. ${v/1000}k`} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 900 }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 900 }} />
                <Bar dataKey="Collected" fill={CHART_PRIMARY} radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="Pending" fill={CHART_SECONDARY} radius={[4, 4, 0, 0]} barSize={20} />
              </ReBarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Campus Breakdown */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="vibrant-card p-8"
        >
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Campus Collection</h3>
              <p className="text-xs font-bold text-slate-400 mt-1">Market share by campus</p>
            </div>
            <PieChart className="text-slate-300 w-8 h-8" />
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={campusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {campusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 900 }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 900 }} />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Defaulters Table */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="vibrant-card overflow-hidden"
      >
        <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Campus Summary</h3>
            <p className="text-xs font-bold text-slate-400 mt-1">Network-wide collections and outstanding by campus</p>
          </div>
          <span className="px-4 py-2 bg-rose-500/10 text-rose-500 rounded-2xl text-[10px] font-black uppercase tracking-widest">
            {stats.defaulters} Defaulters
          </span>
        </div>
        <TableShell>
          <table className="w-full min-w-[640px] text-left table-sticky-head">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                <th className="px-8 py-4">Campus</th>
                <th className="px-8 py-4">Defaulters</th>
                <th className="px-8 py-4">Outstanding</th>
                <th className="px-8 py-4">Collected</th>
                <th className="px-8 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {campusBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-12 text-center text-slate-400 text-sm">
                    {stats.defaulters} defaulter(s) — open Fee Management for student-level detail.
                  </td>
                </tr>
              ) : campusBreakdown.map((row) => (
                <tr key={row.campusId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all">
                  <td className="px-8 py-6 font-black text-slate-900 dark:text-white">{row.campusName}</td>
                  <td className="px-8 py-6 text-sm text-slate-600 dark:text-slate-300">{row.defaulters} students</td>
                  <td className="px-8 py-6 text-sm font-bold text-rose-500">Rs. {Number(row.pending || 0).toLocaleString()}</td>
                  <td className="px-8 py-6 text-sm text-green-600">Rs. {Number(row.collected || 0).toLocaleString()}</td>
                  <td className="px-8 py-6 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/fees?campusId=${row.campusId}`)}
                      className="px-4 py-2 bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary rounded-xl hover:bg-primary hover:text-white transition-all"
                    >
                      View Fees
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </motion.div>
    </div>
  );
}
