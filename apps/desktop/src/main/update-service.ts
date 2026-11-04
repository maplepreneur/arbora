import { net } from 'electron';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import {
  canSelfUpdate,
  manualUpdateHint,
  pickRelease,
  releaseNotesText,
  releasePageUrl,
  UPDATE_REPOSITORY,
  type GithubRelease,
  type InstallKind,
  type ReleaseChannel,
  type UpdatePolicy,
  type UpdateSettings,
  type UpdateState,
} from '@arbora/shared';
import { loadAutoUpdater } from './lazy/updater.js';

export interface UpdateServiceOptions {
  readonly kind: InstallKind;
  /** macOS: signed with a Developer ID team. Ignored elsewhere. */
  readonly macSigned: boolean;
  readonly version: string;
  readonly settings: () => UpdateSettings;
  /** Re-read on every check, so switching to the Development channel applies at once. */
  readonly policy: () => UpdatePolicy;
  readonly emit: (state: UpdateState) => void;
}

const STARTUP_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * GitHub Releases updates. macOS, Windows and AppImage go through electron-updater, which downloads
 * and installs in place. A `.deb`, the AUR package and the tarball only learn that a newer release
 * exists, with what to run (see the Stage 9 gotchas). `updatePolicy` decides whether any of this
 * runs: never for unpackaged or local builds, nor on the Development channel.
 */
export class UpdateService {
  private state: UpdateState;
  private updater: AppUpdater | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly options: UpdateServiceOptions) {
    const policy = options.policy();
    this.state = policy.enabled ? { status: 'idle' } : { status: 'off', reason: policy.reason };
  }

  get kind(): InstallKind {
    return this.options.kind;
  }

  get selfUpdates(): boolean {
    return canSelfUpdate(this.options.kind, this.options.macSigned);
  }

  current(): UpdateState {
    return this.state;
  }

  start(): void {
    if (this.options.kind === 'dev') return;
    const tick = (): void => {
      if (this.options.policy().enabled && this.options.settings().autoCheck) void this.check();
    };
    this.timers.push(setTimeout(tick, STARTUP_CHECK_DELAY_MS), setInterval(tick, CHECK_INTERVAL_MS));
  }

  /** Call when settings change: turning updates off also stops a downloaded update installing on quit. */
  refresh(): void {
    const policy = this.options.policy();
    if (this.updater) this.updater.autoInstallOnAppQuit = policy.enabled;
    if (!policy.enabled) {
      if (this.state.status !== 'off' || this.state.reason !== policy.reason) {
        this.set({ status: 'off', reason: policy.reason });
      }
    } else if (this.state.status === 'off') {
      this.set({ status: 'idle' });
    }
  }

  async check(): Promise<UpdateState> {
    const policy = this.options.policy();
    if (!policy.enabled) {
      this.set({ status: 'off', reason: policy.reason });
      return this.state;
    }
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking' });
    try {
      if (this.selfUpdates) await (await this.selfUpdater(policy.channel)).checkForUpdates();
      else await this.checkManually(policy.channel);
    } catch (error) {
      this.set({ status: 'error', message: (error as Error).message });
    }
    return this.state;
  }

  async download(): Promise<void> {
    const policy = this.options.policy();
    if (!policy.enabled || !this.selfUpdates || this.state.status !== 'available') return;
    await (await this.selfUpdater(policy.channel)).downloadUpdate();
  }

  install(): void {
    if (this.options.policy().enabled && this.state.status === 'ready') this.updater?.quitAndInstall();
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.options.emit(state);
  }

  private async selfUpdater(channel: ReleaseChannel): Promise<AppUpdater> {
    const settings = this.options.settings();
    if (!this.updater) {
      // The getter picks the platform updater (Mac, NSIS, AppImage) on first access.
      const updater = await loadAutoUpdater();
      updater.logger = null;
      updater.on('update-available', (info: UpdateInfo) => {
        this.set({
          status: 'available',
          version: info.version,
          notes: releaseNotesText(info.releaseNotes),
          releaseUrl: releasePageUrl(info.version),
          manualHint: null,
        });
      });
      updater.on('update-not-available', () => this.set({ status: 'current', checkedAt: Date.now() }));
      updater.on('download-progress', (progress: ProgressInfo) => {
        const version =
          this.state.status === 'available' || this.state.status === 'downloading' ? this.state.version : '';
        this.set({ status: 'downloading', version, percent: Math.round(progress.percent) });
      });
      updater.on('update-downloaded', (info: UpdateInfo) => {
        this.set({ status: 'ready', version: info.version, notes: releaseNotesText(info.releaseNotes) });
      });
      updater.on('error', (error: Error) => this.set({ status: 'error', message: error.message }));
      this.updater = updater;
    }
    this.updater.channel = channel;
    this.updater.allowPrerelease = channel === 'beta';
    // Setting `channel` turns downgrades on. Leaving Beta waits for the next stable release instead
    // of installing an older one, like `pickRelease` does for installs that update by hand.
    this.updater.allowDowngrade = false;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.autoDownload = settings.autoDownload;
    return this.updater;
  }

  private async checkManually(channel: ReleaseChannel): Promise<void> {
    const { owner, repo } = UPDATE_REPOSITORY;
    const response = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];
    const release = pickRelease(releases, this.options.version, channel);
    if (!release) {
      this.set({ status: 'current', checkedAt: Date.now() });
      return;
    }
    const version = release.tag_name.replace(/^v/, '');
    this.set({
      status: 'available',
      version,
      notes: releaseNotesText(release.body ?? ''),
      releaseUrl: release.html_url ?? releasePageUrl(version),
      manualHint: manualUpdateHint(this.options.kind, version),
    });
  }
}
