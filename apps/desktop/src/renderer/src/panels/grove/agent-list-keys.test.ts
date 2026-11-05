// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectSession } from '../../grove-store';
import { onAgentListKeyDown, type AgentListKeyOptions } from './agent-list-keys';

vi.mock('../../grove-store', () => ({
  selectSession: vi.fn(),
}));

const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function list(): HTMLElement {
  const root = document.getElementById('list');
  if (!root) throw new Error('missing list');
  return root;
}

function press(target: HTMLElement, key: string, selectedId: string | null, init?: KeyboardEventInit): void {
  const root = list();
  const options: AgentListKeyOptions = { order, selectedId, rowTestId: 'grove-row' };
  const listener = (event: Event): void => {
    onAgentListKeyDown(event as KeyboardEvent, options);
  };
  root.addEventListener('keydown', listener);
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  root.removeEventListener('keydown', listener);
}

describe('onAgentListKeyDown', () => {
  beforeEach(() => {
    vi.mocked(selectSession).mockClear();
    document.body.innerHTML = `
      <div id="list" tabindex="-1">
        <button type="button" data-testid="grove-row" data-thread-id="a">A</button>
        <button type="button" data-testid="grove-row" data-thread-id="b">B</button>
        <button type="button" data-testid="grove-row" data-thread-id="c">C</button>
        <button type="button" data-testid="grove-row-menu" data-thread-id="b">menu</button>
        <button type="button" data-testid="grove-recent-row" data-thread-id="old">Old</button>
        <input id="field" />
      </div>
      <textarea id="composer"></textarea>
    `;
  });

  it('ArrowDown selects the next agent and focuses that row', () => {
    const first = list().querySelector<HTMLElement>('[data-thread-id="a"]');
    if (!first) throw new Error('missing row');
    first.focus();
    press(first, 'ArrowDown', 'a');
    expect(selectSession).toHaveBeenCalledTimes(1);
    expect(selectSession).toHaveBeenCalledWith('b', { focus: false });
    expect(document.activeElement).toBe(list().querySelector('[data-testid="grove-row"][data-thread-id="b"]'));
  });

  it('ArrowUp wraps from the first agent to the last', () => {
    const first = list().querySelector<HTMLElement>('[data-thread-id="a"]');
    if (!first) throw new Error('missing row');
    press(first, 'ArrowUp', 'a');
    expect(selectSession).toHaveBeenCalledWith('c', { focus: false });
  });

  it('leaves arrows alone in a text field, a recent row, and outside the list', () => {
    const field = document.getElementById('field');
    const recent = list().querySelector<HTMLElement>('[data-testid="grove-recent-row"]');
    const composer = document.getElementById('composer');
    if (!field || !recent || !composer) throw new Error('missing controls');
    press(field, 'ArrowDown', 'a');
    press(recent, 'ArrowDown', 'a');
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('ignores ArrowDown when a modifier is held', () => {
    const first = list().querySelector<HTMLElement>('[data-thread-id="a"]');
    if (!first) throw new Error('missing row');
    press(first, 'ArrowDown', 'a', { altKey: true });
    expect(selectSession).not.toHaveBeenCalled();
  });
});
