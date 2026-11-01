import { describe, expect, it } from 'vitest';
import { CommandId, DEFAULT_COMMANDS } from './commands.js';
import {
  assignKeybinding,
  bindingFromChord,
  conflictsFor,
  isReservedChord,
  keybindingRows,
  scopesOverlap,
  superChordWarning,
} from './keybinding-editor.js';
import { chordFromInput, parseChord } from './keybindings.js';

describe('bindingFromChord', () => {
  it('writes the primary modifier as mod so the binding is portable', () => {
    const linux = chordFromInput({ key: 'k', code: 'KeyK', ctrl: true, meta: false, alt: false, shift: true });
    expect(bindingFromChord(linux, 'linux')).toBe('mod+shift+k');
    const mac = chordFromInput({ key: 'k', code: 'KeyK', ctrl: true, meta: true, alt: true, shift: false });
    expect(bindingFromChord(mac, 'darwin')).toBe('mod+ctrl+alt+k');
    expect(bindingFromChord(parseChord('alt+left', 'linux'), 'linux')).toBe('alt+left');
  });

  it('round-trips through parseChord', () => {
    for (const source of ['mod+shift+p', 'ctrl+`', 'shift+f6', 'mod+,', 'mod+alt+o']) {
      const chord = parseChord(source, 'linux');
      expect(parseChord(bindingFromChord(chord, 'linux'), 'linux')).toEqual(chord);
    }
  });
});

describe('conflicts', () => {
  it('finds commands on the same chord in overlapping scopes', () => {
    expect(conflictsFor(CommandId.toggleTheme, 'mod+k', DEFAULT_COMMANDS, {}, undefined, 'linux')).toEqual([
      CommandId.agentMode,
    ]);
    // Design undo only applies in design mode; a design-scoped command does not clash with an agent-panel one.
    expect(scopesOverlap('design', 'agentPanel')).toBe(false);
    expect(scopesOverlap('modeActive', 'design')).toBe(true);
    expect(conflictsFor(CommandId.agentCycleMode, 'mod+z', DEFAULT_COMMANDS, {}, undefined, 'linux')).toEqual([]);
  });

  it('reports conflicts per row, respecting user and project layers', () => {
    const rows = keybindingRows(DEFAULT_COMMANDS, { [CommandId.toggleTheme]: 'mod+k' }, undefined, 'linux');
    const theme = rows.find((r) => r.commandId === CommandId.toggleTheme);
    expect(theme).toMatchObject({ binding: 'mod+k', source: 'user', conflicts: [CommandId.agentMode] });
    expect(rows.find((r) => r.commandId === CommandId.agentMode)?.conflicts).toEqual([CommandId.toggleTheme]);
    const project = keybindingRows(DEFAULT_COMMANDS, {}, { [CommandId.agentMode]: null }, 'linux');
    expect(project.find((r) => r.commandId === CommandId.agentMode)).toMatchObject({
      binding: null,
      source: 'project',
    });
  });

  it('has no conflicts in the defaults', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(keybindingRows(DEFAULT_COMMANDS, {}, undefined, platform).filter((r) => r.conflicts.length > 0)).toEqual(
        [],
      );
    }
  });
});

describe('assignKeybinding', () => {
  it('stores overrides, removes them at the default, and unbinds conflicts', () => {
    const next = assignKeybinding({}, DEFAULT_COMMANDS, CommandId.toggleTheme, 'mod+k', [CommandId.agentMode]);
    expect(next).toEqual({ [CommandId.toggleTheme]: 'mod+k', [CommandId.agentMode]: null });
    expect(assignKeybinding(next, DEFAULT_COMMANDS, CommandId.toggleTheme, null)).toEqual({
      [CommandId.agentMode]: null,
    });
    expect(assignKeybinding({ [CommandId.agentMode]: null }, DEFAULT_COMMANDS, CommandId.agentMode, 'mod+k')).toEqual(
      {},
    );
  });
});

describe('reserved and Super chords', () => {
  it('keeps Escape for leaving modes', () => {
    expect(isReservedChord(parseChord('escape', 'linux'))).toBe(true);
    expect(isReservedChord(parseChord('shift+escape', 'linux'))).toBe(true);
    expect(keybindingRows(DEFAULT_COMMANDS, {}, undefined, 'linux').some((r) => r.reserved)).toBe(false);
  });

  it('warns about Super chords off macOS', () => {
    expect(superChordWarning(parseChord('super+k', 'linux'), 'linux')).toMatch(/Hyprland/);
    expect(superChordWarning(parseChord('super+k', 'win32'), 'win32')).toMatch(/Windows/);
    expect(superChordWarning(parseChord('cmd+k', 'darwin'), 'darwin')).toBeNull();
    expect(superChordWarning(parseChord('mod+k', 'linux'), 'linux')).toBeNull();
  });
});
