import { describe, expect, it } from 'vitest';
import { CommandId, DEFAULT_COMMANDS, resolveKeybindingSpecs } from './commands.js';
import { filterKeybindingCheatRows, keybindingCheatRows } from './keybinding-cheatsheet.js';
import { KeybindingTable, parseChord, type KeybindingContext } from './keybindings.js';

const idle: KeybindingContext = { modeActive: false, terminalFocused: false, terminalPassthrough: true };

describe('keybindings cheatsheet', () => {
  it('resolves Mod+H when idle and filters by title and chord', () => {
    const { table } = KeybindingTable.build(resolveKeybindingSpecs(DEFAULT_COMMANDS), 'linux');
    expect(table.match(parseChord('mod+h', 'linux'), idle)?.commandId).toBe(CommandId.showKeybindings);
    expect(table.match(parseChord('mod+h', 'linux'), idle)?.intercept).toBe(true);
    expect(table.match(parseChord('mod+h', 'linux'), { ...idle, workspace: 'grove' })?.commandId).toBe(
      CommandId.showKeybindings,
    );

    const rows = keybindingCheatRows(DEFAULT_COMMANDS, 'linux');
    expect(rows.some((row) => row.commandId === CommandId.closeProject)).toBe(false);
    expect(rows.find((row) => row.commandId === CommandId.groveNewDefault)?.scope).toBe('in Grove');
    expect(rows.find((row) => row.commandId === CommandId.showKeybindings)?.scope).toBeNull();

    expect(filterKeybindingCheatRows(rows, 'command palette').map((row) => row.commandId)).toContain(
      CommandId.commandPalette,
    );
    expect(filterKeybindingCheatRows(rows, 'ctrl+shift+p').map((row) => row.commandId)).toContain(
      CommandId.commandPalette,
    );
  });
});
