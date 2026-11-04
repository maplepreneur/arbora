import { describe, expect, it } from 'vitest';
import {
  activityFromEvents,
  idleThreadState,
  type AgentDefinition,
  type ThreadAttention,
  type ThreadEvent,
  type ThreadStatus,
  type ThreadSummary,
} from '@arbora/shared';
import { activityOf, buildGroveModel, neighbourSession, selectionAfterRemoval } from './grove-model';
import { applyChanges } from './agent-store';

const agents: AgentDefinition[] = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [], env: {}, builtIn: true },
  { id: 'codex', name: 'Codex', command: 'codex', args: [], env: {}, builtIn: true },
];

function thread(id: string, overrides: Partial<ThreadSummary> & { status?: ThreadStatus } = {}): ThreadSummary {
  const { status = 'ready', ...rest } = overrides;
  return {
    id,
    agentId: 'claude-code',
    title: 'New thread',
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    updatedAt: 1,
    sessionId: null,
    autoApproveEdits: false,
    groupId: null,
    pinned: false,
    archivedAt: null,
    parentThreadId: null,
    state: { ...idleThreadState(), status },
    ...rest,
  };
}

const edit = (id: string, path: string, oldText: string | null, newText: string): ThreadEvent => ({
  id,
  at: 1,
  kind: 'tool_call',
  toolCallId: id,
  title: `Edit ${path}`,
  toolKind: 'edit',
  status: 'completed',
  content: [{ type: 'diff', path, oldText, newText }],
  locations: [],
});

const say = (id: string, text: string, at = 1): ThreadEvent => ({
  id,
  at,
  kind: 'agent_message',
  blocks: [{ type: 'text', text }],
});

const ask = (id: string, at: number): ThreadEvent => ({
  id,
  at,
  kind: 'user_message',
  blocks: [{ type: 'text', text: 'go' }],
});

const waiting: ThreadAttention = {
  pendingPermissions: ['r1'],
  permissionTitle: 'Allow edit to App.tsx?',
  auth: false,
  unread: null,
  failure: null,
  lastMessage: null,
  since: 1,
};

describe('activityOf', () => {
  it('folds appended and replaced events like a full replay', () => {
    let events: ThreadEvent[] = [ask('u1', 10), say('m1', 'Looking')];
    expect(activityOf('t-fold', events)).toEqual(activityFromEvents(events));
    events = applyChanges(events, [
      { type: 'replace', index: 1, event: say('m1', 'Looking at the nav') },
      { type: 'append', event: edit('e1', 'src/Nav.tsx', 'a', 'b') },
      { type: 'append', event: { id: 'end', at: 70, kind: 'turn_end', stopReason: 'end_turn' } },
    ]);
    const folded = activityOf('t-fold', events);
    expect(folded).toEqual(activityFromEvents(events));
    expect(folded.lastMessage).toBe('Looking at the nav');
    expect(folded.lastTurnMs).toBe(60);
    // Same array: the cached digest.
    expect(activityOf('t-fold', events)).toBe(folded);
  });

  it('starts over when the transcript was fetched again', () => {
    activityOf('t-reset', [say('m1', 'old'), say('m2', 'older')]);
    const fetched = [say('n1', 'fresh')];
    expect(activityOf('t-reset', fetched).lastMessage).toBe('fresh');
  });
});

describe('buildGroveModel', () => {
  it('names untitled sessions by agent and derives status and line two', () => {
    const model = buildGroveModel({
      threads: [
        thread('t1'),
        thread('t2', { status: 'prompting' }),
        thread('t3', { title: 'fix the nav' }),
        thread('t4', { agentId: 'codex' }),
      ],
      groups: [],
      agents,
      attention: { t4: waiting },
      events: {},
    });
    expect(model.order.map((s) => [s.name, s.status, s.line])).toEqual([
      ['Claude Code', 'idle', 'Idle'],
      ['Claude Code 2', 'working', 'Thinking…'],
      ['fix the nav', 'idle', 'Idle'],
      ['Codex', 'needsYou', 'Allow edit to App.tsx?'],
    ]);
    expect(model.summary).toBe('1 working · 1 needs you');
  });

  it('keeps archived sessions out of the list and newest first in Recent', () => {
    const model = buildGroveModel({
      threads: [thread('t1'), thread('t2', { archivedAt: 5 }), thread('t3', { archivedAt: 9 })],
      groups: [],
      agents,
      attention: {},
      events: {},
    });
    expect(model.order.map((s) => s.id)).toEqual(['t1']);
    expect(model.listed.map((s) => s.id)).toEqual(['t1']);
    expect(model.recent.map((s) => s.id)).toEqual(['t3', 't2']);
    expect(model.byId.get('t2')?.archivedAt).toBe(5);
  });

  it('nests helpers under their lead and warns when live sessions edit the same file', () => {
    const model = buildGroveModel({
      threads: [
        thread('t1', { title: 'lead' }),
        thread('t2', { title: 'other' }),
        thread('t3', { title: 'helper', parentThreadId: 't1' }),
        thread('t4', { title: 'stopped', status: 'idle' }),
      ],
      groups: [],
      agents,
      attention: {},
      events: {
        t1: [edit('a', 'src/App.tsx', 'x', 'y')],
        t2: [edit('b', 'src/App.tsx', 'x', 'z')],
        t4: [edit('c', 'src/App.tsx', 'x', 'w')],
      },
    });
    expect(model.sections.flatMap((s) => s.rows.map((r) => [r.thread.name, r.helper]))).toEqual([
      ['lead', false],
      ['helper', true],
      ['other', false],
      ['stopped', false],
    ]);
    expect(model.byId.get('t1')?.overlaps).toEqual([{ path: 'src/App.tsx', otherThreadId: 't2' }]);
    // A stopped session is not editing anything any more.
    expect(model.byId.get('t4')?.overlaps).toEqual([]);
  });
});

describe('neighbourSession', () => {
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves and wraps', () => {
    expect(neighbourSession(order, 'a', 1)).toBe('b');
    expect(neighbourSession(order, 'c', 1)).toBe('a');
    expect(neighbourSession(order, 'a', -1)).toBe('c');
  });

  it('starts at an end without a selection', () => {
    expect(neighbourSession(order, null, 1)).toBe('a');
    expect(neighbourSession(order, 'gone', -1)).toBe('c');
    expect(neighbourSession([], null, 1)).toBeNull();
  });
});

describe('selectionAfterRemoval', () => {
  it('prefers the row below, then the row above', () => {
    const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectionAfterRemoval(order, 'b')).toBe('c');
    expect(selectionAfterRemoval(order, 'c')).toBe('b');
    expect(selectionAfterRemoval([{ id: 'a' }], 'a')).toBeNull();
  });
});
