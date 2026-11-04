import {
  activityFromEvents,
  activityLine,
  deriveSessionStatus,
  displayNames,
  groveRows,
  groveSummary,
  NO_ACTIVITY,
  overlaps,
  reduceActivity,
  visibleRows,
  type AgentDefinition,
  type AgentGroup,
  type FileOverlap,
  type GroveSection,
  type SessionActivity,
  type SessionStatus,
  type ThreadAttention,
  type ThreadEvent,
  type ThreadSummary,
} from '@arbora/shared';

/** A thread as Grove shows it: the summary plus everything derived for its row. */
export interface GroveSession extends ThreadSummary {
  /** The row name (`displayNames`). */
  readonly name: string;
  readonly agentName: string;
  readonly status: SessionStatus;
  readonly activity: SessionActivity;
  readonly attention: ThreadAttention | undefined;
  /** Line two of the row. */
  readonly line: string;
  /** Files another live session also edited. */
  readonly overlaps: readonly FileOverlap[];
}

export interface GroveModelInput {
  readonly threads: readonly ThreadSummary[];
  readonly groups: readonly AgentGroup[];
  readonly agents: readonly AgentDefinition[];
  readonly attention: Readonly<Record<string, ThreadAttention>>;
  readonly events: Readonly<Record<string, readonly ThreadEvent[]>>;
}

export interface GroveModel {
  readonly sections: readonly GroveSection<GroveSession>[];
  /** Listed rows in screen order, collapsed groups skipped: what `Mod+1`..`Mod+9` and Next/Previous walk. */
  readonly order: readonly GroveSession[];
  /** Every unarchived session. */
  readonly listed: readonly GroveSession[];
  /** Archived sessions, most recently archived first. */
  readonly recent: readonly GroveSession[];
  readonly byId: ReadonlyMap<string, GroveSession>;
  /** "2 working · 1 needs you". */
  readonly summary: string;
}

interface Fold {
  readonly events: readonly ThreadEvent[];
  readonly activity: SessionActivity;
}

const folds = new Map<string, Fold>();

/**
 * The activity digest of a thread's transcript. The store copies the array on every change and
 * keeps the untouched events, so only appended and replaced events are folded in; a transcript
 * that was fetched again (a new first event) or got shorter is folded from scratch.
 */
export function activityOf(threadId: string, events: readonly ThreadEvent[] | undefined): SessionActivity {
  if (!events) return NO_ACTIVITY;
  const previous = folds.get(threadId);
  if (previous?.events === events) return previous.activity;
  let activity: SessionActivity;
  if (
    previous &&
    previous.events.length > 0 &&
    events.length >= previous.events.length &&
    events[0] === previous.events[0]
  ) {
    activity = previous.activity;
    events.forEach((event, index) => {
      if (event !== previous.events[index]) activity = reduceActivity(activity, event);
    });
  } else {
    activity = activityFromEvents(events);
  }
  folds.set(threadId, { events, activity });
  return activity;
}

/** A process is up: these count for the overlap warning. */
function isLive(thread: ThreadSummary): boolean {
  const { status } = thread.state;
  return thread.archivedAt === null && status !== 'idle' && status !== 'error';
}

export function buildGroveModel(input: GroveModelInput): GroveModel {
  const agentNames = new Map(input.agents.map((agent) => [agent.id, agent.name]));
  const agentName = (agentId: string): string => agentNames.get(agentId) ?? agentId;
  const names = displayNames(input.threads, agentName);
  const known = new Set(input.threads.map((thread) => thread.id));
  for (const id of folds.keys()) if (!known.has(id)) folds.delete(id);
  const activities = new Map(
    input.threads.map((thread) => [thread.id, activityOf(thread.id, input.events[thread.id])]),
  );
  const overlapping = overlaps(
    Object.fromEntries([...activities].map(([id, activity]) => [id, activity.files])),
    new Set(input.threads.filter(isLive).map((thread) => thread.id)),
  );
  const sessions = input.threads.map((thread): GroveSession => {
    const attention = input.attention[thread.id];
    const status = deriveSessionStatus(thread.state.status, attention);
    const activity = activities.get(thread.id) ?? NO_ACTIVITY;
    return {
      ...thread,
      name: names.get(thread.id) ?? agentName(thread.agentId),
      agentName: agentName(thread.agentId),
      status,
      activity,
      attention,
      line: activityLine(status, activity, attention, thread.state.error),
      overlaps: overlapping.get(thread.id) ?? [],
    };
  });
  const sections = groveRows(sessions, input.groups);
  const listed = sessions.filter((session) => session.archivedAt === null);
  return {
    sections,
    order: visibleRows(sections),
    listed,
    recent: sessions
      .filter((session) => session.archivedAt !== null)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    byId: new Map(sessions.map((session) => [session.id, session])),
    summary: groveSummary(listed.map((session) => session.status)),
  };
}

/** The row `delta` away from `currentId` in screen order, wrapping; the first row without a current one. */
export function neighbourSession(
  order: readonly Pick<GroveSession, 'id'>[],
  currentId: string | null,
  delta: number,
): string | null {
  if (order.length === 0) return null;
  const index = order.findIndex((session) => session.id === currentId);
  if (index === -1) return order[delta < 0 ? order.length - 1 : 0]?.id ?? null;
  return order[(index + delta + order.length * Math.abs(delta)) % order.length]?.id ?? null;
}

/**
 * Where the selection goes when `removedId` leaves the list (archived or deleted): the row below
 * it, else the row above, else nothing.
 */
export function selectionAfterRemoval(order: readonly Pick<GroveSession, 'id'>[], removedId: string): string | null {
  const index = order.findIndex((session) => session.id === removedId);
  if (index === -1) return order[0]?.id ?? null;
  return order[index + 1]?.id ?? order[index - 1]?.id ?? null;
}
