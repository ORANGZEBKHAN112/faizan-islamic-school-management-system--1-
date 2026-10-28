import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Class } from '../../types';
import { apiError } from './courseShared';

type TransferItem = {
  id: string;
  title?: string;
  qty_requested: number;
  qty_dispatched: number;
  qty_received: number;
};

type Transfer = {
  id: string;
  fromStoreName?: string;
  toStoreName?: string;
  sourceCampus?: string;
  receivingCampus?: string;
  status: string;
  reason?: string;
  items?: TransferItem[];
};

export default function BookTransfers() {
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ fromStoreId: '', toStoreId: '', bookId: '', classId: '', qty: 1, reason: '' });

  const reload = async () => {
    const rows = await bookstoreService.fetchTransfers() as Transfer[];
    setTransfers(rows);
    const next: Record<string, number> = {};
    for (const row of rows) {
      for (const item of row.items || []) next[item.id] = Number(item.qty_dispatched || item.qty_requested);
    }
    setReceived(next);
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
    dataService.fetchClasses().then(setClasses).catch(() => undefined);
    void reload();
  }, []);

  const create = async () => {
    try {
      await bookstoreService.createTransfer({
        fromStoreId: form.fromStoreId,
        toStoreId: form.toStoreId,
        reason: form.reason,
        items: [{ bookId: form.bookId, classId: form.classId || null, qtyRequested: form.qty }],
      });
      toast.success('Shuffling request saved');
      await reload();
    } catch (err: unknown) {
      toast.error(apiError(err, 'Failed'));
    }
  };

  const advance = async (row: Transfer, status: string) => {
    try {
      const items = status === 'received'
        ? (row.items || []).map((item) => ({ itemId: item.id, qtyReceived: Number(received[item.id] ?? item.qty_dispatched) }))
        : undefined;
      await bookstoreService.updateTransferStatus(row.id, status, items);
      toast.success(`Transfer ${status}`);
      await reload();
    } catch (err: unknown) {
      toast.error(apiError(err, 'Status update failed'));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">Request, approval, dispatch, then receiving. Source stock leaves on dispatch. The receiving campus gets only the quantity that arrives, and the shortfall stays visible as a difference.</p>
      <div className="vibrant-card p-4 grid md:grid-cols-3 gap-3">
        <select className="vibrant-input" value={form.fromStoreId} onChange={(e) => setForm((f) => ({ ...f, fromStoreId: e.target.value }))}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="vibrant-input" value={form.toStoreId} onChange={(e) => setForm((f) => ({ ...f, toStoreId: e.target.value }))}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="vibrant-input" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
          <option value="">Class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}
        </select>
        <select className="vibrant-input" value={form.bookId} onChange={(e) => setForm((f) => ({ ...f, bookId: e.target.value }))}>
          <option value="">Title</option>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <input type="number" className="vibrant-input" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} />
        <input className="vibrant-input" placeholder="Reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        <button type="button" className="vibrant-btn-primary" onClick={() => void create()}>Request shuffle</button>
      </div>

      <div className="space-y-3">
        {transfers.map((t) => (
          <div key={t.id} className="vibrant-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold text-sm">{t.sourceCampus || t.fromStoreName} → {t.receivingCampus || t.toStoreName}</p>
                <p className="text-[10px] uppercase font-black text-slate-400">{t.status}{t.reason ? ` · ${t.reason}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.status === 'draft' && <button type="button" className="vibrant-btn-secondary" onClick={() => void advance(t, 'submitted')}>Submit</button>}
                {t.status === 'submitted' && <button type="button" className="vibrant-btn-secondary" onClick={() => void advance(t, 'approved')}>Approve</button>}
                {t.status === 'approved' && <button type="button" className="vibrant-btn-secondary" onClick={() => void advance(t, 'dispatched')}>Dispatch</button>}
                {t.status === 'dispatched' && <button type="button" className="vibrant-btn-primary" onClick={() => void advance(t, 'received')}>Receive</button>}
              </div>
            </div>
            {(t.items || []).map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-semibold">{item.title}</span>
                <span>Requested {item.qty_requested} · Dispatched {item.qty_dispatched || 0}</span>
                {t.status === 'dispatched' ? (
                  <input
                    type="number"
                    min={0}
                    className="vibrant-input w-24"
                    value={received[item.id] ?? item.qty_dispatched}
                    onChange={(e) => setReceived((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                  />
                ) : (
                  <span>Received {item.qty_received || 0} · Diff {Number(item.qty_dispatched || 0) - Number(item.qty_received || 0)}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
