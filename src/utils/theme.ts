export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return prefersDark();
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolveDark(mode));
  localStorage.setItem(STORAGE_KEY, mode);
}

export function getStoredTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

/** Call before React mount to avoid theme flash */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export function cycleTheme(current: ThemeMode): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(current) + 1) % order.length];
  applyTheme(next);
  return next;
}

export function themeLabel(mode: ThemeMode): string {
  if (mode === 'light') return 'Light';
  if (mode === 'dark') return 'Dark';
  return 'System';
}
