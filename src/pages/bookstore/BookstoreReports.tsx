import { useEffect, useState } from 'react';
import { bookstoreService } from '../../services/bookstoreService';
import { money } from './courseShared';

const reports = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'sales', label: 'Sales & collection' },
  { id: 'issuance', label: 'Course issuance' },
  { id: 'projection', label: 'Projection & performance' },
  { id: 'transfers', label: 'Stock transfer' },
  { id: 'reconciliation', label: 'Reconciliation' },
] as const;

const stageLabels: Record<string, string> = {
  purchase_order: 'Purchase order',
  warehouse_dispatch: 'Warehouse dispatch',
  campus_receiving: 'Campus receiving',
  course_issue: 'Course issue',
  available_inventory: 'Available inventory',
};

export default function BookstoreReports() {
  const [kind, setKind] = useState<(typeof reports)[number]['id']>('inventory');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [stages, setStages] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    bookstoreService.fetchCourseReport(kind).then((data) => {
      if (kind === 'reconciliation') {
        setStages((data.stages || []) as Array<Record<string, unknown>>);
        setRows([]);
      } else {
        setRows(Array.isArray(data) ? data : []);
        setStages([]);
      }
    }).catch(() => {
      setRows([]);
      setStages([]);
    });
  }, [kind]);

  const columns = rows[0] ? Object.keys(rows[0]).filter((key) => !['id', 'campus_id', 'class_id', 'book_id'].includes(key)) : [];

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const source = kind === 'reconciliation' ? stages : rows;
    const sheet = XLSX.utils.json_to_sheet(source);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Report');
    XLSX.writeFile(book, `course-${kind}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {reports.map((report) => (
          <button key={report.id} type="button" className={kind === report.id ? 'vibrant-btn-primary' : 'vibrant-btn-secondary'} onClick={() => setKind(report.id)}>
            {report.label}
          </button>
        ))}
        <button type="button" className="vibrant-btn-secondary" onClick={() => void exportExcel()}>Excel</button>
      </div>

      {kind === 'reconciliation' ? (
        <div className="vibrant-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="p-3 text-left">Stage</th>
                <th className="p-3 text-right">Quantity</th>
                <th className="p-3 text-right">Difference</th>
                <th className="p-3 text-right">Purchase</th>
                <th className="p-3 text-right">Profit</th>
                <th className="p-3 text-right">Sale</th>
                <th className="p-3 text-right">Payable to warehouse</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr key={String(stage.stage)} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-3 font-semibold">{stageLabels[String(stage.stage)] || String(stage.stage)}</td>
                  <td className="p-3 text-right">{money(stage.quantity)}</td>
                  <td className="p-3 text-right">{stage.difference == null ? '—' : money(stage.difference)}</td>
                  <td className="p-3 text-right">{money(stage.purchase)}</td>
                  <td className="p-3 text-right">{money(stage.profit)}</td>
                  <td className="p-3 text-right">{money(stage.sale)}</td>
                  <td className="p-3 text-right">{stage.payable == null ? '—' : money(stage.payable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="vibrant-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>{columns.map((col) => <th key={col} className="p-3 text-left">{col}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                  {columns.map((col) => <td key={col} className="p-3">{row[col] == null ? '—' : String(row[col])}</td>)}
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="p-6 text-slate-400">No rows for this report.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {kind === 'issuance' && <p className="text-xs text-slate-500">Paid vouchers with issue status “not issued” are courses that are paid but not issued.</p>}
    </div>
  );
}
