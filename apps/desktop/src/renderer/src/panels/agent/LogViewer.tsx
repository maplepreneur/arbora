import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowDownToLine, Download, X } from 'lucide-react';
import type { AcpLogEntry } from '@arbora/shared';
import { showToast } from '../../store';
import { toggleLog, useAgents } from '../../agent-store';

type Direction = AcpLogEntry['direction'];

const DIRECTION_LABEL: Readonly<Record<Direction, string>> = { in: '←', out: '→', stderr: 'err', info: 'i' };
const DIRECTION_CLASS: Readonly<Record<Direction, string>> = {
  in: 'text-sky-600 dark:text-sky-400',
  out: 'text-emerald-600 dark:text-emerald-400',
  stderr: 'text-amber-600 dark:text-amber-400',
  info: 'text-fg-subtle',
};

function summarize(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    const method = typeof record['method'] === 'string' ? record['method'] : undefined;
    const rawId = record['id'];
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? `#${rawId}` : '';
    if (method) return `${method} ${id}`.trim();
    if ('error' in record) return `error ${id}`.trim();
    if ('result' in record) return `result ${id}`.trim();
  }
  return JSON.stringify(message);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function LogRow({ entry }: { entry: AcpLogEntry }) {
  const [open, setOpen] = useState(false);
  const expandable = typeof entry.message !== 'string';
  return (
    <li
      className="border-b border-border/60 font-mono text-[11px]"
      data-testid="log-row"
      data-direction={entry.direction}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={clsx('flex w-full items-start gap-2 px-2 py-0.5 text-left', expandable && 'hover:bg-bg-muted')}
      >
        <span className="shrink-0 text-fg-subtle tabular-nums">{formatTime(entry.at)}</span>
        <span className={clsx('w-6 shrink-0', DIRECTION_CLASS[entry.direction])}>
          {DIRECTION_LABEL[entry.direction]}
        </span>
        <span className="min-w-0 flex-1 truncate select-text">{summarize(entry.message)}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto bg-bg-muted px-2 py-1 whitespace-pre-wrap select-text">
          {JSON.stringify(entry.message, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** Raw JSON-RPC traffic (redacted in main) plus the agent's stderr. */
export function LogViewer({ threadId }: { threadId: string }) {
  const entries = useAgents((s) => s.logs[threadId]);
  const [filter, setFilter] = useState<'all' | 'rpc' | 'stderr'>('all');
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLUListElement>(null);
  const visible = useMemo(() => {
    const all = entries ?? [];
    if (filter === 'rpc') return all.filter((e) => e.direction === 'in' || e.direction === 'out');
    if (filter === 'stderr') return all.filter((e) => e.direction === 'stderr' || e.direction === 'info');
    return all;
  }, [entries, filter]);

  useEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [visible, follow]);

  const exportLog = async (): Promise<void> => {
    const result = await window.arbora.invoke('agent.exportLog', { threadId });
    if (result.path) showToast(`Log saved to ${result.path}`);
  };

  return (
    <div className="flex h-[45%] min-h-[120px] shrink-0 flex-col border-t border-border bg-bg" data-testid="acp-log">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2 text-[11px]">
        <span className="font-medium">ACP log</span>
        {(['all', 'rpc', 'stderr'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={clsx(
              'h-5 rounded px-1.5',
              filter === id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {id === 'rpc' ? 'JSON-RPC' : id === 'stderr' ? 'stderr' : 'All'}
          </button>
        ))}
        <span className="ml-auto text-fg-subtle">{visible.length}</span>
        <button
          type="button"
          title="Follow output"
          aria-pressed={follow}
          onClick={() => setFollow((f) => !f)}
          className={clsx(
            'flex h-5 w-5 items-center justify-center rounded',
            follow ? 'text-accent' : 'text-fg-subtle hover:text-fg',
          )}
        >
          <ArrowDownToLine size={12} />
        </button>
        <button
          type="button"
          title="Export log"
          aria-label="Export log"
          data-testid="export-log"
          onClick={() => void exportLog()}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-fg"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          title="Close log"
          aria-label="Close log"
          onClick={toggleLog}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-fg"
        >
          <X size={12} />
        </button>
      </div>
      <ul
        ref={list}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 20);
        }}
      >
        {visible.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-fg-subtle">No traffic yet.</li>
        ) : (
          visible.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </ul>
    </div>
  );
}
