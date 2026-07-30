import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Download, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import { Campus } from '../types';
import { dataService } from '../services/dataService';
import { useConfirm } from '../context/ConfirmContext';
import { CAMPUS_REGIONS } from '../utils/campusRegions';

const STORAGE_KEY = 'fiss_books_stock_v1';

const DEFAULT_BOOK_TITLES = [
  'English Textbook',
  'Urdu Textbook',
  'Mathematics Textbook',
  'Science Textbook',
  'Islamic Studies',
  'Quran Nazira',
  'Workbook Pack',
  'Notebook Set',
];

type BookRow = {
  id: string;
  campusId: string;
  campusName: string;
  region?: string;
  className: string;
  title: string;
  previousStock: number;
  newStock: number;
  sold: number;
  unitPrice: number;
};

function loadRows(): BookRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRows(rows: BookRow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export default function BooksManagement() {
  const confirm = useConfirm();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [rows, setRows] = useState<BookRow[]>(() => loadRows());
  const [form, setForm] = useState({
    region: '',
    campusId: '',
    className: '',
    title: '',
    previousStock: 0,
    newStock: 0,
    sold: 0,
    unitPrice: 0,
  });

  useEffect(() => {
    return dataService.subscribe('campuses', setCampuses);
  }, []);

  useEffect(() => {
    saveRows(rows);
  }, [rows]);

  const regionCampuses = useMemo(
    () => campuses.filter((c) => !form.region || (c.region || '').trim() === form.region.trim()),
    [campuses, form.region]
  );

  const bookTitleOptions = useMemo(() => {
    const fromRows = rows
      .filter((r) => {
        if (form.region) {
          const campus = campuses.find((c) => c.id === r.campusId);
          if ((campus?.region || r.region || '').trim() !== form.region.trim()) return false;
        }
        if (form.className && r.className !== form.className) return false;
        return true;
      })
      .map((r) => r.title);
    return Array.from(new Set([...DEFAULT_BOOK_TITLES, ...fromRows])).sort();
  }, [rows, campuses, form.region, form.className]);

  const classOptions = useMemo(() => {
    const fromRows = rows.map((r) => r.className).filter(Boolean);
    return Array.from(new Set(['Nursery', 'KG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', ...fromRows])).sort();
  }, [rows]);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const total = Number(r.previousStock || 0) + Number(r.newStock || 0);
        const balance = Math.max(0, total - Number(r.sold || 0));
        const salesAmount = Number(r.sold || 0) * Number(r.unitPrice || 0);
        return { ...r, total, balance, salesAmount };
      }),
    [rows]
  );

  const addRow = (e: FormEvent) => {
    e.preventDefault();
    if (!form.region) return toast.error('Region is required');
    if (!form.campusId || !form.title.trim()) {
      toast.error('Campus and book title are required');
      return;
    }
    const campus = campuses.find((c) => c.id === form.campusId);
    const row: BookRow = {
      id: crypto.randomUUID(),
      campusId: form.campusId,
      campusName: campus?.campusName || '',
      region: form.region || campus?.region || '',
      className: form.className.trim(),
      title: form.title.trim(),
      previousStock: Number(form.previousStock) || 0,
      newStock: Number(form.newStock) || 0,
      sold: Number(form.sold) || 0,
      unitPrice: Number(form.unitPrice) || 0,
    };
    setRows((prev) => [row, ...prev]);
    setForm((prev) => ({
      ...prev,
      className: '',
      title: '',
      previousStock: 0,
      newStock: 0,
      sold: 0,
      unitPrice: 0,
    }));
    toast.success('Book stock row added');
  };

  const removeRow = async (id: string) => {
    if (!await confirm({ title: 'Remove book row?', message: 'This removes the stock line from Books Management.', confirmLabel: 'Remove', variant: 'danger' })) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success('Removed');
  };

  const exportCsv = () => {
    const header = 'Region,Campus,Class,Book Title,Previous Stock,New Stock,Total Stock,Sold,Balance,Unit Price,Sales Amount\n';
    const body = enriched.map((r) => {
      const campus = campuses.find((c) => c.id === r.campusId);
      return [
        r.region || campus?.region || '',
        r.campusName,
        r.className,
        r.title,
        r.previousStock,
        r.newStock,
        r.total,
        r.sold,
        r.balance,
        r.unitPrice,
        r.salesAmount,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Books_Stock_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Books summary exported');
  };

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="books"
        actions={
          <button type="button" onClick={exportCsv} className="vibrant-btn-secondary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
            <Download className="w-4 h-4" />
            Excel summary
          </button>
        }
      />

      <div className="vibrant-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-5 h-5 text-primary" />
          <h3 className="font-black uppercase tracking-widest text-sm">Add / update campus book stock</h3>
        </div>
        <form onSubmit={addRow} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Region</label>
            <SearchableSelect
              value={form.region}
              onChange={(region) => setForm({ ...form, region, campusId: '' })}
              placeholder="Select region"
              options={CAMPUS_REGIONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Campus</label>
            <SearchableSelect
              value={form.campusId}
              onChange={(campusId) => setForm({ ...form, campusId })}
              placeholder={form.region ? 'Select campus' : 'Select region first'}
              options={regionCampuses.map((c) => ({ value: c.id, label: c.campusName }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Class</label>
            <SearchableSelect
              value={form.className}
              onChange={(className) => setForm({ ...form, className, title: '' })}
              placeholder="Select class"
              options={classOptions.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Book title</label>
            <SearchableSelect
              value={form.title}
              onChange={(title) => setForm({ ...form, title })}
              placeholder="Select book title"
              options={bookTitleOptions.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Previous stock</label>
            <input type="number" min={0} className="vibrant-input" value={form.previousStock} onChange={(e) => setForm({ ...form, previousStock: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">New stock</label>
            <input type="number" min={0} className="vibrant-input" value={form.newStock} onChange={(e) => setForm({ ...form, newStock: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Sold quantity</label>
            <input type="number" min={0} className="vibrant-input" value={form.sold} onChange={(e) => setForm({ ...form, sold: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Unit price (Rs.)</label>
            <input type="number" min={0} className="vibrant-input" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) || 0 })} />
          </div>
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-slate-500">
              Total stock = Previous + New · Balance = Total − Sold
              {form.previousStock || form.newStock
                ? ` · Preview total: ${Number(form.previousStock || 0) + Number(form.newStock || 0)}`
                : ''}
            </p>
            <button type="submit" className="vibrant-btn-primary flex items-center justify-center gap-2 px-6">
              <Plus className="w-4 h-4" />
              Save stock line
            </button>
          </div>
        </form>
      </div>

      <div className="vibrant-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">Region</th>
                <th className="px-4 py-3">Campus</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Prev</th>
                <th className="px-4 py-3">New</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Sold</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Sales</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {enriched.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-400">No book stock rows yet</td>
                </tr>
              ) : (
                enriched.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{r.region || campuses.find((c) => c.id === r.campusId)?.region || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{r.campusName}</td>
                    <td className="px-4 py-3">{r.className || '—'}</td>
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3">{r.previousStock}</td>
                    <td className="px-4 py-3">{r.newStock}</td>
                    <td className="px-4 py-3 font-black">{r.total}</td>
                    <td className="px-4 py-3">{r.sold}</td>
                    <td className="px-4 py-3 font-black text-primary">{r.balance}</td>
                    <td className="px-4 py-3">Rs. {r.salesAmount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => removeRow(r.id)} className="p-2 text-slate-400 hover:text-danger">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
