import type { ReactNode } from 'react';

interface TableShellProps {
  children: ReactNode;
  className?: string;
  hint?: string;
}

/** Horizontal scroll wrapper with sticky header support for data tables */
export default function TableShell({
  children,
  className = '',
  hint = 'Swipe horizontally to see more columns',
}: TableShellProps) {
  return (
    <div className={`table-shell ${className}`.trim()}>
      <p className="table-scroll-hint">{hint}</p>
      <div className="table-scroll-viewport">{children}</div>
    </div>
  );
}
