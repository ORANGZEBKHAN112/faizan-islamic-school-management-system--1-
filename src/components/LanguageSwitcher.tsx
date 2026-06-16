import { Languages } from 'lucide-react';
import { AppLanguage } from '../i18n';
import { useI18n } from '../context/I18nContext';

interface LanguageSwitcherProps {
  className?: string;
  compact?: boolean;
}

export default function LanguageSwitcher({ className = '', compact = false }: LanguageSwitcherProps) {
  const { language, setLanguage, t, languages } = useI18n();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && (
        <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest text-slate-400">
          {t('language.label')}
        </span>
      )}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <Languages className="w-3.5 h-3.5 text-slate-400 ms-1 hidden sm:block" aria-hidden />
        {(Object.keys(languages) as AppLanguage[]).map((code) => {
          const active = language === code;
          return (
            <button
              key={code}
              type="button"
              data-lang={code}
              onClick={() => setLanguage(code)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                active
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-500 hover:text-primary hover:bg-white dark:hover:bg-slate-900'
              }`}
              aria-pressed={active}
              title={t(languages[code].labelKey)}
            >
              {compact ? code.toUpperCase() : languages[code].nativeLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
