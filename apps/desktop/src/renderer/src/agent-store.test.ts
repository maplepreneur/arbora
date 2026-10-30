import { describe, expect, it } from 'vitest';
import { idleThreadState, type AgentDefinition, type ThreadEvent, type ThreadSummary } from '@arbora/shared';
import { applyChanges, defaultAgentModeTarget, isStoppable } from './agent-store';

const message = (id: string, text: string): ThreadEvent => ({
  id,
  at: 1,
  kind: 'agent_message',
  blocks: [{ type: 'text', text }],
});

describe('applyChanges', () => {
  it('appends, replaces in place and resets', () => {
    const a = message('a', 'hello');
    const b = message('b', 'world');
    let events = applyChanges([], [{ type: 'append', event: a }]);
    expect(events).toEqual([a]);
    events = applyChanges(events, [
      { type: 'append', event: b },
      { type: 'replace', index: 0, event: message('a', 'hello!') },
    ]);
    expect(events.map((e) => (e.kind === 'agent_message' ? e.blocks[0] : null))).toEqual([
      { type: 'text', text: 'hello!' },
      { type: 'text', text: 'world' },
    ]);
    events = applyChanges(events, [{ type: 'reset', events: [b] }]);
    expect(events).toEqual([b]);
  });

  it('appends when a replace targets an index that does not exist yet', () => {
    const events = applyChanges([], [{ type: 'replace', index: 3, event: message('x', 'late') }]);
    expect(events).toHaveLength(1);
  });

  it('does not mutate the input', () => {
    const input = [message('a', 'x')];
    applyChanges(input, [{ type: 'append', event: message('b', 'y') }]);
    expect(input).toHaveLength(1);
  });
});

describe('defaultAgentModeTarget', () => {
  const agent = (id: string): AgentDefinition => ({ id, name: id, command: id, args: [], env: {}, builtIn: true });
  const thread = (id: string): ThreadSummary => ({
    id,
    agentId: 'kimi',
    title: id,
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    autoApproveEdits: false,
    state: idleThreadState(),
  });
  const base = {
    view: 'threads' as const,
    activeThreadId: null,
    threads: [thread('t1'), thread('t2')],
    agents: [agent('claude-code'), agent('kimi'), agent('opencode')],
    availability: [
      { id: 'claude-code', available: false },
      { id: 'kimi', available: true },
      { id: 'opencode', available: true },
    ],
  };

  it('uses the thread open in the agent panel', () => {
    expect(defaultAgentModeTarget({ ...base, view: 'thread', activeThreadId: 't2' }, 'opencode')).toBe('thread:t2');
  });

  it('starts a new thread with the default agent when no thread is open', () => {
    expect(defaultAgentModeTarget({ ...base, activeThreadId: 't2' }, 'opencode')).toBe('new:opencode');
    expect(defaultAgentModeTarget({ ...base, view: 'thread', activeThreadId: 'gone' }, 'opencode')).toBe(
      'new:opencode',
    );
  });

  it('falls back to the first detected agent, then the first listed', () => {
    expect(defaultAgentModeTarget(base, undefined)).toBe('new:kimi');
    expect(defaultAgentModeTarget({ ...base, availability: [] }, undefined)).toBe('new:claude-code');
    expect(defaultAgentModeTarget({ ...base, agents: [] }, undefined)).toBeNull();
  });
});

describe('isStoppable', () => {
  it('is true while the agent works or starts', () => {
    expect(isStoppable('prompting')).toBe(true);
    expect(isStoppable('starting')).toBe(true);
    expect(isStoppable('ready')).toBe(false);
    expect(isStoppable('idle')).toBe(false);
  });
});
