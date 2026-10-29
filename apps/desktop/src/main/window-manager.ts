import { realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import {
  addRecentProject,
  CommandId,
  DEFAULT_COMMANDS,
  KeybindingTable,
  resolveKeybindingSpecs,
  type KeybindingContext,
  type LayoutState,
  type BrowserHistoryEntry,
  type ProjectBrowserState,
  type Rect,
  type ViewportEmulation,
  type Platform,
  type ProjectInfo,
  type ProjectSettings,
  type WindowBounds,
  type WindowState,
} from '@arbora/shared';
import { BrowserHistory } from './browser/browser-history.js';
import { BrowserService } from './browser/browser-service.js';
import { browserPartition, type BrowserSessions } from './browser/browser-sessions.js';
import { sendEvent } from './ipc.js';
import { attachKeybindingInterceptor, type InterceptorSource } from './keybinding-interceptor.js';
import { readProjectSettings } from './project-settings.js';
import type { SettingsStore } from './settings-store.js';
import { shouldRestoreBounds } from './startup.js';
import type { ThemeService } from './theme-service.js';

export interface WindowManagerOptions {
  readonly platform: Platform;
  readonly tilingCompositor: string | null;
  readonly settings: SettingsStore;
  readonly theme: ThemeService;
  readonly preloadPath: string;
  readonly browserPreloadPath: string;
  readonly browserSessions: BrowserSessions;
  readonly userDataPath: string;
  /** Dev server URL in development, otherwise the built `index.html` path. */
  readonly renderer: { readonly url: string } | { readonly file: string };
}

interface OpenProject {
  readonly path: string;
  readonly name: string;
  settings: ProjectSettings;
  settingsWarnings: string[];
}

const DEFAULT_SIZE = { width: 1440, height: 900 };
/** Intercepted while the page has focus, these move keyboard focus to the app UI first. */
const FOCUS_APP_COMMANDS: ReadonlySet<string> = new Set([CommandId.commandPalette, CommandId.browserFocusUrl]);
const BOUNDS_SAVE_DELAY_MS = 500;

export class ProjectWindowError extends Error {}

/** Resolves and validates a folder path; returns its canonical form. */
export function resolveProjectPath(path: string): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new ProjectWindowError(`Folder not found: ${path}`);
  }
  if (!statSync(real).isDirectory()) {
    throw new ProjectWindowError(`Not a folder: ${path}`);
  }
  return real;
}

/** One `BrowserWindow`, showing either the welcome screen or a single project. */
export class ProjectWindow {
  readonly window: BrowserWindow;
  project: OpenProject | null = null;
  private context: Omit<KeybindingContext, 'terminalPassthrough'> = { modeActive: false, terminalFocused: false };
  private keybindings: KeybindingTable;
  private boundsTimer: NodeJS.Timeout | undefined;
  private readonly disposers: (() => void)[] = [];
  browser: BrowserService | null = null;
  private browserHistory: BrowserHistory | null = null;
  /** Bumped whenever the browser is (re)started or stopped, to drop stale async starts. */
  private browserGeneration = 0;
  private browserBounds: { rect: Rect | null; emulation: ViewportEmulation | null } = { rect: null, emulation: null };

  constructor(
    private readonly manager: WindowManager,
    private readonly options: WindowManagerOptions,
  ) {
    this.keybindings = this.buildKeybindings();
    this.window = new BrowserWindow(this.windowOptions());
    const contents = this.window.webContents;

    this.disposers.push(
      attachKeybindingInterceptor(
        contents,
        this.interceptorSource((commandId) => sendEvent(contents, 'command.invoke', { commandId })),
      ),
    );

    // The app renderer only ever shows its own UI; everything else opens in the OS browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (url !== contents.getURL()) event.preventDefault();
    });

    const sendState = (): void => sendEvent(contents, 'window.stateChanged', this.state());
    for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'blur'] as const) {
      this.window.on(name as 'maximize', sendState);
    }
    this.window.on('focus', () => {
      sendState();
      this.reloadProjectSettings();
    });
    this.window.on('resize', () => this.scheduleBoundsSave());
    this.window.on('move', () => this.scheduleBoundsSave());
    this.window.on('close', () => this.saveBounds());
    // The window title reflects the project; ignore the renderer's <title>.
    this.window.on('page-title-updated', (event) => event.preventDefault());
    this.window.once('ready-to-show', () => this.window.show());
    this.window.on('closed', () => this.dispose());

    if ('url' in options.renderer) void this.window.loadURL(options.renderer.url);
    else void this.window.loadFile(options.renderer.file);
  }

  get contents(): WebContents {
    return this.window.webContents;
  }

  state(): WindowState {
    return {
      maximized: this.window.isMaximized(),
      fullScreen: this.window.isFullScreen(),
      focused: this.window.isFocused(),
    };
  }

  info(): ProjectInfo | null {
    if (!this.project) return null;
    const layout = this.options.settings.get().projects[this.project.path]?.layout;
    return {
      path: this.project.path,
      name: this.project.name,
      settings: this.project.settings,
      settingsWarnings: this.project.settingsWarnings,
      ...(layout ? { layout } : {}),
    };
  }

  setKeybindingContext(context: Omit<KeybindingContext, 'terminalPassthrough'>): void {
    this.context = context;
  }

  browserHistoryEntries(): BrowserHistoryEntry[] {
    return this.browserHistory?.list() ?? [];
  }

  setBrowserBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    this.browserBounds = { rect, emulation };
    this.browser?.setBounds(rect, emulation);
  }

  rebuildKeybindings(): void {
    this.keybindings = this.buildKeybindings();
  }

  openProject(path: string): void {
    const { settings, warnings } = readProjectSettings(path);
    this.project = { path, name: basename(path), settings, settingsWarnings: warnings };
    this.window.setTitle(`${this.project.name} — Arbora`);
    this.rebuildKeybindings();
    this.restoreBounds();
    void this.startBrowser(path);
    this.options.settings.update((s) => ({
      ...s,
      recentProjects: addRecentProject(s.recentProjects, { path, name: basename(path), openedAt: Date.now() }),
    }));
    this.emitProject();
  }

  closeProject(): void {
    this.saveBounds();
    this.stopBrowser();
    this.project = null;
    this.context = { modeActive: false, terminalFocused: false };
    this.window.setTitle('Arbora');
    this.rebuildKeybindings();
    this.emitProject();
  }

  saveLayout(layout: LayoutState): void {
    const project = this.project;
    if (!project) return;
    this.options.settings.update((s) => ({
      ...s,
      projects: { ...s.projects, [project.path]: { ...s.projects[project.path], layout } },
    }));
  }

  reloadProjectSettings(): void {
    if (!this.project) return;
    const { settings, warnings } = readProjectSettings(this.project.path);
    if (
      JSON.stringify(settings) === JSON.stringify(this.project.settings) &&
      warnings.join() === this.project.settingsWarnings.join()
    ) {
      return;
    }
    this.project.settings = settings;
    this.project.settingsWarnings = warnings;
    this.rebuildKeybindings();
    this.emitProject();
  }

  private interceptorSource(dispatch: (commandId: string) => void): InterceptorSource {
    return {
      table: () => this.keybindings,
      context: () => ({ ...this.context, terminalPassthrough: this.options.settings.get().terminalPassthrough }),
      dispatch,
    };
  }

  private async startBrowser(projectPath: string): Promise<void> {
    this.stopBrowser();
    const generation = ++this.browserGeneration;
    const partition = browserPartition(projectPath);
    const session = await this.options.browserSessions.prepare(partition);
    if (generation !== this.browserGeneration || this.window.isDestroyed()) return;

    const app = this.contents;
    const history = new BrowserHistory(
      join(this.options.userDataPath, 'browser', partition.replace(/^persist:/, ''), 'history.json'),
    );
    this.browserHistory = history;
    this.browser = new BrowserService({
      window: this.window,
      session,
      preloadPath: this.options.browserPreloadPath,
      projectPath,
      history,
      initial: this.options.settings.get().projects[projectPath]?.browser,
      events: {
        state: (state) => sendEvent(app, 'browser.stateChanged', state),
        problemsAdded: (entries) => sendEvent(app, 'browser.problemsAdded', { entries }),
        problemsCleared: () => sendEvent(app, 'browser.problemsCleared', {}),
        urlSuggested: (url) => sendEvent(app, 'browser.urlSuggested', { url }),
      },
      attachInterceptor: (page) =>
        attachKeybindingInterceptor(
          page,
          this.interceptorSource((commandId) => {
            if (FOCUS_APP_COMMANDS.has(commandId)) app.focus();
            sendEvent(app, 'command.invoke', { commandId });
          }),
        ),
      saveState: (browser) => this.saveBrowserState(projectPath, browser),
    });
    this.browser.setBounds(this.browserBounds.rect, this.browserBounds.emulation);
  }

  private stopBrowser(): void {
    this.browserGeneration++;
    this.browser?.dispose();
    this.browser = null;
    this.browserHistory?.dispose();
    this.browserHistory = null;
  }

  private saveBrowserState(projectPath: string, browser: ProjectBrowserState): void {
    this.options.settings.update((s) => ({
      ...s,
      projects: { ...s.projects, [projectPath]: { ...s.projects[projectPath], browser } },
    }));
  }

  private emitProject(): void {
    sendEvent(this.contents, 'project.changed', this.info());
  }

  private buildKeybindings(): KeybindingTable {
    const specs = resolveKeybindingSpecs(
      DEFAULT_COMMANDS,
      this.options.settings.get().keybindings,
      this.project?.settings.keybindings,
    );
    const { table, errors } = KeybindingTable.build(specs, this.options.platform);
    for (const error of errors) console.warn(`[keybindings] ${error.message}`);
    return table;
  }

  private windowOptions(): BrowserWindowConstructorOptions {
    const isMac = this.options.platform === 'darwin';
    return {
      ...DEFAULT_SIZE,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: 'Arbora',
      backgroundColor: this.options.theme.background(),
      // Hyprland and other Wayland compositors draw no decorations, so Linux and Windows use a
      // frameless window with Arbora's own title bar.
      ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } } : { frame: false }),
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    };
  }

  private restoreBounds(): void {
    if (!this.project || !shouldRestoreBounds(this.options.platform, this.options.tilingCompositor)) return;
    const saved = this.options.settings.get().projects[this.project.path]?.bounds;
    if (!saved || !isVisibleOnSomeDisplay(saved)) return;
    this.window.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
    if (saved.maximized) this.window.maximize();
  }

  private scheduleBoundsSave(): void {
    clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => this.saveBounds(), BOUNDS_SAVE_DELAY_MS);
  }

  private saveBounds(): void {
    clearTimeout(this.boundsTimer);
    const project = this.project;
    if (!project || this.window.isDestroyed() || this.window.isFullScreen()) return;
    if (!shouldRestoreBounds(this.options.platform, this.options.tilingCompositor)) return;
    const maximized = this.window.isMaximized();
    const rect = maximized ? this.window.getNormalBounds() : this.window.getBounds();
    const bounds: WindowBounds = { ...rect, maximized };
    this.options.settings.update((s) => ({
      ...s,
      projects: { ...s.projects, [project.path]: { ...s.projects[project.path], bounds } },
    }));
  }

  private dispose(): void {
    // Forget first: disposing saves settings, and settings listeners walk every live window.
    this.manager.forget(this);
    clearTimeout(this.boundsTimer);
    this.stopBrowser();
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

function isVisibleOnSomeDisplay(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX >= 100 && overlapY >= 50;
  });
}

/** Owns every window. One window per project; opening an already open project focuses it. */
export class WindowManager {
  private readonly windows = new Set<ProjectWindow>();

  constructor(private readonly options: WindowManagerOptions) {}

  create(projectPath: string | null): ProjectWindow {
    const resolved = projectPath === null ? null : resolveProjectPath(projectPath);
    const projectWindow = new ProjectWindow(this, this.options);
    this.windows.add(projectWindow);
    if (resolved) projectWindow.openProject(resolved);
    return projectWindow;
  }

  /** Opens `path` in `from` when it is a welcome window, otherwise in its own window. */
  openProject(path: string, from?: ProjectWindow): ProjectWindow {
    const resolved = resolveProjectPath(path);
    const existing = this.findByProject(resolved);
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.focus();
      return existing;
    }
    const target = from && !from.project ? from : [...this.windows].find((w) => !w.project);
    if (target) {
      target.openProject(resolved);
      target.window.focus();
      return target;
    }
    return this.create(resolved);
  }

  fromWebContents(contents: WebContents): ProjectWindow | undefined {
    for (const w of this.windows) if (w.contents === contents) return w;
    return undefined;
  }

  /** The browser panel whose page is `contents`, for the private page channel. */
  browserFromPage(contents: WebContents): BrowserService | undefined {
    for (const w of this.windows) if (w.browser?.contents === contents) return w.browser;
    return undefined;
  }

  findByProject(path: string): ProjectWindow | undefined {
    for (const w of this.windows) if (w.project?.path === path) return w;
    return undefined;
  }

  all(): ProjectWindow[] {
    return [...this.windows];
  }

  rebuildKeybindings(): void {
    for (const w of this.windows) w.rebuildKeybindings();
  }

  forget(projectWindow: ProjectWindow): void {
    this.windows.delete(projectWindow);
  }
}
