import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';
import PageLoader from '../../components/ui/PageLoader';
import { money } from './courseShared';

type Dash = {
  sales?: { totalSale?: number; paidVouchers?: number; unpaidVouchers?: number; totalCollection?: number };
  inventory?: { totalReceived?: number; totalIssued?: number; availableStock?: number; damagedStock?: number; lowStock?: number; excessStock?: number };
  projection?: { totalProjection?: number; receivedQuantity?: number; soldQuantity?: number; remainingStock?: number };
  campusPerformance?: Array<{ campusName: string; region?: string; sale: number; collection: number; inventory: number }>;
  regions?: Array<{ region: string; inventory: number; collection: number }>;
};

type Exceptions = Record<string, Array<Record<string, unknown>>>;

const exceptionLabels: Record<string, string> = {
  paidNotIssued: 'Paid but not issued',
  receivingPending: 'Receiving pending',
  stockDifference: 'Stock difference',
  lowStock: 'Low stock',
  excessStock: 'Excess stock',
  poVsDispatch: 'PO and dispatch difference',
  receivingVsInventory: 'Receiving and inventory difference',
  projectionVsSale: 'Projection and sale difference',
};

function exceptionRows(exceptions: Exceptions, key: string) {
  if (key === 'lowStock') return (exceptions.lowExcess || []).filter((row) => row.flag === 'low');
  if (key === 'excessStock') return (exceptions.lowExcess || []).filter((row) => row.flag === 'excess');
  return exceptions[key] || [];
}

function cellText(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return money(value);
  const text = String(value);
  return text.length > 10 && text.includes('T') ? text.slice(0, 16).replace('T', ' ') : text;
}

export default function BookstoreDashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [exceptions, setExceptions] = useState<Exceptions>({});
  const [openException, setOpenException] = useState('paidNotIssued');
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
            <thead><tr className="text-start text-[10px] uppercase text-slate-400"><th>Campus</th><th>Region</th><th className="text-end">Sale</th><th className="text-end">Collection</th><th className="text-end">Inventory</th></tr></thead>
            <tbody>
              {(data?.campusPerformance || []).map((row) => (
                <tr key={row.campusName} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2">{row.campusName}</td>
                  <td>{row.region || '—'}</td>
                  <td className="text-end">{money(row.sale)}</td>
                  <td className="text-end">{money(row.collection)}</td>
                  <td className="text-end">{money(row.inventory)}</td>
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
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Object.entries(exceptionLabels).map(([key, label]) => {
            const rows = exceptionRows(exceptions, key);
            const open = openException === key;
            return (
              <button
                key={key}
                type="button"
                className={`vibrant-card p-4 text-start ${open ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setOpenException(key)}
              >
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="text-2xl font-black text-primary mt-1">{rows.length}</p>
              </button>
            );
          })}
        </div>
        <div className="vibrant-card p-4 overflow-x-auto">
          <h3 className="text-sm font-black mb-3">{exceptionLabels[openException]}</h3>
          {exceptionRows(exceptions, openException).length === 0 ? (
            <p className="text-sm text-slate-500">No rows in this exception.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-[10px] uppercase text-slate-400">
                  {Object.keys(exceptionRows(exceptions, openException)[0] || {})
                    .filter((key) => key !== 'id' && key !== 'flag')
                    .map((key) => <th key={key} className="py-2 pe-3">{key}</th>)}
                </tr>
              </thead>
              <tbody>
                {exceptionRows(exceptions, openException).map((row, index) => (
                  <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                    {Object.entries(row)
                      .filter(([key]) => key !== 'id' && key !== 'flag')
                      .map(([key, value]) => <td key={key} className="py-2 pe-3">{cellText(value)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
