import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService } from './git-service.js';

const roots: string[] = [];

function fresh(): { git: GitService; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'arbora-git-'));
  roots.push(root);
  return { git: new GitService({ root, env: () => Promise.resolve(process.env) }), root };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GitService', () => {
  it('stages a hunk, commits, and lists the branch', async () => {
    const { git, root } = fresh();
    await init(root);
    expect(await git.log()).toEqual([]);
    writeFileSync(join(root, 'f.txt'), 'a\nb\nc\n');
    await git.stage(['f.txt']);
    const first = await git.commit('init', false);
    expect(first.ok).toBe(true);

    writeFileSync(join(root, 'f.txt'), 'a\nB\nc\nD\n');
    const hunks = await git.hunks('f.txt', false);
    expect(hunks.length).toBeGreaterThan(0);
    await git.stageHunk('f.txt', 0, false);
    const status = await git.status();
    expect(status.repo).toBe(true);
    expect(status.files.some((file) => file.path === 'f.txt' && file.index !== '.')).toBe(true);

    const committed = await git.commit('edit', false);
    expect(committed.ok).toBe(true);
    const branches = await git.branches();
    expect(branches.some((branch) => branch.current)).toBe(true);
    const log = await git.log();
    expect(log[0]?.subject).toBe('edit');
  });

  it('adds a worktree on a sibling path and removes it again', async () => {
    const { git, root } = fresh();
    await init(root);
    writeFileSync(join(root, 'f.txt'), 'a\n');
    await git.stage(['f.txt']);
    expect((await git.commit('init', false)).ok).toBe(true);
    const directory = join(root, '..', `${root.split('/').pop()}-fix-nav`);
    await git.addWorktree('fix-nav', directory);
    roots.push(directory);
    expect(existsSync(join(directory, 'f.txt'))).toBe(true);
    await git.removeWorktree(directory);
    expect(existsSync(directory)).toBe(false);
  });

  it('untracks a committed .arbora folder and keeps the files', async () => {
    const { git, root } = fresh();
    await init(root);
    mkdirSync(join(root, '.arbora', 'threads'), { recursive: true });
    writeFileSync(join(root, '.arbora', 'threads', 't.json'), '{}');
    writeFileSync(join(root, 'f.txt'), 'a\n');
    await git.stage(['.arbora', 'f.txt']);
    expect((await git.commit('init', false)).ok).toBe(true);
    expect(await git.trackedArboraFiles()).toBe(1);

    expect((await git.untrackArbora()).ok).toBe(true);
    expect(await git.trackedArboraFiles()).toBe(0);
    expect(existsSync(join(root, '.arbora', 'threads', 't.json'))).toBe(true);
  });

  it('stages everything, publishes a new branch and summarises it against the default branch', async () => {
    const { git, root } = fresh();
    const remote = mkdtempSync(join(tmpdir(), 'arbora-git-remote-'));
    roots.push(remote);
    await gitIn(remote, ['init', '--bare', '-b', 'main']);
    await init(root);
    await gitIn(root, ['remote', 'add', 'origin', remote]);
    writeFileSync(join(root, 'f.txt'), 'a\n');
    await git.stageAll();
    expect((await git.commit('init', false)).ok).toBe(true);
    expect((await git.push()).ok).toBe(true);
    expect(await git.defaultBranch()).toBe('main');

    expect((await git.createBranch('arbora/feature')).ok).toBe(true);
    writeFileSync(join(root, 'f.txt'), 'a\nb\n');
    writeFileSync(join(root, 'g.txt'), 'new\n');
    await git.stageAll();
    const staged = await git.stagedSummary();
    expect(staged.stat).toContain('g.txt');
    expect(staged.diff).toContain('+b');
    expect((await git.commit('Add b and g', false)).ok).toBe(true);
    const pushed = await git.push();
    expect(pushed.ok).toBe(true);
    expect((await git.status()).upstream).toBe('origin/arbora/feature');
    const summary = await git.branchSummary('main');
    expect(summary.log).toContain('- Add b and g');
    expect(summary.stat).toContain('g.txt');
  });

  it('reports a folder that is not a repository', async () => {
    const { git } = fresh();
    const status = await git.status();
    expect(status.repo).toBe(false);
  });
});

function gitIn(root: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_AUTHOR_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
        },
      },
      (error) => (error ? reject(new Error(error.message)) : resolve()),
    );
  });
}

function init(root: string): Promise<void> {
  const run = (args: string[]) => gitIn(root, args);
  return run(['init', '-b', 'main'])
    .then(() => run(['config', 'user.email', 't@t']))
    .then(() => run(['config', 'user.name', 't']));
}
