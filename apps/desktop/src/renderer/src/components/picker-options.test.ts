import { describe, expect, it } from 'vitest';
import { filterOptions, groupOptions, withFavorites, withProviderGroups, type PickerOption } from './picker-options';

const opencode: PickerOption[] = [
  { value: 'opencode/qwen3.5-plus', name: 'opencode/Qwen3.5 Plus' },
  { value: 'opencode/beam-free', name: 'opencode/Beam Free' },
  { value: 'opencode-go/gemini-4-argon', name: 'opencode-go/Gemini 4 Argon' },
  { value: 'opencode-go/grok-4.7', name: 'opencode-go/Grok 4.7' },
];

describe('withProviderGroups', () => {
  it('turns provider/Model names into groups with short names', () => {
    expect(withProviderGroups(opencode).map((o) => [o.group, o.name])).toEqual([
      ['opencode', 'Qwen3.5 Plus'],
      ['opencode', 'Beam Free'],
      ['opencode-go', 'Gemini 4 Argon'],
      ['opencode-go', 'Grok 4.7'],
    ]);
  });

  it('leaves short lists, plain names and explicit groups alone', () => {
    const plain = [
      { value: 'a', name: 'Fast' },
      { value: 'b', name: 'Smart' },
      { value: 'c', name: 'x/Odd' },
      { value: 'd', name: 'Deep' },
    ];
    expect(withProviderGroups(plain)).toEqual(plain);
    expect(withProviderGroups(opencode.slice(0, 3))).toEqual(opencode.slice(0, 3));
    const grouped = opencode.map((o) => ({ ...o, group: 'Kept' }));
    expect(withProviderGroups(grouped)).toEqual(grouped);
  });
});

describe('filterOptions', () => {
  const grouped = withProviderGroups(opencode);

  it('matches every term against name, group and value, case-insensitively', () => {
    expect(filterOptions(grouped, 'go grok').map((o) => o.value)).toEqual(['opencode-go/grok-4.7']);
    expect(filterOptions(grouped, 'FREE').map((o) => o.value)).toEqual(['opencode/beam-free']);
    expect(filterOptions(grouped, '  ')).toHaveLength(4);
    expect(filterOptions(grouped, 'nothing')).toEqual([]);
  });
});

describe('groupOptions', () => {
  it('keeps first-seen group order with ungrouped options first', () => {
    const groups = groupOptions([{ value: 'x', name: 'Plain' }, ...withProviderGroups(opencode)]);
    expect(groups.map((g) => [g.group, g.options.length])).toEqual([
      [null, 1],
      ['opencode', 2],
      ['opencode-go', 2],
    ]);
  });
});

describe('withFavorites', () => {
  it('puts favourites first in starred order, with their provider as the description', () => {
    const options = withFavorites(withProviderGroups(opencode), ['opencode-go/grok-4.7', 'opencode/beam-free', 'gone']);
    expect(options.slice(0, 2).map((o) => [o.value, o.group, o.description])).toEqual([
      ['opencode-go/grok-4.7', 'Favourites', 'opencode-go'],
      ['opencode/beam-free', 'Favourites', 'opencode'],
    ]);
    expect(options).toHaveLength(4);
    expect(groupOptions(options)[0]?.group).toBe('Favourites');
  });

  it('is a no-op without favourites', () => {
    expect(withFavorites(opencode, [])).toEqual(opencode);
  });
});
