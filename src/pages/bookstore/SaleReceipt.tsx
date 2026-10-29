import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { bookstoreService } from '../../services/bookstoreService';

type Receipt = {
  invoiceNo: string;
  soldAt: string;
  status: string;
  campusName?: string;
  storeName?: string;
  studentName?: string;
  rollNumber?: string;
  academicSession?: string;
  items: Array<{ title: string; quantity: number; unitPrice: number; lineTotal: number }>;
  gross: number;
  discount: number;
  total: number;
  paidAmount: number;
  outstanding: number;
  payments: Array<{ amount: number; payment_method: string; transaction_ref?: string }>;
  refunds: Array<{ amount: number; status: string; payment_method: string }>;
  completedRefunds: number;
};

export default function SaleReceipt() {
  const { saleId } = useParams();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saleId) return;
    bookstoreService.fetchReceipt(saleId).then(setReceipt).catch(() => setError('Could not load receipt'));
  }, [saleId]);

  if (error) return <p className="p-8">{error}</p>;
  if (!receipt) return <p className="p-8">Loading receipt…</p>;

  return (
    <div className="bg-white text-black p-8 max-w-3xl mx-auto print:max-w-none">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-black">Bookstore receipt</h1>
          <p>{receipt.campusName} · {receipt.storeName}</p>
        </div>
        <button type="button" className="print:hidden border px-3 py-1" onClick={() => window.print()}>Print</button>
      </div>
      <p>Invoice {receipt.invoiceNo}</p>
      <p>Date {receipt.soldAt ? new Date(receipt.soldAt).toLocaleString() : ''}</p>
      <p>Student {receipt.studentName} ({receipt.rollNumber || '—'})</p>
      <p>Session {receipt.academicSession || '—'} · Status {receipt.status}</p>
      <table className="w-full mt-4 text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-start py-2">Book</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((line) => (
            <tr key={line.title} className="border-b">
              <td className="py-2">{line.title}</td>
              <td className="text-center">{line.quantity}</td>
              <td className="text-end">{line.unitPrice}</td>
              <td className="text-end">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 text-sm space-y-1">
        <p>Gross {receipt.gross}</p>
        <p>Discount {receipt.discount}</p>
        <p>Total {receipt.total}</p>
        <p>Paid {receipt.paidAmount}</p>
        <p>Outstanding {receipt.outstanding}</p>
        <p>Completed refunds {receipt.completedRefunds}</p>
      </div>
      <div className="mt-4 text-sm">
        <p className="font-bold">Payments</p>
        {receipt.payments.map((p, i) => (
          <p key={i}>{p.payment_method} {p.amount} {p.transaction_ref || ''}</p>
        ))}
        <p className="font-bold mt-2">Refunds</p>
        {receipt.refunds.map((p, i) => (
          <p key={i}>{p.status} {p.payment_method} {p.amount}</p>
        ))}
      </div>
    </div>
  );
}
