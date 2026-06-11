import type { LucideIcon } from 'lucide-react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export default function EmptyState({
  title,
  description,
  icon: Icon = AlertCircle,
  actionLabel,
  onAction,
  actionHref,
  onRetry,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`vibrant-card text-center ${compact ? 'p-8' : 'p-10'}`}>
      <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-slate-400" />
      </div>
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {actionHref && actionLabel && (
          <Link to={actionHref} className="vibrant-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold">
            {actionLabel}
          </Link>
        )}
        {!actionHref && actionLabel && onAction && (
          <button type="button" onClick={onAction} className="vibrant-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold">
            {actionLabel}
          </button>
        )}
        {onRetry && (
          <button type="button" onClick={onRetry} className="vibrant-btn-secondary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold">
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
