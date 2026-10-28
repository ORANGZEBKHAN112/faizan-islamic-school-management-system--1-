import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { apiError } from './courseShared';

type Line = {
  id: string;
  title?: string;
  qty_dispatched: number;
  qty_received?: number | null;
  verified: boolean | number;
  difference?: number;
};

type Receiving = {
  id: string;
  dispatchNo?: string;
  orderNo?: string;
  campusName?: string;
  region?: string;
  status: string;
  invoiceRef?: string;
  items: Line[];
};

export default function CampusReceivingPage() {
  const [rows, setRows] = useState<Receiving[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

  const load = async () => {
    const data = await bookstoreService.fetchReceiving();
    setRows(data);
    const next: Record<string, number> = {};
    for (const rec of data as Receiving[]) {
      for (const item of rec.items || []) {
        next[item.id] = Number(item.qty_dispatched);
      }
    }
    setQty(next);
  };

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, []);

  const verify = async (item: Line) => {
    try {
      const result = await bookstoreService.verifyReceiving(item.id, Number(qty[item.id] ?? 0));
      toast.success(`Verified. Difference ${result.difference}`);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Verification failed'));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Verify each title separately. Inventory updates only for the quantity the campus actually received. Dispatched, received, and difference stay visible.</p>
      {rows.length === 0 && <div className="vibrant-card p-6 text-slate-400">No campus receiving is waiting.</div>}
      {rows.map((rec) => (
        <div key={rec.id} className="vibrant-card p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-black">{rec.campusName} <span className="text-slate-400 font-semibold">{rec.region ? `· ${rec.region}` : ''}</span></p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">{rec.orderNo} · {rec.dispatchNo} · {rec.status} · {rec.invoiceRef || 'No invoice'}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="text-left py-2">Title</th>
                <th className="text-right">Dispatched</th>
                <th className="text-right">Received</th>
                <th className="text-right">Difference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rec.items.map((item) => {
                const verified = item.verified === true || item.verified === 1;
                const received = verified ? Number(item.qty_received || 0) : Number(qty[item.id] ?? item.qty_dispatched);
                const difference = Number(item.qty_dispatched) - received;
                return (
                  <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-semibold">{item.title}</td>
                    <td className="text-right">{item.qty_dispatched}</td>
                    <td className="text-right">
                      {verified ? item.qty_received : (
                        <input
                          type="number"
                          min={0}
                          className="vibrant-input w-24 ml-auto"
                          value={qty[item.id] ?? item.qty_dispatched}
                          onChange={(e) => setQty((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                        />
                      )}
                    </td>
                    <td className={`text-right font-bold ${difference !== 0 ? 'text-amber-600' : ''}`}>{difference}</td>
                    <td className="text-right">
                      {verified ? <span className="text-[10px] uppercase font-black text-emerald-600">Verified</span> : (
                        <button type="button" className="vibrant-btn-primary" onClick={() => void verify(item)}>Verify</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
