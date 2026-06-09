import { AlertCircle, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  onRetry?: () => void;
}

export default function EmptyState({ title, description, onRetry }: EmptyStateProps) {
  return (
    <div className="vibrant-card p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-slate-400" />
      </div>
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {onRetry && (
        <button onClick={onRetry} className="vibrant-btn-secondary mt-5 inline-flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}
