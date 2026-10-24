import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';

export default function BookStock() {
  const [stores, setStores] = useState<Array<{ id: string; name: string; storeType: string }>>([]);
  const [storeId, setStoreId] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [opening, setOpening] = useState({ bookId: '', quantity: 0, unitCost: 0 });

  useEffect(() => {
    bookstoreService.fetchStores().then((s) => {
      setStores(s);
      if (s[0]) setStoreId(s[0].id);
    });
    bookstoreService.fetchBooks({ limit: 300 }).then((r) => setBooks(r.data || []));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    bookstoreService.fetchInventory(storeId).then(setRows).catch(() => setRows([]));
  }, [storeId]);

  const postOpening = async () => {
    if (!storeId || !opening.bookId || opening.quantity <= 0) {
      toast.error('Store, book, and quantity required');
      return;
    }
    try {
      await bookstoreService.postOpeningStock({
        storeId,
        bookId: opening.bookId,
        quantity: opening.quantity,
        unitCost: opening.unitCost,
        reason: 'Opening stock entry',
      });
      toast.success('Opening stock posted');
      setRows(await bookstoreService.fetchInventory(storeId));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Post failed');
    }
  };

  const quickGrn = async () => {
    if (!opening.bookId || opening.quantity <= 0) {
      toast.error('Select book and quantity');
      return;
    }
    const central = stores.find((s) => s.storeType === 'central')?.id || storeId;
    try {
      const grn = await bookstoreService.createGrn({
        storeId: central,
        items: [{ bookId: opening.bookId, qtyReceived: opening.quantity, unitCost: opening.unitCost }],
      });
      await bookstoreService.postGrn(grn.id, `grn-${grn.id}`);
      toast.success('GRN posted to central store');
      if (storeId) setRows(await bookstoreService.fetchInventory(storeId));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'GRN failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Store</label>
          <select className="vibrant-input mt-1" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <select className="vibrant-input" value={opening.bookId} onChange={(e) => setOpening((o) => ({ ...o, bookId: e.target.value }))}>
          <option value="">Book</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
        <input type="number" className="vibrant-input w-28" placeholder="Qty" value={opening.quantity || ''} onChange={(e) => setOpening((o) => ({ ...o, quantity: Number(e.target.value) }))} />
        <input type="number" className="vibrant-input w-28" placeholder="Cost" value={opening.unitCost || ''} onChange={(e) => setOpening((o) => ({ ...o, unitCost: Number(e.target.value) }))} />
        <button type="button" className="vibrant-btn" onClick={() => void postOpening()}>Post opening</button>
        <button type="button" className="vibrant-btn-secondary" onClick={() => void quickGrn()}>GRN → central</button>
      </div>

      <div className="vibrant-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] font-black uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Book</th>
              <th className="px-4 py-3 text-right">On hand</th>
              <th className="px-4 py-3 text-right">Available</th>
              <th className="px-4 py-3 text-right">In transit</th>
              <th className="px-4 py-3 text-right">Avg cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.bookId)} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3">{String(r.title)}</td>
                <td className="px-4 py-3 text-right">{Number(r.onHand)}</td>
                <td className="px-4 py-3 text-right">{Number(r.available)}</td>
                <td className="px-4 py-3 text-right">{Number(r.inTransit)}</td>
                <td className="px-4 py-3 text-right">{Number(r.avgCost).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
