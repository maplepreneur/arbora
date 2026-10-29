import clsx from 'clsx';
import { ArrowLeft, ChevronDown, KeyRound, List, Loader2, RotateCcw, ScrollText, ShieldCheck } from 'lucide-react';
import type { SessionConfigOption, ThreadSummary } from '@arbora/shared';
import { showToast } from '../../store';
import { showThreads, toggleLog, useAgents } from '../../agent-store';
import { Composer } from './Composer';
import { LogViewer } from './LogViewer';
import { statusDot } from './ThreadList';
import { Transcript } from './Transcript';

function Select({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly { value: string; name: string }[];
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="relative flex h-6 max-w-[45%] items-center gap-1 rounded border border-border bg-bg px-1.5 text-[11px] hover:bg-bg-muted">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        data-testid={testId}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 appearance-none bg-transparent pr-3 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1 text-fg-subtle" />
    </label>
  );
}

function selectOptions(option: Extract<SessionConfigOption, { type: 'select' }>): { value: string; name: string }[] {
  return option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
}

function AuthCard({ thread }: { thread: ThreadSummary }) {
  const authenticate = async (methodId: string): Promise<void> => {
    try {
      await window.arbora.invoke('agent.authenticate', { threadId: thread.id, methodId });
    } catch (error) {
      showToast((error as Error).message);
    }
  };
  return (
    <div className="mx-2 mt-2 rounded border border-amber-500/60 bg-amber-500/5 px-2 py-2 text-[12px]" data-testid="auth-card">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound size={13} className="text-amber-500" /> Authentication required
      </div>
      {thread.state.error && <p className="mt-1 text-fg-muted">{thread.state.error}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {thread.state.authMethods.map((method) => (
          <button
            key={method.id}
            type="button"
            title={method.description ?? undefined}
            data-testid={`auth-${method.id}`}
            onClick={() => void authenticate(method.id)}
            className="h-6 rounded bg-accent px-2 text-[11px] text-accent-fg hover:opacity-90"
          >
            {method.name}
          </button>
        ))}
        <button
          type="button"
          data-testid="auth-retry"
          onClick={() => void window.arbora.invoke('agent.restart', { threadId: thread.id })}
          className="h-6 rounded border border-border px-2 text-[11px] hover:bg-bg-muted"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function ThreadView({ thread, projectPath }: { thread: ThreadSummary; projectPath: string }) {
  const events = useAgents((s) => s.events[thread.id]);
  const logOpen = useAgents((s) => s.logOpen);
  const agentName = useAgents((s) => s.agents.find((a) => a.id === thread.agentId)?.name ?? thread.agentId);
  const { state } = thread;
  const modelOption = state.configOptions.find(
    (o): o is Extract<SessionConfigOption, { type: 'select' }> => o.type === 'select' && o.category === 'model',
  );
  const otherOptions = state.configOptions.filter((o) => o !== modelOption);

  const invoke = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread-view" data-thread-status={state.status}>
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
        <span className={clsx('h-2 w-2 shrink-0 rounded-full', statusDot(state.status))} data-testid="thread-status" />
        <span className="min-w-0 flex-1 truncate" title={`${thread.title} — ${agentName}`}>
          <span className="font-medium">{thread.title}</span>
          <span className="text-fg-subtle"> · {agentName}</span>
        </span>
        <button
          type="button"
          title={thread.autoApproveEdits ? 'Auto-approve edits in the project: on' : 'Auto-approve edits in the project: off'}
          aria-pressed={thread.autoApproveEdits}
          data-testid="auto-approve-edits"
          onClick={() =>
            void invoke(() =>
              window.arbora.invoke('agent.setAutoApproveEdits', { threadId: thread.id, enabled: !thread.autoApproveEdits }),
            )
          }
          className={clsx(
            'flex h-6 w-6 items-center justify-center rounded hover:bg-bg-muted',
            thread.autoApproveEdits ? 'text-accent' : 'text-fg-subtle hover:text-fg',
          )}
        >
          <ShieldCheck size={13} />
        </button>
        <button
          type="button"
          title="ACP log"
          aria-pressed={logOpen}
          data-testid="toggle-log"
          onClick={toggleLog}
          className={clsx(
            'flex h-6 w-6 items-center justify-center rounded hover:bg-bg-muted',
            logOpen ? 'text-accent' : 'text-fg-subtle hover:text-fg',
          )}
        >
          <ScrollText size={13} />
        </button>
        <button
          type="button"
          title="Restart agent"
          aria-label="Restart agent"
          data-testid="restart-agent"
          onClick={() => void invoke(() => window.arbora.invoke('agent.restart', { threadId: thread.id }))}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {(state.modes || modelOption || otherOptions.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1" data-testid="session-controls">
          {state.modes && state.modes.availableModes.length > 0 && (
            <Select
              label="Mode"
              testId="mode-select"
              value={state.modes.currentModeId}
              options={state.modes.availableModes.map((m) => ({ value: m.id, name: m.name }))}
              onChange={(modeId) => void invoke(() => window.arbora.invoke('agent.setMode', { threadId: thread.id, modeId }))}
            />
          )}
          {modelOption && (
            <Select
              label="Model"
              testId="model-select"
              value={modelOption.currentValue}
              options={selectOptions(modelOption)}
              onChange={(value) =>
                void invoke(() => window.arbora.invoke('agent.setConfigOption', { threadId: thread.id, configId: modelOption.id, value }))
              }
            />
          )}
          {otherOptions.map((option) =>
            option.type === 'select' ? (
              <Select
                key={option.id}
                label={option.name}
                testId={`config-${option.id}`}
                value={option.currentValue}
                options={selectOptions(option)}
                onChange={(value) =>
                  void invoke(() => window.arbora.invoke('agent.setConfigOption', { threadId: thread.id, configId: option.id, value }))
                }
              />
            ) : (
              <label key={option.id} className="flex h-6 items-center gap-1 text-[11px]" title={option.description ?? undefined}>
                <input
                  type="checkbox"
                  checked={option.currentValue}
                  data-testid={`config-${option.id}`}
                  onChange={(event) =>
                    void invoke(() =>
                      window.arbora.invoke('agent.setConfigOption', {
                        threadId: thread.id,
                        configId: option.id,
                        value: event.target.checked,
                      }),
                    )
                  }
                />
                {option.name}
              </label>
            ),
          )}
        </div>
      )}

      {state.status === 'auth_required' && <AuthCard thread={thread} />}
      {state.status === 'error' && state.error && (
        <div className="mx-2 mt-2 rounded border border-danger/50 px-2 py-1.5 text-[12px] text-danger" data-testid="thread-state-error">
          {state.error}
        </div>
      )}
      {state.status === 'starting' && (
        <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-fg-subtle" data-testid="thread-starting">
          <Loader2 size={12} className="animate-spin" /> Starting {agentName}…
          <button type="button" onClick={toggleLog} className="ml-auto flex items-center gap-1 hover:text-fg">
            <List size={11} /> stderr
          </button>
        </div>
      )}

      {events ? (
        <Transcript
          events={events}
          projectPath={projectPath}
          busy={state.status === 'prompting'}
          onRespond={(requestId, optionId) =>
            void invoke(() => window.arbora.invoke('agent.respondPermission', { threadId: thread.id, requestId, optionId }))
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
      {logOpen && <LogViewer threadId={thread.id} />}
      <Composer thread={thread} projectPath={projectPath} />
    </div>
  );
}
