import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';

export default function BookstoreReports() {
  const [summary, setSummary] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    bookstoreService.fetchReportSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) return <p className="text-slate-400">Loading report…</p>;

  const items = [
    { label: 'Orders', value: summary.orders },
    { label: 'Gross sales', value: summary.gross },
    { label: 'Discounts', value: summary.discounts },
    { label: 'Collected', value: summary.collected },
    { label: 'COGS', value: summary.cogs },
    { label: 'Gross profit', value: summary.grossProfit },
  ];

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((i) => (
        <div key={i.label} className="vibrant-card p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{i.label}</p>
          <p className="text-xl font-black text-primary mt-2">{Number(i.value || 0).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
