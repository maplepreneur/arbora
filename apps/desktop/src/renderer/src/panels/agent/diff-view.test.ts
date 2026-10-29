import { describe, expect, it } from 'vitest';
import { unifiedDiff } from './diff-view';

describe('unifiedDiff', () => {
  it('produces hunks with line numbers and counts', () => {
    const result = unifiedDiff('a\nb\nc\n', 'a\nB\nc\nd\n', 1);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    expect(result.lines[0]).toMatchObject({ kind: 'hunk' });
    expect(result.lines.slice(1)).toEqual([
      { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'b', oldLine: 2, newLine: null },
      { kind: 'add', text: 'B', oldLine: null, newLine: 2 },
      { kind: 'context', text: 'c', oldLine: 3, newLine: 3 },
      { kind: 'add', text: 'd', oldLine: null, newLine: 4 },
    ]);
  });

  it('treats a missing old text as a new file', () => {
    const result = unifiedDiff(null, 'x\ny\n');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
    expect(result.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['x', 'y']);
  });

  it('returns no lines for identical texts', () => {
    expect(unifiedDiff('same\n', 'same\n').lines).toEqual([]);
  });
});
