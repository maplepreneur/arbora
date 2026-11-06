import { describe, expect, it } from 'vitest';
import { TabGrantStore } from './tab-grants.js';

describe('TabGrantStore', () => {
  it('allows the app tab, a granted reference tab, and nothing else', () => {
    const grants = new TabGrantStore();
    expect(grants.canRead('/app', 'thread', 'app', 'app')).toBe(true);
    expect(grants.canRead('/app', 'thread', 'figma', 'reference')).toBe(false);
    grants.grant('/app', 'thread', 'figma');
    expect(grants.canRead('/app', 'thread', 'figma', 'reference')).toBe(true);
    expect(grants.canRead('/other', 'thread', 'figma', 'reference')).toBe(false);
    expect(grants.list('/app', 'thread')).toEqual(['figma']);
    expect(grants.protectedIds('/app').has('figma')).toBe(true);
  });

  it('drops read and write access when the grant is revoked', () => {
    const grants = new TabGrantStore();
    const key = { projectPath: '/app', threadId: 'thread', tabId: 'figma' };
    grants.grant(key.projectPath, key.threadId, key.tabId);
    grants.allowWrite(key);
    expect(grants.canWrite(key)).toBe(true);
    grants.revoke(key.projectPath, key.threadId, key.tabId);
    expect(grants.canRead('/app', 'thread', 'figma', 'reference')).toBe(false);
    expect(grants.canWrite(key)).toBe(false);
    expect(grants.list('/app', 'thread')).toEqual([]);
  });

  it('tells every thread when its tab closes', () => {
    const grants = new TabGrantStore();
    grants.grant('/app', 'one', 'figma');
    grants.grant('/app', 'two', 'figma');
    grants.allowWrite({ projectPath: '/app', threadId: 'one', tabId: 'figma' });
    expect(grants.dropTab('/app', 'figma').sort()).toEqual(['one', 'two']);
    expect(grants.list('/app', 'one')).toEqual([]);
    expect(grants.list('/app', 'two')).toEqual([]);
    expect(grants.canWrite({ projectPath: '/app', threadId: 'one', tabId: 'figma' })).toBe(false);
  });
});
