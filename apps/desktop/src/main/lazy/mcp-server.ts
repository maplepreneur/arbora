import type { BrowserMcpServer } from '@arbora/mcp-browser-server';

/**
 * The browser-tools MCP server pulls in the MCP SDK and its Zod builds (~570 KB of main-process
 * code), which only matter once an agent session starts, so it is loaded then.
 */
export async function loadBrowserMcpServer(): Promise<typeof BrowserMcpServer> {
  return (await import('@arbora/mcp-browser-server')).BrowserMcpServer;
}
