import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { defaultSettings, loadSettings, SettingsMigrationError, type AppSettings } from '@arbora/shared';

type Listener = (settings: AppSettings) => void;

export function writeJsonAtomic(filePath: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameWithRetry(tmp, filePath);
  return text;
}

const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;

/**
 * Windows refuses to replace a file another process has open without delete sharing (antivirus,
 * the search indexer, an editor), which surfaces as a transient EPERM/EBUSY/EACCES.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
    }
  }
}

/**
 * User settings in a JSON file under `userData`. Hand edits are picked up by a directory watcher
 * (editors replace files atomically, which breaks a watcher on the file itself).
 */
export class SettingsStore {
  private settings: AppSettings;
  private lastWritten: string | undefined;
  private watcher: FSWatcher | undefined;
  private reloadTimer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<Listener>();
  warnings: readonly string[] = [];

  constructor(readonly filePath: string) {
    this.settings = this.read();
  }

  get(): AppSettings {
    return this.settings;
  }

  update(mutate: (current: AppSettings) => AppSettings): AppSettings {
    // A hand edit the debounced watcher has not applied yet would otherwise be overwritten.
    this.reloadFromDisk();
    this.settings = mutate(this.settings);
    this.lastWritten = writeJsonAtomic(this.filePath, this.settings);
    this.emit();
    return this.settings;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ensures the file exists on disk so it can be opened in an editor. */
  ensureFile(): void {
    this.lastWritten = writeJsonAtomic(this.filePath, this.settings);
  }

  watch(): void {
    if (this.watcher) return;
    const dir = dirname(this.filePath);
    const name = basename(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.watcher = watch(dir, (_event, filename) => {
      if (filename !== name) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reloadFromDisk(), 100);
    });
  }

  reloadFromDisk(): void {
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch {
      return;
    }
    if (text === this.lastWritten) return;
    try {
      const { settings, warnings } = loadSettings(JSON.parse(text));
      this.settings = settings;
      this.warnings = warnings;
      this.emit();
    } catch (error) {
      // Mid-edit invalid JSON: keep the last good settings until the file parses again.
      this.warnings = [`settings.json could not be read: ${(error as Error).message}`];
    }
  }

  dispose(): void {
    clearTimeout(this.reloadTimer);
    this.watcher?.close();
    this.watcher = undefined;
    this.listeners.clear();
  }

  private read(): AppSettings {
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch {
      return defaultSettings();
    }
    try {
      const { settings, warnings } = loadSettings(JSON.parse(text));
      this.warnings = warnings;
      this.lastWritten = text;
      return settings;
    } catch (error) {
      const reason =
        error instanceof SettingsMigrationError ? error.message : `invalid JSON (${(error as Error).message})`;
      // Keep the unreadable file for the user instead of overwriting it on the next save.
      try {
        renameSync(this.filePath, `${this.filePath}.${Date.now()}.bak`);
      } catch {
        // Best effort.
      }
      this.warnings = [`settings.json was reset to defaults: ${reason}; the old file was kept as a .bak`];
      return defaultSettings();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.settings);
  }
}
