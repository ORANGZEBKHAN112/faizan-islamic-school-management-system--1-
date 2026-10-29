import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClass: Record<StatusTone, string> = {
  success: 'status-badge status-success',
  warning: 'status-badge status-warning',
  danger: 'status-badge status-danger',
  info: 'status-badge status-info',
  neutral: 'status-badge status-neutral',
};

export default function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={toneClass[tone]}>{children}</span>;
}
