import { describe, expect, it } from 'vitest';
import type { ThreadState } from './agent.js';
import {
  attentionCount,
  attentionKind,
  attentionMessage,
  badgeLabel,
  nextAttentionThread,
  NO_ATTENTION,
  reduceAttention,
  type ThreadAttention,
} from './attention.js';

function state(patch: Partial<ThreadState>): ThreadState {
  return {
    status: 'idle',
    error: null,
    terminalId: null,
    lastLine: null,
    turnStartedAt: null,
    lastOutputAt: null,
    lastTurnMs: null,
    ...patch,
  };
}

describe('reduceAttention', () => {
  it('marks a turn that ends quietly as finished, with the last output line', () => {
    const working = reduceAttention(undefined, { type: 'status', state: state({ status: 'working' }), at: 5 });
    expect(working.signal).toBeNull();
    const done = reduceAttention(working.next, {
      type: 'status',
      state: state({ status: 'ready', lastLine: 'Done: the nav is fixed.' }),
      at: 10,
    });
    expect(done.signal).toBe('finished');
    expect(done.next.lastMessage).toBe('Done: the nav is fixed.');
    expect(attentionMessage('finished', 'Codex', done.next)).toEqual({
      title: 'Codex finished',
      body: 'Done: the nav is fixed.',
    });
    const seen = reduceAttention(done.next, { type: 'seen' });
    expect(attentionKind(seen.next)).toBeNull();
  });

  it('a new prompt clears an unread finish', () => {
    const done = reduceAttention(undefined, {
      type: 'status',
      state: state({ status: 'ready' }),
      at: 10,
    });
    const prompting = reduceAttention(done.next, { type: 'status', state: state({ status: 'working' }), at: 20 });
    expect(prompting.signal).toBeNull();
    expect(attentionKind(prompting.next)).toBeNull();
  });

  it('signals a detected input request once, with its question', () => {
    const working = reduceAttention(undefined, { type: 'status', state: state({ status: 'working' }), at: 5 });
    const asked = reduceAttention(working.next, {
      type: 'status',
      state: state({ status: 'needs_input', lastLine: 'Allow edit to src/App.tsx? (y/n)' }),
      at: 10,
    });
    expect(asked.signal).toBe('permission');
    expect(asked.next.waiting).toBe('Allow edit to src/App.tsx? (y/n)');
    expect(attentionMessage('permission', 'Kimi', asked.next).body).toBe('Allow edit to src/App.tsx? (y/n)');
    // Looking at the thread does not answer the question.
    const seen = reduceAttention(asked.next, { type: 'seen' });
    expect(attentionKind(seen.next)).toBe('permission');
    const again = reduceAttention(asked.next, {
      type: 'status',
      state: state({ status: 'needs_input', lastLine: 'Allow edit to src/App.tsx? (y/n)' }),
      at: 11,
    });
    expect(again.signal).toBeNull();
    // The answer, typed into the terminal, puts it back to work.
    const answered = reduceAttention(again.next, { type: 'status', state: state({ status: 'working' }), at: 12 });
    expect(attentionKind(answered.next)).toBeNull();
  });

  it('marks a crash failed, and a restart that only becomes ready does not signal', () => {
    const failed = reduceAttention(undefined, {
      type: 'status',
      state: state({ status: 'error', error: 'Agent exited with code 1' }),
      at: 10,
    });
    expect(failed.signal).toBe('failed');
    expect(attentionMessage('failed', 'Kimi', failed.next).body).toBe('Agent exited with code 1');
    const restarted = reduceAttention(failed.next, { type: 'status', state: state({ status: 'ready' }), at: 11 });
    expect(restarted.signal).toBeNull();
    expect(attentionKind(restarted.next)).toBe('failed');
  });

  it('a stopped process drops a wait', () => {
    const asked = reduceAttention(undefined, {
      type: 'status',
      state: state({ status: 'needs_input', lastLine: 'Proceed? (y/n)' }),
      at: 5,
    });
    const idle = reduceAttention(asked.next, { type: 'status', state: state({ status: 'idle' }), at: 30 });
    expect(attentionKind(idle.next)).toBeNull();
  });

  it('a turn that ends without ever working (a fresh spawn) is not news', () => {
    const step = reduceAttention(undefined, { type: 'status', state: state({ status: 'ready' }), at: 5 });
    expect(step.signal).toBeNull();
    expect(attentionKind(step.next)).toBeNull();
  });

  it('signals a raised confirmation card and clears it once answered', () => {
    const raised = reduceAttention(undefined, { type: 'confirmation', title: 'Run terminal commands?', at: 5 });
    expect(raised.signal).toBe('permission');
    expect(raised.next.confirmation).toBe('Run terminal commands?');
    expect(attentionMessage('permission', 'Codex', raised.next).body).toBe('Run terminal commands?');
    const again = reduceAttention(raised.next, { type: 'confirmation', title: 'Run terminal commands?', at: 6 });
    expect(again.signal).toBeNull();
    const answered = reduceAttention(again.next, { type: 'confirmation', title: null, at: 7 });
    expect(attentionKind(answered.next)).toBeNull();
  });
});

describe('nextAttentionThread', () => {
  it('prefers the oldest wait, then failures, then finishes', () => {
    const finished: ThreadAttention = { ...NO_ATTENTION, unread: 'finished', since: 1 };
    const failed: ThreadAttention = { ...NO_ATTENTION, unread: 'failed', since: 2 };
    const waitingNew: ThreadAttention = { ...NO_ATTENTION, status: 'needs_input', waiting: 'a?', since: 9 };
    const waitingOld: ThreadAttention = { ...NO_ATTENTION, status: 'needs_input', waiting: 'b?', since: 3 };
    expect(nextAttentionThread({ finished, failed })).toBe('failed');
    expect(nextAttentionThread({ finished, failed, waitingNew, waitingOld })).toBe('waitingOld');
    expect(nextAttentionThread({ idle: NO_ATTENTION })).toBeNull();
    expect(attentionCount({ finished, failed, idle: NO_ATTENTION })).toBe(2);
  });
});

describe('badgeLabel', () => {
  it('hides at zero and caps at 9+', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(3)).toBe('3');
    expect(badgeLabel(12)).toBe('9+');
  });
});
