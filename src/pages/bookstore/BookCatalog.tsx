import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { PermissionGate } from '../../context/PermissionContext';
import PageLoader from '../../components/ui/PageLoader';

type BookRow = {
  id: string;
  title: string;
  isbn?: string;
  publisher?: string;
  isActive: boolean;
};

export default function BookCatalog() {
  const [rows, setRows] = useState<BookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ title: '', isbn: '', publisher: '', sellingPrice: 0, academicSession: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookstoreService.fetchBooks({ search, limit: 100 });
      setRows(res.data || []);
    } catch {
      toast.error('Failed to load books');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sessionFilter || rows.length === 0) {
      setPriceMap({});
      return;
    }
    bookstoreService
      .fetchPrices(sessionFilter, rows.map((r) => r.id))
      .then((list: Array<{ bookId: string; sellingPrice: number }>) => {
        const m: Record<string, number> = {};
        list.forEach((p) => {
          m[p.bookId] = p.sellingPrice;
        });
        setPriceMap(m);
      })
      .catch(() => setPriceMap({}));
  }, [sessionFilter, rows]);

  const create = async () => {
    if (!form.title.trim()) {
      toast.error('Title required');
      return;
    }
    try {
      const session = form.academicSession.trim();
      if (session && !/^\d{4}-\d{4}$/.test(session)) {
        toast.error('Session must be YYYY-YYYY (e.g. 2025-2026)');
        return;
      }
      const created = await bookstoreService.createBook({
        title: form.title,
        isbn: form.isbn || null,
        publisher: form.publisher || null,
      });
      const bookId = (created as { id?: string })?.id;
      if (session && form.sellingPrice > 0 && bookId) {
        await bookstoreService.saveBookPrice({
          bookId,
          academicSession: session,
          sellingPrice: form.sellingPrice,
          purchaseCost: 0,
        });
      }
      toast.success('Book saved');
      setForm({ title: '', isbn: '', publisher: '', sellingPrice: 0, academicSession: '' });
      await load();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; code?: string } } })?.response?.data;
      toast.error(data?.message || 'Could not save book');
    }
  };

  if (loading && rows.length === 0) return <PageLoader label="Loading catalog…" />;

  return (
    <div className="space-y-6">
      <PermissionGate module="bookstore" action="create">
        <div className="vibrant-card p-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <input className="vibrant-input" placeholder="Title *" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <input className="vibrant-input" placeholder="ISBN" value={form.isbn} onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))} />
          <input className="vibrant-input" placeholder="Publisher" value={form.publisher} onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))} />
          <input
            className="vibrant-input"
            placeholder="Session YYYY-YYYY (optional)"
            value={form.academicSession}
            onChange={(e) => setForm((f) => ({ ...f, academicSession: e.target.value }))}
          />
          <input
            type="number"
            min={0}
            className="vibrant-input"
            placeholder="Selling price (optional)"
            value={form.sellingPrice || ''}
            onChange={(e) => setForm((f) => ({ ...f, sellingPrice: Number(e.target.value) || 0 }))}
          />
          <button type="button" onClick={() => void create()} className="vibrant-btn flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add book
          </button>
        </div>
      </PermissionGate>

      <div className="flex flex-wrap gap-3">
        <input
          className="vibrant-input max-w-md"
          placeholder="Search title, ISBN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          className="vibrant-input max-w-xs"
          placeholder="Session for prices e.g. 2025-2026"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value.trim())}
        />
      </div>

      <div className="vibrant-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">ISBN</th>
              <th className="px-4 py-3 text-left">Publisher</th>
              <th className="px-4 py-3 text-left">Session price</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 font-semibold">{b.title}</td>
                <td className="px-4 py-3">{b.isbn || '—'}</td>
                <td className="px-4 py-3">{b.publisher || '—'}</td>
                <td className="px-4 py-3">
                  {sessionFilter
                    ? priceMap[b.id] != null
                      ? `Rs. ${priceMap[b.id]}`
                      : '—'
                    : '—'}
                </td>
                <td className="px-4 py-3">{b.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No books in catalog yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
