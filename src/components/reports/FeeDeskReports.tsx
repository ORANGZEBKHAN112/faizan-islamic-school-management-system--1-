import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { dataService } from '../../services/dataService';
import type { ClassCollectionRow, DailyCollectionLine, FeeDefaulterRow } from '../../types';
import PageLoader from '../ui/PageLoader';
import TableShell from '../ui/TableShell';

type DeskView = 'defaulters' | 'classes' | 'daily';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString()}`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escapeCsv = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function actionLabel(actionType: string) {
  if (actionType === 'payment') return 'Payment';
  if (actionType === 'income_reversal') return 'Income reversal';
  if (actionType === 'collection_reversal') return 'Collection reversal';
  return actionType;
}

export default function FeeDeskReports({
  view,
  campusId,
  year,
}: {
  view: DeskView;
  campusId: string;
  year: string;
}) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [date, setDate] = useState(todayIso);
  const [loading, setLoading] = useState(true);
  const [defaulters, setDefaulters] = useState<FeeDefaulterRow[]>([]);
  const [classes, setClasses] = useState<ClassCollectionRow[]>([]);
  const [daily, setDaily] = useState<{ collected: number; reversed: number; net: number; lines: DailyCollectionLine[] }>({
    collected: 0, reversed: 0, net: 0, lines: [],
  });

  const campusParam = campusId !== 'all' ? campusId : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (view === 'defaulters') {
          const data = await dataService.fetchFeeDefaulters({ campusId: campusParam, year, month });
          if (!cancelled) setDefaulters(data.rows || []);
        } else if (view === 'classes') {
          const data = await dataService.fetchClassCollection({ campusId: campusParam, year });
          if (!cancelled) setClasses(data.rows || []);
        } else {
          const data = await dataService.fetchDailyCollection({ campusId: campusParam, date });
          if (!cancelled) {
            setDaily({
              collected: Number(data.collected || 0),
              reversed: Number(data.reversed || 0),
              net: Number(data.net || 0),
              lines: data.lines || [],
            });
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load this report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, campusParam, year, month, date]);

  const exportDefaulters = () => {
    downloadCsv(
      `defaulters-${year}-${String(month).padStart(2, '0')}.csv`,
      ['Admission No', 'Student', 'Father', 'Phone', 'Campus', 'Class', 'Section', 'This Month', 'Older Arrears', 'Total Due'],
      defaulters.map((row) => [
        row.admissionNo,
        row.studentName,
        row.fatherName || '',
        row.fatherMobile || '',
        row.campusName || '',
        row.className || '',
        row.sectionName || '',
        row.thisMonthBalance,
        row.olderBalance,
        row.totalBalance,
      ]),
    );
    toast.success(`Defaulter list exported (${defaulters.length} students)`);
  };

  const exportClasses = () => {
    downloadCsv(
      `class-collection-${year}.csv`,
      ['Campus', 'Class', 'Section', 'Students', 'Billed', 'Collected', 'Balance'],
      classes.map((row) => [
        row.campusName || '',
        row.className,
        row.sectionName || '',
        row.students,
        row.billed,
        row.collected,
        row.balance,
      ]),
    );
    toast.success(`Class collection exported (${classes.length} classes)`);
  };

  const exportDaily = () => {
    downloadCsv(
      `daily-collection-${date}.csv`,
      ['Time', 'Admission No', 'Student', 'Campus', 'Type', 'Amount', 'Recorded By', 'Notes'],
      daily.lines.map((row) => [
        row.performedOn,
        row.admissionNo,
        row.studentName,
        row.campusName || '',
        actionLabel(row.actionType),
        row.actionType === 'payment' ? row.amount : -row.amount,
        row.performedBy || '',
        row.notes || row.reason || '',
      ]),
    );
    toast.success(`Daily collection exported (${daily.lines.length} lines)`);
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
            {view === 'defaulters' && 'Defaulter sheet'}
            {view === 'classes' && 'Class collection'}
            {view === 'daily' && 'Daily collection'}
          </h3>
          <p className="text-xs font-bold text-slate-400 mt-1 max-w-2xl">
            {view === 'defaulters' && `Due balances from vouchers. ${MONTHS[month - 1]} ${year} is separate from older arrears. This list follows voucher balance, not the stored student outstanding figure.`}
            {view === 'classes' && `Billed is voucher amount plus arrears for ${year}, grouped by each student's current class. Balance is what is still due.`}
            {view === 'daily' && 'Payments and reversals recorded in the fee audit log for this date. Cash, bank, and Kuickpay stay in the notes until a payment-mode column exists.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view === 'defaulters' && (
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200"
              aria-label="Billing month"
            >
              {MONTHS.map((label, index) => (
                <option key={label} value={index + 1}>{label}</option>
              ))}
            </select>
          )}
          {view === 'daily' && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200"
              aria-label="Collection date"
            />
          )}
          <button
            type="button"
            onClick={view === 'defaulters' ? exportDefaulters : view === 'classes' ? exportClasses : exportDaily}
            className="px-3 py-2.5 bg-primary/10 text-primary rounded-xl hover:bg-primary hover:text-white transition-all text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {loading ? (
        <PageLoader label="Loading report…" />
      ) : view === 'defaulters' ? (
        <DefaulterTable rows={defaulters} />
      ) : view === 'classes' ? (
        <ClassTable rows={classes} />
      ) : (
        <DailyTable report={daily} />
      )}
    </div>
  );
}

function DefaulterTable({ rows }: { rows: FeeDefaulterRow[] }) {
  const totals = rows.reduce(
    (sum, row) => ({
      thisMonth: sum.thisMonth + row.thisMonthBalance,
      older: sum.older + row.olderBalance,
      total: sum.total + row.totalBalance,
    }),
    { thisMonth: 0, older: 0, total: 0 },
  );

  return (
    <div className="vibrant-card overflow-hidden">
      <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 text-sm font-bold text-slate-500">
        {rows.length} students · this month {money(totals.thisMonth)} · older {money(totals.older)} · total {money(totals.total)}
      </div>
      <TableShell hint="Defaulters with this month and older arrears">
        <table className="w-full min-w-[960px] text-left border-collapse table-sticky-head">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
              <th className="px-6 py-4">Student</th>
              <th className="px-6 py-4">Father / phone</th>
              <th className="px-6 py-4">Class</th>
              <th className="px-6 py-4">This month</th>
              <th className="px-6 py-4">Older</th>
              <th className="px-6 py-4">Total due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400">No outstanding vouchers for this filter.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.studentId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900 dark:text-white">{row.studentName}</div>
                  <div className="text-[10px] font-mono text-slate-400">{row.admissionNo} · {row.campusName || '—'}</div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                  <div>{row.fatherName || '—'}</div>
                  <div className="text-[10px] font-bold text-slate-400">{row.fatherMobile || 'No phone'}</div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                  {row.className || 'Unassigned'}{row.sectionName ? ` · ${row.sectionName}` : ''}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-amber-600">{money(row.thisMonthBalance)}</td>
                <td className="px-6 py-4 text-sm font-bold text-rose-500">{money(row.olderBalance)}</td>
                <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white">{money(row.totalBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}

function ClassTable({ rows }: { rows: ClassCollectionRow[] }) {
  const totals = rows.reduce(
    (sum, row) => ({
      students: sum.students + row.students,
      billed: sum.billed + row.billed,
      collected: sum.collected + row.collected,
      balance: sum.balance + row.balance,
    }),
    { students: 0, billed: 0, collected: 0, balance: 0 },
  );

  return (
    <div className="vibrant-card overflow-hidden">
      <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 text-sm font-bold text-slate-500">
        {rows.length} classes · billed {money(totals.billed)} · collected {money(totals.collected)} · balance {money(totals.balance)}
      </div>
      <TableShell hint="Billed, collected, and balance by class">
        <table className="w-full min-w-[860px] text-left border-collapse table-sticky-head">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
              <th className="px-6 py-4">Class</th>
              <th className="px-6 py-4">Campus</th>
              <th className="px-6 py-4">Students</th>
              <th className="px-6 py-4">Billed</th>
              <th className="px-6 py-4">Collected</th>
              <th className="px-6 py-4">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400">No vouchers for this year.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={`${row.campusName}-${row.classId}-${row.sectionName}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                  {row.className}{row.sectionName ? ` · ${row.sectionName}` : ''}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{row.campusName || '—'}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{row.students}</td>
                <td className="px-6 py-4 text-sm font-bold text-slate-700 dark:text-slate-200">{money(row.billed)}</td>
                <td className="px-6 py-4 text-sm font-bold text-green-600">{money(row.collected)}</td>
                <td className="px-6 py-4 text-sm font-black text-rose-500">{money(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}

function DailyTable({ report }: { report: { collected: number; reversed: number; net: number; lines: DailyCollectionLine[] } }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Collected', value: report.collected, tone: 'text-green-600' },
          { label: 'Reversed', value: report.reversed, tone: 'text-rose-500' },
          { label: 'Net', value: report.net, tone: 'text-slate-900 dark:text-white' },
        ].map((stat) => (
          <div key={stat.label} className="vibrant-card p-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <h3 className={`text-2xl font-black mt-1 ${stat.tone}`}>{money(stat.value)}</h3>
          </div>
        ))}
      </div>
      <div className="vibrant-card overflow-hidden">
        <TableShell hint="Audit lines for the selected date">
          <table className="w-full min-w-[860px] text-left border-collapse table-sticky-head">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-400">No payments or reversals on this date.</td>
                </tr>
              ) : report.lines.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{row.performedOn}</td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-900 dark:text-white">{row.studentName}</div>
                    <div className="text-[10px] font-mono text-slate-400">{row.admissionNo} · {row.campusName || '—'}</div>
                  </td>
                  <td className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">{actionLabel(row.actionType)}</td>
                  <td className={`px-6 py-4 text-sm font-black ${row.actionType === 'payment' ? 'text-green-600' : 'text-rose-500'}`}>
                    {row.actionType === 'payment' ? money(row.amount) : `- ${money(row.amount)}`}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    <div>{row.performedBy || '—'}</div>
                    {(row.notes || row.reason) && <div className="text-[10px] font-bold text-slate-400">{row.notes || row.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>
    </div>
  );
}
