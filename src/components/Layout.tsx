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
import { User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import CommandPalette from './CommandPalette';
import { getNavModules, isNavActive } from '../config/navigation';
import { ThemeMode, getStoredTheme, applyTheme, cycleTheme, themeLabel } from '../utils/theme';
import { dataService } from '../services/dataService';

interface LayoutProps {
  user: User;
}

export default function Layout({ user }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const location = useLocation();
  const navModules = useMemo(() => getNavModules(user.role), [user.role]);

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

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.reload();
  };

  const handleThemeToggle = () => {
    setThemeMode(cycleTheme(themeMode));
  };

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300 overflow-hidden">
      <CommandPalette userRole={user.role} />

      {/* Mobile overlay */}
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

      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -288, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -288, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed lg:relative inset-y-0 left-0 w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-30 shrink-0"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h1 className="text-lg font-black text-primary flex items-center gap-3 tracking-tight">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <School className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <span>FISS</span>
                  <span className="text-[9px] text-slate-400 uppercase tracking-widest font-black leading-tight">
                    Faizan Islamic School
                  </span>
                </div>
              </h1>
            </div>

            <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-thin space-y-5">
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
              <div className="px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-100 dark:border-orange-500/20">
                <p className="text-[9px] text-orange-500 uppercase font-black tracking-widest">Developer</p>
                <p className="text-xs font-black text-orange-600 dark:text-orange-300">Orangzaib khan baloch</p>
              </div>
              <div className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Signed in as</p>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{user.fullName}</p>
                <p className="text-[9px] font-black text-primary uppercase tracking-widest">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="nav-item w-full text-danger hover:bg-danger/10 hover:text-danger"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 lg:h-[4.5rem] vibrant-glass flex items-center justify-between px-4 lg:px-8 z-10 shrink-0">
          <div className="flex items-center gap-3 lg:gap-5">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-400 transition-all active:scale-95"
              aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center gap-3 lg:gap-5">
            <button
              type="button"
              onClick={handleThemeToggle}
              className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400 hover:text-primary transition-all active:scale-95"
              title={`Theme: ${themeLabel(themeMode)} — click to change`}
              aria-label={`Theme: ${themeLabel(themeMode)}`}
            >
              <ThemeIcon className="w-4 h-4" />
              <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest">
                {themeLabel(themeMode)}
              </span>
            </button>

            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center font-black text-sm shadow-md shadow-primary/20">
              {user.fullName.charAt(0)}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8 scroll-smooth">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
