import { describe, expect, it } from 'vitest';
import type { ThreadChange, ThreadEvent } from './agent.js';
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

const base = { id: 'e', at: 0 };

function append(event: ThreadEvent): ThreadChange {
  return { type: 'append', event };
}

function permission(requestId: string, outcome: Extract<ThreadEvent, { kind: 'permission' }>['outcome']): ThreadEvent {
  return {
    ...base,
    kind: 'permission',
    requestId,
    toolCallId: 't',
    title: 'Edit src/App.tsx',
    toolKind: 'edit',
    options: [],
    locations: [],
    outcome,
  };
}

function run(start: ThreadAttention | undefined, changes: ThreadChange[], at = 10) {
  return reduceAttention(start, { type: 'changes', changes, at });
}

describe('reduceAttention', () => {
  it('signals a pending permission and clears it when answered', () => {
    const asked = run(undefined, [append(permission('r1', null))]);
    expect(asked.signal).toBe('permission');
    expect(attentionKind(asked.next)).toBe('permission');
    expect(asked.next.permissionTitle).toBe('Edit src/App.tsx');
    const answered = run(asked.next, [
      { type: 'replace', index: 0, event: permission('r1', { optionId: 'a', auto: false }) },
    ]);
    expect(answered.signal).toBeNull();
    expect(attentionKind(answered.next)).toBeNull();
  });

  it('does not signal an automatic answer that arrives in the same batch', () => {
    const step = run(undefined, [
      append(permission('r1', null)),
      { type: 'replace', index: 0, event: permission('r1', { optionId: 'a', auto: true }) },
    ]);
    expect(step.signal).toBeNull();
  });

  it('marks a completed turn finished until seen, with the first line of the last message', () => {
    const step = run(undefined, [
      append({ ...base, kind: 'agent_message', blocks: [{ type: 'text', text: '\nDone: the nav is fixed.\nMore' }] }),
      append({ ...base, kind: 'turn_end', stopReason: 'end_turn' }),
    ]);
    expect(step.signal).toBe('finished');
    expect(step.next.lastMessage).toBe('Done: the nav is fixed.');
    expect(attentionMessage('finished', 'Codex', step.next)).toEqual({
      title: 'Codex finished',
      body: 'Done: the nav is fixed.',
    });
    const seen = reduceAttention(step.next, { type: 'seen' });
    expect(attentionKind(seen.next)).toBeNull();
  });

  it('keeps a cancelled turn quiet', () => {
    const step = run(undefined, [append({ ...base, kind: 'turn_end', stopReason: 'cancelled' })]);
    expect(step.signal).toBeNull();
    expect(attentionKind(step.next)).toBeNull();
  });

  it('marks errors failed, and a new prompt clears it', () => {
    const failed = run(undefined, [append({ ...base, kind: 'error', message: 'Agent exited with code 1' })]);
    expect(failed.signal).toBe('failed');
    expect(attentionMessage('failed', 'Kimi', failed.next).body).toBe('Agent exited with code 1');
    const prompting = reduceAttention(failed.next, { type: 'status', status: 'prompting', error: null, at: 20 });
    expect(attentionKind(prompting.next)).toBeNull();
  });

  it('signals a login wait from the status, once', () => {
    const auth = reduceAttention(undefined, { type: 'status', status: 'auth_required', error: null, at: 5 });
    expect(auth.signal).toBe('auth');
    const again = reduceAttention(auth.next, { type: 'status', status: 'auth_required', error: null, at: 6 });
    expect(again.signal).toBeNull();
    const ready = reduceAttention(again.next, { type: 'status', status: 'ready', error: null, at: 7 });
    expect(attentionKind(ready.next)).toBeNull();
  });

  it('a crash status is failed without a second signal after the error event', () => {
    const event = run(undefined, [append({ ...base, kind: 'error', message: 'boom' })]);
    const status = reduceAttention(event.next, { type: 'status', status: 'error', error: 'boom', at: 11 });
    expect(status.signal).toBeNull();
    expect(attentionKind(status.next)).toBe('failed');
  });

  it('treats a transcript reset as history', () => {
    const step = run(undefined, [{ type: 'reset', events: [{ ...base, kind: 'turn_end', stopReason: 'end_turn' }] }]);
    expect(step.signal).toBeNull();
  });

  it('a stopped process drops pending permissions', () => {
    const asked = run(undefined, [append(permission('r1', null))]);
    const idle = reduceAttention(asked.next, { type: 'status', status: 'idle', error: null, at: 30 });
    expect(attentionKind(idle.next)).toBeNull();
  });
});

describe('nextAttentionThread', () => {
  it('prefers the oldest wait, then failures, then finishes', () => {
    const finished: ThreadAttention = { ...NO_ATTENTION, unread: 'finished', since: 1 };
    const failed: ThreadAttention = { ...NO_ATTENTION, unread: 'failed', since: 2 };
    const waitingNew: ThreadAttention = { ...NO_ATTENTION, pendingPermissions: ['a'], since: 9 };
    const waitingOld: ThreadAttention = { ...NO_ATTENTION, auth: true, since: 3 };
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
