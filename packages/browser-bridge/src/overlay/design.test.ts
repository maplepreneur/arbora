// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DesignState } from '@arbora/shared';
import { DesignOverlay, type DesignHost } from './design.js';
import type { PageWindow } from './inspector.js';

const win: PageWindow = window;

function setup() {
  const states: DesignState[] = [];
  const onExitRequest = vi.fn();
  const host: DesignHost = {
    chainFor: vi.fn(() => Promise.resolve({ names: ['Card', 'App'], file: '/p/src/Card.tsx', line: 4 })),
    onState: (state) => states.push(state),
    onExitRequest,
  };
  return { overlay: new DesignOverlay(win, host), onExitRequest, states };
}

describe('DesignOverlay', () => {
  it('selects on click, keeps the page from seeing it, and leaves on a second Escape', () => {
    document.body.innerHTML = '<section id="card">Counter</section>';
    const card = document.getElementById('card')!;
    let clicks = 0;
    card.addEventListener('click', () => clicks++);
    const { overlay, onExitRequest, states } = setup();
    overlay.start(null);
    expect(document.documentElement.querySelector('[data-arbora-design]')).not.toBeNull();
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(clicks).toBe(0);
    expect(states.at(-1)?.selectionCount).toBe(1);
    expect(states.at(-1)?.selection?.tag).toBe('section');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(states.at(-1)?.selectionCount).toBe(0);
    expect(onExitRequest).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitRequest).toHaveBeenCalledTimes(1);

    overlay.command({ type: 'style', property: 'padding-top', value: '32px' });
    expect(card.style.getPropertyValue('padding-top')).toBe('');
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 1, clientY: 1 }));
    overlay.command({ type: 'style', property: 'padding-top', value: '32px' });
    expect(card.style.getPropertyPriority('padding-top')).toBe('important');
    overlay.command({ type: 'text', value: 'Total' });
    expect(card.textContent).toBe('Total');
    expect(states.at(-1)?.cursor).toBe(2);
    overlay.command({ type: 'undo' });
    expect(card.textContent).toBe('Counter');
    overlay.command({ type: 'redo' });
    expect(card.textContent).toBe('Total');
    overlay.stop(true);
    expect(card.textContent).toBe('Counter');
    expect(card.style.getPropertyValue('padding-top')).toBe('');
    expect(document.documentElement.querySelector('[data-arbora-design]')).toBeNull();
    overlay.dispose();
  });
});
