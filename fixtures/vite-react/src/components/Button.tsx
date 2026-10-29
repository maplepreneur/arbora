import type { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      type="button"
      className={`self-start rounded-md px-4 py-2 font-medium ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
