import { NavLink, Outlet } from 'react-router-dom';
import TranslatedPageHeader from '../../components/TranslatedPageHeader';

const tabs = [
  { to: '/bookstore', end: true, label: 'Dashboard' },
  { to: '/bookstore/projection', label: 'Projection' },
  { to: '/bookstore/orders', label: 'Purchase orders' },
  { to: '/bookstore/dispatch', label: 'Dispatch' },
  { to: '/bookstore/receiving', label: 'Receiving' },
  { to: '/bookstore/class-stock', label: 'Inventory' },
  { to: '/bookstore/transfers', label: 'Shuffling' },
  { to: '/bookstore/vouchers', label: 'Vouchers' },
  { to: '/bookstore/adjustments', label: 'Adjustments' },
  { to: '/bookstore/catalog', label: 'Titles' },
  { to: '/bookstore/packs', label: 'Class sets' },
  { to: '/bookstore/reports', label: 'Reports' },
];

export default function BookstoreLayout() {
  return (
    <div className="space-y-6">
      <TranslatedPageHeader module="bookstore" />
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                isActive
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-primary'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
