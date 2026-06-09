import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService';
import { LogIn, UserPlus, ShieldCheck, X, Sun, Moon, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import FormField from '../components/ui/FormField';
import { collectErrors, hasErrors, required } from '../utils/validation';
import { ThemeMode, getStoredTheme, cycleTheme, themeLabel } from '../utils/theme';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = collectErrors({
      username: required(username, 'Username'),
      password: required(password, 'Password'),
    });
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await authService.login({ username, passwordHash: password });
      if (!response?.token) {
        toast.error('Login failed: no session token received. Please try again.');
        return;
      }
      localStorage.setItem('token', response.token.trim());
      localStorage.setItem('user', JSON.stringify(response.user));
      toast.success('Successfully logged in!');
      window.location.reload();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data || 'Authentication failed';
      const finalError = typeof errorMessage === 'string' ? errorMessage : 'Authentication failed';
      setError(finalError);
      toast.error(finalError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex transition-colors duration-500 overflow-hidden">
      {/* Left Side - Hero Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden group">
        <img 
          src="https://picsum.photos/seed/masjid-faizan/1200/800" 
          alt="Masjid Faizan-e-Madinah" 
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-secondary/90 via-secondary/40 to-transparent flex flex-col justify-end p-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="max-w-lg"
          >
            <h2 className="text-5xl font-black text-white mb-6 leading-tight tracking-tight">Essential Education with Tarbiyah</h2>
            <p className="text-white/80 text-lg font-medium leading-relaxed">Faizan Islamic School System provides a balanced approach to modern education and Islamic values.</p>
          </motion.div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <button
          type="button"
          onClick={() => setThemeMode(cycleTheme(themeMode))}
          className="absolute top-6 right-6 flex items-center gap-2 p-2.5 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 hover:text-primary transition-all z-20"
          title={`Theme: ${themeLabel(themeMode)}`}
        >
          <ThemeIcon className="w-4 h-4" />
          <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{themeLabel(themeMode)}</span>
        </button>
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-secondary/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-md w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl shadow-primary/10 p-10 border border-white dark:border-slate-800 relative z-10"
        >
          <div className="text-center mb-10">
            <motion.div 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center w-24 h-24 bg-white dark:bg-slate-800 rounded-3xl mb-6 shadow-xl shadow-primary/10 border border-slate-100 dark:border-slate-700 overflow-hidden"
            >
              <img 
                src="https://picsum.photos/seed/fiss-logo/200/200" 
                alt="FISS Logo" 
                className="w-16 h-16 object-contain"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">FISS</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium mt-2 uppercase tracking-widest text-[10px]">Faizan Islamic School System</p>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 p-4 bg-danger/10 text-danger text-xs font-bold rounded-2xl border border-danger/20 flex items-center gap-3"
              >
                <div className="p-1 bg-danger text-white rounded-full">
                  <X className="w-3 h-3" />
                </div>
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <FormField label="Username" htmlFor="username" required error={fieldErrors.username}>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                  <UserPlus className="w-5 h-5" />
                </div>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  className={`vibrant-input pl-12 ${fieldErrors.username ? 'vibrant-input-error' : ''}`}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (fieldErrors.username) setFieldErrors((p) => ({ ...p, username: '' }));
                  }}
                  placeholder="Enter your username"
                />
              </div>
            </FormField>

            <FormField label="Password" htmlFor="password" required error={fieldErrors.password}>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className={`vibrant-input pl-12 ${fieldErrors.password ? 'vibrant-input-error' : ''}`}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: '' }));
                  }}
                  placeholder="••••••••"
                />
              </div>
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full vibrant-btn-primary py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 mt-8 flex items-center justify-center gap-3"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link
              to="/apply"
              className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Apply for admission online
            </Link>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-50">Developed by Oranzeb Khan Baloch</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
