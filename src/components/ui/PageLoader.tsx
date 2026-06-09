import { Loader2 } from 'lucide-react';

interface PageLoaderProps {
  label?: string;
  compact?: boolean;
}

export default function PageLoader({ label = 'Loading data…', compact = false }: PageLoaderProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs font-semibold">{label}</span>
      </div>
    );
  }

  return (
    <div className="min-h-[260px] flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        {label}
      </p>
    </div>
  );
}
