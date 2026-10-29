import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from '../../context/I18nContext';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const confirmText = confirmLabel ?? t('common.confirm');
  const cancelText = cancelLabel ?? t('common.cancel');

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.button
            type="button"
            aria-label={t('common.close')}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="vibrant-card relative w-full max-w-md p-8 shadow-2xl border-none"
          >
            <div className="flex items-start gap-4">
              <div
                className={`p-3 rounded-2xl shrink-0 ${
                  variant === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h2 id="confirm-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
                  {title}
                </h2>
                <p id="confirm-dialog-message" className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {message}
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-3 mt-8">
              <button type="button" onClick={onCancel} className="vibrant-btn-secondary flex-1">
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`flex-1 ${variant === 'danger' ? 'vibrant-btn-danger' : 'vibrant-btn-primary'}`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
