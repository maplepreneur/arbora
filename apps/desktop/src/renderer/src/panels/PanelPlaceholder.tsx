import type { ReactNode } from 'react';

export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center border-b border-border px-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
      {children}
    </div>
  );
}

/** Empty state for panels whose content lands in a later build stage. */
export function PanelPlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-muted">
      <span className="font-medium text-fg">{title}</span>
      {children}
    </div>
  );
}
