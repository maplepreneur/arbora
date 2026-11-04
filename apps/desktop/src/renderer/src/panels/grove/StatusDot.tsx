import clsx from 'clsx';
import type { SessionStatus } from '@arbora/shared';

const DOT: Readonly<Record<SessionStatus, string>> = {
  needsYou: 'bg-attention',
  failed: 'bg-danger',
  working: 'bg-accent motion-safe:animate-pulse',
  starting: 'bg-fg-subtle motion-safe:animate-pulse',
  done: 'bg-accent',
  idle: 'bg-emerald-500',
  stopped: 'border border-fg-subtle',
};

export function StatusDot({ status, large = false }: { status: SessionStatus; large?: boolean }) {
  return (
    <span
      aria-hidden
      data-testid="session-dot"
      data-status={status}
      className={clsx('shrink-0 rounded-full', large ? 'h-2.5 w-2.5' : 'h-2 w-2', DOT[status])}
    />
  );
}
