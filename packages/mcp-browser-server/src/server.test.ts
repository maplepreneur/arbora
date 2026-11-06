import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroveSession, GroveStartRequest, GroveToolHost, GroveWaitRequest } from './grove-host.js';
import type { BrowserToolHost, PageInfo, PermissionRequest, ToolPolicy, TraceStepInput } from './host.js';
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
  traces: TraceStepInput[];
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
    traces: [],
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
    recordTrace: (step) => {
      state.traces.push(step);
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

interface FakeGroveState {
  sessions: GroveSession[];
  confirms: number;
  answer: boolean;
  maxHelpers: number;
  started: GroveStartRequest[];
  sent: [string, string][];
  stopped: string[];
  waits: { ids: readonly string[]; request: GroveWaitRequest }[];
  /** `settle` answers a wait at once; `hold` keeps it until its timeout or its signal. */
  waitMode: 'settle' | 'hold';
  waitEnded: 'timeout' | 'abort' | null;
}

function session(id: string, overrides: Partial<GroveSession> = {}): GroveSession {
  return {
    id,
    name: id,
    agentId: 'fake',
    status: 'idle',
    parentId: null,
    archived: false,
    lastMessage: null,
    waitingFor: null,
    ...overrides,
  };
}

/** A Grove host for the session `lead`, with one unrelated session and another lead's helper. */
function fakeGrove(): { grove: GroveToolHost; state: FakeGroveState } {
  const state: FakeGroveState = {
    sessions: [
      session('lead', { name: 'fix the nav', status: 'working' }),
      session('other', { name: 'Codex' }),
      session('theirs', { name: 'tests', parentId: 'other', status: 'working' }),
    ],
    confirms: 0,
    answer: true,
    maxHelpers: 4,
    started: [],
    sent: [],
    stopped: [],
    waits: [],
    waitMode: 'settle',
    waitEnded: null,
  };
  const update = (id: string, patch: Partial<GroveSession>): void => {
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
  };
  const grove: GroveToolHost = {
    sessionId: 'lead',
    agents: () => ({
      agents: [
        { id: 'other-agent', name: 'Other agent', detected: true, signedIn: false },
        { id: 'fake', name: 'Fake agent', detected: true, signedIn: true },
        { id: 'missing', name: 'Missing agent', detected: false, signedIn: null },
      ],
      defaultAgentId: 'fake',
    }),
    sessions: () => state.sessions,
    maxHelpers: () => state.maxHelpers,
    // Answered a little later, as a person would, so parallel calls overlap with the open card.
    confirmStart: () => {
      state.confirms++;
      return new Promise((resolveConfirm) => setTimeout(() => resolveConfirm(state.answer), 20));
    },
    start: (request) => {
      state.started.push(request);
      const id = `helper-${state.started.length}`;
      state.sessions = [
        ...state.sessions,
        session(id, {
          name: request.title ?? request.task,
          agentId: request.agentId,
          status: 'working',
          parentId: 'lead',
        }),
      ];
      return Promise.resolve(id);
    },
    send: (id, message) => {
      state.sent.push([id, message]);
      update(id, { status: 'working' });
      return Promise.resolve();
    },
    wait: (ids, request) => {
      state.waits.push({ ids, request });
      if (state.waitMode === 'settle') {
        for (const id of ids) update(id, { status: 'done', lastMessage: `hello from ${id}` });
        return Promise.resolve(true);
      }
      return new Promise((resolveWait) => {
        const timer = setTimeout(() => {
          state.waitEnded = 'timeout';
          resolveWait(false);
        }, request.timeoutMs);
        request.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          state.waitEnded = 'abort';
          resolveWait(false);
        });
      });
    },
    transcript: (id, limit) =>
      [`User: the task for ${id}`, `Tool: Edit src/App.tsx (completed)`, `Agent: hello`].slice(-limit),
    stop: (id) => {
      state.stopped.push(id);
      update(id, { status: 'stopped' });
      return Promise.resolve();
    },
  };
  return { grove, state };
}

const servers: BrowserMcpServer[] = [];
const clients: Client[] = [];

async function connect(
  extra: { activity?: McpActivity[]; grove?: GroveToolHost } = {},
): Promise<{ client: Client; state: FakeHostState; url: string; token: string }> {
  const { host, state } = fakeHost();
  const server = new BrowserMcpServer({ host, grove: extra.grove, onActivity: (a) => extra.activity?.push(a) });
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
    const { client, state } = await connect();
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
    expect(state.traces.map((step) => ({ tool: step.tool, title: step.title, ok: step.ok }))).toEqual([
      { tool: 'browser_click', title: 'Click e2', ok: true },
      { tool: 'browser_click', title: 'Click e99', ok: false },
    ]);
    expect(state.traces[1]?.error).toMatch(/Unknown ref e99/);
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

describe('Grove tools', () => {
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
    return { error: result.isError === true, text: textOf(result) };
  };

  it('are only there for a lead session', async () => {
    const plain = await connect();
    const names = (await plain.client.listTools()).tools.map((t) => t.name);
    expect(names.some((name) => name.startsWith('grove_'))).toBe(false);
    const { client } = await connect({ grove: fakeGrove().grove });
    const withGrove = (await client.listTools()).tools.map((t) => t.name).filter((name) => name.startsWith('grove_'));
    expect(withGrove.sort()).toEqual(
      ['grove_list_agents', 'grove_read', 'grove_send', 'grove_start_agent', 'grove_stop', 'grove_wait'].sort(),
    );
  });

  it('lists the agents with the default first, and every session with whose helper it is', async () => {
    const { grove } = fakeGrove();
    const { client } = await connect({ grove });
    const { text } = await call(client, 'grove_list_agents');
    const lines = text.split('\n');
    expect(lines[1]).toBe('- fake: Fake agent (default, signed in)');
    expect(text).toContain('- other-agent: Other agent (not signed in)');
    expect(text).toContain('- missing: Missing agent (not installed)');
    expect(text).toContain('- lead "fix the nav" (Fake agent): Working [you]');
    expect(text).toContain('- theirs "tests" (Fake agent): Working [helper of Codex]');
    expect(text).toContain('Running helpers: 0 of 4.');
  });

  it('asks once per session before the first helper and returns its id at once', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    state.answer = false;
    const declined = await call(client, 'grove_start_agent', { task: 'write the tests' });
    expect(declined.error).toBe(true);
    expect(declined.text).toMatch(/declined/);
    expect(state.started).toEqual([]);

    state.answer = true;
    const started = await call(client, 'grove_start_agent', { task: 'write the tests\nfor Nav.tsx', title: 'tests' });
    expect(started.text).toMatch(/^Started helper helper-1 \(Fake agent\)/);
    expect(state.started).toEqual([{ agentId: 'fake', task: 'write the tests\nfor Nav.tsx', title: 'tests' }]);
    await call(client, 'grove_start_agent', { task: 'review it', agent: 'other-agent', model: 'smart' });
    expect(state.started[1]).toMatchObject({ agentId: 'other-agent', model: 'smart' });
    expect(state.confirms).toBe(2);
    // Parallel first calls share one card.
    const fresh = fakeGrove();
    const second = await connect({ grove: fresh.grove });
    await Promise.all([1, 2, 3].map((n) => call(second.client, 'grove_start_agent', { task: `part ${n}` })));
    expect(fresh.state.confirms).toBe(1);
    expect(fresh.state.started).toHaveLength(3);
  });

  it('refuses unknown or missing agents before asking', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    expect((await call(client, 'grove_start_agent', { task: 'x', agent: 'nope' })).text).toMatch(/Unknown agent nope/);
    expect((await call(client, 'grove_start_agent', { task: 'x', agent: 'missing' })).text).toMatch(/not installed/);
    expect(state.confirms).toBe(0);
  });

  it('caps running helpers per lead; stopped helpers do not count', async () => {
    const { grove, state } = fakeGrove();
    state.maxHelpers = 2;
    const { client } = await connect({ grove });
    await call(client, 'grove_start_agent', { task: 'one' });
    await call(client, 'grove_start_agent', { task: 'two' });
    const third = await call(client, 'grove_start_agent', { task: 'three' });
    expect(third.error).toBe(true);
    expect(third.text).toMatch(/2 running helpers \(the limit is 2\)/);
    expect(await call(client, 'grove_stop', { sessionId: 'helper-1' })).toEqual({ error: false, text: 'Stopped one.' });
    expect((await call(client, 'grove_start_agent', { task: 'three' })).error).toBe(false);
    // Parallel calls cannot get past the limit while the permission card is open.
    const fresh = fakeGrove();
    fresh.state.maxHelpers = 1;
    const second = await connect({ grove: fresh.grove });
    const results = await Promise.all(['a', 'b'].map((task) => call(second.client, 'grove_start_agent', { task })));
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(fresh.state.started).toHaveLength(1);
  });

  it('only sends to, waits for, reads and stops its own helpers', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    for (const [name, args] of [
      ['grove_send', { sessionId: 'theirs', message: 'hi' }],
      ['grove_read', { sessionId: 'other' }],
      ['grove_stop', { sessionId: 'theirs' }],
      ['grove_wait', { sessionIds: ['other'] }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.error).toBe(true);
      expect(result.text).toMatch(/not one of your helpers/);
    }
    expect((await call(client, 'grove_read', { sessionId: 'gone' })).text).toMatch(/Unknown session gone/);
    expect((await call(client, 'grove_wait')).text).toMatch(/not started any helpers/);
    expect(state.stopped).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('sends only to a settled helper and reads its transcript', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    await call(client, 'grove_start_agent', { task: 'say hello' });
    const busy = await call(client, 'grove_send', { sessionId: 'helper-1', message: 'and goodbye' });
    expect(busy.text).toMatch(/still working/);
    await call(client, 'grove_wait');
    expect((await call(client, 'grove_send', { sessionId: 'helper-1', message: 'and goodbye' })).error).toBe(false);
    expect(state.sent).toEqual([['helper-1', 'and goodbye']]);
    const read = await call(client, 'grove_read', { sessionId: 'helper-1', limit: 2 });
    expect(read.text).toBe('say hello: Working\nTool: Edit src/App.tsx (completed)\nAgent: hello');
  });

  it('waits for settled helpers and reports each one, clamping the timeout', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    await call(client, 'grove_start_agent', { task: 'one' });
    await call(client, 'grove_start_agent', { task: 'two' });
    const all = await call(client, 'grove_wait');
    expect(all.text).toBe(
      'Settled:\n- helper-1 "one": Done. Last message: hello from helper-1\n- helper-2 "two": Done. Last message: hello from helper-2',
    );
    expect(state.waits[0]).toMatchObject({
      ids: ['helper-1', 'helper-2'],
      request: { until: 'all', timeoutMs: 45_000 },
    });
    await call(client, 'grove_wait', { sessionIds: ['helper-2'], until: 'any', timeoutSeconds: 10_000 });
    expect(state.waits[1]).toMatchObject({ ids: ['helper-2'], request: { until: 'any', timeoutMs: 300_000 } });
    state.sessions = state.sessions.map((s) =>
      s.id === 'helper-1' ? { ...s, status: 'needs_you', waitingFor: 'Add a comment to App.tsx' } : s,
    );
    state.waitMode = 'hold';
    const held = await call(client, 'grove_wait', { sessionIds: ['helper-1'], timeoutSeconds: 1 });
    expect(state.waitEnded).toBe('timeout');
    expect(held.text).toBe(
      'Still working after 1 s. Call grove_wait again to keep waiting:\n- helper-1 "one": Needs you (Add a comment to App.tsx). The user has to answer it in Arbora; tell them.',
    );
  });

  it('stops waiting when the client cancels the call', async () => {
    const { grove, state } = fakeGrove();
    const { client } = await connect({ grove });
    await call(client, 'grove_start_agent', { task: 'slow work' });
    state.waitMode = 'hold';
    const controller = new AbortController();
    const waiting = client.callTool({ name: 'grove_wait', arguments: { timeoutSeconds: 50 } }, undefined, {
      signal: controller.signal,
    });
    await expect.poll(() => state.waits.length).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    await expect.poll(() => state.waitEnded, { timeout: 2000 }).toBe('abort');
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
