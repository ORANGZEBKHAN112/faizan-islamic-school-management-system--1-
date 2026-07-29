import { useEffect, useMemo, useState } from 'react';
import { FileText, Search, User, BookOpen, Download } from 'lucide-react';
import { toast } from 'sonner';
import { dataService } from '../../services/dataService';
import SearchableSelect from '../ui/SearchableSelect';
import { formatRollNumberForDisplay } from '../../utils/rollNumber';
import { deriveAcademicSession } from '../../utils/academicSession';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type Mode = 'single' | 'custom' | 'ledger';

type StudentOpt = {
  id: string;
  firstName: string;
  lastName?: string;
  rollNumber: string;
  fatherName?: string;
  campusName?: string;
};

function defaultDueDate(year: number, month: number): string {
  return new Date(year, month - 1, 10).toISOString().split('T')[0];
}

function defaultValidityDate(year: number, month: number): string {
  return new Date(year, month, 0).toISOString().split('T')[0];
}

interface Props {
  mode: Mode;
  onCreated?: () => void;
}

export default function SingleVoucherPanel({ mode, onCreated }: Props) {
  const now = new Date();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<StudentOpt[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [dueDate, setDueDate] = useState(defaultDueDate(now.getFullYear(), now.getMonth() + 1));
  const [validityDate, setValidityDate] = useState(defaultValidityDate(now.getFullYear(), now.getMonth() + 1));
  const [session, setSession] = useState(deriveAcademicSession(now.getFullYear(), now.getMonth() + 1));
  const [submitting, setSubmitting] = useState(false);
  const [custom, setCustom] = useState({
    tuitionFee: 0,
    admissionFee: 0,
    securityFee: 0,
    examFee: 0,
    transportFee: 0,
    miscFee: 0,
    arrears: 0,
    discountAmount: 0,
    fineAmount: 0,
    description: '',
    feeType: 'Monthly',
  });
  const [ledger, setLedger] = useState<{
    student?: Record<string, unknown>;
    vouchers?: Array<Record<string, unknown>>;
    transactions?: Array<Record<string, unknown>>;
    summary?: { voucherCount: number; totalPaid: number; totalOutstanding: number };
  } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const selected = useMemo(() => options.find((s) => s.id === studentId), [options, studentId]);

  useEffect(() => {
    setDueDate(defaultDueDate(year, month));
    setValidityDate(defaultValidityDate(year, month));
    setSession(deriveAcademicSession(year, month));
  }, [month, year]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingStudents(true);
      try {
        const rows = await dataService.getPaginated('students', {
          search: query.trim(),
          status: 'Active',
          limit: 20,
          page: 1,
        });
        if (!cancelled) setOptions(rows.data as StudentOpt[]);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoadingStudents(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    if (mode !== 'ledger' || !studentId) {
      setLedger(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLedgerLoading(true);
      try {
        const data = await dataService.fetchStudentFeeLedger(studentId);
        if (!cancelled) setLedger(data);
      } catch (err) {
        console.error(err);
        toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to load ledger');
        if (!cancelled) setLedger(null);
      } finally {
        if (!cancelled) setLedgerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, studentId]);

  const customTotal = useMemo(() => {
    const amount =
      custom.tuitionFee + custom.admissionFee + custom.securityFee + custom.examFee +
      custom.transportFee + custom.miscFee;
    return Math.max(0, amount + custom.arrears + custom.fineAmount - custom.discountAmount);
  }, [custom]);

  const createSingle = async () => {
    if (!studentId) return toast.error('Select a student');
    setSubmitting(true);
    try {
      await dataService.createSingleVoucher({
        studentId,
        month,
        year,
        dueDate,
        validityDate,
        session,
      });
      toast.success('Single voucher created');
      onCreated?.();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to create voucher');
    } finally {
      setSubmitting(false);
    }
  };

  const createCustom = async () => {
    if (!studentId) return toast.error('Select a student');
    if (customTotal <= 0) return toast.error('Total must be greater than zero');
    setSubmitting(true);
    try {
      await dataService.createCustomVoucher({
        studentId,
        month,
        year,
        dueDate,
        validityDate,
        ...custom,
      });
      toast.success('Custom voucher created');
      onCreated?.();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to create custom voucher');
    } finally {
      setSubmitting(false);
    }
  };

  const exportLedgerPdf = () => {
    if (!ledger?.student || !ledger.vouchers) return;
    const doc = new jsPDF();
    const s = ledger.student;
    doc.setFontSize(14);
    doc.text('Student Fee Ledger', 14, 16);
    doc.setFontSize(10);
    doc.text(`${s.firstName || ''} · ${formatRollNumberForDisplay(String(s.rollNumber || ''))}`, 14, 24);
    doc.text(`${s.campusName || ''} · Outstanding: Rs. ${Number(ledger.summary?.totalOutstanding || 0).toLocaleString()}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [['Month', 'Year', 'Type', 'Amount', 'Paid', 'Balance', 'Status']],
      body: ledger.vouchers.map((v) => [
        String(v.month ?? ''),
        String(v.year ?? ''),
        String(v.feeType ?? ''),
        Number(v.amount || 0).toLocaleString(),
        Number(v.paidAmount || 0).toLocaleString(),
        Number(v.balanceAmount || 0).toLocaleString(),
        String(v.status ?? ''),
      ]),
    });
    doc.save(`Fee_Ledger_${formatRollNumberForDisplay(String(s.rollNumber || 'student'))}.pdf`);
    toast.success('Ledger PDF downloaded');
  };

  const exportLedgerCsv = () => {
    if (!ledger?.vouchers) return;
    const header = 'Month,Year,Type,Amount,Paid,Balance,Status,DueDate\n';
    const rows = ledger.vouchers.map((v) =>
      [v.month, v.year, v.feeType, v.amount, v.paidAmount, v.balanceAmount, v.status, v.dueDate].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fee_Ledger_${formatRollNumberForDisplay(String(ledger.student?.rollNumber || 'student'))}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vibrant-card p-8 space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-4 bg-primary/10 rounded-3xl">
          {mode === 'ledger' ? <BookOpen className="w-7 h-7 text-primary" /> : <FileText className="w-7 h-7 text-primary" />}
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
            {mode === 'single' ? 'Single Voucher' : mode === 'custom' ? 'Customize Voucher' : 'Fee Ledger'}
          </h3>
          <p className="text-sm text-slate-500">
            {mode === 'single'
              ? 'Generate one monthly voucher from the campus fee structure.'
              : mode === 'custom'
                ? 'Build a per-student voucher with manual fee heads, arrears, discount, and fine.'
                : 'Search a student to view voucher and payment history.'}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Find student</label>
        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="vibrant-input pl-10"
            placeholder="Search by name, roll, or father name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SearchableSelect
          value={studentId}
          onChange={setStudentId}
          placeholder={loadingStudents ? 'Searching…' : 'Select student'}
          searchPlaceholder="Filter results…"
          options={options.map((s) => ({
            value: s.id,
            label: `${s.firstName} — ${formatRollNumberForDisplay(s.rollNumber)}${s.fatherName ? ` (${s.fatherName})` : ''}`,
          }))}
        />
        {selected && (
          <p className="mt-2 text-xs text-slate-500 flex items-center gap-2">
            <User className="w-3.5 h-3.5" />
            {selected.firstName} · {formatRollNumberForDisplay(selected.rollNumber)}
            {selected.campusName ? ` · ${selected.campusName}` : ''}
          </p>
        )}
      </div>

      {mode !== 'ledger' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Month</label>
            <SearchableSelect
              value={String(month)}
              onChange={(v) => setMonth(parseInt(v, 10))}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: String(i + 1),
                label: new Date(0, i).toLocaleString('default', { month: 'long' }),
              }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Year</label>
            <SearchableSelect
              value={String(year)}
              onChange={(v) => setYear(parseInt(v, 10))}
              options={Array.from({ length: 6 }, (_, i) => {
                const y = now.getFullYear() - 1 + i;
                return { value: String(y), label: String(y) };
              })}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Due date</label>
            <input type="date" className="vibrant-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Validity</label>
            <input type="date" className="vibrant-input" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
          </div>
        </div>
      )}

      {mode === 'single' && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Session</label>
            <input className="vibrant-input" value={session} onChange={(e) => setSession(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={submitting || !studentId}
            onClick={createSingle}
            className="vibrant-btn-primary px-8 py-3 disabled:opacity-50"
          >
            {submitting ? 'Generating…' : 'Generate voucher'}
          </button>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {([
              ['tuitionFee', 'Tuition'],
              ['admissionFee', 'Admission'],
              ['securityFee', 'Security'],
              ['examFee', 'Exam'],
              ['transportFee', 'Transport'],
              ['miscFee', 'Misc / Extra'],
              ['arrears', 'Arrears'],
              ['discountAmount', 'Discount'],
              ['fineAmount', 'Fine'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{label}</label>
                <input
                  type="number"
                  min={0}
                  className="vibrant-input"
                  value={custom[key]}
                  onChange={(e) => setCustom({ ...custom, [key]: Number(e.target.value) || 0 })}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Fee type</label>
              <SearchableSelect
                value={custom.feeType}
                onChange={(feeType) => setCustom({ ...custom, feeType })}
                options={['Monthly', 'Admission', 'Arrears', 'Fine'].map((t) => ({ value: t, label: t }))}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Description</label>
              <input
                className="vibrant-input"
                value={custom.description}
                onChange={(e) => setCustom({ ...custom, description: e.target.value })}
                placeholder="Optional label on voucher"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="text-sm font-black text-slate-700 dark:text-slate-200">
              Total due: Rs. {customTotal.toLocaleString()}
            </p>
            <button
              type="button"
              disabled={submitting || !studentId}
              onClick={createCustom}
              className="vibrant-btn-primary px-8 py-3 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create custom voucher'}
            </button>
          </div>
        </div>
      )}

      {mode === 'ledger' && (
        <div className="space-y-4">
          {ledgerLoading && <p className="text-sm text-slate-400">Loading ledger…</p>}
          {!ledgerLoading && !studentId && <p className="text-sm text-slate-400">Select a student to open their fee record.</p>}
          {ledger && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-black">{Number(ledger.summary?.voucherCount || 0)}</span> vouchers · Paid Rs.{' '}
                  <span className="font-black">{Number(ledger.summary?.totalPaid || 0).toLocaleString()}</span> · Outstanding Rs.{' '}
                  <span className="font-black text-danger">{Number(ledger.summary?.totalOutstanding || 0).toLocaleString()}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={exportLedgerPdf} className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4">
                    <Download className="w-4 h-4" /> PDF
                  </button>
                  <button type="button" onClick={exportLedgerCsv} className="vibrant-btn-secondary flex items-center gap-2 py-2 px-4">
                    <Download className="w-4 h-4" /> Excel/CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="px-4 py-3">Period</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(ledger.vouchers || []).map((v) => (
                      <tr key={String(v.id)}>
                        <td className="px-4 py-3">{String(v.month)}/{String(v.year)}</td>
                        <td className="px-4 py-3">{String(v.feeType)}</td>
                        <td className="px-4 py-3">{Number(v.amount || 0).toLocaleString()}</td>
                        <td className="px-4 py-3">{Number(v.paidAmount || 0).toLocaleString()}</td>
                        <td className="px-4 py-3">{Number(v.balanceAmount || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold">{String(v.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(ledger.transactions || []).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Transactions</h4>
                  <div className="space-y-2">
                    {(ledger.transactions || []).map((t) => (
                      <div key={String(t.id)} className="text-xs text-slate-600 dark:text-slate-300 flex justify-between gap-4 border-b border-slate-100 dark:border-slate-800 py-2">
                        <span>{String(t.transactionDate)} · {String(t.paymentMethod || '—')} · {String(t.transactionRef || '')}</span>
                        <span className="font-black">Rs. {Number(t.amount || 0).toLocaleString()} · {String(t.status)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
