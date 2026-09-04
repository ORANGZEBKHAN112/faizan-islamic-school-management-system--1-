import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Download, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import TranslatedPageHeader from '../components/TranslatedPageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import { Campus } from '../types';
import { dataService } from '../services/dataService';
import { useConfirm } from '../context/ConfirmContext';
import { CAMPUS_REGIONS } from '../utils/campusRegions';
import { toTitleCase } from '../utils/titleCase';

const STOCK_KEY = 'fiss_books_stock_v1';
const MASTER_KEY = 'fiss_books_master_v1';

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

type BookMaster = {
  id: string;
  state?: string;
  region: string;
  campusId?: string;
  campusName: string;
  className: string;
  title: string;
  rate: number;
};

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

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) || (parsed && typeof parsed === 'object') ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normHeader(v: unknown): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
}

function pickCol(row: Record<string, unknown>, aliases: string[]): unknown {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find((k) => normHeader(k) === alias || normHeader(k).includes(alias));
    if (hit != null && row[hit] !== '' && row[hit] != null) return row[hit];
  }
  return undefined;
}

function num(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export default function BooksManagement() {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [rows, setRows] = useState<BookRow[]>(() => loadJson(STOCK_KEY, []));
  const [master, setMaster] = useState<BookMaster[]>(() => loadJson(MASTER_KEY, []));
  const [importing, setImporting] = useState(false);
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
    localStorage.setItem(STOCK_KEY, JSON.stringify(rows));
  }, [rows]);

  useEffect(() => {
    localStorage.setItem(MASTER_KEY, JSON.stringify(master));
  }, [master]);

  const regionCampuses = useMemo(
    () => campuses.filter((c) => !form.region || (c.region || '').trim() === form.region.trim()),
    [campuses, form.region]
  );

  const bookTitleOptions = useMemo(() => {
    const fromMaster = master
      .filter((m) => {
        if (form.region && (m.region || '').trim() !== form.region.trim()) return false;
        if (form.className && m.className && m.className !== form.className) return false;
        if (form.campusId && m.campusId && m.campusId !== form.campusId) return false;
        return true;
      })
      .map((m) => m.title);
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
    return Array.from(new Set([...DEFAULT_BOOK_TITLES, ...fromMaster, ...fromRows])).sort();
  }, [rows, master, campuses, form.region, form.className, form.campusId]);

  const classOptions = useMemo(() => {
    const fromMaster = master.map((m) => m.className).filter(Boolean);
    const fromRows = rows.map((r) => r.className).filter(Boolean);
    return Array.from(new Set(['Nursery', 'KG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', ...fromMaster, ...fromRows])).sort();
  }, [rows, master]);

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

  const resolveCampus = (campusName: string, region: string) => {
    const name = campusName.trim().toLowerCase();
    return campuses.find((c) => {
      if ((c.campusName || '').trim().toLowerCase() !== name) return false;
      if (region && (c.region || '').trim().toLowerCase() !== region.trim().toLowerCase()) return false;
      return true;
    });
  };

  const selectTitle = (title: string) => {
    const match = master.find((m) => {
      if (m.title !== title) return false;
      if (form.region && m.region && m.region !== form.region) return false;
      if (form.className && m.className && m.className !== form.className) return false;
      if (form.campusId && m.campusId && m.campusId !== form.campusId) return false;
      return true;
    });
    setForm((prev) => ({
      ...prev,
      title,
      unitPrice: match ? Number(match.rate) || prev.unitPrice : prev.unitPrice,
    }));
  };

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
      title: toTitleCase(form.title.trim()),
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
    const header = 'State,Region,Campus,Class,Book Title,Book Rate,Previous Stock,New Stock,Total Stock,Sold,Balance,Sales Amount\n';
    const body = enriched.map((r) => {
      const campus = campuses.find((c) => c.id === r.campusId);
      const m = master.find((x) => x.title === r.title && (!x.className || x.className === r.className));
      return [
        m?.state || '',
        r.region || campus?.region || '',
        r.campusName,
        r.className,
        r.title,
        r.unitPrice,
        r.previousStock,
        r.newStock,
        r.total,
        r.sold,
        r.balance,
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

  const downloadTemplate = () => {
    const header = 'State,Region,Campus,Class,Book Title,Book Rate\n';
    const sample = '"Punjab","Punjab - Lahore","Sample Campus","1","English Textbook","450"\n';
    const blob = new Blob([header + sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Books_Master_Import_Template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBookList = async (file: File) => {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!rawRows.length) {
        toast.error('Excel sheet is empty');
        return;
      }

      const nextMaster: BookMaster[] = [...master];
      let imported = 0;
      let skipped = 0;

      for (const row of rawRows) {
        const region = String(pickCol(row, ['region']) || '').trim();
        const state = String(pickCol(row, ['state']) || '').trim();
        const campusName = String(pickCol(row, ['campus', 'campus name', 'campusname']) || '').trim();
        const className = String(pickCol(row, ['class', 'class name', 'classname']) || '').trim();
        const title = toTitleCase(String(pickCol(row, ['book title', 'title', 'book', 'book name']) || '').trim());
        const rate = num(pickCol(row, ['book rate', 'rate', 'unit price', 'price', 'amount']));

        if (!title) {
          skipped += 1;
          continue;
        }
        if (!region && !campusName) {
          skipped += 1;
          continue;
        }

        const campus = campusName ? resolveCampus(campusName, region) : undefined;
        const resolvedRegion = region || campus?.region || '';
        const keyMatch = (m: BookMaster) =>
          m.title.toLowerCase() === title.toLowerCase()
          && (m.className || '') === (className || '')
          && (m.region || '') === (resolvedRegion || '')
          && (m.campusName || '').toLowerCase() === (campus?.campusName || campusName || '').toLowerCase();

        const existingIdx = nextMaster.findIndex(keyMatch);
        const entry: BookMaster = {
          id: existingIdx >= 0 ? nextMaster[existingIdx].id : crypto.randomUUID(),
          state: state || undefined,
          region: resolvedRegion,
          campusId: campus?.id,
          campusName: campus?.campusName || campusName,
          className,
          title,
          rate,
        };
        if (existingIdx >= 0) nextMaster[existingIdx] = entry;
        else nextMaster.push(entry);
        imported += 1;
      }

      setMaster(nextMaster);
      toast.success(`Book master import: ${imported} row(s)${skipped ? `, ${skipped} skipped` : ''}`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to import book list Excel');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <TranslatedPageHeader
        module="books"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadTemplate} className="vibrant-btn-secondary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
              <Download className="w-4 h-4" />
              Import template
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="vibrant-btn-secondary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'Importing…' : 'Import book list'}
            </button>
            <button type="button" onClick={exportCsv} className="vibrant-btn-secondary flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold">
              <Download className="w-4 h-4" />
              Excel summary
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importBookList(f);
              }}
            />
          </div>
        }
      />

      {master.length > 0 && (
        <div className="vibrant-card p-4 text-sm text-slate-600 dark:text-slate-300">
          Book master loaded: <span className="font-black text-primary">{master.length}</span> title(s). Selecting a title auto-fills Book Rate when available.
        </div>
      )}

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
              onChange={(region) => setForm({ ...form, region, campusId: '', title: '' })}
              placeholder="Select region"
              options={CAMPUS_REGIONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Campus</label>
            <SearchableSelect
              value={form.campusId}
              onChange={(campusId) => setForm({ ...form, campusId, title: '' })}
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
              onChange={selectTitle}
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
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Book rate / unit price (Rs.)</label>
            <input type="number" min={0} className="vibrant-input" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) || 0 })} />
          </div>
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-slate-500">
              Total stock = Previous + New · Balance = Total − Sold · Rate auto-fills from imported Book Master when possible
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
