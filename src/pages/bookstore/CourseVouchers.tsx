import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Campus, Class, Student } from '../../types';
import { apiError, currentAcademicSession, money } from './courseShared';
import { useI18n } from '../../context/I18nContext';

type Book = { id: string; title: string };
type Pack = { id: string; name: string; campus_id?: string; class_id?: string; campusId?: string; classId?: string };
type VoucherItem = { title?: string; quantity: number; unit_price: number; line_total: number };
type Voucher = {
  id: string;
  voucher_no: string;
  kind: string;
  mode: string;
  studentName?: string;
  admissionNo?: string;
  className?: string;
  campusName?: string;
  total: number;
  paid_amount: number;
  payment_status: string;
  issue_status: string;
  due_date?: string;
  stock_alert?: string | null;
  kuickpay_consumer_number?: string | null;
  kuickpayCharge?: number;
  studentCourseStatus?: string | null;
  items: VoucherItem[];
};

export default function CourseVouchers() {
  const { t } = useI18n();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    kind: 'individual' as 'bulk' | 'individual' | 'existing',
    mode: 'full' as 'full' | 'custom',
    campusId: '',
    classId: '',
    academicSession: currentAcademicSession(),
    studentId: '',
    packId: '',
    dueDate: '',
    bookId: '',
    quantity: 1,
  });
  const [custom, setCustom] = useState<Array<{ bookId: string; title: string; quantity: number }>>([]);
  const [pay, setPay] = useState<{ id: string; amount: number; method: string; transactionRef: string } | null>(null);

  const load = async () => setVouchers(await bookstoreService.fetchCourseVouchers());

  useEffect(() => {
    dataService.fetchCampuses().then(setCampuses).catch(() => undefined);
    dataService.fetchClasses().then(setClasses).catch(() => undefined);
    bookstoreService.fetchBooks({ limit: 400 }).then((r) => setBooks(r.data || [])).catch(() => undefined);
    bookstoreService.fetchPacks().then((rows) => setPacks(Array.isArray(rows) ? rows : [])).catch(() => undefined);
    void load().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (form.kind === 'bulk' || search.trim().length < 2) {
      setStudents([]);
      return;
    }
    const timer = setTimeout(() => {
      const params: { search: string; limit: number; page: number; status?: string } = { search, limit: 8, page: 1 };
      if (form.kind === 'existing') params.status = 'Active';
      dataService.getPaginated('students', params).then((r) => setStudents(r.data as Student[]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, form.kind]);

  const classOptions = useMemo(
    () => classes.filter((c) => !form.campusId || c.campusId === form.campusId),
    [classes, form.campusId]
  );
  const packOptions = packs.filter((p) => {
    const campusId = p.campusId || p.campus_id;
    const classId = p.classId || p.class_id;
    return (!form.campusId || campusId === form.campusId) && (!form.classId || classId === form.classId);
  });

  const create = async () => {
    try {
      const result = await bookstoreService.createCourseVoucher({
        ...form,
        packId: form.mode === 'full' ? form.packId : null,
        studentId: form.kind === 'bulk' ? undefined : form.studentId,
        items: form.mode === 'custom' ? custom.map((line) => ({ bookId: line.bookId, quantity: line.quantity })) : undefined,
      });
      toast.success(`${result.count} voucher(s) created`);
      if (result.stockAlert) toast.warning(result.stockAlert);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not create voucher'));
    }
  };

  const submitPay = async () => {
    if (!pay) return;
    try {
      await bookstoreService.payCourseVoucher(pay.id, {
        amount: pay.amount,
        method: pay.method,
        transactionRef: pay.transactionRef || undefined,
      });
      toast.success('Payment recorded');
      setPay(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Payment failed'));
    }
  };

  const issue = async (id: string) => {
    try {
      await bookstoreService.issueCourseVoucher(id);
      toast.success('Course issued and stock deducted for voucher titles only');
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Issue failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['bulk', 'individual', 'existing'] as const).map((kind) => (
            <button key={kind} type="button" className={form.kind === kind ? 'vibrant-btn-primary' : 'vibrant-btn-secondary'} onClick={() => setForm((f) => ({ ...f, kind }))}>
              {kind === 'bulk' ? 'Bulk admission' : kind === 'individual' ? 'Individual student' : 'Existing student'}
            </button>
          ))}
          <button type="button" className={form.mode === 'full' ? 'vibrant-btn-primary' : 'vibrant-btn-secondary'} onClick={() => setForm((f) => ({ ...f, mode: 'full' }))}>Full course</button>
          <button type="button" className={form.mode === 'custom' ? 'vibrant-btn-primary' : 'vibrant-btn-secondary'} onClick={() => setForm((f) => ({ ...f, mode: 'custom' }))}>Customize</button>
        </div>
        <p className="text-xs text-slate-500">
          {form.kind === 'bulk'
            ? 'Bulk admission creates one voucher for every enrolled admission in this class that does not already have an open course voucher.'
            : form.mode === 'full'
            ? 'Full course issues every title in the class pack, in the client course-list order.'
            : 'Customize issues only the titles on this voucher, so a partial set cannot be treated as a full course.'}
        </p>
        <div className="grid md:grid-cols-4 gap-3">
          <input className="vibrant-input" value={form.academicSession} onChange={(e) => setForm((f) => ({ ...f, academicSession: e.target.value }))} />
          <select className="vibrant-input" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value, classId: '' }))}>
            <option value="">Campus</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
          </select>
          <select className="vibrant-input" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
            <option value="">Class</option>
            {classOptions.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}
          </select>
          <input type="date" className="vibrant-input" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
        </div>
        {form.mode === 'full' && (
          <select className="vibrant-input" value={form.packId} onChange={(e) => setForm((f) => ({ ...f, packId: e.target.value }))}>
            <option value="">Class course pack</option>
            {packOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {form.mode === 'custom' && (
          <div className="flex flex-wrap gap-2 items-end">
            <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
              <option value="">Title</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <input type="number" min={1} className="vibrant-input w-24" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
            <button
              type="button"
              className="vibrant-btn-secondary"
              onClick={() => {
                const book = books.find((b) => b.id === form.bookId);
                if (!book) return;
                setCustom((lines) => [...lines.filter((l) => l.bookId !== book.id), { bookId: book.id, title: book.title, quantity: form.quantity }]);
              }}
            >
              Add title
            </button>
            <p className="text-sm">{custom.map((l) => `${l.title} × ${l.quantity}`).join(', ') || 'No custom titles yet'}</p>
          </div>
        )}
        {form.kind !== 'bulk' && (
          <div>
            <input className="vibrant-input" placeholder="Search student name or admission number" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              {students.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={form.studentId === s.id ? 'vibrant-btn-primary' : 'vibrant-btn-secondary'}
                  onClick={() => setForm((f) => ({ ...f, studentId: s.id, campusId: s.campusId, classId: s.classId }))}
                >
                  {s.firstName} {s.lastName} · {s.rollNumber}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="vibrant-btn-primary" onClick={() => void create()}>Generate voucher</button>
      </div>

      <div className="space-y-3">
        {vouchers.map((voucher) => (
          <div key={voucher.id} className="vibrant-card p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-black">{voucher.voucher_no} · {voucher.studentName}</p>
                <p className="text-xs text-slate-500">
                  Admission {voucher.admissionNo || '—'} · {voucher.className} · {voucher.campusName} · {voucher.kind} · {voucher.mode === 'full' ? 'Full course' : 'Customize'}
                </p>
                <p className="text-xs text-slate-500">Due {voucher.due_date ? String(voucher.due_date).slice(0, 10) : '—'} · {voucher.payment_status} · {voucher.issue_status === 'issued' ? 'Course issued' : 'Not issued'}{voucher.studentCourseStatus === 'issued' ? ' · student status updated' : ''}</p>
                {voucher.kuickpay_consumer_number && (
                  <p className="text-xs font-bold text-primary mt-1">
                    KuickPay ID {voucher.kuickpay_consumer_number}
                    {voucher.payment_status !== 'paid' && (
                      <>
                        {' · bank collects '}
                        {money(Math.max(0, Number(voucher.total) - Number(voucher.paid_amount)) + Number(voucher.kuickpayCharge || 0))}
                      </>
                    )}
                  </p>
                )}
                {voucher.stock_alert && <p className="text-xs text-amber-600 mt-1">{voucher.stock_alert}</p>}
              </div>
              <div className="text-end">
                <p className="font-black text-primary">{money(voucher.total)}</p>
                <p className="text-[10px] uppercase text-slate-400">Paid {money(voucher.paid_amount)}</p>
              </div>
            </div>
            <p className="text-sm">{voucher.items.map((item) => `${item.title} × ${item.quantity}`).join(' · ')}</p>
            <div className="flex flex-wrap gap-2">
              {voucher.payment_status !== 'paid' && voucher.issue_status !== 'issued' && (
                <button
                  type="button"
                  className="vibrant-btn-secondary"
                  onClick={() => setPay({
                    id: voucher.id,
                    amount: Number(voucher.total) - Number(voucher.paid_amount),
                    method: 'KuickPay',
                    transactionRef: '',
                  })}
                >
                  Record payment
                </button>
              )}
              {voucher.payment_status === 'paid' && voucher.issue_status !== 'issued' && (
                <button type="button" className="vibrant-btn-primary" onClick={() => void issue(voucher.id)}>
                  Issue course ({voucher.mode === 'full' ? 'full course' : 'customize'})
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pay && (
        <div className="vibrant-card p-4 grid md:grid-cols-4 gap-3 items-end">
          <input type="number" className="vibrant-input" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} />
          <select className="vibrant-input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            <option value="KuickPay">KuickPay</option>
            <option value="Cash">Cash</option>
            <option value="Bank">Bank</option>
          </select>
          <input className="vibrant-input" placeholder="KuickPay / transaction reference" value={pay.transactionRef} onChange={(e) => setPay({ ...pay, transactionRef: e.target.value })} />
          <div className="flex gap-2">
            <button type="button" className="vibrant-btn-primary" onClick={() => void submitPay()}>Save payment</button>
            <button type="button" className="vibrant-btn-secondary" onClick={() => setPay(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
