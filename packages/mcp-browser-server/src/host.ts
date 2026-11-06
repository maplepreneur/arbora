import type { Cdp } from './cdp.js';
import type { Box } from './input.js';

export type ScreenshotMode = 'viewport' | 'full' | 'element';

export interface ScreenshotImage {
  /** Raw base64, no `data:` prefix (MCP `image` content). */
  readonly data: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  /** Where the full-size capture was saved, when it was. */
  readonly path?: string;
}

export interface PageInfo {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly error: string | null;
}

export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

export interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly url?: string | undefined;
  readonly line?: number | undefined;
  /** HTTP status for network entries. */
  readonly status?: number | undefined;
}

export interface DevServerInfo {
  readonly running: boolean;
  readonly command: string | null;
  readonly url: string | null;
}

export interface TerminalRunResult {
  readonly exitCode: number | null;
  readonly output: string;
  readonly timedOut: boolean;
}

export type ViewportPreset = 'responsive' | 'mobile' | 'tablet' | 'laptop' | 'desktop';

export type ViewportRequest =
  | { readonly preset: ViewportPreset }
  | { readonly width: number; readonly height: number; readonly dpr?: number | undefined };

/** Tools that need the user's consent; `navigate` is asked per origin, the others per session. */
export type GuardedTool = 'navigate' | 'evaluate' | 'terminal';
export type ToolPolicy = 'ask' | 'allow' | 'deny';

export interface PermissionRequest {
  readonly tool: GuardedTool;
  readonly title: string;
  readonly detail: string;
}

/**
 * What the tools need from the app. Arbora implements it in main over `BrowserService`,
 * `DevServer` and `TerminalService`; tests implement it with fakes.
 */
export interface BrowserToolHost {
  /**
   * Selects the page for the tool call that is about to run. `target` is a tab id, `app`, or `active`.
   * Hosts that omit it still have one page, and an explicit tab id is rejected.
   */
  prepareTarget?(target: string | undefined): void | Promise<void>;
  releaseTarget?(): void;
  listTabs?(): {
    id: string;
    role: 'app' | 'reference';
    url: string;
    title: string;
    active: boolean;
    granted: boolean;
  }[];
  openTab?(url: string): Promise<{ id: string }>;
  closeTab?(id: string): Promise<void>;
  /** Viewport pixels for `target`, or the rectangle when `clip` is set. */
  capture?(
    target: string | undefined,
    clip: Box | null,
  ): Promise<{ width: number; height: number; rgba: Uint8Array }>;
  /** The page's CDP connection; throws (with a message for the agent) when it is unavailable. */
  cdp(): Promise<Cdp>;
  page(): PageInfo;
  /** The project's dev-server URL, which navigation never needs permission for. */
  devUrl(): string | null;
  /** Each resolves once the page has loaded (or failed to), within a bounded time. */
  navigate(url: string): Promise<PageInfo>;
  reload(hard: boolean): Promise<PageInfo>;
  history(direction: 'back' | 'forward'): Promise<PageInfo>;
  /** `clip` is the element's viewport box for `element` mode. Downscaled for agents. */
  screenshot(mode: ScreenshotMode, clip: Box | null): Promise<ScreenshotImage>;
  consoleLogs(): LogEntry[];
  networkErrors(): LogEntry[];
  /** When the current document loaded (console entries after it belong to this page). */
  navigatedAt(): number;
  /** Component chain and source files for an element, as text for the agent. */
  elementSource(cdp: Cdp, backendNodeId: number): Promise<string>;
  setViewport(viewport: ViewportRequest): Promise<string>;
  devServerStatus(): DevServerInfo;
  devServerLogs(lines: number): string[];
  /** Restarts the dev server, waits for its URL to answer and points the browser at it. */
  devServerRestart(): Promise<DevServerInfo>;
  terminalRun(command: string, cwd: string | undefined, timeoutMs: number): Promise<TerminalRunResult>;
  /** The project's standing answer for a guarded tool. */
  policy(tool: GuardedTool): ToolPolicy;
  /** Asks the user (a permission card in the agent panel); true when allowed. */
  confirm(request: PermissionRequest): Promise<boolean>;
  /**
   * Records one browser action for the thread's trace. Optional: hosts that omit it still run the
   * tools. A throw here must not fail the tool.
   */
  recordTrace?(step: TraceStepInput): void | Promise<void>;
}

/** What the MCP server knows about one traced browser action, before the app attaches a screenshot. */
export interface TraceStepInput {
  readonly tool: string;
  readonly title: string;
  readonly ok: boolean;
  readonly error: string | null;
}
