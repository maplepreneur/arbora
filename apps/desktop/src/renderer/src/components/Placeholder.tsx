import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Placeholder({ icon: Icon, title, stage, children }: { icon: LucideIcon; title: string; stage: number; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-fg-subtle">
      <Icon size={22} strokeWidth={1.5} />
      <div className="font-medium text-fg-muted">{title}</div>
      <div className="text-xs">Arrives in Stage {stage}</div>
      {children}
    </div>
  );
}
