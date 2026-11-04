import { describe, expect, it } from 'vitest';
import type { TerminalInfo } from '@arbora/shared';
import { AGENT_TAB_ID, placeTerminal, reconcileTabs, type TerminalTab } from './terminal-store';

function terminal(id: string, kind: TerminalInfo['kind'] = 'shell'): TerminalInfo {
  return { id, title: id, kind, cwd: '/p', command: 'bash', pid: 1, exitCode: null, readOnly: kind === 'agent' };
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

  it('collects agent terminals in one agent tab, kept last, without stealing the active tab', () => {
    const state = { tabs: [tab('a', ['a'])], activeTabId: 'a', activePaneId: 'a' };
    const next = reconcileTabs(state, [terminal('a'), terminal('x', 'agent'), terminal('y', 'agent')]);
    expect(next.tabs).toEqual([tab('a', ['a']), tab(AGENT_TAB_ID, ['x', 'y'])]);
    expect(next.activeTabId).toBe('a');
    const withDev = reconcileTabs(next, [terminal('a'), terminal('x', 'agent'), terminal('dev', 'dev')]);
    expect(withDev.tabs).toEqual([tab('a', ['a']), tab('dev', ['dev']), tab(AGENT_TAB_ID, ['x'])]);
  });

  it('selects the newest agent command when the agent tab has no valid selection', () => {
    const state = { tabs: [], activeTabId: AGENT_TAB_ID, activePaneId: 'gone' };
    const next = reconcileTabs(state, [terminal('x', 'agent'), terminal('y', 'agent')]);
    expect(next).toMatchObject({ activeTabId: AGENT_TAB_ID, activePaneId: 'y' });
    expect(reconcileTabs({ ...next, activePaneId: 'x' }, [terminal('x', 'agent')]).activePaneId).toBe('x');
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

  it('never splits the agent tab, and keeps new tabs before it', () => {
    const tabs = [tab('a', ['a']), tab(AGENT_TAB_ID, ['x'])];
    expect(placeTerminal({ tabs }, 'b', { split: 'horizontal', tabId: AGENT_TAB_ID })).toEqual({
      tabs: [tab('a', ['a']), tab('b', ['b']), tab(AGENT_TAB_ID, ['x'])],
      activeTabId: 'b',
      activePaneId: 'b',
    });
  });

  it('moves a terminal that reconcile already gave its own tab into the split', () => {
    const tabs = [tab('a', ['a']), tab('b', ['b'])];
    expect(placeTerminal({ tabs }, 'b', { split: 'horizontal', tabId: 'a' }).tabs).toEqual([tab('a', ['a', 'b'])]);
  });
});
