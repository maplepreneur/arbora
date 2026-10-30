import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChokidarOptions, FSWatcher } from 'chokidar';
import { IgnoreRules } from './ignore-rules.js';
import { INOTIFY_HINT, mergeChange, ProjectWatcher } from './watcher.js';

class FakeWatcher extends EventEmitter {
  readonly added: string[] = [];
  closed = false;
  constructor(
    readonly paths: string | string[],
    readonly options: ChokidarOptions,
  ) {
    super();
  }
  add(path: string): this {
    this.added.push(path);
    return this;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function setup() {
  const root = '/project';
  const watchers: FakeWatcher[] = [];
  const changes: unknown[] = [];
  const warnings: string[] = [];
  const watcher = new ProjectWatcher({
    root,
    rules: new IgnoreRules(root),
    onChanges: (batch) => changes.push(...batch),
    onWarning: (message) => warnings.push(message),
    coalesceMs: 5,
    watchFn: (paths, options) => {
      const fake = new FakeWatcher(paths, options);
      watchers.push(fake);
      return fake as unknown as FSWatcher;
    },
  });
  watcher.start();
  return { root, watcher, watchers, changes, warnings };
}

describe('mergeChange', () => {
  it('keeps add when a new file is then written', () => {
    expect(mergeChange('add', 'change')).toBe('add');
    expect(mergeChange('change', 'unlink')).toBe('unlink');
    expect(mergeChange(undefined, 'addDir')).toBe('addDir');
  });
});

describe('ProjectWatcher', () => {
  it('coalesces events into project-relative batches and skips ignored paths', async () => {
    const { root, watchers, changes } = setup();
    const ignored = watchers[0]?.options.ignored as (path: string, stats?: { isDirectory(): boolean }) => boolean;
    expect(ignored(join(root, 'node_modules'), { isDirectory: () => true })).toBe(true);
    expect(ignored(join(root, 'src'), { isDirectory: () => true })).toBe(false);
    expect(ignored('/elsewhere/file.ts')).toBe(true);

    watchers[0]?.emit('all', 'add', join(root, 'src/a.ts'));
    watchers[0]?.emit('all', 'change', join(root, 'src/a.ts'));
    watchers[0]?.emit('all', 'unlinkDir', join(root, 'old'));
    watchers[0]?.emit('all', 'raw', join(root, 'x'));
    await vi.waitFor(() =>
      expect(changes).toEqual([
        { path: 'src/a.ts', type: 'add' },
        { path: 'old', type: 'unlinkDir' },
      ]),
    );
  });

  it('falls back to polling the opened folders when the watch limit is hit', () => {
    const { root, watcher, watchers, warnings } = setup();
    watcher.noteOpenedDir('src');
    watchers[0]?.emit('error', Object.assign(new Error('watch limit'), { code: 'ENOSPC' }));
    expect(watcher.isPolling).toBe(true);
    expect(watchers[0]?.closed).toBe(true);
    expect(warnings).toEqual([INOTIFY_HINT]);
    const polling = watchers[1];
    expect(polling?.paths).toEqual([root, join(root, 'src')]);
    expect(polling?.options).toMatchObject({ backend: 'polling', depth: 0 });
    // Folders opened later are polled too.
    watcher.noteOpenedDir('src/components');
    expect(polling?.added).toEqual([join(root, 'src/components')]);
  });

  it('ignores other errors', () => {
    const { watcher, watchers, warnings } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    watchers[0]?.emit('error', Object.assign(new Error('nope'), { code: 'EACCES' }));
    expect(watcher.isPolling).toBe(false);
    expect(warnings).toEqual([]);
    warn.mockRestore();
  });
});
