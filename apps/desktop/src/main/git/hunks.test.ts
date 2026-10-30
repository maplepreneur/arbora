import { describe, expect, it } from 'vitest';
import { changedLines, hunksOf, patchWithHunks } from './hunks.js';

const DIFF = [
  'diff --git i/f.txt w/f.txt',
  '--- i/f.txt',
  '+++ w/f.txt',
  '@@ -1,2 +1,3 @@',
  ' a',
  '+b',
  ' c',
  '@@ -5 +6 @@',
  '-old',
  '+new',
  '',
].join('\n');

describe('hunks', () => {
  it('lists hunks and rebuilds a patch with one of them', () => {
    expect(hunksOf(DIFF).map((hunk) => hunk.header)).toEqual(['@@ -1,2 +1,3 @@', '@@ -5 +6 @@']);
    const patch = patchWithHunks(DIFF, [1]);
    expect(patch.startsWith('diff --git i/f.txt w/f.txt')).toBe(true);
    expect(patch).toContain('@@ -5 +6 @@');
    expect(patch).not.toContain('@@ -1,2 +1,3 @@');
  });

  it('marks added and replaced lines in the new file', () => {
    expect(changedLines(DIFF)).toEqual([
      { line: 2, kind: 'added' },
      { line: 6, kind: 'modified' },
    ]);
  });
});
