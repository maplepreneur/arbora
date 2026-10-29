/**
 * A tiny ACP agent for tests and e2e, in the spirit of the SDK's examples. It is a standalone
 * script (`node fake-agent.ts`, Node's type stripping), so it only imports the SDK and Node.
 *
 * Behaviour is driven by the prompt text:
 * - "add a comment to `FILE`": edit tool call -> permission -> fs/read + fs/write -> diff
 * - "run ...": client terminal running `echo hello from fake agent`, output read back
 * - "plan": a three-entry plan that completes step by step
 * - "slow": a turn that takes ~10 s unless cancelled
 * - "crash": the process exits with code 3 mid-turn
 * - an `image` block in the prompt is acknowledged with its MIME type and size
 * - FAKE_AGENT_AUTH=1 advertises an auth method and rejects session/new until `authenticate`
 * - FAKE_AGENT_NO_IMAGE=1 advertises `promptCapabilities.image: false` (clients must send file links)
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
  type PromptRequest,
  type PromptResponse,
  type SessionConfigOption,
  type SessionModeState,
} from '@agentclientprotocol/sdk';

interface SessionState {
  cwd: string;
  history: { role: 'user' | 'agent'; text: string }[];
  modes: SessionModeState;
  configOptions: SessionConfigOption[];
  cancelled: boolean;
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
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: 1,
    agentInfo: { name: 'arbora-fake-agent', version: '0.0.1' },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: process.env['FAKE_AGENT_NO_IMAGE'] !== '1', embeddedContext: true },
      mcpCapabilities: { http: true },
    },
    authMethods: authenticated ? [] : [{ id: 'fake-login', name: 'Fake login', description: 'Pretend to log in' }],
  }))
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
