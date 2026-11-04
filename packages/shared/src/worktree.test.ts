import { describe, expect, it } from 'vitest';
import { worktreeBranchName, worktreeDirectory } from './worktree.js';

describe('worktree names', () => {
  it('slugs a task title into a branch and a sibling directory', () => {
    expect(worktreeBranchName('Fix the nav!')).toBe('fix-the-nav');
    expect(worktreeDirectory('/code/app', 'fix-the-nav')).toBe('/code/app-fix-the-nav');
  });

  it('uses grove-session when the title has no letters or digits', () => {
    expect(worktreeBranchName('   !!! ')).toBe('grove-session');
  });
});
