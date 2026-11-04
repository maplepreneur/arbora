import { shouldAutoPull, type GitResult, type GitSettings, type GitStatus, type GitSyncResult } from '@arbora/shared';

export interface SyncableGit {
  remotes(): Promise<readonly { name: string }[]>;
  fetch(): Promise<GitResult>;
  status(): Promise<GitStatus>;
  pullFastForward(): Promise<GitResult>;
}

export interface GitAutoSyncOptions {
  readonly git: SyncableGit;
  readonly settings: () => GitSettings;
  readonly onSynced: (result: GitSyncResult) => void;
  readonly now?: () => number;
}

/** First run shortly after a project opens, so opening is not slowed by the network. */
const FIRST_DELAY_MS = 15_000;

/**
 * Fetches the open project every `autoSyncMinutes`, and in `pull` mode fast-forwards a clean
 * branch that is only behind. A repository without remotes is left alone.
 */
export class GitAutoSync {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<GitSyncResult | null> | null = null;
  private disposed = false;

  constructor(private readonly options: GitAutoSyncOptions) {}

  start(delayMs = FIRST_DELAY_MS): void {
    this.schedule(delayMs);
  }

  /** Re-reads the cadence: call after settings change. */
  reschedule(): void {
    this.schedule(this.intervalMs());
  }

  /** One sync now (also what the timer runs); null when sync is off or there is no remote. */
  sync(): Promise<GitSyncResult | null> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    if (this.disposed || this.options.settings().autoSync === 'off') return;
    this.timer = setTimeout(() => {
      void this.sync().finally(() => this.schedule(this.intervalMs()));
    }, delayMs);
  }

  private intervalMs(): number {
    return this.options.settings().autoSyncMinutes * 60_000;
  }

  private async run(): Promise<GitSyncResult | null> {
    const mode = this.options.settings().autoSync;
    if (mode === 'off' || this.disposed) return null;
    const now = this.options.now ?? Date.now;
    try {
      if ((await this.options.git.remotes()).length === 0) return null;
      const fetched = await this.options.git.fetch();
      if (!fetched.ok) return this.report({ at: now(), pulled: false, error: fetched.output });
      let pulled = false;
      if (mode === 'pull' && shouldAutoPull(await this.options.git.status())) {
        const result = await this.options.git.pullFastForward();
        if (!result.ok) return this.report({ at: now(), pulled: false, error: result.output });
        pulled = true;
      }
      return this.report({ at: now(), pulled });
    } catch (error) {
      return this.report({ at: now(), pulled: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private report(result: GitSyncResult): GitSyncResult {
    if (!this.disposed) this.options.onSynced(result);
    return result;
  }
}
