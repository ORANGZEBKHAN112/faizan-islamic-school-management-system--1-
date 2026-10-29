import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { bookstoreService } from '../../services/bookstoreService';
import { dataService } from '../../services/dataService';
import type { Student } from '../../types';
import { usePermissions } from '../../context/PermissionContext';
import PageLoader from '../../components/ui/PageLoader';
import { formatMoney } from '../../utils/money';

type PosStudent = {
  id: string;
  campusId: string;
  classId: string;
  academicSession: string;
  studentName: string;
  rollNumber: string;
  className: string | null;
  campusName: string | null;
};

type PackSummary = { id: string; name: string; packDiscount?: number; academicSession?: string };

type QuoteItem = {
  bookId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  available: number;
  sufficient: boolean;
};

type CartLine = {
  bookId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  packId?: string | null;
};

export default function BookSales() {
  const { canUpdate } = usePermissions();
  const canDiscount = canUpdate('bookstore');

  const [stores, setStores] = useState<Array<{ id: string; name: string; campusId?: string; storeType: string }>>([]);
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [posStudent, setPosStudent] = useState<PosStudent | null>(null);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [packQuote, setPackQuote] = useState<{
    items: QuoteItem[];
    subtotal: number;
    packDiscount: number;
    totalAfterPackDiscount: number;
    allInStock: boolean;
  } | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<'pack' | 'individual'>('pack');
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [line, setLine] = useState({ bookId: '', quantity: 1 });
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState({ amount: 0, method: 'Cash' });
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [recent, setRecent] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    bookstoreService.fetchStores().then((s) => {
      const campusStores = s.filter((x: { storeType: string }) => x.storeType === 'campus');
      setStores(campusStores.length ? campusStores : s);
      if (campusStores[0]) setStoreId(campusStores[0].id);
    });
    bookstoreService.fetchBooks({ limit: 300 }).then((r) => setBooks(r.data || []));
    bookstoreService.fetchSales({ limit: 10 }).then((r) => setRecent(r.data || []));
  }, []);

  useEffect(() => {
    if (search.trim().length < 2) {
      setStudents([]);
      return;
    }
    const t = setTimeout(() => {
      dataService.getPaginated('students', { search, limit: 8, page: 1, status: 'Active' }).then((r) => setStudents(r.data as Student[]));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadStudentContext = useCallback(async (studentId: string) => {
    try {
      const ctx = await bookstoreService.fetchPosStudent(studentId);
      setPosStudent(ctx);
      setCart([]);
      setPackQuote(null);
      setSelectedPackId(null);
      setReservationId(null);
      const eligible = await bookstoreService.fetchEligiblePacks(studentId, ctx.academicSession);
      setPacks(eligible.packs || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not load student for POS');
      setPosStudent(null);
    }
  }, []);

  const loadPackQuote = async (packId: string) => {
    if (!posStudent || !storeId) return;
    setLoadingQuote(true);
    setSelectedPackId(packId);
    setMode('pack');
    try {
      const quote = await bookstoreService.quotePack(packId, {
        studentId: posStudent.id,
        storeId,
        academicSession: posStudent.academicSession,
      });
      setPackQuote({
        items: quote.items,
        subtotal: quote.subtotal,
        packDiscount: quote.packDiscount,
        totalAfterPackDiscount: quote.totalAfterPackDiscount,
        allInStock: quote.allInStock,
      });
      setDiscount(Math.min(quote.packDiscount, quote.subtotal));
      setCart(
        quote.items.map((i: QuoteItem) => ({
          bookId: i.bookId,
          title: i.title,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          packId,
        }))
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Could not price pack');
      setPackQuote(null);
    } finally {
      setLoadingQuote(false);
    }
  };

  const addIndividualLine = async () => {
    if (!posStudent || !line.bookId) return;
    try {
      const prices = await bookstoreService.fetchPrices(posStudent.academicSession, [line.bookId]);
      const p = prices[0];
      if (!p) {
        toast.error('No price for this session');
        return;
      }
      const book = books.find((b) => b.id === line.bookId);
      setMode('individual');
      setSelectedPackId(null);
      setPackQuote(null);
      setCart((c) => [
        ...c,
        {
          bookId: line.bookId,
          title: book?.title || line.bookId,
          quantity: line.quantity,
          unitPrice: p.sellingPrice,
        },
      ]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Price lookup failed');
    }
  };

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [cart]);
  const maxDiscount = mode === 'pack' && packQuote ? packQuote.packDiscount : subtotal;
  const appliedDiscount = canDiscount ? Math.min(maxDiscount, Math.max(0, discount)) : 0;
  const total = subtotal - appliedDiscount;

  const reserveCart = async () => {
    if (!posStudent || !storeId || cart.length === 0) return;
    try {
      const key = `reserve-${posStudent.id}-${selectedPackId || 'lines'}-${Date.now()}`;
      const payload =
        mode === 'pack' && selectedPackId
          ? { storeId, studentId: posStudent.id, packId: selectedPackId, academicSession: posStudent.academicSession }
          : {
              storeId,
              studentId: posStudent.id,
              academicSession: posStudent.academicSession,
              lines: cart.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
            };
      const res = await bookstoreService.reserveSale(payload, key);
      setReservationId(res.reservationId);
      toast.success(`Stock reserved until ${new Date(res.expiresAt).toLocaleTimeString()}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Reservation failed');
    }
  };

  const checkout = async () => {
    if (!posStudent || !storeId || cart.length === 0) {
      toast.error('Complete student and cart first');
      return;
    }
    setCheckingOut(true);
    try {
      const key = `sale-${posStudent.id}-${Date.now()}`;
      const payload: Record<string, unknown> = {
        studentId: posStudent.id,
        storeId,
        campusId: posStudent.campusId,
        academicSession: posStudent.academicSession,
        discount: appliedDiscount,
        payment: { amount: payment.amount || total, method: payment.method },
        reservationId,
      };
      if (mode === 'pack' && selectedPackId) {
        payload.packId = selectedPackId;
      } else {
        payload.items = cart.map((l) => ({ bookId: l.bookId, quantity: l.quantity }));
      }
      const result = await bookstoreService.createSale(payload, key);
      toast.success(`Sale ${result.invoiceNo} — ${result.paymentStatus}`);
      setCart([]);
      setPackQuote(null);
      setReservationId(null);
      setPosStudent(null);
      setSearch('');
      const sales = await bookstoreService.fetchSales({ limit: 10 });
      setRecent(sales.data || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="vibrant-card p-4 space-y-3">
          <label className="text-[10px] font-black uppercase text-slate-400 ms-1">Campus store</label>
          <select className="vibrant-input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input className="vibrant-input" placeholder="Search active student…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`w-full text-start p-3 rounded-xl border ${posStudent?.id === s.id ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-slate-700'}`}
              onClick={() => void loadStudentContext(s.id)}
            >
              <p className="font-bold">{s.firstName}</p>
              <p className="text-xs text-slate-500">{s.rollNumber} · {s.className}</p>
            </button>
          ))}
        </div>

        {posStudent && (
          <div className="vibrant-card p-4 text-sm space-y-1">
            <p className="font-black text-primary">{posStudent.studentName}</p>
            <p className="text-slate-500">{posStudent.rollNumber} · {posStudent.className} · {posStudent.campusName}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Session {posStudent.academicSession}
            </p>
          </div>
        )}

        {posStudent && (
          <div className="vibrant-card p-4 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Class packs</p>
            {packs.length === 0 && <p className="text-sm text-slate-400">No packs for this class and session.</p>}
            {packs.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={loadingQuote}
                className={`w-full text-start p-3 rounded-xl border ${selectedPackId === p.id ? 'border-primary' : 'border-slate-200 dark:border-slate-700'}`}
                onClick={() => void loadPackQuote(p.id)}
              >
                <span className="font-semibold">{p.name}</span>
                {p.packDiscount ? (
                  <span className="text-xs text-slate-500 ms-2">max discount Rs. {p.packDiscount}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {posStudent && (
          <div className="vibrant-card p-4 grid grid-cols-4 gap-2">
            <select className="vibrant-input col-span-2" value={line.bookId} onChange={(e) => setLine((l) => ({ ...l, bookId: e.target.value }))}>
              <option value="">Individual book</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
            <input type="number" min={1} className="vibrant-input" value={line.quantity} onChange={(e) => setLine((l) => ({ ...l, quantity: Number(e.target.value) }))} />
            <button type="button" className="vibrant-btn-secondary" onClick={() => void addIndividualLine()}>Add</button>
          </div>
        )}
      </div>

      <div className="vibrant-card p-4 space-y-4">
        {loadingQuote && <PageLoader label="Pricing pack…" />}
        <h3 className="font-black uppercase text-[10px] tracking-widest text-slate-400">Cart</h3>
        {cart.length === 0 && !loadingQuote && (
          <p className="text-sm text-slate-400">Select a pack or add individual books.</p>
        )}
        {cart.map((l, i) => (
          <div key={`${l.bookId}-${i}`} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-2">
            <span>
              {l.title} × {l.quantity}
              {packQuote?.items && (
                <span className={`ms-2 text-xs ${packQuote.items.find((x) => x.bookId === l.bookId)?.sufficient ? 'text-success' : 'text-danger'}`}>
                  stock {packQuote.items.find((x) => x.bookId === l.bookId)?.available ?? '—'}
                </span>
              )}
            </span>
            <span>{formatMoney((l.quantity * l.unitPrice))}</span>
          </div>
        ))}
        <p className="text-sm text-slate-500">Subtotal {formatMoney(subtotal)}</p>
        {canDiscount && (
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400">Discount (max Rs. {maxDiscount})</label>
            <input
              type="number"
              min={0}
              max={maxDiscount}
              className="vibrant-input mt-1"
              value={appliedDiscount || ''}
              onChange={(e) => setDiscount(Number(e.target.value))}
            />
          </div>
        )}
        <p className="font-black text-lg">Total {formatMoney(total)}</p>
        {reservationId && (
          <p className="text-xs text-success font-semibold">Reservation active: {reservationId.slice(0, 8)}…</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="vibrant-btn-secondary" disabled={!cart.length} onClick={() => void reserveCart()}>
            Reserve stock
          </button>
          {reservationId && (
            <button
              type="button"
              className="text-[10px] font-black uppercase text-slate-500"
              onClick={async () => {
                await bookstoreService.releaseReservation(reservationId);
                setReservationId(null);
                toast.message('Reservation released');
              }}
            >
              Release
            </button>
          )}
        </div>
        <input type="number" className="vibrant-input" placeholder="Payment amount" value={payment.amount || total || ''} onChange={(e) => setPayment((p) => ({ ...p, amount: Number(e.target.value) }))} />
        <select className="vibrant-input" value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}>
          <option>Cash</option>
          <option>Bank Transfer</option>
        </select>
        <button type="button" className="vibrant-btn-primary w-full" disabled={!posStudent || cart.length === 0 || checkingOut || (packQuote && !packQuote.allInStock && !reservationId)} onClick={() => void checkout()}>
          {checkingOut ? 'Processing…' : 'Complete sale'}
        </button>
        {packQuote && !packQuote.allInStock && !reservationId && (
          <p className="text-xs text-amber-600">Reserve stock or restock before checkout.</p>
        )}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Recent sales</p>
          {recent.map((r) => (
            <p key={String(r.id)} className="text-xs text-slate-600 dark:text-slate-400">
              {String(r.invoice_no)} · {String(r.studentName)} · Rs. {Number(r.total)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
