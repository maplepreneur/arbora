import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nativeImage,
  shell,
  WebContentsView,
  type BrowserWindow,
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
  type InspectorSelection,
  type LoadError,
  type NavigationState,
  pageIpcName,
  type PageMessageEnvelope,
  type ProblemEntry,
  type ProjectBrowserState,
  type Rect,
  type ScreenshotRequest,
  type ScreenshotResult,
  type ViewportEmulation,
  type ViewportPresetId,
} from '@arbora/shared';
import type { BrowserHistory } from './browser-history.js';
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
}

interface Metrics {
  readonly innerWidth: number;
  readonly devicePixelRatio: number;
}

/**
 * The browser panel: one `WebContentsView` per project window showing the user's dev server, plus
 * the instrumentation later stages build on (CDP, console/network ring buffers, screenshots,
 * device emulation and the private page channel).
 */
export class BrowserService {
  readonly view: WebContentsView;
  private state: NavigationState;
  private readonly consoleEntries = new RingBuffer<ProblemEntry>(PROBLEM_BUFFER_SIZE);
  private readonly networkEntries = new RingBuffer<ProblemEntry>(PROBLEM_BUFFER_SIZE);
  private readonly network = new NetworkTracker();
  private pendingProblems: ProblemEntry[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private nextProblemId = 1;
  private debuggerAttached = false;
  private emulation: ViewportEmulation | null = null;
  private appliedEmulation = 'null';
  private visible = false;
  private readonly pings = new Map<string, () => void>();
  private readonly overlayAcks = new Map<string, () => void>();
  private inspecting = false;
  /** When the main frame last committed a new document (console errors after this are "current"). */
  private navigatedAt = 0;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;
  private releaseFocusGuard: (() => void) | undefined;

  constructor(private readonly options: BrowserServiceOptions) {
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
    options.window.contentView.addChildView(this.view);

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

    this.disposers.push(options.attachInterceptor(this.contents));
    this.wireContents();
    this.update({});
    const lastUrl = options.initial?.lastUrl;
    if (lastUrl) void this.navigate(lastUrl);
  }

  get contents(): WebContents {
    return this.view.webContents;
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
    this.options.events.problemsCleared();
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
    if (url !== this.state.url) this.options.events.urlSuggested(url);
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
    const ui = this.options.window.webContents;
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
    };
    contents.on('focus', restore);
    contents.on('input-event', onInput);
    contents.on('did-stop-loading', onStop);
    this.releaseFocusGuard = release;
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
        else contents.openDevTools({ mode: 'detach' });
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
        contents.focus();
        break;
      default: {
        const unreachable: never = action;
        throw new Error(`Unhandled browser action ${String(unreachable)}`);
      }
    }
  }

  setPreset(preset: ViewportPresetId): void {
    if (preset === this.state.preset) return;
    this.update({ preset });
    this.scheduleSave();
  }

  /** Positions the view (window CSS px == DIP) and applies the preset's device emulation. */
  setBounds(rect: Rect | null, emulation: ViewportEmulation | null): void {
    const show = rect !== null && rect.width > 0 && rect.height > 0;
    if (show) {
      this.view.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    if (show !== this.visible) {
      this.visible = show;
      // Hidden views keep keyboard focus; hand it back to the app UI (e.g. the command palette).
      if (!show && this.contents.isFocused()) this.options.window.webContents.focus();
      this.view.setVisible(show);
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
        if (this.inspecting) this.contents.send(pageIpcName('inspector.start'), {});
        break;
      case 'pong':
        this.pings.get(message.payload.nonce)?.();
        this.pings.delete(message.payload.nonce);
        break;
      case 'inspector.selected':
        if (this.inspecting) this.options.events.inspectorSelected(message.payload);
        break;
      case 'inspector.cancelled':
        if (this.inspecting) this.options.events.inspectorCancelled();
        break;
      case 'inspector.overlayApplied':
        this.overlayAcks.get(message.payload.nonce)?.();
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
    for (const dispose of this.disposers.splice(0)) dispose();
    if (!this.options.window.isDestroyed()) this.options.window.contentView.removeChildView(this.view);
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

    contents.setWindowOpenHandler(({ url }) => {
      // Single-tab browser until Stage 11: local links stay in the panel, everything else goes to the OS.
      const normalized = normalizeUrl(url);
      if (normalized && new URL(normalized).origin === safeOrigin(this.state.url)) this.navigate(normalized);
      else if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:/.test(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());

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
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.options.history.record(url, contents.getTitle());
      this.update({ url });
      this.scheduleSave();
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
    this.options.events.state(this.state);
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

  private async applyEmulation(): Promise<void> {
    const key = JSON.stringify(this.emulation);
    if (!this.debuggerAttached || key === this.appliedEmulation) return;
    this.appliedEmulation = key;
    const dbg = this.contents.debugger;
    const emulation = this.emulation;
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

  private onCdpMessage(method: string, params: unknown): void {
    switch (method) {
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
      if (entries.length > 0) this.options.events.problemsAdded(entries);
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

  private async captureViewport(request: ScreenshotRequest): Promise<ScreenshotResult> {
    const [{ innerWidth }, captured] = await Promise.all([this.metrics(), this.contents.capturePage()]);
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
