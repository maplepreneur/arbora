import { realpath, stat } from 'node:fs/promises';
import type { WebContents } from 'electron';
import type { EventDef, OpenProjectResult, Platform } from '@arbora/shared';
import type { z } from 'zod';
import { ProjectWindow } from './project-window';
import type { SettingsService } from './settings-service';
import type { ThemeService } from './theme-service';

export interface WindowManagerOptions {
  readonly platform: Platform;
  readonly preloadPath: string;
  readonly settings: SettingsService;
  readonly theme: ThemeService;
  readonly loadRenderer: (window: ProjectWindow) => Promise<void>;
}

const BACKGROUND = { dark: '#0e1013', light: '#ffffff' } as const;

/** One window per project, plus welcome windows that turn into a project window when one is opened. */
export class WindowManager {
  readonly #options: WindowManagerOptions;
  readonly #windows = new Set<ProjectWindow>();

  constructor(options: WindowManagerOptions) {
    this.#options = options;
  }

  get windows(): readonly ProjectWindow[] {
    return [...this.#windows];
  }

  fromWebContents(contents: WebContents): ProjectWindow | undefined {
    return this.windows.find((entry) => entry.window.webContents === contents);
  }

  openWelcome(): ProjectWindow {
    const existing = this.windows.find((entry) => entry.project === undefined);
    if (existing) {
      focus(existing);
      return existing;
    }
    return this.#create(undefined);
  }

  /**
   * Opens a project folder. Focuses the window that already has it; otherwise reuses the
   * requesting welcome window or creates a new one.
   */
  async openProject(rawPath: string, requester?: ProjectWindow): Promise<OpenProjectResult> {
    let path: string;
    try {
      path = await realpath(rawPath);
      if (!(await stat(path)).isDirectory()) {
        return { status: 'error', message: `Not a folder: ${rawPath}` };
      }
    } catch {
      return { status: 'error', message: `Folder not found: ${rawPath}` };
    }

    const existing = this.windows.find((entry) => entry.project?.path === path);
    if (existing) {
      focus(existing);
      return { status: 'focused', path };
    }

    const target = requester && requester.project === undefined ? requester : this.#create(path);
    target.setProject(path);
    focus(target);
    await this.#options.settings.addRecentProject(path, target.project?.name ?? path);
    return { status: 'opened', path };
  }

  broadcast<E extends EventDef>(event: E, payload: z.input<E['payload']>): void {
    for (const entry of this.#windows) entry.send(event, payload);
  }

  #create(projectPath: string | undefined): ProjectWindow {
    const { platform, preloadPath, settings, theme } = this.#options;
    const entry = new ProjectWindow({
      platform,
      preloadPath,
      settings,
      backgroundColor: BACKGROUND[theme.state.resolved],
      bounds:
        projectPath === undefined ? undefined : settings.projectUiState(projectPath).windowBounds,
    });
    this.#windows.add(entry);
    entry.window.once('ready-to-show', () => {
      entry.window.show();
    });
    entry.window.on('close', () => {
      entry.saveBounds();
    });
    entry.window.on('closed', () => {
      entry.dispose();
      this.#windows.delete(entry);
    });
    void this.#options.loadRenderer(entry);
    return entry;
  }

  dispose(): void {
    for (const entry of this.#windows) entry.dispose();
    this.#windows.clear();
  }
}

function focus(entry: ProjectWindow): void {
  if (entry.window.isMinimized()) entry.window.restore();
  entry.window.show();
  entry.window.focus();
}
