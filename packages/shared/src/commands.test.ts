import { describe, expect, it, vi } from 'vitest';
import {
  CommandId,
  CommandRegistry,
  DEFAULT_COMMANDS,
  commandIdSchema,
  GROVE_SELECT_COMMANDS,
  groveSessionIndex,
  neighbourPanel,
  resolveKeybindingSpecs,
  WORKSPACE_PANELS,
} from './commands.js';
import { chordId, KeybindingTable } from './keybindings.js';

describe('CommandRegistry', () => {
  it('registers, executes and unregisters commands', async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    const listener = vi.fn();
    registry.subscribe(listener);
    const dispose = registry.register({ id: 'x', title: 'X', run });
    expect(registry.list().map((c) => c.id)).toEqual(['x']);
    await expect(registry.execute('x')).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    dispose();
    await expect(registry.execute('x')).resolves.toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate ids', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'x', title: 'X', run: () => undefined });
    expect(() => registry.register({ id: 'x', title: 'X', run: () => undefined })).toThrow(/already registered/);
  });
});

describe('DEFAULT_COMMANDS', () => {
  it('has unique ids that are all valid command ids', () => {
    const ids = DEFAULT_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(commandIdSchema.safeParse(id).success).toBe(true);
  });

  it('has default chords that parse and never collide', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const { table, errors } = KeybindingTable.build(resolveKeybindingSpecs(DEFAULT_COMMANDS), platform);
      expect(errors).toEqual([]);
      const ids = table.bindings.map((b) => `${chordId(b.chord)}|${b.when}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('neighbourPanel', () => {
  it('moves left and right across sidebar, middle and agent', () => {
    expect(neighbourPanel('sidebar', 'right')).toBe('center');
    expect(neighbourPanel('center', 'right')).toBe('agent');
    expect(neighbourPanel('bottom', 'right')).toBe('agent');
    expect(neighbourPanel('agent', 'left')).toBe('center');
    expect(neighbourPanel('bottom', 'left')).toBe('sidebar');
  });

  it('moves up and down only in the middle column, and stops at edges', () => {
    expect(neighbourPanel('center', 'down')).toBe('bottom');
    expect(neighbourPanel('bottom', 'up')).toBe('center');
    expect(neighbourPanel('sidebar', 'left')).toBeNull();
    expect(neighbourPanel('agent', 'right')).toBeNull();
    expect(neighbourPanel('center', 'up')).toBeNull();
    expect(neighbourPanel('agent', 'down')).toBeNull();
  });

  it('has a Mod+digit chord for every panel, in order', () => {
    const chords = WORKSPACE_PANELS.map(
      (panel) => DEFAULT_COMMANDS.find((c) => c.id === `arbora.focus.${panel}`)?.keybinding,
    );
    expect(chords).toEqual(['mod+1', 'mod+2', 'mod+3', 'mod+4']);
  });
});

describe('Grove commands', () => {
  it('select rows 1 to 9 with hidden, Grove-only Mod+digit chords', () => {
    const rows = GROVE_SELECT_COMMANDS.map((id) => DEFAULT_COMMANDS.find((c) => c.id === id));
    expect(rows.map((c) => c?.keybinding)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => `mod+${n}`),
    );
    expect(rows.every((c) => c?.when === 'grove' && c.hidden === true && c.intercept === true)).toBe(true);
    expect(GROVE_SELECT_COMMANDS.map((id) => groveSessionIndex(id))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(groveSessionIndex(CommandId.groveNextSession)).toBeNull();
  });

  it('are all intercepted, with workspace commands under View and session commands under Grove', () => {
    const grove = DEFAULT_COMMANDS.filter((c) => c.id.startsWith('arbora.grove.'));
    expect(grove.length).toBe(25);
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveFocusAgents)).toMatchObject({
      title: 'Focus agents',
      keybinding: 'mod+shift+a',
      when: 'grove',
      intercept: true,
    });
    for (const id of [CommandId.groveArchiveSession, CommandId.groveStopSession]) {
      expect(DEFAULT_COMMANDS.find((c) => c.id === id)).toMatchObject({ when: 'agentPanel', intercept: false });
    }
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveArchiveSession)?.keybinding).toBe('alt+a');
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveArchiveSession)?.extraKeybindings).toBeUndefined();
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveStopSession)?.keybinding).toBe('alt+s');
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveNewTerminal)).toMatchObject({
      title: 'New Terminal',
      keybinding: 'mod+shift+t',
      when: 'grove',
      intercept: true,
    });
    expect(grove.every((c) => c.category === 'Grove' && (c.intercept === true || c.when === 'agentPanel'))).toBe(true);
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.toggleMaximizeRight)).toMatchObject({
      category: 'View',
      keybinding: 'mod+alt+m',
      intercept: true,
    });
    expect(DEFAULT_COMMANDS.some((c) => c.id === 'arbora.toggleWorkspace')).toBe(false);
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.toggleSideColumn)).toMatchObject({
      category: 'View',
      keybinding: 'mod+shift+b',
      intercept: true,
    });
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveSearch)).toMatchObject({
      keybinding: 'mod+shift+k',
      intercept: true,
    });
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveSearch)?.when).toBeUndefined();
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.agentMode)?.keybinding).toBe('mod+k');
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.commandPalette)?.keybinding).toBe('mod+shift+p');
    // The launcher runs from the palette in either workspace; Mod+Shift+N opens it inside Grove.
    expect(DEFAULT_COMMANDS.find((c) => c.id === CommandId.groveLaunch)?.when).toBeUndefined();
  });
});
