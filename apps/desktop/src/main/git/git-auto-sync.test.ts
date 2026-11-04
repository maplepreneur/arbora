import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitSettings, GitStatus, GitSyncResult } from '@arbora/shared';
import { GitAutoSync, type SyncableGit } from './git-auto-sync.js';

const behind: GitStatus = {
  repo: true,
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 1,
  files: [],
};

function fakeGit(status: GitStatus = behind, remotes = ['origin']) {
  const calls: string[] = [];
  const git: SyncableGit = {
    remotes: () => Promise.resolve(remotes.map((name) => ({ name }))),
    fetch: () => {
      calls.push('fetch');
      return Promise.resolve({ ok: true, output: '' });
    },
    status: () => Promise.resolve(status),
    pullFastForward: () => {
      calls.push('pull');
      return Promise.resolve({ ok: true, output: '' });
    },
  };
  return { git, calls };
}

describe('GitAutoSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches on the cadence and fast-forwards only in pull mode', async () => {
    vi.useFakeTimers();
    const settings: GitSettings = { autoSync: 'fetch', autoSyncMinutes: 2 };
    const { git, calls } = fakeGit();
    const results: GitSyncResult[] = [];
    const sync = new GitAutoSync({ git, settings: () => settings, onSynced: (r) => results.push(r), now: () => 1 });
    sync.start(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['fetch']);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(calls).toEqual(['fetch', 'fetch']);

    settings.autoSync = 'pull';
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(calls).toEqual(['fetch', 'fetch', 'fetch', 'pull']);
    expect(results.at(-1)).toEqual({ at: 1, pulled: true });

    settings.autoSync = 'off';
    sync.reschedule();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(4);
    sync.dispose();
  });

  it('does not pull over local changes and skips repositories without remotes', async () => {
    const dirty = fakeGit({
      ...behind,
      files: [{ path: 'a', index: '.', worktree: 'M', untracked: false, conflict: false }],
    });
    const settings = (): GitSettings => ({ autoSync: 'pull', autoSyncMinutes: 5 });
    expect(await new GitAutoSync({ git: dirty.git, settings, onSynced: () => undefined }).sync()).toMatchObject({
      pulled: false,
    });
    expect(dirty.calls).toEqual(['fetch']);

    const local = fakeGit(behind, []);
    expect(await new GitAutoSync({ git: local.git, settings, onSynced: () => undefined }).sync()).toBeNull();
    expect(local.calls).toEqual([]);
  });

  it('reports a failed fetch', async () => {
    const { git } = fakeGit();
    git.fetch = () => Promise.resolve({ ok: false, output: 'Permission denied (publickey)' });
    const sync = new GitAutoSync({
      git,
      settings: () => ({ autoSync: 'fetch', autoSyncMinutes: 5 }),
      onSynced: () => undefined,
      now: () => 7,
    });
    expect(await sync.sync()).toEqual({ at: 7, pulled: false, error: 'Permission denied (publickey)' });
  });
});
