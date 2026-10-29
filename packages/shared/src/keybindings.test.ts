import { describe, expect, it } from 'vitest';
import {
  chordMatches,
  CommandId,
  compileKeybindings,
  defaultKeybindings,
  findKeybinding,
  formatChord,
  KeybindingParseError,
  parseChord,
  type KeyContext,
  type KeyInput,
} from './keybindings';

function key(input: Partial<KeyInput> & { key: string }): KeyInput {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...input };
}

const idle: KeyContext = { modeActive: false, terminalFocused: false, terminalPassthrough: true };

describe('parseChord', () => {
  it('resolves mod to Ctrl on Linux and Windows and to Cmd on macOS', () => {
    expect(parseChord('mod+k', 'linux')).toEqual({
      key: 'k',
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(parseChord('mod+k', 'win32').ctrl).toBe(true);
    expect(parseChord('mod+k', 'darwin')).toMatchObject({ key: 'k', ctrl: false, meta: true });
  });

  it('accepts aliases, mixed case and whitespace', () => {
    expect(parseChord(' Ctrl + Shift + P ', 'linux')).toMatchObject({
      key: 'p',
      ctrl: true,
      shift: true,
    });
    expect(parseChord('esc', 'linux').key).toBe('escape');
    expect(parseChord('cmd+space', 'darwin')).toMatchObject({ key: ' ', meta: true });
    expect(parseChord('option+up', 'darwin')).toMatchObject({ key: 'arrowup', alt: true });
  });

  it('rejects malformed chords', () => {
    expect(() => parseChord('', 'linux')).toThrow(KeybindingParseError);
    expect(() => parseChord('mod+', 'linux')).toThrow(KeybindingParseError);
    expect(() => parseChord('hyper+k', 'linux')).toThrow(/unknown modifier/);
    expect(() => parseChord('ctrl+shift', 'linux')).toThrow(/non-modifier/);
    expect(() => parseChord('mod+ctrl+k', 'linux')).toThrow(/duplicate/);
  });
});

describe('formatChord', () => {
  it('formats per platform', () => {
    expect(formatChord(parseChord('mod+shift+p', 'linux'), 'linux')).toBe('Ctrl+Shift+P');
    expect(formatChord(parseChord('mod+shift+p', 'darwin'), 'darwin')).toBe('⇧⌘P');
    expect(formatChord(parseChord('escape', 'win32'), 'win32')).toBe('Esc');
  });
});

describe('chordMatches', () => {
  const ctrlK = parseChord('mod+k', 'linux');

  it('requires the exact modifier set', () => {
    expect(chordMatches(ctrlK, key({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(chordMatches(ctrlK, key({ key: 'K', ctrlKey: true }))).toBe(true);
    expect(chordMatches(ctrlK, key({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(chordMatches(ctrlK, key({ key: 'k', metaKey: true }))).toBe(false);
    expect(chordMatches(ctrlK, key({ key: 'k' }))).toBe(false);
  });

  it('falls back to the physical key code for non-Latin layouts', () => {
    expect(chordMatches(ctrlK, key({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe(true);
  });
});

describe('compileKeybindings', () => {
  it('applies override layers in order and supports unbinding', () => {
    const { bindings, problems } = compileKeybindings(
      'linux',
      defaultKeybindings,
      { [CommandId.agentMode]: 'mod+shift+k', [CommandId.quickOpen]: null },
      { [CommandId.agentMode]: 'mod+alt+k', 'custom.command': 'mod+9' },
    );

    expect(problems).toEqual([]);
    const agent = bindings.find((binding) => binding.command === CommandId.agentMode);
    expect(agent?.source).toBe('mod+alt+k');
    expect(agent?.intercept).toBe(true);
    expect(bindings.some((binding) => binding.command === CommandId.quickOpen)).toBe(false);
    expect(bindings.find((binding) => binding.command === 'custom.command')?.intercept).toBe(false);
  });

  it('reports invalid chords without dropping the others', () => {
    const { bindings, problems } = compileKeybindings('linux', defaultKeybindings, {
      [CommandId.designMode]: 'hyper+d',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.command).toBe(CommandId.designMode);
    expect(bindings.some((binding) => binding.command === CommandId.agentMode)).toBe(true);
  });
});

describe('findKeybinding', () => {
  const { bindings } = compileKeybindings('linux', defaultKeybindings);

  it('routes intercepted chords to main and the rest to the renderer', () => {
    const ctrlK = key({ key: 'k', ctrlKey: true });
    expect(findKeybinding(bindings, ctrlK, idle, 'main')?.command).toBe(CommandId.agentMode);
    expect(findKeybinding(bindings, ctrlK, idle, 'renderer')).toBeUndefined();

    const ctrlP = key({ key: 'p', ctrlKey: true });
    expect(findKeybinding(bindings, ctrlP, idle, 'main')).toBeUndefined();
    expect(findKeybinding(bindings, ctrlP, idle, 'renderer')?.command).toBe(CommandId.quickOpen);
  });

  it('only intercepts Escape while a mode is active', () => {
    const escape = key({ key: 'Escape' });
    expect(findKeybinding(bindings, escape, idle, 'main')).toBeUndefined();
    expect(findKeybinding(bindings, escape, { ...idle, modeActive: true }, 'main')?.command).toBe(
      CommandId.exitMode,
    );
  });

  it('passes plain Ctrl chords through to a focused terminal when enabled', () => {
    const terminal: KeyContext = { ...idle, terminalFocused: true };
    expect(findKeybinding(bindings, key({ key: 'k', ctrlKey: true }), terminal, 'main')).toBe(
      undefined,
    );
    expect(findKeybinding(bindings, key({ key: 'd', ctrlKey: true }), terminal, 'main')).toBe(
      undefined,
    );
    expect(
      findKeybinding(bindings, key({ key: 'P', ctrlKey: true, shiftKey: true }), terminal, 'main')
        ?.command,
    ).toBe(CommandId.commandPalette);
    expect(
      findKeybinding(
        bindings,
        key({ key: 'k', ctrlKey: true }),
        { ...terminal, terminalPassthrough: false },
        'main',
      )?.command,
    ).toBe(CommandId.agentMode);
  });

  it('does not treat Cmd chords on macOS as terminal passthrough', () => {
    const mac = compileKeybindings('darwin', defaultKeybindings).bindings;
    const terminal: KeyContext = { ...idle, terminalFocused: true };
    expect(findKeybinding(mac, key({ key: 'k', metaKey: true }), terminal, 'main')?.command).toBe(
      CommandId.agentMode,
    );
  });
});
