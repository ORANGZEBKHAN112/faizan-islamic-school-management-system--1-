import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { bookstoreService } from '../../services/bookstoreService';
import { apiError } from './courseShared';

type PoItem = {
  id: string;
  region?: string;
  campusName?: string;
  className?: string;
  title?: string;
  quantity: number;
  unit_cost: number;
  selling_price: number;
};

type PurchaseOrder = {
  id: string;
  order_no: string;
  academic_session: string;
  order_date: string;
  status: string;
  items: PoItem[];
};

export default function CourseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    bookstoreService.fetchCourseOrders().then(setOrders).catch(() => setOrders([]));
  }, []);

  const rowsOf = (order: PurchaseOrder) => order.items.map((item) => ({
    Region: item.region || '',
    Campus: item.campusName || '',
    Class: item.className || '',
    Title: item.title || '',
    Quantity: item.quantity,
    'Order number': order.order_no,
    Date: String(order.order_date).slice(0, 10),
    Status: order.status,
  }));

  const exportExcel = async (order: PurchaseOrder) => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rowsOf(order));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Purchase order');
    XLSX.writeFile(book, `${order.order_no}.xlsx`);
  };

  const exportPdf = (order: PurchaseOrder) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(`Purchase order ${order.order_no}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Session ${order.academic_session} · ${String(order.order_date).slice(0, 10)} · ${order.status}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [['Region', 'Campus', 'Class / title', 'Quantity', 'Order no.', 'Date', 'Status']],
      body: order.items.map((item) => [
        item.region || '',
        item.campusName || '',
        `${item.className || ''} / ${item.title || ''}`,
        String(item.quantity),
        order.order_no,
        String(order.order_date).slice(0, 10),
        order.status,
      ]),
    });
    doc.save(`${order.order_no}.pdf`);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Orders are built from projection and can be sent to the warehouse as Excel or PDF. Title order matches the projection.</p>
      {orders.length === 0 && <div className="vibrant-card p-6 text-slate-400">No purchase orders yet. Create one from Projection.</div>}
      {orders.map((order) => (
        <div key={order.id} className="vibrant-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-black">{order.order_no}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">{order.academic_session} · {String(order.order_date).slice(0, 10)} · {order.status}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="vibrant-btn-secondary" onClick={() => setOpenId(openId === order.id ? null : order.id)}>Lines</button>
              <button type="button" className="vibrant-btn-secondary" onClick={() => void exportExcel(order).catch((err) => toast.error(apiError(err, 'Excel export failed')))}>Excel</button>
              <button type="button" className="vibrant-btn-primary" onClick={() => exportPdf(order)}>PDF</button>
            </div>
          </div>
          {openId === order.id && (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="text-start py-2">Region</th>
                  <th className="text-start">Campus</th>
                  <th className="text-start">Class</th>
                  <th className="text-start">Title</th>
                  <th className="text-end">Qty</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2">{item.region || '—'}</td>
                    <td>{item.campusName}</td>
                    <td>{item.className}</td>
                    <td className="font-semibold">{item.title}</td>
                    <td className="text-end">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
