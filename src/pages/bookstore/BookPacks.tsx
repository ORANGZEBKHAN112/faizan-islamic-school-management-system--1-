import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Campus, Class } from '../../types';
import { deriveAcademicSession } from '../../utils/academicSession';
import { apiError } from './courseShared';

type MasterItem = { title: string; publisher?: string | null; quantity: number; sharedStationery?: boolean | number };
type MasterRegion = { name: string; classes: Array<{ grade: string; items: MasterItem[] }> };

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
    bookstoreService.fetchCourseMaster().then((rows: MasterRegion[]) => {
      setMaster(rows || []);
      if (rows?.[0]) {
        setRegionName(rows[0].name);
        setGrade(rows[0].classes[0]?.grade || '');
      }
    }).catch(() => setMaster([]));
    void loadPacks();
  }, []);

  const [demand, setDemand] = useState<Record<string, unknown> | null>(null);
  const [master, setMaster] = useState<MasterRegion[]>([]);
  const [regionName, setRegionName] = useState('');
  const [grade, setGrade] = useState('');

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
      <div className="vibrant-card p-4 space-y-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Client course list</p>
          <p className="text-sm text-slate-500 mt-1">Titles, publisher, and quantity per student from the working file. Copies marked All Classes stay with the class above them, in the same order.</p>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <select className="vibrant-input" value={regionName} onChange={(e) => {
            const name = e.target.value;
            setRegionName(name);
            const next = master.find((r) => r.name === name);
            setGrade(next?.classes[0]?.grade || '');
          }}>
            {master.map((region) => <option key={region.name} value={region.name}>{region.name}</option>)}
          </select>
          <select className="vibrant-input" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {(master.find((r) => r.name === regionName)?.classes || []).map((cls) => (
              <option key={cls.grade} value={cls.grade}>{cls.grade} ({cls.items.length})</option>
            ))}
          </select>
          <select className="vibrant-input" value={form.campusId} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value }))}>
            <option value="">Campus for class sets</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.campusName}{c.region ? ` · ${c.region}` : ''}</option>)}
          </select>
          <button
            type="button"
            className="vibrant-btn-primary"
            onClick={() => {
              if (!form.campusId) {
                toast.error('Choose a campus');
                return;
              }
              void bookstoreService.applyCourseMaster({
                campusId: form.campusId,
                academicSession: form.academicSession,
                regionName,
              }).then(async (result) => {
                const skipped = [
                  ...(result.missingGrades || []).map((g: string) => `${g} has no matching class`),
                  ...(result.unmatchedClasses || []).map((g: string) => `${g} name did not match`),
                ];
                toast.success(`${result.packs} class sets saved for ${result.campusName}`);
                if (skipped.length) toast.warning(skipped.slice(0, 4).join(' · '));
                await loadPacks();
              }).catch((err) => toast.error(apiError(err, 'Could not apply course list')));
            }}
          >
            Apply to campus
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400">
            <tr>
              <th className="text-start py-2">#</th>
              <th className="text-start">Title</th>
              <th className="text-start">Publisher</th>
              <th className="text-end">Each student</th>
            </tr>
          </thead>
          <tbody>
            {(master.find((r) => r.name === regionName)?.classes.find((c) => c.grade === grade)?.items || []).map((item, index) => (
              <tr key={`${item.title}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 text-slate-400">{index + 1}</td>
                <td className="font-semibold">{item.title}</td>
                <td>{item.publisher || '—'}</td>
                <td className="text-end">{item.quantity} Piece{item.sharedStationery ? ' · copy' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
        <button type="button" className="vibrant-btn-primary" onClick={() => void create()}>Create pack</button>
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
                  <th className="text-start py-2">Book</th>
                  <th className="text-end py-2">Required</th>
                  <th className="text-end py-2">Available</th>
                  <th className="text-end py-2">Shortage</th>
                </tr>
              </thead>
              <tbody>
                {(demand.books as Array<Record<string, unknown>>).map((b) => (
                  <tr key={String(b.bookId)} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2">{String(b.title)}</td>
                    <td className="text-end">{Number(b.requiredQuantity)}</td>
                    <td className="text-end">{Number(b.availableStock)}</td>
                    <td className={`text-end font-bold ${Number(b.shortage) > 0 ? 'text-danger' : 'text-success'}`}>
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
