import { sleep, ToolError, type Cdp } from './cdp.js';
import { callOnElement } from './refs.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type MouseButton = 'left' | 'right' | 'middle';

/** CDP `Input.dispatchKeyEvent` modifier bits. */
const SHIFT = 8;
const MODIFIER_BITS: Readonly<Record<string, number>> = { Alt: 1, Control: 2, Meta: 4, Shift: SHIFT };
const MODIFIER_KEY_CODES: Readonly<Record<string, number>> = { Alt: 18, Control: 17, Meta: 91, Shift: 16 };
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Control',
  control: 'Control',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  super: 'Meta',
  shift: 'Shift',
};
const BUTTON_BITS: Readonly<Record<MouseButton, number>> = { left: 1, right: 2, middle: 4 };

interface KeyDefinition {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

const NAMED_KEYS: Readonly<Record<string, KeyDefinition>> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

export interface KeyChord {
  readonly modifiers: number;
  readonly key: KeyDefinition;
}

function characterKey(char: string): KeyDefinition {
  if (/^[a-z]$/i.test(char)) {
    return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: char };
  }
  if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  return { key: char, code: '', keyCode: 0, text: char };
}

/** Parses Playwright-style key names: `Enter`, `a`, `Control+a`, `Shift+Tab`, `F5`. */
export function parseKeyChord(input: string): KeyChord {
  const parts = input.split('+');
  // `Control++` means Control and the plus key.
  if (input.endsWith('++')) parts.splice(parts.length - 2, 2, '+');
  const last = parts.pop();
  if (last === undefined || last === '') throw new ToolError(`Not a key: ${input}`);
  let modifiers = 0;
  for (const part of parts) {
    const name = MODIFIER_ALIASES[part.toLowerCase()];
    if (!name) throw new ToolError(`Unknown modifier ${part} in ${input} (use Control, Shift, Alt or Meta)`);
    modifiers |= MODIFIER_BITS[name] ?? 0;
  }
  const lower = last.toLowerCase();
  let key = NAMED_KEYS[lower];
  if (!key && /^f([1-9]|1[0-2])$/.test(lower)) {
    const n = Number(lower.slice(1));
    key = { key: `F${n}`, code: `F${n}`, keyCode: 111 + n };
  }
  const modifierName = MODIFIER_ALIASES[lower];
  if (!key && modifierName) {
    key = { key: modifierName, code: `${modifierName}Left`, keyCode: MODIFIER_KEY_CODES[modifierName] ?? 0 };
  }
  if (!key && Array.from(last).length === 1) {
    const char = (modifiers & SHIFT) !== 0 ? last.toUpperCase() : last;
    key = characterKey(char);
  }
  if (!key) throw new ToolError(`Unknown key ${last}`);
  return { modifiers, key };
}

export async function pressKey(cdp: Cdp, input: string): Promise<void> {
  const { modifiers, key } = parseKeyChord(input);
  // Text is only typed without Control/Alt/Meta, as on a real keyboard (Ctrl+A selects, it does not type "a").
  const types = key.text !== undefined && (modifiers & ~SHIFT) === 0;
  const base = {
    modifiers,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
  };
  await cdp.send('Input.dispatchKeyEvent', {
    ...base,
    type: types ? 'keyDown' : 'rawKeyDown',
    ...(types ? { text: key.text, unmodifiedText: key.text } : {}),
  });
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

function quadBox(quad: readonly number[]): Box | null {
  if (quad.length < 8) return null;
  const xs = [0, 2, 4, 6].map((i) => quad[i] ?? 0);
  const ys = [1, 3, 5, 7].map((i) => quad[i] ?? 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  return box.width > 0 && box.height > 0 ? box : null;
}

/** The element's border box in viewport CSS px, after scrolling it into view. */
export async function elementBox(cdp: Cdp, backendNodeId: number, scroll = true): Promise<Box> {
  if (scroll) await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
  try {
    const { quads } = (await cdp.send('DOM.getContentQuads', { backendNodeId })) as { quads: number[][] };
    for (const quad of quads) {
      const box = quadBox(quad);
      if (box) return box;
    }
  } catch {
    // Falls through to the box model, which also covers elements without layout quads.
  }
  try {
    const { model } = (await cdp.send('DOM.getBoxModel', { backendNodeId })) as { model: { border: number[] } };
    const box = quadBox(model.border);
    if (box) return box;
  } catch {
    // Reported below.
  }
  throw new ToolError('The element is not visible (no layout box); it may be hidden or detached.');
}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function hover(cdp: Cdp, backendNodeId: number): Promise<Point> {
  const point = center(await elementBox(cdp, backendNodeId));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  return point;
}

/** A real mouse click through CDP, so framework handlers see trusted pointer and mouse events. */
export async function click(
  cdp: Cdp,
  backendNodeId: number,
  options: { readonly button?: MouseButton; readonly double?: boolean } = {},
): Promise<Point> {
  const button = options.button ?? 'left';
  const point = await hover(cdp, backendNodeId);
  const clicks = options.double ? 2 : 1;
  for (let clickCount = 1; clickCount <= clicks; clickCount++) {
    const event = { x: point.x, y: point.y, button, clickCount };
    await cdp.send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed', buttons: BUTTON_BITS[button] });
    await cdp.send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased', buttons: 0 });
  }
  return point;
}

/** Selects the element's current content so typed text replaces it (inputs, textareas, contenteditable). */
const SELECT_CONTENTS = `function () {
  if (typeof this.select === 'function' && ('value' in this)) { this.select(); return true; }
  if (this.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}`;

/** Focuses the element, replaces its content with `text` (as typed input), and optionally presses Enter. */
export async function typeText(
  cdp: Cdp,
  backendNodeId: number,
  text: string,
  options: { readonly submit?: boolean } = {},
): Promise<void> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
  try {
    await cdp.send('DOM.focus', { backendNodeId });
  } catch {
    throw new ToolError('The element cannot take keyboard focus; target an input, textarea or editable element.');
  }
  const editable = await callOnElement<boolean>(cdp, backendNodeId, SELECT_CONTENTS);
  if (!editable) throw new ToolError('The element is not editable; target an input, textarea or editable element.');
  if (text) await cdp.send('Input.insertText', { text });
  else await pressKey(cdp, 'Delete');
  if (options.submit) await pressKey(cdp, 'Enter');
}

export interface ScrollResult {
  readonly scrollX: number;
  readonly scrollY: number;
}

/** Scrolls with the mouse wheel over the element (or the viewport centre) and reports the new position. */
export async function scroll(
  cdp: Cdp,
  backendNodeId: number | null,
  deltaX: number,
  deltaY: number,
): Promise<ScrollResult> {
  let point: Point;
  if (backendNodeId !== null) {
    point = center(await elementBox(cdp, backendNodeId, false));
  } else {
    const metrics = (await cdp.send('Page.getLayoutMetrics')) as {
      cssLayoutViewport: { clientWidth: number; clientHeight: number };
    };
    point = { x: metrics.cssLayoutViewport.clientWidth / 2, y: metrics.cssLayoutViewport.clientHeight / 2 };
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY });
  // Wheel scrolling is applied on the compositor a frame or two later.
  await sleep(150);
  const { result } = (await cdp.send('Runtime.evaluate', {
    expression: '({ scrollX: window.scrollX, scrollY: window.scrollY })',
    returnByValue: true,
  })) as { result: { value?: ScrollResult } };
  return result.value ?? { scrollX: 0, scrollY: 0 };
}

const SELECT_OPTIONS = `function (values) {
  if (!(this instanceof HTMLSelectElement)) throw new Error('The element is not a <select>');
  const wanted = new Set(values);
  const matched = [];
  for (const option of Array.from(this.options)) {
    const hit = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.text.trim());
    if (hit && (this.multiple || matched.length === 0)) matched.push(option);
  }
  if (matched.length === 0) throw new Error('No option matches ' + values.join(', '));
  for (const option of Array.from(this.options)) option.selected = matched.includes(option);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return matched.map((option) => option.value);
}`;

/** Selects options of a `<select>` by value or label and fires `input` and `change`. */
export function selectOptions(cdp: Cdp, backendNodeId: number, values: readonly string[]): Promise<string[]> {
  return callOnElement<string[]>(cdp, backendNodeId, SELECT_OPTIONS, [values]);
}
