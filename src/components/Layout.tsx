import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  School,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { Campus, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import CommandPalette from './CommandPalette';
import DevCredit from './ui/DevCredit';
import LanguageSwitcher from './LanguageSwitcher';
import { getNavModules, getPageTitle, isNavActive } from '../config/navigation';
import { ThemeMode, getStoredTheme, applyTheme, cycleTheme } from '../utils/theme';
import { dataService } from '../services/dataService';
import { usePermissions } from '../context/PermissionContext';
import { useI18n } from '../context/I18nContext';
import { toast } from 'sonner';
import { isSchoolWideUser } from '../utils/campusScope';

interface LayoutProps {
  user: User;
}

export default function Layout({ user }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [campusName, setCampusName] = useState<string | null>(null);
  const location = useLocation();
  const { canView } = usePermissions();
  const { t, isRtl } = useI18n();
  const navModules = useMemo(() => getNavModules(user.role, canView, t), [user.role, canView, t]);
  const pageTitle = useMemo(
    () => getPageTitle(location.pathname, user.role, canView, t),
    [location.pathname, user.role, canView, t]
  );
  const sidebarOffset = isRtl ? 288 : -288;

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (themeMode === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode]);

  useEffect(() => {
    setIsSidebarOpen(window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    dataService.prefetchReferenceData().catch((err) => {
      console.error('Reference data prefetch failed:', err);
    });
  }, []);

  // #42 Campus-wise new inquiry reminders (Head Office sees all)
  useEffect(() => {
    if (!canView('admissions')) return;
    let cancelled = false;
    const seenKey = `inquiry-toast-seen:${user.id || user.username}`;
    const loadSeen = (): Set<string> => {
      try {
        return new Set(JSON.parse(localStorage.getItem(seenKey) || '[]') as string[]);
      } catch {
        return new Set();
      }
    };
    const saveSeen = (ids: Set<string>) => {
      localStorage.setItem(seenKey, JSON.stringify([...ids].slice(-200)));
    };

    const poll = async () => {
      try {
        const params: Record<string, string> = { status: 'Pending', limit: '30' };
        if (!isSchoolWideUser(user) && user.campusId) params.campusId = user.campusId;
        const raw = await dataService.fetchAdmissions(params);
        const list = Array.isArray(raw) ? raw : [];
        const rows = list.filter((r) => {
          const st = String(r?.status || '');
          return st === 'Pending' || st === 'Under Review';
        }) as Array<{
          id: string;
          applicantName?: string;
          campusName?: string;
          appliedOn?: string;
          status?: string;
        }>;
        if (cancelled || rows.length === 0) return;
        const seen = loadSeen();
        const fresh = rows.filter((r) => r?.id && !seen.has(r.id));
        if (fresh.length > 0) {
          const sample = fresh.slice(0, 3);
          toast.info(
            fresh.length === 1
              ? `New inquiry: ${sample[0].applicantName || 'Applicant'}${sample[0].campusName ? ` (${sample[0].campusName})` : ''}`
              : `${fresh.length} new admission inquiries`,
            {
              description: sample.map((r) => r.applicantName || r.id).join(', '),
              duration: 8000,
              action: {
                label: 'Open',
                onClick: () => { window.location.href = '/admissions'; },
              },
            }
          );
          fresh.forEach((r) => seen.add(r.id));
          saveSeen(seen);
        }

        // One reminder per session for inquiries pending 1+ days
        const remindKey = `inquiry-stale-reminded:${user.id || user.username}`;
        if (!sessionStorage.getItem(remindKey)) {
          const now = Date.now();
          const stale = rows.filter((r) => {
            if (!r.appliedOn) return false;
            const ageDays = (now - new Date(r.appliedOn).getTime()) / 86400000;
            return ageDays >= 1;
          });
          if (stale.length > 0) {
            sessionStorage.setItem(remindKey, '1');
            toast.warning(`${stale.length} inquiry reminder(s) pending 1+ day`, {
              description: 'Follow up on pending admission inquiries.',
              duration: 6000,
            });
          }
        }
      } catch {
        // non-fatal
      }
    };

    poll();
    const timer = window.setInterval(poll, 120000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user, canView]);

  useEffect(() => {
    const ids = user.campusIds?.length ? user.campusIds : (user.campusId ? [user.campusId] : []);
    if (!ids.length) {
      setCampusName(null);
      return;
    }
    let cancelled = false;
    dataService.fetchCampuses().then((campuses: Campus[]) => {
      if (cancelled) return;
      const names = ids
        .map((id) => campuses.find((c) => c.id === id)?.campusName)
        .filter(Boolean) as string[];
      if (names.length === 0) {
        setCampusName(null);
      } else if (names.length === 1) {
        setCampusName(names[0]);
      } else {
        setCampusName(`${names[0]} +${names.length - 1} campuses`);
      }
    }).catch(() => {
      if (!cancelled) setCampusName(null);
    });
    return () => { cancelled = true; };
  }, [user.campusId, user.campusIds]);

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.reload();
  };

  const handleThemeToggle = () => {
    setThemeMode(cycleTheme(themeMode));
  };

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;
  const themeName = t(`theme.${themeMode}`);

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300 overflow-hidden">
      <CommandPalette userRole={user.role} />

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/50 z-20 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: sidebarOffset, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: sidebarOffset, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed lg:relative inset-y-0 start-0 w-72 bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 flex flex-col z-30 shrink-0"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h1 className="text-lg font-black text-primary flex items-center gap-3 tracking-tight">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <School className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <span className="flex items-center gap-2">
                    {t('app.name')}
                    <span className="beta-badge">{t('app.beta')}</span>
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase tracking-widest font-black leading-tight">
                    {t('app.schoolName')}
                  </span>
                </div>
              </h1>
            </div>

            <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-thin space-y-5">
              {navModules.length === 0 && (
                <div className="px-3 py-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('layout.noModules')}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {t('layout.noModulesHint')}
                  </p>
                </div>
              )}
              {navModules.map((module) => (
                <div key={module.id}>
                  <p className="nav-module-label">{module.label}</p>
                  <ul className="space-y-0.5 mt-1.5">
                    {module.items.map((item) => {
                      const Icon = item.icon;
                      const active = isNavActive(location.pathname, item.path);
                      return (
                        <li key={item.path}>
                          <Link
                            to={item.path}
                            onClick={() => window.innerWidth < 1024 && setIsSidebarOpen(false)}
                            className={`nav-item ${active ? 'nav-item-active' : ''}`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <p className="section-label">{t('layout.signedInAs')}</p>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate mt-0.5">{user.fullName}</p>
                <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">{user.username}</p>
                <p className="text-[10px] font-semibold text-primary mt-0.5">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="nav-item w-full text-danger hover:bg-danger/10 hover:text-danger"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('layout.logout')}</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 lg:h-[4.5rem] vibrant-glass flex items-center justify-between gap-4 px-4 lg:px-8 z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-95 shrink-0"
              aria-label={isSidebarOpen ? t('layout.closeMenu') : t('layout.openMenu')}
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="min-w-0 hidden sm:block">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm lg:text-base font-bold text-slate-900 dark:text-white truncate">{pageTitle}</h2>
                <span className="beta-badge hidden md:inline-flex">{t('app.beta')}</span>
              </div>
              {(campusName || user.role) && (
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {campusName ? campusName : user.role}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3 shrink-0">
            <kbd className="kbd-badge hidden xl:flex" title={t('layout.commandPalette')}>
              Ctrl+K
            </kbd>
            <LanguageSwitcher compact />
            <button
              type="button"
              onClick={handleThemeToggle}
              className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400 hover:text-primary transition-all active:scale-95"
              title={`${themeName} — ${t('theme.change')}`}
              aria-label={`${themeName}`}
            >
              <ThemeIcon className="w-4 h-4" />
              <span className="hidden lg:inline text-xs font-semibold">
                {themeName}
              </span>
            </button>

            <div
              className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center font-bold text-sm shadow-md shadow-primary/20"
              title={`${user.fullName} · ${user.username}`}
            >
              {user.fullName.charAt(0)}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8 scroll-smooth">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Outlet />
            <DevCredit />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
