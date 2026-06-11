import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  noResultsText?: string;
  searchable?: boolean;
  className?: string;
  variant?: 'default' | 'compact' | 'inline';
  id?: string;
  name?: string;
  required?: boolean;
  'aria-label'?: string;
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  searchPlaceholder = 'Search…',
  disabled = false,
  loading = false,
  loadingText = 'Loading…',
  emptyText = 'No options',
  noResultsText = 'No matches',
  searchable = true,
  className,
  variant = 'default',
  id,
  name,
  required,
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 0 });

  const isDisabled = disabled || loading;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  /** Reserve a fixed trigger width from the longest label so the control does not resize on change. */
  const widthLabel = useMemo(() => {
    const labels = options.map((o) => o.label);
    if (placeholder) labels.push(placeholder);
    if (loadingText) labels.push(loadingText);
    return labels.reduce((longest, label) => (label.length > longest.length ? label : longest), '');
  }, [loadingText, options, placeholder]);

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlightIndex(0);
  }, []);

  const openMenu = useCallback(() => {
    if (isDisabled) return;
    updateMenuPosition();
    setOpen(true);
    setHighlightIndex(0);
  }, [isDisabled, updateMenuPosition]);

  const selectValue = useCallback(
    (next: string) => {
      onChange(next);
      close();
      triggerRef.current?.focus();
    },
    [close, onChange]
  );

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [close, open]);

  useEffect(() => {
    if (highlightIndex >= filtered.length) {
      setHighlightIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIndex]);

  const triggerClass = clsx(
    'col-start-1 row-start-1 w-full min-w-0 text-left flex items-center justify-between gap-2 transition-all outline-none relative',
    variant === 'default' && 'vibrant-select pr-10',
    variant === 'compact' && 'vibrant-input pr-10 py-2.5',
    variant === 'inline' && 'py-1.5 px-2 pr-8 text-sm font-semibold text-slate-800 dark:text-slate-200 bg-transparent border-none',
    isDisabled && 'opacity-70 cursor-not-allowed',
    !isDisabled && 'cursor-pointer',
    className
  );

  const sizerClass = clsx(
    'col-start-1 row-start-1 invisible whitespace-nowrap h-0 overflow-hidden pointer-events-none select-none',
    variant === 'inline' ? 'py-1.5 px-2 pr-8 text-sm font-semibold' : 'px-4 pr-10 text-sm font-medium'
  );

  const menu = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={listRef}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            top: menuStyle.top,
            left: menuStyle.left,
            width: menuStyle.width,
            zIndex: 9999,
          }}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-black/40 overflow-hidden"
        >
          {searchable && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlightIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/40"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      close();
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlightIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' && filtered[highlightIndex] && !filtered[highlightIndex].disabled) {
                      e.preventDefault();
                      selectValue(filtered[highlightIndex].value);
                    }
                  }}
                />
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto py-1">
            {loading && (
              <div className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {loadingText}
              </div>
            )}
            {!loading && options.length === 0 && (
              <div className="px-4 py-3 text-sm text-slate-500">{emptyText}</div>
            )}
            {!loading && options.length > 0 && filtered.length === 0 && (
              <div className="px-4 py-3 text-sm text-slate-500">{noResultsText}</div>
            )}
            {!loading &&
              filtered.map((option, index) => {
                const isSelected = option.value === value;
                const isHighlighted = index === highlightIndex;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => !option.disabled && selectValue(option.value)}
                    className={clsx(
                      'w-full px-4 py-2.5 text-left text-sm flex items-center justify-between gap-2 transition-colors',
                      option.disabled && 'opacity-40 cursor-not-allowed',
                      !option.disabled && 'cursor-pointer',
                      isHighlighted && 'bg-primary/10 text-primary',
                      !isHighlighted && isSelected && 'bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100',
                      !isHighlighted && !isSelected && 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    )}
                  >
                    <span className="whitespace-nowrap">{option.label}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative grid max-w-full',
        variant === 'inline' ? 'w-max' : 'w-full'
      )}
    >
      {name ? (
        <input type="hidden" name={name} value={value} required={required} />
      ) : null}

      <span className={sizerClass} aria-hidden="true">
        {widthLabel || '\u00A0'}
      </span>

      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        disabled={isDisabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerClass}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (isDisabled) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) openMenu();
          } else if (e.key === 'Escape') {
            close();
          }
        }}
      >
        <span className={clsx('min-w-0 whitespace-nowrap', !selected && 'text-slate-400 dark:text-slate-500')}>
          {loading ? loadingText : selected?.label ?? placeholder}
        </span>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className={clsx('w-4 h-4 transition-transform', open && 'rotate-180')} />}
        </span>
      </button>

      {typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </div>
  );
}
