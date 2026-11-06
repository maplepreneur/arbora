import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowLeft,
  Bot,
  Cpu,
  Gauge,
  KeyRound,
  List,
  Loader2,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  type LucideIcon,
} from 'lucide-react';
import { CommandId, type SessionConfigOption, type ThreadSummary } from '@arbora/shared';
import { useChordLabel } from '../../keybindings';
import {
  modeControl,
  sessionControlLabel,
  sessionControlRole,
  type SessionControlRole,
  thinkingControl,
} from '../../thread-controls';
import { Picker, type PickerOption } from '../../components/Picker';
import { showToast, useApp } from '../../store';
import { cancelTurn, isStoppable, showThreads, stopAgent, toggleLog, useAgents } from '../../agent-store';
import { toggleDefaultModel, toggleFavoriteModel } from '../../agent-defaults';
import { Composer } from './Composer';
import { LogViewer } from './LogViewer';
import { statusDot } from './ThreadList';
import { pendingPermissions, PinnedPermissions, Transcript } from './Transcript';

const NO_MODELS: readonly string[] = [];

function selectOptions(option: Extract<SessionConfigOption, { type: 'select' }>): PickerOption[] {
  return option.options.flatMap((entry) =>
    'group' in entry
      ? entry.options.map((o) => ({ value: o.value, name: o.name, description: o.description, group: entry.group }))
      : [{ value: entry.value, name: entry.name, description: entry.description }],
  );
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
    <div
      className="mx-2 mt-2 rounded border border-amber-500/60 bg-amber-500/5 px-2 py-2 text-[12px]"
      data-testid="auth-card"
    >
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

export interface ThreadViewProps {
  readonly thread: ThreadSummary;
  readonly projectPath: string;
  /** The docked header (back, title, stop, log, restart). Grove shows its own above its tabs. */
  readonly showHeader?: boolean;
  /** An archived session: its transcript, and nothing to act with. */
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
  const events = useAgents((s) => s.events[thread.id]);
  const logOpen = useAgents((s) => s.logOpen);
  const agentName = useAgents((s) => s.agents.find((a) => a.id === thread.agentId)?.name ?? thread.agentId);
  const { state } = thread;
  const modelOption = state.configOptions.find(
    (o): o is Extract<SessionConfigOption, { type: 'select' }> => o.type === 'select' && o.category === 'model',
  );
  const otherOptions = state.configOptions.filter((o) => o !== modelOption);
  const favoriteModels = useApp((s) => s.settings.agents.favoriteModels[thread.agentId]) ?? NO_MODELS;
  const defaultModel = useApp((s) => s.settings.agents.defaultModels[thread.agentId]);
  const modelMenuRequest = useAgents((s) => s.modelMenuRequest);
  const modeMenuRequest = useAgents((s) => s.modeMenuRequest);
  const mode = modeControl(state);
  const thinking = thinkingControl(state);
  const cycleModeKey = useChordLabel(CommandId.agentCycleMode);
  const pickModeKey = useChordLabel(CommandId.agentPickMode);
  const modelKey = useChordLabel(CommandId.agentPickModel);
  const thinkingKey = useChordLabel(CommandId.agentCycleThinking);
  const modeShortcut = [cycleModeKey && `${cycleModeKey} next`, pickModeKey && `${pickModeKey} list`]
    .filter(Boolean)
    .join(', ');
  // The mode menu opens on whichever control Shift+Tab rotates: a `mode` config option or the modes.
  const modeMenuFor = (optionId: string | null): number =>
    (mode?.kind === 'config' ? mode.option.id : null) === optionId ? modeMenuRequest : 0;
  const optionShortcut = (optionId: string): string | undefined => {
    if (mode?.kind === 'config' && mode.option.id === optionId) return modeShortcut || undefined;
    if (thinking?.option.id === optionId && thinkingKey) return `${thinkingKey} next`;
    return undefined;
  };

  // Requests only wait inside a turn; an unanswered card in a stopped thread stays in the scrollback.
  const pinning = !readOnly && state.status === 'prompting';
  const pending = useMemo(() => (events && pinning ? pendingPermissions(events) : []), [events, pinning]);

  const invoke = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      showToast((error as Error).message);
    }
  };
  const respond = (requestId: string, optionId: string): void =>
    void invoke(() => window.arbora.invoke('agent.respondPermission', { threadId: thread.id, requestId, optionId }));

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
          <GrantChips threadId={thread.id} />
          {isStoppable(state.status) && (
            <button
              type="button"
              title={state.status === 'prompting' ? 'Stop the agent (Esc)' : 'Stop starting the agent'}
              aria-label="Stop the agent"
              data-testid="thread-stop"
              onClick={() => void invoke(() => stopAgent(thread.id))}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-danger hover:bg-danger/10"
            >
              <Square size={10} fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            title="Show the ACP log"
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
            title="Restart the agent"
            aria-label="Restart agent"
            data-testid="restart-agent"
            onClick={() => void invoke(() => window.arbora.invoke('agent.restart', { threadId: thread.id }))}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      )}

      {!readOnly && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
          data-testid="session-controls"
        >
          {state.modes && state.modes.availableModes.length > 0 && (
            <Picker
              label="Mode"
              showLabel
              icon={Bot}
              testId="mode-select"
              menuWidth={240}
              className="max-w-[40%]"
              openRequest={mode?.kind === 'modes' ? modeMenuRequest : 0}
              shortcut={mode?.kind === 'modes' ? modeShortcut || undefined : undefined}
              value={state.modes.currentModeId}
              options={state.modes.availableModes.map((m) => ({
                value: m.id,
                name: m.name,
                description: m.description,
              }))}
              onChange={(modeId) =>
                void invoke(() => window.arbora.invoke('agent.setMode', { threadId: thread.id, modeId }))
              }
            />
          )}
          {modelOption && (
            <Picker
              label="Model"
              showLabel
              icon={Cpu}
              testId="model-select"
              favorites={favoriteModels}
              onToggleFavorite={(value) => toggleFavoriteModel(thread.agentId, value)}
              defaultValue={defaultModel}
              onSetDefault={(value) => toggleDefaultModel(thread.agentId, value)}
              defaultHint={`Use for new ${agentName} threads`}
              menuWidth={320}
              className="max-w-[60%]"
              openRequest={modelMenuRequest}
              shortcut={modelKey}
              value={modelOption.currentValue}
              options={selectOptions(modelOption)}
              onChange={(value) =>
                void invoke(() =>
                  window.arbora.invoke('agent.setConfigOption', {
                    threadId: thread.id,
                    configId: modelOption.id,
                    value,
                  }),
                )
              }
            />
          )}
          {otherOptions.map((option) => {
            const role = sessionControlRole(option.id, mode, thinking);
            const label = sessionControlLabel(option.name, role);
            return option.type === 'select' ? (
              <Picker
                key={option.id}
                label={label}
                showLabel
                icon={sessionControlIcon(role)}
                className="max-w-[45%]"
                testId={`config-${option.id}`}
                openRequest={modeMenuFor(option.id)}
                shortcut={optionShortcut(option.id)}
                value={option.currentValue}
                options={selectOptions(option)}
                onChange={(value) =>
                  void invoke(() =>
                    window.arbora.invoke('agent.setConfigOption', { threadId: thread.id, configId: option.id, value }),
                  )
                }
              />
            ) : (
              <label
                key={option.id}
                className="flex h-6 items-center gap-1 text-[11px]"
                title={option.description ?? undefined}
              >
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
                {role === 'effort' && <Gauge size={12} className="shrink-0 text-fg-subtle" />}
                {label}
              </label>
            );
          })}
          <button
            type="button"
            title={
              thread.autoApproveEdits
                ? 'File edits inside the project are approved without asking. Click to ask again.'
                : 'Click to approve file edits inside the project without asking'
            }
            aria-pressed={thread.autoApproveEdits}
            data-testid="auto-approve-edits"
            onClick={() =>
              void invoke(() =>
                window.arbora.invoke('agent.setAutoApproveEdits', {
                  threadId: thread.id,
                  enabled: !thread.autoApproveEdits,
                }),
              )
            }
            className={clsx(
              'ml-auto flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px]',
              thread.autoApproveEdits
                ? 'border-accent/50 bg-accent-soft text-accent'
                : 'border-border text-fg-subtle hover:bg-bg-muted hover:text-fg',
            )}
          >
            <ShieldCheck size={12} />
            {thread.autoApproveEdits ? 'Auto-approve edits' : 'Ask before edits'}
          </button>
        </div>
      )}

      {!readOnly && state.status === 'auth_required' && <AuthCard thread={thread} />}
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
          hidePending={pinning}
          onRespond={respond}
          onStop={() => void cancelTurn(thread.id)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
      {logOpen && <LogViewer threadId={thread.id} />}
      <PinnedPermissions events={pending} projectPath={projectPath} onRespond={respond} />
      {!readOnly && (
        <>
          <Composer thread={thread} projectPath={projectPath} name={composerName} />
          <KeyHints
            hints={[
              mode && cycleModeKey ? `${cycleModeKey} mode` : null,
              modelOption && modelKey ? `${modelKey} model` : null,
              thinking && thinkingKey ? `${thinkingKey} effort` : null,
            ]}
          />
        </>
      )}
    </div>
  );
}

function sessionControlIcon(role: SessionControlRole): LucideIcon {
  switch (role) {
    case 'mode':
      return Bot;
    case 'effort':
      return Gauge;
    case 'other':
      return SlidersHorizontal;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

/** One quiet line under the composer naming the CLI-style keys this agent supports. */
function GrantChips({ threadId }: { threadId: string }) {
  const [tabIds, setTabIds] = useState<string[]>([]);
  const titles = useApp((s) => s.browserTabs);
  useEffect(() => {
    let live = true;
    void window.arbora.invoke('agent.listGrants', { threadId }).then((ids) => {
      if (live) setTabIds(ids);
    });
    const off = window.arbora.on('agent.grantsChanged', (event) => {
      if (event.threadId === threadId) setTabIds(event.tabIds);
    });
    return () => {
      live = false;
      off();
    };
  }, [threadId]);
  if (tabIds.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="tab-grants">
      {tabIds.map((id) => {
        const tab = titles.find((entry) => entry.id === id);
        return (
          <button
            key={id}
            type="button"
            title="Stop the agent using this tab"
            className="max-w-24 truncate rounded bg-accent-soft px-1 text-[10px] text-accent"
            onClick={() => void window.arbora.invoke('agent.revokeGrant', { threadId, tabId: id })}
          >
            {tab?.title || 'Tab'}
          </button>
        );
      })}
    </span>
  );
}

function KeyHints({ hints }: { hints: readonly (string | null)[] }) {
  const shown = hints.filter((hint): hint is string => hint !== null);
  if (shown.length === 0) return null;
  return (
    <div className="shrink-0 truncate px-3 pb-1.5 text-[10.5px] text-fg-subtle" data-testid="thread-key-hints">
      {shown.join(' · ')}
    </div>
  );
}
