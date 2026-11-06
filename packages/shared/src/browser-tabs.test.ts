import { describe, expect, it } from 'vitest';
import {
  LIVE_TAB_CAP,
  activateBrowserTab,
  closeBrowserTab,
  closeOtherBrowserTabs,
  createBrowserTabSet,
  discardLeastRecent,
  moveBrowserTab,
  openReferenceTab,
  persistedBrowserTabs,
  reopenClosedTab,
  resolveBrowserTarget,
  restoreBrowserTabSet,
  setBrowserTabRole,
  windowOpenNeedsOpener,
} from './browser-tabs.js';

const ids = (): (() => string) => {
  let n = 0;
  return () => `id-${n++}`;
};

describe('browser tabs', () => {
  it('starts with one app tab that cannot be closed', () => {
    const set = createBrowserTabSet({ id: 'app', url: 'http://localhost:5173', now: 1 });
    expect(set.tabs).toHaveLength(1);
    expect(set.tabs[0]).toMatchObject({ role: 'app', pinned: true, useProjectSession: true });
    expect(closeBrowserTab(set, 'app', 2)).toEqual({ ok: false, error: 'The app tab stays open' });
  });

  it('opens, reorders and closes reference tabs, and reopens the last one', () => {
    let set = createBrowserTabSet({ id: 'app', now: 1 });
    set = openReferenceTab(set, { id: 'docs', url: 'https://docs.example', now: 2 });
    set = openReferenceTab(set, { id: 'figma', url: 'https://www.figma.com/file/abc', title: 'Design', now: 3 });
    expect(set.activeId).toBe('figma');
    expect(set.tabs.map((tab) => tab.id)).toEqual(['app', 'docs', 'figma']);
    set = moveBrowserTab(set, 'figma', 1);
    expect(set.tabs.map((tab) => tab.id)).toEqual(['app', 'figma', 'docs']);
    expect(moveBrowserTab(set, 'app', 2).tabs[0]?.id).toBe('app');
    const closed = closeBrowserTab(set, 'figma', 4);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.set.tabs.map((tab) => tab.id)).toEqual(['app', 'docs']);
    expect(closed.set.activeId).toBe('docs');
    const reopened = reopenClosedTab(closed.set, 'again', 5);
    expect(reopened?.tabs.map((tab) => tab.url)).toContain('https://www.figma.com/file/abc');
    expect(reopened?.activeId).toBe('again');
  });

  it('keeps exactly one app tab and pins it first', () => {
    let set = openReferenceTab(createBrowserTabSet({ id: 'app', now: 1 }), {
      id: 'ref',
      url: 'https://example.com',
      now: 2,
    });
    set = setBrowserTabRole(set, 'ref');
    expect(set.tabs.map((tab) => [tab.id, tab.role])).toEqual([
      ['ref', 'app'],
      ['app', 'reference'],
    ]);
    expect(set.tabs[0]).toMatchObject({ useProjectSession: true, pinned: true });
    const closed = closeBrowserTab(set, 'ref', 3);
    expect(closed.ok).toBe(false);
  });

  it('discards the least recently used reference tab past the cap, never the app tab or a grant', () => {
    let set = createBrowserTabSet({ id: 'app', now: 1 });
    for (let index = 0; index < LIVE_TAB_CAP; index += 1) {
      set = openReferenceTab(set, {
        id: `t${index}`,
        url: `https://example.com/${index}`,
        now: index + 2,
        activate: index === LIVE_TAB_CAP - 1,
        protectedIds: new Set(['t0']),
      });
    }
    const live = set.tabs.filter((tab) => !tab.discarded);
    expect(live).toHaveLength(LIVE_TAB_CAP);
    expect(set.tabs.find((tab) => tab.id === 'app')?.discarded).toBe(false);
    expect(set.tabs.find((tab) => tab.id === 't0')?.discarded).toBe(false);
    expect(set.tabs.find((tab) => tab.id === 't1')?.discarded).toBe(true);
    const forced = discardLeastRecent(
      {
        ...set,
        tabs: set.tabs.map((tab) => ({ ...tab, discarded: false })),
      },
      new Set(['t3']),
    );
    expect(forced.tabs.find((tab) => tab.id === 't3')?.discarded).toBe(false);
    expect(forced.tabs.find((tab) => tab.id === 'app')?.discarded).toBe(false);
    expect(forced.tabs.filter((tab) => !tab.discarded).length).toBeLessThanOrEqual(LIVE_TAB_CAP);
  });

  it('restores only the active tab as live and round-trips persistence', () => {
    const set = openReferenceTab(createBrowserTabSet({ id: 'app', url: 'http://localhost:5173', now: 1 }), {
      id: 'figma',
      url: 'https://www.figma.com/file/abc',
      now: 2,
    });
    const saved = persistedBrowserTabs(set);
    const restored = restoreBrowserTabSet({ ...saved, now: 9, id: ids() });
    expect(restored.activeId).toBe('figma');
    expect(restored.tabs.find((tab) => tab.id === 'figma')?.discarded).toBe(false);
    expect(restored.tabs.find((tab) => tab.id === 'app')?.discarded).toBe(true);
    expect(restoreBrowserTabSet({ lastUrl: 'http://localhost:1', now: 1, id: () => 'fresh' }).tabs[0]).toMatchObject({
      id: 'fresh',
      role: 'app',
      url: 'http://localhost:1',
      discarded: false,
    });
  });

  it('resolves app, active and ids, and refuses a missing tab', () => {
    const set = openReferenceTab(createBrowserTabSet({ id: 'app', now: 1 }), {
      id: 'figma',
      url: 'https://www.figma.com',
      now: 2,
    });
    expect(resolveBrowserTarget(set, undefined)).toEqual({ id: 'app', role: 'app' });
    expect(resolveBrowserTarget(set, 'active')).toEqual({ id: 'figma', role: 'reference' });
    expect(resolveBrowserTarget(set, 'figma')).toEqual({ id: 'figma', role: 'reference' });
    expect(resolveBrowserTarget(set, 'missing')).toEqual({ error: 'Unknown tab missing' });
  });

  it('close others keeps the app tab', () => {
    let set = createBrowserTabSet({ id: 'app', now: 1 });
    set = openReferenceTab(set, { id: 'a', url: 'https://a.example', now: 2, activate: false });
    set = openReferenceTab(set, { id: 'b', url: 'https://b.example', now: 3 });
    const closed = closeOtherBrowserTabs(set, 'a');
    expect(closed.tabs.map((tab) => tab.id).sort()).toEqual(['a', 'app']);
    expect(closed.closed.map((tab) => tab.id)).toContain('b');
  });

  it('activates a discarded tab and marks it used', () => {
    let set = createBrowserTabSet({ id: 'app', now: 1 });
    set = openReferenceTab(set, { id: 'a', url: 'https://a.example', now: 2, activate: false });
    set = { ...set, tabs: set.tabs.map((tab) => (tab.id === 'a' ? { ...tab, discarded: true } : tab)) };
    const next = activateBrowserTab(set, 'a', 10);
    expect(next.activeId).toBe('a');
    expect(next.tabs.find((tab) => tab.id === 'a')).toMatchObject({ discarded: false, usedAt: 10 });
  });

  it('treats sized popups as windows and plain links as tabs', () => {
    expect(windowOpenNeedsOpener({ disposition: 'new-window', features: '' })).toBe(true);
    expect(windowOpenNeedsOpener({ disposition: 'other', features: '' })).toBe(true);
    expect(windowOpenNeedsOpener({ disposition: 'foreground-tab', features: 'width=480,height=640' })).toBe(true);
    expect(windowOpenNeedsOpener({ disposition: 'foreground-tab', features: 'popup=yes' })).toBe(true);
    expect(windowOpenNeedsOpener({ disposition: 'foreground-tab', features: '' })).toBe(false);
    expect(windowOpenNeedsOpener({ disposition: 'background-tab', features: 'noopener' })).toBe(false);
  });
});
