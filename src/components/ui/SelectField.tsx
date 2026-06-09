import { SelectHTMLAttributes } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import FormField from './FormField';

interface Option {
  value: string;
  label: string;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  options: Option[];
  loading?: boolean;
  error?: string;
  placeholder?: string;
  loadingText?: string;
}

export default function SelectField({
  label,
  options,
  loading = false,
  error,
  placeholder = 'Select option',
  loadingText = 'Loading…',
  disabled,
  required,
  className,
  ...props
}: SelectFieldProps) {
  const isDisabled = disabled || loading;

  const selectControl = (
    <div className="relative">
      <select
        {...props}
        disabled={isDisabled}
        required={required}
        className={`vibrant-select appearance-none pr-10 ${error ? 'vibrant-input-error' : ''} ${isDisabled ? 'opacity-70 cursor-not-allowed' : ''} ${className ?? ''}`}
      >
        <option value="">{loading ? loadingText : placeholder}</option>
        {!loading &&
          options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
      </div>
    </div>
  );

  if (!label) return selectControl;

  return (
    <FormField label={label} required={required} error={error}>
      {selectControl}
    </FormField>
  );
}
