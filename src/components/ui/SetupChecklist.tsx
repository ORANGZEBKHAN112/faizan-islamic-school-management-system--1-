import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

interface SetupChecklistProps {
  steps: SetupStep[];
}

export default function SetupChecklist({ steps }: SetupChecklistProps) {
  const pending = steps.filter((s) => !s.done);
  if (pending.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="vibrant-card p-6 border-primary/20 bg-primary/5"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="section-label text-primary">Getting started</p>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {pending.length} step{pending.length === 1 ? '' : 's'} to complete setup
          </h3>
        </div>
        <span className="text-sm font-semibold text-slate-500">
          {steps.filter((s) => s.done).length}/{steps.length} done
        </span>
      </div>
      <ul className="space-y-2">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.href}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                step.done
                  ? 'border-success/20 bg-success/5 opacity-70'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/40 hover:shadow-sm'
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{step.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{step.description}</p>
              </div>
              {!step.done && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            </Link>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
