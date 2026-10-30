import { statSync } from 'node:fs';
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
  type ScreenshotMode,
  type TerminalRunResult,
  type ToolPolicy,
  type ViewportRequest,
} from '@arbora/mcp-browser-server';
import { resolveInsideRoot } from '@arbora/acp-client';
import {
  stripAnsi,
  viewportPreset,
  type BrowserToolPolicy,
  type ProblemEntry,
  type ProjectSettings,
  type SourceCandidate,
} from '@arbora/shared';
import { MAX_IMAGE_EDGE } from '../agent-mode/agent-mode-service.js';
import { resolveSource } from '../agent-mode/source-paths.js';
import { searchTerms, type SearchTerm } from '../agent-mode/source-search.js';
import type { BrowserService } from '../browser/browser-service.js';
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
  constructor(private readonly options: ArboraToolHostOptions) {}

  private browser(): BrowserService {
    const browser = this.options.browser();
    if (!browser) throw new ToolError('The browser panel is not open.');
    return browser;
  }

  cdp(): Promise<Cdp> {
    return this.browser().cdp();
  }

  page(): PageInfo {
    const browser = this.options.browser();
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
