import { describe, expect, it } from 'vitest';
import { threadSections, threadSummarySchema, type AgentGroup } from './agent.js';

const groups: AgentGroup[] = [
  { id: 'ui', name: 'UI', color: 'blue', collapsed: false },
  { id: 'api', name: 'API', color: 'green', collapsed: true },
];

function thread(id: string, groupId: string | null, pinned = false) {
  return { id, groupId, pinned };
}

describe('threadSections', () => {
  it('puts pinned first, then each group in order, then the ungrouped rest', () => {
    const sections = threadSections(
      [thread('a', 'ui'), thread('b', null), thread('c', 'api', true), thread('d', 'gone')],
      groups,
    );
    expect(sections.map((s) => [s.id, s.title, s.threads.map((t) => t.id)])).toEqual([
      ['pinned', 'Pinned', ['c']],
      ['group:ui', 'UI', ['a']],
      ['group:api', 'API', []],
      ['threads', 'Ungrouped', ['b', 'd']],
    ]);
  });

  it('is one plain list without groups', () => {
    expect(threadSections([thread('a', null)], []).map((s) => s.title)).toEqual(['Threads']);
    expect(threadSections([], [])).toHaveLength(1);
  });
});

describe('threadSummarySchema', () => {
  it('defaults the group and pin for threads saved before Stage 9', () => {
    const parsed = threadSummarySchema.parse({
      id: 't',
      agentId: 'kimi',
      title: 'x',
      createdAt: 1,
      updatedAt: 1,
      sessionId: null,
      autoApproveEdits: false,
      state: {
        status: 'idle',
        error: null,
        authMethods: [],
        modes: null,
        configOptions: [],
        availableCommands: [],
        capabilities: null,
        contextLost: false,
      },
    });
    expect(parsed).toMatchObject({ groupId: null, pinned: false, archivedAt: null, parentThreadId: null });
  });
});
