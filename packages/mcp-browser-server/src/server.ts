import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { BrowserToolHost } from './host.js';
import { registerBrowserTools, ToolContext } from './tools.js';

export const MCP_SERVER_NAME = 'arbora-browser';
export const MCP_PATH = '/mcp';
/** The stdio shim's bearer token travels in the environment, not argv, so it does not show up in `ps`. */
export const SHIM_TOKEN_ENV = 'ARBORA_MCP_TOKEN';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** What the server saw from the agent, so Arbora can warn when an agent never loaded the tools. */
export interface McpActivity {
  readonly method: string;
  /** For `tools/call`. */
  readonly tool?: string;
}

export interface BrowserMcpServerOptions {
  readonly host: BrowserToolHost;
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

function activitiesOf(body: unknown): McpActivity[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message): McpActivity[] => {
    const m = message as { method?: unknown; params?: { name?: unknown } } | null;
    if (typeof m?.method !== 'string') return [];
    return [{ method: m.method, ...(typeof m.params?.name === 'string' ? { tool: m.params.name } : {}) }];
  });
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

  constructor(private readonly options: BrowserMcpServerOptions) {
    this.context = new ToolContext(options.host);
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

    const server = new McpServer(
      { name: MCP_SERVER_NAME, version: this.options.version ?? '0.0.1' },
      { capabilities: { tools: {} } },
    );
    registerBrowserTools(server, this.context);
    // No `sessionIdGenerator`: stateless mode.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
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
