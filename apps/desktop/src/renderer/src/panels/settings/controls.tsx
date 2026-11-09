import type { ReactNode } from 'react';
import clsx from 'clsx';

export function Toggle({
  on,
  onChange,
  label,
  testId,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-accent' : 'bg-border',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]',
          on ? 'left-3.5' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function SettingRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {detail && <div className="text-xs text-fg-subtle">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className="flex rounded-md border border-border bg-bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-value={option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded px-2 py-0.5 text-xs',
            value === option.value ? 'bg-bg text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 mb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase first:mt-0">{children}</h3>
  );
}

export const inputClass =
  'h-7 rounded border border-border bg-bg px-2 text-xs focus:border-accent focus:outline-none disabled:opacity-50';
