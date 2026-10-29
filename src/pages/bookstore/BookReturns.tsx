import { useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';
import { PermissionGate } from '../../context/PermissionContext';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

type SaleLine = { id: string; title: string; quantity: number; unit_price: number; line_total: number };

export default function BookReturns() {
  const [saleId, setSaleId] = useState('');
  const [detail, setDetail] = useState<{
    sale: { id: string; invoice_no: string; status: string; total: number; paid_amount: number; studentName?: string };
    items: SaleLine[];
    refundableBalance: number;
    outstanding: number;
  } | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [condition, setCondition] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Customer return');
  const [refundAmount, setRefundAmount] = useState(0);
  const [returnId, setReturnId] = useState('');
  const [refundId, setRefundId] = useState('');

  const load = async () => {
    try {
      const data = await bookstoreService.fetchSale(saleId.trim());
      setDetail(data);
      toast.success('Sale loaded');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not load sale');
    }
  };

  const createReturn = async () => {
    if (!detail) return;
    const lines = detail.items
      .filter((line) => (qty[line.id] || 0) > 0)
      .map((line) => ({ saleItemId: line.id, quantity: qty[line.id], condition: condition[line.id] || 'good' }));
    try {
      const created = await bookstoreService.createReturn({ saleId: detail.sale.id, lines, reason }, `ret-${detail.sale.id}-${Date.now()}`);
      setReturnId(created.id);
      toast.success(`Return draft ${created.returnNo || created.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Return failed');
    }
  };

  const step = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      if (detail) setDetail(await bookstoreService.fetchSale(detail.sale.id));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Action failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="vibrant-card p-6 flex flex-wrap gap-3">
        <input className="vibrant-input flex-1 min-w-[16rem]" placeholder="Sale id" value={saleId} onChange={(e) => setSaleId(e.target.value)} />
        <button type="button" className="vibrant-btn-primary" onClick={() => void load()}>Load sale</button>
      </div>
      {detail && (
        <div className="vibrant-card p-6 space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-black text-primary">{detail.sale.invoice_no}</p>
              <p className="text-sm text-slate-500">{detail.sale.studentName} · {detail.sale.status}</p>
            </div>
            <Link className="text-sm font-bold text-primary" to={`/bookstore/receipt/${detail.sale.id}`}>Print receipt</Link>
          </div>
          <p className="text-sm">Total {detail.sale.total} · Paid {detail.sale.paid_amount} · Refundable {detail.refundableBalance} · Outstanding {detail.outstanding}</p>
          {detail.items.map((line) => (
            <div key={line.id} className="grid md:grid-cols-4 gap-2 items-center">
              <span>{line.title} (sold {line.quantity})</span>
              <input type="number" min={0} className="vibrant-input" placeholder="Return qty" value={qty[line.id] || ''} onChange={(e) => setQty((q) => ({ ...q, [line.id]: Number(e.target.value) }))} />
              <select className="vibrant-input" value={condition[line.id] || 'good'} onChange={(e) => setCondition((c) => ({ ...c, [line.id]: e.target.value }))}>
                <option value="good">Good — restock</option>
                <option value="damaged">Damaged — not sellable</option>
              </select>
              <span className="text-sm">Rs. {line.unit_price}</span>
            </div>
          ))}
          <input className="vibrant-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <PermissionGate module="bookstore" action="create">
              <button type="button" className="vibrant-btn-primary" onClick={() => void createReturn()}>Create draft</button>
              <button type="button" className="vibrant-btn-primary" disabled={!returnId} onClick={() => void step(() => bookstoreService.submitReturn(returnId), 'Submitted')}>Submit</button>
            </PermissionGate>
            <PermissionGate module="bookstore" action="update">
              <button type="button" className="vibrant-btn-primary" disabled={!returnId} onClick={() => void step(() => bookstoreService.approveReturn(returnId), 'Approved')}>Approve</button>
              <button type="button" className="vibrant-btn-primary" disabled={!returnId} onClick={() => void step(() => bookstoreService.postReturn(returnId), 'Posted')}>Post</button>
              <button type="button" className="vibrant-btn-primary" onClick={() => void step(() => bookstoreService.cancelSale(detail.sale.id, reason), 'Cancelled')}>Cancel sale</button>
            </PermissionGate>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input type="number" min={0} className="vibrant-input max-w-[10rem]" placeholder="Refund amount" value={refundAmount || ''} onChange={(e) => setRefundAmount(Number(e.target.value))} />
            <PermissionGate module="bookstore" action="create">
              <button type="button" className="vibrant-btn-primary" onClick={() => void step(async () => {
                const row = await bookstoreService.createRefund({ saleId: detail.sale.id, returnId: returnId || null, amount: refundAmount, method: 'Cash' }, `rf-${detail.sale.id}-${Date.now()}`);
                setRefundId(row.id);
              }, 'Refund requested')}>Request refund</button>
            </PermissionGate>
            <PermissionGate module="bookstore" action="update">
              <button type="button" className="vibrant-btn-primary" disabled={!refundId} onClick={() => void step(() => bookstoreService.completeRefund(refundId, 'cash'), 'Refund completed')}>Complete refund</button>
            </PermissionGate>
          </div>
          <p className="text-xs text-slate-400">A return does not refund cash. Request a refund, then complete it. Paid sales must be refunded before cancellation.</p>
        </div>
      )}
    </div>
  );
}
