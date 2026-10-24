import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Campus, Class } from '../../types';
import { deriveAcademicSession } from '../../utils/academicSession';

export default function BookPacks() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [packs, setPacks] = useState<Array<Record<string, unknown>>>([]);
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [form, setForm] = useState({
    campusId: '',
    classId: '',
    academicSession: deriveAcademicSession(new Date().getFullYear(), new Date().getMonth() + 1),
    name: '',
    bookId: '',
    quantity: 1,
  });

  useEffect(() => {
    dataService.getAll('campuses').then(setCampuses);
    dataService.getAll('classes').then(setClasses);
    bookstoreService.fetchBooks({ limit: 200 }).then((r) => setBooks(r.data || []));
    void loadPacks();
  }, []);

  const [demand, setDemand] = useState<Record<string, unknown> | null>(null);

  const loadPacks = async () => {
    try {
      const list = await bookstoreService.fetchPacks();
      setPacks(list);
    } catch {
      toast.error('Failed to load packs');
    }
  };

  const loadDemand = async (packId: string, campusId: string, classId: string, academicSession: string) => {
    try {
      const data = await bookstoreService.fetchDemand({ campusId, classId, academicSession, packId });
      setDemand(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Demand calculation failed');
    }
  };

  const create = async () => {
    if (!form.campusId || !form.classId || !form.name || !form.bookId) {
      toast.error('Campus, class, pack name, and at least one book required');
      return;
    }
    try {
      await bookstoreService.createPack({
        campusId: form.campusId,
        classId: form.classId,
        academicSession: form.academicSession,
        name: form.name,
        items: [{ bookId: form.bookId, quantity: form.quantity }],
      });
      toast.success('Pack created');
      await loadPacks();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create pack');
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-6 grid md:grid-cols-3 gap-4">
        <select className="vibrant-input" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value }))}>
          <option value="">Campus</option>
          {campuses.map((c) => (
            <option key={c.id} value={c.id}>{c.campusName}</option>
          ))}
        </select>
        <select className="vibrant-input" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
          <option value="">Class</option>
          {classes.filter((cl) => !form.campusId || cl.campusId === form.campusId).map((cl) => (
            <option key={cl.id} value={cl.id}>{cl.className}</option>
          ))}
        </select>
        <input className="vibrant-input" value={form.academicSession} onChange={(e) => setForm((f) => ({ ...f, academicSession: e.target.value }))} placeholder="Session" />
        <input className="vibrant-input md:col-span-2" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pack name" />
        <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
          <option value="">Book</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
        <button type="button" className="vibrant-btn" onClick={() => void create()}>Create pack</button>
      </div>

      <div className="vibrant-card divide-y divide-slate-100 dark:divide-slate-800">
        {packs.map((p) => (
          <div key={String(p.id)} className="p-4 flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-black">{String(p.name)}</p>
              <p className="text-xs text-slate-500">{String(p.campusName)} · {String(p.className)} · {String(p.academic_session)}</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="text-[10px] font-black uppercase text-primary"
                onClick={() =>
                  void loadDemand(
                    String(p.id),
                    String(p.campus_id),
                    String(p.class_id),
                    String(p.academic_session),
                  )
                }
              >
                Demand
              </button>
              <button
                type="button"
                className="text-[10px] font-black uppercase text-primary"
                onClick={async () => {
                  const session = prompt('New academic session label');
                  if (!session) return;
                  try {
                    await bookstoreService.copyPack(String(p.id), session);
                    toast.success('Pack copied');
                    await loadPacks();
                  } catch {
                    toast.error('Copy failed');
                  }
                }}
              >
                Copy to session
              </button>
            </div>
          </div>
        ))}
        {packs.length === 0 && <p className="p-8 text-center text-slate-400">No class packs yet</p>}
      </div>

      {demand && (
        <div className="vibrant-card p-4 space-y-3">
          <p className="text-[10px] font-black uppercase text-slate-400">
            Enrollment demand · {Number(demand.activeEnrollment)} active students
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="text-left py-2">Book</th>
                  <th className="text-right py-2">Required</th>
                  <th className="text-right py-2">Available</th>
                  <th className="text-right py-2">Shortage</th>
                </tr>
              </thead>
              <tbody>
                {(demand.books as Array<Record<string, unknown>>).map((b) => (
                  <tr key={String(b.bookId)} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2">{String(b.title)}</td>
                    <td className="text-right">{Number(b.requiredQuantity)}</td>
                    <td className="text-right">{Number(b.availableStock)}</td>
                    <td className={`text-right font-bold ${Number(b.shortage) > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {Number(b.shortage)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Use Stock → Transfers to allocate from central warehouse before peak sales.</p>
        </div>
      )}
    </div>
  );
}
