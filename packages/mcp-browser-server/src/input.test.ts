import { describe, expect, it } from 'vitest';
import { click, elementBox, parseKeyChord, pressKey } from './input.js';
import { InflightRequests } from './page.js';
import { FakeCdp } from './testing.js';

describe('parseKeyChord', () => {
  it('parses named keys, characters and modifiers', () => {
    expect(parseKeyChord('Enter')).toEqual({
      modifiers: 0,
      key: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    });
    expect(parseKeyChord('Control+a')).toEqual({
      modifiers: 2,
      key: { key: 'a', code: 'KeyA', keyCode: 65, text: 'a' },
    });
    expect(parseKeyChord('Shift+a').key.key).toBe('A');
    expect(parseKeyChord('Meta+Shift+ArrowLeft')).toMatchObject({ modifiers: 12, key: { code: 'ArrowLeft' } });
    expect(parseKeyChord('F5').key).toEqual({ key: 'F5', code: 'F5', keyCode: 116 });
    expect(parseKeyChord('Control++').key.key).toBe('+');
  });

  it('rejects unknown names', () => {
    expect(() => parseKeyChord('Hyper+a')).toThrow(/Unknown modifier/);
    expect(() => parseKeyChord('NotAKey')).toThrow(/Unknown key/);
  });
});

describe('pressKey', () => {
  it('types text only without command modifiers', async () => {
    const cdp = new FakeCdp();
    await pressKey(cdp, 'a');
    await pressKey(cdp, 'Control+a');
    const [down, up, ctrlDown] = cdp.calls.map((c) => c.params);
    expect(down).toMatchObject({ type: 'keyDown', text: 'a', code: 'KeyA' });
    expect(up).toMatchObject({ type: 'keyUp' });
    expect(ctrlDown).toMatchObject({ type: 'rawKeyDown', modifiers: 2 });
    expect(ctrlDown).not.toHaveProperty('text');
  });
});

describe('click', () => {
  it('scrolls into view and presses at the centre of the first content quad', async () => {
    const cdp = new FakeCdp({ 'DOM.getContentQuads': () => ({ quads: [[10, 20, 110, 20, 110, 60, 10, 60]] }) });
    const point = await click(cdp, 7, { double: true });
    expect(point).toEqual({ x: 60, y: 40 });
    expect(cdp.methods()).toEqual([
      'DOM.scrollIntoViewIfNeeded',
      'DOM.getContentQuads',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    const presses = cdp.calls.filter((c) => c.params['type'] === 'mousePressed').map((c) => c.params['clickCount']);
    expect(presses).toEqual([1, 2]);
    expect(cdp.calls[3]?.params).toMatchObject({ type: 'mousePressed', button: 'left', buttons: 1, x: 60, y: 40 });
  });

  it('falls back to the box model and fails clearly for hidden elements', async () => {
    const boxed = new FakeCdp({
      'DOM.getContentQuads': () => ({ quads: [] }),
      'DOM.getBoxModel': () => ({ model: { border: [0, 0, 20, 0, 20, 10, 0, 10] } }),
    });
    await expect(elementBox(boxed, 1)).resolves.toEqual({ x: 0, y: 0, width: 20, height: 10 });
    const hidden = new FakeCdp({
      'DOM.getContentQuads': () => ({ quads: [] }),
      'DOM.getBoxModel': () => {
        throw new Error('Could not compute box model');
      },
    });
    await expect(elementBox(hidden, 1)).rejects.toThrow(/not visible/);
  });
});

describe('InflightRequests', () => {
  it('counts requests and ignores websockets', () => {
    let now = 1000;
    const tracker = new InflightRequests(() => now);
    tracker.handle('Network.requestWillBeSent', { requestId: 'a', type: 'Fetch' });
    tracker.handle('Network.requestWillBeSent', { requestId: 'ws', type: 'WebSocket' });
    expect(tracker.count).toBe(1);
    now = 1400;
    expect(tracker.idleFor()).toBe(0);
    tracker.handle('Network.loadingFinished', { requestId: 'a' });
    now = 2000;
    expect(tracker.idleFor()).toBe(600);
  });
});
