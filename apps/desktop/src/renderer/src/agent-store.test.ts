import { describe, expect, it } from 'vitest';
import { idleThreadState, type AgentDefinition, type ThreadSummary } from '@arbora/shared';
import {
  applyConfirmation,
  defaultAgentModeTarget,
  isStoppable,
  resetAgents,
  resolveConfirmation,
  useAgents,
} from './agent-store';

const confirmation = (requestId: string): Parameters<typeof applyConfirmation>[0] => ({
  requestId,
  threadId: 't1',
  title: 'Allow browser_evaluate?',
  detail: 'The agent wants to run JavaScript in the page.',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
  ],
});

describe('confirmations', () => {
  it('raises a card and resolves it once answered', () => {
    applyConfirmation(confirmation('r1'));
    expect(Object.keys(useAgents.getState().confirmations)).toEqual(['r1']);
    resolveConfirmation('r1');
    expect(Object.keys(useAgents.getState().confirmations)).toEqual([]);
  });

  it('leaves other cards alone', () => {
    applyConfirmation(confirmation('r1'));
    applyConfirmation(confirmation('r2'));
    resolveConfirmation('r1');
    expect(Object.keys(useAgents.getState().confirmations)).toEqual(['r2']);
    resolveConfirmation('r2');
    resetAgents();
    expect(Object.keys(useAgents.getState().confirmations)).toEqual([]);
  });
});

describe('defaultAgentModeTarget', () => {
  const agent = (id: string): AgentDefinition => ({
    id,
    name: id,
    command: id,
    args: [],
    env: {},
    builtIn: true,
    probe: [],
    task: [],
  });
  const thread = (id: string): ThreadSummary => ({
    id,
    agentId: 'kimi',
    title: id,
    createdAt: 1,
    updatedAt: 1,
    groupId: null,
    pinned: false,
    archivedAt: null,
    parentThreadId: null,
    state: idleThreadState(),
  });
  const base = {
    threads: [thread('t1'), thread('t2')],
    agents: [agent('claude-code'), agent('kimi'), agent('opencode')],
    availability: [
      { id: 'claude-code', available: false },
      { id: 'kimi', available: true },
      { id: 'opencode', available: true },
    ],
  };

  it('uses the thread in the chat column', () => {
    expect(defaultAgentModeTarget(base, 't2', 'opencode')).toBe('thread:t2');
  });

  it('starts a new thread with the default agent when no thread is open', () => {
    expect(defaultAgentModeTarget(base, null, 'opencode')).toBe('new:opencode');
    expect(defaultAgentModeTarget(base, 'gone', 'opencode')).toBe('new:opencode');
  });

  it('falls back to the first detected agent, then the first listed', () => {
    expect(defaultAgentModeTarget(base, null, undefined)).toBe('new:kimi');
    expect(defaultAgentModeTarget({ ...base, availability: [] }, null, undefined)).toBe('new:claude-code');
    expect(defaultAgentModeTarget({ ...base, agents: [] }, null, undefined)).toBeNull();
  });
});

describe('isStoppable', () => {
  it('is true while the agent works or starts', () => {
    expect(isStoppable('working')).toBe(true);
    expect(isStoppable('starting')).toBe(true);
    expect(isStoppable('ready')).toBe(false);
    expect(isStoppable('idle')).toBe(false);
  });
});
