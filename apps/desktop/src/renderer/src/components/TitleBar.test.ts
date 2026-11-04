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

function setWidth(name: string, width: number): void {
  const element = document.querySelector(`[data-measure="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing measure ${name}`);
  Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => width });
}

async function applyWidths(widths: Record<string, number>): Promise<void> {
  for (const [name, width] of Object.entries(widths)) setWidth(name, width);
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    await Promise.resolve();
  });
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

  it('keeps the mode pills and workspace switch expanded when they fit', async () => {
    openProject();
    root = mount();
    await applyWidths({
      bar: 1200,
      spacer: 12,
      trailing: 140,
      'left-expanded': 360,
      'left-collapsed': 240,
      'workspace-expanded': 150,
      'workspace-collapsed': 90,
    });
    expect(document.querySelector('[data-testid="mode-pills"]')?.getAttribute('data-collapsed')).toBe('false');
    expect(document.querySelector('[data-testid="mode-pill-agent"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-pill-design"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-pill-idle"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-browser"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-grove"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-menu"]')).toBeNull();
    expect(document.querySelector('[data-testid="workspace-menu"]')).toBeNull();
  });

  it('collapses only the mode pills when that group is the one that does not fit', async () => {
    openProject();
    root = mount();
    await applyWidths({
      bar: 597,
      spacer: 40,
      trailing: 40,
      'left-expanded': 360,
      'left-collapsed': 240,
      'workspace-expanded': 150,
      'workspace-collapsed': 90,
    });
    expect(document.querySelector('[data-testid="mode-menu"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-pill-agent"]')).toBeNull();
    expect(document.querySelector('[data-testid="workspace-browser"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-grove"]')).not.toBeNull();
  });

  it('collapses only the workspace switch when that group is the one that does not fit', async () => {
    openProject();
    root = mount();
    await applyWidths({
      bar: 500,
      spacer: 40,
      trailing: 40,
      'left-expanded': 300,
      'left-collapsed': 250,
      'workspace-expanded': 220,
      'workspace-collapsed': 80,
    });
    expect(document.querySelector('[data-testid="mode-pill-agent"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-menu"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-browser"]')).toBeNull();
    expect(document.querySelector('[data-testid="mode-menu"]')).toBeNull();
  });

  it('collapses a long project name in a window where a short name still fits', async () => {
    openProject('vite-react');
    root = mount();
    const fitted = {
      bar: 698,
      spacer: 40,
      trailing: 40,
      'left-expanded': 360,
      'left-collapsed': 240,
      'workspace-expanded': 150,
      'workspace-collapsed': 90,
    };
    await applyWidths(fitted);
    expect(document.querySelector('[data-testid="mode-menu"]')).toBeNull();
    expect(document.querySelector('[data-testid="workspace-menu"]')).toBeNull();
    // The bar width is unchanged. The wider project name is what no longer fits, so only the
    // mode group collapses; the workspace switch still has room.
    await applyWidths({ ...fitted, 'left-expanded': 560, 'left-collapsed': 440 });
    expect(document.querySelector('[data-testid="mode-menu"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-browser"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-menu"]')).toBeNull();
  });

  it('runs the same mode command from the menu, including Arrow Down and a dismissed menu', async () => {
    openProject();
    root = mount();
    await applyWidths({
      bar: 400,
      spacer: 40,
      trailing: 40,
      'left-expanded': 360,
      'left-collapsed': 240,
      'workspace-expanded': 150,
      'workspace-collapsed': 90,
    });
    const trigger = document.querySelector('[data-testid="mode-menu"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('mode menu missing');
    menuChoice = null;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(menus.at(-1)?.map((item) => ('label' in item ? item.label : ''))).toEqual(['Agent', 'Design']);
    expect(useApp.getState().mode.kind).toBe('idle');

    menuChoice = 'agent';
    trigger.click();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useApp.getState().mode.kind).toBe('agent');
  });

  it('switches workspace from the collapsed menu the same way as the segments', async () => {
    openProject();
    root = mount();
    await applyWidths({
      bar: 500,
      spacer: 40,
      trailing: 40,
      'left-expanded': 300,
      'left-collapsed': 250,
      'workspace-expanded': 220,
      'workspace-collapsed': 80,
    });
    const trigger = document.querySelector('[data-testid="workspace-menu"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('workspace menu missing');
    menuChoice = 'grove';
    trigger.click();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(menus.at(-1)?.map((item) => ('label' in item ? item.label : ''))).toEqual(['Grove']);
    expect(useApp.getState().layout.workspace).toBe('grove');
  });
});
