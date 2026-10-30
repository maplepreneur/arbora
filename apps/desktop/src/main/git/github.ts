import { execFile } from 'node:child_process';
import type { GithubAuth, GithubCheck, GithubPr } from '@arbora/shared';

/** GitHub through the `gh` CLI. There is no OAuth client id in the app, so device flow is not offered. */

export async function githubAuth(env: NodeJS.ProcessEnv): Promise<GithubAuth> {
  try {
    const stdout = await gh(env, undefined, ['api', 'user', '--jq', '.login']);
    const login = stdout.trim();
    return { available: true, login: login || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found/i.test(message)) return { available: false, login: null, error: 'gh is not installed' };
    return { available: false, login: null, error: message.trim() };
  }
}

export async function listPullRequests(root: string, env: NodeJS.ProcessEnv): Promise<GithubPr[]> {
  const stdout = await gh(env, root, [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,title,url,state,headRefName',
    '--limit',
    '30',
  ]);
  return parsePrs(stdout);
}

export function parsePrs(json: string): GithubPr[] {
  const rows = JSON.parse(json) as {
    number: number;
    title: string;
    url: string;
    state: string;
    headRefName: string;
  }[];
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    url: row.url,
    state: row.state,
    head: row.headRefName,
  }));
}

export async function createPullRequest(
  root: string,
  env: NodeJS.ProcessEnv,
  title: string,
  body: string,
): Promise<string> {
  return (await gh(env, root, ['pr', 'create', '--title', title, '--body', body])).trim();
}

export async function pullRequestChecks(root: string, env: NodeJS.ProcessEnv, number: number): Promise<GithubCheck[]> {
  const stdout = await gh(env, root, ['pr', 'view', String(number), '--json', 'statusCheckRollup']);
  const parsed = JSON.parse(stdout) as {
    statusCheckRollup?: { name?: string; status?: string; conclusion?: string | null }[];
  };
  return (parsed.statusCheckRollup ?? []).map((check) => ({
    name: check.name ?? 'check',
    status: check.status ?? '',
    conclusion: check.conclusion ?? null,
  }));
}

function gh(env: NodeJS.ProcessEnv, cwd: string | undefined, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      },
    );
  });
}
