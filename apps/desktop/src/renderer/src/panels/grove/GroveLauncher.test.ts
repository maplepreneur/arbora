// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type AgentDefinition } from '@arbora/shared';
import { resetAgents, useAgents } from '../../agent-store';
import { useApp } from '../../store';
import { GroveLauncher } from './GroveLauncher';

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

describe('GroveLauncher', () => {
  let root: Root | undefined;

  beforeEach(() => {
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
    const task = document.querySelector('[data-testid="launcher-task"]');
    const start = document.querySelector('[data-testid="launcher-start"]');
    expect(shell?.className).toContain('max-h-[calc(100dvh-3rem)]');
    expect(shell?.className).toContain('overflow-hidden');
    expect(models?.className).toContain('overflow-y-auto');
    expect(models?.contains(task)).toBe(false);
    expect(models?.contains(start)).toBe(false);
    expect((task?.compareDocumentPosition(models as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(0);
    expect(models?.querySelectorAll('[data-testid^="launcher-model-"]')).toHaveLength(MODEL_COUNT);
    expect(document.querySelector('[data-testid="launcher-agent-opencode"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="launcher-agent-kimi"]')).toBeNull();
    expect(document.querySelector('[data-testid="launcher-agent-claude-code"]')).toBeNull();
    expect(document.body.textContent).toContain('default');
  });
});
