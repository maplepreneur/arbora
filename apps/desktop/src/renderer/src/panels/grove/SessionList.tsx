import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pin,
  Play,
  Plus,
  Power,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { CommandId, formatElapsed, SESSION_STATUS_LABEL, type AgentGroup } from '@arbora/shared';
import {
  archiveSession,
  claimListFocus,
  RECENT_LIMIT,
  selectSession,
  stopSession,
  powerSession,
  restartSession,
  startDefaultSession,
  useGrove,
} from '../../grove-store';
import type { GroveSession } from '../../grove-model';
import { useChordLabel } from '../../keybindings';
import { formatWhen } from '../agent/ThreadList';
import { sessionStats, type EditStats } from './changes';
import { onAgentListKeyDown } from './agent-list-keys';
import { hasProcess, openRowMenu } from './session-actions';
import { AgentMark } from './AgentMark';
import { StatusDot } from './StatusDot';

/** Takes `listFocusRequest` once: the selected row, else the first one. */
function useListFocus(container: RefObject<HTMLElement | null>, rowSelector: string): void {
  const request = useGrove((s) => s.listFocusRequest);
  useEffect(() => {
    if (!claimListFocus(request)) return;
    const root = container.current;
    const row =
      root?.querySelector<HTMLElement>(`${rowSelector}[aria-current="true"]`) ??
      root?.querySelector<HTMLElement>(rowSelector);
    (row ?? root)?.focus();
  }, [request, container, rowSelector]);
}

/** Seconds since the turn started, ticking. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span data-testid="grove-row-timer" className="shrink-0 text-[10.5px] text-fg-subtle tabular-nums">
      {formatElapsed(now - since)}
    </span>
  );
}

export function DiffStat({ stats }: { stats: EditStats }) {
  return (
    <span data-testid="grove-row-stats" className="shrink-0 font-mono text-[10.5px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{stats.additions}</span>{' '}
      <span className="text-red-600 dark:text-red-400">−{stats.deletions}</span>
    </span>
  );
}

const LINE_TONE: Partial<Record<GroveSession['status'], string>> = {
  needsYou: 'text-attention',
  failed: 'text-danger',
};

export function SessionRow({
  session,
  helper,
  selected,
  tabStop,
  groups,
  nameOf,
  navId,
  kbd = false,
  onNavigate,
}: {
  session: GroveSession;
  helper: boolean;
  selected: boolean;
  /** Roving tabindex: one listed row is in the tab order. */
  tabStop: boolean;
  groups: readonly AgentGroup[];
  nameOf: (threadId: string) => string;
  navId?: string;
  kbd?: boolean;
  onNavigate?: () => void;
}) {
  const stopKey = useChordLabel(CommandId.groveStopSession);
  const powerKey = useChordLabel(CommandId.grovePowerSession);
  const archiveKey = useChordLabel(CommandId.groveArchiveSession);
  const live = hasProcess(session);
  const revealed = selected || kbd;
  const stats = sessionStats(session.activity);
  const since = session.status === 'working' ? session.activity.turnStartedAt : null;
  const worked = since === null ? session.activity.lastTurnMs : null;
  const status = SESSION_STATUS_LABEL[session.status];
  const title = [
    session.name === session.agentName
      ? `${session.name}: ${status}`
      : `${session.name} (${session.agentName}): ${status}`,
    worked !== null ? `worked ${formatElapsed(worked)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const overlap = session.overlaps.map(({ path, otherThreadId }) => `${path} (${nameOf(otherThreadId)})`);
  return (
    <li className="group/row relative">
      {helper && (
        <span aria-hidden className="pointer-events-none absolute top-1.5 left-3 text-[11px] text-fg-subtle">
          ↳
        </span>
      )}
      <button
        type="button"
        data-testid="grove-row"
        data-thread-id={session.id}
        data-status={session.status}
        data-helper={helper || undefined}
        aria-current={selected ? 'true' : undefined}
        aria-description={`${status}. ${session.line}`}
        title={title}
        tabIndex={tabStop ? 0 : -1}
        data-nav-id={navId}
        data-kbd={kbd || undefined}
        onClick={() => {
          onNavigate?.();
          selectSession(session.id, { focus: false });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void openRowMenu(session, groups);
        }}
        className={clsx(
          'flex w-full flex-col gap-0.5 py-1.5 pr-7 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset group-hover/row:pr-36 group-focus-within/row:pr-36',
          helper ? 'pl-7' : 'pl-3',
          selected ? 'bg-bg-muted' : 'hover:bg-bg-muted/60',
          revealed && 'pr-36',
          kbd && 'ring-1 ring-inset ring-accent',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <AgentMark name={session.agentName} agentId={session.agentId} />
          <StatusDot status={session.status} />
          <span className="min-w-0 flex-1 truncate text-[12.5px]" data-testid="grove-row-name">
            {session.name}
          </span>
          {session.pinned && <Pin size={10} aria-label="Pinned" className="shrink-0 text-fg-subtle" />}
          {overlap.length > 0 && (
            <span
              data-testid="grove-row-overlap"
              title={`Another agent is editing ${overlap.join(', ')}`}
              className="shrink-0 text-amber-500"
            >
              <TriangleAlert size={12} />
            </span>
          )}
          {since !== null ? <Elapsed since={since} /> : stats.files > 0 && <DiffStat stats={stats} />}
        </span>
        <span
          data-testid="grove-row-line"
          className={clsx('truncate pl-4 text-[11px]', LINE_TONE[session.status] ?? 'text-fg-subtle')}
        >
          {session.line}
        </span>
      </button>
      <div
        className={clsx(
          'absolute top-1 right-0.5 flex items-center gap-0.5',
          revealed
            ? 'opacity-100'
            : 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100',
        )}
      >
        {session.archivedAt === null &&
          (live ? (
            <RowAction
              testId="grove-row-stop"
              label="Stop work"
              chord={stopKey}
              onClick={() => void stopSession(session.id)}
            >
              <Square size={9} fill="currentColor" />
            </RowAction>
          ) : (
            <RowAction
              testId="grove-row-start"
              label="Start the agent"
              chord={undefined}
              onClick={() => void restartSession(session.id)}
            >
              <Play size={9} fill="currentColor" />
            </RowAction>
          ))}
        {session.archivedAt === null && (
          <RowAction
            testId="grove-row-power"
            label={live ? 'Power off' : 'Power on'}
            chord={powerKey}
            danger
            onClick={() => void powerSession(session.id)}
          >
            <Power size={11} />
          </RowAction>
        )}
        {session.archivedAt === null && (
          <RowAction
            testId="grove-row-archive"
            label="Archive"
            chord={archiveKey}
            onClick={() => archiveSession(session.id)}
          >
            <Archive size={11} />
          </RowAction>
        )}
        <button
          type="button"
          aria-label={`${session.name} actions`}
          data-testid="grove-row-menu"
          tabIndex={-1}
          onClick={() => void openRowMenu(session, groups)}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg hover:text-fg"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>
    </li>
  );
}

function RowAction({
  testId,
  label,
  chord,
  danger = false,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  chord: string | undefined;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const hint = chord ? `${label} (${chord})` : label;
  return (
    <button
      type="button"
      data-testid={testId}
      tabIndex={-1}
      title={hint}
      aria-label={hint}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={clsx(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg hover:text-fg',
        danger && 'hover:text-danger',
      )}
    >
      {children}
    </button>
  );
}

export function RecentSection({
  recent,
  selectedId,
  navId,
  kbd = false,
  onNavigate,
  rowNavId,
  rowKbd,
  showAllNavId,
  showAllKbd = false,
}: {
  recent: readonly GroveSession[];
  selectedId: string | null;
  navId?: string;
  kbd?: boolean;
  onNavigate?: (id: string) => void;
  rowNavId?: (threadId: string) => string;
  rowKbd?: (threadId: string) => boolean;
  showAllNavId?: string;
  showAllKbd?: boolean;
}) {
  const open = useGrove((s) => s.recentOpen);
  const showAll = useGrove((s) => s.showAllRecent);
  if (recent.length === 0) return null;
  const shown = showAll ? recent : recent.slice(0, RECENT_LIMIT);
  return (
    <section aria-label="Recent" data-testid="grove-recent" className="mt-1 border-t border-border/60">
      <button
        type="button"
        aria-expanded={open}
        data-testid="grove-recent-toggle"
        data-nav-id={navId}
        data-kbd={kbd || undefined}
        onClick={() => {
          if (navId) onNavigate?.(navId);
          useGrove.setState({ recentOpen: !open });
        }}
        className={clsx(
          'flex h-7 w-full items-center gap-1 px-1.5 text-left text-[10px] font-semibold tracking-wide text-fg-subtle uppercase outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
          kbd && 'ring-1 ring-inset ring-accent',
        )}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Recent ({recent.length})
      </button>
      {open && (
        <ul>
          {shown.map((session) => {
            const rowId = rowNavId?.(session.id);
            const rowFocused = rowKbd?.(session.id) === true;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  data-testid="grove-recent-row"
                  data-thread-id={session.id}
                  data-nav-id={rowId}
                  data-kbd={rowFocused || undefined}
                  aria-current={session.id === selectedId ? 'true' : undefined}
                  title={`${session.name}: archived. Select it to read the transcript or restore it.`}
                  onClick={() => {
                    if (rowId) onNavigate?.(rowId);
                    selectSession(session.id, { focus: false });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void openRowMenu(session, []);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 py-1 pr-2 pl-3 text-left text-[12px] text-fg-muted outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
                    session.id === selectedId ? 'bg-bg-muted text-fg' : 'hover:bg-bg-muted/60',
                    rowFocused && 'ring-1 ring-inset ring-accent',
                  )}
                >
                  <StatusDot status={session.status} />
                  <span className="min-w-0 flex-1 truncate">{session.name}</span>
                  <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">
                    {formatWhen(session.archivedAt ?? session.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && !showAll && recent.length > RECENT_LIMIT && (
        <button
          type="button"
          data-testid="grove-recent-all"
          data-nav-id={showAllNavId}
          data-kbd={showAllKbd || undefined}
          onClick={() => {
            if (showAllNavId) onNavigate?.(showAllNavId);
            useGrove.setState({ showAllRecent: true });
          }}
          className={clsx(
            'px-3 pb-1.5 text-left text-[11px] text-accent outline-none hover:underline focus-visible:ring-1 focus-visible:ring-accent',
            showAllKbd && 'ring-1 ring-inset ring-accent',
          )}
        >
          Show all
        </button>
      )}
    </section>
  );
}

/** Under 520px of content width: one status dot per session, with the name and line as its tooltip. */
export function SessionRail({
  sessions,
  selectedId,
}: {
  sessions: readonly GroveSession[];
  selectedId: string | null;
}) {
  const rail = useRef<HTMLElement>(null);
  useListFocus(rail, '[data-testid="grove-rail-row"]');
  const tabId = sessions.some((session) => session.id === selectedId) ? selectedId : (sessions[0]?.id ?? null);
  return (
    <nav
      ref={rail}
      aria-label="Agent sessions"
      data-testid="grove-rail"
      tabIndex={-1}
      className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-bg-subtle py-2 outline-none"
      onKeyDown={(event) => onAgentListKeyDown(event, { order: sessions, selectedId, rowTestId: 'grove-rail-row' })}
    >
      <button
        type="button"
        data-testid="grove-rail-new"
        title="New agent"
        aria-label="New agent"
        onClick={() => startDefaultSession()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg hover:opacity-90"
      >
        <Plus size={15} />
      </button>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          data-testid="grove-rail-row"
          data-thread-id={session.id}
          data-status={session.status}
          aria-current={session.id === selectedId ? 'true' : undefined}
          aria-label={`${session.name}: ${SESSION_STATUS_LABEL[session.status]}`}
          title={`${session.name}: ${SESSION_STATUS_LABEL[session.status]}. ${session.line}`}
          tabIndex={session.id === tabId ? 0 : -1}
          onClick={() => selectSession(session.id, { focus: false })}
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent',
            session.id === selectedId ? 'bg-bg-muted' : 'hover:bg-bg-muted/60',
          )}
        >
          <StatusDot status={session.status} large />
        </button>
      ))}
    </nav>
  );
}
