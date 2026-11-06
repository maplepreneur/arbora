import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nativeImage,
  shell,
  WebContentsView,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type InputEvent,
  type NativeImage,
  type Session,
  type WebContents,
} from 'electron';
import {
  normalizeUrl,
  RingBuffer,
  stepZoom,
  type BrowserAction,
  type DesignCommand,
  type DesignOp,
  type DesignState,
  type InspectorSelection,
  type LoadError,
  type NavigationState,
  pageIpcName,
  type PageMessageEnvelope,
  type ProblemEntry,
  type ProjectBrowserState,
  type Rect,
  type RawSource,
  type ScreenshotRequest,
  type ScreenshotResult,
  type ViewportEmulation,
  type ViewportPresetId,
} from '@arbora/shared';
import type { BrowserHistory } from './browser-history.js';
import {
  allowedMapUrl,
  decodeDataUrl,
  fetchSourceMap,
  originalFromMap,
  resolveMappingUrl,
  sourceMappingUrl,
} from './script-map.js';
import {
  fromConsoleApiCalled,
  fromExceptionThrown,
  fromLogEntryAdded,
  NetworkTracker,
  type ProblemDraft,
} from './cdp-problems.js';
import { drawOutline, pngSize, scaleRect } from './image.js';

export const PROBLEM_BUFFER_SIZE = 500;
const FOCUS_GUARD_AFTER_LOAD_MS = 1000;
const PROBLEM_FLUSH_MS = 100;
const STATE_SAVE_DELAY_MS = 500;
const PING_TIMEOUT_MS = 2000;
/** The overlay toggle is answered two frames later; past this, capture anyway. */
const OVERLAY_ACK_TIMEOUT_MS = 500;
/** Chromium aborts the previous load when a new one starts; that is not a load error. */
const ERR_ABORTED = -3;
/** Isolated world for Arbora's own probes, so the page cannot tamper with the results. */
const PROBE_WORLD_ID = 1999;
/** Chromium refuses to capture textures taller than this many device pixels. */
const MAX_CAPTURE_HEIGHT = 16_384;
const HIGHLIGHT_THICKNESS_CSS = 2;

export interface BrowserServiceEvents {
  state(state: NavigationState): void;
  problemsAdded(entries: ProblemEntry[]): void;
  problemsCleared(): void;
  urlSuggested(url: string): void;
  /** Agent mode: the page's inspector reported a click. */
  inspectorSelected(selection: InspectorSelection): void;
  /** Agent mode: `Esc` reached the page's inspector. */
  inspectorCancelled(): void;
  /** Design mode mirrored its op list. */
  designState(state: DesignState): void;
  /** Design mode: Escape with nothing selected. */
  designExitRequested(): void;
  /** A navigation was refused because design edits are unsaved. */
  designNavigationBlocked(url: string): void;
  /** The document changed while design mode had nothing to keep. */
  designDocumentNavigated(): void;
  /** The live page view gained or lost the keyboard. Not sent while a focus guard will hand it back. */
  pageFocused(focused: boolean): void;
  /** A hidden view had the keyboard. The renderer reclaims it for the content pane when the page is not showing. */
  focusParked(): void;
  /** A submitted login form. Field names only; the values stay in the page until main reads them. */
  passwordOffer?(offer: { origin: string; usernameField: string | null; passwordField: string }): void;
}

export interface WindowOpenDecision {
  readonly action: 'deny' | 'allow';
  readonly overrideBrowserWindowOptions?: BrowserWindowConstructorOptions;
}

export interface BrowserServiceOptions {
  readonly window: BrowserWindow;
  readonly session: Session;
  readonly preloadPath: string;
  readonly projectPath: string;
  readonly history: BrowserHistory;
  readonly initial: ProjectBrowserState | undefined;
  readonly events: BrowserServiceEvents;
  /** Installs the keybinding interceptor on the page; returns a disposer. */
  readonly attachInterceptor: (contents: WebContents) => () => void;
  readonly saveState: (state: ProjectBrowserState) => void;
  /** Runs before page DevTools open; true means extensions were just loaded and the page must reload. */
  readonly beforeDevTools?: () => Promise<boolean>;
  /**
   * http(s) window.open. Returning a decision replaces the single-tab behaviour (same origin stays
   * in this tab, everything else goes to the OS). OAuth popups return `allow`.
   */
  readonly onWindowOpen?: (details: {
    url: string;
    disposition: string;
    features: string;
  }) => WindowOpenDecision | null;
  /** A popup BrowserWindow this page was allowed to open. */
  readonly onChildWindow?: (child: BrowserWindow) => void;
}

interface Metrics {
  readonly innerWidth: number;
  readonly devicePixelRatio: number;
}

/**
 * The browser panel: one `WebContentsView` per project, parked on the window while another project
 * shows, plus the instrumentation later stages build on (CDP, console/network ring buffers,
 * screenshots, device emulation and the private page channel).
 */
export class BrowserService {
  readonly view: WebContentsView;
  private hostWindow: BrowserWindow;
  private events: BrowserServiceEvents;
  private detachInterceptor: (() => void) | null = null;
  private state: NavigationState;
  private readonly consoleEntries = new RingBuffer<ProblemEntry>(PROBLEM_BUFFER_SIZE);
  private readonly networkEntries = new RingBuffer<ProblemEntry>(PROBLEM_BUFFER_SIZE);
  private readonly network = new NetworkTracker();
  private pendingProblems: ProblemEntry[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private nextProblemId = 1;
  private debuggerAttached = false;
  private debuggerDomain = false;
  private readonly scriptIds = new Map<string, string>();
  private emulation: ViewportEmulation | null = null;
  private appliedEmulation = 'null';
  private visible = false;
  private readonly pings = new Map<string, () => void>();
  private readonly overlayAcks = new Map<string, () => void>();
  private inspecting = false;
  private designing = false;
  /** Block document navigations while design edits are unsaved. */
  private designGuard = false;
  private designDraft: { ops: DesignOp[]; cursor: number } = { ops: [], cursor: 0 };
  /** When the main frame last committed a new document (console errors after this are "current"). */
  private navigatedAt = 0;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;
  private releaseFocusGuard: (() => void) | undefined;
  private readonly cdpListeners = new Set<(method: string, params: unknown) => void>();
  /** An agent's `browser_set_viewport` size; cleared when a preset is chosen. */
  private viewportOverride: { width: number; height: number; dpr: number } | null = null;
  private viewRect: Rect | null = null;
  /** Last `pageFocused` value sent, so blur/focus chatter does not spam the renderer. */
  private lastPageFocused = false;
  /** One reclaim notice per time the view is parked, even if Chromium focuses it again. */
  private parkedNotice = false;
  /** Stops `webContents.focus()` from re-entering the hidden-view focus handler. */
  private releasingFocus = false;

  constructor(private readonly options: BrowserServiceOptions) {
    this.hostWindow = options.window;
    this.events = options.events;
    this.view = new WebContentsView({
      webPreferences: {
        session: options.session,
        preload: options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.view.setVisible(false);
    this.view.setBackgroundColor('#ffffff');
    this.hostWindow.contentView.addChildView(this.view);

    this.state = {
      url: '',
      title: '',
      favicon: null,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomFactor: options.initial?.zoomFactor ?? 1,
      preset: options.initial?.preset ?? 'responsive',
      devToolsOpen: false,
      error: null,
      pageReady: false,
    };

    this.detachInterceptor = options.attachInterceptor(this.contents);
    this.wireContents();
    this.update({});
    const lastUrl = options.initial?.lastUrl;
    if (lastUrl) void this.navigate(lastUrl);
  }

  get contents(): WebContents {
    return this.view.webContents;
  }

  /**
   * Point this page at another window. The document stays loaded; only the host view, the key
   * interceptor and the event callbacks change.
   */
  rebind(
    window: BrowserWindow,
    events: BrowserServiceEvents,
    attachInterceptor: (contents: WebContents) => () => void,
  ): void {
    this.events = events;
    this.detachInterceptor?.();
    this.detachInterceptor = null;
    if (this.hostWindow !== window) {
      if (!this.hostWindow.isDestroyed()) this.hostWindow.contentView.removeChildView(this.view);
      this.hostWindow = window;
      if (!window.isDestroyed()) window.contentView.addChildView(this.view);
    }
    this.detachInterceptor = attachInterceptor(this.contents);
  }

  getState(): NavigationState {
    return this.state;
  }

  getConsole(): ProblemEntry[] {
    return this.consoleEntries.toArray();
  }

  getNetworkErrors(): ProblemEntry[] {
    return this.networkEntries.toArray();
  }

  clearProblems(): void {
    this.consoleEntries.clear();
    this.networkEntries.clear();
    this.pendingProblems = [];
    this.events.problemsCleared();
  }

  navigate(input: string): { ok: boolean; url?: string; error?: string } {
    const url = normalizeUrl(input);
    if (!url) return { ok: false, error: `Not an http(s) URL: ${input}` };
    // Failures are reported through `did-fail-load` and shown in the panel, not thrown.
    this.contents.loadURL(url).catch(() => undefined);
    return { ok: true, url };
  }

  /** A dev-server URL found elsewhere (the terminal in Stage 2). Loads it if nothing is loaded yet. */
  suggestUrl(input: string): boolean {
    const url = normalizeUrl(input);
    if (!url) return false;
    if (!this.state.url || this.state.error) {
      this.keepAppFocusDuringLoad();
      this.navigate(url);
      return true;
    }
    if (url !== this.state.url) this.events.urlSuggested(url);
    return false;
  }

  /**
   * Chromium focuses a view when it first loads a page; a background load must not take the keyboard.
   * On Windows that focus can land after `did-stop-loading`, so the guard outlives the load briefly
   * and ends early only when the user deliberately focuses the page.
   */
  private keepAppFocusDuringLoad(): void {
    const contents = this.contents;
    if (contents.isFocused()) return;
    this.releaseFocusGuard?.();
    const ui = this.hostWindow.webContents;
    const restore = (): void => {
      if (!contents.isDestroyed() && contents.isFocused() && !ui.isDestroyed()) ui.focus();
    };
    const onInput = (_event: unknown, input: InputEvent): void => {
      if (input.type === 'mouseDown') release();
    };
    let timer: NodeJS.Timeout | undefined;
    const onStop = (): void => {
      restore();
      clearTimeout(timer);
      timer = setTimeout(release, FOCUS_GUARD_AFTER_LOAD_MS);
    };
    const release = (): void => {
      clearTimeout(timer);
      if (!contents.isDestroyed()) {
        contents.off('focus', restore);
        contents.off('input-event', onInput);
        contents.off('did-stop-loading', onStop);
      }
      if (this.releaseFocusGuard === release) this.releaseFocusGuard = undefined;
      this.notifyPageFocus();
    };
    contents.on('focus', restore);
    contents.on('input-event', onInput);
    contents.on('did-stop-loading', onStop);
    this.releaseFocusGuard = release;
  }

  private async openDevTools(contents: WebContents): Promise<void> {
    try {
      const reload = (await this.options.beforeDevTools?.()) ?? false;
      if (reload && /^https?:/.test(contents.getURL())) contents.reload();
    } catch (error) {
      console.warn(`[browser] DevTools extensions: ${(error as Error).message}`);
    }
    if (!contents.isDestroyed() && !contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' });
  }

  action(action: BrowserAction): void {
    const contents = this.contents;
    switch (action) {
      case 'back':
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        break;
      case 'forward':
        if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
        break;
      case 'reload':
        if (this.reloadFailed()) break;
        contents.reload();
        break;
      case 'hardReload':
        if (this.reloadFailed()) break;
        contents.reloadIgnoringCache();
        break;
      case 'stop':
        contents.stop();
        break;
      case 'openExternal':
        if (/^https?:/.test(this.state.url)) void shell.openExternal(this.state.url);
        break;
      case 'toggleDevTools':
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else void this.openDevTools(contents);
        break;
      case 'zoomIn':
        this.setZoom(stepZoom(this.state.zoomFactor, 1));
        break;
      case 'zoomOut':
        this.setZoom(stepZoom(this.state.zoomFactor, -1));
        break;
      case 'zoomReset':
        this.setZoom(1);
        break;
      case 'focusPage':
        this.releaseFocusGuard?.();
        // A parked view (error, empty, menu) keeps the keyboard and drops `before-input-event`.
        if (this.visible) contents.focus();
        else this.releaseParkedFocus();
        break;
      default: {
        const unreachable: never = action;
        throw new Error(`Unhandled browser action ${String(unreachable)}`);
      }
    }
  }

  setPreset(preset: ViewportPresetId): void {
    const hadOverride = this.viewportOverride !== null;
    this.viewportOverride = null;
    if (hadOverride) void this.applyEmulation();
    if (preset === this.state.preset) return;
    this.update({ preset });
    this.scheduleSave();
  }

  /**
   * Emulates a custom CSS viewport (agent tools), scaled down to fit the panel like the presets.
   * The renderer keeps the view rect; choosing a preset ends the override.
   */
  setViewportOverride(size: { width: number; height: number; dpr: number }): void {
    this.viewportOverride = size;
    void this.applyEmulation();
  }

  /** When the current document committed; console entries from before belong to the previous page. */
  get navigatedAtTime(): number {
    return this.navigatedAt;
  }

  /**
   * The page's CDP connection for the agent browser tools. Shares Arbora's debugger session (the
   * Problems tab keeps working); unavailable while DevTools holds the debugger.
   */
  async cdp(): Promise<{
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(listener: (method: string, params: unknown) => void): () => void;
  }> {
    if (this.contents.isDestroyed()) throw new Error('The browser panel is closed');
    if (!this.debuggerAttached) await this.attachDebugger();
    if (!this.debuggerAttached) {
      throw new Error(
        this.contents.isDevToolsOpened()
          ? 'DevTools is open on the page and holds the debugger; ask the user to close DevTools.'
          : 'The browser debugger is not available (is a page loaded?)',
      );
    }
    const dbg = this.contents.debugger;
    return {
      send: (method, params) => dbg.sendCommand(method, params) as Promise<unknown>,
      on: (listener) => {
        this.cdpListeners.add(listener);
        return () => this.cdpListeners.delete(listener);
      },
    };
  }

  /** Resolves once the page stops loading (or fails), or after `timeoutMs`. */
  waitForLoad(timeoutMs: number): Promise<void> {
    const contents = this.contents;
    return new Promise((resolveLoad) => {
      const done = (): void => {
        clearTimeout(timer);
        if (!contents.isDestroyed()) {
          contents.off('did-stop-loading', done);
          contents.off('did-fail-load', onFail);
        }
        resolveLoad();
      };
      const onFail = (
        _event: unknown,
        code: number,
        _description: string,
        _url: string,
        isMainFrame: boolean,
      ): void => {
        if (isMainFrame && code !== ERR_ABORTED) done();
      };
      const timer = setTimeout(done, timeoutMs);
      contents.on('did-stop-loading', done);
      contents.on('did-fail-load', onFail);
    });
  }

  /**
   * The page view is hidden but still focused. Hand the keyboard to the app window and tell the
   * renderer once, so it can focus the content pane instead of leaving chords in the parked view.
   */
  private releaseParkedFocus(): void {
    if (this.releasingFocus) return;
    this.releasingFocus = true;
    try {
      const ui = this.hostWindow.webContents;
      if (!ui.isDestroyed()) ui.focus();
      if (!this.parkedNotice) {
        this.parkedNotice = true;
        this.events.focusParked();
      }
    } finally {
      this.releasingFocus = false;
    }
  }

  /** Tells the renderer whether the live page currently has the keyboard. */
  private notifyPageFocus(): void {
    if (this.disposed || this.contents.isDestroyed()) return;
    const focused = this.visible && this.contents.isFocused() && !this.releaseFocusGuard;
    if (focused === this.lastPageFocused) return;
    this.lastPageFocused = focused;
    this.events.pageFocused(focused);
  }

  /** Positions the view (window CSS px == DIP) and applies the preset's device emulation. */
  setBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    const show = rect !== null && rect.width > 0 && rect.height > 0;
    if (show) {
      this.viewRect = rect;
      this.view.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    if (show !== this.visible) {
      this.visible = show;
      if (show) {
        this.parkedNotice = false;
        this.view.setVisible(true);
      } else {
        // Hide first. Focusing the host while the view is still visible does not stick, and a
        // hidden view that keeps the keyboard never delivers `before-input-event`.
        const wasFocused = !this.contents.isDestroyed() && this.contents.isFocused();
        this.view.setVisible(false);
        const stillFocused = !this.contents.isDestroyed() && this.contents.isFocused();
        if (wasFocused || stillFocused) this.releaseParkedFocus();
      }
    }
    this.emulation = emulation;
    void this.applyEmulation();
  }

  /**
   * Gives a hidden tab the same box as the visible one. Bounds stay put so CDP can capture it;
   * the view stays invisible and does not take the keyboard.
   */
  parkSize(rect: Rect, emulation: ViewportEmulation | null): void {
    this.viewRect = rect;
    this.view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    if (this.visible) {
      this.visible = false;
      const wasFocused = !this.contents.isDestroyed() && this.contents.isFocused();
      this.view.setVisible(false);
      const stillFocused = !this.contents.isDestroyed() && this.contents.isFocused();
      if (wasFocused || stillFocused) this.releaseParkedFocus();
    } else {
      this.view.setVisible(false);
    }
    this.emulation = emulation;
    void this.applyEmulation();
  }

  async screenshot(request: ScreenshotRequest): Promise<ScreenshotResult> {
    if (!this.state.url || this.state.error) throw new Error('No page is loaded in the browser panel');
    const result =
      request.mode === 'fullPage' ? await this.captureFullPage(request) : await this.captureViewport(request);
    if (!request.save) return result;
    return { ...result, path: this.writeScreenshotFile(Buffer.from(result.pngBase64, 'base64'), request.mode, 'png') };
  }

  /** Round trip over the private page channel; resolves false if the preload does not answer. */
  ping(): Promise<boolean> {
    const nonce = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pings.delete(nonce);
        resolve(false);
      }, PING_TIMEOUT_MS);
      this.pings.set(nonce, () => {
        clearTimeout(timer);
        resolve(true);
      });
      this.contents.send(pageIpcName('ping'), { nonce });
    });
  }

  /** Agent mode: (re)starts or stops the page inspector. A new document is started again on `ready`. */
  setInspecting(active: boolean): void {
    this.inspecting = active;
    if (!this.contents.isDestroyed())
      this.contents.send(pageIpcName(active ? 'inspector.start' : 'inspector.stop'), {});
  }

  /** Design mode: show the overlay, re-applying `saved` when it is a crash draft. */
  beginDesign(saved: { ops: DesignOp[]; cursor: number }): void {
    this.designing = true;
    this.designGuard = saved.cursor > 0;
    this.designDraft = { ops: [...saved.ops], cursor: saved.cursor };
    this.sendDesign('design.start', saved);
  }

  /** Design mode: remove the overlay. `revert` restores the DOM. */
  endDesign(revert: boolean): void {
    this.designing = false;
    this.designGuard = false;
    this.designDraft = { ops: [], cursor: 0 };
    this.sendDesign('design.stop', { revert });
  }

  /** The latest op list, replayed if the document reloads while design mode is still on. */
  rememberDesign(saved: { ops: DesignOp[]; cursor: number }): void {
    this.designDraft = { ops: [...saved.ops], cursor: saved.cursor };
  }

  setDesignGuard(active: boolean): void {
    this.designGuard = active;
  }

  sendDesignCommand(command: DesignCommand): void {
    this.sendDesign('design.command', command);
  }

  /** Shows or hides the design overlay; resolves once the page has painted. */
  setDesignOverlayVisible(visible: boolean): Promise<void> {
    const nonce = randomUUID();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.overlayAcks.delete(nonce);
        resolve();
      };
      const timer = setTimeout(done, OVERLAY_ACK_TIMEOUT_MS);
      this.overlayAcks.set(nonce, done);
      this.sendDesign('design.setOverlay', { visible, nonce });
    });
  }

  private sendDesign(
    name: 'design.start' | 'design.stop' | 'design.command' | 'design.setOverlay',
    payload: unknown,
  ): void {
    if (!this.contents.isDestroyed()) this.contents.send(pageIpcName(name), payload);
  }

  /** Shows or hides the inspector overlay; resolves once the page has painted without it. */
  setOverlayVisible(visible: boolean): Promise<void> {
    const nonce = randomUUID();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.overlayAcks.delete(nonce);
        resolve();
      };
      const timer = setTimeout(done, OVERLAY_ACK_TIMEOUT_MS);
      this.overlayAcks.set(nonce, done);
      this.contents.send(pageIpcName('inspector.setOverlay'), { visible, nonce });
    });
  }

  /** Console errors and exceptions since the current document loaded, oldest first. */
  consoleErrorsSinceNavigation(): string[] {
    return this.consoleEntries
      .toArray()
      .filter((e) => e.level === 'error' && e.timestamp >= this.navigatedAt)
      .map((e) => (e.url ? `${e.message} (${e.url}${e.line !== undefined ? `:${e.line}` : ''})` : e.message));
  }

  /** Writes an image to `<project>/.arbora/screenshots/` (git-ignored) and returns its path. */
  writeScreenshotFile(data: Buffer, label: string, extension: 'png' | 'jpg'): string {
    const dir = join(this.options.projectPath, '.arbora', 'screenshots');
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '# Arbora screenshots are local artefacts\n*\n');
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.${extension}`);
    writeFileSync(file, data);
    return file;
  }

  handlePageMessage(message: PageMessageEnvelope): void {
    switch (message.name) {
      case 'ready':
        this.update({ pageReady: true });
        if (this.designing) this.sendDesign('design.start', this.designDraft);
        else if (this.inspecting) this.contents.send(pageIpcName('inspector.start'), {});
        break;
      case 'pong':
        this.pings.get(message.payload.nonce)?.();
        this.pings.delete(message.payload.nonce);
        break;
      case 'inspector.selected':
        if (this.inspecting) this.events.inspectorSelected(message.payload);
        break;
      case 'inspector.cancelled':
        if (this.inspecting) this.events.inspectorCancelled();
        break;
      case 'inspector.overlayApplied':
        this.overlayAcks.get(message.payload.nonce)?.();
        break;
      case 'design.state':
        if (this.designing) this.events.designState(message.payload);
        break;
      case 'design.exitRequested':
        if (this.designing) this.events.designExitRequested();
        break;
      case 'design.overlayApplied':
        this.overlayAcks.get(message.payload.nonce)?.();
        break;
      case 'passwords.offerSave':
        this.events.passwordOffer?.(message.payload);
        break;
      default: {
        const unreachable: never = message;
        throw new Error(`Unhandled page message ${JSON.stringify(unreachable)}`);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.flushTimer);
    const pendingSave = this.saveTimer !== undefined;
    clearTimeout(this.saveTimer);
    this.releaseFocusGuard?.();
    this.detachInterceptor?.();
    this.detachInterceptor = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    if (!this.hostWindow.isDestroyed()) this.hostWindow.contentView.removeChildView(this.view);
    if (!this.contents.isDestroyed()) {
      if (this.debuggerAttached) {
        try {
          this.contents.debugger.detach();
        } catch {
          // Already detached by the closing target.
        }
      }
      this.contents.close();
    }
    // After closing: an orphaned page's webContents would keep Electron from exiting.
    if (pendingSave) this.saveNow();
  }

  private wireContents(): void {
    const contents = this.contents;
    const refresh = (): void => this.update({});

    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      const decision = this.options.onWindowOpen?.({ url, disposition, features });
      if (!decision) {
        const normalized = normalizeUrl(url);
        if (normalized && new URL(normalized).origin === safeOrigin(this.state.url)) this.navigate(normalized);
        else if (/^https?:/.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      }
      if (decision.action === 'allow') {
        return {
          action: 'allow',
          ...(decision.overrideBrowserWindowOptions
            ? { overrideBrowserWindowOptions: decision.overrideBrowserWindowOptions }
            : {}),
        };
      }
      return { action: 'deny' };
    });
    contents.on('did-create-window', (child) => {
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.options.onChildWindow?.(child);
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:/.test(url)) {
        event.preventDefault();
        return;
      }
      if (this.designGuard && url !== this.state.url) {
        event.preventDefault();
        this.events.designNavigationBlocked(url);
      }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('focus', () => {
      if (!this.visible) {
        this.releaseParkedFocus();
        return;
      }
      this.notifyPageFocus();
    });
    contents.on('blur', () => this.notifyPageFocus());

    contents.on('did-start-loading', () => {
      void this.attachDebugger();
      this.update({ loading: true });
    });
    contents.on('did-stop-loading', () => this.update({ loading: false }));
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.update({ error: null, pageReady: false, favicon: null });
    });
    contents.on('did-navigate', (_event, url) => {
      this.navigatedAt = Date.now();
      this.options.history.record(url, contents.getTitle());
      this.update({ url, title: contents.getTitle() });
      this.scheduleSave();
      if (this.designing && !this.designGuard) this.events.designDocumentNavigated();
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      const previous = this.state.url;
      this.options.history.record(url, contents.getTitle());
      this.update({ url });
      this.scheduleSave();
      if (this.designing && this.designGuard && url !== previous) this.events.designNavigationBlocked(url);
    });
    contents.on('did-finish-load', () => {
      // Chromium keeps zoom per origin; re-apply the panel's zoom after cross-origin loads.
      if (Math.abs(contents.getZoomFactor() - this.state.zoomFactor) > 0.001) {
        contents.setZoomFactor(this.state.zoomFactor);
      }
      refresh();
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      const error: LoadError = { code, description: description || 'Load failed', url };
      this.update({ error, loading: false, url: this.state.url || url });
    });
    contents.on('render-process-gone', (_event, details) => {
      this.debuggerAttached = false;
      this.update({
        error: { code: -1, description: `The page crashed (${details.reason})`, url: this.state.url },
        loading: false,
      });
    });
    contents.on('page-title-updated', (_event, title) => {
      this.options.history.setTitle(this.state.url, title);
      this.update({ title });
    });
    contents.on('page-favicon-updated', (_event, favicons) => this.update({ favicon: favicons[0] ?? null }));
    contents.on('devtools-opened', () => this.update({ devToolsOpen: true }));
    contents.on('devtools-closed', () => {
      this.update({ devToolsOpen: false });
      void this.attachDebugger();
    });

    contents.debugger.on('detach', () => {
      this.debuggerAttached = false;
      this.debuggerDomain = false;
      this.scriptIds.clear();
      this.appliedEmulation = 'null';
    });
    contents.debugger.on('message', (_event, method, params) => this.onCdpMessage(method, params));
  }

  private reloadFailed(): boolean {
    // After a failed first load there is no committed entry to reload; retry the failed URL instead.
    if (!this.state.error) return false;
    this.navigate(this.state.error.url || this.state.url);
    return true;
  }

  private setZoom(zoomFactor: number): void {
    this.contents.setZoomFactor(zoomFactor);
    this.update({ zoomFactor });
    this.scheduleSave();
  }

  private update(patch: Partial<NavigationState>): void {
    if (this.disposed || this.contents.isDestroyed()) return;
    const history = this.contents.navigationHistory;
    this.state = {
      ...this.state,
      ...patch,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    };
    this.events.state(this.state);
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), STATE_SAVE_DELAY_MS);
  }

  private saveNow(): void {
    this.saveTimer = undefined;
    this.options.saveState({
      ...(this.state.url ? { lastUrl: this.state.url } : {}),
      preset: this.state.preset,
      zoomFactor: this.state.zoomFactor,
    });
  }

  private async attachDebugger(): Promise<void> {
    const dbg = this.contents.debugger;
    if (this.debuggerAttached || this.contents.isDestroyed()) return;
    try {
      dbg.attach('1.3');
    } catch (error) {
      // DevTools (or another client) holds the debugger; `devtools-closed` retries.
      console.warn(`[browser] debugger attach failed: ${(error as Error).message}`);
      return;
    }
    this.debuggerAttached = true;
    this.appliedEmulation = 'null';
    try {
      await Promise.all([
        dbg.sendCommand('Runtime.enable'),
        dbg.sendCommand('Log.enable'),
        // Metadata only: cap the buffers so large pages cannot flood main with bodies.
        dbg.sendCommand('Network.enable', { maxTotalBufferSize: 2_000_000, maxResourceBufferSize: 200_000 }),
        dbg.sendCommand('Page.enable'),
      ]);
      await this.applyEmulation();
    } catch (error) {
      console.warn(`[browser] CDP setup failed: ${(error as Error).message}`);
    }
  }

  /** The renderer's preset emulation, or the agent's custom size fitted into the view. */
  private effectiveEmulation(): ViewportEmulation | null {
    const override = this.viewportOverride;
    if (!override) return this.emulation;
    const rect = this.viewRect;
    const scale = rect ? Math.min(1, rect.width / override.width, rect.height / override.height) : 1;
    return {
      width: override.width,
      height: override.height,
      deviceScaleFactor: override.dpr,
      mobile: false,
      scale: Math.max(0.05, scale),
    };
  }

  private async applyEmulation(): Promise<void> {
    const emulation = this.effectiveEmulation();
    const key = JSON.stringify(emulation);
    if (!this.debuggerAttached || key === this.appliedEmulation) return;
    this.appliedEmulation = key;
    const dbg = this.contents.debugger;
    try {
      if (emulation) {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: emulation.width,
          height: emulation.height,
          deviceScaleFactor: emulation.deviceScaleFactor,
          mobile: emulation.mobile,
          scale: emulation.scale,
          screenWidth: emulation.width,
          screenHeight: emulation.height,
        });
      } else {
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
      }
      const touch = emulation?.mobile ?? false;
      await dbg.sendCommand(
        'Emulation.setTouchEmulationEnabled',
        touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
      await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: touch, configuration: 'mobile' });
    } catch (error) {
      this.appliedEmulation = 'null';
      console.warn(`[browser] emulation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Maps a position in a page script back to the original file named by its source map.
   * Returns null when the script, the map, or the position cannot be resolved.
   */
  async mapGeneratedPosition(file: string, line: number, column: number): Promise<RawSource | null> {
    try {
      if (!(await this.ensureDebuggerDomain())) return null;
      const scriptId = this.scriptIds.get(file);
      if (!scriptId) return null;
      const body = (await this.contents.debugger.sendCommand('Debugger.getScriptSource', { scriptId })) as {
        scriptSource?: string;
      };
      const mapping = body.scriptSource ? sourceMappingUrl(body.scriptSource) : null;
      if (!mapping) return null;
      const mapUrl = resolveMappingUrl(file, mapping);
      if (!mapUrl || !allowedMapUrl(file, mapUrl)) return null;
      const mapText = mapUrl.startsWith('data:') ? decodeDataUrl(mapUrl) : await fetchSourceMap(mapUrl);
      if (!mapText) return null;
      const original = originalFromMap(mapText, mapUrl, line, column);
      if (!original) return null;
      return { file: original.source, line: original.line, column: original.column };
    } catch {
      return null;
    }
  }

  private rememberScript(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const { scriptId, url } = params as { scriptId?: unknown; url?: unknown };
    if (typeof scriptId !== 'string' || typeof url !== 'string' || !url) return;
    this.scriptIds.set(url, scriptId);
  }

  private async ensureDebuggerDomain(): Promise<boolean> {
    if (!this.debuggerAttached) await this.attachDebugger();
    if (!this.debuggerAttached || this.contents.isDestroyed()) return false;
    if (this.debuggerDomain) return true;
    this.debuggerDomain = true;
    try {
      await this.contents.debugger.sendCommand('Debugger.enable');
      // `scriptParsed` is delivered as a message. Let it land before the lookup.
      await new Promise((resolve) => setImmediate(resolve));
    } catch (error) {
      this.debuggerDomain = false;
      throw error;
    }
    return true;
  }

  private onCdpMessage(method: string, params: unknown): void {
    for (const listener of this.cdpListeners) listener(method, params);
    switch (method) {
      case 'Debugger.scriptParsed':
        this.rememberScript(params);
        break;
      case 'Runtime.consoleAPICalled':
        this.addProblem(this.consoleEntries, fromConsoleApiCalled(params));
        break;
      case 'Runtime.exceptionThrown':
        this.addProblem(this.consoleEntries, fromExceptionThrown(params));
        break;
      case 'Log.entryAdded':
        this.addProblem(this.consoleEntries, fromLogEntryAdded(params));
        break;
      default:
        if (method.startsWith('Network.')) this.addProblem(this.networkEntries, this.network.handle(method, params));
    }
  }

  private addProblem(buffer: RingBuffer<ProblemEntry>, draft: ProblemDraft | undefined): void {
    if (!draft) return;
    const entry: ProblemEntry = { ...draft, id: this.nextProblemId++ };
    buffer.push(entry);
    this.pendingProblems.push(entry);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      const entries = this.pendingProblems.splice(0).slice(-PROBLEM_BUFFER_SIZE);
      if (entries.length > 0) this.events.problemsAdded(entries);
    }, PROBLEM_FLUSH_MS);
  }

  private async metrics(): Promise<Metrics> {
    const result: unknown = await this.contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [
      { code: '({ innerWidth: window.innerWidth, devicePixelRatio: window.devicePixelRatio })' },
    ]);
    const metrics = result as Partial<Metrics> | null;
    if (!metrics?.innerWidth || !metrics.devicePixelRatio) throw new Error('Could not measure the page');
    return { innerWidth: metrics.innerWidth, devicePixelRatio: metrics.devicePixelRatio };
  }

  /**
   * Viewport PNG plus the page's CSS size. A parked tab is captured with CDP, because
   * `capturePage()` on a hidden view is empty.
   */
  async captureQuiet(): Promise<{ png: Buffer; cssWidth: number; cssHeight: number }> {
    const hidden = !this.visible;
    const rect = this.viewRect;
    // A hidden view does not paint, so `capturePage()` is empty and CDP waits forever. Put it
    // behind the visible tab, at the same size, just long enough to paint a frame.
    if (hidden) {
      const width = Math.max(1, Math.round(rect?.width ?? 800));
      const height = Math.max(1, Math.round(rect?.height ?? 600));
      this.view.setBounds({ x: Math.round(rect?.x ?? 0), y: Math.round(rect?.y ?? 0), width, height });
      this.hostWindow.contentView.addChildView(this.view, 0);
      this.view.setVisible(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    try {
      const image = await Promise.race([
        this.contents.capturePage(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Screenshot timed out')), 8_000)),
      ]);
      const size = image.getSize();
      if (size.width === 0 || size.height === 0) throw new Error('The tab screenshot was empty');
      const { innerWidth } = await this.metrics();
      const dpr = innerWidth > 0 ? size.width / innerWidth : 1;
      return {
        png: image.toPNG(),
        cssWidth: dpr > 0 ? size.width / dpr : size.width,
        cssHeight: dpr > 0 ? size.height / dpr : size.height,
      };
    } finally {
      if (hidden) {
        this.view.setVisible(false);
        const ui = this.hostWindow.webContents;
        if (!ui.isDestroyed()) ui.focus();
      }
    }
  }

  /** CSS selectors for the login form, read in the isolated world. No field values. */
  async loginFields(): Promise<{ username: string | null; password: string | null; otp: string | null }> {
    const value: unknown = await this.contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [
      {
        code: `(() => {
          const css = (el) => {
            if (el.id) return '#' + CSS.escape(el.id);
            if (el.name) return 'input[name="' + CSS.escape(el.name) + '"]';
            return el.type === 'password' ? 'input[type="password"]' : 'input[type="text"], input[type="email"]';
          };
          const inputs = [...document.querySelectorAll('input')];
          const otp = inputs.find((input) => {
            if (input.type === 'hidden' || input.type === 'password') return false;
            const blob = (input.name + ' ' + input.id + ' ' + (input.getAttribute('autocomplete') || '')).toLowerCase();
            return blob.includes('otp') || blob.includes('totp') || blob.includes('one-time-code');
          });
          const password = document.querySelector('input[type="password"]');
          if (!password) return { username: null, password: null, otp: otp ? css(otp) : null };
          const user = [...inputs.slice(0, inputs.indexOf(password))].reverse().find((input) => input.type !== 'hidden' && input.type !== 'password' && input !== otp);
          return { username: user ? css(user) : null, password: css(password), otp: otp ? css(otp) : null };
        })()`,
      },
    ]);
    if (!value || typeof value !== 'object') return { username: null, password: null, otp: null };
    const record = value as { username?: unknown; password?: unknown; otp?: unknown };
    return {
      username: typeof record.username === 'string' ? record.username : null,
      password: typeof record.password === 'string' ? record.password : null,
      otp: typeof record.otp === 'string' ? record.otp : null,
    };
  }

  async pressEnter(selector = 'input[type="password"]'): Promise<void> {
    // One submit. A synthesized Enter plus requestSubmit runs the listener twice, and the
    // second pass sees a one-time-code field the first pass just added, still empty.
    await this.contents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)})?.form?.requestSubmit?.()`,
    );
  }

  /** Types into the focused field. The text is not sent to the renderer. */
  async insertText(selector: string, value: string): Promise<void> {
    // A parked tab's focused field is not the one we just queried. Typing there can land in
    // the password box. Set the named field directly instead.
    if (!this.visible) {
      if ((await this.writeField(selector, value)) !== true) throw new Error('Could not fill the login field');
      return;
    }
    if (!this.debuggerAttached) await this.attachDebugger();
    if (!this.debuggerAttached) throw new Error('Filling a login needs the debugger; close DevTools and retry');
    const cdp = this.contents.debugger;
    await cdp.sendCommand('DOM.enable').catch(() => undefined);
    const doc = (await cdp.sendCommand('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const rootId = doc.root?.nodeId;
    if (rootId === undefined) throw new Error('The page is not ready to fill');
    const queried = (await cdp.sendCommand('DOM.querySelector', { nodeId: rootId, selector })) as { nodeId?: number };
    if (!queried.nodeId) throw new Error('Could not find the login field');
    const described = (await cdp.sendCommand('DOM.describeNode', { nodeId: queried.nodeId })) as {
      node?: { backendNodeId?: number };
    };
    const backendNodeId = described.node?.backendNodeId;
    if (backendNodeId === undefined) throw new Error('Could not find the login field');
    await cdp.sendCommand('DOM.focus', { backendNodeId });
    if (value) await cdp.sendCommand('Input.insertText', { text: value });
    if ((await this.fieldValue(selector)) === value) return;
    if ((await this.writeField(selector, value)) !== true) throw new Error('Could not fill the login field');
  }

  /** Sets a field in the isolated world. The value never goes to the renderer. */
  private async writeField(selector: string, value: string): Promise<unknown> {
    return this.contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [
      {
        code: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
          if (setter) setter.call(el, ${JSON.stringify(value)});
          else el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === ${JSON.stringify(value)};
        })()`,
      },
    ]);
  }

  /** Selected text and visible page text, for a tab the user sent to an agent. Truncate before logging. */
  async pageSummary(): Promise<{ selection: string; text: string }> {
    const value: unknown = await this.contents.executeJavaScript(
      `({ selection: window.getSelection()?.toString() ?? '', text: document.body?.innerText ?? '' })`,
    );
    if (!value || typeof value !== 'object') return { selection: '', text: '' };
    const record = value as { selection?: unknown; text?: unknown };
    return {
      selection: typeof record.selection === 'string' ? record.selection : '',
      text: typeof record.text === 'string' ? record.text : '',
    };
  }

  /**
   * The current value of a named login field, read in the isolated world. The page sends a name
   * or id, not a CSS selector, and the value never goes to the renderer.
   */
  async namedFieldValue(name: string): Promise<string> {
    const value: unknown = await this.contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [
      {
        code: `(() => {
          const name = ${JSON.stringify(name)};
          const el =
            document.querySelector('input[name="' + CSS.escape(name) + '"]') || document.getElementById(name);
          return el && 'value' in el ? String(el.value) : '';
        })()`,
      },
    ]);
    return typeof value === 'string' ? value : '';
  }

  /** The current value of a field, read in the isolated world. Never forward this to the renderer. */
  async fieldValue(selector: string): Promise<string> {
    const value: unknown = await this.contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [
      { code: `document.querySelector(${JSON.stringify(selector)})?.value ?? ''` },
    ]);
    return typeof value === 'string' ? value : '';
  }

  private async captureSurface(): Promise<NativeImage> {
    if (this.visible) return this.contents.capturePage();
    this.contents.setBackgroundThrottling(false);
    try {
      if (!this.debuggerAttached) await this.attachDebugger();
      if (!this.debuggerAttached)
        throw new Error('A background tab needs the debugger to capture; close DevTools and retry');
      const shot = (await this.contents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      })) as { data: string };
      return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
    } finally {
      this.contents.setBackgroundThrottling(true);
    }
  }

  private async captureViewport(request: ScreenshotRequest): Promise<ScreenshotResult> {
    const [{ innerWidth }, captured] = await Promise.all([this.metrics(), this.captureSurface()]);
    let pixels = toPixels(captured);
    const dpr = pixels.width / innerWidth;
    let highlight = request.highlight;
    if (request.mode === 'element') {
      if (!request.rect) throw new Error('Element screenshots need a rect');
      pixels = cropPixels(pixels, scaleRect(request.rect, dpr));
      if (highlight) highlight = { ...highlight, x: highlight.x - request.rect.x, y: highlight.y - request.rect.y };
    }
    if (highlight)
      drawOutline(pixels.bitmap, pixels.width, pixels.height, scaleRect(highlight, dpr), HIGHLIGHT_THICKNESS_CSS * dpr);
    return encode(pixels, dpr);
  }

  private async captureFullPage(request: ScreenshotRequest): Promise<ScreenshotResult> {
    if (!this.debuggerAttached) await this.attachDebugger();
    if (!this.debuggerAttached) throw new Error('Full-page screenshots need the debugger; close DevTools and retry');
    const dbg = this.contents.debugger;
    const layout = (await dbg.sendCommand('Page.getLayoutMetrics')) as {
      cssContentSize: { width: number; height: number };
    };
    const { innerWidth, devicePixelRatio } = await this.metrics();
    const width = Math.ceil(Math.max(layout.cssContentSize.width, innerWidth));
    const height = Math.ceil(Math.min(layout.cssContentSize.height, MAX_CAPTURE_HEIGHT / devicePixelRatio));
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })) as { data: string };
    const pixels = toPixels(nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64')));
    const dpr = pixels.width / width;
    if (request.highlight) {
      drawOutline(
        pixels.bitmap,
        pixels.width,
        pixels.height,
        scaleRect(request.highlight, dpr),
        HIGHLIGHT_THICKNESS_CSS * dpr,
      );
    }
    return encode(pixels, dpr);
  }
}

interface Pixels {
  readonly bitmap: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Raw BGRA pixels at device resolution, independent of the image's scale-factor bookkeeping. */
function toPixels(image: NativeImage): Pixels {
  if (image.isEmpty()) throw new Error('The capture was empty (is the browser panel visible?)');
  const { width, height } = pngSize(image.toPNG());
  const bitmap = image.toBitmap();
  if (bitmap.length !== width * height * 4) throw new Error('Unexpected bitmap layout');
  return { bitmap, width, height };
}

function cropPixels(pixels: Pixels, rect: Rect): Pixels {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.min(pixels.width, Math.round(rect.x + rect.width)) - x;
  const height = Math.min(pixels.height, Math.round(rect.y + rect.height)) - y;
  if (width <= 0 || height <= 0) throw new Error('The element rect is outside the visible page');
  const bitmap = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * pixels.width + x) * 4;
    pixels.bitmap.copy(bitmap, row * width * 4, start, start + width * 4);
  }
  return { bitmap, width, height };
}

function encode(pixels: Pixels, dpr: number): ScreenshotResult {
  const image = nativeImage.createFromBitmap(pixels.bitmap, { width: pixels.width, height: pixels.height });
  return {
    pngBase64: image.toPNG().toString('base64'),
    width: pixels.width,
    height: pixels.height,
    dpr: Math.round(dpr * 1000) / 1000,
  };
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
