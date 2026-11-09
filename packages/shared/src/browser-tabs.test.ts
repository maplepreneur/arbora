import { describe, expect, it } from 'vitest';
import {
  activateBrowserTab,
  browserTabPartition,
  closeBrowserTab,
  cookieBelongsOnReferencePartition,
  cookiesForReferencePartition,
  referenceCookieWrite,
  cycleBrowserTab,
  emptyBrowserTabs,
  resolveAgentTab,
  moveBrowserTab,
  openBrowserTab,
  reopenClosedBrowserTab,
  restoreBrowserTabs,
  setBrowserTabRole,
  tabToDiscard,
  type BrowserTabRecord,
} from './browser-tabs.js';

function tab(patch: Partial<BrowserTabRecord> & Pick<BrowserTabRecord, 'id'>): BrowserTabRecord {
  return {
    role: 'reference',
    url: 'about:blank',
    title: '',
    zoom: 1,
    preset: 'responsive',
    projectSession: false,
    ...patch,
  };
}

describe('browser tabs', () => {
  it('closes the last tab and leaves an empty browser', () => {
    const opened = openBrowserTab(emptyBrowserTabs(), tab({ id: 'app', role: 'app', url: 'http://localhost:5173/' }));
    const closed = closeBrowserTab(opened, 'app');
    expect(closed.tabs).toEqual([]);
    expect(closed.activeTabId).toBeNull();
    expect(closed.closed.map((entry) => entry.tab.id)).toEqual(['app']);
  });

  it('does not promote another tab when the app tab closes', () => {
    let state = openBrowserTab(emptyBrowserTabs(), tab({ id: 'app', role: 'app', url: 'http://localhost:5173/' }));
    state = openBrowserTab(state, tab({ id: 'figma', url: 'https://www.figma.com/design/food' }));
    state = closeBrowserTab(state, 'app');
    expect(state.tabs.map((item) => [item.id, item.role])).toEqual([['figma', 'reference']]);
    expect(state.activeTabId).toBe('figma');
  });

  it('keeps a single app tab and pins it first', () => {
    let state = openBrowserTab(emptyBrowserTabs(), tab({ id: 'docs', url: 'https://example.com/' }));
    state = openBrowserTab(state, tab({ id: 'app', role: 'app', url: 'http://localhost:5173/' }));
    expect(state.tabs.map((item) => [item.id, item.role])).toEqual([
      ['app', 'app'],
      ['docs', 'reference'],
    ]);
    state = setBrowserTabRole(state, 'docs', 'app');
    expect(state.tabs.map((item) => [item.id, item.role])).toEqual([
      ['docs', 'app'],
      ['app', 'reference'],
    ]);
  });

  it('reopens the last closed tab, including after the browser was empty', () => {
    const opened = openBrowserTab(
      emptyBrowserTabs(),
      tab({ id: 'figma', url: 'https://www.figma.com/design/membase' }),
    );
    const restored = reopenClosedBrowserTab(closeBrowserTab(opened, 'figma'));
    expect(restored.tabs.map((item) => item.id)).toEqual(['figma']);
    expect(restored.activeTabId).toBe('figma');
    expect(restored.closed).toEqual([]);
  });

  it('reorders reference tabs and refuses to place one ahead of the app tab', () => {
    let state = openBrowserTab(emptyBrowserTabs(), tab({ id: 'app', role: 'app' }));
    state = openBrowserTab(state, tab({ id: 'a' }));
    state = openBrowserTab(state, tab({ id: 'b' }));
    state = moveBrowserTab(state, 'b', 1);
    expect(state.tabs.map((item) => item.id)).toEqual(['app', 'b', 'a']);
    state = moveBrowserTab(state, 'b', 0);
    expect(state.tabs.map((item) => item.id)).toEqual(['app', 'b', 'a']);
  });

  it('steps to the next and previous tab and reports none when the list is empty', () => {
    let state = openBrowserTab(emptyBrowserTabs(), tab({ id: 'app', role: 'app' }));
    state = openBrowserTab(state, tab({ id: 'figma' }));
    expect(cycleBrowserTab(state, 1)).toBe('app');
    expect(cycleBrowserTab(state, -1)).toBe('app');
    expect(cycleBrowserTab(emptyBrowserTabs(), 1)).toBeNull();
  });

  it('keeps localhost on the project partition and Figma on the shared one', () => {
    expect(browserTabPartition({ role: 'app', projectSession: false }, 'project')).toBe('project');
    expect(browserTabPartition({ role: 'reference', projectSession: true }, 'project')).toBe('project');
    expect(browserTabPartition({ role: 'reference', projectSession: false }, 'project')).toBe('persist:arbora-web');
  });

  it('activates a known tab and ignores an unknown one', () => {
    let state = openBrowserTab(emptyBrowserTabs(), tab({ id: 'app', role: 'app' }));
    state = openBrowserTab(state, tab({ id: 'figma' }));
    expect(activateBrowserTab(state, 'app').activeTabId).toBe('app');
    expect(activateBrowserTab(state, 'missing')).toBe(state);
  });

  it('discards the least recently used reference tab, never the app tab, the active tab, or a granted tab', () => {
    const tabs = [tab({ id: 'app', role: 'app' }), tab({ id: 'old' }), tab({ id: 'granted' }), tab({ id: 'current' })];
    const recency = ['current', 'granted', 'old', 'app'];
    expect(tabToDiscard(tabs, recency, new Set(['granted']), 4, 3)).toBe('old');
    expect(tabToDiscard(tabs, recency, new Set(['granted', 'old']), 4, 3)).toBeNull();
    expect(tabToDiscard(tabs, recency, new Set(), 3, 3)).toBeNull();
  });
});

describe('reference partition cookies', () => {
  it('copies a Figma login and leaves localhost cookies on the project partition', () => {
    expect(cookieBelongsOnReferencePartition('figma.com')).toBe(true);
    expect(cookieBelongsOnReferencePartition('.figma.com')).toBe(true);
    expect(cookieBelongsOnReferencePartition('localhost')).toBe(false);
    expect(cookieBelongsOnReferencePartition('.localhost')).toBe(false);
    expect(cookieBelongsOnReferencePartition('127.0.0.1')).toBe(false);

    const copied = cookiesForReferencePartition([
      { name: 'figma', domain: '.figma.com' },
      { name: 'dev', domain: 'localhost' },
      { name: 'loopback', domain: '127.0.0.1' },
      { name: 'blank', domain: '' },
    ]);
    expect(copied.map((cookie) => cookie.name)).toEqual(['figma']);
  });

  it('keeps a __Host- login cookie host-only so the browser will store it', () => {
    expect(
      referenceCookieWrite({ name: '__Host-figma.authn', domain: 'www.figma.com', path: '/', secure: true }),
    ).toEqual({ url: 'https://www.figma.com/', path: '/' });
    expect(referenceCookieWrite({ name: 'session', domain: '.figma.com', path: '/', secure: true })).toEqual({
      url: 'https://figma.com/',
      path: '/',
      domain: '.figma.com',
    });
  });
});

describe('restoreBrowserTabs', () => {
  it('treats a missing record as a first open and a stored empty list as none', () => {
    const ids = { next: () => 'new' };
    expect(restoreBrowserTabs(undefined, ids).fresh).toBe(true);
    expect(restoreBrowserTabs(undefined, ids).state.tabs).toEqual([]);
    const empty = restoreBrowserTabs({ tabs: [], activeTabId: null }, ids);
    expect(empty.fresh).toBe(false);
    expect(empty.state.activeTabId).toBeNull();
  });

  it('turns a legacy lastUrl into one app tab', () => {
    const restored = restoreBrowserTabs(
      { lastUrl: 'http://localhost:5173/', preset: 'desktop', zoomFactor: 1.25 },
      { next: () => 'legacy' },
    );
    expect(restored.fresh).toBe(false);
    expect(restored.state.activeTabId).toBe('legacy');
    expect(restored.state.tabs).toEqual([
      tab({ id: 'legacy', role: 'app', url: 'http://localhost:5173/', preset: 'desktop', zoom: 1.25 }),
    ]);
  });

  it('drops a second app tab when restoring a saved list', () => {
    const restored = restoreBrowserTabs(
      {
        tabs: [
          tab({ id: 'a', role: 'app', url: 'http://localhost:5173/' }),
          tab({ id: 'b', role: 'app', url: 'http://localhost:3000/' }),
          tab({ id: 'figma', url: 'https://www.figma.com/design/membase' }),
        ],
        activeTabId: 'figma',
      },
      { next: () => 'unused' },
    );
    expect(restored.state.tabs.map((item) => [item.id, item.role])).toEqual([
      ['a', 'app'],
      ['b', 'reference'],
      ['figma', 'reference'],
    ]);
    expect(restored.state.activeTabId).toBe('figma');
  });
});

describe('resolveAgentTab', () => {
  const tabs = [
    { id: 'app', role: 'app' as const },
    { id: 'figma', role: 'reference' as const },
  ];

  it('defaults to the app tab and refuses an ungranted reference tab', () => {
    expect(resolveAgentTab(tabs, 'figma', new Set(), undefined)).toEqual({ ok: true, id: 'app' });
    expect(resolveAgentTab(tabs, 'figma', new Set(), 'app')).toEqual({ ok: true, id: 'app' });
    expect(resolveAgentTab(tabs, 'figma', new Set(), 'figma')).toEqual({ ok: false, error: 'tab not granted' });
    expect(resolveAgentTab(tabs, 'figma', new Set(['figma']), 'figma')).toEqual({ ok: true, id: 'figma' });
  });

  it('uses the visible tab for active, and reports a missing app tab', () => {
    expect(resolveAgentTab(tabs, 'figma', new Set(['figma']), 'active')).toEqual({ ok: true, id: 'figma' });
    expect(resolveAgentTab(tabs, null, new Set(), 'active')).toEqual({ ok: false, error: 'No browser tab is open.' });
    expect(resolveAgentTab([{ id: 'figma', role: 'reference' }], 'figma', new Set(), undefined)).toEqual({
      ok: false,
      error: 'This project has no app tab.',
    });
    expect(resolveAgentTab(tabs, 'app', new Set(), 'missing')).toEqual({ ok: false, error: 'Unknown tab missing.' });
  });
});
