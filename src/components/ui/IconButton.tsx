import type { ButtonHTMLAttributes, ReactNode } from 'react';

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: 'default' | 'danger' | 'success';
  children: ReactNode;
};

const toneClass = {
  default: 'icon-btn',
  danger: 'icon-btn icon-btn-danger',
  success: 'icon-btn icon-btn-success',
};

export default function IconButton({
  label,
  tone = 'default',
  className = '',
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`${toneClass[tone]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
