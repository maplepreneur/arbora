import { describe, expect, it } from 'vitest';
import { rightTabAt, rightTabs } from './right-tabs';

const tabs = rightTabs({
  terminalTabs: [
    { id: 't1', panes: ['t1', 't3'] },
    { id: 'agent-commands', panes: ['a1'] },
  ],
  editorTabs: [{ id: 'file:src/App.tsx' }],
  panels: ['problems'],
});

describe('right column tabs', () => {
  it('lists the browser, terminal tabs, editors, then Changes and Problems, like the strip', () => {
    expect(tabs).toEqual([
      { kind: 'browser' },
      { kind: 'terminal', tabId: 't1', paneId: 't1' },
      { kind: 'terminal', tabId: 'agent-commands', paneId: 'a1' },
      { kind: 'editor', id: 'file:src/App.tsx' },
      { kind: 'problems' },
    ]);
  });

  it('picks by number, -1 for the last, and nothing past the end', () => {
    expect(rightTabAt(tabs, 0)).toEqual({ kind: 'browser' });
    expect(rightTabAt(tabs, 3)).toEqual({ kind: 'editor', id: 'file:src/App.tsx' });
    expect(rightTabAt(tabs, -1)).toEqual({ kind: 'problems' });
    expect(rightTabAt(tabs, 7)).toBeNull();
  });
});
