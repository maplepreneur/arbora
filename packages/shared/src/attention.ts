import type { ContentBlock, ThreadChange, ThreadEvent, ThreadStatus } from './agent.js';
import type { AttentionKind } from './settings.js';

/**
 * Whether a thread needs the user, derived from its ACP events and status (not from terminal
 * output). `permission` and `auth` hold while the agent waits; `finished` and `failed` hold until
 * the user looks at the thread.
 */
export interface ThreadAttention {
  /** Request ids of permission cards that have no answer yet. */
  readonly pendingPermissions: readonly string[];
  readonly permissionTitle: string | null;
  readonly auth: boolean;
  readonly unread: 'finished' | 'failed' | null;
  readonly failure: string | null;
  /** First line of the agent's last message, for "finished" notifications. */
  readonly lastMessage: string | null;
  /** When the current attention kind started (oldest wait is shown first). */
  readonly since: number;
}

export const NO_ATTENTION: ThreadAttention = {
  pendingPermissions: [],
  permissionTitle: null,
  auth: false,
  unread: null,
  failure: null,
  lastMessage: null,
  since: 0,
};

export type AttentionInput =
  | { readonly type: 'changes'; readonly changes: readonly ThreadChange[]; readonly at: number }
  | { readonly type: 'status'; readonly status: ThreadStatus; readonly error: string | null; readonly at: number }
  /** The user is looking at the thread in a focused window. */
  | { readonly type: 'seen' };

export interface AttentionStep {
  readonly next: ThreadAttention;
  /** Set when the thread just moved into a kind that should notify. */
  readonly signal: AttentionKind | null;
}

/** Permission > auth > failed > finished. */
export function attentionKind(attention: ThreadAttention | undefined): AttentionKind | null {
  if (!attention) return null;
  if (attention.pendingPermissions.length > 0) return 'permission';
  if (attention.auth) return 'auth';
  return attention.unread;
}

function firstLine(blocks: readonly ContentBlock[]): string | null {
  const text = blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  if (!text) return null;
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 200) || null;
}

function applyEvent(current: ThreadAttention, event: ThreadEvent, at: number): ThreadAttention {
  switch (event.kind) {
    case 'permission':
      if (event.outcome === null) {
        if (current.pendingPermissions.includes(event.requestId)) return current;
        return {
          ...current,
          pendingPermissions: [...current.pendingPermissions, event.requestId],
          permissionTitle: event.title,
        };
      }
      return { ...current, pendingPermissions: current.pendingPermissions.filter((id) => id !== event.requestId) };
    case 'turn_end':
      if (event.stopReason === 'cancelled') return { ...current, pendingPermissions: [] };
      return { ...current, pendingPermissions: [], unread: current.unread ?? 'finished', since: at };
    case 'error':
      return { ...current, unread: 'failed', failure: event.message.slice(0, 300), since: at };
    case 'agent_message': {
      const line = firstLine(event.blocks);
      return line ? { ...current, lastMessage: line } : current;
    }
    case 'user_message':
      return { ...current, unread: null, failure: null };
    case 'agent_thought':
    case 'tool_call':
    case 'plan':
    case 'notice':
    case 'browser_preview':
      return current;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function step(previous: ThreadAttention, next: ThreadAttention, at: number): AttentionStep {
  const before = attentionKind(previous);
  const after = attentionKind(next);
  const signal = after !== null && after !== before ? after : null;
  // A new permission while another kind was showing restarts the wait clock.
  const since = signal !== null && signal !== before ? at : next.since;
  return { next: { ...next, since }, signal };
}

export function reduceAttention(current: ThreadAttention | undefined, input: AttentionInput): AttentionStep {
  const previous = current ?? NO_ATTENTION;
  switch (input.type) {
    case 'changes': {
      let next = previous;
      for (const change of input.changes) {
        switch (change.type) {
          case 'append':
          case 'replace':
            next = applyEvent(next, change.event, input.at);
            break;
          case 'reset':
            next = change.events.reduce((acc, event) => applyEvent(acc, event, input.at), {
              ...NO_ATTENTION,
              auth: next.auth,
            });
            // A transcript reset (session load) is history, not news.
            next = { ...next, unread: null };
            break;
          default: {
            const unreachable: never = change;
            throw new Error(`Unhandled change ${String(unreachable)}`);
          }
        }
      }
      return step(previous, next, input.at);
    }
    case 'status': {
      let next: ThreadAttention = { ...previous, auth: input.status === 'auth_required' };
      if (input.status === 'error' && previous.unread !== 'failed') {
        next = { ...next, unread: 'failed', failure: input.error?.slice(0, 300) ?? null };
      }
      if (input.status === 'prompting' && previous.unread !== null) next = { ...next, unread: null, failure: null };
      // The process stopped: nothing can still be waiting for an answer.
      if (input.status === 'idle') next = { ...next, pendingPermissions: [] };
      return step(previous, next, input.at);
    }
    case 'seen':
      if (previous.unread === null) return { next: previous, signal: null };
      return { next: { ...previous, unread: null, failure: null }, signal: null };
    default: {
      const unreachable: never = input;
      throw new Error(`Unhandled attention input ${String(unreachable)}`);
    }
  }
}

/** Notification title and body, in the wording of PLAN § 4.12. Never includes raw tool input. */
export function attentionMessage(
  kind: AttentionKind,
  name: string,
  attention: ThreadAttention,
): { title: string; body: string } {
  switch (kind) {
    case 'permission':
      return { title: `${name}: waiting for permission`, body: attention.permissionTitle ?? 'Permission requested' };
    case 'auth':
      return { title: `${name}: needs you to log in`, body: 'Open the thread to sign in.' };
    case 'finished':
      return { title: `${name} finished`, body: attention.lastMessage ?? 'The turn ended.' };
    case 'failed':
      return { title: `${name} failed`, body: attention.failure ?? 'The agent stopped with an error.' };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * The thread to jump to: the oldest waiting permission or login, else the oldest failure, else the
 * oldest unread finish.
 */
export function nextAttentionThread(entries: Readonly<Record<string, ThreadAttention>>): string | null {
  const rank = (kind: AttentionKind): number => {
    switch (kind) {
      case 'permission':
      case 'auth':
        return 0;
      case 'failed':
        return 1;
      case 'finished':
        return 2;
      default: {
        const unreachable: never = kind;
        return unreachable;
      }
    }
  };
  let best: { id: string; rank: number; since: number } | null = null;
  for (const [id, attention] of Object.entries(entries)) {
    const kind = attentionKind(attention);
    if (kind === null) continue;
    const candidate = { id, rank: rank(kind), since: attention.since };
    if (!best || candidate.rank < best.rank || (candidate.rank === best.rank && candidate.since < best.since)) {
      best = candidate;
    }
  }
  return best?.id ?? null;
}

export function attentionCount(entries: Readonly<Record<string, ThreadAttention>>): number {
  return Object.values(entries).filter((attention) => attentionKind(attention) !== null).length;
}

/** `9+` above nine, empty at zero. */
export function badgeLabel(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}
