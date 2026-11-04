import { describe, expect, it } from 'vitest';
import { NO_ATTENTION, type ThreadAttention } from './attention.js';
import { groveInbox, inboxTarget, type GroveInboxThread } from './grove-inbox.js';

function thread(partial: Partial<GroveInboxThread> & Pick<GroveInboxThread, 'id' | 'projectPath'>): GroveInboxThread {
  return {
    archivedAt: null,
    parentThreadId: null,
    attention: undefined,
    ...partial,
  };
}

const waiting: ThreadAttention = {
  ...NO_ATTENTION,
  pendingPermissions: ['r1'],
  permissionTitle: 'Edit src/App.tsx',
  since: 10,
};

const finished: ThreadAttention = {
  ...NO_ATTENTION,
  unread: 'finished',
  lastMessage: 'Updated the header',
  since: 20,
};

describe('groveInbox', () => {
  it('includes a permission wait and a finish from two projects, and skips a running agent', () => {
    const items = groveInbox([
      thread({ id: 'wait', projectPath: '/one', attention: waiting }),
      thread({ id: 'done', projectPath: '/two', attention: finished }),
      thread({ id: 'run', projectPath: '/one', attention: NO_ATTENTION }),
    ]);
    expect(items.map((item) => item.threadId)).toEqual(['wait', 'done']);
    expect(items.map((item) => item.projectPath)).toEqual(['/one', '/two']);
    expect(items[0]?.reason).toBe('needsInput');
    expect(items[1]?.reason).toBe('finished');
  });

  it('selects that project and that agent', () => {
    const [item] = groveInbox([thread({ id: 'done', projectPath: '/two', attention: finished })]);
    if (!item) throw new Error('expected the finished agent');
    expect(inboxTarget(item, '/one')).toEqual({ focusPath: '/two', threadId: 'done' });
    expect(inboxTarget({ threadId: 'wait', projectPath: '/one' }, '/one')).toEqual({
      focusPath: null,
      threadId: 'wait',
    });
  });
});
