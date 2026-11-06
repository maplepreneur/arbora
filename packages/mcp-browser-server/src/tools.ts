import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolError, type Cdp } from './cdp.js';
import type { BrowserToolHost, GuardedTool, LogEntry, LogLevel, PageInfo } from './host.js';
import { click, elementBox, hover, pressKey, scroll, selectOptions, typeText } from './input.js';
import { evaluate, InflightRequests, truncate, waitFor } from './page.js';
import { RefTable, resolveElement, type ElementTarget } from './refs.js';
import { formatSnapshot, maskSecretNodes, type AxNode } from './snapshot.js';
import { comparePngs } from './compare.js';
import { actionTraceTitle, compareSavedPath, compareScoreTitle, isTracedBrowserTool } from './trace.js';

export const DEFAULT_WAIT_MS = 5000;
const MAX_WAIT_MS = 60_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 60_000;
const MAX_TERMINAL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_LOG_LINES = 100;
const MAX_LOG_ENTRIES = 200;
const WRITE_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_select_option',
  'browser_login',
]);

/** Per-thread state shared by every MCP request of one agent session. */
export class ToolContext {
  readonly refs = new RefTable();
  readonly network = new InflightRequests();
  /** Origins and tools the user allowed for this session. */
  private readonly allowed = new Set<string>();
  private cdpUnsubscribe: (() => void) | null = null;
  private cdpSource: Cdp | null = null;

  constructor(readonly host: BrowserToolHost) {}

  /** The page's CDP connection, with the network tracker attached to it. */
  async cdp(): Promise<Cdp> {
    const cdp = await this.host.cdp();
    if (cdp !== this.cdpSource) {
      this.cdpUnsubscribe?.();
      this.cdpSource = cdp;
      this.network.reset();
      this.cdpUnsubscribe = cdp.on((method, params) => {
        if (method === 'Page.frameNavigated' && !(params as { frame?: { parentId?: string } }).frame?.parentId) {
          this.network.reset();
        }
        this.network.handle(method, params);
      });
    }
    return cdp;
  }

  /** Throws unless the user (or the project's policy) allows `tool`; asks at most once per key. */
  async permit(tool: GuardedTool, key: string, title: string, detail: string): Promise<void> {
    if (this.allowed.has(key)) return;
    const policy = tool === 'navigate' ? 'ask' : this.host.policy(tool);
    if (policy === 'deny') throw new ToolError(`${title} is turned off for this project.`);
    if (policy === 'ask' && !(await this.host.confirm({ tool, title, detail }))) {
      throw new ToolError(`The user declined: ${title}. Do not retry this without asking them.`);
    }
    this.allowed.add(key);
  }

  dispose(): void {
    this.cdpUnsubscribe?.();
    this.cdpUnsubscribe = null;
    this.cdpSource = null;
  }
}

/** Every tool takes `target` so multi-tab (Stage 12) can be added without changing signatures. */
const target = z.string().optional().describe('Browser tab to act on. Only the current tab exists for now; omit it.');

const elementTarget = {
  ref: z.string().optional().describe('Element ref from the latest browser_snapshot, e.g. "e12"'),
  selector: z.string().optional().describe('CSS selector, used when no ref is given'),
};

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function clipError(message: string): string {
  return message.length > 300 ? `${message.slice(0, 299)}…` : message;
}

function resultError(result: CallToolResult): string {
  for (const block of result.content) {
    if (block.type === 'text') return block.text;
  }
  return 'The tool failed.';
}

function checkTarget(value: string | undefined): void {
  if (value !== undefined && value !== '' && value !== 'current') {
    throw new ToolError(`Unknown tab ${value}; Arbora has a single browser tab for now (omit "target").`);
  }
}

function pageLine(page: PageInfo): string {
  const lines = [`Page URL: ${page.url || '(none)'}`, `Page title: ${page.title || '(none)'}`];
  if (page.error) lines.push(`Load error: ${page.error}`);
  return lines.join('\n');
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warning: 2, error: 3 };

function formatLog(entry: LogEntry): string {
  const where = entry.url ? ` (${entry.url}${entry.line !== undefined ? `:${entry.line}` : ''})` : '';
  const status = entry.status !== undefined ? ` [${entry.status}]` : '';
  return `${new Date(entry.timestamp).toISOString()} ${entry.level.toUpperCase()}${status} ${entry.message}${where}`;
}

/** Same-origin as the dev server, or a loopback host (dev servers move ports on restart). */
export function isTrustedOrigin(url: URL, devUrl: string | null): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return true;
  if (!devUrl) return false;
  try {
    return new URL(devUrl).origin === url.origin;
  } catch {
    return false;
  }
}

/** Registers Arbora's browser and dev-server tools on `server`. */
export function registerBrowserTools(server: McpServer, context: ToolContext): void {
  const { host } = context;

  const record = async (
    name: string,
    args: object,
    ok: boolean,
    error: string | null,
    title?: string,
    extra?: { path?: string | null; imagePng?: Uint8Array },
  ): Promise<void> => {
    if (!isTracedBrowserTool(name) || !host.recordTrace) return;
    try {
      await host.recordTrace({
        tool: name,
        title: title ?? actionTraceTitle(name, args as Record<string, unknown>),
        ok,
        error: error === null ? null : clipError(error),
        ...(extra?.path !== undefined ? { path: extra.path } : {}),
        ...(extra?.imagePng ? { imagePng: extra.imagePng } : {}),
      });
    } catch {
      // The trace is a view of the action. A capture failure must not fail the tool.
    }
  };

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } = {},
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: { ...shape, target }, annotations },
      // The SDK infers the callback's argument type from the shape; the cast keeps `run` generic.
      (async (args: z.infer<z.ZodObject<Shape>> & { target?: string }) => {
        try {
          if (host.resolveTarget) await host.resolveTarget(args.target, WRITE_TOOLS.has(name) ? 'write' : 'read');
          else checkTarget(args.target);
          const result = await run(args);
          const failed = result.isError === true;
          const resultText = result.content.find((item) => item.type === 'text')?.text ?? '';
          const score = name === 'browser_compare' && !failed ? compareScoreTitle(resultText) : null;
          const image = result.content.find((item) => item.type === 'image');
          const extra =
            name === 'browser_compare' && !failed
              ? {
                  path: compareSavedPath(resultText),
                  ...(image?.type === 'image' ? { imagePng: Uint8Array.from(Buffer.from(image.data, 'base64')) } : {}),
                }
              : undefined;
          await record(name, args, !failed, failed ? resultError(result) : null, score ?? undefined, extra);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await record(name, args, false, message);
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      }) as never,
    );
  };

  const element = async (args: ElementTarget): Promise<{ cdp: Cdp; node: number }> => {
    const cdp = await context.cdp();
    return { cdp, node: await resolveElement(cdp, context.refs, args) };
  };

  // --- Navigation ------------------------------------------------------------------------------

  tool(
    'browser_navigate',
    'Load a URL in Arbora\'s browser panel and wait for it to load. Relative paths ("/about") resolve against the dev server. Other origins than the dev server need the user\'s permission once per session.',
    { url: z.string().describe('Absolute URL, or a path on the dev server') },
    async ({ url }) => {
      const base = host.devUrl() ?? (host.page().url || undefined);
      let parsed: URL;
      try {
        parsed = new URL(url, base);
      } catch {
        throw new ToolError(`Not a URL: ${url}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ToolError('Only http and https URLs can be opened.');
      }
      if (!isTrustedOrigin(parsed, host.devUrl())) {
        await context.permit(
          'navigate',
          `navigate:${parsed.origin}`,
          `Open ${parsed.origin}`,
          `The agent wants to load ${parsed.href} in the browser panel, outside the project's dev server.`,
        );
      }
      return text(pageLine(await host.navigate(parsed.href)));
    },
    { openWorldHint: true },
  );

  tool(
    'browser_reload',
    'Reload the page. hard: true bypasses the cache.',
    { hard: z.boolean().optional() },
    async ({ hard }) => text(pageLine(await host.reload(hard ?? false))),
  );
  tool('browser_back', 'Go back in the browser history.', {}, async () => text(pageLine(await host.history('back'))));
  tool('browser_forward', 'Go forward in the browser history.', {}, async () =>
    text(pageLine(await host.history('forward'))),
  );
  tool(
    'browser_get_url',
    'The current URL and title of the page.',
    {},
    () => Promise.resolve(text(pageLine(host.page()))),
    {
      readOnlyHint: true,
    },
  );

  // --- Observation -----------------------------------------------------------------------------

  tool(
    'browser_snapshot',
    'Accessibility snapshot of the page: roles, names and a ref (e.g. ref=e5) per element. Much cheaper than a screenshot for checking structure and text; pass the refs to browser_click, browser_type and the other interaction tools.',
    {},
    async () => {
      const cdp = await context.cdp();
      await cdp.send('Accessibility.enable').catch(() => undefined);
      const { nodes } = (await cdp.send('Accessibility.getFullAXTree', {})) as { nodes: AxNode[] };
      const snapshot = formatSnapshot(maskSecretNodes(nodes, await secretBackendNodeIds(cdp)));
      context.refs.replace(snapshot.refs);
      return text(`${pageLine(host.page())}\nSnapshot:\n\`\`\`yaml\n${snapshot.text}\n\`\`\``);
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_screenshot',
    'Screenshot of the page as an image: the viewport (default), the full page, or one element (ref or selector). Use it to check visual results; prefer browser_snapshot for text and structure.',
    {
      mode: z.enum(['viewport', 'full', 'element']).optional(),
      ...elementTarget,
    },
    async ({ mode, ref, selector }) => {
      const wanted = mode ?? (ref || selector ? 'element' : 'viewport');
      let clip = null;
      if (wanted === 'element') {
        const { cdp, node } = await element({ ref, selector });
        clip = await elementBox(cdp, node);
      }
      const image = await host.screenshot(wanted, clip);
      const note = `${wanted} screenshot, ${image.width}×${image.height}${image.path ? `, saved to ${image.path}` : ''}`;
      return {
        content: [
          { type: 'image', data: image.data, mimeType: image.mimeType },
          { type: 'text', text: `${note}\n${pageLine(host.page())}` },
        ],
      };
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_console_logs',
    'Console messages and uncaught exceptions from the page, oldest first. since: "navigation" (default) for the current page only, or a Unix time in ms. level: the minimum level.',
    {
      since: z.union([z.literal('navigation'), z.literal('all'), z.number()]).optional(),
      level: z.enum(['error', 'warning', 'info', 'debug']).optional(),
    },
    ({ since, level }) => {
      const from = since === 'all' ? 0 : typeof since === 'number' ? since : host.navigatedAt();
      const min = LEVEL_RANK[level ?? 'debug'];
      const entries = host
        .consoleLogs()
        .filter((e) => e.timestamp >= from && LEVEL_RANK[e.level] >= min)
        .slice(-MAX_LOG_ENTRIES);
      return Promise.resolve(
        text(entries.length > 0 ? truncate(entries.map(formatLog).join('\n')) : 'No console messages.'),
      );
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_network_errors',
    'Failed requests (HTTP 4xx/5xx and network failures) since the current page loaded.',
    { since: z.union([z.literal('navigation'), z.literal('all'), z.number()]).optional() },
    ({ since }) => {
      const from = since === 'all' ? 0 : typeof since === 'number' ? since : host.navigatedAt();
      const entries = host
        .networkErrors()
        .filter((e) => e.timestamp >= from)
        .slice(-MAX_LOG_ENTRIES);
      return Promise.resolve(
        text(entries.length > 0 ? truncate(entries.map(formatLog).join('\n')) : 'No failed requests.'),
      );
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_get_element_source',
    'Which component renders an element and where its source is: the component chain (React/Vue dev builds) with file paths, plus files that mention its component name or classes.',
    elementTarget,
    async (args) => {
      const { cdp, node } = await element(args);
      return text(await host.elementSource(cdp, node));
    },
    { readOnlyHint: true },
  );

  // --- Interaction -----------------------------------------------------------------------------

  tool(
    'browser_click',
    'Click an element with real mouse events (scrolled into view first).',
    {
      ...elementTarget,
      button: z.enum(['left', 'right', 'middle']).optional(),
      double: z.boolean().optional().describe('Double-click'),
    },
    async ({ ref, selector, button, double }) => {
      const { cdp, node } = await element({ ref, selector });
      const point = await click(cdp, node, { ...(button ? { button } : {}), ...(double ? { double } : {}) });
      return text(
        `Clicked at (${Math.round(point.x)}, ${Math.round(point.y)}). Take a new snapshot to see the result.`,
      );
    },
  );

  tool('browser_hover', 'Move the mouse over an element.', elementTarget, async (args) => {
    const { cdp, node } = await element(args);
    await hover(cdp, node);
    return text('Hovered.');
  });

  tool(
    'browser_type',
    'Replace the text of an input, textarea or editable element, as typed input. submit: true presses Enter afterwards.',
    { ...elementTarget, text: z.string(), submit: z.boolean().optional() },
    async ({ ref, selector, text: value, submit }) => {
      const { cdp, node } = await element({ ref, selector });
      await typeText(cdp, node, value, { submit: submit ?? false });
      return text(submit ? 'Typed and submitted.' : 'Typed.');
    },
  );

  tool(
    'browser_press_key',
    'Press a key or chord on the focused element: "Enter", "Escape", "Tab", "ArrowDown", "a", "Control+a", "Shift+Tab".',
    { key: z.string() },
    async ({ key }) => {
      await pressKey(await context.cdp(), key);
      return text(`Pressed ${key}.`);
    },
  );

  tool(
    'browser_scroll',
    'Scroll with the mouse wheel over an element (ref/selector) or the page. dx/dy in CSS pixels; positive dy scrolls down.',
    { ...elementTarget, dx: z.number().optional(), dy: z.number().optional() },
    async ({ ref, selector, dx, dy }) => {
      const cdp = await context.cdp();
      const node = ref || selector ? await resolveElement(cdp, context.refs, { ref, selector }) : null;
      const position = await scroll(cdp, node, dx ?? 0, dy ?? 0);
      return text(`Page scroll position: x=${Math.round(position.scrollX)}, y=${Math.round(position.scrollY)}.`);
    },
  );

  tool(
    'browser_select_option',
    'Choose options of a <select> by value or visible label.',
    { ...elementTarget, values: z.array(z.string()).min(1) },
    async ({ ref, selector, values }) => {
      const { cdp, node } = await element({ ref, selector });
      const selected = await selectOptions(cdp, node, values);
      return text(`Selected ${selected.join(', ')}.`);
    },
  );

  tool(
    'browser_wait_for',
    'Wait until a selector exists, a text appears (or textGone disappears), and/or the network is idle. After editing source, wait for networkIdle so hot reload has landed.',
    {
      selector: z.string().optional(),
      text: z.string().optional(),
      textGone: z.string().optional(),
      networkIdle: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(MAX_WAIT_MS).optional(),
    },
    async ({ selector, text: wanted, textGone, networkIdle, timeoutMs }) => {
      const elapsed = await waitFor(
        await context.cdp(),
        context.network,
        { selector, text: wanted, textGone, networkIdle },
        timeoutMs ?? DEFAULT_WAIT_MS,
      );
      return text(`Done after ${elapsed} ms.`);
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_evaluate',
    "Run a JavaScript expression in the page and return its JSON value (promises are awaited, 5 s limit). Needs the user's permission.",
    { expression: z.string() },
    async ({ expression }) => {
      await context.permit(
        'evaluate',
        'evaluate',
        'Run JavaScript in the page',
        `The agent wants to run JavaScript in the browser panel:\n${expression.slice(0, 500)}`,
      );
      const value = await evaluate(await context.cdp(), expression);
      return text(host.redactSecrets ? host.redactSecrets(value) : value);
    },
    { destructiveHint: true },
  );

  tool(
    'browser_set_viewport',
    'Emulate a device size: a preset (responsive, mobile, tablet, laptop, desktop) or width/height in CSS px with an optional dpr.',
    {
      preset: z.enum(['responsive', 'mobile', 'tablet', 'laptop', 'desktop']).optional(),
      width: z.number().int().positive().max(4096).optional(),
      height: z.number().int().positive().max(4096).optional(),
      dpr: z.number().positive().max(4).optional(),
    },
    async ({ preset, width, height, dpr }) => {
      if (preset) return text(await host.setViewport({ preset }));
      if (width === undefined || height === undefined) throw new ToolError('Pass a preset, or both width and height.');
      return text(await host.setViewport({ width, height, dpr }));
    },
  );

  // --- Dev server and terminal -----------------------------------------------------------------

  tool(
    'devserver_status',
    "Whether the project's dev server is running, its command and URL.",
    {},
    () => Promise.resolve(text(JSON.stringify(host.devServerStatus(), null, 2))),
    { readOnlyHint: true },
  );

  tool(
    'devserver_logs',
    "The last lines of the dev server's terminal output (build errors show up here).",
    { lines: z.number().int().positive().max(2000).optional() },
    ({ lines }) => {
      const output = host.devServerLogs(lines ?? DEFAULT_LOG_LINES);
      return Promise.resolve(text(output.length > 0 ? truncate(output.join('\n')) : 'The dev server has no output.'));
    },
    { readOnlyHint: true },
  );

  tool(
    'devserver_restart',
    'Restart the dev server (or start it), wait until it answers, and reload the browser on its URL. Use it after config or dependency changes that hot reload does not pick up.',
    {},
    async () => text(JSON.stringify(await host.devServerRestart(), null, 2)),
  );

  tool(
    'terminal_run',
    "Run a shell command in the project (a new short-lived terminal) and return its output. Killed after timeoutMs (default 60 s). Needs the user's permission.",
    {
      command: z.string().min(1),
      cwd: z.string().optional().describe('Working directory inside the project; defaults to the project root'),
      timeoutMs: z.number().int().positive().max(MAX_TERMINAL_TIMEOUT_MS).optional(),
    },
    async ({ command, cwd, timeoutMs }) => {
      await context.permit('terminal', 'terminal', 'Run terminal commands', `The agent wants to run:\n${command}`);
      const result = await host.terminalRun(command, cwd, timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS);
      const status = result.timedOut
        ? `Killed after ${timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS} ms`
        : `Exit code ${result.exitCode ?? 'unknown'}`;
      return text(`${status}\n${truncate(result.output)}`);
    },
    { destructiveHint: true },
  );

  tool(
    'browser_login',
    'Sign the page in with 1Password. Asks the user with the item titles only, then fills the form. Returns logged_in, needs_user, or failed. The password is never in the result.',
    { origin: z.string().optional().describe('Origin to match; defaults to the page') },
    async ({ origin }) => {
      if (!host.login) return { isError: true, content: [{ type: 'text', text: '1Password is not available.' }] };
      const status = await host.login(origin);
      return text(status);
    },
  );

  tool(
    'browser_tabs',
    'List the browser tabs. The app tab is the project. A reference tab (docs, Figma) can be used only after the user sends it; otherwise tools say "tab not granted". Pass a tab id as `target` on the other browser tools. The default target is "app".',
    {},
    () => {
      if (!host.listTabs) return Promise.resolve(text('This Arbora build has one browser tab. Omit "target".'));
      const tabs = host.listTabs();
      if (tabs.length === 0) return Promise.resolve(text('No browser tabs are open.'));
      return Promise.resolve(
        text(
          tabs
            .map(
              (tab) =>
                `${tab.id} [${tab.role}${tab.active ? ', active' : ''}${tab.granted ? ', granted' : ''}] ${tab.title || '(untitled)'} ${tab.url}`,
            )
            .join('\n'),
        ),
      );
    },
    { readOnlyHint: true },
  );

  tool(
    'browser_tab_open',
    'Open a reference tab in the background (the user keeps their current tab) and grant it to this thread. Close it with browser_tab_close when you are done.',
    { url: z.string().optional().describe('http(s) URL; omit for a blank tab') },
    async ({ url }) => {
      if (!host.openTab) return { isError: true, content: [{ type: 'text', text: 'Opening tabs is not available.' }] };
      const id = await host.openTab(url);
      return text(`Opened tab ${id}. Pass it as target.`);
    },
  );

  tool(
    'browser_tab_close',
    'Close a tab this thread opened. Tabs the user opened stay open.',
    { id: z.string() },
    async ({ id }) => {
      if (!host.closeTab) return { isError: true, content: [{ type: 'text', text: 'Closing tabs is not available.' }] };
      await host.closeTab(id);
      return text(`Closed tab ${id}.`);
    },
  );

  tool(
    'browser_compare',
    'Screenshot two granted tabs and score how alike they look. Use this to match a Figma (or other design) tab against the app tab. Returns a score from 0 to 1, the worst cells, and a side-by-side, overlay, or diff image. Fonts and pixel density differ from Figma, so a perfect score is not the goal: repeat the edit-and-compare loop until the score stops moving or list the remaining differences.',
    {
      left: z.string().describe('Tab id, "app", or "active"'),
      right: z.string().describe('Tab id, "app", or "active"'),
      mode: z.enum(['side_by_side', 'overlay', 'diff']).optional(),
    },
    async ({ left, right, mode }) => {
      if (!host.captureTab) {
        return { isError: true, content: [{ type: 'text', text: 'Comparing tabs is not available.' }] };
      }
      const [a, b] = await Promise.all([host.captureTab(left), host.captureTab(right)]);
      const output = comparePngs(Buffer.from(a.png), Buffer.from(b.png), mode ?? 'side_by_side', {
        aWidth: a.cssWidth,
        aHeight: a.cssHeight,
        bWidth: b.cssWidth,
        bHeight: b.cssHeight,
      });
      const saved = host.saveCompare?.(output.png) ?? null;
      const json = JSON.stringify({
        ...output.json,
        ...(saved ? { saved } : {}),
        left: { title: a.title, url: a.url },
        right: { title: b.title, url: b.url },
      });
      return {
        content: [
          { type: 'text', text: json },
          { type: 'image', data: output.png.toString('base64'), mimeType: 'image/png' },
        ],
      };
    },
    { readOnlyHint: true },
  );
}

/** Backend node ids of password and one-time-code fields, so the snapshot can hide their values. */
async function secretBackendNodeIds(cdp: Cdp): Promise<Set<number>> {
  const ids = new Set<number>();
  try {
    await cdp.send('DOM.enable').catch(() => undefined);
    const doc = (await cdp.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const nodeId = doc.root?.nodeId;
    if (nodeId === undefined) return ids;
    const queried = (await cdp.send('DOM.querySelectorAll', {
      nodeId,
      selector: 'input[type="password"], input[autocomplete="current-password"], input[autocomplete="one-time-code"]',
    })) as { nodeIds?: number[] };
    for (const id of queried.nodeIds ?? []) {
      const described = (await cdp.send('DOM.describeNode', { nodeId: id })) as { node?: { backendNodeId?: number } };
      if (described.node?.backendNodeId !== undefined) ids.add(described.node.backendNodeId);
    }
  } catch {
    return ids;
  }
  return ids;
}
