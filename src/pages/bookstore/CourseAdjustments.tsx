import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Campus, Class } from '../../types';
import { apiError } from './courseShared';

type Book = { id: string; title: string };
type Adjustment = {
  id: string;
  adjustment_no: string;
  campusName?: string;
  className?: string;
  title?: string;
  adj_type: string;
  quantity: number;
  reason: string;
  status: string;
  requested_by?: string;
  requestedByName?: string;
  approvedByName?: string;
  approved_by?: string;
};

export default function CourseAdjustments() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [form, setForm] = useState({
    campusId: '',
    classId: '',
    bookId: '',
    adjType: 'damage' as 'damage' | 'adjustment' | 'return_warehouse',
    quantity: 1,
    reason: '',
  });

  const load = async () => setRows(await bookstoreService.fetchAdjustments());

  useEffect(() => {
    dataService.fetchCampuses().then(setCampuses).catch(() => undefined);
    dataService.fetchClasses().then(setClasses).catch(() => undefined);
    bookstoreService.fetchBooks({ limit: 400 }).then((r) => setBooks(r.data || [])).catch(() => undefined);
    void load().catch(() => undefined);
  }, []);

  const classOptions = useMemo(
    () => classes.filter((c) => !form.campusId || c.campusId === form.campusId),
    [classes, form.campusId]
  );

  const save = async () => {
    try {
      const created = await bookstoreService.createAdjustment(form);
      toast.success(`${created.adjustmentNo} waiting for approval`);
      setForm((f) => ({ ...f, reason: '' }));
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not save adjustment'));
    }
  };

  const approve = async (id: string) => {
    try {
      await bookstoreService.approveAdjustment(id);
      toast.success('Approved and stock updated');
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Approval failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-4 grid md:grid-cols-3 gap-3">
        <select className="vibrant-input" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value, classId: '' }))}>
          <option value="">Campus</option>
          {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
        </select>
        <select className="vibrant-input" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
          <option value="">Class</option>
          {classOptions.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}
        </select>
        <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
          <option value="">Title</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <select className="vibrant-input" value={form.adjType} onChange={(e) => setForm((f) => ({ ...f, adjType: e.target.value as typeof form.adjType }))}>
          <option value="damage">Damage</option>
          <option value="return_warehouse">Return campus to warehouse</option>
          <option value="adjustment">Adjustment (+ add / − remove)</option>
        </select>
        <input type="number" className="vibrant-input" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
        <input className="vibrant-input" placeholder="Authentic reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        <button type="button" className="vibrant-btn-primary" onClick={() => void save()}>Submit for approval</button>
      </div>
      <p className="text-sm text-slate-500">Damage, warehouse return, and manual adjustment stay pending until another authorized user approves them. Every approval is kept with the user, date, quantity, and reason.</p>
      <div className="vibrant-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400">
            <tr>
              <th className="p-3 text-start">No.</th>
              <th className="p-3 text-start">Campus / class / title</th>
              <th className="p-3 text-start">Type</th>
              <th className="p-3 text-end">Qty</th>
              <th className="p-3 text-start">Reason</th>
              <th className="p-3 text-start">Audit</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-3 font-bold">{row.adjustment_no}</td>
                <td className="p-3">{row.campusName} · {row.className} · {row.title}</td>
                <td className="p-3">{row.adj_type}</td>
                <td className="p-3 text-end">{row.quantity}</td>
                <td className="p-3">{row.reason}</td>
                <td className="p-3 text-xs text-slate-500">{row.status} · by {row.requestedByName || row.requested_by || '—'} · approved {row.approvedByName || row.approved_by || '—'}</td>
                <td className="p-3 text-end">
                  {row.status === 'pending' && (
                    <button type="button" className="vibrant-btn-primary" onClick={() => void approve(row.id)}>Approve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
