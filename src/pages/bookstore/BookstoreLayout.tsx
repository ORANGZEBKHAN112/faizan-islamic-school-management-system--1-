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
      <nav className="segmented">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `segmented-item ${isActive ? 'segmented-item-active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
