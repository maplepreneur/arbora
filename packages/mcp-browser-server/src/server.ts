import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { GroveToolHost } from './grove-host.js';
import { GroveContext, registerGroveTools } from './grove-tools.js';
import type { BrowserToolHost } from './host.js';
import { registerBrowserTools, ToolContext } from './tools.js';

import { MCP_PATH, MCP_SERVER_NAME } from './constants.js';

export { MCP_PATH, MCP_SERVER_NAME, SHIM_TOKEN_ENV } from './constants.js';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** What the server saw from the agent, so Arbora can warn when an agent never loaded the tools. */
export interface McpActivity {
  readonly method: string;
  /** For `tools/call`. */
  readonly tool?: string;
}

export interface BrowserMcpServerOptions {
  readonly host: BrowserToolHost;
  /** Adds the `grove_*` orchestration tools for a lead session (never for a helper). */
  readonly grove?: GroveToolHost | undefined;
  readonly version?: string;
  readonly onActivity?: (activity: McpActivity) => void;
}

export interface McpEndpoint {
  readonly url: string;
  readonly token: string;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolveBody(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error('Body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

type RequestId = string | number;

interface RawMessage {
  method?: unknown;
  id?: unknown;
  params?: { name?: unknown; requestId?: unknown };
}

function messagesOf(body: unknown): (RawMessage | null)[] {
  return (Array.isArray(body) ? body : [body]) as (RawMessage | null)[];
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || typeof value === 'number';
}

function activitiesOf(body: unknown): McpActivity[] {
  return messagesOf(body).flatMap((m): McpActivity[] => {
    if (typeof m?.method !== 'string') return [];
    return [{ method: m.method, ...(typeof m.params?.name === 'string' ? { tool: m.params.name } : {}) }];
  });
}

function requestIdsOf(body: unknown): RequestId[] {
  return messagesOf(body).flatMap((m) => (typeof m?.method === 'string' && isRequestId(m.id) ? [m.id] : []));
}

function cancelledIdsOf(body: unknown): RequestId[] {
  return messagesOf(body).flatMap((m) =>
    m?.method === 'notifications/cancelled' && isRequestId(m.params?.requestId) ? [m.params.requestId] : [],
  );
}

/**
 * Arbora's browser-control MCP server for one agent session: Streamable HTTP on `127.0.0.1` with a
 * random port and a bearer token of its own. It runs stateless (a fresh transport per request);
 * state that must survive between calls (snapshot refs, permissions) lives in `ToolContext`.
 */
export class BrowserMcpServer {
  private http: Server | null = null;
  private endpoint: McpEndpoint | null = null;
  private readonly token = randomBytes(32).toString('base64url');
  private readonly context: ToolContext;
  private readonly grove: GroveContext | null;
  /**
   * In-flight requests by JSON-RPC id. Stateless mode gives every POST its own `McpServer`, so a
   * client's `notifications/cancelled` never reaches the server running that request; this does.
   */
  private readonly inflight = new Map<RequestId, AbortController>();

  constructor(private readonly options: BrowserMcpServerOptions) {
    this.context = new ToolContext(options.host);
    this.grove = options.grove ? new GroveContext(options.grove) : null;
  }

  async start(): Promise<McpEndpoint> {
    if (this.endpoint) return this.endpoint;
    const http = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolveListen, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', () => resolveListen());
    });
    this.http = http;
    const { port } = http.address() as AddressInfo;
    this.endpoint = { url: `http://127.0.0.1:${port}${MCP_PATH}`, token: this.token };
    return this.endpoint;
  }

  async stop(): Promise<void> {
    const http = this.http;
    this.http = null;
    this.endpoint = null;
    this.context.dispose();
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((resolveClose) => http.close(() => resolveClose()));
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const expected = Buffer.from(`Bearer ${this.token}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    if (path !== MCP_PATH) {
      sendJsonError(res, 404, 'Not found');
      return;
    }
    if (!this.authorized(req)) {
      sendJsonError(res, 401, 'Unauthorized');
      return;
    }
    if (req.method !== 'POST') {
      // Stateless: no server-initiated stream and no sessions to delete.
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch (error) {
      sendJsonError(res, 400, (error as Error).message);
      return;
    }
    for (const activity of activitiesOf(body)) this.options.onActivity?.(activity);
    for (const id of cancelledIdsOf(body)) this.inflight.get(id)?.abort();
    const requests = requestIdsOf(body).map((id) => [id, new AbortController()] as const);
    for (const [id, controller] of requests) this.inflight.set(id, controller);

    const server = new McpServer(
      { name: MCP_SERVER_NAME, version: this.options.version ?? '0.0.1' },
      { capabilities: { tools: {} } },
    );
    registerBrowserTools(server, this.context);
    if (this.grove) registerGroveTools(server, this.grove, (id) => this.inflight.get(id)?.signal);
    // No `sessionIdGenerator`: stateless mode. Closing the transport aborts the request's handler.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      for (const [id, controller] of requests) if (this.inflight.get(id) === controller) this.inflight.delete(id);
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      sendJsonError(res, 500, (error as Error).message);
    }
  }
}
