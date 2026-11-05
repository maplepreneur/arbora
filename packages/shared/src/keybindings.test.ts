import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMANDS, CommandId, resolveKeybindingSpecs, rightTabIndex } from './commands.js';
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
    expect(parseChord('cmd+option+i', 'darwin')).toEqual({
      key: 'i',
      ctrl: false,
      meta: true,
      alt: true,
      shift: false,
    });
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
    expect(
      chordFromInput({ key: 'Escape', code: 'Escape', ctrl: false, meta: false, alt: false, shift: false }).key,
    ).toBe('escape');
    expect(chordFromInput({ key: ',', ctrl: true, meta: false, alt: false, shift: false }).key).toBe(',');
  });

  it('keeps the backquote key under Shift (new terminal chord)', () => {
    const chord = chordFromInput({ key: '~', code: 'Backquote', ctrl: true, meta: false, alt: false, shift: true });
    expect(chordId(chord)).toBe(chordId(parseChord('ctrl+shift+`', 'linux')));
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
    const { table } = build(
      'linux',
      { [CommandId.agentMode]: 'mod+i' },
      { [CommandId.agentMode]: 'mod+alt+k', [CommandId.designMode]: null },
    );
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

  it('gives Mod+1 to panel focus in the browser workspace and to row 1 in Grove', () => {
    const { table } = build('linux');
    const ctrl1 = parseChord('ctrl+1', 'linux');
    expect(table.match(ctrl1, idle)?.commandId).toBe(CommandId.focusSidebarPanel);
    expect(table.match(ctrl1, { ...idle, workspace: 'browser' })?.commandId).toBe(CommandId.focusSidebarPanel);
    expect(table.match(ctrl1, { ...idle, workspace: 'grove' })?.commandId).toBe(CommandId.groveSelectSession1);
    expect(table.match(parseChord('ctrl+9', 'linux'), idle)).toBeUndefined();
    expect(table.match(parseChord('ctrl+9', 'linux'), { ...idle, workspace: 'grove' })?.commandId).toBe(
      CommandId.groveSelectSession9,
    );
    // A focused terminal does not swallow Ctrl+digit, in either workspace.
    expect(table.match(ctrl1, { ...idle, workspace: 'grove', terminalFocused: true })?.commandId).toBe(
      CommandId.groveSelectSession1,
    );
  });

  it('matches Grove chords only while Grove shows', () => {
    const { table } = build('linux');
    const grove: KeybindingContext = { ...idle, workspace: 'grove' };
    const newAgent = parseChord('ctrl+alt+n', 'linux');
    expect(table.match(newAgent, idle)).toBeUndefined();
    expect(table.match(newAgent, grove)?.commandId).toBe(CommandId.groveNewDefault);
    const down = parseChord('ctrl+alt+down', 'linux');
    expect(table.match(down, idle)?.commandId).toBe(CommandId.focusPanelDown);
    expect(table.match(down, grove)?.commandId).toBe(CommandId.groveNextSession);
    expect(table.match(parseChord('ctrl+alt+up', 'linux'), grove)?.commandId).toBe(CommandId.grovePreviousSession);
    expect(table.match(parseChord('ctrl+alt+[', 'linux'), grove)?.commandId).toBe(CommandId.groveNextProject);
    expect(table.match(parseChord('ctrl+alt+]', 'linux'), grove)?.commandId).toBe(CommandId.grovePreviousProject);
    expect(table.match(parseChord('ctrl+tab', 'linux'), grove)?.commandId).toBe(CommandId.groveSwitchProject);
    expect(table.match(parseChord('ctrl+shift+tab', 'linux'), grove)?.commandId).toBe(CommandId.groveSwitchProjectBack);
    expect(table.match(parseChord('ctrl+tab', 'linux'), idle)).toBeUndefined();
    expect(table.match(parseChord('ctrl+k', 'linux'), grove)?.commandId).toBe(CommandId.agentMode);
    expect(table.match(parseChord('ctrl+k', 'linux'), grove)?.commandId).not.toBe(CommandId.groveSearch);
    expect(table.match(parseChord('ctrl+alt+m', 'linux'), grove)?.commandId).toBe(CommandId.toggleMaximizeRight);
    expect(table.match(parseChord('ctrl+alt+m', 'linux'), { ...grove, terminalFocused: true })?.commandId).toBe(
      CommandId.toggleMaximizeRight,
    );
    expect(table.match(parseChord('ctrl+alt+g', 'linux'), grove)).toBeUndefined();
    // Mod+Alt+1..9 pick the right column's tabs, from the terminal too; Mod+1..9 stay agents.
    expect(table.match(parseChord('ctrl+alt+1', 'linux'), grove)?.commandId).toBe(CommandId.rightTab1);
    expect(table.match(parseChord('ctrl+alt+9', 'linux'), { ...grove, terminalFocused: true })?.commandId).toBe(
      CommandId.rightTab9,
    );
    expect(table.match(parseChord('ctrl+1', 'linux'), grove)?.commandId).toBe(CommandId.groveSelectSession1);
    expect(rightTabIndex(CommandId.rightTab2)).toBe(1);
    expect(rightTabIndex(CommandId.rightTab9)).toBe(-1);
    const newTerminal = parseChord('ctrl+shift+t', 'linux');
    expect(CommandId.groveNewTerminal).toBe('arbora.grove.newTerminal');
    expect(table.match(newTerminal, idle)).toBeUndefined();
    expect(table.match(newTerminal, grove)?.commandId).toBe(CommandId.groveNewTerminal);
    expect(table.match(newTerminal, { ...grove, terminalFocused: true })?.commandId).toBe(CommandId.groveNewTerminal);
  });

  it('keeps Mod+K as agent mode and Mod+Shift+K as Grove search in both workspaces', () => {
    const { table } = build('linux');
    const grove: KeybindingContext = { ...idle, workspace: 'grove' };
    const browser: KeybindingContext = { ...idle, workspace: 'browser' };
    for (const context of [idle, browser, grove]) {
      expect(table.match(parseChord('ctrl+k', 'linux'), context)?.commandId).toBe(CommandId.agentMode);
      expect(table.match(parseChord('ctrl+shift+k', 'linux'), context)?.commandId).toBe(CommandId.groveSearch);
    }
    expect(table.match(parseChord('ctrl+shift+p', 'linux'), grove)?.commandId).toBe(CommandId.commandPalette);
    const mac = build('darwin').table;
    const macGrove: KeybindingContext = { ...idle, workspace: 'grove' };
    expect(mac.match(parseChord('cmd+k', 'darwin'), macGrove)?.commandId).toBe(CommandId.agentMode);
    expect(mac.match(parseChord('cmd+shift+k', 'darwin'), idle)?.commandId).toBe(CommandId.groveSearch);
  });

  it('focuses Grove agents in Grove, and archives or stops only with focus in the chat', () => {
    const { table } = build('linux');
    const grove: KeybindingContext = { ...idle, workspace: 'grove' };
    const browser: KeybindingContext = { ...idle, workspace: 'browser' };
    const focus = parseChord('ctrl+shift+a', 'linux');
    expect(table.match(focus, idle)?.commandId).toBe(CommandId.agentFocusComposer);
    expect(table.match(focus, browser)?.commandId).toBe(CommandId.agentFocusComposer);
    expect(table.match(focus, grove)).toMatchObject({ commandId: CommandId.groveFocusAgents, intercept: true });
    const close = parseChord('ctrl+w', 'linux');
    expect(table.match(close, idle)?.commandId).toBe(CommandId.editorCloseTab);
    expect(table.match(close, browser)?.commandId).toBe(CommandId.editorCloseTab);
    expect(table.match(close, grove)?.commandId).toBe(CommandId.editorCloseTab);
    const chat: KeybindingContext = { ...grove, agentFocused: true };
    expect(table.match(parseChord('alt+a', 'linux'), chat)).toMatchObject({
      commandId: CommandId.groveArchiveSession,
      intercept: false,
    });
    expect(table.match(parseChord('alt+a', 'linux'), grove)).toBeUndefined();
    expect(table.match(parseChord('alt+s', 'linux'), chat)).toMatchObject({
      commandId: CommandId.groveStopSession,
      intercept: false,
    });
    expect(table.match(parseChord('alt+s', 'linux'), grove)).toBeUndefined();
    const overridden = build('linux', { [CommandId.groveArchiveSession]: 'mod+shift+w' }).table;
    expect(overridden.match(parseChord('alt+a', 'linux'), chat)).toBeUndefined();
    expect(overridden.match(parseChord('ctrl+shift+w', 'linux'), chat)?.commandId).toBe(CommandId.groveArchiveSession);
    const mac = build('darwin').table;
    expect(mac.match(parseChord('cmd+w', 'darwin'), grove)?.commandId).toBe(CommandId.editorCloseTab);
    expect(mac.match(parseChord('cmd+shift+a', 'darwin'), grove)?.commandId).toBe(CommandId.groveFocusAgents);
  });

  it('prefers a scoped binding over an always binding on the same chord, whatever the order', () => {
    const specs = [
      { commandId: 'a.always', binding: 'mod+y', when: 'always' as const, intercept: false },
      { commandId: 'b.panel', binding: 'mod+y', when: 'agentPanel' as const, intercept: false },
    ];
    for (const ordered of [specs, [...specs].reverse()]) {
      const { table } = KeybindingTable.build(ordered, 'linux');
      expect(table.match(parseChord('ctrl+y', 'linux'), idle)?.commandId).toBe('a.always');
      expect(table.match(parseChord('ctrl+y', 'linux'), { ...idle, agentFocused: true })?.commandId).toBe('b.panel');
    }
  });
});

describe('isTerminalPassthroughChord', () => {
  it('is true only for plain Ctrl chords', () => {
    expect(isTerminalPassthroughChord(parseChord('ctrl+k', 'linux'))).toBe(true);
    expect(isTerminalPassthroughChord(parseChord('ctrl+tab', 'linux'))).toBe(false);
    expect(isTerminalPassthroughChord(parseChord('ctrl+shift+k', 'linux'))).toBe(false);
    expect(isTerminalPassthroughChord(parseChord('cmd+k', 'darwin'))).toBe(false);
  });

  it('leaves Ctrl+digit to Arbora (panel focus)', () => {
    expect(isTerminalPassthroughChord(parseChord('ctrl+1', 'linux'))).toBe(false);
    expect(isTerminalPassthroughChord(parseChord('ctrl+4', 'win32'))).toBe(false);
  });
});
