import { join, relative, sep } from 'node:path';
import { watch, type ChokidarOptions, type FSWatcher } from 'chokidar';
import type { FileChange, FileChangeType } from '@arbora/shared';
import type { IgnoreRules } from './ignore-rules.js';

const COALESCE_MS = 75;
const POLL_INTERVAL_MS = 1000;
const LIMIT_CODES = new Set(['ENOSPC', 'EMFILE']);
/** Folders the user cannot read (other users' files under the project) are skipped quietly. */
const QUIET_CODES = new Set(['EACCES', 'EPERM']);

export const INOTIFY_HINT =
  'The file watcher hit the system limit, so only folders open in the explorer are watched (polling). ' +
  'On Linux, raise fs.inotify.max_user_watches (for example `sudo sysctl fs.inotify.max_user_watches=524288`).';

export interface ProjectWatcherOptions {
  readonly root: string;
  readonly rules: IgnoreRules;
  onChanges(changes: FileChange[]): void;
  onWarning(message: string): void;
  /** Injected in tests. */
  readonly watchFn?: (paths: string | string[], options: ChokidarOptions) => FSWatcher;
  readonly coalesceMs?: number;
}

/** Merges a new event into the pending one for the same path. */
export function mergeChange(previous: FileChangeType | undefined, next: FileChangeType): FileChangeType {
  if (previous === 'add' && next === 'change') return 'add';
  return next;
}

/**
 * Watches the project with chokidar, skipping ignored paths, and reports coalesced batches. When
 * the OS watch limit is hit it falls back to polling only the folders the explorer has opened.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null;
  private polling = false;
  private readonly pending = new Map<string, FileChangeType>();
  private timer: NodeJS.Timeout | undefined;
  private readonly openedDirs = new Set<string>(['']);
  private disposed = false;

  constructor(private readonly options: ProjectWatcherOptions) {}

  start(): void {
    this.watcher = this.create(this.options.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path, stats) => this.isIgnored(path, stats?.isDirectory()),
    });
  }

  /** The explorer listed this folder; in polling mode it starts being polled. */
  noteOpenedDir(path: string): void {
    if (this.openedDirs.has(path)) return;
    this.openedDirs.add(path);
    if (this.polling) this.watcher?.add(join(this.options.root, path));
  }

  get isPolling(): boolean {
    return this.polling;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    clearTimeout(this.timer);
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }

  private create(paths: string | string[], options: ChokidarOptions): FSWatcher {
    const watcher = (this.options.watchFn ?? watch)(paths, options);
    watcher.on('all', (event, path) => {
      if (isChangeType(event)) this.record(event, path);
    });
    watcher.on('error', (error) => this.onError(error));
    return watcher;
  }

  private isIgnored(path: string, isDir: boolean | undefined): boolean {
    const rel = this.relativePath(path);
    if (rel === null) return true;
    // Without stats the kind is unknown; ignore only what is ignored either way, and decide again
    // when chokidar asks with stats.
    if (isDir === undefined) return this.options.rules.ignores(rel, false) && this.options.rules.ignores(rel, true);
    return this.options.rules.ignores(rel, isDir);
  }

  private relativePath(path: string): string | null {
    const rel = relative(this.options.root, path);
    if (rel.startsWith('..')) return null;
    return rel.split(sep).join('/');
  }

  private record(type: FileChangeType, absolute: string): void {
    const path = this.relativePath(absolute);
    if (path === null || path === '') return;
    if (path === '.gitignore' || path.endsWith('/.gitignore')) this.options.rules.invalidate();
    this.pending.set(path, mergeChange(this.pending.get(path), type));
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.options.coalesceMs ?? COALESCE_MS);
    }
  }

  private flush(): void {
    this.timer = undefined;
    if (this.disposed || this.pending.size === 0) return;
    const changes = [...this.pending.entries()].map(([path, type]) => ({ path, type }));
    this.pending.clear();
    this.options.onChanges(changes);
  }

  private onError(error: unknown): void {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && QUIET_CODES.has(code)) return;
    if (!code || !LIMIT_CODES.has(code) || this.polling || this.disposed) {
      console.warn(`[watcher] ${(error as Error).message}`);
      return;
    }
    this.polling = true;
    const previous = this.watcher;
    void previous?.close();
    this.watcher = this.create(
      [...this.openedDirs].map((dir) => join(this.options.root, dir)),
      {
        ignoreInitial: true,
        followSymlinks: false,
        backend: 'polling',
        pollingInterval: POLL_INTERVAL_MS,
        depth: 0,
        ignored: (path, stats) => this.isIgnored(path, stats?.isDirectory()),
      },
    );
    this.options.onWarning(INOTIFY_HINT);
  }
}

function isChangeType(event: string): event is FileChangeType {
  return event === 'add' || event === 'addDir' || event === 'change' || event === 'unlink' || event === 'unlinkDir';
}
