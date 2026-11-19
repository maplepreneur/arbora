import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Loader2, RotateCcw, Square } from 'lucide-react';
import type { ConfirmationRequest, ThreadSummary } from '@arbora/shared';
import { statusDot } from './ThreadList';
import { Composer } from './Composer';
import { answerConfirmation, isStoppable, restartThread, showThreads, stopAgent, useAgents } from '../../agent-store';
import { noteConfirmationClosed } from '../../attention-store';
import { ensureSession } from '../terminal/sessions';
import { showToast } from '../../store';

/** The agent's terminal: the CLI itself, interactive, attached wherever this pane mounts. */
function AgentTerminal({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = ensureSession(terminalId);
    session.attach(host);
    return () => session.detach(host);
  }, [terminalId]);
  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" data-testid="agent-terminal" />;
}

/** A stopped thread shows the tail of its last terminal run, waiting for the next prompt. */
function StoppedTail({ lines, agentName }: { lines: readonly string[]; agentName: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-stopped">
      {lines.length > 0 && (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-2 py-2 font-mono text-[11.5px] text-fg-subtle">
          {lines.join('\n')}
        </pre>
      )}
      <div className="px-2 pb-2 pt-1 text-[11.5px] text-fg-subtle">
        Stopped. Send a message to start {agentName} again.
      </div>
    </div>
  );
}

/** One of Arbora's own questions (a guarded browser tool, a helper start), pinned above the composer. */
function ConfirmationCard({ threadId, request }: { threadId: string; request: ConfirmationRequest }) {
  return (
    <div
      className="mx-2 mt-2 rounded border border-amber-500/60 bg-amber-500/5 px-2 py-2 text-[12px]"
      data-testid="confirmation-card"
    >
      <div className="font-medium" data-testid="confirmation-title">
        {request.title}
      </div>
      {request.detail && <p className="mt-0.5 whitespace-pre-wrap text-fg-muted">{request.detail}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            data-testid={`confirmation-${option.optionId}`}
            onClick={() => {
              noteConfirmationClosed(threadId);
              void answerConfirmation(threadId, request.requestId, option.optionId);
            }}
            className={clsx(
              'h-6 rounded px-2 text-[11px]',
              option.kind.startsWith('allow')
                ? 'bg-accent text-accent-fg hover:opacity-90'
                : 'border border-border hover:bg-bg-muted',
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ThreadViewProps {
  readonly thread: ThreadSummary;
  readonly projectPath: string;
  /** The docked header (back, title, stop, restart). Grove shows its own above its tabs. */
  readonly showHeader?: boolean;
  /** An archived session: its terminal tail, and nothing to act with. */
  readonly readOnly?: boolean;
  /** Who the composer placeholder addresses. */
  readonly composerName?: string | undefined;
}

export default function ThreadView({
  thread,
  projectPath,
  showHeader = true,
  readOnly = false,
  composerName,
}: ThreadViewProps) {
  const agentName = useAgents((s) => s.agents.find((a) => a.id === thread.agentId)?.name ?? thread.agentId);
  const confirmations = useAgents((s) => s.confirmations);
  const { state } = thread;
  // Cards die with the process that raised them: a stopped agent cannot take the answer.
  const pending =
    state.terminalId !== null ? Object.values(confirmations).filter((request) => request.threadId === thread.id) : [];

  const invoke = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-view" data-thread-status={state.status}>
      {showHeader && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-1.5 text-[12px]">
          <button
            type="button"
            aria-label="All threads"
            title="All threads"
            data-testid="show-threads"
            onClick={showThreads}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <ArrowLeft size={13} />
          </button>
          <span
            className={clsx('h-2 w-2 shrink-0 rounded-full', statusDot(state.status))}
            data-testid="thread-status"
          />
          <span className="min-w-0 flex-1 truncate font-medium" title={thread.title} data-testid="thread-title">
            {thread.title}
          </span>
          {isStoppable(state.status) && (
            <button
              type="button"
              title="Interrupt the agent (Ctrl+C in its terminal)"
              aria-label="Interrupt the agent"
              data-testid="thread-stop"
              onClick={() => void invoke(() => stopAgent(thread.id))}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-danger hover:bg-danger/10"
            >
              <Square size={10} fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            title="Restart the agent CLI in a fresh terminal"
            aria-label="Restart agent"
            data-testid="restart-agent"
            onClick={() => void invoke(() => restartThread(thread.id))}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      )}

      {!readOnly && state.status === 'error' && state.error && (
        <div
          className="mx-2 mt-2 rounded border border-danger/50 px-2 py-1.5 text-[12px] text-danger"
          data-testid="thread-state-error"
        >
          {state.error}
        </div>
      )}
      {!readOnly && state.status === 'starting' && (
        <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-fg-subtle" data-testid="thread-starting">
          <Loader2 size={12} className="animate-spin" /> Starting {agentName}…
        </div>
      )}

      {state.terminalId ? (
        <AgentTerminal terminalId={state.terminalId} />
      ) : (
        <StoppedTail lines={state.lastLine ? [state.lastLine] : []} agentName={agentName} />
      )}

      {!readOnly &&
        pending.map((request) => <ConfirmationCard key={request.requestId} threadId={thread.id} request={request} />)}
      {!readOnly && <Composer thread={thread} projectPath={projectPath} name={composerName ?? agentName} />}
    </div>
  );
}
