import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@arbora/shared';
import { SettingsStore } from '../settings-store.js';
import {
  createGroveWorktree,
  discardGroveWorktree,
  groveWithoutWorktree,
  installGroveWorktree,
  keepGroveWorktree,
  pullRequestGroveWorktree,
  type WorktreeHost,
} from './worktree-session.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      },
      (error) => (error ? reject(new Error(error.message)) : resolve()),
    );
  });
}

async function repo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'arbora-worktree-'));
  roots.push(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 't@t']);
  await git(root, ['config', 'user.name', 't']);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', private: true, packageManager: 'pnpm@10.0.0', scripts: { dev: 'vite' } }),
  );
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'marker.txt'), 'shared\n');
  mkdirSync(join(root, '.arbora'));
  writeFileSync(
    join(root, '.arbora', 'project.json'),
    JSON.stringify({ version: 1, devCommand: 'pnpm dev', devUrl: 'http://127.0.0.1:5173/' }),
  );
  await git(root, ['add', 'package.json']);
  await git(root, ['commit', '-m', 'init']);
  return root;
}

function host(): WorktreeHost & { threads: { agentId: string; title: string | undefined }[] } {
  const threads: { agentId: string; title: string | undefined }[] = [];
  return {
    threads,
    syncGroveProjects() {},
    runtime() {
      return {
        agents: {
          createThread(agentId, options) {
            const id = `t${threads.length + 1}`;
            threads.push({ agentId, title: options.title });
            return { id };
          },
        },
      };
    },
  };
}

describe('grove worktree sessions', () => {
  it('drops a best-of set once a single candidate is left', () => {
    const grove = {
      ...defaultSettings().grove,
      projects: [
        { path: '/a', collapsed: false, parentPath: '/p' },
        { path: '/b', collapsed: false, parentPath: '/p' },
      ],
      bestOf: [
        {
          id: '1',
          parentPath: '/p',
          task: 'Fix',
          candidates: [
            { path: '/a', threadId: 't1', agentId: 'one', branch: 'a' },
            { path: '/b', threadId: 't2', agentId: 'two', branch: 'b' },
          ],
        },
      ],
    };
    const next = groveWithoutWorktree(grove, '/a');
    expect(next.projects.map((project) => project.path)).toEqual(['/b']);
    expect(next.bestOf).toEqual([]);
  });

  it('gives each agent its own port, links node_modules, and keeps one', async () => {
    const parent = await repo();
    const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'arbora-worktree-settings-')), 'settings.json'));
    roots.push(join(settings.filePath, '..'));
    const runtime = host();
    const created = await createGroveWorktree({
      parentPath: parent,
      title: 'Fix the nav',
      agentId: 'one',
      also: [{ agentId: 'two' }],
      windowProject: parent,
      settings,
      host: runtime,
      env: () => Promise.resolve(process.env),
      focus: () => undefined,
    });
    expect(created.error).toBeUndefined();
    const candidates = created.candidates ?? [];
    expect(candidates.map((candidate) => candidate.agentId)).toEqual(['one', 'two']);
    for (const candidate of candidates) roots.push(candidate.path);
    expect(created.port).toBe(5174);
    expect(created.devUrl).toBe('http://127.0.0.1:5174/');
    expect(created.modules).toBe('linked');
    const second = candidates[1];
    if (!second) throw new Error('missing second worktree');
    expect(settings.get().grove.projects.find((project) => project.path === second.path)?.port).toBe(5175);
    expect(lstatSync(join(created.path ?? '', 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(created.path ?? '', 'node_modules', 'marker.txt'), 'utf8')).toBe('shared\n');
    const projectFile = JSON.parse(readFileSync(join(created.path ?? '', '.arbora', 'project.json'), 'utf8')) as {
      devCommand: string;
      devUrl: string;
    };
    expect(projectFile).toMatchObject({ devCommand: 'pnpm dev -- --port 5174', devUrl: 'http://127.0.0.1:5174/' });
    expect(settings.get().projects[created.path ?? '']?.browser?.lastUrl).toBe('http://127.0.0.1:5174/');
    expect(settings.get().grove.bestOf).toHaveLength(1);
    expect(runtime.threads.map((thread) => thread.agentId)).toEqual(['one', 'two']);

    writeFileSync(join(created.path ?? '', 'added.txt'), 'from the worktree\n');
    await git(created.path ?? '', ['add', 'added.txt']);
    await git(created.path ?? '', ['commit', '-m', 'add']);
    const kept = await keepGroveWorktree({
      path: created.path ?? '',
      settings,
      env: () => Promise.resolve(process.env),
      sync: () => undefined,
    });
    expect(kept.ok).toBe(true);
    expect(kept.discarded).toEqual([second.path]);
    expect(existsSync(second.path)).toBe(false);
    expect(readFileSync(join(parent, 'added.txt'), 'utf8')).toBe('from the worktree\n');
    expect(settings.get().grove.bestOf).toEqual([]);
    expect(settings.get().grove.projects.some((project) => project.path === created.path)).toBe(true);

    const request = await pullRequestGroveWorktree({
      path: created.path ?? '',
      title: 'Fix the nav',
      body: 'body',
      settings,
      env: () => Promise.resolve(process.env),
    });
    expect(request.error).toMatch(/remote/i);

    const installed = await installGroveWorktree({
      path: created.path ?? '',
      settings,
      createTerminal: (command) => Promise.resolve({ id: `term-${command}` }),
    });
    expect(installed.command).toBe('pnpm install');
    expect(installed.terminalId).toBe('term-pnpm install');
    expect(existsSync(join(created.path ?? '', 'node_modules'))).toBe(false);
    expect(settings.get().grove.projects.find((project) => project.path === created.path)?.modules).toBe('own');

    const discarded = await discardGroveWorktree({
      path: created.path ?? '',
      settings,
      env: () => Promise.resolve(process.env),
      sync: () => undefined,
    });
    expect(discarded.ok).toBe(true);
    expect(discarded.parentPath).toBe(parent);
    expect(existsSync(created.path ?? '')).toBe(false);
    expect(settings.get().grove.projects).toEqual([]);
  });

  it('refuses a folder that is not a git repository', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'arbora-worktree-plain-'));
    roots.push(parent);
    const settings = new SettingsStore(join(parent, 'settings.json'));
    const created = await createGroveWorktree({
      parentPath: parent,
      title: 'Fix the nav',
      agentId: 'one',
      windowProject: parent,
      settings,
      host: host(),
      env: () => Promise.resolve(process.env),
      focus: () => undefined,
    });
    expect(created.error).toBe('This folder is not a git repository');
    expect(created.path).toBeUndefined();
  });
});
