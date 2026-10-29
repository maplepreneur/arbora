import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, DEFAULT_COMMANDS, commandIdSchema, resolveKeybindingSpecs } from './commands.js';
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
