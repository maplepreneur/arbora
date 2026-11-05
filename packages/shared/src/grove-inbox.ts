import { attentionKind, type ThreadAttention } from './attention.js';

/** Why an agent is in the Grove inbox. Needs-input waits on the user; the others just ended. */
export type InboxReason = 'needsInput' | 'finished' | 'failed';

export interface GroveInboxThread {
  readonly id: string;
  readonly projectPath: string;
  /** Archived sessions stay in Recent, not the inbox. */
  readonly archivedAt: number | null;
  readonly parentThreadId: string | null;
  readonly attention: ThreadAttention | undefined;
}

export interface GroveInboxItem {
  readonly threadId: string;
  readonly projectPath: string;
  readonly reason: InboxReason;
  /** When this wait or finish started, for ordering. */
  readonly since: number;
}

/**
 * Agents that need a person, across every Grove project: a pending permission or a sign-in, or a
 * turn that just finished (or failed) and has not been seen. A running agent with nothing waiting
 * is left in its project. A helper's finish is its lead's, so it stays out; its questions do not.
 * The agent also stays listed under its project. This is the jump list, not a second copy that
 * hides the row.
 */
export function groveInbox(threads: readonly GroveInboxThread[]): GroveInboxItem[] {
  const items: GroveInboxItem[] = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const kind = attentionKind(thread.attention);
    if (kind === null) continue;
    if (kind === 'finished' && thread.parentThreadId !== null) continue;
    const reason = inboxReason(kind);
    items.push({
      threadId: thread.id,
      projectPath: thread.projectPath,
      reason,
      since: thread.attention?.since ?? 0,
    });
  }
  items.sort((a, b) => {
    const rank = reasonRank(a.reason) - reasonRank(b.reason);
    if (rank !== 0) return rank;
    // Oldest permission first. Newest finish first, so the one that just ended is at the top of that group.
    return a.reason === 'needsInput' ? a.since - b.since : b.since - a.since;
  });
  return items;
}

/**
 * Opening an inbox row focuses that project and that agent. `focusPath` is null when the project
 * is the window's own project: Grove already follows it, the same rule as `focusGroveProject`.
 */
export function inboxTarget(
  item: Pick<GroveInboxItem, 'threadId' | 'projectPath'>,
  windowProjectPath: string | null,
): { focusPath: string | null; threadId: string } {
  return {
    focusPath: item.projectPath === windowProjectPath ? null : item.projectPath,
    threadId: item.threadId,
  };
}

function inboxReason(kind: 'permission' | 'auth' | 'finished' | 'failed'): InboxReason {
  switch (kind) {
    case 'permission':
    case 'auth':
      return 'needsInput';
    case 'finished':
      return 'finished';
    case 'failed':
      return 'failed';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function reasonRank(reason: InboxReason): number {
  switch (reason) {
    case 'needsInput':
      return 0;
    case 'failed':
      return 1;
    case 'finished':
      return 2;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
