import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { GitBranch, GitCommit, GitHunk, GitLine, GitRemote, GitResult, GitStash, GitStatus } from '@arbora/shared';
import { ARBORA_DIR } from '../project-settings.js';
import { changedLines, hunksOf, patchWithHunks } from './hunks.js';
import { parsePorcelain } from './porcelain.js';
import { GitError, runGit } from './run-git.js';

export interface GitServiceOptions {
  readonly root: string;
  readonly env: () => Promise<NodeJS.ProcessEnv>;
}

const NOT_A_REPO = /not a git repository|cannot chdir/i;

/** Project git: status, diffs, hunks, history and remotes. Commands are serialised. */
export class GitService {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: GitServiceOptions) {}

  status(): Promise<GitStatus> {
    return this.enqueue(async (env) => {
      try {
        const { stdout } = await runGit(this.options.root, env, [
          'status',
          '--porcelain=v2',
          '--branch',
          '--untracked-files=all',
          '--renames',
        ]);
        return parsePorcelain(stdout);
      } catch (error) {
        if (error instanceof GitError && NOT_A_REPO.test(error.message)) {
          return { repo: false, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [] };
        }
        return {
          repo: false,
          branch: null,
          detached: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          files: [],
          error: messageOf(error),
        };
      }
    });
  }

  /** Worktree or staged unified diff for one file, or the whole staged diff when `path` is omitted. */
  diff(path: string | undefined, staged: boolean): Promise<string> {
    return this.enqueue(async (env) => {
      const args = ['diff', '--no-ext-diff', '--no-color', ...(staged ? ['--cached'] : []), '--'];
      if (path) args.push(path);
      const { stdout } = await runGit(this.options.root, env, args);
      return stdout;
    });
  }

  hunks(path: string, staged: boolean): Promise<GitHunk[]> {
    return this.diff(path, staged).then(hunksOf);
  }

  lines(path: string): Promise<GitLine[]> {
    return this.diff(path, false).then(changedLines);
  }

  /** Before/after text for the merge viewer. A missing side (new or deleted file) is empty. */
  sides(path: string, staged: boolean): Promise<{ left: string; right: string }> {
    return this.enqueue(async (env) => {
      const left = await this.show(env, 'HEAD', path);
      const right = staged ? await this.show(env, '', path) : await readWorktree(this.options.root, path);
      return { left, right };
    });
  }

  stage(paths: readonly string[]): Promise<void> {
    return this.enqueue(async (env) => {
      if (paths.length === 0) return;
      await runGit(this.options.root, env, ['add', '--', ...paths]);
    });
  }

  unstage(paths: readonly string[]): Promise<void> {
    return this.enqueue(async (env) => {
      if (paths.length === 0) return;
      await runGit(this.options.root, env, ['restore', '--staged', '--', ...paths]);
    });
  }

  stageHunk(path: string, index: number, staged: boolean): Promise<void> {
    return this.enqueue(async (env) => {
      const { stdout } = await runGit(this.options.root, env, [
        'diff',
        '--no-ext-diff',
        '--no-color',
        ...(staged ? ['--cached'] : []),
        '--',
        path,
      ]);
      const patch = patchWithHunks(stdout, [index]);
      await runGit(this.options.root, env, ['apply', '--cached', ...(staged ? ['-R'] : [])], { input: patch });
    });
  }

  discard(paths: readonly string[]): Promise<void> {
    return this.enqueue(async (env) => {
      const status = parsePorcelain(
        (await runGit(this.options.root, env, ['status', '--porcelain=v2', '--untracked-files=all'])).stdout,
      );
      const byPath = new Map(status.files.map((file) => [file.path, file]));
      const tracked = paths.filter((path) => !byPath.get(path)?.untracked);
      const untracked = paths.filter((path) => byPath.get(path)?.untracked);
      if (tracked.length > 0) {
        await runGit(this.options.root, env, ['restore', '--source=HEAD', '--worktree', '--staged', '--', ...tracked]);
      }
      if (untracked.length > 0) await runGit(this.options.root, env, ['clean', '-f', '--', ...untracked]);
    });
  }

  commit(message: string, amend: boolean): Promise<GitResult> {
    return this.enqueue(async (env) => {
      const args = ['commit', ...(amend ? ['--amend'] : []), '-m', message];
      try {
        const { stdout, stderr } = await runGit(this.options.root, env, args);
        return { ok: true, output: (stdout || stderr).trim() };
      } catch (error) {
        return { ok: false, output: messageOf(error) };
      }
    });
  }

  branches(): Promise<GitBranch[]> {
    return this.enqueue(async (env) => {
      const { stdout } = await runGit(this.options.root, env, ['branch', '--format=%(refname:short)%00%(HEAD)']);
      return stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          const [name, head] = line.split('\0');
          return { name: name ?? '', current: head === '*' };
        })
        .filter((branch) => branch.name !== '');
    });
  }

  checkout(name: string): Promise<GitResult> {
    return this.command(['switch', name]);
  }

  createBranch(name: string): Promise<GitResult> {
    return this.command(['switch', '-c', name]);
  }

  log(): Promise<GitCommit[]> {
    return this.enqueue(async (env) => {
      let stdout: string;
      try {
        ({ stdout } = await runGit(this.options.root, env, [
          'log',
          '-n',
          '50',
          '--format=%H%x1f%P%x1f%an%x1f%at%x1f%s',
        ]));
      } catch (error) {
        if (error instanceof GitError && /does not have any commits/i.test(error.message)) return [];
        throw error;
      }
      return stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          const [hash, parents, author, at, subject] = line.split('\x1f');
          return {
            hash: hash ?? '',
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            author: author ?? '',
            at: Number(at ?? 0),
            subject: subject ?? '',
          };
        });
    });
  }

  push(): Promise<GitResult> {
    return this.command(['push']);
  }

  pull(): Promise<GitResult> {
    return this.command(['pull']);
  }

  fetch(): Promise<GitResult> {
    return this.command(['fetch']);
  }

  stash(): Promise<GitStash[]> {
    return this.enqueue(async (env) => {
      const { stdout } = await runGit(this.options.root, env, ['stash', 'list', '--format=%gd%x1f%s']);
      return stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          const [ref, message] = line.split('\x1f');
          const index = Number(/^stash@\{(\d+)\}$/.exec(ref ?? '')?.[1] ?? -1);
          return { index, message: message ?? '' };
        })
        .filter((entry) => entry.index >= 0);
    });
  }

  stashApply(index: number, pop: boolean): Promise<GitResult> {
    return this.command(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`]);
  }

  stashDrop(index: number): Promise<GitResult> {
    return this.command(['stash', 'drop', `stash@{${index}}`]);
  }

  /** Files under `.arbora/` that are already in the index (committed before it was ignored). */
  trackedArboraFiles(): Promise<number> {
    return this.enqueue(async (env) => {
      const { stdout } = await runGit(this.options.root, env, ['ls-files', '--', ARBORA_DIR]);
      return stdout.split('\n').filter((line) => line !== '').length;
    });
  }

  /** Removes `.arbora/` from the index and keeps the files on disk; the next commit records it. */
  untrackArbora(): Promise<GitResult> {
    return this.command(['rm', '-r', '--cached', '--quiet', '--', ARBORA_DIR]);
  }

  remotes(): Promise<GitRemote[]> {
    return this.enqueue(async (env) => {
      const { stdout } = await runGit(this.options.root, env, ['remote', '-v']);
      const remotes = new Map<string, string>();
      for (const line of stdout.split('\n')) {
        const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line);
        if (match?.[1] && match[2]) remotes.set(match[1], match[2]);
      }
      return [...remotes].map(([name, fetch]) => ({ name, fetch }));
    });
  }

  private command(args: readonly string[]): Promise<GitResult> {
    return this.enqueue(async (env) => {
      try {
        const { stdout, stderr } = await runGit(this.options.root, env, args);
        return { ok: true, output: (stdout || stderr).trim() };
      } catch (error) {
        return { ok: false, output: messageOf(error) };
      }
    });
  }

  private async show(env: NodeJS.ProcessEnv, rev: string, path: string): Promise<string> {
    const spec = rev === '' ? `:${path}` : `${rev}:${path}`;
    try {
      const { stdout } = await runGit(this.options.root, env, ['show', spec]);
      return stdout;
    } catch {
      return '';
    }
  }

  private enqueue<T>(fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => fn(await this.options.env()));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

async function readWorktree(root: string, path: string): Promise<string> {
  if (path === '' || isAbsolute(path) || path.split('/').includes('..')) return '';
  const full = resolve(root, path);
  if (relative(root, full).startsWith('..')) return '';
  try {
    return await readFile(full, 'utf8');
  } catch {
    return '';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
