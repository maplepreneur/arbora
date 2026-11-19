import type { ThreadState, ThreadStatus } from './agent.js';
import type { AttentionKind } from './settings.js';

/**
 * Whether a thread needs the user, derived from its terminal status: an input request or one of
 * Arbora's own confirmation cards holds while it waits; `finished` and `failed` hold until the
 * user looks at the thread.
 */
export interface ThreadAttention {
  /** The status this attention was last computed from. */
  readonly status: ThreadStatus;
  /** The question the agent's terminal is waiting on, from its last output line. */
  readonly waiting: string | null;
  /** A confirmation card Arbora raised itself (a guarded browser tool, a helper start). */
  readonly confirmation: string | null;
  readonly unread: 'finished' | 'failed' | null;
  readonly failure: string | null;
  /** The last line the agent printed, for "finished" notifications. */
  readonly lastMessage: string | null;
  /** When the current attention kind started (oldest wait is shown first). */
  readonly since: number;
}

export const NO_ATTENTION: ThreadAttention = {
  status: 'idle',
  waiting: null,
  confirmation: null,
  unread: null,
  failure: null,
  lastMessage: null,
  since: 0,
};

export type AttentionInput =
  | { readonly type: 'status'; readonly state: ThreadState; readonly at: number }
  /** Arbora raised (or resolved) one of its own confirmation cards for this thread. */
  | { readonly type: 'confirmation'; readonly title: string | null; readonly at: number }
  /** The user is looking at the thread in a focused window. */
  | { readonly type: 'seen' };

export interface AttentionStep {
  readonly next: ThreadAttention;
  /** Set when the thread just moved into a kind that should notify. */
  readonly signal: AttentionKind | null;
}

/** Input request > failed > finished. */
export function attentionKind(attention: ThreadAttention | undefined): AttentionKind | null {
  if (!attention) return null;
  if (attention.waiting !== null || attention.confirmation !== null) return 'permission';
  return attention.unread;
}

function step(previous: ThreadAttention, next: ThreadAttention, at: number): AttentionStep {
  const before = attentionKind(previous);
  const after = attentionKind(next);
  const signal = after !== null && after !== before ? after : null;
  // A new question while another kind was showing restarts the wait clock.
  const since = signal !== null ? at : next.since;
  return { next: { ...next, since }, signal };
}

export function reduceAttention(current: ThreadAttention | undefined, input: AttentionInput): AttentionStep {
  const previous = current ?? NO_ATTENTION;
  switch (input.type) {
    case 'status': {
      const { status, error, lastLine } = input.state;
      const at = input.at;
      let next: ThreadAttention = { ...previous, status, lastMessage: lastLine ?? previous.lastMessage };
      switch (status) {
        case 'working':
          // A new prompt clears anything the user was meant to see; a resolved card stays resolved.
          next = { ...next, waiting: null, unread: null, failure: null };
          break;
        case 'needs_input':
          next = { ...next, waiting: lastLine ?? 'The agent is waiting for an answer', unread: null, failure: null };
          break;
        case 'ready':
          // The turn ended quietly. Only a finish that follows work is news.
          next = {
            ...next,
            waiting: null,
            unread: previous.status === 'working' ? 'finished' : previous.unread,
            failure: null,
          };
          break;
        case 'error':
          next = { ...next, waiting: null, unread: 'failed', failure: error ?? 'The agent stopped' };
          break;
        case 'starting':
        case 'idle':
          // Starting is never news; a stopped process cannot be waiting for anything.
          next = { ...next, waiting: null };
          break;
        default: {
          const unreachable: never = status;
          throw new Error(`Unhandled thread status ${String(unreachable)}`);
        }
      }
      return step(previous, next, at);
    }
    case 'confirmation': {
      // A raised card is news even mid-turn; resolving it is not.
      const next: ThreadAttention = { ...previous, confirmation: input.title };
      return step(previous, next, input.at);
    }
    case 'seen':
      // Looking at the thread settles a finish or a failure; a question still needs an answer.
      if (previous.unread === null) return { next: previous, signal: null };
      return { next: { ...previous, unread: null, failure: null }, signal: null };
    default: {
      const unreachable: never = input;
      throw new Error(`Unhandled attention input ${String(unreachable)}`);
    }
  }
}

/** Notification title and body, in the wording of PLAN § 4.12. Never includes raw terminal output. */
export function attentionMessage(
  kind: AttentionKind,
  name: string,
  attention: ThreadAttention,
): { title: string; body: string } {
  switch (kind) {
    case 'permission':
      return {
        title: `${name}: waiting for you`,
        body: attention.confirmation ?? attention.waiting ?? 'Answer it in its terminal.',
      };
    case 'auth':
      return { title: `${name}: needs you to log in`, body: 'Log in inside its terminal.' };
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
 * The thread to jump to: the oldest waiting input request, else the oldest failure, else the
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
