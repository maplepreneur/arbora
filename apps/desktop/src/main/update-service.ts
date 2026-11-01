import { net } from 'electron';
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import {
  canSelfUpdate,
  manualUpdateHint,
  pickRelease,
  releaseNotesText,
  releasePageUrl,
  UPDATE_REPOSITORY,
  type GithubRelease,
  type InstallKind,
  type UpdateSettings,
  type UpdateState,
} from '@arbora/shared';

export interface UpdateServiceOptions {
  readonly kind: InstallKind;
  readonly version: string;
  readonly settings: () => UpdateSettings;
  readonly emit: (state: UpdateState) => void;
}

const STARTUP_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * GitHub Releases updates. macOS, Windows and AppImage go through electron-updater, which downloads
 * and installs in place. A `.deb`, the AUR package and the tarball only learn that a newer release
 * exists, with what to run (see the Stage 9 gotchas).
 */
export class UpdateService {
  private state: UpdateState = { status: 'idle' };
  private updater: AppUpdater | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly options: UpdateServiceOptions) {}

  get kind(): InstallKind {
    return this.options.kind;
  }

  current(): UpdateState {
    return this.state;
  }

  start(): void {
    if (this.options.kind === 'dev') return;
    const tick = (): void => {
      if (this.options.settings().autoCheck) void this.check();
    };
    this.timers.push(setTimeout(tick, STARTUP_CHECK_DELAY_MS), setInterval(tick, CHECK_INTERVAL_MS));
  }

  async check(): Promise<UpdateState> {
    if (this.options.kind === 'dev') {
      this.set({ status: 'error', message: 'Updates are off in development builds.' });
      return this.state;
    }
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking' });
    try {
      if (canSelfUpdate(this.options.kind)) await this.selfUpdater().checkForUpdates();
      else await this.checkManually();
    } catch (error) {
      this.set({ status: 'error', message: (error as Error).message });
    }
    return this.state;
  }

  async download(): Promise<void> {
    if (!canSelfUpdate(this.options.kind) || this.state.status !== 'available') return;
    await this.selfUpdater().downloadUpdate();
  }

  install(): void {
    if (this.state.status === 'ready') this.selfUpdater().quitAndInstall();
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.options.emit(state);
  }

  private selfUpdater(): AppUpdater {
    const settings = this.options.settings();
    if (!this.updater) {
      // The getter picks the platform updater (Mac, NSIS, AppImage) on first access.
      const updater = electronUpdater.autoUpdater;
      updater.logger = null;
      updater.autoInstallOnAppQuit = true;
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
    this.updater.channel = settings.channel;
    this.updater.allowPrerelease = settings.channel === 'beta';
    this.updater.autoDownload = settings.autoDownload;
    return this.updater;
  }

  private async checkManually(): Promise<void> {
    const { owner, repo } = UPDATE_REPOSITORY;
    const response = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];
    const release = pickRelease(releases, this.options.version, this.options.settings().channel);
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
