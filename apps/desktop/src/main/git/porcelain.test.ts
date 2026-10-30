import { describe, expect, it } from 'vitest';
import { decorationFor } from '@arbora/shared';
import { parsePorcelain } from './porcelain.js';

const SAMPLE = [
  '# branch.oid ba1c5334fb8c24cab3cefeb72ff74e8105ef8c0a',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -2',
  '1 MM N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 61780798228d17af2d34fce4cfbdf35556832472 f.txt',
  '2 RM N... 100644 100644 100644 de980441c3ab03a8c07dda1ad27b8a11f39deb1e de980441c3ab03a8c07dda1ad27b8a11f39deb1e R100 renamed.txt\tf.txt',
  '? n.txt',
  '! secret.env',
].join('\n');

describe('parsePorcelain', () => {
  it('reads the branch header and ordinary, renamed, untracked and ignored entries', () => {
    const status = parsePorcelain(SAMPLE);
    expect(status.branch).toBe('main');
    expect(status.upstream).toBe('origin/main');
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(2);
    expect(status.files.map((file) => [file.path, file.index, file.worktree, file.origPath, file.untracked])).toEqual([
      ['f.txt', 'M', 'M', undefined, false],
      ['renamed.txt', 'R', 'M', 'f.txt', false],
      ['n.txt', '?', '?', undefined, true],
      ['secret.env', '!', '!', undefined, false],
    ]);
  });

  it('marks a detached head', () => {
    const status = parsePorcelain('# branch.head (detached)\n');
    expect(status.detached).toBe(true);
    expect(status.branch).toBeNull();
  });
});

describe('decorationFor', () => {
  it('prefers the worktree letter and maps tones', () => {
    expect(decorationFor({ path: 'a', index: 'M', worktree: '.', untracked: false, conflict: false })).toEqual({
      letter: 'M',
      tone: 'modified',
    });
    expect(decorationFor({ path: 'a', index: 'A', worktree: 'D', untracked: false, conflict: false }).tone).toBe(
      'deleted',
    );
    expect(decorationFor({ path: 'a', index: '?', worktree: '?', untracked: true, conflict: false }).letter).toBe('U');
  });
});
