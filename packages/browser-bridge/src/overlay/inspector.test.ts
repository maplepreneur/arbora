// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentEntry } from '@arbora/shared';
import { Inspector, type InspectorHost, type PageWindow } from './inspector.js';

const win: PageWindow = window;

function setup(chain: ComponentEntry[] = []) {
  const host = {
    chainAt: vi.fn<InspectorHost['chainAt']>(() => Promise.resolve(chain)),
    select: vi.fn<InspectorHost['select']>(),
    cancel: vi.fn<InspectorHost['cancel']>(),
  };
  const inspector = new Inspector(win, host);
  return { inspector, host };
}

function overlayHost(): Element | null {
  return document.documentElement.querySelector('[data-arbora-overlay]');
}

let pageClicks: number;
const pageListener = (): void => {
  pageClicks++;
};

beforeEach(() => {
  pageClicks = 0;
  document.body.innerHTML = '<input id="field"><button id="target">Go</button>';
  document.getElementById('target')?.addEventListener('click', pageListener);
});

afterEach(() => {
  document.body.replaceChildren();
  overlayHost()?.remove();
});

describe('Inspector', () => {
  it('is inert until started and puts its host on <html>, not <body>', () => {
    const { inspector } = setup();
    document.getElementById('target')?.click();
    expect(pageClicks).toBe(1);
    expect(overlayHost()).toBeNull();
    inspector.start();
    expect(inspector.active).toBe(true);
    expect(overlayHost()?.parentElement).toBe(document.documentElement);
    // Closed shadow root: the page cannot reach into the overlay.
    expect((overlayHost() as HTMLElement).shadowRoot).toBeNull();
    inspector.dispose();
  });

  it('selects the clicked element without the page seeing the click', () => {
    const { inspector, host } = setup();
    inspector.start();
    const target = document.getElementById('target')!;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(pageClicks).toBe(0);
    expect(host.select).toHaveBeenCalledWith(target, 0);
    // After a selection further clicks are swallowed but do not select again.
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(host.select).toHaveBeenCalledTimes(1);
    // A restart goes back to hovering.
    inspector.start();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(host.select).toHaveBeenCalledTimes(2);
    inspector.dispose();
  });

  it('cancels on Escape and blocks other keys', () => {
    const { inspector, host } = setup();
    const keys: string[] = [];
    const onKey = (event: KeyboardEvent): void => {
      keys.push(event.key);
    };
    document.addEventListener('keydown', onKey);
    inspector.start();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(keys).toEqual([]);
    expect(host.cancel).toHaveBeenCalledTimes(1);
    inspector.stop();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(keys).toEqual(['b']);
    document.removeEventListener('keydown', onKey);
    inspector.dispose();
  });

  it('releases everything on stop and restores focus', () => {
    const { inspector } = setup();
    const field = document.getElementById('field') as HTMLInputElement;
    field.focus();
    inspector.start();
    (document.getElementById('target') as HTMLButtonElement).focus();
    inspector.stop();
    expect(overlayHost()).toBeNull();
    expect(document.activeElement).toBe(field);
    document.getElementById('target')?.click();
    expect(pageClicks).toBe(1);
    inspector.dispose();
  });

  it('re-attaches its host when the page removes it (HMR replacing nodes)', async () => {
    const { inspector } = setup();
    inspector.start();
    overlayHost()?.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlayHost()).not.toBeNull();
    inspector.dispose();
  });

  it('hides without leaving the mode', () => {
    const { inspector } = setup();
    inspector.start();
    inspector.setVisible(false);
    expect((overlayHost() as HTMLElement).style.display).toBe('none');
    expect(inspector.active).toBe(true);
    inspector.setVisible(true);
    expect((overlayHost() as HTMLElement).style.display).toBe('');
    inspector.dispose();
  });
});
