import clsx from 'clsx';
import { Bot, ChevronDown, MessageSquarePlus, Square, Trash2 } from 'lucide-react';
import type { AgentDefinition, ThreadStatus } from '@arbora/shared';
import {
  createThread,
  deleteThread,
  isStoppable,
  openThread,
  showPicker,
  stopAgent,
  useAgents,
} from '../../agent-store';
import { useDefaultAgentId } from '../../agent-defaults';
import { showToast } from '../../store';

export function statusDot(status: ThreadStatus): string {
  switch (status) {
    case 'idle':
      return 'bg-fg-subtle/50';
    case 'starting':
      return 'bg-amber-400 animate-pulse';
    case 'auth_required':
      return 'bg-amber-500';
    case 'ready':
      return 'bg-emerald-500';
    case 'prompting':
      return 'bg-accent animate-pulse';
    case 'error':
      return 'bg-danger';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ThreadList() {
  const threads = useAgents((s) => s.threads);
  const agents = useAgents((s) => s.agents);
  const activeThreadId = useAgents((s) => s.activeThreadId);
  const byId = new Map<string, AgentDefinition>(agents.map((a) => [a.id, a]));
  const defaultAgentId = useDefaultAgentId();
  const defaultAgent = defaultAgentId ? byId.get(defaultAgentId) : undefined;
  const startDefault = (): void => {
    if (!defaultAgent) {
      showPicker();
      return;
    }
    createThread(defaultAgent.id).catch((error: unknown) => showToast((error as Error).message));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-list">
      <div className="flex p-2">
        <button
          type="button"
          data-testid="new-thread"
          data-agent={defaultAgent?.id}
          title={defaultAgent ? `New ${defaultAgent.name} thread (default agent)` : 'New thread: choose an agent'}
          onClick={startDefault}
          className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l bg-accent text-[12px] text-accent-fg hover:opacity-90"
        >
          <MessageSquarePlus size={13} className="shrink-0" />
          <span className="truncate">{defaultAgent ? `New ${defaultAgent.name} thread` : 'New thread'}</span>
        </button>
        <button
          type="button"
          data-testid="new-thread-choose"
          title="Choose an agent for the new thread"
          aria-label="Choose an agent for the new thread"
          onClick={showPicker}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r border-l border-accent-fg/25 bg-accent text-accent-fg hover:opacity-90"
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {threads.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-fg-subtle">
          <Bot size={24} className="opacity-50" />
          No threads yet. Start one with Claude Code, Codex, Kimi Code, Grok Build, OpenCode or a custom agent.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {threads.map((thread) => (
            <li key={thread.id} className="group relative">
              <button
                type="button"
                data-testid="thread-row"
                data-thread-id={thread.id}
                onClick={() => void openThread(thread.id)}
                className={clsx(
                  'flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left hover:bg-bg-muted',
                  thread.id === activeThreadId && 'bg-bg-muted',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', statusDot(thread.state.status))} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={thread.title}>
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">
                    {formatWhen(thread.updatedAt)}
                  </span>
                </span>
                <span className="pl-4 text-[11px] text-fg-subtle">
                  {byId.get(thread.agentId)?.name ?? thread.agentId}
                </span>
              </button>
              {isStoppable(thread.state.status) && (
                <button
                  type="button"
                  title="Stop the agent"
                  aria-label={`Stop ${thread.title}`}
                  data-testid="thread-row-stop"
                  onClick={() => void stopAgent(thread.id)}
                  className="absolute top-1.5 right-8 flex h-6 w-6 items-center justify-center rounded text-danger hover:bg-bg"
                >
                  <Square size={10} fill="currentColor" />
                </button>
              )}
              <button
                type="button"
                title="Delete thread"
                aria-label={`Delete ${thread.title}`}
                data-testid="delete-thread"
                onClick={() => void deleteThread(thread.id)}
                className="absolute top-1.5 right-1.5 hidden h-6 w-6 items-center justify-center rounded text-fg-subtle group-hover:flex hover:bg-bg hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
