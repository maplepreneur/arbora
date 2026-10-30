import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('reports a folder that is not a repository', async () => {
    const { git } = fresh();
    const status = await git.status();
    expect(status.repo).toBe(false);
  });
});

function init(root: string): Promise<void> {
  const run = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
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
  return run(['init', '-b', 'main'])
    .then(() => run(['config', 'user.email', 't@t']))
    .then(() => run(['config', 'user.name', 't']));
}
