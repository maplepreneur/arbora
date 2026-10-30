/**
 * A tiny ACP agent for tests and e2e, in the spirit of the SDK's examples. It is a standalone
 * script (`node fake-agent.ts`, Node's type stripping), so it only imports the SDK and Node.
 *
 * Behaviour is driven by the prompt text:
 * - "add a comment to `FILE`": edit tool call -> permission -> fs/read + fs/write -> diff
 * - "run ...": client terminal running `echo hello from fake agent`, output read back
 * - "plan": a three-entry plan that completes step by step
 * - "slow": a turn that takes ~10 s unless cancelled
 * - "stubborn": a turn that ignores `session/cancel` for ~30 s (clients must stop the process)
 * - "crash": the process exits with code 3 mid-turn
 * - an `image` block in the prompt is acknowledged with its MIME type and size
 * - FAKE_AGENT_AUTH=1 advertises an auth method and rejects session/new until `authenticate`
 * - FAKE_AGENT_SLOW_START=<ms> delays the `initialize` answer
 * - FAKE_AGENT_NO_IMAGE=1 advertises `promptCapabilities.image: false` (clients must send file links)
 *
 * MCP servers passed to `session/new` are connected (HTTP, or stdio with FAKE_AGENT_NO_HTTP_MCP=1,
 * which also advertises `mcpCapabilities.http: false`) and their tools listed, as real agents do:
 * - "browser check": `arbora-browser` snapshot -> click the "Increment" button -> wait -> snapshot
 *   -> screenshot, reported back (the e2e for Stage 5)
 * - "evaluate": `browser_evaluate` of `document.title` (needs the user's permission)
 * - "tool sweep": every other tool once against the vite-react fixture, one result line each
 * - "restart dev": `devserver_restart`, then `browser_get_url`
 */
import { Readable, Writable } from 'node:stream';
import { basename, isAbsolute, join } from 'node:path';
import {
  agent,
  methods,
  ndJsonStream,
  RequestError,
  type AgentContext,
  type ContentBlock,
  type McpServer,
  type PromptRequest,
  type PromptResponse,
  type SessionConfigOption,
  type SessionModeState,
} from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

interface SessionState {
  cwd: string;
  history: { role: 'user' | 'agent'; text: string }[];
  modes: SessionModeState;
  configOptions: SessionConfigOption[];
  cancelled: boolean;
  /** Connected MCP clients by server name, with the tools each one listed. */
  mcp: Map<string, { client: Client; tools: string[] }>;
}

const httpMcp = process.env['FAKE_AGENT_NO_HTTP_MCP'] !== '1';

async function connectMcp(servers: McpServer[]): Promise<SessionState['mcp']> {
  const connected: SessionState['mcp'] = new Map();
  for (const server of servers) {
    const client = new Client({ name: 'arbora-fake-agent', version: '0.0.1' });
    try {
      if ('type' in server && server.type === 'http') {
        const headers = Object.fromEntries(server.headers.map((h) => [h.name, h.value]));
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
      } else if (!('type' in server)) {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
        for (const variable of server.env) env[variable.name] = variable.value;
        await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env }));
      } else {
        continue;
      }
      const { tools } = await client.listTools();
      connected.set(server.name, { client, tools: tools.map((t) => t.name) });
      process.stderr.write(`fake agent: MCP ${server.name} has ${tools.length} tools\n`);
    } catch (error) {
      process.stderr.write(`fake agent: MCP ${server.name} failed: ${(error as Error).message}\n`);
    }
  }
  return connected;
}

function toolText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

/** Calls an `arbora-browser` tool and reports it as an ACP tool call, as real agents do for MCP tools. */
async function callBrowserTool(
  cx: AgentContext,
  sessionId: string,
  state: SessionState,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; images: number }> {
  const browser = state.mcp.get('arbora-browser');
  if (!browser) throw new Error('arbora-browser MCP server is not connected');
  const toolCallId = `mcp-${name}-${Date.now()}`;
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `arbora-browser: ${name}`,
      kind: 'other',
      status: 'in_progress',
      rawInput: args,
    },
  });
  const result = (await browser.client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: { type: string }[];
  };
  const text = toolText(result);
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: result.isError ? 'failed' : 'completed',
      rawOutput: { text },
    },
  });
  return {
    text,
    isError: result.isError === true,
    images: (result.content ?? []).filter((c) => c.type === 'image').length,
  };
}

/**
 * Calls every browser and dev-server tool once against the vite-react fixture and reports one line
 * per step (`name: ok <detail>` or `name: ERROR <message>`), for the Stage 5 e2e.
 */
async function toolSweep(cx: AgentContext, sessionId: string, state: SessionState): Promise<void> {
  const lines: string[] = [];
  const step = async (label: string, name: string, args: Record<string, unknown>, pick?: RegExp): Promise<string> => {
    const result = await callBrowserTool(cx, sessionId, state, name, args);
    const detail = pick ? (pick.exec(result.text)?.[0] ?? `(no match in ${result.text.slice(0, 200)})`) : '';
    const images = result.images > 0 ? ` images=${result.images}` : '';
    lines.push(`${label}: ${result.isError ? `ERROR ${result.text}` : `ok ${detail}${images}`.trim()}`);
    return result.text;
  };
  const refOf = (snapshot: string, role: string, name: string): string =>
    new RegExp(`${role} "${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(snapshot)?.[1] ?? 'missing';

  await step('url', 'browser_get_url', {}, /Page URL: \S+/);
  const snapshot = await step('snapshot', 'browser_snapshot', {}, /button "Log error"/);
  await step('click log error', 'browser_click', { ref: refOf(snapshot, 'button', 'Log error') });
  await step('console', 'browser_console_logs', { level: 'error' }, /fixture: intentional error/);
  await step('click missing api', 'browser_click', { ref: refOf(snapshot, 'button', 'Request missing API') });
  await step('network idle', 'browser_wait_for', { networkIdle: true, timeoutMs: 10_000 });
  await step('network', 'browser_network_errors', {}, /\[404\][^\n]*missing\.json/);
  await step('source', 'browser_get_element_source', { selector: '[data-testid="card-counter"] button' }, /Card\.tsx/);
  await step('type', 'browser_type', { ref: refOf(snapshot, 'textbox', 'Name'), text: 'Ada' });
  await step('select', 'browser_select_option', { ref: refOf(snapshot, 'combobox', 'Size'), values: ['Large'] });
  await step('echo', 'browser_wait_for', { text: 'Hello, Ada (large)', timeoutMs: 5000 });
  await step('key', 'browser_press_key', { key: 'Tab' });
  await step('hover', 'browser_hover', { selector: '[data-testid="card-counter"] button' });
  await step('element shot', 'browser_screenshot', { selector: '[data-testid="card-counter"]' }, /element screenshot/);
  await step('full shot', 'browser_screenshot', { mode: 'full' }, /full screenshot/);
  await step('scroll', 'browser_scroll', { dy: 300 }, /y=\d+/);
  await step('viewport size', 'browser_set_viewport', { width: 500, height: 700 }, /500×700/);
  await step('viewport preset', 'browser_set_viewport', { preset: 'responsive' }, /Responsive/);
  await step('navigate', 'browser_navigate', { url: '/?sweep=1' }, /sweep=1/);
  await step('back', 'browser_back', {}, /Page URL: \S+/);
  await step('forward', 'browser_forward', {}, /sweep=1/);
  await step('reload', 'browser_reload', {}, /sweep=1/);
  await step('snapshot again', 'browser_snapshot', {}, /Hello, nobody/);
  await step('stale ref', 'browser_click', { ref: 'e9999' });
  await step('devserver', 'devserver_status', {}, /"running": (true|false)/);
  await step('terminal', 'terminal_run', { command: 'echo sweep-ok', timeoutMs: 20_000 }, /sweep-ok/);
  await say(cx, sessionId, `Sweep results:\n${lines.join('\n')}`, state);
}

async function browserCheck(cx: AgentContext, sessionId: string, state: SessionState): Promise<void> {
  const tools = state.mcp.get('arbora-browser')?.tools ?? [];
  await say(cx, sessionId, `I have ${tools.length} browser tools.`, state);
  const before = await callBrowserTool(cx, sessionId, state, 'browser_snapshot', {});
  const ref = /button "Increment" \[ref=(e\d+)\]/.exec(before.text)?.[1];
  const count = (text: string): string => /Clicked \d+ times/.exec(text)?.[0] ?? 'no counter';
  if (!ref) {
    await say(cx, sessionId, `No Increment button in the snapshot:\n${before.text}`, state);
    return;
  }
  const clicked = await callBrowserTool(cx, sessionId, state, 'browser_click', { ref });
  if (clicked.isError) {
    await say(cx, sessionId, `Click failed: ${clicked.text}`, state);
    return;
  }
  await callBrowserTool(cx, sessionId, state, 'browser_wait_for', { text: 'Clicked 1 times', timeoutMs: 5000 });
  const after = await callBrowserTool(cx, sessionId, state, 'browser_snapshot', {});
  const shot = await callBrowserTool(cx, sessionId, state, 'browser_screenshot', {});
  await say(
    cx,
    sessionId,
    `Before: ${count(before.text)}. After clicking ${ref}: ${count(after.text)}. Screenshot images: ${shot.images}.`,
    state,
  );
}

const sessions = new Map<string, SessionState>();
let sessionCounter = 0;
let authenticated = process.env['FAKE_AGENT_AUTH'] !== '1';

function modesFor(): SessionModeState {
  return {
    currentModeId: 'ask',
    availableModes: [
      { id: 'ask', name: 'Ask', description: 'Ask before editing' },
      { id: 'code', name: 'Code', description: 'Edit freely' },
    ],
  };
}

function configFor(): SessionConfigOption[] {
  return [
    {
      type: 'select',
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: 'fast',
      options: [
        { value: 'fast', name: 'Fast' },
        { value: 'smart', name: 'Smart' },
      ],
    },
  ];
}

function promptText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `session/cancel` flips the flag from another task, which TypeScript's narrowing cannot see. */
function isCancelled(state: SessionState): boolean {
  return state.cancelled;
}

async function say(cx: AgentContext, sessionId: string, text: string, state: SessionState): Promise<void> {
  state.history.push({ role: 'agent', text });
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });
}

async function editFile(cx: AgentContext, sessionId: string, state: SessionState, file: string): Promise<void> {
  const path = isAbsolute(file) ? file : join(state.cwd, file);
  const toolCallId = `edit-${Date.now()}`;
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `Add a comment to ${basename(path)}`,
      kind: 'edit',
      status: 'pending',
      locations: [{ path, line: 1 }],
      rawInput: { path },
    },
  });
  const permission = await cx.request(methods.client.session.requestPermission, {
    sessionId,
    toolCall: { toolCallId, title: `Add a comment to ${basename(path)}`, kind: 'edit', rawInput: { path } },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always allow edits', kind: 'allow_always' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  const outcome = permission.outcome;
  const allowed = outcome.outcome === 'selected' && outcome.optionId.startsWith('allow');
  if (!allowed) {
    await cx.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' },
    });
    await say(cx, sessionId, 'Permission denied; nothing was changed.', state);
    return;
  }
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' },
  });
  // A missing file reads as empty, so the agent can create files too.
  const oldText = await cx.request(methods.client.fs.readTextFile, { sessionId, path }).then(
    (response) => response.content,
    () => '',
  );
  const newText = `// Arbora fake agent was here\n${oldText}`;
  try {
    await cx.request(methods.client.fs.writeTextFile, { sessionId, path, content: newText });
  } catch (error) {
    // Real agents report a refused write as a failed tool call and move on; so does this one.
    await cx.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' },
    });
    await say(
      cx,
      sessionId,
      `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
      state,
    );
    return;
  }
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      content: [{ type: 'diff', path, oldText, newText }],
    },
  });
  await say(cx, sessionId, `Added a comment at the top of ${basename(path)}.`, state);
}

async function runTerminal(cx: AgentContext, sessionId: string, state: SessionState): Promise<void> {
  const toolCallId = `run-${Date.now()}`;
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call', toolCallId, title: 'Run echo', kind: 'execute', status: 'in_progress' },
  });
  const terminal = await cx.createTerminal({
    sessionId,
    command: process.execPath,
    args: ['-e', "console.log('hello from fake agent')"],
    cwd: state.cwd,
    outputByteLimit: 4096,
  });
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      content: [{ type: 'terminal', terminalId: terminal.id }],
    },
  });
  const exit = await terminal.waitForExit();
  const output = await terminal.currentOutput();
  await terminal.release();
  await cx.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: exit.exitCode === 0 ? 'completed' : 'failed',
      rawOutput: { exitCode: exit.exitCode, output: output.output },
    },
  });
  await say(cx, sessionId, `The command printed: ${output.output.trim()} (exit ${exit.exitCode ?? 'null'})`, state);
}

async function sendPlan(cx: AgentContext, sessionId: string, state: SessionState): Promise<void> {
  const entries = [
    { content: 'Read the file', priority: 'high' as const, status: 'pending' as const },
    { content: 'Add the comment', priority: 'medium' as const, status: 'pending' as const },
    { content: 'Report back', priority: 'low' as const, status: 'pending' as const },
  ];
  for (let step = 0; step <= entries.length; step++) {
    if (isCancelled(state)) return;
    const snapshot = entries.map((entry, index) => ({
      ...entry,
      status: index < step ? ('completed' as const) : index === step ? ('in_progress' as const) : ('pending' as const),
    }));
    await cx.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: 'plan', entries: snapshot } });
    await sleep(50);
  }
}

async function handlePrompt(cx: AgentContext, params: PromptRequest): Promise<PromptResponse> {
  const state = sessions.get(params.sessionId);
  if (!state) throw RequestError.sessionNotFound(params.sessionId);
  state.cancelled = false;
  const { sessionId } = params;
  const text = promptText(params.prompt);
  state.history.push({ role: 'user', text });

  await cx.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking about the request…' } },
  });
  await say(cx, sessionId, `Working on: ${text.split('\n').pop() ?? ''}`, state);

  if (/crash/i.test(text)) {
    process.stderr.write('fake agent crashing on purpose\n');
    process.exit(3);
  }
  if (/stubborn/i.test(text)) {
    for (let i = 0; i < 300; i++) await sleep(100);
  }
  if (/slow/i.test(text)) {
    for (let i = 0; i < 100; i++) {
      if (isCancelled(state)) return { stopReason: 'cancelled' };
      await sleep(100);
    }
  }
  const image = params.prompt.find((b): b is ContentBlock & { type: 'image' } => b.type === 'image');
  if (image) {
    await say(cx, sessionId, `Received an image (${image.mimeType}, ${image.data.length} base64 chars).`, state);
  }
  const links = params.prompt.filter((b): b is ContentBlock & { type: 'resource_link' } => b.type === 'resource_link');
  if (links.length > 0) {
    await say(cx, sessionId, `Attached files: ${links.map((l) => l.name).join(', ')}.`, state);
  }
  if (/plan/i.test(text)) await sendPlan(cx, sessionId, state);
  if (isCancelled(state)) return { stopReason: 'cancelled' };
  const browser = /browser check|tool sweep/i.test(text);
  if (/browser check/i.test(text)) await browserCheck(cx, sessionId, state);
  if (/tool sweep/i.test(text)) await toolSweep(cx, sessionId, state);
  const restart = /restart dev/i.test(text);
  if (restart) {
    const result = await callBrowserTool(cx, sessionId, state, 'devserver_restart', {});
    const url = await callBrowserTool(cx, sessionId, state, 'browser_get_url', {});
    await say(cx, sessionId, `Restarted: ${result.isError ? `ERROR ${result.text}` : result.text}\n${url.text}`, state);
  }
  const evaluate = /\bevaluate\b/i.test(text);
  if (evaluate) {
    const result = await callBrowserTool(cx, sessionId, state, 'browser_evaluate', { expression: 'document.title' });
    await say(cx, sessionId, result.isError ? `Evaluate failed: ${result.text}` : `Page title: ${result.text}`, state);
  }
  if (browser || evaluate || restart) return { stopReason: 'end_turn' };
  const edit = /comment to `?([^\s`]+)`?/i.exec(text);
  if (edit?.[1]) await editFile(cx, sessionId, state, edit[1]);
  if (isCancelled(state)) return { stopReason: 'cancelled' };
  if (/\brun\b/i.test(text)) await runTerminal(cx, sessionId, state);
  if (isCancelled(state)) return { stopReason: 'cancelled' };
  if (!edit && !/\brun\b/i.test(text) && !image && !/plan/i.test(text)) {
    await say(cx, sessionId, 'Hi! I am the fake agent. Ask me to add a comment to a file or to run something.', state);
  }
  return { stopReason: 'end_turn' };
}

const app = agent({ name: 'arbora-fake-agent' })
  .onRequest(methods.agent.initialize, async () => {
    await sleep(Number(process.env['FAKE_AGENT_SLOW_START'] ?? 0));
    return {
      protocolVersion: 1,
      agentInfo: { name: 'arbora-fake-agent', version: '0.0.1' },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: process.env['FAKE_AGENT_NO_IMAGE'] !== '1', embeddedContext: true },
        mcpCapabilities: { http: httpMcp },
      },
      authMethods: authenticated ? [] : [{ id: 'fake-login', name: 'Fake login', description: 'Pretend to log in' }],
    };
  })
  .onRequest(methods.agent.authenticate, ({ params }) => {
    if (params.methodId !== 'fake-login') throw RequestError.invalidParams({ methodId: params.methodId });
    authenticated = true;
    return {};
  })
  .onRequest(methods.agent.session.new, async ({ params, client: cx }) => {
    if (!authenticated) throw RequestError.authRequired();
    const sessionId = `fake-${++sessionCounter}`;
    const state: SessionState = {
      cwd: params.cwd,
      history: [],
      modes: modesFor(),
      configOptions: configFor(),
      cancelled: false,
      mcp: await connectMcp(params.mcpServers),
    };
    sessions.set(sessionId, state);
    setTimeout(() => {
      void cx.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [
            { name: 'help', description: 'Explain what the fake agent can do' },
            { name: 'comment', description: 'Add a comment to a file', input: { hint: 'path' } },
          ],
        },
      });
    }, 0);
    await Promise.resolve();
    return { sessionId, modes: state.modes, configOptions: state.configOptions };
  })
  .onRequest(methods.agent.session.load, async ({ params, client: cx }) => {
    const state = sessions.get(params.sessionId);
    if (!state) throw RequestError.sessionNotFound(params.sessionId);
    for (const entry of state.history) {
      await cx.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
          content: { type: 'text', text: entry.text },
        },
      });
    }
    return { modes: state.modes, configOptions: state.configOptions };
  })
  .onRequest(methods.agent.session.setMode, async ({ params, client: cx }) => {
    const state = sessions.get(params.sessionId);
    if (!state) throw RequestError.sessionNotFound(params.sessionId);
    state.modes = { ...state.modes, currentModeId: params.modeId };
    await cx.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: params.modeId },
    });
    return {};
  })
  .onRequest(methods.agent.session.setConfigOption, async ({ params, client: cx }) => {
    const state = sessions.get(params.sessionId);
    if (!state) throw RequestError.sessionNotFound(params.sessionId);
    state.configOptions = state.configOptions.map((option) =>
      option.id === params.configId && option.type === 'select' && typeof params.value === 'string'
        ? { ...option, currentValue: params.value }
        : option,
    );
    await cx.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'config_option_update', configOptions: state.configOptions },
    });
    return { configOptions: state.configOptions };
  })
  .onRequest(methods.agent.session.prompt, ({ params, client: cx }) => handlePrompt(cx, params))
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    const state = sessions.get(params.sessionId);
    if (state) state.cancelled = true;
  });

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
const connection = app.connect(stream);
process.stderr.write('fake agent ready\n');
void connection.closed.then(() => process.exit(0));
