import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';
import PageLoader from '../../components/ui/PageLoader';
import { money } from './courseShared';

type Dash = {
  sales?: { totalSale?: number; paidVouchers?: number; unpaidVouchers?: number; totalCollection?: number };
  inventory?: { totalReceived?: number; totalIssued?: number; availableStock?: number; damagedStock?: number; lowStock?: number; excessStock?: number };
  projection?: { totalProjection?: number; receivedQuantity?: number; soldQuantity?: number; remainingStock?: number };
  campusPerformance?: Array<{ campusName: string; region?: string; sale: number; collection: number }>;
  regions?: Array<{ region: string; inventory: number; collection: number }>;
};

type Exceptions = Record<string, Array<Record<string, unknown>>>;

const exceptionLabels: Record<string, string> = {
  paidNotIssued: 'Paid but not issued',
  receivingPending: 'Receiving pending',
  stockDifference: 'Stock difference',
  lowExcess: 'Low / excess stock',
  poVsDispatch: 'PO and dispatch difference',
  receivingVsInventory: 'Receiving and inventory difference',
  projectionVsSale: 'Projection and sale difference',
};

export default function BookstoreDashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [exceptions, setExceptions] = useState<Exceptions>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([bookstoreService.fetchCourseDashboard(), bookstoreService.fetchCourseExceptions()])
      .then(([dash, ex]) => {
        setData(dash);
        setExceptions(ex || {});
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading course selling dashboard…" />;

  const sections = [
    {
      title: 'Sales',
      cards: [
        ['Total sale', data?.sales?.totalSale],
        ['Paid vouchers', data?.sales?.paidVouchers],
        ['Unpaid vouchers', data?.sales?.unpaidVouchers],
        ['Total collection', data?.sales?.totalCollection],
      ],
    },
    {
      title: 'Inventory',
      cards: [
        ['Total received', data?.inventory?.totalReceived],
        ['Total issued', data?.inventory?.totalIssued],
        ['Available stock', data?.inventory?.availableStock],
        ['Damaged stock', data?.inventory?.damagedStock],
        ['Low stock lines', data?.inventory?.lowStock],
        ['Excess stock lines', data?.inventory?.excessStock],
      ],
    },
    {
      title: 'Projection',
      cards: [
        ['Total projection', data?.projection?.totalProjection],
        ['Received quantity', data?.projection?.receivedQuantity],
        ['Sold / issued', data?.projection?.soldQuantity],
        ['Remaining stock', data?.projection?.remainingStock],
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{section.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {section.cards.map(([label, value]) => (
              <div key={String(label)} className="vibrant-card p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="text-2xl font-black text-primary mt-2">{money(value)}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="vibrant-card p-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Campus performance</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-start text-[10px] uppercase text-slate-400"><th>Campus</th><th>Region</th><th className="text-end">Sale</th><th className="text-end">Collection</th></tr></thead>
            <tbody>
              {(data?.campusPerformance || []).map((row) => (
                <tr key={row.campusName} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2">{row.campusName}</td>
                  <td>{row.region || '—'}</td>
                  <td className="text-end">{money(row.sale)}</td>
                  <td className="text-end">{money(row.collection)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="vibrant-card p-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Region-wise inventory and collection</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-start text-[10px] uppercase text-slate-400"><th>Region</th><th className="text-end">Inventory</th><th className="text-end">Collection</th></tr></thead>
            <tbody>
              {(data?.regions || []).map((row) => (
                <tr key={row.region} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2">{row.region}</td>
                  <td className="text-end">{money(row.inventory)}</td>
                  <td className="text-end">{money(row.collection)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Exceptions</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Object.entries(exceptionLabels).map(([key, label]) => (
            <div key={key} className="vibrant-card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              <p className="text-2xl font-black text-primary mt-1">{(exceptions[key] || []).length}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
