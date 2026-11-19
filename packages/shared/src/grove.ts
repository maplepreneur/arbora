import {
  DEFAULT_THREAD_TITLE,
  threadSections,
  type AgentGroup,
  type ThreadState,
  type ThreadStatus,
  type ThreadSummary,
} from './agent.js';
import { attentionKind, type ThreadAttention } from './attention.js';

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
 * The session's status from its terminal state and the Stage 9 attention state. A wait on the user
 * wins, then a failure, then what the process is doing. An unread finish stays Done after the
 * process is gone, so the bell never counts a row that looks quiet.
 */
export function deriveSessionStatus(status: ThreadStatus, attention: ThreadAttention | undefined): SessionStatus {
  const kind = attentionKind(attention);
  if (kind === 'permission' || kind === 'auth' || status === 'needs_input') return 'needsYou';
  if (status === 'error' || kind === 'failed') return 'failed';
  switch (status) {
    case 'working':
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

/** Statuses a lead's `grove_wait` stops waiting at: nothing more happens until someone acts. */
export function isSettledStatus(status: SessionStatus): boolean {
  return status !== 'working' && status !== 'starting';
}

export interface DefaultSessionCheck {
  /** Unarchived sessions in the project. */
  readonly sessionCount: number;
  readonly defaultAgentId: string | null;
  /** The default agent's executable was found (registry detection). */
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

/** Line two of a row (PLAN § 4.12), from the terminal state instead of a transcript. */
export function activityLine(
  status: SessionStatus,
  state: Pick<ThreadState, 'lastLine' | 'error'>,
  attention: ThreadAttention | undefined,
): string {
  const line = (state.lastLine ?? '').trim();
  switch (status) {
    case 'needsYou':
      return attention?.waiting ?? (line || 'Needs you');
    case 'working':
      return line || 'Working…';
    case 'starting':
      return line || 'Starting…';
    case 'done':
    case 'idle':
      return line || (status === 'done' ? 'Done' : 'Idle');
    case 'failed':
      return attention?.failure ?? state.error ?? 'Failed';
    case 'stopped':
      return line || 'Stopped';
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
 * `files` maps each thread to the paths it changed while its turn ran; `live` holds the sessions
 * that are listed and have a process.
 */
export function overlaps(
  files: Readonly<Record<string, readonly string[]>>,
  live: ReadonlySet<string>,
): Map<string, FileOverlap[]> {
  const editors = new Map<string, string[]>();
  for (const [threadId, paths] of Object.entries(files)) {
    if (!live.has(threadId)) continue;
    for (const path of paths) editors.set(path, [...(editors.get(path) ?? []), threadId]);
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

const LINE_LIMIT = 4000;

/**
 * A session's terminal tail as text, for a lead's `grove_read`: the last lines the agent printed
 * (ANSI stripped), with the waiting question last when it is waiting for the user.
 */
export function terminalLines(state: ThreadState, lastLines: readonly string[], limit: number): string[] {
  const lines = lastLines.map((line) => (line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)}…` : line));
  const out = lines.slice(-Math.max(1, limit));
  if (state.status === 'needs_input' && state.lastLine && !out.includes(state.lastLine)) {
    out.push(state.lastLine);
  }
  return out;
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
