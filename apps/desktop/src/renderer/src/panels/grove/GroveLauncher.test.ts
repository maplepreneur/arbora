// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type AgentDefinition } from '@arbora/shared';
import { resetAgents, useAgents } from '../../agent-store';
import { closeLauncher, setProjectDefaultAgent, startSession } from '../../grove-store';
import { useApp } from '../../store';
import { GroveLauncher, launcherHint } from './GroveLauncher';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../grove-store', () => ({
  closeLauncher: vi.fn(),
  setProjectDefaultAgent: vi.fn(),
  startSession: vi.fn(() => Promise.resolve(null)),
}));

vi.hoisted(() => {
  Object.assign(window, {
    arbora: {
      platform: 'linux',
      invoke: () => Promise.resolve(undefined),
    },
  });
});

const MODEL_COUNT = 115;

function agent(id: string, name: string): AgentDefinition {
  return { id, name, command: id, args: [], env: {}, builtIn: true };
}

function mount(): Root {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(GroveLauncher));
  });
  return root;
}

function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function agentList(): HTMLElement {
  const list = document.querySelector('[aria-label="Agent"]');
  if (!(list instanceof HTMLElement)) throw new Error('agent list missing');
  return list;
}

describe('GroveLauncher', () => {
  let root: Root | undefined;

  beforeEach(() => {
    vi.mocked(closeLauncher).mockClear();
    vi.mocked(setProjectDefaultAgent).mockClear();
    vi.mocked(startSession).mockClear();
    const models = Array.from({ length: MODEL_COUNT }, (_, i) => ({ value: `model-${i}`, name: `Model ${i}` }));
    const settings = defaultSettings();
    useApp.setState({
      checkingAgents: [],
      project: null,
      settings: {
        ...settings,
        agents: {
          ...settings.agents,
          autoVerify: false,
          hidden: ['kimi'],
          defaultAgent: 'opencode',
          verified: {
            opencode: { status: 'ready', checkedAt: 1, models },
            kimi: { status: 'ready', checkedAt: 1, models: [{ value: 'kimi-model', name: 'Kimi' }] },
            'claude-code': { status: 'auth_required', checkedAt: 1, models: [] },
          },
        },
      },
    });
    useAgents.setState({
      agents: [agent('opencode', 'OpenCode'), agent('kimi', 'Kimi Code'), agent('claude-code', 'Claude Code')],
      loaded: true,
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    resetAgents();
    useApp.setState({ settings: defaultSettings(), project: null, checkingAgents: [] });
  });

  it('scrolls a long model list inside a viewport-capped dialog and omits hidden agents', () => {
    root = mount();
    const dialog = document.querySelector('[data-testid="grove-launcher"]');
    const shell = dialog?.firstElementChild;
    const models = document.querySelector('[data-testid="launcher-models"]');
    expect(shell?.className).toContain('max-h-[calc(100dvh-3rem)]');
    expect(shell?.className).toContain('overflow-hidden');
    expect(models?.className).toContain('overflow-y-auto');
    expect(models?.querySelector('textarea')).toBeNull();
    expect(models?.querySelectorAll('[data-testid^="launcher-model-"]')).toHaveLength(MODEL_COUNT);
    expect(document.querySelector('[data-testid="launcher-agent-opencode"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="launcher-agent-kimi"]')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-agent-claude-code"]')).toBeNull();
    expect(document.body.textContent).toContain('default');
  });

  it('moves between the lists on stage 1, and Ctrl+Enter starts with an empty task', () => {
    const settings = useApp.getState().settings;
    useApp.setState({
      settings: { ...settings, agents: { ...settings.agents, hidden: [] } },
    });
    root = mount();

    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-task"]')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-start"]')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-hint"]')?.textContent).toBe(launcherHint('agents', 'linux'));

    const agents = agentList();
    const models = document.querySelector('[data-testid="launcher-models"]');
    expect(document.activeElement).toBe(agents);
    expect(models).not.toBeNull();

    press(agents, 'ArrowDown');
    expect(document.querySelector('[data-testid="launcher-agent-kimi"]')?.getAttribute('data-active')).toBe('true');

    const right = press(agents, 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(models);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
    expect(document.querySelector('[data-testid="launcher-model-kimi-model"]')?.getAttribute('data-active')).toBe(
      'true',
    );

    const left = press(models as Element, 'ArrowLeft');
    expect(left.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(agents);
    expect(document.querySelector('textarea')).toBeNull();

    press(agents, 'Enter', { ctrlKey: true });
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledWith({
      agentId: 'kimi',
      model: 'kimi-model',
      task: '',
      worktree: false,
    });
    expect(setProjectDefaultAgent).not.toHaveBeenCalled();
    expect(closeLauncher).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="launcher-task"]')).toBeNull();
  });

  it('Enter opens the task, and Escape returns to the lists before it closes', () => {
    root = mount();
    press(agentList(), 'Enter');

    const task = document.querySelector('[data-testid="launcher-task"]');
    expect(task).toBeInstanceOf(HTMLTextAreaElement);
    expect(document.activeElement).toBe(task);
    expect(document.querySelector('[aria-label="Agent"]')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-default"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="launcher-worktree"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="launcher-start"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="launcher-hint"]')?.textContent).toBe(launcherHint('task', 'linux'));
    expect(launcherHint('agents', 'darwin')).toContain('⌘↩ start empty');

    const newline = press(task as Element, 'Enter', { shiftKey: true });
    expect(newline.defaultPrevented).toBe(false);
    expect(startSession).not.toHaveBeenCalled();

    press(task as Element, 'Escape');
    expect(closeLauncher).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="launcher-task"]')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(agentList());

    press(agentList(), 'Escape');
    expect(closeLauncher).toHaveBeenCalledTimes(1);
    expect(startSession).not.toHaveBeenCalled();
  });
});
