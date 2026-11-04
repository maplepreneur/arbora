import { describe, expect, it } from 'vitest';
import { RuntimeTable } from './runtime-table.js';

describe('RuntimeTable', () => {
  it('returns the same runtime for a second hold and disposes only when the last reason leaves', () => {
    const table = new RuntimeTable<string>();
    const windowA = {};
    const windowB = {};
    let created = 0;
    const first = table.acquire('/app', windowA, () => `runtime-${++created}`);
    const second = table.acquire('/app', windowB, () => `runtime-${++created}`);
    expect(second).toBe(first);
    expect(created).toBe(1);
    expect(table.release('/app', windowA)).toBeNull();
    expect(table.get('/app')).toBe(first);
    expect(table.release('/app', windowB)).toBe(first);
    expect(table.get('/app')).toBeUndefined();
  });

  it('keeps a listed runtime after its window lets go, and drops it when the listing goes too', () => {
    const table = new RuntimeTable<string>();
    const holder = {};
    table.list('/app', () => 'listed');
    const held = table.acquire('/app', holder, () => 'other');
    expect(held).toBe('listed');
    expect(table.release('/app', holder)).toBeNull();
    expect(table.unlist('/app')).toBe('listed');
    expect(table.paths()).toEqual([]);
  });
});
