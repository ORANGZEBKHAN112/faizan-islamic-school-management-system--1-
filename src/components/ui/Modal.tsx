import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useI18n } from '../../context/I18nContext';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

const sizeClass = {
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export default function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  const { t } = useI18n();

  return (
    <AnimatePresence>
      {open && (
        <div className="app-modal">
          <motion.button
            type="button"
            aria-label={t('common.close')}
            className="absolute inset-0 cursor-default"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-modal-title"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className={`modal-panel relative ${sizeClass[size]} max-h-[90vh] flex flex-col`}
          >
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h2 id="app-modal-title" className="modal-title">{title}</h2>
              <button type="button" onClick={onClose} className="icon-btn shrink-0" aria-label={t('common.close')}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto">{children}</div>
            {footer ? (
              <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col-reverse sm:flex-row gap-3">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
