import type { Readable, Writable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export { SHIM_TOKEN_ENV } from './server.js';

/**
 * Bridges a stdio MCP client (an agent without HTTP MCP support) to Arbora's HTTP server: every
 * message is forwarded unchanged. A request the HTTP side cannot deliver is answered with a
 * JSON-RPC error so the agent does not wait forever.
 */
export async function runShim(
  url: string,
  token: string,
  io: { readonly stdin: Readable; readonly stdout: Writable; readonly onClose?: () => void } = {
    stdin: process.stdin,
    stdout: process.stdout,
    onClose: () => process.exit(0),
  },
): Promise<void> {
  const stdio = new StdioServerTransport(io.stdin, io.stdout);
  const http = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const fail = (message: JSONRPCMessage, error: unknown): void => {
    if (!isJSONRPCRequest(message)) return;
    void stdio.send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: `Arbora is not reachable: ${(error as Error).message}` },
    });
  };
  stdio.onmessage = (message) => void http.send(message).catch((error: unknown) => fail(message, error));
  http.onmessage = (message) => void stdio.send(message);
  http.onerror = (error) => process.stderr.write(`[arbora-mcp-shim] ${error.message}\n`);
  stdio.onclose = () => {
    void http.close().finally(() => io.onClose?.());
  };
  await http.start();
  await stdio.start();
  // The SDK's stdio transport does not notice the agent closing its end.
  io.stdin.once('end', () => void stdio.close());
}
