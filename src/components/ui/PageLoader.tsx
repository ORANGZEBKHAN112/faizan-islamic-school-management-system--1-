import { Loader2 } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';

interface PageLoaderProps {
  label?: string;
  compact?: boolean;
}

export default function PageLoader({ label, compact = false }: PageLoaderProps) {
  const { t } = useI18n();
  const text = label ?? t('common.loading');

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs font-semibold">{text}</span>
      </div>
    );
  }

  return (
    <div className="min-h-[260px] flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}
