import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';

type Row = {
  id: string;
  region?: string;
  campusName?: string;
  campus_id: string;
  className?: string;
  title?: string;
  book_id: string;
  on_hand: number;
  damaged: number;
};

type History = { movement: string; qtyDelta: number; reason?: string; createdAt?: string; performedBy?: string };

export default function CourseInventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    bookstoreService.fetchClassInventory().then(setRows).catch(() => setRows([]));
  }, []);

  const openHistory = async (row: Row) => {
    setActive(row.id);
    setHistory(await bookstoreService.fetchStockHistory(row.book_id, row.campus_id));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Stock is grouped Region → Campus → Class → Title. Open a line to see warehouse receipt, shuffling, student issue, warehouse return, damage, and adjustment.</p>
      <div className="vibrant-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase text-slate-400">
            <tr>
              <th className="p-3 text-start">Region</th>
              <th className="p-3 text-start">Campus</th>
              <th className="p-3 text-start">Class</th>
              <th className="p-3 text-start">Title</th>
              <th className="p-3 text-end">Available</th>
              <th className="p-3 text-end">Damaged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-t border-slate-100 dark:border-slate-800 cursor-pointer ${active === row.id ? 'bg-primary/5' : ''}`} onClick={() => void openHistory(row)}>
                <td className="p-3">{row.region || '—'}</td>
                <td className="p-3">{row.campusName}</td>
                <td className="p-3">{row.className}</td>
                <td className="p-3 font-semibold">{row.title}</td>
                <td className="p-3 text-end">{row.on_hand}</td>
                <td className="p-3 text-end">{row.damaged}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-slate-400" colSpan={6}>No class stock yet. Verify a campus receipt to create balances.</td></tr>}
          </tbody>
        </table>
      </div>
      {active && (
        <div className="vibrant-card p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Stock history</p>
          {history.length === 0 && <p className="text-slate-400 text-sm">No movements for this title.</p>}
          <ul className="space-y-2 text-sm">
            {history.map((h, i) => (
              <li key={`${h.createdAt}-${i}`} className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-2">
                <span>{h.movement} · {h.reason || '—'} · {h.performedBy || ''}</span>
                <span className="font-bold">{h.qtyDelta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
