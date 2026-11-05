// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddTabButton } from './AddTabButton';
import type { AddTabId } from './add-tab-menu';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(onChoose: (id: AddTabId) => void): Root {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(AddTabButton, { onChoose }));
  });
  return root;
}

function clickAdd(): HTMLButtonElement {
  const button = document.querySelector('[data-testid="content-add"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('add button missing');
  act(() => button.click());
  return button;
}

describe('AddTabButton', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it('opens an app menu with an icon for each tab', () => {
    root = mount(() => undefined);
    clickAdd();
    const menu = document.querySelector('[data-testid="content-add-menu"]');
    expect(menu?.getAttribute('role')).toBe('menu');
    for (const id of ['file', 'terminal', 'browser', 'changes', 'problems']) {
      const row = menu?.querySelector(`[data-testid="content-add-${id}"]`);
      expect(row?.querySelector('svg')).not.toBeNull();
    }
    expect(menu?.textContent).toContain('File…');
    expect(menu?.textContent).toContain('Terminal');
    expect(menu?.textContent).toContain('Browser');
    expect(menu?.textContent).toContain('Changes');
    expect(menu?.textContent).toContain('Problems');
    expect(menu?.querySelector('[role="separator"]')).not.toBeNull();
    expect(menu?.querySelector('[data-testid="content-add-chord-file"]')?.textContent).toBe('Ctrl+P');
    expect(menu?.querySelector('[data-testid="content-add-chord-terminal"]')?.textContent).toBe('Ctrl+`');
    expect(menu?.querySelector('[data-testid="content-add-chord-browser"]')?.textContent).toBe('Ctrl+Shift+L');
    expect(menu?.querySelector('[data-testid="content-add-chord-changes"]')?.textContent).toBe('Ctrl+Alt+G');
    expect(menu?.querySelector('[data-testid="content-add-chord-problems"]')?.textContent).toBe('Ctrl+Shift+M');
  });

  it('chooses the highlighted row from the keyboard', () => {
    const onChoose = vi.fn();
    root = mount(onChoose);
    clickAdd();
    const menu = document.querySelector('[data-testid="content-add-menu"]');
    if (!(menu instanceof HTMLElement)) throw new Error('menu missing');
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChoose).toHaveBeenCalledWith('terminal');
    expect(document.querySelector('[data-testid="content-add-menu"]')).toBeNull();
  });
});
