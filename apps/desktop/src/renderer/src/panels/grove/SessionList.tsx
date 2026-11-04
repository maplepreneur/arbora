import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, Plus, TriangleAlert } from 'lucide-react';
import {
  CommandId,
  formatElapsed,
  groveSummary,
  SESSION_STATUS_LABEL,
  type AgentGroup,
  type GroveSection,
} from '@arbora/shared';
import { updateGroup, useAgents } from '../../agent-store';
import { useDefaultAgentId } from '../../agent-defaults';
import { usePickableAgents } from '../../agent-pickers';
import {
  claimListFocus,
  openLauncher,
  RECENT_LIMIT,
  selectSession,
  setProjectDefaultAgent,
  setStartDefaultOnOpen,
  startDefaultSession,
  useGrove,
} from '../../grove-store';
import type { GroveModel, GroveSession } from '../../grove-model';
import { useChordLabel } from '../../keybindings';
import { openSettings, useApp } from '../../store';
import { formatWhen, groupColor, showMenu } from '../agent/ThreadList';
import { sessionStats, type EditStats } from './changes';
import { openRowMenu } from './session-actions';
import { StatusDot } from './StatusDot';

const ROW_SELECTOR = '[data-testid="grove-row"], [data-testid="grove-recent-row"]';

/** Arrow keys move between rows; Enter (the button's click) selects one. */
function moveRowFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const index = rows.findIndex((row) => row === document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
}

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

function ListHeader({ summary }: { summary: string }) {
  const defaultId = useDefaultAgentId();
  const defaultName = useAgents((s) => s.agents.find((agent) => agent.id === defaultId)?.name);
  const starting = useGrove((s) => s.starting);
  const newKey = useChordLabel(CommandId.groveNewDefault);
  const launchKey = useChordLabel(CommandId.agentNewThread);
  return (
    <div className="shrink-0 border-b border-border p-2">
      <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
        <h2 className="text-[13px] font-semibold">Grove</h2>
        <span data-testid="grove-summary" className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">
          {summary}
        </span>
      </div>
      <div className="flex">
        <button
          type="button"
          data-testid="grove-new"
          data-agent={defaultId}
          disabled={starting}
          title={
            defaultName
              ? `Start ${defaultName}${newKey ? ` (${newKey})` : ''}`
              : 'New agent: no default yet, so choose one'
          }
          onClick={() => startDefaultSession()}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-l bg-accent px-2.5 py-1 text-left text-accent-fg hover:opacity-90 disabled:opacity-60"
        >
          <Plus size={14} className="shrink-0" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[12px] font-medium">New agent</span>
            {defaultName && <span className="truncate text-[11px] opacity-80">{defaultName}</span>}
          </span>
        </button>
        <button
          type="button"
          data-testid="grove-new-choose"
          title={`New agent with a task…${launchKey ? ` (${launchKey})` : ''}`}
          aria-label="New agent with a task"
          onClick={openLauncher}
          className="flex w-8 shrink-0 items-center justify-center rounded-r border-l border-accent-fg/25 bg-accent text-accent-fg hover:opacity-90"
        >
          <ChevronDown size={13} />
        </button>
      </div>
    </div>
  );
}

function SectionHeading({ section, shown }: { section: GroveSection<GroveSession>; shown: boolean }) {
  const { group } = section;
  if (group) {
    const summary = groveSummary(section.rows.map((row) => row.thread.status));
    return (
      <div data-testid="grove-group" data-group-id={group.id} className="flex h-7 items-center gap-1.5 px-1.5">
        <button
          type="button"
          aria-expanded={!group.collapsed}
          aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          onClick={() => void updateGroup(group.id, { collapsed: !group.collapsed })}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:text-fg"
        >
          {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: groupColor(group.color) }} />
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wide uppercase">{group.name}</span>
        <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">{summary || section.rows.length}</span>
      </div>
    );
  }
  if (!shown) return null;
  return (
    <h3 className="flex h-7 items-center gap-1 px-3 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
      {section.id === 'pinned' && <Pin size={10} />}
      {section.id === 'threads' && section.title === 'Threads' ? 'Agents' : section.title}
    </h3>
  );
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

function SessionRow({
  session,
  helper,
  selected,
  groups,
  nameOf,
}: {
  session: GroveSession;
  helper: boolean;
  selected: boolean;
  groups: readonly AgentGroup[];
  nameOf: (threadId: string) => string;
}) {
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
        onClick={() => selectSession(session.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          void openRowMenu(session, groups);
        }}
        className={clsx(
          'flex w-full flex-col gap-0.5 py-1.5 pr-7 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
          helper ? 'pl-7' : 'pl-3',
          selected ? 'bg-bg-muted' : 'hover:bg-bg-muted/60',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
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
      <button
        type="button"
        aria-label={`${session.name} actions`}
        data-testid="grove-row-menu"
        onClick={() => void openRowMenu(session, groups)}
        className="absolute top-1.5 right-1 flex h-5 w-5 items-center justify-center rounded text-fg-subtle opacity-0 group-hover/row:opacity-100 hover:bg-bg hover:text-fg focus-visible:opacity-100"
      >
        <MoreHorizontal size={12} />
      </button>
    </li>
  );
}

function RecentSection({ recent, selectedId }: { recent: readonly GroveSession[]; selectedId: string | null }) {
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
        onClick={() => useGrove.setState({ recentOpen: !open })}
        className="flex h-7 w-full items-center gap-1 px-1.5 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase hover:text-fg"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Recent ({recent.length})
      </button>
      {open && (
        <ul>
          {shown.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                data-testid="grove-recent-row"
                data-thread-id={session.id}
                aria-current={session.id === selectedId ? 'true' : undefined}
                title={`${session.name}: archived. Select it to read the transcript or restore it.`}
                onClick={() => selectSession(session.id, { focus: false })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void openRowMenu(session, []);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 py-1 pr-2 pl-3 text-left text-[12px] text-fg-muted outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
                  session.id === selectedId ? 'bg-bg-muted text-fg' : 'hover:bg-bg-muted/60',
                )}
              >
                <StatusDot status={session.status} />
                <span className="min-w-0 flex-1 truncate">{session.name}</span>
                <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">
                  {formatWhen(session.archivedAt ?? session.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !showAll && recent.length > RECENT_LIMIT && (
        <button
          type="button"
          data-testid="grove-recent-all"
          onClick={() => useGrove.setState({ showAllRecent: true })}
          className="px-3 pb-1.5 text-[11px] text-accent hover:underline"
        >
          Show all
        </button>
      )}
    </section>
  );
}

/** The project's default agent, **Change**, and whether an empty Grove starts it. */
function ListFooter() {
  const defaultId = useDefaultAgentId();
  const defaultName = useAgents((s) => s.agents.find((agent) => agent.id === defaultId)?.name);
  const startOnOpen = useApp((s) => s.project?.settings.startDefaultOnOpen !== false);
  const pickable = usePickableAgents();
  const change = async (): Promise<void> => {
    if (pickable.length === 0) {
      openSettings('agents');
      return;
    }
    const choice = await showMenu(
      pickable.map(({ agent }) => ({
        id: agent.id,
        label: agent.id === defaultId ? `${agent.name} (default)` : agent.name,
        enabled: agent.id !== defaultId,
      })),
    );
    if (choice) await setProjectDefaultAgent(choice);
  };
  return (
    <div data-testid="grove-footer" className="shrink-0 border-t border-border px-2.5 py-2 text-[11px]">
      <div className="flex items-center gap-1">
        <span className="text-fg-subtle">Default:</span>
        <span data-testid="grove-default-agent" className="min-w-0 flex-1 truncate font-medium">
          {defaultName ?? 'none'}
        </span>
        <button
          type="button"
          data-testid="grove-change-default"
          title="Choose the agent this project starts by default"
          onClick={() => void change()}
          className="shrink-0 rounded px-1 text-accent hover:bg-bg-muted"
        >
          Change
        </button>
      </div>
      <label className="mt-1 flex items-center gap-1.5 text-fg-subtle">
        <input
          type="checkbox"
          data-testid="grove-start-on-open"
          checked={startOnOpen}
          onChange={(event) => void setStartDefaultOnOpen(event.target.checked)}
        />
        Start when Grove is empty
      </label>
    </div>
  );
}

/** The session list: header and split button, sections with their rows, Recent, and the footer. */
export function SessionList({ model, selectedId }: { model: GroveModel; selectedId: string | null }) {
  const groups = useAgents((s) => s.groups);
  const scroller = useRef<HTMLDivElement>(null);
  useListFocus(scroller, ROW_SELECTOR);
  const nameOf = (threadId: string): string => model.byId.get(threadId)?.name ?? 'another agent';
  const headings = model.sections.length > 1;
  return (
    <nav aria-label="Agent sessions" data-testid="grove-sessions" className="flex h-full min-w-0 flex-col bg-bg-subtle">
      <ListHeader summary={model.summary} />
      <div
        ref={scroller}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        onKeyDown={moveRowFocus}
      >
        {model.listed.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-fg-subtle">No agents yet. Start one above.</p>
        )}
        {model.sections.map((section) =>
          section.rows.length === 0 ? null : (
            <section key={section.id} aria-label={section.title} data-testid={`grove-section-${section.id}`}>
              <SectionHeading section={section} shown={headings} />
              {!section.group?.collapsed && (
                <ul>
                  {section.rows.map((row) => (
                    <SessionRow
                      key={row.thread.id}
                      session={row.thread}
                      helper={row.helper}
                      selected={row.thread.id === selectedId}
                      groups={groups}
                      nameOf={nameOf}
                    />
                  ))}
                </ul>
              )}
            </section>
          ),
        )}
        <RecentSection recent={model.recent} selectedId={selectedId} />
      </div>
      <ListFooter />
    </nav>
  );
}

/** Under 520px of content width: one status dot per session, with the name and line as its tooltip. */
export function SessionRail({ model, selectedId }: { model: GroveModel; selectedId: string | null }) {
  const rail = useRef<HTMLElement>(null);
  useListFocus(rail, '[data-testid="grove-rail-row"]');
  const sessions = model.sections.flatMap((section) => section.rows.map((row) => row.thread));
  return (
    <nav
      ref={rail}
      aria-label="Agent sessions"
      data-testid="grove-rail"
      tabIndex={-1}
      className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-bg-subtle py-2 outline-none"
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
          onClick={() => selectSession(session.id)}
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            session.id === selectedId ? 'bg-bg-muted' : 'hover:bg-bg-muted/60',
          )}
        >
          <StatusDot status={session.status} large />
        </button>
      ))}
    </nav>
  );
}
