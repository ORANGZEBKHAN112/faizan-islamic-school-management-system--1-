import { ar } from './locales/ar';
import { en } from './locales/en';
import { ur } from './locales/ur';

export type AppLanguage = 'en' | 'ur' | 'ar';

export const LANGUAGES: Record<
  AppLanguage,
  { labelKey: string; nativeLabel: string; dir: 'ltr' | 'rtl' }
> = {
  en: { labelKey: 'language.en', nativeLabel: 'English', dir: 'ltr' },
  ur: { labelKey: 'language.ur', nativeLabel: 'اردو', dir: 'rtl' },
  ar: { labelKey: 'language.ar', nativeLabel: 'العربية', dir: 'rtl' },
};

const STORAGE_KEY = 'lang';

const catalogs: Record<AppLanguage, typeof en> = { en, ur, ar };

function getNested(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function translate(
  language: AppLanguage,
  key: string,
  params?: Record<string, string | number>
): string {
  const value = getNested(catalogs[language] as Record<string, unknown>, key)
    ?? getNested(catalogs.en as Record<string, unknown>, key)
    ?? key;

  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''));
}

export function getStoredLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'ur' || saved === 'ar') return saved;
  return 'en';
}

export function applyDocumentLanguage(language: AppLanguage): void {
  const root = document.documentElement;
  root.lang = language;
  root.dir = LANGUAGES[language].dir;
  localStorage.setItem(STORAGE_KEY, language);
}

export function initLanguage(): AppLanguage {
  const language = getStoredLanguage();
  applyDocumentLanguage(language);
  return language;
}

export function isRtlLanguage(language: AppLanguage): boolean {
  return LANGUAGES[language].dir === 'rtl';
}
