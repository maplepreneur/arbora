import type { McpServer } from '@agentclientprotocol/sdk';
import {
  MCP_SERVER_NAME,
  SHIM_TOKEN_ENV,
  type BrowserToolHost,
  type McpActivity,
} from '@arbora/mcp-browser-server/host';
import type { McpAttachment } from '../agent/agent-service.js';
import { loadBrowserMcpServer } from '../lazy/mcp-server.js';

/** How agents without HTTP MCP start the stdio shim: Arbora's own executable in Node mode. */
export interface ShimCommand {
  readonly command: string;
  readonly script: string;
}

/** The `mcpServers` entry for `session/new`: HTTP when the agent supports it, else the stdio shim. */
export function mcpServerEntry(endpoint: { url: string; token: string }, http: boolean, shim: ShimCommand): McpServer {
  if (http) {
    return {
      type: 'http',
      name: MCP_SERVER_NAME,
      url: endpoint.url,
      // ACP wants an array of { name, value }; an object here fails silently (no tools).
      headers: [{ name: 'Authorization', value: `Bearer ${endpoint.token}` }],
    };
  }
  return {
    name: MCP_SERVER_NAME,
    command: shim.command,
    args: [shim.script, endpoint.url],
    env: [
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
      { name: SHIM_TOKEN_ENV, value: endpoint.token },
    ],
  };
}

/** Starts a browser-tools MCP server for one agent session. */
export async function openBrowserTools(
  host: BrowserToolHost,
  shim: ShimCommand,
  version: string,
  onActivity?: (activity: McpActivity) => void,
): Promise<McpAttachment> {
  let listed = false;
  const BrowserMcpServer = await loadBrowserMcpServer();
  const server = new BrowserMcpServer({
    host,
    version,
    onActivity: (activity) => {
      if (activity.method === 'tools/list') listed = true;
      onActivity?.(activity);
    },
  });
  const endpoint = await server.start();
  return {
    servers: (http) => [mcpServerEntry(endpoint, http, shim)],
    get toolsListed() {
      return listed;
    },
    close: () => server.stop(),
  };
}
