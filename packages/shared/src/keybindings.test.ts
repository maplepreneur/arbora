import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMANDS, CommandId, resolveKeybindingSpecs } from './commands.js';
import {
  ChordParseError,
  chordFromInput,
  chordId,
  formatChord,
  isTerminalPassthroughChord,
  KeybindingTable,
  parseChord,
  type KeybindingContext,
} from './keybindings.js';

const idle: KeybindingContext = { modeActive: false, terminalFocused: false, terminalPassthrough: true };

describe('parseChord', () => {
  it('resolves mod to Control on Linux and Windows and Meta on macOS', () => {
    expect(parseChord('mod+k', 'linux')).toEqual({ key: 'k', ctrl: true, meta: false, alt: false, shift: false });
    expect(parseChord('mod+k', 'win32')).toEqual({ key: 'k', ctrl: true, meta: false, alt: false, shift: false });
    expect(parseChord('mod+k', 'darwin')).toEqual({ key: 'k', ctrl: false, meta: true, alt: false, shift: false });
  });

  it('parses multiple modifiers case-insensitively with aliases', () => {
    expect(parseChord('Mod+Shift+P', 'linux')).toEqual({ key: 'p', ctrl: true, meta: false, alt: false, shift: true });
    expect(parseChord('cmd+option+i', 'darwin')).toEqual({ key: 'i', ctrl: false, meta: true, alt: true, shift: false });
    expect(parseChord('esc', 'linux').key).toBe('escape');
    expect(parseChord('ctrl+`', 'linux').key).toBe('`');
    expect(parseChord('mod+,', 'linux').key).toBe(',');
  });

  it('supports a literal plus key', () => {
    expect(parseChord('mod++', 'linux')).toEqual({ key: '+', ctrl: true, meta: false, alt: false, shift: false });
  });

  it('rejects malformed chords', () => {
    expect(() => parseChord('', 'linux')).toThrow(ChordParseError);
    expect(() => parseChord('mod+', 'linux')).toThrow(ChordParseError);
    expect(() => parseChord('hyper+k', 'linux')).toThrow(/unknown modifier/);
    expect(() => parseChord('mod+shift', 'linux')).toThrow(/non-modifier/);
  });
});

describe('chordFromInput', () => {
  it('uses the physical key code for letters so Shift and layouts do not matter', () => {
    const chord = chordFromInput({ key: 'P', code: 'KeyP', ctrl: true, meta: false, alt: false, shift: true });
    expect(chordId(chord)).toBe(chordId(parseChord('mod+shift+p', 'linux')));
  });

  it('handles macOS Option producing special characters', () => {
    const chord = chordFromInput({ key: 'π', code: 'KeyP', ctrl: false, meta: true, alt: true, shift: false });
    expect(chord.key).toBe('p');
  });

  it('falls back to key for non-alphanumerics', () => {
    expect(chordFromInput({ key: 'Escape', code: 'Escape', ctrl: false, meta: false, alt: false, shift: false }).key).toBe('escape');
    expect(chordFromInput({ key: ',', ctrl: true, meta: false, alt: false, shift: false }).key).toBe(',');
  });
});

describe('formatChord', () => {
  it('formats per platform', () => {
    expect(formatChord(parseChord('mod+shift+p', 'darwin'), 'darwin')).toBe('⇧⌘P');
    expect(formatChord(parseChord('mod+shift+p', 'linux'), 'linux')).toBe('Ctrl+Shift+P');
    expect(formatChord(parseChord('escape', 'linux'), 'linux')).toBe('Esc');
  });
});

describe('KeybindingTable', () => {
  const build = (platform: 'linux' | 'darwin', ...overrides: Record<string, string | null>[]) =>
    KeybindingTable.build(resolveKeybindingSpecs(DEFAULT_COMMANDS, ...overrides), platform);

  it('matches the default mode chords', () => {
    const { table, errors } = build('linux');
    expect(errors).toEqual([]);
    expect(table.match(parseChord('ctrl+k', 'linux'), idle)?.commandId).toBe(CommandId.agentMode);
    expect(table.match(parseChord('ctrl+d', 'linux'), idle)?.commandId).toBe(CommandId.designMode);
    expect(table.match(parseChord('ctrl+shift+p', 'linux'), idle)?.commandId).toBe(CommandId.commandPalette);
    expect(table.match(parseChord('ctrl+k', 'linux'), idle)?.intercept).toBe(true);
  });

  it('never uses Super for defaults on Linux', () => {
    const { table } = build('linux');
    expect(table.bindings.every((b) => !b.chord.meta)).toBe(true);
  });

  it('uses Cmd on macOS', () => {
    const { table } = build('darwin');
    expect(table.match(parseChord('cmd+k', 'darwin'), idle)?.commandId).toBe(CommandId.agentMode);
    expect(table.match(parseChord('ctrl+k', 'darwin'), idle)).toBeUndefined();
  });

  it('only matches Escape while a mode is active', () => {
    const { table } = build('linux');
    const esc = parseChord('escape', 'linux');
    expect(table.match(esc, idle)).toBeUndefined();
    expect(table.match(esc, { ...idle, modeActive: true })?.commandId).toBe(CommandId.exitMode);
  });

  it('passes plain Ctrl chords through to a focused terminal', () => {
    const { table } = build('linux');
    const terminal = { ...idle, terminalFocused: true };
    expect(table.match(parseChord('ctrl+k', 'linux'), terminal)).toBeUndefined();
    expect(table.match(parseChord('ctrl+d', 'linux'), terminal)).toBeUndefined();
    expect(table.match(parseChord('ctrl+shift+p', 'linux'), terminal)?.commandId).toBe(CommandId.commandPalette);
    expect(table.match(parseChord('ctrl+k', 'linux'), { ...terminal, terminalPassthrough: false })?.commandId).toBe(
      CommandId.agentMode,
    );
  });

  it('applies user then project overrides and allows unbinding', () => {
    const { table } = build('linux', { [CommandId.agentMode]: 'mod+i' }, { [CommandId.agentMode]: 'mod+alt+k', [CommandId.designMode]: null });
    expect(table.match(parseChord('ctrl+k', 'linux'), idle)).toBeUndefined();
    expect(table.match(parseChord('ctrl+i', 'linux'), idle)).toBeUndefined();
    expect(table.match(parseChord('ctrl+alt+k', 'linux'), idle)?.commandId).toBe(CommandId.agentMode);
    expect(table.match(parseChord('ctrl+d', 'linux'), idle)).toBeUndefined();
  });

  it('collects parse errors without dropping valid bindings', () => {
    const { table, errors } = build('linux', { [CommandId.agentMode]: 'hyper+k' });
    expect(errors).toHaveLength(1);
    expect(table.forCommand(CommandId.agentMode)).toBeUndefined();
    expect(table.forCommand(CommandId.designMode)).toBeDefined();
  });
});

describe('isTerminalPassthroughChord', () => {
  it('is true only for plain Ctrl chords', () => {
    expect(isTerminalPassthroughChord(parseChord('ctrl+k', 'linux'))).toBe(true);
    expect(isTerminalPassthroughChord(parseChord('ctrl+shift+k', 'linux'))).toBe(false);
    expect(isTerminalPassthroughChord(parseChord('cmd+k', 'darwin'))).toBe(false);
  });
});
