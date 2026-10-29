import { describe, expect, it } from 'vitest';
import type { TerminalInfo } from '@arbora/shared';
import { placeTerminal, reconcileTabs, type TerminalTab } from './terminal-store';

function terminal(id: string, kind: TerminalInfo['kind'] = 'shell'): TerminalInfo {
  return { id, title: id, kind, cwd: '/p', command: 'bash', pid: 1, exitCode: null, readOnly: false };
}

const tab = (id: string, panes: string[], direction: TerminalTab['direction'] = 'horizontal'): TerminalTab => ({
  id,
  panes,
  direction,
});

describe('reconcileTabs', () => {
  it('adds a tab for terminals created elsewhere (dev server, agents) and keeps the active one', () => {
    const state = { tabs: [tab('a', ['a'])], activeTabId: 'a', activePaneId: 'a' };
    const next = reconcileTabs(state, [terminal('a'), terminal('dev', 'dev')]);
    expect(next.tabs.map((t) => t.panes)).toEqual([['a'], ['dev']]);
    expect(next.activeTabId).toBe('a');
  });

  it('drops closed panes and empty tabs, and moves focus to a surviving pane', () => {
    const state = { tabs: [tab('a', ['a', 'b']), tab('c', ['c'])], activeTabId: 'c', activePaneId: 'c' };
    const next = reconcileTabs(state, [terminal('b')]);
    expect(next.tabs).toEqual([tab('a', ['b'])]);
    expect(next).toMatchObject({ activeTabId: 'a', activePaneId: 'b' });
    expect(reconcileTabs(next, [])).toEqual({ tabs: [], activeTabId: null, activePaneId: null });
  });
});

describe('placeTerminal', () => {
  it('splits the target tab or opens a new tab, and activates the terminal', () => {
    const tabs = [tab('a', ['a'])];
    expect(placeTerminal({ tabs }, 'b', { split: 'vertical', tabId: 'a' })).toEqual({
      tabs: [tab('a', ['a', 'b'], 'vertical')],
      activeTabId: 'a',
      activePaneId: 'b',
    });
    expect(placeTerminal({ tabs }, 'b', null)).toEqual({
      tabs: [tab('a', ['a']), tab('b', ['b'])],
      activeTabId: 'b',
      activePaneId: 'b',
    });
  });

  it('moves a terminal that reconcile already gave its own tab into the split', () => {
    const tabs = [tab('a', ['a']), tab('b', ['b'])];
    expect(placeTerminal({ tabs }, 'b', { split: 'horizontal', tabId: 'a' }).tabs).toEqual([tab('a', ['a', 'b'])]);
  });
});
