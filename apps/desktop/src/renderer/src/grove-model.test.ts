import { describe, expect, it } from 'vitest';
import {
  idleThreadState,
  type AgentDefinition,
  type ThreadAttention,
  type ThreadStatus,
  type ThreadSummary,
} from '@arbora/shared';
import { buildGroveModel, neighbourSession, selectionAfterRemoval } from './grove-model';

const agents: AgentDefinition[] = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [], env: {}, builtIn: true, probe: [], task: [] },
  { id: 'codex', name: 'Codex', command: 'codex', args: [], env: {}, builtIn: true, probe: [], task: [] },
];

function thread(id: string, overrides: Partial<ThreadSummary> & { status?: ThreadStatus } = {}): ThreadSummary {
  const { status = 'ready', ...rest } = overrides;
  return {
    id,
    agentId: 'claude-code',
    title: 'New thread',
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    updatedAt: 1,
    groupId: null,
    pinned: false,
    archivedAt: null,
    parentThreadId: null,
    state: { ...idleThreadState(), status },
    ...rest,
  };
}

const waiting: ThreadAttention = {
  status: 'needs_input',
  waiting: 'Allow edit to App.tsx?',
  confirmation: null,
  unread: null,
  failure: null,
  lastMessage: null,
  since: 1,
};

describe('buildGroveModel', () => {
  it('names untitled sessions by agent and derives status and line two', () => {
    const model = buildGroveModel({
      threads: [
        thread('t1'),
        thread('t2', {
          status: 'working',
          state: { ...idleThreadState(), status: 'working', lastLine: 'Running tests' },
        }),
        thread('t3', { title: 'fix the nav' }),
        thread('t4', { agentId: 'codex' }),
      ],
      groups: [],
      agents,
      attention: { t4: waiting },
      changedFiles: {},
    });
    expect(model.order.map((s) => [s.name, s.status, s.line])).toEqual([
      ['Claude Code', 'idle', 'Idle'],
      ['Claude Code 2', 'working', 'Running tests'],
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
      changedFiles: {},
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
      changedFiles: { t1: ['src/App.tsx'], t2: ['src/App.tsx'], t4: ['src/App.tsx'] },
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
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('prefers the row below, then the row above', () => {
    expect(selectionAfterRemoval(order, 'b')).toBe('c');
    expect(selectionAfterRemoval(order, 'c')).toBe('b');
    expect(selectionAfterRemoval([{ id: 'a' }], 'a')).toBeNull();
  });
});
