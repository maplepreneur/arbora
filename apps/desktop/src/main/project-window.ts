import { basename } from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import {
  compileKeybindings,
  defaultKeybindings,
  emitEvent,
  events,
  findKeybinding,
  type CompiledKeybindings,
  type EventDef,
  type KeyContextUpdate,
  type KeybindingsState,
  type Platform,
  type ProjectInfo,
  type WindowBounds,
} from '@arbora/shared';
import type { z } from 'zod';
import { ProjectSettingsStore } from './project-settings';
import type { SettingsService } from './settings-service';

export interface ProjectWindowOptions {
  readonly platform: Platform;
  readonly preloadPath: string;
  readonly backgroundColor: string;
  readonly bounds: WindowBounds | undefined;
  readonly settings: SettingsService;
}

export interface OpenedProject {
  readonly path: string;
  readonly name: string;
  readonly store: ProjectSettingsStore;
}

const BOUNDS_SAVE_DEBOUNCE_MS = 500;

/**
 * One window: either the welcome screen (no project) or a project. Owns the window's key
 * interception, keybinding resolution (app + project overrides) and bounds persistence.
 */
export class ProjectWindow {
  readonly window: BrowserWindow;
  readonly #options: ProjectWindowOptions;
  #project: OpenedProject | undefined;
  #keybindings: CompiledKeybindings;
  #keyContext: KeyContextUpdate = { modeActive: false, terminalFocused: false };
  #boundsTimer: NodeJS.Timeout | undefined;
  readonly #disposers: (() => void)[] = [];

  constructor(options: ProjectWindowOptions) {
    this.#options = options;
    const { platform, bounds } = options;
    const restoreBounds = bounds !== undefined && platform !== 'linux';
    this.window = new BrowserWindow({
      width: restoreBounds ? bounds.width : 1440,
      height: restoreBounds ? bounds.height : 900,
      ...(restoreBounds ? { x: bounds.x, y: bounds.y } : {}),
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: 'Arbora',
      backgroundColor: options.backgroundColor,
      ...(platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
        : { frame: false }),
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    if (restoreBounds && bounds.maximized) this.window.maximize();
    // Main owns the window title (project name); ignore the renderer's <title>.
    this.window.on('page-title-updated', (event) => {
      event.preventDefault();
    });
    this.#keybindings = this.#compileKeybindings();
    this.attachKeyInterceptor(this.window.webContents);
    this.#trackWindowState();
    this.#disposers.push(
      options.settings.onDidChange(() => {
        this.refreshKeybindings();
      }),
    );
  }

  get project(): OpenedProject | undefined {
    return this.#project;
  }

  get projectInfo(): ProjectInfo | null {
    const project = this.#project;
    return project
      ? { path: project.path, name: project.name, settings: project.store.settings }
      : null;
  }

  setProject(path: string): void {
    const name = basename(path) || path;
    this.#project = { path, name, store: new ProjectSettingsStore(path) };
    this.window.setTitle(`${name} — Arbora`);
    this.refreshKeybindings();
    this.send(events.projectChanged, this.projectInfo);
  }

  setKeyContext(context: KeyContextUpdate): void {
    this.#keyContext = context;
  }

  get keybindingsState(): KeybindingsState {
    return {
      bindings: this.#keybindings.bindings.map(({ command, source, intercept, when }) => ({
        command,
        chord: source,
        intercept,
        when,
      })),
      problems: [...this.#keybindings.problems],
      terminalPassthrough: this.#options.settings.settings.terminalPassthrough,
    };
  }

  refreshKeybindings(): void {
    this.#keybindings = this.#compileKeybindings();
    this.send(events.keybindingsChanged, this.keybindingsState);
  }

  /**
   * Intercepts mode chords before the focused page sees them (pages often bind Ctrl+K
   * themselves) and forwards them to the renderer's command registry. Stage 1 attaches this to
   * the browser view as well.
   */
  attachKeyInterceptor(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const binding = findKeybinding(
        this.#keybindings.bindings,
        {
          key: input.key,
          code: input.code,
          ctrlKey: input.control,
          metaKey: input.meta,
          altKey: input.alt,
          shiftKey: input.shift,
        },
        {
          ...this.#keyContext,
          terminalPassthrough: this.#options.settings.settings.terminalPassthrough,
        },
        'main',
      );
      if (binding === undefined) return;
      event.preventDefault();
      if (!input.isAutoRepeat) this.send(events.commandInvoked, { command: binding.command });
    });
  }

  send<E extends EventDef>(event: E, payload: z.input<E['payload']>): void {
    const contents = this.window.webContents;
    if (contents.isDestroyed()) return;
    emitEvent(event, payload, (name, validated) => {
      contents.send(name, validated);
    });
  }

  get windowState(): { maximized: boolean; fullscreen: boolean; focused: boolean } {
    return {
      maximized: this.window.isMaximized(),
      fullscreen: this.window.isFullScreen(),
      focused: this.window.isFocused(),
    };
  }

  #compileKeybindings(): CompiledKeybindings {
    return compileKeybindings(
      this.#options.platform,
      defaultKeybindings,
      this.#options.settings.settings.keybindings,
      this.#project?.store.settings.keybindings ?? {},
    );
  }

  #trackWindowState(): void {
    const sendState = (): void => {
      this.send(events.windowStateChanged, this.windowState);
    };
    this.window.on('maximize', sendState);
    this.window.on('unmaximize', sendState);
    this.window.on('enter-full-screen', sendState);
    this.window.on('leave-full-screen', sendState);
    this.window.on('focus', sendState);
    this.window.on('blur', sendState);
    const scheduleBoundsSave = (): void => {
      clearTimeout(this.#boundsTimer);
      this.#boundsTimer = setTimeout(() => {
        this.saveBounds();
      }, BOUNDS_SAVE_DEBOUNCE_MS);
    };
    this.window.on('resize', scheduleBoundsSave);
    this.window.on('move', scheduleBoundsSave);
  }

  saveBounds(): void {
    clearTimeout(this.#boundsTimer);
    const project = this.#project;
    if (!project || this.window.isDestroyed() || this.window.isMinimized()) return;
    const maximized = this.window.isMaximized() || this.window.isFullScreen();
    const { x, y, width, height } = this.window.getNormalBounds();
    void this.#options.settings.setProjectWindowBounds(project.path, {
      x,
      y,
      width,
      height,
      maximized,
    });
  }

  dispose(): void {
    clearTimeout(this.#boundsTimer);
    for (const dispose of this.#disposers.splice(0)) dispose();
  }
}
