import { readlinkSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import {
  addRecentProject,
  CommandId,
  layoutForAppLaunch,
  DEFAULT_COMMANDS,
  KeybindingTable,
  resolveKeybindingSpecs,
  type Events,
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
  type GroveLaunch,
  type WorkspaceKind,
  type PayloadOf,
} from '@arbora/shared';
import type { AgentRegistry } from '@arbora/acp-client';
import type { AgentService } from './agent/agent-service.js';
import { AgentModeService } from './agent-mode/agent-mode-service.js';
import { DesignModeService } from './design/design-mode-service.js';
import { findCandidates } from './agent-mode/source-search.js';
import { ProjectRuntime } from './project-runtime.js';
import { RuntimeTable } from './runtime-table.js';
import { BrowserTabs, type BrowserTabsHooks } from './browser/browser-tabs.js';
import { TabGrantStore } from './browser/tab-grants.js';
import { type BrowserService } from './browser/browser-service.js';
import { browserPartition, type BrowserSessions } from './browser/browser-sessions.js';
import { sendEvent } from './ipc.js';
import { attachKeybindingInterceptor, type InterceptorSource } from './keybinding-interceptor.js';
import type { ShimCommand } from './mcp/browser-tools.js';
import { ensureArboraGitignore, readProjectSettings } from './project-settings.js';
import type { SettingsStore } from './settings-store.js';
import { shouldRestoreBounds } from './startup.js';
import type { DevServer } from './terminal/dev-server.js';
import { findExecutable, type ShellEnvironment } from './terminal/shell-env.js';
import type { TerminalService } from './terminal/terminal-service.js';
import { isAlive, readProcessSamples, treeSample } from './terminal/process-tree.js';
import {
  adoptionOf,
  groveProcessLedgerPath,
  readProcessLedger,
  writeProcessLedger,
  type RecordedProcess,
} from './grove-processes.js';
import type { ThemeService } from './theme-service.js';
import { GitAutoSync } from './git/git-auto-sync.js';
import { GitService } from './git/git-service.js';
import { ToolingService } from './workspace/tooling/tooling-service.js';
import { forkUtility } from './workspace/tooling/utility-fork.js';
import { WorkspaceService } from './workspace/workspace-service.js';

export interface WindowManagerOptions {
  readonly platform: Platform;
  readonly tilingCompositor: string | null;
  readonly settings: SettingsStore;
  readonly theme: ThemeService;
  readonly agentRegistry: AgentRegistry;
  readonly preloadPath: string;
  readonly browserPreloadPath: string;
  readonly browserSessions: BrowserSessions;
  readonly shellEnvironment: ShellEnvironment;
  readonly userDataPath: string;
  /** Starts the browser-tools stdio shim for agents without HTTP MCP. */
  readonly mcpShim: ShimCommand;
  /** Built `tooling-worker.js` (Prettier and ESLint in a utility process). */
  readonly toolingWorkerPath: string;
  readonly appVersion: string;
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
const FOCUS_APP_COMMANDS: ReadonlySet<string> = new Set([
  CommandId.commandPalette,
  CommandId.browserFocusUrl,
  CommandId.agentNewThread,
  CommandId.openSettings,
  CommandId.switchProject,
  CommandId.agentShowAttention,
  CommandId.focusNextPanel,
  CommandId.focusPreviousPanel,
  CommandId.focusPanelLeft,
  CommandId.focusPanelRight,
  CommandId.toggleContentPane,
  CommandId.focusSidebarPanel,
  CommandId.focusAgentPanel,
  CommandId.focusBottomPanel,
  CommandId.groveLaunch,
  CommandId.groveSearch,
  CommandId.groveSwitchProject,
  CommandId.groveSwitchProjectBack,
  CommandId.showKeybindings,
]);
const BOUNDS_SAVE_DELAY_MS = 500;

/** A project's page, kept alive so switching back does not load it again. */
interface LiveBrowser {
  readonly tabs: BrowserTabs;
}

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
  private tabs: BrowserTabs | null = null;
  /** Pages for projects this window has shown, hidden while another project is current. */
  private readonly parkedBrowsers = new Map<string, LiveBrowser>();
  /** Bumped whenever the browser is (re)started or stopped, to drop stale async starts. */
  private browserGeneration = 0;
  /** The in-flight browser start. Already resolved when the view exists. */
  private browserReady: Promise<void> = Promise.resolve();
  private browserBounds: { rect: Rect | null; emulation: ViewportEmulation | null } = { rect: null, emulation: null };
  /** Interface size from settings. The renderer reports CSS pixels, so browser bounds are scaled by it. */
  private zoom = 1;
  terminals: TerminalService | null = null;
  devServer: DevServer | null = null;
  agents: AgentService | null = null;
  /** Set while Grove is showing a project other than this window's, so terminal and agent IPC follow it. */
  groveFocus: string | null = null;
  /**
   * Grove launch with no browser project. `state()` reports it so the renderer opens Grove
   * before any project folder is loaded.
   */
  private launchWorkspace: WorkspaceKind | null = null;
  private runtime: ProjectRuntime | null = null;
  agentMode: AgentModeService | null = null;
  designMode: DesignModeService | null = null;
  workspace: WorkspaceService | null = null;
  git: GitService | null = null;
  gitSync: GitAutoSync | null = null;
  private gitSyncKey = '';

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
    contents.on('did-finish-load', () => this.applyZoom());
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
      ...(this.launchWorkspace ? { workspace: this.launchWorkspace } : {}),
    };
  }

  /**
   * The first window when Grove is the launch workspace and no project path was passed.
   * Does not open a folder in the browser. The renderer reads `state().workspace`.
   */
  showLaunchedGrove(): void {
    this.launchWorkspace = layoutForAppLaunch(undefined, 'grove').workspace;
    this.context = { ...this.context, workspace: 'grove' };
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

  setKeybindingContext(context: {
    modeActive: boolean;
    terminalFocused: boolean;
    designActive?: boolean | undefined;
    textEditing?: boolean | undefined;
    recording?: boolean | undefined;
    workspace?: WorkspaceKind | undefined;
    contentFocused?: boolean | undefined;
  }): void {
    this.context = {
      modeActive: context.modeActive,
      terminalFocused: context.terminalFocused,
      designActive: context.designActive === true,
      textEditing: context.textEditing === true,
      recording: context.recording === true,
      workspace: context.workspace ?? 'browser',
      contentFocused: context.contentFocused === true,
    };
  }

  browserHistoryEntries(): BrowserHistoryEntry[] {
    return this.tabs?.historyEntries() ?? [];
  }

  /** The tab an agent tool should use. Hidden tabs stay hidden. */
  resolveBrowserTab(target: string | undefined): ReturnType<BrowserTabs['resolve']> {
    const tabs = this.tabs;
    if (!tabs) return Promise.reject(new Error('The browser panel is not open.'));
    return tabs.resolve(target);
  }

  browserTabs(): BrowserTabs | null {
    return this.tabs;
  }

  parkedMatch(contents: WebContents): BrowserService | undefined {
    for (const live of this.parkedBrowsers.values()) {
      const match = live.tabs.serviceForContents(contents);
      if (match) return match;
    }
    return undefined;
  }

  async activateAppTab(): Promise<void> {
    await this.tabs?.activateApp();
    this.browser = this.tabs?.activeService() ?? null;
  }

  applyZoom(): void {
    const zoom = this.options.settings.get().appearance.uiScale / 100;
    this.window.webContents.setZoomFactor(zoom);
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.tabs?.setBounds(this.scaledBrowserRect(), this.browserBounds.emulation);
  }

  /** Restarts the background sync timer when its settings changed. */
  applyGitSync(): void {
    const key = JSON.stringify(this.options.settings.get().git);
    if (key === this.gitSyncKey) return;
    this.gitSyncKey = key;
    this.gitSync?.reschedule();
  }

  private scaledBrowserRect(): Rect | null {
    const { rect } = this.browserBounds;
    if (!rect || this.zoom === 1) return rect;
    const z = this.zoom;
    const x = Math.round(rect.x * z);
    const y = Math.round(rect.y * z);
    return {
      x,
      y,
      width: Math.round((rect.x + rect.width) * z) - x,
      height: Math.round((rect.y + rect.height) * z) - y,
    };
  }

  setBrowserBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    this.browserBounds = { rect, emulation };
    this.tabs?.setBounds(this.scaledBrowserRect(), emulation);
  }

  rebuildKeybindings(): void {
    this.keybindings = this.buildKeybindings();
  }

  /** Resolves once the browser for the open project has been created, or that start was dropped. */
  whenBrowserReady(): Promise<void> {
    return this.browserReady;
  }

  /**
   * Opens `path` on this window. A page already shown here, or handed over from another window,
   * is shown again without loading. The window keeps its size; bounds restore only on the first
   * project, so a switch does not jump.
   */
  openProject(path: string, adopted: LiveBrowser | null = null): void {
    if (this.project?.path === path) return;
    const hadProject = this.project !== null;
    if (hadProject) {
      this.saveBounds();
      this.parkActiveBrowser();
      this.detachRuntime();
      this.stopWorkspace();
    }
    ensureArboraGitignore(path);
    const { settings, warnings } = readProjectSettings(path);
    this.project = { path, name: basename(path), settings, settingsWarnings: warnings };
    this.window.setTitle(`${this.project.name} — Arbora`);
    this.rebuildKeybindings();
    if (!hadProject) this.restoreBounds();
    const live = adopted ?? this.unpark(path);
    if (live) {
      this.installLive(live);
      this.browserReady = Promise.resolve();
    } else this.browserReady = this.startBrowser(path);
    this.attachRuntime(path);
    this.startAgentMode(path);
    this.startDesignMode(path);
    this.startWorkspace(path);
    const openedAt = Date.now();
    const launch = this.manager.takeLaunchWorkspace();
    this.launchWorkspace = null;
    this.options.settings.update((s) => {
      const state = s.projects[path] ?? {};
      // Browser launch keeps every saved field and shows the browser workspace. Grove launch
      // selects Grove. A later open in this process leaves the layout alone.
      const layout =
        launch === null
          ? state.layout
          : layoutForAppLaunch(launch === 'browser' ? { ...state.layout, workspace: 'browser' } : state.layout, launch);
      return {
        ...s,
        recentProjects: addRecentProject(s.recentProjects, { path, name: basename(path), openedAt }),
        projects: { ...s.projects, [path]: { ...state, openedAt, ...(layout ? { layout } : {}) } },
      };
    });
    if (launch) this.context = { ...this.context, workspace: launch };
    this.emitProject();
    if (live) {
      const state = live.tabs.activeService()?.getState();
      if (state) sendEvent(this.contents, 'browser.stateChanged', state);
      sendEvent(this.contents, 'browser.tabsChanged', { tabs: live.tabs.snapshots() });
    }
    this.manager.projectsChanged();
  }

  /**
   * The live page for this window's project, detached so another window can show it. Parked pages
   * for other projects stay here.
   */
  takeBrowser(): LiveBrowser | null {
    const path = this.project?.path;
    if (!path) return null;
    this.designMode?.setActive(false);
    this.agentMode?.setInspecting(false);
    const parked = this.unpark(path);
    if (parked) return parked;
    if (!this.tabs) return null;
    const live = { tabs: this.tabs };
    this.tabs = null;
    this.browser = null;
    live.tabs.setBounds(null, null);
    return live;
  }

  /** Clears cookies, storage and cache of the project partition, then reloads the page. */
  async resetBrowserData(): Promise<void> {
    if (!this.project) throw new Error('Open a project first');
    const partition = session.fromPartition(browserPartition(this.project.path));
    await partition.clearStorageData();
    await partition.clearCache();
    await partition.clearAuthCache();
    this.browser?.action('reload');
  }

  closeProject(): void {
    this.saveBounds();
    this.designMode?.setActive(false);
    this.designMode = null;
    this.agentMode = null;
    this.stopBrowser();
    this.disposeParked();
    this.detachRuntime();
    this.stopWorkspace();
    this.project = null;
    this.context = { modeActive: false, terminalFocused: false, workspace: 'browser' };
    this.window.setTitle('Arbora');
    this.rebuildKeybindings();
    this.emitProject();
    this.manager.projectsChanged();
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

  private interceptorSource(
    dispatch: (commandId: string) => void,
    extra: { contentFocused?: boolean; browserPage?: boolean } = {},
  ): InterceptorSource {
    return {
      table: () => this.keybindings,
      context: () => ({
        ...this.context,
        terminalPassthrough: this.options.settings.get().terminalPassthrough,
        ...extra,
      }),
      dispatch,
    };
  }

  private async startBrowser(projectPath: string): Promise<void> {
    const generation = ++this.browserGeneration;
    const partition = browserPartition(projectPath);
    await this.options.browserSessions.prepare(partition);
    if (generation !== this.browserGeneration || this.window.isDestroyed()) return;

    const tabs = new BrowserTabs({
      window: this.window,
      projectPath,
      projectPartition: partition,
      preloadPath: this.options.browserPreloadPath,
      historyRoot: join(this.options.userDataPath, 'browser'),
      initial: this.options.settings.get().projects[projectPath]?.browser,
      prepareSession: (name) => this.options.browserSessions.prepare(name),
      attachInterceptor: (page) => this.pageInterceptor(page),
      saveState: (state) => this.saveBrowserState(projectPath, state),
      beforeDevTools: (session) => this.options.browserSessions.ensureExtensions(session),
      openLinksInTabs: () => this.options.settings.get().browser.openLinksInTabs,
      protectedIds: () => this.manager.grantedTabIds(projectPath),
      hooks: this.tabHooks(),
    });
    if (generation !== this.browserGeneration || this.window.isDestroyed()) {
      tabs.dispose();
      return;
    }
    this.tabs = tabs;
    await tabs.start();
    if (generation !== this.browserGeneration || this.window.isDestroyed()) {
      tabs.dispose();
      if (this.tabs === tabs) this.tabs = null;
      return;
    }
    this.browser = tabs.activeService();
    tabs.setBounds(this.scaledBrowserRect(), this.browserBounds.emulation);
  }

  /** Hide the current page and remember it under the project it belongs to. */
  private parkActiveBrowser(): void {
    this.designMode?.setActive(false);
    this.designMode = null;
    this.agentMode?.setInspecting(false);
    this.agentMode = null;
    this.browserGeneration++;
    const path = this.project?.path;
    const tabs = this.tabs;
    this.tabs = null;
    this.browser = null;
    if (!path || !tabs) return;
    tabs.setBounds(null, null);
    this.parkedBrowsers.set(path, { tabs });
  }

  private unpark(path: string): LiveBrowser | null {
    const live = this.parkedBrowsers.get(path) ?? null;
    if (live) this.parkedBrowsers.delete(path);
    return live;
  }

  private installLive(live: LiveBrowser): void {
    this.tabs = live.tabs;
    live.tabs.rebind(this.window, this.tabHooks(), (page) => this.pageInterceptor(page));
    live.tabs.setBounds(this.scaledBrowserRect(), this.browserBounds.emulation);
    this.browser = live.tabs.activeService();
  }

  private tabHooks(): BrowserTabsHooks {
    return {
      state: (state) => {
        this.browser = this.tabs?.activeService() ?? null;
        sendEvent(this.contents, 'browser.stateChanged', state);
      },
      problemsAdded: (entries) => sendEvent(this.contents, 'browser.problemsAdded', { entries }),
      problemsCleared: () => sendEvent(this.contents, 'browser.problemsCleared', {}),
      urlSuggested: (url) => sendEvent(this.contents, 'browser.urlSuggested', { url }),
      inspectorSelected: (selection) => void this.agentMode?.select(selection),
      inspectorCancelled: () => this.agentMode?.cancelledInPage(),
      designState: (state) => this.designMode?.onState(state),
      designExitRequested: () => sendEvent(this.contents, 'command.invoke', { commandId: CommandId.exitMode }),
      designNavigationBlocked: (url) => sendEvent(this.contents, 'design.navigationBlocked', { url }),
      designDocumentNavigated: () => void this.designMode?.onDocumentNavigated(),
      pageFocused: (focused) => sendEvent(this.contents, 'browser.pageFocused', { focused }),
      focusParked: () => sendEvent(this.contents, 'browser.focusParked', {}),
      tabsChanged: (tabs) => {
        this.browser = this.tabs?.activeService() ?? null;
        sendEvent(this.contents, 'browser.tabsChanged', { tabs });
      },
      passwordOffer: (offer) => sendEvent(this.contents, 'passwords.offerSave', offer),
    };
  }

  private pageInterceptor(page: WebContents): () => void {
    return attachKeybindingInterceptor(
      page,
      this.interceptorSource(
        (commandId) => {
          if (FOCUS_APP_COMMANDS.has(commandId)) this.contents.focus();
          sendEvent(this.contents, 'command.invoke', { commandId, fromPage: true });
        },
        // The page is the content pane's browser, so Mod+1..9 and the pane arrows apply here.
        // `browserPage` lets tab chords beat the editor's Mod+W.
        { contentFocused: true, browserPage: true },
      ),
    );
  }

  private stopBrowser(): void {
    this.browserGeneration++;
    this.tabs?.dispose();
    this.tabs = null;
    this.browser = null;
  }

  private disposeParked(): void {
    for (const live of this.parkedBrowsers.values()) live.tabs.dispose();
    this.parkedBrowsers.clear();
  }

  shownWorkspace(): WorkspaceKind {
    return this.context.workspace ?? 'browser';
  }

  /** The project whose terminals and agents this window's agent and terminal IPC should use. */
  activeRuntimePath(): string | null {
    if (this.shownWorkspace() === 'grove' && this.groveFocus) return this.groveFocus;
    return this.project?.path ?? null;
  }

  /** True when this window's browser loaded a dev URL printed by its project. */
  offerTerminalUrl(url: string): boolean {
    const project = this.project;
    if (!project) return false;
    const autoOpen = project.settings.autoOpenDevUrl !== false;
    return autoOpen ? (this.tabs?.suggestUrl(url) ?? false) : false;
  }

  private attachRuntime(projectPath: string): void {
    this.detachRuntime();
    const runtime = this.manager.acquireRuntime(projectPath, this);
    this.runtime = runtime;
    this.terminals = runtime.terminals;
    this.devServer = runtime.devServer;
    this.agents = runtime.agents;
  }

  private detachRuntime(): void {
    const path = this.runtime?.path;
    this.runtime = null;
    this.terminals = null;
    this.devServer = null;
    this.agents = null;
    if (path) this.manager.releaseRuntime(path, this);
  }

  private startAgentMode(projectPath: string): void {
    const app = this.contents;
    const { platform, shellEnvironment } = this.options;
    this.agentMode = new AgentModeService({
      projectPath,
      browser: () => this.browser,
      agents: () => this.agents,
      findCandidates: async (terms) => {
        await shellEnvironment.ready;
        const rg = findExecutable('rg', shellEnvironment.env(), platform) ?? null;
        return findCandidates(projectPath, terms, { rg });
      },
      events: {
        picked: () => sendEvent(app, 'agentMode.picked', {}),
        selected: (selection) => sendEvent(app, 'agentMode.selected', selection),
        ended: (error) => sendEvent(app, 'agentMode.ended', error === undefined ? {} : { error }),
      },
    });
  }

  private startDesignMode(projectPath: string): void {
    const app = this.contents;
    const { platform, shellEnvironment } = this.options;
    this.designMode = new DesignModeService({
      projectPath,
      browser: () => this.browser,
      agents: () => this.agents,
      findCandidates: async (terms) => {
        await shellEnvironment.ready;
        const rg = findExecutable('rg', shellEnvironment.env(), platform) ?? null;
        return findCandidates(projectPath, terms, { rg });
      },
      events: {
        state: (state) => sendEvent(app, 'design.state', state),
        failed: (error) => sendEvent(app, 'design.failed', { error }),
      },
    });
  }

  private startWorkspace(projectPath: string): void {
    this.stopWorkspace();
    const app = this.contents;
    const { platform, settings, shellEnvironment } = this.options;
    const environment = async (): Promise<NodeJS.ProcessEnv> => {
      await shellEnvironment.ready;
      return shellEnvironment.env();
    };
    const tooling = new ToolingService({
      root: projectPath,
      workerPath: this.options.toolingWorkerPath,
      fork: forkUtility,
      environment,
      settings: () => settings.get().editor,
      events: {
        diagnostics: (path, source, diagnostics) => sendEvent(app, 'editor.diagnostics', { path, source, diagnostics }),
        toolError: (source, message) => sendEvent(app, 'editor.toolError', { source, message }),
      },
    });
    this.git = new GitService({ root: projectPath, env: environment });
    this.gitSync = new GitAutoSync({
      git: this.git,
      settings: () => settings.get().git,
      onSynced: (result) => sendEvent(app, 'git.synced', result),
    });
    this.gitSyncKey = JSON.stringify(settings.get().git);
    this.gitSync.start();
    this.workspace = new WorkspaceService({
      root: projectPath,
      rg: async () => findExecutable('rg', await environment(), platform) ?? null,
      trash: (path) => shell.trashItem(path),
      reveal: (path) => shell.showItemInFolder(path),
      tooling,
      formatOnSave: () => settings.get().editor.formatOnSave,
      events: {
        changed: (changes) => sendEvent(app, 'files.changed', { changes }),
        watchWarning: (message) => sendEvent(app, 'files.watchWarning', { message }),
        searchResults: (searchId, matches) => sendEvent(app, 'search.results', { searchId, matches }),
        searchDone: (searchId, result) => sendEvent(app, 'search.done', { searchId, ...result }),
      },
    });
  }

  private stopWorkspace(): void {
    this.gitSync?.dispose();
    this.gitSync = null;
    this.git = null;
    const workspace = this.workspace;
    this.workspace = null;
    void workspace
      ?.dispose()
      .catch((error: unknown) => console.warn(`[workspace] dispose: ${(error as Error).message}`));
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
      // Below Omarchy's default scrolling column on a scale-2 laptop (~687px).
      minWidth: 640,
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
        // Agent sounds play when a turn ends, which is never right after a click.
        autoplayPolicy: 'no-user-gesture-required',
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
    this.manager.projectsChanged();
    clearTimeout(this.boundsTimer);
    this.stopBrowser();
    this.disposeParked();
    this.detachRuntime();
    this.stopWorkspace();
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

/** Owns every window, and one runtime per project those windows or Grove are using. */
export class WindowManager {
  readonly grants = new TabGrantStore();
  private readonly windows = new Set<ProjectWindow>();
  private readonly runtimes = new RuntimeTable<ProjectRuntime>();
  private usageTimer: NodeJS.Timeout | undefined;
  /**
   * The first project opened this process uses `settings.grove.launch`. A Grove launch with no
   * project path consumes it too, so a later open keeps that project's saved layout.
   */
  private launchPending = true;
  private tray: Tray | null = null;
  private readonly ledgerFile: string;

  constructor(private readonly options: WindowManagerOptions) {
    this.ledgerFile = groveProcessLedgerPath(options.userDataPath);
    this.syncGroveProjects();
    this.adoptRecordedProcesses();
    this.usageTimer = setInterval(() => {
      this.persistProcesses();
      this.publishUsage();
    }, 2000);
    this.usageTimer.unref();
  }

  /** The launch workspace, once per process. Null after the first project open or a Grove launch window. */
  takeLaunchWorkspace(): GroveLaunch | null {
    if (!this.launchPending) return null;
    this.launchPending = false;
    return this.options.settings.get().grove.launch;
  }

  /**
   * True when a window with no project path should open Grove. Browser launch leaves that window
   * on the projects home. Later windows follow the setting without opening a browser project.
   */
  private useGroveLaunchWindow(): boolean {
    if (this.options.settings.get().grove.launch !== 'grove') return false;
    this.launchPending = false;
    return true;
  }

  /** A Grove-listed terminal or agent still has an OS process. */
  hasLiveGroveProcesses(): boolean {
    for (const path of this.runtimes.paths()) {
      const runtime = this.runtimes.get(path);
      if (!runtime) continue;
      if (runtime.terminals.list().some((terminal) => terminal.exitCode === null && terminal.pid !== null)) return true;
      if (runtime.agents.listThreads().some((thread) => runtime.agents.processPid(thread.id) !== null)) return true;
    }
    return false;
  }

  /** Shown when the last window closes while Grove processes are still running. */
  showBackgroundTray(): void {
    if (this.tray) return;
    const tray = new Tray(trayImage());
    tray.setToolTip('Arbora');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Show Arbora',
          click: () => {
            this.hideBackgroundTray();
            this.create(null);
          },
        },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
    this.tray = tray;
  }

  hideBackgroundTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  acquireRuntime(path: string, holder: ProjectWindow): ProjectRuntime {
    return this.runtimes.acquire(path, holder, () => this.createRuntime(path));
  }

  releaseRuntime(path: string, holder: ProjectWindow): void {
    const idle = this.runtimes.release(path, holder);
    if (idle) void idle.dispose();
  }

  runtime(path: string): ProjectRuntime | undefined {
    return this.runtimes.get(path);
  }

  runtimePaths(): string[] {
    return this.runtimes.paths();
  }

  /** Starts a runtime for every Grove project and drops listings that were removed. */
  syncGroveProjects(): void {
    const wanted = new Set<string>();
    for (const entry of this.options.settings.get().grove.projects) {
      try {
        wanted.add(resolveProjectPath(entry.path));
      } catch (error) {
        console.warn(`[grove] ${entry.path}: ${(error as Error).message}`);
      }
    }
    for (const path of wanted) this.runtimes.list(path, () => this.createRuntime(path));
    for (const path of this.runtimes.paths()) {
      if (wanted.has(path)) continue;
      const idle = this.runtimes.unlist(path);
      if (idle) void idle.dispose();
    }
  }

  /** Stops every project's terminals and agents. Called when the app quits. */
  disposeRuntimes(): void {
    clearInterval(this.usageTimer);
    for (const runtime of this.runtimes.drain()) void runtime.dispose();
    this.clearProcessLedger();
    this.hideBackgroundTray();
  }

  private createRuntime(path: string): ProjectRuntime {
    const options = this.options;
    return new ProjectRuntime(path, {
      path,
      platform: options.platform,
      settings: options.settings,
      agentRegistry: options.agentRegistry,
      shellEnvironment: options.shellEnvironment,
      mcpShim: options.mcpShim,
      appVersion: options.appVersion,
      host: {
        browser: () => this.findByProject(path)?.browser ?? null,
        tabs: () => this.findByProject(path)?.browserTabs() ?? null,
        grants: this.grants,
        suggestUrl: (url) => this.findByProject(path)?.offerTerminalUrl(url) ?? false,
        reloadProjectSettings: () => this.findByProject(path)?.reloadProjectSettings(),
        send: (name, payload) => this.sendRuntimeEvent(path, name, payload),
      },
    });
  }

  private sendRuntimeEvent<K extends keyof Events>(path: string, name: K, payload: PayloadOf<Events[K]>): void {
    for (const projectWindow of this.windows) {
      if (projectWindow.window.isDestroyed()) continue;
      const owns = projectWindow.activeRuntimePath() === path;
      const grove = projectWindow.shownWorkspace() === 'grove';
      if (!owns && !grove) continue;
      sendEvent(projectWindow.contents, name, payload);
    }
  }

  private persistProcesses(): void {
    try {
      writeProcessLedger(this.ledgerFile, this.recordedProcesses());
    } catch (error) {
      console.warn(`[grove] could not record processes: ${(error as Error).message}`);
    }
  }

  private clearProcessLedger(): void {
    try {
      unlinkSync(this.ledgerFile);
    } catch {
      // Nothing recorded, or it was already removed.
    }
  }

  private recordedProcesses(): RecordedProcess[] {
    const processes: RecordedProcess[] = [];
    for (const path of this.runtimes.paths()) {
      const runtime = this.runtimes.get(path);
      if (!runtime) continue;
      for (const terminal of runtime.terminals.list()) {
        if (terminal.pid === null || terminal.exitCode !== null || terminal.recovered === 'gone') continue;
        const agent = terminal.id.startsWith('agent:');
        processes.push({
          projectPath: path,
          kind: agent ? 'agent' : 'terminal',
          id: agent ? terminal.id.slice('agent:'.length) : terminal.id,
          pid: terminal.pid,
          cwd: terminal.cwd,
          command: terminal.command,
          title: terminal.title,
        });
      }
      for (const thread of runtime.agents.listThreads()) {
        const pid = runtime.agents.processPid(thread.id);
        if (pid === null) continue;
        if (processes.some((entry) => entry.kind === 'agent' && entry.id === thread.id)) continue;
        processes.push({
          projectPath: path,
          kind: 'agent',
          id: thread.id,
          pid,
          cwd: path,
          command: thread.agentId,
          title: thread.title,
        });
      }
    }
    return processes;
  }

  /** Best-effort: a pid that is still the recorded process is shown running; anything else is gone. */
  private adoptRecordedProcesses(): void {
    const ledger = readProcessLedger(this.ledgerFile);
    const listed = new Set(this.runtimes.paths());
    for (const record of ledger.processes) {
      if (!listed.has(record.projectPath)) continue;
      const runtime = this.runtimes.get(record.projectPath);
      if (!runtime) continue;
      const alive = isAlive(record.pid);
      const cwd = alive ? processCwd(record.pid) : null;
      const recovered = adoptionOf(record, { alive, cwd });
      runtime.terminals.adopt({
        id: record.kind === 'agent' ? `agent:${record.id}` : record.id,
        title: record.title,
        command: record.command,
        cwd: record.cwd,
        pid: recovered === 'running' ? record.pid : null,
        recovered,
      });
    }
  }

  private publishUsage(): void {
    const groveWindows = [...this.windows].filter(
      (projectWindow) => projectWindow.shownWorkspace() === 'grove' && !projectWindow.window.isDestroyed(),
    );
    if (groveWindows.length === 0) return;
    const rows = readProcessSamples(this.options.platform);
    const samples: {
      projectPath: string;
      kind: 'terminal' | 'agent';
      id: string;
      rssKb: number;
      cpuPercent: number;
      agentCli: string | null;
    }[] = [];
    for (const path of this.runtimes.paths()) {
      const runtime = this.runtimes.get(path);
      if (!runtime) continue;
      for (const terminal of runtime.terminals.list()) {
        if (terminal.pid === null) continue;
        const sample = treeSample(terminal.pid, rows);
        samples.push({
          projectPath: path,
          kind: 'terminal',
          id: terminal.id,
          rssKb: sample.rssKb,
          cpuPercent: sample.cpuPercent,
          agentCli: sample.agentCli,
        });
      }
      for (const thread of runtime.agents.listThreads()) {
        const pid = runtime.agents.processPid(thread.id);
        if (pid === null) continue;
        const sample = treeSample(pid, rows);
        samples.push({
          projectPath: path,
          kind: 'agent',
          id: thread.id,
          rssKb: sample.rssKb,
          cpuPercent: sample.cpuPercent,
          agentCli: null,
        });
      }
    }
    for (const projectWindow of groveWindows) sendEvent(projectWindow.contents, 'grove.usage', { samples });
  }

  create(projectPath: string | null): ProjectWindow {
    const resolved = projectPath === null ? null : resolveProjectPath(projectPath);
    this.hideBackgroundTray();
    const projectWindow = new ProjectWindow(this, this.options);
    this.windows.add(projectWindow);
    if (resolved) projectWindow.openProject(resolved);
    else if (this.useGroveLaunchWindow()) projectWindow.showLaunchedGrove();
    return projectWindow;
  }

  /**
   * Opens `path` on `projectWindow`. A page another window is showing for that folder moves here,
   * so this window changes project instead of focusing a second one. The runtime stays shared.
   */
  openOnThisWindow(path: string, projectWindow: ProjectWindow): { focusedElsewhere: ProjectWindow | null } {
    const resolved = resolveProjectPath(path);
    if (projectWindow.project?.path !== resolved) {
      const existing = this.findByProject(resolved);
      const adopted = existing && existing !== projectWindow ? existing.takeBrowser() : null;
      if (existing && existing !== projectWindow) existing.closeProject();
      projectWindow.openProject(resolved, adopted);
    }
    return { focusedElsewhere: null };
  }

  /**
   * Opens `path` in one window: the window that already shows it, else `from`, else the focused or
   * first window, which switches project in place (its previous page is parked). A new window is
   * made only when there is none.
   */
  openProject(path: string, from?: ProjectWindow): ProjectWindow {
    const resolved = resolveProjectPath(path);
    const target =
      this.findByProject(resolved) ??
      from ??
      [...this.windows].find((w) => !w.window.isDestroyed() && w.window.isFocused()) ??
      [...this.windows].find((w) => !w.window.isDestroyed());
    if (!target) return this.create(resolved);
    this.openOnThisWindow(resolved, target);
    if (target.window.isMinimized()) target.window.restore();
    target.window.focus();
    return target;
  }

  fromWebContents(contents: WebContents): ProjectWindow | undefined {
    for (const w of this.windows) if (w.contents === contents) return w;
    return undefined;
  }

  /** The browser panel whose page is `contents`, for the private page channel. */
  browserFromPage(contents: WebContents): BrowserService | undefined {
    for (const w of this.windows) {
      const match = w.browserTabs()?.serviceForContents(contents) ?? w.parkedMatch(contents);
      if (match) return match;
    }
    return undefined;
  }

  /** Tab ids granted to a running agent in `projectPath`, so the LRU discard leaves them loaded. */
  grantedTabIds(projectPath: string): ReadonlySet<string> {
    return this.grants.protectedIds(projectPath);
  }

  findByProject(path: string): ProjectWindow | undefined {
    for (const w of this.windows) if (w.project?.path === path) return w;
    return undefined;
  }

  all(): ProjectWindow[] {
    return [...this.windows];
  }

  settingsChanged(): void {
    this.syncGroveProjects();
    for (const w of this.windows) {
      w.applyZoom();
      w.applyGitSync();
    }
  }

  rebuildKeybindings(): void {
    for (const w of this.windows) w.rebuildKeybindings();
  }

  forget(projectWindow: ProjectWindow): void {
    this.windows.delete(projectWindow);
    for (const listener of this.closedListeners) listener(projectWindow);
  }

  private readonly projectListeners = new Set<() => void>();
  private readonly closedListeners = new Set<(w: ProjectWindow) => void>();

  /** A window opened or closed a project (the Projects page shows which are open). */
  onProjectsChanged(listener: () => void): void {
    this.projectListeners.add(listener);
  }

  onWindowClosed(listener: (w: ProjectWindow) => void): void {
    this.closedListeners.add(listener);
  }

  projectsChanged(): void {
    for (const listener of this.projectListeners) listener();
  }
}

/** Linux can confirm a pid's directory. Other platforms only know that the pid is alive. */
function processCwd(pid: number): string | null {
  if (process.platform !== 'linux') return null;
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** 16×16 green mark. The tray only exists while Grove processes outlive the windows. */
function trayImage() {
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR42mNgGDRAvzb6Pyl41IBRA4arAQMGAFvBI3AoyKJZAAAAAElFTkSuQmCC',
  );
}
