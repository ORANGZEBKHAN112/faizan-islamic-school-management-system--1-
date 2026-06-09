import React, { useEffect, useState } from 'react';
import { FileText, Download, Filter, TrendingUp, TrendingDown, Users, Building, AlertCircle, PieChart, BarChart, Phone, User, CalendarDays, DollarSign } from 'lucide-react';
import { Fee, Student, Campus, Class } from '../types';
import { feeCollectedTotal, feeOutstandingTotal } from '../utils/feeStats';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { canPickCampus, defaultCampusFilter, getStoredUser } from '../utils/campusScope';
import { useCollection } from '../hooks/useCollection';
import PageLoader from '../components/ui/PageLoader';

export default function Reports() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { data: vouchers, loading: vouchersLoading } = useCollection<Fee>('fees');
  const { data: students, loading: studentsLoading } = useCollection<Student>('students');
  const { data: campuses, loading: campusesLoading } = useCollection<Campus>('campuses');
  const { data: classes, loading: classesLoading } = useCollection<Class>('classes');
  const { data: expenses, loading: expensesLoading } = useCollection<any>('expenses');
  
  const [filterCampus, setFilterCampus] = useState(() => (user ? defaultCampusFilter(user) : 'all'));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());

  const loading = vouchersLoading || studentsLoading || campusesLoading || classesLoading || expensesLoading;

  const filteredVouchers = vouchers.filter(v => {
    const student = students.find(s => s.id === v.studentId);
    const campusMatch = filterCampus === 'all' || student?.campusId === filterCampus;
    const yearMatch = v.year === parseInt(filterYear);
    return campusMatch && yearMatch;
  });

  const filteredExpenses = expenses.filter(e => {
    const yearMatch = new Date(e.date).getFullYear() === parseInt(filterYear);
    const campusMatch = filterCampus === 'all' || e.campusId === filterCampus;
    return yearMatch && campusMatch;
  });

  // Aggregate Data
  const stats = {
    totalExpected: filteredVouchers.reduce((acc, v) => acc + (v.amount || 0) + (v.arrears || 0), 0),
    totalCollected: feeCollectedTotal(filteredVouchers),
    totalPending: feeOutstandingTotal(filteredVouchers),
    totalExpenses: filteredExpenses.reduce((acc, e) => acc + e.amount, 0),
    defaulters: Array.from(
      new Set(
        filteredVouchers
          .filter(v => v.status === 'Unpaid' || v.status === 'Partially Paid')
          .map(v => v.studentId)
      )
    ).length,
  };

  const netProfit = stats.totalCollected - stats.totalExpenses;

  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const monthlyByKey = filteredVouchers.reduce((acc: Record<number, { m: number; month: string; Collected: number; Pending: number }>, v) => {
    const m = v.month;
    if (m === 0) return acc;
    if (!acc[m]) acc[m] = { m, month: monthNames[m], Collected: 0, Pending: 0 };
    acc[m].Collected += Number(v.paidAmount) || 0;
    const balance = Number(v.balanceAmount);
    if (!Number.isNaN(balance) && balance > 0) {
      acc[m].Pending += balance;
    } else if (v.status === 'Unpaid' || v.status === 'Partially Paid') {
      const base = (v.amount || 0) + (v.arrears || 0);
      acc[m].Pending += Math.max(0, base - (v.paidAmount || 0));
    }
    return acc;
  }, {} as Record<number, { m: number; month: string; Collected: number; Pending: number }>);
  const monthlyData = (Object.values(monthlyByKey) as { m: number; month: string; Collected: number; Pending: number }[])
    .sort((a, b) => a.m - b.m);

  const campusNameFromVoucher = (v: Fee) => {
    if (v.campusName) return v.campusName;
    const s = students.find((st) => st.id === v.studentId);
    return campuses.find((c) => c.id === s?.campusId)?.campusName || 'Unknown';
  };

  const campusLabelMap = filteredVouchers.reduce((acc: Record<string, number>, v) => {
    const name = campusNameFromVoucher(v);
    acc[name] = (acc[name] || 0) + (Number(v.paidAmount) || 0);
    return acc;
  }, {} as Record<string, number>);

  const campusData = Object.entries(campusLabelMap).map(([name, value]) => ({ name, value: Number(value) })).filter((c) => c.value > 0);

  const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

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

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(monthlyData.map((m: any) => ({
      Month: m.month,
      Collected: m.Collected,
      Pending: m.Pending,
      Total: m.Collected + m.Pending
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fees');
    XLSX.writeFile(workbook, `Report_${filterYear}_${filterCampus}.xlsx`);
  };

  if (loading) {
    return <PageLoader label="Loading reports…" />;
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            <FileText className="w-10 h-10 text-primary" />
            REPORTS
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">Analyze school financial performance and metrics</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-white/50 dark:bg-slate-900/50 p-2 rounded-3xl border border-slate-100 dark:border-slate-800 backdrop-blur-md">
          {(!user || canPickCampus(user)) && (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
              <Building className="w-4 h-4 text-slate-400" />
              <select 
                className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:ring-0 cursor-pointer"
                value={filterCampus}
                onChange={(e) => setFilterCampus(e.target.value)}
              >
                <option value="all">All Campuses</option>
                {campuses.map(c => <option key={c.id} value={c.id}>{c.campusName}</option>)}
              </select>
            </div>
          )}
          
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <TrendingUp className="w-4 h-4 text-slate-400" />
            <select 
              className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 focus:ring-0 cursor-pointer"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            >
              {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-2" />

          <button 
            onClick={exportToPDF}
            className="p-3 bg-primary/10 text-primary rounded-2xl hover:bg-primary transition-all hover:text-white group"
            title="Export PDF"
          >
            <Download className="w-5 h-5" />
          </button>
          <button 
            onClick={exportToExcel}
            className="p-3 bg-secondary/10 text-secondary rounded-2xl hover:bg-secondary transition-all hover:text-white group"
            title="Export Excel"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Collected', value: stats.totalCollected, icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10', isAmount: true },
          { label: 'Total Expenses', value: stats.totalExpenses, icon: TrendingDown, color: 'text-rose-500', bg: 'bg-rose-500/10', isAmount: true },
          { label: 'Net Profit/Loss', value: netProfit, icon: DollarSign, color: netProfit >= 0 ? 'text-primary' : 'text-rose-600', bg: netProfit >= 0 ? 'bg-primary/10' : 'bg-rose-600/10', isAmount: true },
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
                <Bar dataKey="Collected" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="Pending" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={20} />
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
            <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Defaulters List</h3>
            <p className="text-xs font-bold text-slate-400 mt-1">Students with outstanding balances</p>
          </div>
          <span className="px-4 py-2 bg-rose-500/10 text-rose-500 rounded-2xl text-[10px] font-black uppercase tracking-widest">
            {stats.defaulters} Defaulters
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                <th className="px-8 py-4">Student Info</th>
                <th className="px-8 py-4">Guardian / Contact</th>
                <th className="px-8 py-4">Campus & Class</th>
                <th className="px-8 py-4">Financial Status</th>
                <th className="px-8 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {Array.from(new Set(filteredVouchers.filter(v => v.status === 'Unpaid').map(v => v.studentId))).map(sId => {
                const student = students.find(s => s.id === sId);
                const campus = campuses.find(c => c.id === student?.campusId);
                const cls = classes.find(c => c.id === student?.classId);
                const studentVouchers = vouchers.filter(v => v.studentId === sId && v.status === 'Unpaid');
                const totalDue = studentVouchers.reduce((acc, v) => acc + v.amount, 0);
                const latestVoucher = [...studentVouchers].sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0];

                return (
                  <tr key={sId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                          {student?.profileImage ? (
                            <img src={student.profileImage} alt="" className="w-full h-full object-cover rounded-xl" />
                          ) : (
                            <User className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <div className="font-black text-slate-900 dark:text-white group-hover:text-primary transition-colors">{student?.firstName}</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">ROLL: {student?.rollNumber} | GR: {student?.serialNo}</div>
                          <div className="text-[9px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span className={`px-1.5 py-0.5 rounded-md ${student?.gender === 'Male' ? 'bg-blue-500/10 text-blue-500' : 'bg-pink-500/10 text-pink-500'}`}>
                              {student?.gender || 'N/A'}
                            </span>
                            <span className="truncate max-w-[150px]">{student?.address || 'No Address'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <User className="w-3 h-3 text-slate-400" />
                          {student?.fatherName}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-widest">
                          <Phone className="w-3 h-3" />
                          {student?.contactNumber || 'No Contact'}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <div className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase">{campus?.campusName || 'N/A'}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{cls?.className || student?.className} - {cls?.sectionName || student?.sectionName || 'A'}</div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <div className="text-sm font-black text-rose-500">Rs. {totalDue.toLocaleString()}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <AlertCircle className={`w-3 h-3 ${studentVouchers.length > 2 ? 'text-rose-500' : 'text-amber-500'}`} />
                          <span className={`text-[9px] font-black uppercase ${studentVouchers.length > 2 ? 'text-rose-500' : 'text-slate-400'}`}>
                            {studentVouchers.length} Months Pending
                          </span>
                        </div>
                        <div className="text-[8px] text-slate-400 mt-0.5 font-bold uppercase">
                          Last: {latestVoucher?.month === 0 ? 'Arrears' : `${monthNames[latestVoucher?.month]} ${latestVoucher?.year}`}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button 
                          onClick={() => student?.id && navigate(`/students?id=${student.id}`)}
                          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm"
                        >
                          Profile
                        </button>
                        <button 
                          onClick={() => navigate(`/fees`)}
                          className="px-4 py-2 bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm"
                        >
                          Collect
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
