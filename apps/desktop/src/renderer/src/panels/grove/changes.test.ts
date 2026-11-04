import { describe, expect, it } from 'vitest';
import { NO_ACTIVITY } from '@arbora/shared';
import { editStats, sessionStats } from './changes';

describe('editStats', () => {
  it('counts changed lines, and every line of a new file', () => {
    expect(editStats({ oldText: 'a\nb\nc\n', newText: 'a\nB\nc\nd\n' })).toEqual({ additions: 2, deletions: 1 });
    expect(editStats({ oldText: null, newText: 'one\ntwo\n' })).toEqual({ additions: 2, deletions: 0 });
  });

  it('reuses the result for the same edit', () => {
    const edit = { oldText: 'x\n', newText: 'y\n' };
    expect(editStats(edit)).toBe(editStats(edit));
  });
});

describe('sessionStats', () => {
  it('adds up the files a session edited', () => {
    const files = {
      'src/a.ts': { oldText: 'a\n', newText: 'a\nb\n' },
      'src/b.ts': { oldText: 'x\ny\n', newText: 'x\n' },
    };
    expect(sessionStats({ ...NO_ACTIVITY, files })).toEqual({ additions: 1, deletions: 1, files: 2 });
    expect(sessionStats(NO_ACTIVITY)).toEqual({ additions: 0, deletions: 0, files: 0 });
  });
});
