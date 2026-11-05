// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalInfo } from '@arbora/shared';
import { AGENT_TAB_ID, useTerminals } from '../../terminal-store';
import { TerminalTabButtons } from './TerminalTabs';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn((_channel: string, _payload?: { id: string }) => Promise.resolve(undefined)));

vi.hoisted(() => {
  Object.assign(window, { arbora: { platform: 'linux', invoke } });
});

function terminal(id: string, readOnly: boolean): TerminalInfo {
  return {
    id,
    title: id,
    kind: readOnly ? 'agent' : 'shell',
    cwd: '/tmp',
    command: id,
    pid: 1,
    exitCode: null,
    readOnly,
  };
}

function mount(): Root {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(TerminalTabButtons, { showing: true }));
  });
  return root;
}

describe('TerminalTabButtons close', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    invoke.mockClear();
    useTerminals.setState({ terminals: [], tabs: [], activeTabId: null, activePaneId: null });
  });

  it('closes only the terminals in the clicked tab', () => {
    useTerminals.setState({
      terminals: [terminal('bash', false), terminal('agent-a', true), terminal('agent-b', true)],
      tabs: [
        { id: 'bash', panes: ['bash'], direction: 'horizontal' },
        { id: AGENT_TAB_ID, panes: ['agent-a', 'agent-b'], direction: 'horizontal' },
      ],
      activeTabId: AGENT_TAB_ID,
      activePaneId: 'agent-b',
    });
    root = mount();
    const agent = document.querySelector('[data-kind="agent"]');
    const close = agent?.querySelector('[data-testid="terminal-tab-close"]');
    if (!(close instanceof HTMLButtonElement)) throw new Error('agent close missing');
    act(() => close.click());
    const closed = invoke.mock.calls
      .filter((call) => call[0] === 'terminal.close')
      .map((call) => call[1]?.id)
      .filter((id) => id !== undefined);
    expect(closed.sort()).toEqual(['agent-a', 'agent-b']);
  });
});
