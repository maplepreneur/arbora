import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from './commands';

describe('CommandRegistry', () => {
  it('registers, lists sorted visible commands and runs them', async () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'b', title: 'Beta', run });
    registry.register({ id: 'a', title: 'Alpha', run: () => undefined });
    registry.register({ id: 'h', title: 'Hidden', run: () => undefined, isVisible: () => false });

    expect(registry.list().map((command) => command.id)).toEqual(['a', 'b']);
    await expect(registry.run('b')).resolves.toBe(true);
    await expect(registry.run('missing')).resolves.toBe(false);
    await expect(registry.run('h')).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('disposes only the registration it created and notifies subscribers', () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    const disposeFirst = registry.register({ id: 'x', title: 'First', run: () => undefined });
    registry.register({ id: 'x', title: 'Second', run: () => undefined });
    disposeFirst();

    expect(registry.get('x')?.title).toBe('Second');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
