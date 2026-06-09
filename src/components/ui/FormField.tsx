import { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export default function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  className = '',
  children,
}: FormFieldProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={htmlFor} className="vibrant-label">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="field-error" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{hint}</p>
      )}
    </div>
  );
}
