import { SelectHTMLAttributes } from 'react';
import FormField from './FormField';
import SearchableSelect, { SelectOption } from './SearchableSelect';

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'value'> {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  error?: string;
  placeholder?: string;
  loadingText?: string;
  searchable?: boolean;
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
  value,
  onChange,
  searchable = true,
  id,
  name,
}: SelectFieldProps) {
  const isDisabled = disabled || loading;

  const selectControl = (
    <SearchableSelect
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      loadingText={loadingText}
      placeholder={placeholder}
      disabled={isDisabled}
      required={required}
      searchable={searchable}
      className={`${error ? 'vibrant-input-error border-danger/60' : ''} ${className ?? ''}`}
    />
  );

  if (!label) return selectControl;

  return (
    <FormField label={label} required={required} error={error}>
      {selectControl}
    </FormField>
  );
}
