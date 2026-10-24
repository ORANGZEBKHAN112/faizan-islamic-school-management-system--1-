import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';

export default function BookTransfers() {
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [transfers, setTransfers] = useState<Array<Record<string, unknown>>>([]);
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [form, setForm] = useState({ fromStoreId: '', toStoreId: '', bookId: '', qty: 1 });

  const reload = async () => {
    setTransfers(await bookstoreService.fetchTransfers());
  };

  useEffect(() => {
    bookstoreService.fetchStores().then((s) => {
      setStores(s);
      const central = s.find((x: { storeType: string }) => x.storeType === 'central');
      const campus = s.find((x: { storeType: string }) => x.storeType === 'campus');
      setForm((f) => ({
        ...f,
        fromStoreId: central?.id || s[0]?.id || '',
        toStoreId: campus?.id || s[1]?.id || '',
      }));
    });
    bookstoreService.fetchBooks({ limit: 200 }).then((r) => setBooks(r.data || []));
    void reload();
  }, []);

  const create = async () => {
    try {
      await bookstoreService.createTransfer({
        fromStoreId: form.fromStoreId,
        toStoreId: form.toStoreId,
        items: [{ bookId: form.bookId, qtyRequested: form.qty }],
      });
      toast.success('Transfer draft created');
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed');
    }
  };

  const advance = async (id: string, status: string) => {
    try {
      await bookstoreService.updateTransferStatus(id, status);
      toast.success(`Transfer ${status}`);
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Status update failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-4 grid md:grid-cols-5 gap-3">
        <select className="vibrant-input" value={form.fromStoreId} onChange={(e) => setForm((f) => ({ ...f, fromStoreId: e.target.value }))}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="vibrant-input" value={form.toStoreId} onChange={(e) => setForm((f) => ({ ...f, toStoreId: e.target.value }))}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
          <option value="">Book</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input type="number" className="vibrant-input" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} />
        <button type="button" className="vibrant-btn" onClick={() => void create()}>New transfer</button>
      </div>

      <div className="vibrant-card divide-y divide-slate-100 dark:divide-slate-800">
        {transfers.map((t) => (
          <div key={String(t.id)} className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">{String(t.fromStoreName)} → {String(t.toStoreName)}</p>
              <p className="text-[10px] uppercase font-black text-slate-400">{String(t.status)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.status === 'draft' && (
                <button type="button" className="text-xs font-black uppercase text-primary" onClick={() => void advance(String(t.id), 'submitted')}>Submit</button>
              )}
              {t.status === 'submitted' && (
                <button type="button" className="text-xs font-black uppercase text-primary" onClick={() => void advance(String(t.id), 'approved')}>Approve</button>
              )}
              {t.status === 'approved' && (
                <button type="button" className="text-xs font-black uppercase text-primary" onClick={() => void advance(String(t.id), 'dispatched')}>Dispatch</button>
              )}
              {t.status === 'dispatched' && (
                <button type="button" className="text-xs font-black uppercase text-primary" onClick={() => void advance(String(t.id), 'received')}>Receive</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
