import { describe, expect, it } from 'vitest';
import {
  branchNameFor,
  commitMessagePrompt,
  decorationFor,
  GENERATE_DIFF_LIMIT,
  parseGeneratedText,
  shouldAutoPull,
  type GitStatus,
} from './git.js';

const clean: GitStatus = {
  repo: true,
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 2,
  files: [],
};

describe('shouldAutoPull', () => {
  it('fast-forwards a clean branch that is only behind', () => {
    expect(shouldAutoPull(clean)).toBe(true);
    expect(
      shouldAutoPull({
        ...clean,
        files: [{ path: 'new.txt', index: '?', worktree: '?', untracked: true, conflict: false }],
      }),
    ).toBe(true);
  });

  it('leaves local work, diverged branches and detached heads alone', () => {
    expect(shouldAutoPull({ ...clean, behind: 0 })).toBe(false);
    expect(shouldAutoPull({ ...clean, ahead: 1 })).toBe(false);
    expect(shouldAutoPull({ ...clean, detached: true })).toBe(false);
    expect(shouldAutoPull({ ...clean, upstream: null })).toBe(false);
    expect(
      shouldAutoPull({
        ...clean,
        files: [{ path: 'a.ts', index: '.', worktree: 'M', untracked: false, conflict: false }],
      }),
    ).toBe(false);
  });
});

describe('parseGeneratedText', () => {
  it('drops fences, labels and quotes', () => {
    expect(parseGeneratedText('```\nAdd login page\n\nWith a form.\n```')).toEqual({
      title: 'Add login page',
      body: 'With a form.',
    });
    expect(parseGeneratedText('Title: "Fix the sail animation"\n\nBody: Three boats now.')).toEqual({
      title: 'Fix the sail animation',
      body: 'Three boats now.',
    });
    expect(parseGeneratedText('# Speed up search\n## Summary\n- faster')).toEqual({
      title: 'Speed up search',
      body: '## Summary\n- faster',
    });
    expect(parseGeneratedText('   ')).toEqual({ title: '', body: '' });
  });
});

describe('branchNameFor', () => {
  it('slugs the title under arbora/ and avoids taken names', () => {
    expect(branchNameFor('Fix the Sail animation!')).toBe('arbora/fix-the-sail-animation');
    expect(branchNameFor('???')).toBe('arbora/changes');
    expect(branchNameFor('Fix', ['arbora/fix', 'arbora/fix-2'])).toBe('arbora/fix-3');
  });
});

describe('commitMessagePrompt', () => {
  it('truncates long diffs', () => {
    const prompt = commitMessagePrompt(' a.ts | 2 +-', 'x'.repeat(GENERATE_DIFF_LIMIT + 10));
    expect(prompt).toContain('[diff truncated]');
    expect(prompt).toContain('a.ts | 2 +-');
  });
});

describe('decorationFor', () => {
  it('marks untracked files as added', () => {
    expect(decorationFor({ path: 'a', index: '?', worktree: '?', untracked: true, conflict: false })).toEqual({
      letter: 'U',
      tone: 'added',
    });
  });
});
