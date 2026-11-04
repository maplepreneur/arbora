import clsx from 'clsx';
import { Archive, ArchiveRestore, MoreHorizontal, RotateCcw, Square } from 'lucide-react';
import { CommandId, SESSION_STATUS_LABEL } from '@arbora/shared';
import { renameThread, useAgents } from '../../agent-store';
import {
  archiveSession,
  formatUsage,
  restartSession,
  restoreSession,
  selectSession,
  stopSession,
  useGrove,
  type GroveTab,
} from '../../grove-store';
import type { GroveModel, GroveSession } from '../../grove-model';
import { ipcError } from '../../ipc-error';
import { useChordLabel } from '../../keybindings';
import { showToast } from '../../store';
import { formatWhen, InlineName } from '../agent/ThreadList';
import ThreadView from '../agent/ThreadView';
import { ChangesView } from './ChangesView';
import { hasProcess, openPaneMenu } from './session-actions';
import { StatusDot } from './StatusDot';

const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg';

function Memory({ kind, id }: { kind: 'agent' | 'terminal'; id: string }) {
  const sample = useGrove((s) => s.usage.find((entry) => entry.kind === kind && entry.id === id));
  if (!sample || sample.rssKb <= 0) return null;
  return (
    <span data-testid="grove-memory" className="shrink-0 text-[11px] text-fg-subtle">
      {formatUsage(sample.rssKb, sample.cpuPercent)}
    </span>
  );
}

function Lineage({ session, model }: { session: GroveSession; model: GroveModel }) {
  const lead = session.parentThreadId === null ? undefined : model.byId.get(session.parentThreadId);
  const helpers = model.listed.filter((other) => other.parentThreadId === session.id);
  if (lead) {
    return (
      <button
        type="button"
        data-testid="grove-lead-link"
        onClick={() => selectSession(lead.id)}
        className="min-w-0 shrink truncate rounded px-1 text-[11px] text-fg-subtle hover:bg-bg-muted hover:text-fg"
      >
        Helper of {lead.name}
      </button>
    );
  }
  if (helpers.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden" aria-label="Helpers">
      {helpers.map((helper) => (
        <button
          key={helper.id}
          type="button"
          data-testid="grove-helper-chip"
          data-thread-id={helper.id}
          title={`${helper.name}: ${SESSION_STATUS_LABEL[helper.status]}`}
          onClick={() => selectSession(helper.id)}
          className="flex h-5 max-w-36 shrink-0 items-center gap-1 rounded-full border border-border px-1.5 text-[10.5px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <StatusDot status={helper.status} />
          <span className="truncate">{helper.name}</span>
        </button>
      ))}
    </span>
  );
}

function PaneHeader({ session, model }: { session: GroveSession; model: GroveModel }) {
  const renaming = useGrove((s) => s.renamingId === session.id);
  const logOpen = useAgents((s) => s.logOpen);
  const archiveKey = useChordLabel(CommandId.groveArchiveSession);
  const archived = session.archivedAt !== null;
  const running = hasProcess(session);
  return (
    <header
      data-testid="grove-pane-header"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
    >
      <StatusDot status={session.status} large />
      {renaming ? (
        <InlineName
          initial={session.title}
          label="Agent name"
          testId="grove-rename-input"
          onDone={(title) => {
            useGrove.setState({ renamingId: null });
            if (title && title !== session.title) {
              renameThread(session.id, title).catch((error: unknown) => showToast(ipcError(error)));
            }
          }}
        />
      ) : (
        <h2
          data-testid="grove-session-name"
          title={`${session.name}. Double-click to rename`}
          onDoubleClick={() => useGrove.setState({ renamingId: session.id })}
          className="min-w-0 shrink truncate text-[13px] font-semibold"
        >
          {session.name}
        </h2>
      )}
      <span data-testid="grove-session-status" className="shrink-0 text-[11px] text-fg-subtle">
        {archived ? 'Archived' : SESSION_STATUS_LABEL[session.status]} · {session.agentName}
      </span>
      <Memory kind="agent" id={session.id} />
      <Lineage session={session} model={model} />
      <div className="flex-1" />
      {!archived &&
        (running ? (
          <button
            type="button"
            data-testid="grove-stop"
            title="Stop the agent process. The session stays, and the next message starts it again."
            aria-label="Stop the agent process"
            onClick={() => void stopSession(session.id)}
            className={clsx(iconButton, 'text-danger hover:text-danger')}
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="grove-restart"
            title="Start the agent again"
            aria-label="Restart the agent"
            onClick={() => void restartSession(session.id)}
            className={iconButton}
          >
            <RotateCcw size={13} />
          </button>
        ))}
      {!archived && (
        <button
          type="button"
          data-testid="grove-archive"
          title={`Archive: stop it and move it to Recent${archiveKey ? ` (${archiveKey})` : ''}`}
          aria-label="Archive"
          onClick={() => archiveSession(session.id)}
          className={iconButton}
        >
          <Archive size={13} />
        </button>
      )}
      <button
        type="button"
        data-testid="grove-pane-menu"
        aria-label={`${session.name} actions`}
        onClick={() => void openPaneMenu(session, logOpen)}
        className={iconButton}
      >
        <MoreHorizontal size={14} />
      </button>
    </header>
  );
}

function ArchivedBanner({ session }: { session: GroveSession }) {
  return (
    <div
      data-testid="grove-archived"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-subtle px-3 py-1.5 text-[12px] text-fg-muted"
    >
      <Archive size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Archived {formatWhen(session.archivedAt ?? session.updatedAt)}. Restore it to send it messages again.
      </span>
      <button
        type="button"
        data-testid="grove-restore"
        onClick={() => void restoreSession(session.id)}
        className="flex h-6 shrink-0 items-center gap-1 rounded bg-accent px-2 text-[11px] text-accent-fg hover:opacity-90"
      >
        <ArchiveRestore size={12} /> Restore
      </button>
    </div>
  );
}

const TABS: readonly { id: GroveTab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'changes', label: 'Changes' },
];

function Tabs({ tab, changes }: { tab: GroveTab; changes: number }) {
  return (
    <div
      role="tablist"
      aria-label="Session"
      className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          data-testid={`grove-tab-${entry.id}`}
          onClick={() => useGrove.setState({ tab: entry.id })}
          className={clsx(
            'flex h-6 items-center gap-1 rounded px-2 text-xs',
            tab === entry.id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
          )}
        >
          {entry.label}
          {entry.id === 'changes' && changes > 0 && (
            <span className="rounded-full bg-bg-muted px-1.5 text-[10px] leading-4 tabular-nums">{changes}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** One session: its header, the Transcript (the docked thread view) and Changes tabs. */
export function SessionPane({
  session,
  model,
  projectPath,
}: {
  session: GroveSession;
  model: GroveModel;
  projectPath: string;
}) {
  const tab = useGrove((s) => s.tab);
  const archived = session.archivedAt !== null;
  const nameOf = (threadId: string): string => model.byId.get(threadId)?.name ?? 'another agent';
  return (
    <section
      data-testid="grove-pane"
      data-thread-id={session.id}
      data-status={session.status}
      aria-label={session.name}
      className="flex h-full min-w-0 flex-col bg-bg"
    >
      <PaneHeader session={session} model={model} />
      {archived && <ArchivedBanner session={session} />}
      <Tabs tab={tab} changes={Object.keys(session.activity.files).length} />
      {tab === 'changes' ? (
        <ChangesView key={session.id} session={session} projectPath={projectPath} nameOf={nameOf} />
      ) : (
        <ThreadView
          key={session.id}
          thread={session}
          projectPath={projectPath}
          showHeader={false}
          readOnly={archived}
          composerName={session.agentName}
        />
      )}
    </section>
  );
}
