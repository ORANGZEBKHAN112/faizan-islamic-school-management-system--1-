import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { apiError } from './courseShared';

type PoItem = {
  id: string;
  campusName?: string;
  className?: string;
  title?: string;
  quantity: number;
};

type PurchaseOrder = { id: string; order_no: string; items: PoItem[] };

export default function WarehouseDispatchPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [poId, setPoId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [posted, setPosted] = useState<Array<{ id: string; dispatch_no: string; orderNo?: string; invoice_ref?: string }>>([]);

  const load = async () => {
    const [po, dispatches] = await Promise.all([
      bookstoreService.fetchCourseOrders(),
      bookstoreService.fetchDispatches(),
    ]);
    setOrders(po);
    setPosted(dispatches);
    if (!poId && po[0]) setPoId(po[0].id);
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const order = orders.find((o) => o.id === poId);

  useEffect(() => {
    if (!order) return;
    const next: Record<string, number> = {};
    for (const item of order.items) next[item.id] = Number(item.quantity);
    setQtys(next);
  }, [poId]);

  const post = async () => {
    if (!order) return;
    try {
      const result = await bookstoreService.postDispatch({
        poId: order.id,
        invoiceRef,
        items: order.items.map((item) => ({ poItemId: item.id, qtyDispatched: Number(qtys[item.id] || 0) })),
      });
      toast.success(`Dispatch ${result.dispatchNo} posted. Campuses can verify receiving.`);
      setInvoiceRef('');
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Dispatch failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <select className="vibrant-input" value={poId} onChange={(e) => setPoId(e.target.value)}>
            <option value="">Purchase order</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no}</option>)}
          </select>
          <input className="vibrant-input" placeholder="Warehouse invoice number" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
        </div>
        {order && (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="text-start py-2">Campus</th>
                <th className="text-start">Class</th>
                <th className="text-start">Title</th>
                <th className="text-end">Ordered</th>
                <th className="text-end">Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2">{item.campusName}</td>
                  <td>{item.className}</td>
                  <td className="font-semibold">{item.title}</td>
                  <td className="text-end">{item.quantity}</td>
                  <td className="text-end">
                    <input
                      type="number"
                      min={0}
                      className="vibrant-input w-24 ml-auto"
                      value={qtys[item.id] ?? 0}
                      onChange={(e) => setQtys((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="vibrant-btn-primary" onClick={() => void post()}>Post warehouse dispatch</button>
      </div>

      <div className="vibrant-card divide-y divide-slate-100 dark:divide-slate-800">
        {posted.map((d) => (
          <div key={d.id} className="p-4 flex justify-between gap-3">
            <p className="font-bold">{d.dispatch_no}</p>
            <p className="text-sm text-slate-500">{d.orderNo} · Invoice {d.invoice_ref || '—'}</p>
          </div>
        ))}
        {posted.length === 0 && <p className="p-4 text-slate-400">No dispatches yet.</p>}
      </div>
    </div>
  );
}
