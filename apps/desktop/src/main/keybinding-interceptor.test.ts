import type { Input } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  CommandId,
  DEFAULT_COMMANDS,
  KeybindingTable,
  resolveKeybindingSpecs,
  type KeybindingContext,
} from '@arbora/shared';
import { interceptCommand, type InterceptorSource } from './keybinding-interceptor.js';

function input(partial: Partial<Input> & Pick<Input, 'key'>): Input {
  return {
    type: 'keyDown',
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...partial,
  };
}

function source(context: Partial<KeybindingContext> = {}): InterceptorSource {
  const { table } = KeybindingTable.build(resolveKeybindingSpecs(DEFAULT_COMMANDS), 'linux');
  return {
    table: () => table,
    context: () => ({ modeActive: false, terminalFocused: false, terminalPassthrough: true, ...context }),
    dispatch: () => undefined,
  };
}

describe('interceptCommand', () => {
  it('intercepts mode chords and the palette', () => {
    expect(interceptCommand(input({ key: 'k', code: 'KeyK', control: true }), source())).toBe(CommandId.agentMode);
    expect(interceptCommand(input({ key: 'd', code: 'KeyD', control: true }), source())).toBe(CommandId.designMode);
    expect(interceptCommand(input({ key: 'P', code: 'KeyP', control: true, shift: true }), source())).toBe(
      CommandId.commandPalette,
    );
  });

  it('ignores key-up, bare modifiers, plain typing and non-intercepted bindings', () => {
    expect(interceptCommand(input({ key: 'k', code: 'KeyK', control: true, type: 'keyUp' }), source())).toBeUndefined();
    expect(interceptCommand(input({ key: 'Control', control: true }), source())).toBeUndefined();
    expect(interceptCommand(input({ key: 'k', code: 'KeyK' }), source())).toBeUndefined();
    expect(interceptCommand(input({ key: 'b', code: 'KeyB', control: true }), source())).toBeUndefined();
  });

  it('intercepts Escape only while a mode is active', () => {
    const esc = input({ key: 'Escape', code: 'Escape' });
    expect(interceptCommand(esc, source())).toBeUndefined();
    expect(interceptCommand(esc, source({ modeActive: true }))).toBe(CommandId.exitMode);
  });

  it('lets every key through while the shortcut editor records', () => {
    const ctrlK = input({ key: 'k', code: 'KeyK', control: true });
    expect(interceptCommand(ctrlK, source({ recording: true }))).toBeUndefined();
    expect(interceptCommand(input({ key: 'F6', code: 'F6' }), source())).toBe(CommandId.focusNextPanel);
    expect(interceptCommand(input({ key: 'F6', code: 'F6' }), source({ recording: true }))).toBeUndefined();
  });

  it('intercepts pane arrows on the browser view, including rawKeyDown', () => {
    const left = input({ key: 'ArrowLeft', code: 'ArrowLeft', control: true, alt: true });
    expect(interceptCommand(left, source({ workspace: 'grove', contentFocused: true }))).toBe(CommandId.focusPanelLeft);
    expect(
      interceptCommand({ ...left, type: 'rawKeyDown', key: '' }, source({ workspace: 'grove', contentFocused: true })),
    ).toBe(CommandId.focusPanelLeft);
    const right = input({ key: 'ArrowRight', code: 'ArrowRight', control: true, alt: true });
    expect(interceptCommand(right, source({ workspace: 'grove', contentFocused: true }))).toBe(
      CommandId.focusPanelRight,
    );
  });

  it('lets Ctrl+K and Ctrl+D through to a focused terminal when passthrough is on', () => {
    const ctrlK = input({ key: 'k', code: 'KeyK', control: true });
    expect(interceptCommand(ctrlK, source({ terminalFocused: true }))).toBeUndefined();
    expect(interceptCommand(ctrlK, source({ terminalFocused: true, terminalPassthrough: false }))).toBe(
      CommandId.agentMode,
    );
  });

  it('lets plain Ctrl+` through to a focused terminal, and shows the terminal otherwise', () => {
    const tick = input({ key: '`', code: 'Backquote', control: true });
    expect(interceptCommand(tick, source())).toBe(CommandId.showTerminal);
    expect(interceptCommand(tick, source({ terminalFocused: true }))).toBeUndefined();
    // New Terminal stays Ctrl+Shift+` and is not intercepted, so a focused shell still receives it.
    expect(interceptCommand({ ...tick, shift: true }, source({ terminalFocused: true }))).toBeUndefined();
  });
});
