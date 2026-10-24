import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';
import PageLoader from '../../components/ui/PageLoader';

export default function BookstoreDashboard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bookstoreService
      .fetchDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading bookstore dashboard…" />;

  const sales = (data?.sales || {}) as Record<string, number>;
  const inv = (data?.inventory || {}) as Record<string, number>;

  const cards = [
    { label: 'Gross sales', value: sales.grossSales },
    { label: 'Collected', value: sales.collected },
    { label: 'Outstanding', value: sales.outstanding },
    { label: 'Inventory value', value: inv.inventoryValue },
    { label: 'On hand (units)', value: inv.onHand },
    { label: 'In transit', value: inv.inTransit },
    { label: 'Pending transfers', value: data?.pendingTransfers },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="vibrant-card p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{c.label}</p>
          <p className="text-2xl font-black text-primary mt-2">
            {typeof c.value === 'number' ? c.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </p>
        </div>
      ))}
    </div>
  );
}
