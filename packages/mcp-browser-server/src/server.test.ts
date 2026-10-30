import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserToolHost, PageInfo, PermissionRequest, ToolPolicy } from './host.js';
import { BrowserMcpServer, type McpActivity } from './server.js';
import { runShim } from './shim.js';
import type { AxNode } from './snapshot.js';
import { FakeCdp } from './testing.js';

interface FakeHostState {
  page: PageInfo;
  count: number;
  navigations: string[];
  confirms: PermissionRequest[];
  answer: boolean;
  policy: ToolPolicy;
}

/** A fixture-like page with a counter button, driven by CDP calls the tools make. */
function fakeHost(): { host: BrowserToolHost; state: FakeHostState; cdp: FakeCdp } {
  const state: FakeHostState = {
    page: { url: 'http://127.0.0.1:5173/', title: 'Fixture', loading: false, error: null },
    count: 0,
    navigations: [],
    confirms: [],
    answer: true,
    policy: 'ask',
  };
  const tree = (): AxNode[] => [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Fixture' }, childIds: ['2', '3'] },
    {
      nodeId: '2',
      parentId: '1',
      role: { value: 'paragraph' },
      name: { value: `Clicked ${state.count} times` },
      backendDOMNodeId: 20,
    },
    { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Increment' }, backendDOMNodeId: 30 },
  ];
  const cdp = new FakeCdp({
    'Accessibility.getFullAXTree': () => ({ nodes: tree() }),
    'DOM.describeNode': (params) => ({ node: { backendNodeId: params['backendNodeId'] } }),
    'DOM.getContentQuads': () => ({ quads: [[0, 0, 100, 0, 100, 40, 0, 40]] }),
    'Input.dispatchMouseEvent': (params) => {
      if (params['type'] === 'mouseReleased') state.count++;
      return {};
    },
    'Runtime.evaluate': (params) => ({ result: { type: 'number', value: String(params['expression']).length } }),
  });
  const page = (): PageInfo => state.page;
  const host: BrowserToolHost = {
    cdp: () => Promise.resolve(cdp),
    page,
    devUrl: () => 'http://127.0.0.1:5173/',
    navigate: (url) => {
      state.navigations.push(url);
      state.page = { ...state.page, url };
      return Promise.resolve(page());
    },
    reload: () => Promise.resolve(page()),
    history: () => Promise.resolve(page()),
    screenshot: () => Promise.resolve({ data: 'iVBORw0KGgo=', mimeType: 'image/png', width: 10, height: 10 }),
    consoleLogs: () => [
      { timestamp: 1, level: 'error', message: 'old error' },
      { timestamp: 50, level: 'info', message: 'hello' },
      { timestamp: 60, level: 'error', message: 'boom', url: 'http://127.0.0.1:5173/src/App.tsx', line: 3 },
    ],
    networkErrors: () => [],
    navigatedAt: () => 10,
    elementSource: () => Promise.resolve('Button <- Card'),
    setViewport: () => Promise.resolve('ok'),
    devServerStatus: () => ({ running: true, command: 'pnpm dev', url: 'http://127.0.0.1:5173/' }),
    devServerLogs: () => ['ready in 100 ms'],
    devServerRestart: () => Promise.resolve({ running: true, command: 'pnpm dev', url: 'http://127.0.0.1:5174/' }),
    terminalRun: (command) => Promise.resolve({ exitCode: 0, output: `ran ${command}`, timedOut: false }),
    policy: () => state.policy,
    confirm: (request) => {
      state.confirms.push(request);
      return Promise.resolve(state.answer);
    },
  };
  return { host, state, cdp };
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

const servers: BrowserMcpServer[] = [];
const clients: Client[] = [];

async function connect(
  extra: { activity?: McpActivity[] } = {},
): Promise<{ client: Client; state: FakeHostState; url: string; token: string }> {
  const { host, state } = fakeHost();
  const server = new BrowserMcpServer({ host, onActivity: (a) => extra.activity?.push(a) });
  servers.push(server);
  const { url, token } = await server.start();
  const client = new Client({ name: 'test', version: '0.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return { client, state, url, token };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

describe('BrowserMcpServer', () => {
  it('listens on loopback and rejects requests without the bearer token', async () => {
    const { url, token } = await connect();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401);
    const wrong = await fetch(url, { method: 'POST', headers: { ...headers, authorization: 'Bearer nope' }, body });
    expect(wrong.status).toBe(401);
    const ok = await fetch(url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body });
    expect(ok.status).toBe(200);
  });

  it('lists every tool, each with an optional target', async () => {
    const activity: McpActivity[] = [];
    const { client } = await connect({ activity });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'browser_back',
        'browser_click',
        'browser_console_logs',
        'browser_evaluate',
        'browser_forward',
        'browser_get_element_source',
        'browser_get_url',
        'browser_hover',
        'browser_navigate',
        'browser_network_errors',
        'browser_press_key',
        'browser_reload',
        'browser_screenshot',
        'browser_scroll',
        'browser_select_option',
        'browser_set_viewport',
        'browser_snapshot',
        'browser_type',
        'browser_wait_for',
        'devserver_logs',
        'devserver_restart',
        'devserver_status',
        'terminal_run',
      ].sort(),
    );
    for (const tool of tools) expect(tool.inputSchema.properties).toHaveProperty('target');
    expect(activity.map((a) => a.method)).toEqual(
      expect.arrayContaining(['initialize', 'notifications/initialized', 'tools/list']),
    );
  });

  it('clicks a ref from the snapshot, and the next snapshot shows the change', async () => {
    const { client } = await connect();
    const before = textOf(await client.callTool({ name: 'browser_snapshot', arguments: {} }));
    expect(before).toContain('- paragraph "Clicked 0 times" [ref=e1]');
    expect(before).toContain('- button "Increment" [ref=e2]');
    const clicked = await client.callTool({ name: 'browser_click', arguments: { ref: 'e2' } });
    expect(clicked.isError).toBeFalsy();
    const after = textOf(await client.callTool({ name: 'browser_snapshot', arguments: {} }));
    expect(after).toContain('Clicked 1 times');
    const stale = await client.callTool({ name: 'browser_click', arguments: { ref: 'e99' } });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toMatch(/Unknown ref e99/);
  });

  it('returns screenshots as raw base64 image content', async () => {
    const { client } = await connect();
    const result = (await client.callTool({ name: 'browser_screenshot', arguments: {} })) as {
      content: { type: string; data?: string; mimeType?: string }[];
    };
    expect(result.content[0]).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  });

  it('asks once per origin before leaving the dev server, and not for loopback URLs', async () => {
    const { client, state } = await connect();
    await client.callTool({ name: 'browser_navigate', arguments: { url: '/about' } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'http://localhost:3000/' } });
    expect(state.confirms).toHaveLength(0);
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com/' } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com/other' } });
    expect(state.confirms).toHaveLength(1);
    expect(state.confirms[0]?.title).toBe('Open https://example.com');
    expect(state.navigations).toEqual([
      'http://127.0.0.1:5173/about',
      'http://localhost:3000/',
      'https://example.com/',
      'https://example.com/other',
    ]);
    state.answer = false;
    const declined = await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://evil.test/' } });
    expect(declined.isError).toBe(true);
    expect(state.navigations).toHaveLength(4);
  });

  it('guards evaluate and terminal_run with the project policy', async () => {
    const { client, state } = await connect();
    state.policy = 'deny';
    const denied = await client.callTool({ name: 'browser_evaluate', arguments: { expression: '1 + 1' } });
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toMatch(/turned off for this project/);
    state.policy = 'ask';
    expect(textOf(await client.callTool({ name: 'browser_evaluate', arguments: { expression: '1 + 1' } }))).toBe('5');
    await client.callTool({ name: 'browser_evaluate', arguments: { expression: '2' } });
    expect(state.confirms.map((c) => c.tool)).toEqual(['evaluate']);
    state.policy = 'allow';
    expect(textOf(await client.callTool({ name: 'terminal_run', arguments: { command: 'ls' } }))).toContain('ran ls');
    expect(state.confirms).toHaveLength(1);
  });

  it('filters console logs to the current page and a minimum level', async () => {
    const { client } = await connect();
    const current = textOf(await client.callTool({ name: 'browser_console_logs', arguments: {} }));
    expect(current).not.toContain('old error');
    expect(current).toContain('hello');
    const errors = textOf(await client.callTool({ name: 'browser_console_logs', arguments: { level: 'error' } }));
    expect(errors).toContain('boom (http://127.0.0.1:5173/src/App.tsx:3)');
    expect(errors).not.toContain('hello');
  });

  it('rejects other tab targets', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'browser_get_url', arguments: { target: 'tab-2' } });
    expect(result.isError).toBe(true);
    expect(textOf(await client.callTool({ name: 'browser_get_url', arguments: { target: 'current' } }))).toContain(
      'Page URL: http://127.0.0.1:5173/',
    );
  });
});

describe('stdio shim', () => {
  it('bridges a stdio MCP client to the HTTP server', async () => {
    const { host } = fakeHost();
    const server = new BrowserMcpServer({ host });
    servers.push(server);
    const { url, token } = await server.start();
    const toShim = new PassThrough();
    const fromShim = new PassThrough();
    let closed = false;
    await runShim(url, token, { stdin: toShim, stdout: fromShim, onClose: () => (closed = true) });

    const buffer = new ReadBuffer();
    const received: JSONRPCMessage[] = [];
    fromShim.on('data', (chunk: Buffer) => {
      buffer.append(chunk);
      for (let message = buffer.readMessage(); message; message = buffer.readMessage()) received.push(message);
    });
    const request = async (id: number, method: string, params: Record<string, unknown>): Promise<JSONRPCMessage> => {
      toShim.write(serializeMessage({ jsonrpc: '2.0', id, method, params }));
      for (let i = 0; i < 100; i++) {
        const found = received.find((m) => 'id' in m && m.id === id);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`No reply to ${method}`);
    };
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0' },
    });
    toShim.write(serializeMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const listed = (await request(2, 'tools/list', {})) as unknown as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((t) => t.name)).toContain('browser_snapshot');
    toShim.end();
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
  });
});
