import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  AppLanguage,
  applyDocumentLanguage,
  getStoredLanguage,
  isRtlLanguage,
  LANGUAGES,
  translate,
} from '../i18n';

interface I18nContextValue {
  language: AppLanguage;
  isRtl: boolean;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  languages: typeof LANGUAGES;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => getStoredLanguage());

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    applyDocumentLanguage(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(language, key, params),
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      isRtl: isRtlLanguage(language),
      setLanguage,
      t,
      languages: LANGUAGES,
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
