import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nativeImage, type NativeImage } from 'electron';
import { elementSourceFunction, type ElementSourceFacts } from '@arbora/browser-bridge';
import {
  callOnElement,
  ToolError,
  type Box,
  type BrowserToolHost,
  type Cdp,
  type DevServerInfo,
  type GuardedTool,
  type LogEntry,
  type PageInfo,
  type PermissionRequest,
  type ScreenshotImage,
  type TabCapture,
  type TabSummary,
  type ScreenshotMode,
  type TerminalRunResult,
  type ToolPolicy,
  type TraceStepInput,
  type ViewportRequest,
} from '@arbora/mcp-browser-server/host';
import { resolveInsideRoot } from '@arbora/acp-client';
import {
  ACTION_TRACE_IMAGE_LIMIT,
  stripAnsi,
  viewportPreset,
  type ActionTraceImage,
  type BrowserToolPolicy,
  type ProblemEntry,
  type PasswordsSettings,
  type ProjectSettings,
  type SourceCandidate,
} from '@arbora/shared';
import { MAX_IMAGE_EDGE } from '../agent-mode/agent-mode-service.js';
import { resolveSource } from '../agent-mode/source-paths.js';
import { searchTerms, type SearchTerm } from '../agent-mode/source-search.js';
import type { BrowserService } from '../browser/browser-service.js';
import type { BrowserTabs } from '../browser/browser-tabs.js';
import type { TabGrantStore } from '../browser/tab-grants.js';
import type { OnePasswordProvider } from '../passwords/one-password.js';
import type { SecretMask } from '../passwords/secret-mask.js';
import { fitWithin } from '../browser/image.js';
import type { DevServer } from '../terminal/dev-server.js';
import type { TerminalService } from '../terminal/terminal-service.js';

/** Loads that take longer than this return anyway; the agent can `browser_wait_for`. */
const LOAD_TIMEOUT_MS = 15_000;
const DEV_URL_TIMEOUT_MS = 60_000;
const PNG_BYTE_LIMIT = 1_500_000;
const JPEG_QUALITY = 85;
/** Long edge of the thumbnail mirrored into the agent panel. */
export const PREVIEW_EDGE = 360;
/** Long edge of a trace-step thumbnail. Smaller than the preview so a turn of steps stays in the thread file. */
const TRACE_EDGE = 240;
const TERMINAL_OUTPUT_LIMIT = 200_000;

/** How the user answered a permission card; `always`/`never` also change the project setting. */
export type PermissionAnswer = 'once' | 'always' | 'reject' | 'never';

export interface BrowserPreview {
  readonly title: string;
  readonly image: { data: string; mimeType: string; width: number; height: number };
  readonly path: string | null;
}

export interface ArboraToolHostOptions {
  readonly projectPath: string;
  readonly browser: () => BrowserService | null;
  readonly devServer: () => DevServer | null;
  readonly terminals: () => TerminalService | null;
  readonly projectSettings: () => ProjectSettings;
  readonly saveToolPolicy: (tool: 'evaluate' | 'terminalRun', policy: BrowserToolPolicy) => void;
  readonly findCandidates: (terms: readonly SearchTerm[]) => Promise<SourceCandidate[]>;
  /** Shows a permission card in the thread; null when the thread or turn went away. */
  readonly askPermission: (request: PermissionRequest) => Promise<PermissionAnswer | null>;
  readonly preview: (preview: BrowserPreview) => void;
  /** Adds one step to the thread's action trace. */
  readonly trace?: (step: TraceStepInput & { image: ActionTraceImage | null }) => void;
  /** The thread these tools belong to. Grants are checked against it. */
  readonly threadId?: string;
  readonly tabs?: () => BrowserTabs | null;
  readonly grants?: TabGrantStore;
  readonly passwords?: () => PasswordsSettings;
  readonly passwordProvider?: OnePasswordProvider;
  /** Remembers one origin after the user chooses Always on an agent login. */
  readonly allowLoginOrigin?: (origin: string) => void;
  readonly secrets?: SecretMask;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function toLogEntry(entry: ProblemEntry): LogEntry {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.method && entry.url ? `${entry.method} ${entry.message}` : entry.message,
    url: entry.url,
    line: entry.line,
    status: entry.status,
  };
}

/** Downscaled to `maxEdge`; PNG unless that is too large for agents (or `jpeg` is asked for). */
function encodeImage(image: NativeImage, maxEdge: number, jpeg: 'auto' | 'always'): ScreenshotImage {
  const size = image.getSize();
  const fitted = fitWithin(size.width, size.height, maxEdge);
  const scaled = fitted.width !== size.width ? image.resize({ ...fitted, quality: 'best' }) : image;
  let data = jpeg === 'always' ? null : scaled.toPNG();
  let mimeType: ScreenshotImage['mimeType'] = 'image/png';
  if (!data || data.byteLength > PNG_BYTE_LIMIT) {
    data = scaled.toJPEG(JPEG_QUALITY);
    mimeType = 'image/jpeg';
  }
  return { data: data.toString('base64'), mimeType, width: fitted.width, height: fitted.height };
}

function sourceLine(source: { relative: string; line: number | null } | null): string {
  if (!source) return 'unknown';
  return source.line !== null ? `${source.relative}:${source.line}` : source.relative;
}

/**
 * Arbora's side of the browser tools for one agent thread: the page through `BrowserService`
 * (CDP, screenshots, logs), the dev server and terminals, permissions through the thread's
 * permission cards, and screenshot thumbnails mirrored into the transcript.
 */
export class ArboraToolHost implements BrowserToolHost {
  /** Set by resolveTarget so a hidden tab is used without showing it. */
  private selected: BrowserService | null = null;
  /** Compare images saved for this thread, so each round has its own file. */
  private compareRounds = 0;

  constructor(private readonly options: ArboraToolHostOptions) {}

  private browser(): BrowserService {
    const browser = this.selected ?? this.options.browser();
    if (!browser) throw new ToolError('The browser panel is not open.');
    return browser;
  }

  async resolveTarget(target: string | undefined, intent: 'read' | 'write'): Promise<void> {
    const tabs = this.options.tabs?.() ?? null;
    if (!tabs) {
      if (target !== undefined && target !== '' && target !== 'current' && target !== 'app' && target !== 'active') {
        throw new ToolError(`Unknown tab ${target}; Arbora has a single browser tab for now (omit "target").`);
      }
      this.selected = null;
      return;
    }
    const resolved = await tabs.resolve(target);
    this.assertGranted(tabs, resolved.id, resolved.role);
    if (intent === 'write' && resolved.role === 'reference') await this.permitWrite(tabs, resolved.id);
    this.selected = resolved.service;
  }

  designMatch(): { threshold: number; maxRounds: number } {
    const match = this.options.projectSettings().designMatch;
    return { threshold: match?.threshold ?? 0.92, maxRounds: match?.maxRounds ?? 5 };
  }

  listTabs(): TabSummary[] {
    const tabs = this.options.tabs?.() ?? null;
    if (!tabs) return [];
    const threadId = this.options.threadId;
    const grants = this.options.grants;
    return tabs.snapshots().map((tab) => ({
      id: tab.id,
      role: tab.role,
      title: tab.title,
      url: tab.url,
      active: tab.active,
      granted:
        tab.role === 'app' ||
        (grants !== undefined &&
          threadId !== undefined &&
          grants.canRead(tabs.projectPath, threadId, tab.id, tab.role)),
    }));
  }

  async openTab(url: string | undefined): Promise<string> {
    const tabs = this.requireTabs();
    const id = await tabs.open(url && url.length > 0 ? url : 'about:blank', {
      activate: false,
      openedByThreadId: this.options.threadId ?? null,
    });
    if (this.options.grants && this.options.threadId)
      this.options.grants.grant(tabs.projectPath, this.options.threadId, id);
    return id;
  }

  closeTab(id: string): Promise<void> {
    const tabs = this.requireTabs();
    const owner = tabs.openedBy(id);
    if (owner === undefined) throw new ToolError(`Unknown tab ${id}`);
    if (owner !== this.options.threadId) throw new ToolError('Only tabs this agent opened can be closed.');
    const result = tabs.close(id);
    if (!result.ok) throw new ToolError(result.error);
    this.options.grants?.dropTab(tabs.projectPath, id);
    return Promise.resolve();
  }

  redactSecrets(text: string): string {
    return this.options.secrets?.apply(text) ?? text;
  }

  async login(origin: string | undefined): Promise<'logged_in' | 'needs_user' | 'failed'> {
    const settings = this.options.passwords?.();
    const provider = this.options.passwordProvider;
    if (!settings || settings.provider !== '1password' || !provider) return 'failed';
    if (settings.agentLogins === 'never') return 'failed';
    const page = this.page();
    let pageOrigin = origin ?? '';
    if (!pageOrigin) {
      try {
        pageOrigin = new URL(page.url).origin;
      } catch {
        return 'needs_user';
      }
    }
    let items: { id: string; title: string }[];
    try {
      items = await provider.listLogins(pageOrigin);
    } catch {
      return 'needs_user';
    }
    if (items.length === 0) return 'needs_user';
    const allowed = settings.alwaysAllow.includes(pageOrigin);
    if (!allowed) {
      const answer = await this.options.askPermission({
        tool: 'navigate',
        title: 'Sign in with 1Password',
        detail: `The agent wants to sign in at ${pageOrigin} using: ${items.map((item) => item.title).join(', ')}`,
        persistent: true,
      });
      if (answer === 'always') this.options.allowLoginOrigin?.(pageOrigin);
      if (answer !== 'once' && answer !== 'always') return 'failed';
    }
    const item = items[0];
    if (!item) return 'needs_user';
    try {
      const revealed = await provider.reveal(item.id);
      const browser = this.browser();
      const fields = await browser.loginFields();
      if (!fields.password) return 'needs_user';
      if (fields.username && revealed.username) await browser.insertText(fields.username, revealed.username);
      await browser.insertText(fields.password, revealed.password);
      if (fields.otp && !(await this.fillOtp(provider, item.id, browser, fields.otp))) return 'needs_user';
      await browser.pressEnter(fields.password);
      if (!fields.otp) {
        const otp = await this.waitForOtpField(browser);
        if (otp && !(await this.fillOtp(provider, item.id, browser, otp))) return 'needs_user';
        if (otp) await browser.pressEnter(otp);
      }
      return 'logged_in';
    } catch {
      return 'failed';
    }
  }

  /** The code stays inside the provider's secret mask. A missing code is `needs_user`. */
  private async fillOtp(
    provider: { otp(id: string): Promise<string> },
    id: string,
    browser: BrowserService,
    selector: string,
  ): Promise<boolean> {
    try {
      const code = (await provider.otp(id)).trim();
      if (!code) return false;
      await browser.insertText(selector, code);
      return true;
    } catch {
      return false;
    }
  }

  /** A second factor often appears only after the password form submits. */
  private async waitForOtpField(browser: BrowserService): Promise<string | null> {
    const deadline = Date.now() + 1_500;
    for (;;) {
      const fields = await browser.loginFields();
      if (fields.otp) return fields.otp;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async captureTab(tabId: string): Promise<TabCapture> {
    const tabs = this.requireTabs();
    const resolved = await tabs.resolve(tabId);
    this.assertGranted(tabs, resolved.id, resolved.role);
    const shot = await resolved.service.captureQuiet();
    const state = resolved.service.getState();
    return { png: shot.png, cssWidth: shot.cssWidth, cssHeight: shot.cssHeight, title: state.title, url: state.url };
  }

  private requireTabs(): BrowserTabs {
    const tabs = this.options.tabs?.() ?? null;
    if (!tabs) throw new ToolError('Open a project first.');
    return tabs;
  }

  private assertGranted(tabs: BrowserTabs, id: string, role: 'app' | 'reference'): void {
    const grants = this.options.grants;
    const threadId = this.options.threadId;
    if (!grants || !threadId) return;
    if (!grants.canRead(tabs.projectPath, threadId, id, role)) throw new ToolError('tab not granted');
  }

  private async permitWrite(tabs: BrowserTabs, id: string): Promise<void> {
    const grants = this.options.grants;
    const threadId = this.options.threadId;
    if (!grants || !threadId) return;
    const key = { projectPath: tabs.projectPath, threadId, tabId: id };
    if (grants.canWrite(key)) return;
    const answer = await this.options.askPermission({
      tool: 'navigate',
      title: 'Change this tab',
      detail: 'The agent wants to type, click, or navigate in a reference tab you sent.',
    });
    if (answer !== 'once' && answer !== 'always') throw new ToolError('tab not granted');
    grants.allowWrite(key);
  }

  cdp(): Promise<Cdp> {
    return this.browser().cdp();
  }

  page(): PageInfo {
    const browser = this.selected ?? this.options.browser();
    if (!browser) return { url: '', title: '', loading: false, error: 'The browser panel is not open' };
    const state = browser.getState();
    return {
      url: state.url,
      title: state.title,
      loading: state.loading,
      error: state.error ? `${state.error.description} (${state.error.code})` : null,
    };
  }

  devUrl(): string | null {
    return this.options.devServer()?.status().url ?? this.options.projectSettings().devUrl ?? null;
  }

  async navigate(url: string): Promise<PageInfo> {
    const browser = this.browser();
    const loaded = browser.waitForLoad(LOAD_TIMEOUT_MS);
    const result = browser.navigate(url);
    if (!result.ok) throw new ToolError(result.error ?? `Could not open ${url}`);
    await loaded;
    return this.page();
  }

  async reload(hard: boolean): Promise<PageInfo> {
    const browser = this.browser();
    if (!browser.getState().url) throw new ToolError('No page is loaded; use browser_navigate.');
    const loaded = browser.waitForLoad(LOAD_TIMEOUT_MS);
    browser.action(hard ? 'hardReload' : 'reload');
    await loaded;
    return this.page();
  }

  async history(direction: 'back' | 'forward'): Promise<PageInfo> {
    const browser = this.browser();
    const state = browser.getState();
    if (direction === 'back' ? !state.canGoBack : !state.canGoForward) {
      throw new ToolError(`There is no page to go ${direction} to.`);
    }
    const loaded = browser.waitForLoad(LOAD_TIMEOUT_MS);
    browser.action(direction);
    await loaded;
    return this.page();
  }

  /**
   * A viewport thumbnail after a browser tool returns. Failure leaves the step without an image;
   * the tool result itself is already decided.
   */
  /** One compare round, under `.arbora/screenshots/<thread>/`. The path is project-relative. */
  saveCompare(png: Uint8Array): string | null {
    const threadId = this.options.threadId?.replace(/[^A-Za-z0-9_-]/g, '') ?? '';
    if (!threadId) return null;
    try {
      this.compareRounds += 1;
      const relative = `.arbora/screenshots/${threadId}/round-${this.compareRounds}.png`;
      const file = join(this.options.projectPath, relative);
      mkdirSync(dirname(file), { recursive: true });
      const ignore = join(this.options.projectPath, '.arbora', 'screenshots', '.gitignore');
      try {
        statSync(ignore);
      } catch {
        mkdirSync(dirname(ignore), { recursive: true });
        writeFileSync(ignore, '# Arbora screenshots are local artefacts\n*\n');
      }
      writeFileSync(file, Buffer.from(png));
      return relative;
    } catch {
      return null;
    }
  }

  async recordTrace(step: TraceStepInput): Promise<void> {
    const { imagePng, ...rest } = step;
    const image = imagePng ? this.imageFromPng(imagePng) : await this.traceImage();
    this.options.trace?.({ ...rest, image });
  }

  private imageFromPng(png: Uint8Array): ActionTraceImage | null {
    try {
      const full = nativeImage.createFromBuffer(Buffer.from(png));
      if (full.isEmpty()) return null;
      const image = encodeImage(full, TRACE_EDGE, 'always');
      return image.data.length <= ACTION_TRACE_IMAGE_LIMIT ? image : null;
    } catch {
      return null;
    }
  }

  private async traceImage(): Promise<ActionTraceImage | null> {
    const browser = this.options.browser();
    if (!browser?.getState().url) return null;
    try {
      const shot = await browser.screenshot({ mode: 'viewport' });
      const full = nativeImage.createFromBuffer(Buffer.from(shot.pngBase64, 'base64'));
      if (full.isEmpty()) return null;
      const image = encodeImage(full, TRACE_EDGE, 'always');
      return image.data.length <= ACTION_TRACE_IMAGE_LIMIT ? image : null;
    } catch {
      return null;
    }
  }

  async screenshot(mode: ScreenshotMode, clip: Box | null): Promise<ScreenshotImage> {
    const browser = this.browser();
    if (!browser.getState().url) throw new ToolError('No page is loaded; use browser_navigate first.');
    const shot = await browser.screenshot(
      mode === 'full'
        ? { mode: 'fullPage' }
        : mode === 'element' && clip
          ? { mode: 'element', rect: clip }
          : { mode: 'viewport' },
    );
    const png = Buffer.from(shot.pngBase64, 'base64');
    const full = nativeImage.createFromBuffer(png);
    const path = browser.writeScreenshotFile(png, `agent-${mode}`, 'png');
    this.options.preview({
      title: `Agent screenshot (${mode}) of ${browser.getState().url}`,
      image: encodeImage(full, PREVIEW_EDGE, 'always'),
      path,
    });
    return { ...encodeImage(full, MAX_IMAGE_EDGE, 'auto'), path };
  }

  consoleLogs(): LogEntry[] {
    return this.browser().getConsole().map(toLogEntry);
  }

  networkErrors(): LogEntry[] {
    return this.browser().getNetworkErrors().map(toLogEntry);
  }

  navigatedAt(): number {
    return this.browser().navigatedAtTime;
  }

  async elementSource(cdp: Cdp, backendNodeId: number): Promise<string> {
    const facts = await callOnElement<ElementSourceFacts>(cdp, backendNodeId, elementSourceFunction());
    const root = this.options.projectPath;
    const lines = [
      `Element: <${facts.tag}${facts.id ? ` id="${facts.id}"` : ''}>${facts.text ? ` "${facts.text}"` : ''}`,
    ];
    if (facts.classes.length > 0) lines.push(`Classes: ${facts.classes.join(' ')}`);
    if (facts.components.length > 0) {
      lines.push('Component chain (nearest first):');
      for (const component of facts.components) {
        const defined = resolveSource(component.definedAt, root, isFile);
        const rendered = resolveSource(component.renderedAt, root, isFile);
        const name = component.minified ? `${component.name} (minified)` : component.name;
        const where = [
          defined && `defined in ${sourceLine(defined)}`,
          rendered && `rendered from ${sourceLine(rendered)}`,
        ]
          .filter(Boolean)
          .join(', ');
        lines.push(`- ${name}${component.server ? ' [server]' : ''}${where ? `: ${where}` : ''}`);
      }
    } else {
      lines.push('No component information (not a React/Vue dev build, or plain HTML).');
    }
    const candidates = await this.options
      .findCandidates(searchTerms({ components: facts.components, element: facts }))
      .catch(() => []);
    if (candidates.length > 0) {
      lines.push('Files that mention its component name or classes:');
      for (const candidate of candidates) lines.push(`- ${candidate.relative} (${candidate.matched.join(', ')})`);
    }
    return lines.join('\n');
  }

  setViewport(viewport: ViewportRequest): Promise<string> {
    const browser = this.browser();
    if ('preset' in viewport) {
      browser.setPreset(viewport.preset);
      return Promise.resolve(`Viewport set to ${viewportPreset(viewport.preset).label}.`);
    }
    browser.setViewportOverride({ width: viewport.width, height: viewport.height, dpr: viewport.dpr ?? 0 });
    return Promise.resolve(
      `Viewport set to ${viewport.width}×${viewport.height}${viewport.dpr ? ` at ${viewport.dpr}x` : ''}. Choose a preset to go back.`,
    );
  }

  devServerStatus(): DevServerInfo {
    const status = this.options.devServer()?.status();
    return { running: status?.running ?? false, command: status?.command ?? null, url: status?.url ?? null };
  }

  devServerLogs(lines: number): string[] {
    const terminalId = this.options.devServer()?.status().terminalId;
    if (!terminalId) return [];
    return this.options.terminals()?.lines(terminalId, lines) ?? [];
  }

  async devServerRestart(): Promise<DevServerInfo> {
    const dev = this.options.devServer();
    if (!dev) throw new ToolError('No project is open.');
    const before = this.page().url;
    const result = await dev.run();
    if (result.error) throw new ToolError(result.error);
    const url = await this.waitForDevUrl(dev);
    if (!url) {
      throw new ToolError(
        `The dev server restarted but printed no URL within ${DEV_URL_TIMEOUT_MS / 1000} s; check devserver_logs.`,
      );
    }
    const browser = this.options.browser();
    if (browser) {
      let target = url;
      try {
        // Keep the page the agent was on when only the port moved.
        const previous = new URL(before);
        target = new URL(`${previous.pathname}${previous.search}${previous.hash}`, url).href;
      } catch {
        // Nothing was loaded; open the dev URL itself.
      }
      const loaded = browser.waitForLoad(LOAD_TIMEOUT_MS);
      browser.navigate(target);
      await loaded;
    }
    return this.devServerStatus();
  }

  /** The dev terminal's URL once it answers HTTP (the terminal prints it before it listens). */
  private async waitForDevUrl(dev: DevServer): Promise<string | null> {
    const deadline = Date.now() + DEV_URL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const url = dev.status().url;
      if (url) {
        try {
          await fetch(url, { signal: AbortSignal.timeout(2000) });
          return url;
        } catch {
          // Not listening yet.
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  async terminalRun(command: string, cwd: string | undefined, timeoutMs: number): Promise<TerminalRunResult> {
    const terminals = this.options.terminals();
    if (!terminals) throw new ToolError('No project is open.');
    let dir: string | undefined;
    if (cwd) {
      try {
        dir = resolveInsideRoot(this.options.projectPath, cwd);
      } catch {
        throw new ToolError(`${cwd} is outside the project folder.`);
      }
    }
    let output = '';
    const terminal = await terminals.create({
      kind: 'agent',
      title: `agent: ${command.slice(0, 40)}`,
      command,
      readOnly: true,
      ...(dir ? { cwd: dir } : {}),
      onData: (data) => {
        if (output.length < TERMINAL_OUTPUT_LIMIT) output += data;
      },
    });
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      terminals.waitForExit(terminal.id).then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(true), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) await terminals.kill(terminal.id);
    const exit = await terminals.waitForExit(terminal.id);
    await terminals.close(terminal.id);
    return { exitCode: timedOut ? null : exit.exitCode, output: stripAnsi(output).replace(/\r\n/g, '\n'), timedOut };
  }

  policy(tool: GuardedTool): ToolPolicy {
    const settings = this.options.projectSettings().browserTools;
    switch (tool) {
      case 'navigate':
        return 'ask';
      case 'evaluate':
        return settings?.evaluate ?? 'ask';
      case 'terminal':
        return settings?.terminalRun ?? 'ask';
      default: {
        const unreachable: never = tool;
        throw new Error(`Unhandled tool ${String(unreachable)}`);
      }
    }
  }

  async confirm(request: PermissionRequest): Promise<boolean> {
    const answer = await this.options.askPermission(request);
    const setting = request.tool === 'evaluate' ? 'evaluate' : request.tool === 'terminal' ? 'terminalRun' : null;
    if (setting && answer === 'always') this.options.saveToolPolicy(setting, 'allow');
    if (setting && answer === 'never') this.options.saveToolPolicy(setting, 'deny');
    return answer === 'once' || answer === 'always';
  }
}
