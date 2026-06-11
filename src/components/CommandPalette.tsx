import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, User, School, X, Command, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Campus, UserRole } from '../types';
import { dataService } from '../services/dataService';
import { getFlatNavItems, getQuickActions } from '../config/navigation';

interface CommandPaletteProps {
  userRole: UserRole;
}

type SearchResult = {
  type: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  action: () => void;
};

type StudentHit = { id: string; firstName: string; lastName?: string; rollNumber: string };

export default function CommandPalette({ userRole }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const [students, setStudents] = useState<StudentHit[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const navigate = useNavigate();
  const navItems = useMemo(() => getFlatNavItems(userRole), [userRole]);
  const quickLinks = useMemo(() => getQuickActions(userRole).slice(0, 6), [userRole]);

  useEffect(() => {
    const unsubCampuses = dataService.subscribe('campuses', setCampuses);
    return () => unsubCampuses();
  }, []);

  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      setStudents([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const rows = await dataService.fetchStudentOptions({ search: query.trim(), limit: 5 });
        setStudents(rows);
      } catch {
        setStudents([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, query]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
    if (e.key === 'Escape') setIsOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const searchResults: SearchResult[] = [];

    students.forEach((s) => {
      searchResults.push({
        type: 'Student',
        title: `${s.firstName} ${s.lastName || ''}`.trim(),
        subtitle: s.rollNumber,
        icon: User,
        action: () => {
          navigate(`/students?id=${s.id}`);
          setIsOpen(false);
        },
      });
    });

    campuses
      .filter(
        (c) =>
          c.campusName.toLowerCase().includes(q) ||
          c.campusCode.toLowerCase().includes(q)
      )
      .slice(0, 3)
      .forEach((c) => {
        searchResults.push({
          type: 'Campus',
          title: c.campusName,
          subtitle: c.campusCode,
          icon: School,
          action: () => {
            navigate('/campuses');
            setIsOpen(false);
          },
        });
      });

    navItems
      .filter((item) => item.name.toLowerCase().includes(q))
      .forEach((item) => {
        searchResults.push({
          type: 'Navigate',
          title: item.name,
          subtitle: item.path,
          icon: item.icon,
          action: () => {
            navigate(item.path);
            setIsOpen(false);
          },
        });
      });

    return searchResults;
  }, [query, students, campuses, navigate, navItems]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] p-4 bg-slate-950/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -12 }}
            className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search students, campuses, or modules…"
                className="w-full bg-transparent text-lg outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="kbd-badge hidden sm:flex">
                <Command className="w-2.5 h-2.5" />K
              </kbd>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-2">
              {results.length > 0 ? (
                <div className="space-y-0.5">
                  {results.map((result, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={result.action}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-primary/5 dark:hover:bg-primary/10 group transition-all text-left"
                    >
                      <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl group-hover:bg-primary/10 text-slate-400 group-hover:text-primary transition-colors">
                        <result.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-slate-900 dark:text-white truncate">{result.title}</p>
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                            {result.type}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{result.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : query.trim() !== '' ? (
                <div className="p-10 text-center text-slate-400">
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
                </div>
              ) : (
                <div className="p-4">
                  <p className="nav-module-label mb-3">Quick navigation</p>
                  <div className="grid grid-cols-2 gap-2">
                    {quickLinks.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => {
                          navigate(item.path);
                          setIsOpen(false);
                        }}
                        className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-primary/30 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all text-left"
                      >
                        <item.icon className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">
                          {item.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[9px] font-black text-slate-400 uppercase tracking-widest">
              <span>Esc to close</span>
              <span>Ctrl+K toggle</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
