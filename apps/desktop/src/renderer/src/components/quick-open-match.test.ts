import { describe, expect, it } from 'vitest';
import { groupMatches } from '../panels/SearchPanel';
import { matchFiles, parseQuickOpenQuery } from './quick-open-match';

describe('parseQuickOpenQuery', () => {
  it('splits off :line and :line:column', () => {
    expect(parseQuickOpenQuery('App.tsx:12')).toEqual({ query: 'App.tsx', line: 12 });
    expect(parseQuickOpenQuery(' app:3:7 ')).toEqual({ query: 'app', line: 3, column: 7 });
    expect(parseQuickOpenQuery('App.tsx')).toEqual({ query: 'App.tsx' });
  });
});

describe('matchFiles', () => {
  const files = ['src/App.tsx', 'src/main.tsx', 'README.md'];

  it('lists recent files first for an empty query, skipping deleted ones', () => {
    expect(matchFiles(files, '', ['README.md', 'gone.ts'], 10).map((r) => r.path)).toEqual([
      'README.md',
      'src/App.tsx',
      'src/main.tsx',
    ]);
  });

  it('fuzzy matches otherwise', () => {
    expect(matchFiles(files, 'main', [], 10).map((r) => r.path)).toEqual(['src/main.tsx']);
  });
});

describe('groupMatches', () => {
  it('groups by file in arrival order', () => {
    const match = (path: string, line: number) => ({ path, line, column: 1, length: 1, preview: 'x', previewStart: 0 });
    expect(groupMatches([match('b', 1), match('a', 2), match('b', 3)]).map((g) => [g.path, g.matches.length])).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
  });
});
