import { execFile } from 'node:child_process';

export class GitError extends Error {}

export interface GitRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Spawns `git` with a non-interactive, stable locale. Exit codes in `ok` resolve instead of throwing. */
export function runGit(
  root: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  options: { input?: string; ok?: readonly number[] } = {},
): Promise<GitRun> {
  const ok = new Set(options.ok ?? [0]);
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd: root,
        env: { ...env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' },
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = exitCode(error);
        if (error && !ok.has(code)) {
          const message = stderr.trim() || error.message;
          reject(new GitError(message));
          return;
        }
        resolve({ stdout, stderr, code });
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

function exitCode(error: Error | null): number {
  if (!error) return 0;
  const code = (error as { code?: number | string }).code;
  return typeof code === 'number' ? code : 1;
}
