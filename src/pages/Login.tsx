import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService';
import {
  LogIn, UserRound, ShieldCheck, X, Sun, Moon, Monitor, ArrowRight, Eye, EyeOff, Fingerprint,
} from 'lucide-react';
import {
  motion, AnimatePresence, useMotionTemplate, useMotionValue, useSpring, useTransform,
} from 'motion/react';
import { toast } from 'sonner';
import FormField from '../components/ui/FormField';
import DevCredit from '../components/ui/DevCredit';
import { collectErrors, hasErrors, required } from '../utils/validation';
import { ThemeMode, getStoredTheme, cycleTheme, applyTheme } from '../utils/theme';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../context/I18nContext';

const easeOut = [0.22, 1, 0.36, 1] as const;

/** Soft Islamic-inspired 8-point star lattice (decorative only). */
function GeometricMesh() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
      <defs>
        <pattern id="fiss-star" width="72" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M36 4 L42 28 L66 36 L42 44 L36 68 L30 44 L6 36 L30 28 Z"
            fill="none"
            stroke="#00a99d"
            strokeWidth="1"
          />
          <circle cx="36" cy="36" r="2" fill="#00a99d" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#fiss-star)" />
    </svg>
  );
}

function Constellation() {
  const nodes = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: 8 + ((i * 37) % 84),
        y: 10 + ((i * 53) % 80),
      })),
    []
  );
  const links = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (dx * dx + dy * dy < 420) out.push([i, j]);
      }
    }
    return out;
  }, [nodes]);

  return (
    <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {links.map(([a, b], i) => (
        <motion.line
          key={`${a}-${b}`}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          stroke="rgba(0,169,157,0.35)"
          strokeWidth="0.15"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0.2, 0.55, 0.2] }}
          transition={{ duration: 4 + (i % 5), delay: i * 0.08, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.circle
          key={n.id}
          cx={n.x}
          cy={n.y}
          r="0.45"
          fill="#00a99d"
          animate={{ r: [0.35, 0.7, 0.35], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 3 + (i % 4), delay: i * 0.12, repeat: Infinity }}
        />
      ))}
    </svg>
  );
}

function TypeLine({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [text]);
  return (
    <p className={className}>
      {shown}
      <motion.span
        className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-primary align-middle"
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: Infinity }}
      />
    </p>
  );
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shakePanel, setShakePanel] = useState(0);
  const [focused, setFocused] = useState<'user' | 'pass' | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 80, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 80, damping: 20 });
  const rotateX = useTransform(springY, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-10, 10]);
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(40);
  const glowBg = useMotionTemplate`radial-gradient(520px circle at ${glowX}% ${glowY}%, rgba(0,169,157,0.22), transparent 55%)`;

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor;
  const themeName = t(`theme.${themeMode}`);
  const brandLetters = String(t('login.title') || 'FISS').split('');

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

  const onPointerMove = (e: React.PointerEvent) => {
    const { clientX, clientY } = e;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    glowX.set((clientX / w) * 100);
    glowY.set((clientY / h) * 100);

    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width - 0.5;
    const py = (clientY - rect.top) / rect.height - 0.5;
    mouseX.set(px);
    mouseY.set(py);
  };

  const onPointerLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = collectErrors({
      username: required(username, t('login.username')),
      password: required(password, t('login.password')),
    });
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      setShakePanel((n) => n + 1);
      toast.error(t('login.fixFields'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await authService.login({ username, passwordHash: password });
      if (!response?.token) {
        setShakePanel((n) => n + 1);
        toast.error(t('login.noToken'));
        return;
      }
      localStorage.setItem('token', response.token.trim());
      localStorage.setItem('user', JSON.stringify(response.user));
      toast.success(t('login.success'));
      window.location.reload();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data || t('login.authFailed');
      const finalError = typeof errorMessage === 'string' ? errorMessage : t('login.authFailed');
      setError(finalError);
      setShakePanel((n) => n + 1);
      toast.error(finalError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#010c12] text-white"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {/* Living background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(155deg,#010c12_0%,#003b5c_48%,#012018_100%)]" />
        <GeometricMesh />
        <Constellation />
        <motion.div className="absolute inset-0" style={{ background: glowBg }} />
        <motion.div
          className="absolute -left-32 top-0 h-[40rem] w-[40rem] rounded-full bg-primary/20 blur-[120px]"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-20 bottom-0 h-[36rem] w-[36rem] rounded-full bg-[#005a8c]/50 blur-[100px]"
          animate={{ x: [0, -40, 0], y: [0, -30, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute left-1/2 top-0 h-px w-[70%] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent"
          animate={{ opacity: [0.2, 0.8, 0.2], scaleX: [0.7, 1, 0.7] }}
          transition={{ duration: 5, repeat: Infinity }}
        />
      </div>

      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-5 end-5 z-30 flex items-center gap-2"
      >
        <LanguageSwitcher compact />
        <motion.button
          type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setThemeMode(cycleTheme(themeMode))}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-white/70 backdrop-blur-md hover:border-primary/40 hover:text-white"
          title={`${themeName} — ${t('theme.change')}`}
        >
          <ThemeIcon className="h-4 w-4" />
        </motion.button>
      </motion.div>

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl place-items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-10">
        {/* Left: brand stage */}
        <div className="relative w-full max-w-xl justify-self-start">
          <motion.div
            className="absolute -left-6 top-8 hidden h-40 w-40 lg:block"
            animate={{ rotate: 360 }}
            transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}
          >
            <div className="h-full w-full rounded-full border border-dashed border-primary/25" />
            <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_16px_#00a99d]" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: easeOut }}
            className="relative mb-8 inline-flex"
          >
            <motion.div
              className="absolute -inset-4 rounded-[2rem] border border-primary/30"
              animate={{ rotate: [0, 6, -4, 0], scale: [1, 1.03, 1] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute -inset-8 rounded-[2.5rem] border border-white/5"
              animate={{ rotate: [0, -8, 5, 0] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative rounded-[1.75rem] border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
              <img src="/fiss-logo.svg" alt="FISS" className="h-24 w-24 object-contain sm:h-28 sm:w-28" />
            </div>
          </motion.div>

          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.35em] text-primary">
            <Fingerprint className="h-3.5 w-3.5" />
            Neural campus gate
          </div>

          <h1 className="flex flex-wrap gap-1 text-6xl font-black tracking-tighter sm:text-7xl xl:text-8xl">
            {brandLetters.map((letter, i) => (
              <motion.span
                key={`${letter}-${i}`}
                initial={{ opacity: 0, y: 40, rotateX: 40 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.6, ease: easeOut }}
                whileHover={{ y: -6, color: '#00a99d', textShadow: '0 0 24px rgba(0,169,157,0.6)' }}
                className="inline-block cursor-default bg-gradient-to-b from-white via-[#d7fffa] to-primary bg-clip-text text-transparent"
              >
                {letter}
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/45"
          >
            {t('login.subtitle')}
          </motion.p>

          <div className="mt-6 max-w-md">
            <TypeLine
              text={t('login.heroTitle')}
              className="min-h-[3.5rem] text-2xl font-bold leading-snug text-white/90 sm:text-3xl"
            />
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4 }}
              className="mt-3 text-base leading-relaxed text-white/50"
            >
              {t('login.heroBody')}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.7 }}
            className="mt-10 hidden gap-2 lg:flex"
          >
            {['Realtime fees', 'Multi-campus', 'Tarbiyah-first'].map((chip, i) => (
              <motion.span
                key={chip}
                whileHover={{ scale: 1.06, backgroundColor: 'rgba(0,169,157,0.18)' }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.8 + i * 0.1 }}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white/55"
              >
                {chip}
              </motion.span>
            ))}
          </motion.div>

          <div className="mt-12 hidden lg:block">
            <DevCredit compact className="!justify-start !text-white/35 [&_strong]:!text-white/50" />
          </div>
        </div>

        {/* Right: holographic auth card */}
        <motion.div
          ref={cardRef}
          key={shakePanel}
          style={{
            rotateX: shakePanel === 0 ? rotateX : 0,
            rotateY: shakePanel === 0 ? rotateY : 0,
            transformPerspective: 1100,
          }}
          initial={shakePanel === 0 ? { opacity: 0, y: 40, scale: 0.96 } : false}
          animate={
            shakePanel === 0
              ? { opacity: 1, y: 0, scale: 1 }
              : { x: [0, -12, 12, -8, 8, 0], opacity: 1 }
          }
          transition={shakePanel === 0 ? { delay: 0.2, duration: 0.7, ease: easeOut } : { duration: 0.42 }}
          className="relative w-full max-w-md justify-self-center lg:justify-self-end"
        >
          <div className="absolute -inset-[1px] rounded-[1.85rem] bg-gradient-to-br from-primary via-white/20 to-accent opacity-70" />
          <div className="relative overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#03151c]/90 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-9">
            {/* Holo sheen */}
            <motion.div
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,rgba(255,255,255,0.08)_45%,transparent_70%)]"
              animate={{ x: ['-40%', '40%', '-40%'] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

            <div className="relative mb-7 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-primary">Access portal</p>
                <h3 className="mt-1 text-2xl font-black tracking-tight">Authenticate</h3>
                <p className="mt-1 text-xs text-white/45">Staff username · Student roll</p>
              </div>
              <motion.div
                animate={{ boxShadow: ['0 0 0 0 rgba(0,169,157,0.4)', '0 0 0 12px rgba(0,169,157,0)', '0 0 0 0 rgba(0,169,157,0.4)'] }}
                transition={{ duration: 2.4, repeat: Infinity }}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10"
              >
                <Fingerprint className="h-6 w-6 text-primary" />
              </motion.div>
            </div>

            {/* Live status strip */}
            <div className="relative mb-6 flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-[10px] text-primary/90">
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              <span className="truncate">
                {focused === 'user'
                  ? '> awaiting identity…'
                  : focused === 'pass'
                    ? '> verifying credentials…'
                    : loading
                      ? '> opening session…'
                      : '> system ready'}
              </span>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="relative mb-5 flex items-center gap-3 rounded-2xl border border-danger/35 bg-danger/15 p-3.5 text-xs font-bold text-red-200"
                >
                  <X className="h-4 w-4 shrink-0 text-danger" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <form
              onSubmit={handleSubmit}
              className="relative space-y-4 [&_.vibrant-label]:text-[10px] [&_.vibrant-label]:font-black [&_.vibrant-label]:uppercase [&_.vibrant-label]:tracking-widest [&_.vibrant-label]:text-white/50 [&_.field-error]:text-red-300"
              noValidate
            >
              <FormField label={t('login.username')} htmlFor="username" required error={fieldErrors.username}>
                <div className="relative group">
                  <UserRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-primary" />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    onFocus={() => setFocused('user')}
                    onBlur={() => setFocused(null)}
                    className={`w-full rounded-2xl border bg-black/25 py-3.5 pl-12 pr-4 text-white outline-none transition-all placeholder:text-white/25 focus:bg-black/40 focus:ring-2 focus:ring-primary/35 ${
                      fieldErrors.username ? 'border-danger/60' : focused === 'user' ? 'border-primary/50' : 'border-white/12'
                    }`}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username) setFieldErrors((p) => ({ ...p, username: '' }));
                    }}
                    placeholder={t('login.usernamePlaceholder')}
                  />
                </div>
              </FormField>

              <FormField label={t('login.password')} htmlFor="password" required error={fieldErrors.password}>
                <div className="relative group">
                  <ShieldCheck className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-primary" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    onFocus={() => setFocused('pass')}
                    onBlur={() => setFocused(null)}
                    className={`w-full rounded-2xl border bg-black/25 py-3.5 pl-12 pr-12 text-white outline-none transition-all placeholder:text-white/25 focus:bg-black/40 focus:ring-2 focus:ring-primary/35 ${
                      fieldErrors.password ? 'border-danger/60' : focused === 'pass' ? 'border-primary/50' : 'border-white/12'
                    }`}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: '' }));
                    }}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/35 hover:bg-white/5 hover:text-white/80"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.02 }}
                whileTap={{ scale: loading ? 1 : 0.97 }}
                className="relative mt-3 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-primary via-[#12c4b5] to-primary bg-[length:200%_100%] py-4 text-sm font-black text-[#022] shadow-[0_12px_40px_rgba(0,169,157,0.35)] disabled:opacity-60"
              >
                <motion.span
                  className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', repeatDelay: 0.8 }}
                />
                {loading ? (
                  <motion.span
                    className="h-5 w-5 rounded-full border-2 border-[#022]/40 border-t-[#022]"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.65, repeat: Infinity, ease: 'linear' }}
                  />
                ) : (
                  <>
                    <LogIn className="relative h-5 w-5" />
                    <span className="relative">{t('login.signIn')}</span>
                    <ArrowRight className="relative h-4 w-4" />
                  </>
                )}
              </motion.button>
            </form>

            <div className="relative mt-7 space-y-2 border-t border-white/10 pt-5 text-center">
              <Link to="/apply" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                {t('login.applyLink')} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <div>
                <Link to="/track" className="text-xs text-white/40 hover:text-white/70">
                  {t('login.trackLink')}
                </Link>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="lg:hidden">
          <DevCredit compact className="!justify-center !text-white/35 [&_strong]:!text-white/50" />
        </div>
      </div>
    </div>
  );
}
