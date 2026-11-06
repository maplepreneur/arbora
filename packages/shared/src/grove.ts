import {
  DEFAULT_THREAD_TITLE,
  threadSections,
  type AgentGroup,
  type ContentBlock,
  type ThreadEvent,
  type ThreadState,
  type ThreadStatus,
  type ThreadSummary,
} from './agent.js';
import { attentionKind, reduceAttention, type ThreadAttention } from './attention.js';

/** What a Grove row says about a session (PLAN § 4.12 "How a session looks"). */
export type SessionStatus = 'needsYou' | 'failed' | 'working' | 'starting' | 'done' | 'idle' | 'stopped';

export const SESSION_STATUS_LABEL: Readonly<Record<SessionStatus, string>> = {
  needsYou: 'Needs you',
  failed: 'Failed',
  working: 'Working',
  starting: 'Starting',
  done: 'Done',
  idle: 'Idle',
  stopped: 'Stopped',
};

/**
 * The session's status from its ACP state and the Stage 9 attention state. A wait on the user wins,
 * then a failure, then what the process is doing. An unread finish stays Done after the process is
 * gone, so the bell never counts a row that looks quiet.
 */
export function deriveSessionStatus(status: ThreadStatus, attention: ThreadAttention | undefined): SessionStatus {
  const kind = attentionKind(attention);
  if (kind === 'permission' || kind === 'auth' || status === 'auth_required') return 'needsYou';
  if (status === 'error' || kind === 'failed') return 'failed';
  switch (status) {
    case 'prompting':
      return 'working';
    case 'starting':
      return 'starting';
    case 'ready':
      return kind === 'finished' ? 'done' : 'idle';
    case 'idle':
      return kind === 'finished' ? 'done' : 'stopped';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * The attention a transcript implies with nobody looking at it: what main reports to a lead agent
 * about its helpers, which have no renderer-side "seen".
 */
export function attentionFromTranscript(
  events: readonly ThreadEvent[],
  state: Pick<ThreadState, 'status' | 'error'>,
): ThreadAttention {
  const replayed = reduceAttention(undefined, {
    type: 'changes',
    changes: events.map((event) => ({ type: 'append', event })),
    at: 0,
  }).next;
  return reduceAttention(replayed, { type: 'status', status: state.status, error: state.error, at: 0 }).next;
}

/** Statuses a lead's `grove_wait` stops waiting at: nothing more happens until someone acts. */
export function isSettledStatus(status: SessionStatus): boolean {
  return status !== 'working' && status !== 'starting';
}

export interface DefaultSessionCheck {
  /** Unarchived sessions in the project. */
  readonly sessionCount: number;
  readonly defaultAgentId: string | null;
  /** The default agent's executable was found (Stage 3 detection). */
  readonly defaultAgentDetected: boolean;
  /** `.arbora/project.json` `startDefaultOnOpen`; missing means on. */
  readonly startDefaultOnOpen: boolean;
  /** This visit to Grove already started (or failed to start) one. */
  readonly alreadyTriedThisVisit: boolean;
}

/** Whether opening Grove starts one session of the default agent. The whole rule; never retry on a toggle. */
export function shouldStartDefaultSession(check: DefaultSessionCheck): boolean {
  return (
    check.sessionCount === 0 &&
    check.defaultAgentId !== null &&
    check.defaultAgentDetected &&
    check.startDefaultOnOpen &&
    !check.alreadyTriedThisVisit
  );
}

type NamedThread = Pick<ThreadSummary, 'id' | 'agentId' | 'title' | 'createdAt' | 'archivedAt'>;

/**
 * Row names: the title once it is not the default, else the agent's name with ` 2`, ` 3` by
 * creation order among the untitled sessions of that agent (listed and archived are counted apart).
 */
export function displayNames(
  threads: readonly NamedThread[],
  agentName: (agentId: string) => string,
): Map<string, string> {
  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  const byAge = [...threads].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const thread of byAge) {
    if (thread.title !== DEFAULT_THREAD_TITLE) {
      names.set(thread.id, thread.title);
      continue;
    }
    const key = `${thread.archivedAt === null ? 'listed' : 'archived'}:${thread.agentId}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const base = agentName(thread.agentId);
    names.set(thread.id, n === 1 ? base : `${base} ${n}`);
  }
  return names;
}

/** The first line of a task, as a session title. */
export function taskTitle(task: string, max = 60): string | null {
  const line = task
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, max) : null;
}

type ListedThread = Pick<ThreadSummary, 'id' | 'createdAt' | 'archivedAt' | 'parentThreadId' | 'groupId' | 'pinned'>;

export interface GroveRow<T> {
  readonly thread: T;
  /** Started by the lead above it (`grove_start_agent`); drawn indented with a "↳". */
  readonly helper: boolean;
}

export interface GroveSection<T> {
  readonly id: string;
  readonly group: AgentGroup | null;
  readonly title: string;
  readonly rows: readonly GroveRow<T>[];
}

/**
 * The Grove list: the docked list's sections (pinned, groups, the rest), sessions in creation order
 * inside each, and helpers right under their lead. Archived sessions are left out (Recent).
 */
export function groveRows<T extends ListedThread>(
  threads: readonly T[],
  groups: readonly AgentGroup[],
): GroveSection<T>[] {
  const listed = threads
    .filter((t) => t.archivedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const ids = new Set(listed.map((t) => t.id));
  const nested = (t: T): boolean => t.parentThreadId !== null && t.parentThreadId !== t.id && ids.has(t.parentThreadId);
  const helpersOf = new Map<string, T[]>();
  for (const thread of listed) {
    if (!nested(thread) || thread.parentThreadId === null) continue;
    helpersOf.set(thread.parentThreadId, [...(helpersOf.get(thread.parentThreadId) ?? []), thread]);
  }
  const placed = new Set<string>();
  const withHelpers = (lead: T, helper: boolean): GroveRow<T>[] => {
    if (placed.has(lead.id)) return [];
    placed.add(lead.id);
    return [{ thread: lead, helper }, ...(helpersOf.get(lead.id) ?? []).flatMap((h) => withHelpers(h, true))];
  };
  const sections = threadSections(
    listed.filter((t) => !nested(t)),
    groups,
  ).map((section) => ({
    id: section.id,
    group: section.group,
    title: section.title,
    rows: section.threads.flatMap((lead) => withHelpers(lead, false)),
  }));
  // A loop of leads (hand-edited files) has no top-level row; list those sessions at the end.
  const orphans = listed.filter((t) => !placed.has(t.id)).map((thread) => ({ thread, helper: false }));
  const last = sections.at(-1);
  if (orphans.length > 0 && last) sections[sections.length - 1] = { ...last, rows: [...last.rows, ...orphans] };
  return sections;
}

/** Rows in screen order, skipping collapsed groups: what `Mod+1`..`Mod+9` and Next/Previous walk. */
export function visibleRows<T>(sections: readonly GroveSection<T>[]): T[] {
  return sections.filter((s) => !s.group?.collapsed).flatMap((s) => s.rows.map((row) => row.thread));
}

/** The header summary, e.g. "2 working · 1 needs you"; empty when nothing is going on. */
export function groveSummary(statuses: readonly SessionStatus[]): string {
  const count = (wanted: readonly SessionStatus[]): number => statuses.filter((s) => wanted.includes(s)).length;
  const parts: string[] = [];
  const working = count(['working', 'starting']);
  const needsYou = count(['needsYou']);
  const failed = count(['failed']);
  if (working > 0) parts.push(`${working} working`);
  if (needsYou > 0) parts.push(`${needsYou} needs you`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

// --- Activity ------------------------------------------------------------------------------------

export interface FileEdit {
  /** The file before the session's first edit; null when the session created it. */
  readonly oldText: string | null;
  /** The file after the session's latest edit. */
  readonly newText: string;
}

/** What a session is doing and has done, from its transcript (no terminal output involved). */
export interface SessionActivity {
  /** Tool calls still pending or running, oldest first: `[toolCallId, title]`. */
  readonly runningTools: readonly (readonly [string, string])[];
  readonly plan: { readonly done: number; readonly total: number } | null;
  /** First line of the agent's last message. */
  readonly lastMessage: string | null;
  /** When the turn in flight started (its user message); null between turns. */
  readonly turnStartedAt: number | null;
  /** How long the last finished turn took. */
  readonly lastTurnMs: number | null;
  /** Files the session edited, by path, in the order it first touched them. */
  readonly files: Readonly<Record<string, FileEdit>>;
}

export const NO_ACTIVITY: SessionActivity = {
  runningTools: [],
  plan: null,
  lastMessage: null,
  turnStartedAt: null,
  lastTurnMs: null,
  files: {},
};

function firstLine(blocks: readonly ContentBlock[]): string | null {
  const text = blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  const line = text.split('\n').find((l) => l.trim().length > 0);
  return line ? line.trim().slice(0, 200) : null;
}

/** One transcript event folded into the activity digest. Replaying a replaced event is harmless. */
export function reduceActivity(current: SessionActivity, event: ThreadEvent): SessionActivity {
  switch (event.kind) {
    case 'user_message':
      return { ...current, turnStartedAt: event.at, runningTools: [] };
    case 'agent_message': {
      const line = firstLine(event.blocks);
      return line ? { ...current, lastMessage: line } : current;
    }
    case 'tool_call': {
      const others = current.runningTools.filter(([id]) => id !== event.toolCallId);
      const running = event.status === 'pending' || event.status === 'in_progress';
      let files = current.files;
      for (const item of event.content) {
        if (item.type !== 'diff') continue;
        const before = files[item.path];
        files = {
          ...files,
          [item.path]: { oldText: before ? before.oldText : (item.oldText ?? null), newText: item.newText },
        };
      }
      const runningTools = running ? [...others, [event.toolCallId, event.title] as const] : others;
      return { ...current, runningTools, files };
    }
    case 'plan': {
      const total = event.entries.length;
      const done = event.entries.filter((e) => e.status === 'completed').length;
      return { ...current, plan: total > 0 ? { done, total } : null };
    }
    // A failed request ends the turn without a `turn_end`.
    case 'turn_end':
    case 'error':
      return {
        ...current,
        runningTools: [],
        turnStartedAt: null,
        lastTurnMs: current.turnStartedAt === null ? current.lastTurnMs : Math.max(0, event.at - current.turnStartedAt),
      };
    case 'agent_thought':
    case 'permission':
    case 'notice':
    case 'browser_preview':
    case 'action_trace':
      return current;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function activityFromEvents(events: readonly ThreadEvent[]): SessionActivity {
  return events.reduce(reduceActivity, NO_ACTIVITY);
}

/** The current tool call's title, else the plan's progress, else null. */
export function workingDetail(activity: SessionActivity): string | null {
  const tool = activity.runningTools.at(-1);
  if (tool) return tool[1];
  if (activity.plan) return `Plan ${activity.plan.done}/${activity.plan.total}`;
  return null;
}

/** Line two of a row (PLAN § 4.12). */
export function activityLine(
  status: SessionStatus,
  activity: SessionActivity,
  attention: ThreadAttention | undefined,
  error: string | null,
): string {
  switch (status) {
    case 'needsYou':
      return attention?.pendingPermissions.length ? (attention.permissionTitle ?? 'Permission requested') : 'Log in';
    case 'working':
      return workingDetail(activity) ?? 'Thinking…';
    case 'starting':
      return 'Starting…';
    case 'done':
    case 'idle':
      return activity.lastMessage ?? attention?.lastMessage ?? (status === 'done' ? 'Done' : 'Idle');
    case 'failed':
      return attention?.failure ?? error ?? 'Failed';
    case 'stopped':
      return 'Stopped';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export interface FileOverlap {
  readonly path: string;
  readonly otherThreadId: string;
}

/**
 * Files a session edited that another live session also edited, for the row's warning triangle.
 * `live` holds the sessions that are listed and have a process.
 */
export function overlaps(
  files: Readonly<Record<string, Readonly<Record<string, FileEdit>>>>,
  live: ReadonlySet<string>,
): Map<string, FileOverlap[]> {
  const editors = new Map<string, string[]>();
  for (const [threadId, edits] of Object.entries(files)) {
    if (!live.has(threadId)) continue;
    for (const path of Object.keys(edits)) editors.set(path, [...(editors.get(path) ?? []), threadId]);
  }
  const result = new Map<string, FileOverlap[]>();
  for (const [path, threadIds] of editors) {
    if (threadIds.length < 2) continue;
    for (const threadId of threadIds) {
      const others = threadIds.filter((id) => id !== threadId).map((otherThreadId) => ({ path, otherThreadId }));
      result.set(threadId, [...(result.get(threadId) ?? []), ...others]);
    }
  }
  return result;
}

const USER_TEXT_LIMIT = 1000;
const AGENT_TEXT_LIMIT = 4000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function blocksText(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'image':
          return '[image]';
        case 'audio':
          return '[audio]';
        case 'resource_link':
          return `[file ${block.name}]`;
        case 'resource':
          return `[file ${block.resource.uri}]`;
        default: {
          const unreachable: never = block;
          return unreachable;
        }
      }
    })
    .join('')
    .trim();
}

function permissionOutcome(event: Extract<ThreadEvent, { kind: 'permission' }>): string {
  const { outcome } = event;
  if (outcome === null) return 'waiting for the user';
  if (outcome === 'cancelled') return 'withdrawn';
  const chosen = event.options.find((o) => o.optionId === outcome.optionId);
  return chosen?.kind.startsWith('reject') ? 'rejected' : 'allowed';
}

/**
 * A session's latest transcript entries as text, for a lead's `grove_read`: messages, tool call
 * titles and statuses, permission titles, plans, notices and errors. Thoughts, raw tool input and
 * output, and screenshots are left out.
 */
export function transcriptLines(events: readonly ThreadEvent[], limit: number): string[] {
  const lines = events.flatMap((event): string[] => {
    switch (event.kind) {
      case 'user_message':
        return [`User: ${clip(blocksText(event.blocks), USER_TEXT_LIMIT)}`];
      case 'agent_message': {
        const text = blocksText(event.blocks);
        return text ? [`Agent: ${clip(text, AGENT_TEXT_LIMIT)}`] : [];
      }
      case 'tool_call':
        return [`Tool: ${event.title} (${event.status})`];
      case 'permission':
        return [`Permission: ${event.title} (${permissionOutcome(event)})`];
      case 'plan': {
        const done = event.entries.filter((e) => e.status === 'completed').length;
        return [`Plan: ${done} of ${event.entries.length} done`];
      }
      case 'turn_end':
        return [`Turn ended (${event.stopReason})`];
      case 'notice':
        return [`Notice: ${event.title}`];
      case 'error':
        return [`Error: ${clip(event.message, USER_TEXT_LIMIT)}`];
      case 'agent_thought':
      case 'browser_preview':
        return [];
      case 'action_trace': {
        const last = event.steps.at(-1);
        return last ? [`Trace: ${event.steps.length} steps, last ${last.title}`] : [];
      }
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }
  });
  return lines.slice(-Math.max(1, limit));
}

/**
 * A website opened from a Grove terminal or a Grove dev-server confirmation.
 * A browser-workspace link is not this action.
 */
export interface GroveWebsiteAction {
  /** Show the browser workspace (`showWorkspace`). */
  readonly switchWorkspace: 'browser';
  /** Open this folder on the window. Null keeps the project the window already has. */
  readonly openProject: string | null;
  /** Load this URL in that project's browser. */
  readonly navigate: string;
}

/**
 * Given Grove, the project that owns the terminal or dev server, and a URL: switch to the browser
 * workspace, open that project, and navigate to the URL. A missing project keeps the window's
 * current one. A browser-workspace click stays on its existing path.
 */
export function groveWebsiteAction(input: {
  readonly workspace: 'browser' | 'grove';
  /** Project that owns the terminal or dev server, or null when none is known. */
  readonly projectPath: string | null;
  readonly url: string;
}): GroveWebsiteAction | null {
  if (input.workspace !== 'grove') return null;
  return { switchWorkspace: 'browser', openProject: input.projectPath, navigate: input.url };
}

/** `40s`, `2m`, `1h 5m`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The project Ctrl+Tab lands on. The first step leaves `current`, the way Alt+Tab skips the
 * window you are already in. Fewer than two projects does nothing.
 */
export function cycleListedProject(paths: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (paths.length < 2) return null;
  const index = current == null ? -1 : paths.indexOf(current);
  const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return paths[(start + delta + paths.length) % paths.length] ?? null;
}
