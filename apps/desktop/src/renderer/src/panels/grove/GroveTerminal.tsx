import { useEffect, useRef } from 'react';
import { formatUsage, useGrove } from '../../grove-store';
import { ensureSession } from '../terminal/sessions';

/** One live terminal for the Grove selection, including the output from before it was selected. */
export function GroveTerminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const usage = useGrove((s) => s.usage.find((entry) => entry.kind === 'terminal' && entry.id === id));
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const session = ensureSession(id);
    session.attach(container);
    session.focus();
    return () => session.detach(container);
  }, [id]);
  return (
    <section data-testid="grove-terminal-pane" className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px] text-fg-subtle">
        <span className="text-fg">Terminal</span>
        {usage && <span data-testid="grove-memory">{formatUsage(usage.rssKb, usage.cpuPercent)}</span>}
      </header>
      <div ref={host} className="min-h-0 flex-1" />
    </section>
  );
}
