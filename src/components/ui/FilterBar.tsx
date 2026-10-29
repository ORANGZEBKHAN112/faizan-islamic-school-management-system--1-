import type { ReactNode } from 'react';

export default function FilterBar({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`filter-bar ${className}`.trim()}>{children}</div>;
}
