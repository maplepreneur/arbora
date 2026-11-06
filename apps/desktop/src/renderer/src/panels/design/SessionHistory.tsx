import { useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { AgentModeTarget, DesignSessionDetail, DesignSessionSummary } from '@arbora/shared';
import { exportDesignSession, resendDesignSession } from '../../commands';
import { showToast } from '../../store';

function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/**
 * Saved design sessions: the list, a before/after compare, resend, and Markdown export.
 * Compare stays in this column so the page underneath is left as it is.
 */
export function SessionHistory({
  sessions,
  target,
}: {
  sessions: readonly DesignSessionSummary[];
  target: AgentModeTarget | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DesignSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  if (sessions.length === 0) return null;

  const toggle = (id: string): void => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    const mine = ++request.current;
    setOpenId(id);
    setDetail(null);
    setLoading(true);
    void window.arbora
      .invoke('design.readSession', { id })
      .then((next) => {
        if (request.current === mine) setDetail(next);
      })
      .catch((error: unknown) => {
        if (request.current !== mine) return;
        setOpenId(null);
        showToast(ipcError(error));
      })
      .finally(() => {
        if (request.current === mine) setLoading(false);
      });
  };

  return (
    <section className="flex flex-col gap-2 border-t border-border px-3 py-3" data-testid="design-sessions">
      <h3 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Earlier sessions</h3>
      {sessions.map((session) => {
        const open = openId === session.id;
        const shown = open && detail?.id === session.id ? detail : null;
        return (
          <div key={session.id} className="flex flex-col gap-1 text-[11px]" data-testid="design-session">
            <span className="min-w-0 truncate text-fg-muted" title={session.url}>
              {new Date(session.createdAt).toLocaleString()} · {session.opCount} change
              {session.opCount === 1 ? '' : 's'}
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                data-testid="design-compare-session"
                data-session-id={session.id}
                aria-expanded={open}
                className="text-accent hover:underline"
                onClick={() => toggle(session.id)}
              >
                {open ? 'Hide' : 'Compare'}
              </button>
              <button
                type="button"
                data-testid="design-resend"
                className="text-accent hover:underline"
                onClick={() => void resendDesignSession(session.id, target)}
              >
                Resend
              </button>
              <button
                type="button"
                data-testid="design-export"
                className="text-accent hover:underline"
                onClick={() => void exportDesignSession(session.id)}
              >
                Export
              </button>
            </div>
            {open && loading && !shown && (
              <p className="flex items-center gap-1 text-fg-muted">
                <LoaderCircle size={11} className="animate-spin" /> Loading the screenshots…
              </p>
            )}
            {shown && <SessionCompare detail={shown} />}
          </div>
        );
      })}
    </section>
  );
}

function SessionCompare({ detail }: { detail: DesignSessionDetail }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-2" data-testid="design-history">
      <Shot label="Before" url={detail.beforeUrl} testId="design-history-before" />
      <Shot label="After" url={detail.afterUrl} testId="design-history-after" />
      <pre
        data-testid="design-history-changes"
        className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-fg"
      >
        {detail.changes}
      </pre>
    </div>
  );
}

function Shot({ label, url, testId }: { label: string; url: string | null; testId: string }) {
  return (
    <figure className="flex flex-col gap-1" data-testid={testId}>
      <figcaption className="text-[10px] font-medium tracking-wide text-fg-muted uppercase">{label}</figcaption>
      {url ? (
        <img src={url} alt="" className="max-h-36 w-full rounded border border-border object-contain object-top" />
      ) : (
        <p className="text-fg-muted">Screenshot missing.</p>
      )}
    </figure>
  );
}
