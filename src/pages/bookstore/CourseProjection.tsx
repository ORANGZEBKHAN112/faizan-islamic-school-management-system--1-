import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Campus, Class } from '../../types';
import { apiError, currentAcademicSession } from './courseShared';

type Book = { id: string; title: string };
type Projection = {
  id: string;
  region?: string;
  campusName?: string;
  className?: string;
  title?: string;
  quantity: number;
  academic_session: string;
};

export default function CourseProjection() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [rows, setRows] = useState<Projection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState({
    academicSession: currentAcademicSession(),
    campusId: '',
    classId: '',
    bookId: '',
    quantity: 1,
    notes: '',
  });

  const load = async (session = form.academicSession) => {
    setRows(await bookstoreService.fetchProjections({ academicSession: session }));
  };

  useEffect(() => {
    dataService.fetchCampuses().then(setCampuses).catch(() => setCampuses([]));
    dataService.fetchClasses().then(setClasses).catch(() => setClasses([]));
    bookstoreService.fetchBooks({ limit: 400 }).then((r) => setBooks(r.data || [])).catch(() => setBooks([]));
    void load(currentAcademicSession());
  }, []);

  const classOptions = useMemo(
    () => classes.filter((c) => !form.campusId || c.campusId === form.campusId),
    [classes, form.campusId]
  );

  const save = async () => {
    try {
      await bookstoreService.saveProjection(form);
      toast.success('Projection saved');
      setSelected([]);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not save projection'));
    }
  };

  const makeOrder = async () => {
    if (selected.length === 0) {
      toast.error('Select projection lines first');
      return;
    }
    try {
      const order = await bookstoreService.createCourseOrder(selected);
      toast.success(`Purchase order ${order.orderNo} created`);
      setSelected([]);
    } catch (err) {
      toast.error(apiError(err, 'Could not create purchase order'));
    }
  };

  const toggle = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-4 grid md:grid-cols-6 gap-3 items-end">
        <input className="vibrant-input" value={form.academicSession} onChange={(e) => setForm((f) => ({ ...f, academicSession: e.target.value }))} placeholder="2026-2027" />
        <select className="vibrant-input" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value, classId: '' }))}>
          <option value="">Campus</option>
          {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}</option>)}
        </select>
        <select className="vibrant-input" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
          <option value="">Class</option>
          {classOptions.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}
        </select>
        <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
          <option value="">Course / title</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input type="number" min={1} className="vibrant-input" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
        <button type="button" className="vibrant-btn-primary" onClick={() => void save()}>Save projection</button>
      </div>

      <div className="flex justify-between items-center gap-3">
        <p className="text-sm text-slate-500">Campus-wise and class-wise requirement. Titles stay in the same order on every later document.</p>
        <button type="button" className="vibrant-btn-secondary" onClick={() => void makeOrder()}>Create purchase order</button>
      </div>

      <div className="vibrant-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-slate-400">
            <tr>
              <th className="p-3 text-start" />
              <th className="p-3 text-start">Region</th>
              <th className="p-3 text-start">Campus</th>
              <th className="p-3 text-start">Class</th>
              <th className="p-3 text-start">Title</th>
              <th className="p-3 text-end">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></td>
                <td className="p-3">{row.region || '—'}</td>
                <td className="p-3">{row.campusName}</td>
                <td className="p-3">{row.className}</td>
                <td className="p-3 font-semibold">{row.title}</td>
                <td className="p-3 text-end">{row.quantity}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-slate-400" colSpan={6}>No projection for this session yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
