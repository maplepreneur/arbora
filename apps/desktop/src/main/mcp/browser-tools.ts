import type { BrowserToolHost, GroveToolHost } from '@arbora/mcp-browser-server/host';
import type { McpAttachment } from '../agent/agent-service.js';
import { loadBrowserMcpServer } from '../lazy/mcp-server.js';

export interface BrowserToolsOptions {
  /** The Grove orchestration tools, for a lead session (never a helper). */
  readonly grove?: GroveToolHost | undefined;
}

/**
 * Starts a browser-tools MCP server for one agent process. Terminal agents reach it through the
 * `ARBORA_MCP_URL` / `ARBORA_MCP_TOKEN` environment variables (Streamable HTTP, bearer token).
 */
export async function openBrowserTools(
  host: BrowserToolHost,
  version: string,
  options: BrowserToolsOptions = {},
): Promise<McpAttachment> {
  const BrowserMcpServer = await loadBrowserMcpServer();
  const server = new BrowserMcpServer({ host, grove: options.grove, version });
  const endpoint = await server.start();
  return {
    url: endpoint.url,
    token: endpoint.token,
    groveTools: options.grove !== undefined,
    close: () => server.stop(),
  };
}
