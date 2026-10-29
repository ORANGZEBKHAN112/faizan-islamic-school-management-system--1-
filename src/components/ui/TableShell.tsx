import type { ReactNode } from 'react';
import { useI18n } from '../../context/I18nContext';

interface TableShellProps {
  children: ReactNode;
  className?: string;
  hint?: string;
}

/** Horizontal scroll wrapper with sticky header support for data tables */
export default function TableShell({
  children,
  className = '',
  hint,
}: TableShellProps) {
  const { t } = useI18n();
  return (
    <div className={`table-shell ${className}`.trim()}>
      <p className="table-scroll-hint">{hint ?? t('common.swipeHint')}</p>
      <div className="table-scroll-viewport">{children}</div>
    </div>
  );
}
