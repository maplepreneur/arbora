import { watch, readFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  addRecentProject,
  appSettingsMigrations,
  appSettingsSchema,
  appStateMigrations,
  appStateSchema,
  APP_SETTINGS_VERSION,
  APP_STATE_VERSION,
  type AppSettings,
  type AppSettingsPatch,
  type AppState,
  type PanelLayout,
  type ProjectUiState,
  type RecentProject,
  type WindowBounds,
} from '@arbora/shared';
import { VersionedJsonFile } from './json-file';

type Listener = (settings: AppSettings) => void;

const RELOAD_DEBOUNCE_MS = 100;

/**
 * Owns `settings.json` (user-editable preferences, reloaded when edited by hand) and `state.json`
 * (recents, per-project layout and window bounds) under the userData directory.
 */
export class SettingsService {
  readonly #settingsFile: VersionedJsonFile<AppSettings>;
  readonly #stateFile: VersionedJsonFile<AppState>;
  readonly #listeners = new Set<Listener>();
  #settings: AppSettings;
  #settingsWritable: boolean;
  #state: AppState;
  #stateWritable: boolean;
  #watcher: FSWatcher | undefined;
  #reloadTimer: NodeJS.Timeout | undefined;

  constructor(userDataDir: string) {
    this.#settingsFile = new VersionedJsonFile({
      path: join(userDataDir, 'settings.json'),
      version: APP_SETTINGS_VERSION,
      schema: appSettingsSchema,
      migrations: appSettingsMigrations,
    });
    this.#stateFile = new VersionedJsonFile({
      path: join(userDataDir, 'state.json'),
      version: APP_STATE_VERSION,
      schema: appStateSchema,
      migrations: appStateMigrations,
    });
    const settings = this.#settingsFile.load();
    this.#settings = settings.value;
    this.#settingsWritable = settings.writable;
    if (settings.status === 'migrated') void this.#settingsFile.write(settings.value);
    const state = this.#stateFile.load();
    this.#state = state.value;
    this.#stateWritable = state.writable;
  }

  get settingsPath(): string {
    return this.#settingsFile.path;
  }

  get settings(): AppSettings {
    return this.#settings;
  }

  onDidChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async update(patch: AppSettingsPatch): Promise<AppSettings> {
    const next = appSettingsSchema.parse({ ...this.#settings, ...stripUndefined(patch) });
    this.#apply(next);
    if (this.#settingsWritable) await this.#settingsFile.write(next);
    return next;
  }

  /** Makes sure the settings file exists on disk so it can be opened in an editor. */
  async ensureSettingsFile(): Promise<string> {
    if (this.#settingsFile.load().status === 'missing') {
      await this.#settingsFile.write(this.#settings);
    }
    return this.#settingsFile.path;
  }

  /** Reloads `settings.json` whenever it is edited outside Arbora. */
  watch(): void {
    if (this.#watcher) return;
    const file = this.#settingsFile.path;
    try {
      this.#watcher = watch(dirname(file), (_event, filename) => {
        if (filename !== null && filename !== basename(file)) return;
        clearTimeout(this.#reloadTimer);
        this.#reloadTimer = setTimeout(() => {
          this.#reloadFromDisk();
        }, RELOAD_DEBOUNCE_MS);
      });
    } catch (error) {
      console.warn('[arbora] cannot watch settings file', error);
    }
  }

  #reloadFromDisk(): void {
    let text: string;
    try {
      text = readFileSync(this.#settingsFile.path, 'utf8');
    } catch {
      return;
    }
    if (this.#settingsFile.isOwnWrite(text)) return;
    const result = this.#settingsFile.load();
    this.#settingsWritable = result.writable;
    if (result.status === 'invalid-json' || result.status === 'too-new') {
      console.warn(`[arbora] ignoring settings.json (${result.status}); keeping previous values`);
      return;
    }
    this.#apply(result.value);
  }

  #apply(next: AppSettings): void {
    if (JSON.stringify(next) === JSON.stringify(this.#settings)) return;
    this.#settings = next;
    for (const listener of this.#listeners) listener(next);
  }

  get recentProjects(): readonly RecentProject[] {
    return this.#state.recentProjects;
  }

  async addRecentProject(path: string, name: string): Promise<void> {
    await this.#updateState({
      ...this.#state,
      recentProjects: addRecentProject(this.#state.recentProjects, {
        path,
        name,
        lastOpenedAt: Date.now(),
      }),
    });
  }

  async removeRecentProject(path: string): Promise<readonly RecentProject[]> {
    await this.#updateState({
      ...this.#state,
      recentProjects: this.#state.recentProjects.filter((recent) => recent.path !== path),
    });
    return this.#state.recentProjects;
  }

  projectUiState(projectPath: string): ProjectUiState {
    return this.#state.projects[projectPath] ?? {};
  }

  setProjectLayout(projectPath: string, layout: PanelLayout): Promise<void> {
    return this.#updateProject(projectPath, { layout });
  }

  setProjectWindowBounds(projectPath: string, windowBounds: WindowBounds): Promise<void> {
    return this.#updateProject(projectPath, { windowBounds });
  }

  #updateProject(projectPath: string, patch: ProjectUiState): Promise<void> {
    return this.#updateState({
      ...this.#state,
      projects: {
        ...this.#state.projects,
        [projectPath]: { ...this.projectUiState(projectPath), ...patch },
      },
    });
  }

  async #updateState(next: AppState): Promise<void> {
    this.#state = next;
    if (this.#stateWritable) await this.#stateFile.write(next);
  }

  async dispose(): Promise<void> {
    clearTimeout(this.#reloadTimer);
    this.#watcher?.close();
    this.#watcher = undefined;
    this.#listeners.clear();
    await Promise.all([this.#settingsFile.flush(), this.#stateFile.flush()]);
  }
}

export function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
