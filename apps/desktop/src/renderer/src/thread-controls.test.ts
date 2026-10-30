import { describe, expect, it } from 'vitest';
import type { SessionConfigOption } from '@arbora/shared';
import { modeControl, nextValue, thinkingControl } from './thread-controls';

function select(
  id: string,
  category: string | null,
  values: string[],
  currentValue = values[0] ?? '',
): SessionConfigOption {
  return {
    type: 'select',
    id,
    name: id,
    category,
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

const modes = {
  currentModeId: 'ask',
  availableModes: [
    { id: 'ask', name: 'Ask' },
    { id: 'code', name: 'Code' },
  ],
};

describe('thread controls', () => {
  it('rotates values and wraps around', () => {
    expect(nextValue(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextValue(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextValue(['a', 'b'], 'missing')).toBe('a');
    expect(nextValue([], 'a')).toBeNull();
  });

  it('prefers a mode config option over session modes', () => {
    const option = select('agent', 'mode', ['build', 'plan']);
    expect(modeControl({ configOptions: [option], modes })).toEqual({ kind: 'config', option });
    expect(modeControl({ configOptions: [], modes })).toMatchObject({ kind: 'modes', current: 'ask' });
    expect(modeControl({ configOptions: [], modes: null })).toBeNull();
  });

  it('finds thinking by category, then by name, and never takes the model', () => {
    const level = select('effort', 'thought_level', ['low', 'high']);
    expect(thinkingControl({ configOptions: [select('model', 'model', ['a']), level] })).toEqual({
      kind: 'select',
      option: level,
    });
    const named = select('reasoning', null, ['off', 'on']);
    expect(thinkingControl({ configOptions: [named] })).toEqual({ kind: 'select', option: named });
    expect(thinkingControl({ configOptions: [select('model', 'model', ['thinking-max'])] })).toBeNull();
  });
});
