// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, projectSettingsSchema, type ContextMenuItem } from '@arbora/shared';
import { registerBuiltinCommands } from '../commands';
import { useApp } from '../store';
import { TitleBar } from './TitleBar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() =>
  vi.fn<(channel: string, payload?: { items?: ContextMenuItem[] }) => Promise<{ id: string | null } | undefined>>(
    (channel) => Promise.resolve(channel === 'contextMenu.show' ? { id: null } : undefined),
  ),
);

vi.hoisted(() => {
  Object.assign(window, {
    arbora: {
      platform: 'linux',
      invoke,
    },
  });
});

const PROJECT_PATH = '/tmp/vite-react';

function mount(): Root {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(TitleBar));
  });
  return root;
}

function openProject(name = 'vite-react'): void {
  const settings = defaultSettings();
  useApp.setState({
    project: {
      path: PROJECT_PATH,
      name,
      settings: projectSettingsSchema.parse({}),
      settingsWarnings: [],
    },
    settings: {
      ...settings,
      grove: { ...settings.grove, projects: [{ path: PROJECT_PATH, collapsed: false }] },
    },
    layout: { ...useApp.getState().layout, workspace: 'browser' },
    mode: { kind: 'idle' },
  });
}

describe('TitleBar', () => {
  let root: Root | undefined;
  let menuChoice: string | null = null;
  let menus: ContextMenuItem[][] = [];
  let disposeCommands: (() => void) | undefined;

  beforeEach(() => {
    disposeCommands = registerBuiltinCommands();
    menuChoice = null;
    menus = [];
    invoke.mockImplementation((channel: string, payload?: { items?: ContextMenuItem[] }) => {
      if (channel === 'contextMenu.show') {
        menus.push(payload?.items ?? []);
        return Promise.resolve({ id: menuChoice });
      }
      return Promise.resolve(undefined);
    });
    useApp.setState({
      project: null,
      settings: defaultSettings(),
      layout: { ...useApp.getState().layout, workspace: 'browser' },
      mode: { kind: 'idle' },
      theme: { mode: 'system', resolved: 'light' },
    });
  });

  afterEach(() => {
    disposeCommands?.();
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    useApp.setState({
      project: null,
      settings: defaultSettings(),
      layout: { ...useApp.getState().layout, workspace: 'browser' },
      mode: { kind: 'idle' },
    });
  });

  it('does not render the Commands button or the theme monitor', () => {
    openProject();
    root = mount();
    const bar = document.querySelector('[data-testid="title-bar"]');
    expect(bar?.querySelector('[data-testid="open-palette"]')).toBeNull();
    expect(bar?.querySelector('[data-testid="toggle-theme"]')).toBeNull();
    expect(bar?.textContent).not.toContain('Commands');
    expect(document.querySelector('[aria-label="Toggle theme"]')).toBeNull();
  });

  it('names the project and leaves the mode switch and panels to the shell', () => {
    openProject();
    root = mount();
    const bar = document.querySelector('[data-testid="title-bar"]');
    expect(bar?.querySelector('[data-testid="title-project-name"]')?.textContent).toBe('vite-react');
    expect(bar?.querySelector('[data-testid="mode-pills"]')).toBeNull();
    expect(bar?.querySelector('[data-testid="workspace-switch"]')).toBeNull();
    expect(bar?.querySelector('[data-testid="attention-button"]')).not.toBeNull();
  });

  it('opens the project switcher from the project name', () => {
    openProject();
    root = mount();
    const name = document.querySelector('[data-testid="title-project-name"]')?.closest('button');
    if (!(name instanceof HTMLButtonElement)) throw new Error('project button missing');
    act(() => name.click());
    expect(useApp.getState().overlay).toBe('switcher');
  });
});
