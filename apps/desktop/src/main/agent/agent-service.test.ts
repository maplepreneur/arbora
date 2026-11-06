import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServer } from '@agentclientprotocol/sdk';
import { AgentRegistry, FAKE_AGENT_PATH } from '@arbora/acp-client';
import {
  DEFAULT_THREAD_TITLE,
  toPlatform,
  type AcpLogEntry,
  type RememberedPermissions,
  type ThreadChange,
  type ThreadState,
  type ThreadSummary,
} from '@arbora/shared';
import type { BrowserToolHost, Cdp } from '@arbora/mcp-browser-server';
import { openBrowserTools } from '../mcp/browser-tools.js';
import { GroveHost } from '../mcp/grove-tool-host.js';
import { TerminalService } from '../terminal/terminal-service.js';
import { AgentService, STOP_GRACE_MS, type McpAttachment } from './agent-service.js';
import { threadsDir } from './thread-store.js';

const platform = toPlatform(process.platform);
const FAKE = 'fake';

/** A temp project root; `realpath` so fs change paths compare equal on macOS, where `/var` is a symlink. */
function makeRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'arbora-agent-')));
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return env;
}

interface Harness {
  service: AgentService;
  terminals: TerminalService;
  threads: ThreadSummary[];
  changes: Map<string, ThreadChange[]>;
  states: Map<string, ThreadState[]>;
  logs: AcpLogEntry[];
  fileChanges: string[];
  permissions: RememberedPermissions;
}

describe('AgentService with the fake agent', { timeout: 30_000 }, () => {
  let root: string;
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      await h.service.dispose();
      h.terminals.dispose();
    }
    // Windows reports EBUSY while the killed agent process is still releasing its cwd.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  function setup(
    options: {
      env?: Record<string, string>;
      permissions?: RememberedPermissions;
      defaultModel?: string;
      mcp?: (threadId: string) => Promise<McpAttachment>;
      userMcpServers?: (agentId: string, http: boolean) => McpServer[];
      onSessionEnded?: (threadId: string) => void;
    } = {},
  ): Harness {
    const h: Harness = {
      service: null as unknown as AgentService,
      terminals: null as unknown as TerminalService,
      threads: [],
      changes: new Map(),
      states: new Map(),
      logs: [],
      fileChanges: [],
      permissions: options.permissions ?? {},
    };
    const environment = (): Promise<Record<string, string>> => Promise.resolve(processEnv());
    h.terminals = new TerminalService({
      platform,
      cwd: root,
      environment,
      shell: () => undefined,
      events: { data: () => undefined, changed: () => undefined, url: () => undefined },
    });
    const registry = new AgentRegistry(() => [
      { id: FAKE, name: 'Fake agent', command: process.execPath, args: [FAKE_AGENT_PATH], env: options.env ?? {} },
    ]);
    h.service = new AgentService({
      platform,
      projectPath: root,
      registry,
      environment,
      lookup: () => (command) => (existsSync(command) ? command : undefined),
      terminals: h.terminals,
      devUrl: () => 'http://localhost:5173/',
      defaultModel: () => options.defaultModel,
      ...(options.mcp ? { mcp: options.mcp } : {}),
      ...(options.userMcpServers ? { userMcpServers: options.userMcpServers } : {}),
      permissions: {
        get: () => h.permissions,
        remember: (key, decision) => {
          h.permissions = { ...h.permissions, [key]: decision };
        },
      },
      events: {
        threadsChanged: (threads) => (h.threads = threads),
        groupsChanged: () => undefined,
        threadEvents: (threadId, changes) => h.changes.set(threadId, [...(h.changes.get(threadId) ?? []), ...changes]),
        threadState: (threadId, state) => h.states.set(threadId, [...(h.states.get(threadId) ?? []), state]),
        log: (_threadId, entry) => h.logs.push(entry),
        fileChanged: (_threadId, path) => h.fileChanges.push(path),
      },
      ...(options.onSessionEnded ? { onSessionEnded: options.onSessionEnded } : {}),
    });
    harnesses.push(h);
    return h;
  }

  function latestState(h: Harness, threadId: string): ThreadState | undefined {
    const states = h.states.get(threadId);
    return states?.[states.length - 1];
  }

  function agentText(h: Harness, threadId: string): string {
    return (h.service.getThread(threadId)?.events ?? [])
      .flatMap((e) => (e.kind === 'agent_message' ? e.blocks : []))
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
  }

  function summaryOf(h: Harness, threadId: string): ThreadSummary | undefined {
    return h.service.listThreads().find((t) => t.id === threadId);
  }

  it('runs a task in a hidden session that cannot write files', async () => {
    root = makeRoot();
    writeFileSync(join(root, 'App.tsx'), 'export {};\n');
    const h = setup();
    const reply = await h.service.runTask(FAKE, null, 'Please add a comment to App.tsx');
    expect(reply).toContain('Working on: Please add a comment to App.tsx');
    expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toBe('export {};\n');
    expect(h.service.listThreads()).toEqual([]);
    expect(h.threads).toEqual([]);
    expect(existsSync(threadsDir(root))).toBe(false);
  });

  it('groups and pins threads, persists both, and ungroups threads of a removed group', async () => {
    root = makeRoot();
    const h = setup();
    expect(h.service.listGroups()).toEqual([]);
    h.service.saveGroups([
      { id: 'ui', name: 'UI', color: 'blue', collapsed: false },
      { id: 'api', name: 'API', color: 'green', collapsed: false },
    ]);
    const a = h.service.createThread(FAKE, { groupId: 'ui' });
    const b = h.service.createThread(FAKE, { groupId: 'missing' });
    expect(a.groupId).toBe('ui');
    expect(b.groupId).toBeNull();
    h.service.setThreadGroup(b.id, 'api');
    h.service.setThreadPinned(a.id, true);
    expect(() => h.service.setThreadGroup(a.id, 'nope')).toThrow(/Unknown agent group/);
    expect(() =>
      h.service.saveGroups([
        { id: 'x', name: 'X', color: 'gray', collapsed: false },
        { id: 'x', name: 'Y', color: 'gray', collapsed: false },
      ]),
    ).toThrow(/unique/);
    h.service.saveGroups([{ id: 'ui', name: 'Frontend', color: 'purple', collapsed: true }]);
    expect(h.threads.find((t) => t.id === b.id)?.groupId).toBeNull();
    await h.service.dispose();

    const reopened = setup();
    expect(reopened.service.listGroups()).toEqual([{ id: 'ui', name: 'Frontend', color: 'purple', collapsed: true }]);
    const restored = reopened.service.listThreads();
    expect(restored.find((t) => t.id === a.id)).toMatchObject({ groupId: 'ui', pinned: true });
    expect(restored.find((t) => t.id === b.id)).toMatchObject({ groupId: null, pinned: false });
  });

  it('creates a thread, edits a file after a permission card is answered, and persists the transcript', async () => {
    root = makeRoot();
    writeFileSync(join(root, 'App.tsx'), 'export const App = () => null;\n');
    const h = setup();
    const thread = h.service.createThread(FAKE);
    // The agent process starts as soon as the thread exists so the first prompt is fast.
    expect(thread.state.status).toBe('starting');
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('ready');
    const ready = latestState(h, thread.id);
    expect(ready?.modes?.currentModeId).toBe('ask');
    expect(ready?.configOptions[0]).toMatchObject({ id: 'model', currentValue: 'fast' });
    await expect.poll(() => latestState(h, thread.id)?.availableCommands.length).toBe(2);

    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'add a comment to `App.tsx`' }]);
    // The permission card arrives as a pending event; answer it with the agent's own option id.
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission'), { timeout: 10_000 })
      .toBeDefined();
    const permission = h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    expect(permission.outcome).toBeNull();
    expect(permission.options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    h.service.respondPermission(thread.id, permission.requestId, 'allow');

    const result = await turn;
    expect(result).toEqual({ stopReason: 'end_turn' });
    expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toBe(
      '// Arbora fake agent was here\nexport const App = () => null;\n',
    );
    expect(h.fileChanges).toEqual([join(root, 'App.tsx')]);

    const transcript = h.service.getThread(thread.id);
    const kinds = transcript?.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'user_message',
      'agent_thought',
      'agent_message',
      'tool_call',
      'permission',
      'agent_message',
      'turn_end',
    ]);
    const tool = transcript?.events.find((e) => e.kind === 'tool_call');
    expect(tool?.kind === 'tool_call' && tool.status).toBe('completed');
    expect(tool?.kind === 'tool_call' && tool.content[0]).toMatchObject({ type: 'diff', path: join(root, 'App.tsx') });
    // The first user message is shown as typed; the preface only goes to the agent.
    const user = transcript?.events[0];
    expect(user?.kind === 'user_message' && user.blocks[0]).toEqual({
      type: 'text',
      text: 'add a comment to `App.tsx`',
    });
    const sentPrompt = h.logs.find(
      (entry) =>
        entry.direction === 'out' &&
        typeof entry.message === 'object' &&
        entry.message !== null &&
        (entry.message as { method?: string }).method === 'session/prompt',
    );
    expect(JSON.stringify(sentPrompt?.message)).toContain('You are working inside Arbora');
    expect(JSON.stringify(sentPrompt?.message)).toContain('http://localhost:5173/');
    expect(h.threads[0]?.title).toBe('add a comment to `App.tsx`');
    expect(latestState(h, thread.id)?.status).toBe('ready');

    // Persisted after the save debounce.
    const file = join(threadsDir(root), `${thread.id}.json`);
    const readFile = (): unknown => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
    await expect.poll(readFile, { timeout: 5_000 }).toMatchObject({
      version: 1,
      id: thread.id,
      agentId: FAKE,
      sessionId: 'fake-1',
      events: expect.any(Array) as unknown,
    });
    expect((readFile() as { events: unknown[] }).events).toHaveLength(7);
  });

  it('remembers "always" answers per agent and tool kind, and auto-approves edits inside the project', async () => {
    root = makeRoot();
    writeFileSync(join(root, 'a.ts'), 'a\n');
    writeFileSync(join(root, 'b.ts'), 'b\n');
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const first = h.service.prompt(thread.id, [{ type: 'text', text: 'add a comment to a.ts' }]);
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission'), { timeout: 15_000 })
      .toBeDefined();
    const permission = h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    h.service.respondPermission(thread.id, permission.requestId, 'allow-always');
    await first;
    expect(h.permissions).toEqual({ [`${FAKE}:edit`]: 'allow' });

    // Second edit: answered automatically from memory, no pending card.
    await h.service.prompt(thread.id, [{ type: 'text', text: 'add a comment to b.ts' }]);
    const permissions = h.service.getThread(thread.id)?.events.filter((e) => e.kind === 'permission') ?? [];
    expect(permissions).toHaveLength(2);
    expect(permissions[1]?.kind === 'permission' && permissions[1].outcome).toEqual({ optionId: 'allow', auto: true });
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toContain('fake agent');

    // Auto-approve edits on a fresh thread with no memory.
    h.permissions = {};
    const second = h.service.createThread(FAKE);
    h.service.setAutoApproveEdits(second.id, true);
    writeFileSync(join(root, 'c.ts'), 'c\n');
    await h.service.prompt(second.id, [{ type: 'text', text: 'add a comment to c.ts' }]);
    const auto = h.service.getThread(second.id)?.events.find((e) => e.kind === 'permission');
    expect(auto?.kind === 'permission' && auto.outcome).toEqual({ optionId: 'allow', auto: true });
    expect(h.permissions).toEqual({});
  });

  it('rejects file access outside the project', async () => {
    root = makeRoot();
    const outside = join(tmpdir(), `arbora-outside-${Date.now()}.ts`);
    const h = setup();
    const thread = h.service.createThread(FAKE);
    h.service.setAutoApproveEdits(thread.id, true);
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: `add a comment to ${outside}` }]);
    // Auto-approve does not apply outside the project: the card waits for the user.
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission'), { timeout: 15_000 })
      .toBeDefined();
    const permission = h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    expect(permission.outcome).toBeNull();
    h.service.respondPermission(thread.id, permission.requestId, 'allow');
    // Even when allowed, the write is refused by the path scope and the agent reports a failed tool call.
    const result = await turn;
    expect(result).toEqual({ stopReason: 'end_turn' });
    expect(existsSync(outside)).toBe(false);
    const events = h.service.getThread(thread.id)?.events ?? [];
    expect(events.find((e) => e.kind === 'tool_call')).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(events)).toMatch(/Access denied: .* is outside the project folder/);
  });

  it('runs agent commands as read-only agent terminals and feeds the output back', async () => {
    root = makeRoot();
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const result = await h.service.prompt(thread.id, [{ type: 'text', text: 'run echo' }]);
    expect(result.stopReason).toBe('end_turn');
    const terminals = h.terminals.list();
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ kind: 'agent', readOnly: true });
    const last = h.service
      .getThread(thread.id)
      ?.events.filter((e) => e.kind === 'agent_message')
      .pop();
    expect(last?.kind === 'agent_message' && last.blocks[0]?.type === 'text' && last.blocks[0].text).toContain(
      'hello from fake agent',
    );
    const tool = h.service.getThread(thread.id)?.events.find((e) => e.kind === 'tool_call');
    expect(tool?.kind === 'tool_call' && tool.content[0]).toEqual({ type: 'terminal', terminalId: terminals[0]?.id });
  });

  it('cancels a slow turn', async () => {
    root = makeRoot();
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'slow' }]);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('prompting');
    await h.service.cancel(thread.id);
    expect((await turn).stopReason).toBe('cancelled');
    expect(h.service.getThread(thread.id)?.events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'cancelled' });
  });

  it('stops a turn the agent will not cancel by stopping its process, and the thread keeps working', async () => {
    root = makeRoot();
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'stubborn' }]);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('prompting');
    const started = Date.now();
    await h.service.stop(thread.id);
    expect(Date.now() - started).toBeLessThan(STOP_GRACE_MS + 4000);
    expect((await turn).stopReason).toBe('cancelled');
    expect(latestState(h, thread.id)?.status).toBe('idle');
    const events = h.service.getThread(thread.id)?.events ?? [];
    expect(events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'cancelled' });
    expect(events.some((e) => e.kind === 'error')).toBe(false);
    // The next prompt starts the agent again.
    const next = await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    expect(next.stopReason).toBe('end_turn');
  });

  it('stops an agent that is still starting; a waiting prompt ends as cancelled', async () => {
    root = makeRoot();
    const h = setup({ env: { FAKE_AGENT_SLOW_START: '20000' } });
    const thread = h.service.createThread(FAKE);
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('starting');
    await h.service.stop(thread.id);
    expect(await turn).toEqual({ stopReason: 'cancelled' });
    expect(latestState(h, thread.id)?.status).toBe('idle');
    expect(h.service.getThread(thread.id)?.events.some((e) => e.kind === 'user_message')).toBe(false);
  });

  it('applies the default model to new threads', async () => {
    root = makeRoot();
    const h = setup({ defaultModel: 'smart' });
    const thread = h.service.createThread(FAKE);
    await expect
      .poll(() => latestState(h, thread.id)?.configOptions[0], { timeout: 15_000 })
      .toMatchObject({ id: 'model', currentValue: 'smart' });
    // The agent's `config_option_update` can land before the `set_config_option` reply is logged.
    await expect
      .poll(() =>
        h.logs.some((e) => e.direction === 'info' && String(e.message).includes('default model smart applied')),
      )
      .toBe(true);
  });

  it('keeps the agent model when the default is not offered', async () => {
    root = makeRoot();
    const h = setup({ defaultModel: 'other-agent-model' });
    const thread = h.service.createThread(FAKE);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('ready');
    expect(latestState(h, thread.id)?.configOptions[0]).toMatchObject({ currentValue: 'fast' });
  });

  it('restores persisted threads on construction and loads the session where advertised', async () => {
    root = makeRoot();
    const first = setup();
    const thread = first.service.createThread(FAKE);
    await first.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    const before = first.service.getThread(thread.id)?.events.length ?? 0;
    await first.service.dispose();
    first.terminals.dispose();
    harnesses.splice(0);

    const second = setup();
    const restored = second.service.listThreads();
    expect(restored.map((t) => t.id)).toEqual([thread.id]);
    expect(restored[0]?.state.status).toBe('idle');
    expect(second.service.getThread(thread.id)?.events).toHaveLength(before);

    // A new fake agent process does not know the old session id, so load fails and a new session starts
    // with a notice; the persisted transcript is kept.
    await second.service.prompt(thread.id, [{ type: 'text', text: 'again' }]);
    const events = second.service.getThread(thread.id)?.events ?? [];
    expect(events.length).toBeGreaterThan(before);
    expect(events.some((e) => e.kind === 'notice' && e.title.includes('could not be restored'))).toBe(true);
    expect(latestState(second, thread.id)?.contextLost).toBe(true);
    expect(second.logs.some((e) => e.direction === 'info' && String(e.message).includes('session/load'))).toBe(true);
  });

  it('reports a crash with the exit code and recovers on the next prompt', async () => {
    root = makeRoot();
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const result = await h.service.prompt(thread.id, [{ type: 'text', text: 'crash' }]);
    expect(result.stopReason).toBeNull();
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 10_000 }).toBe('error');
    expect(latestState(h, thread.id)?.error).toMatch(/code 3/);
    expect(h.logs.some((e) => e.direction === 'stderr' && String(e.message).includes('crashing on purpose'))).toBe(
      true,
    );

    const next = await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    expect(next.stopReason).toBe('end_turn');
    expect(latestState(h, thread.id)?.status).toBe('ready');
  });

  it('surfaces auth_required with the agent methods and continues after authenticate', async () => {
    root = makeRoot();
    const h = setup({ env: { FAKE_AGENT_AUTH: '1' } });
    const thread = h.service.createThread(FAKE);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('auth_required');
    expect(latestState(h, thread.id)?.authMethods).toEqual([
      { id: 'fake-login', name: 'Fake login', description: 'Pretend to log in' },
    ]);
    const result = await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    expect(result).toEqual({ stopReason: null, error: 'auth_required' });
    // Prompting while the agent waits for login must reuse the running process, not spawn another.
    const spawns = (): number =>
      h.logs.filter((e) => e.direction === 'info' && /spawning/.test(String(e.message))).length;
    expect(spawns()).toBe(1);
    await h.service.authenticate(thread.id, 'fake-login');
    // The pending prompt is sent once the session exists.
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.some((e) => e.kind === 'turn_end'), { timeout: 10_000 })
      .toBe(true);
    expect(latestState(h, thread.id)?.status).toBe('ready');
  });

  it('redacts secrets in the log and exports it', async () => {
    root = makeRoot();
    const h = setup({ env: { FAKE_TOKEN: 'super-secret' } });
    const thread = h.service.createThread(FAKE);
    await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    const log = h.service.getLog(thread.id);
    expect(log.some((e) => e.direction === 'in')).toBe(true);
    expect(log.some((e) => e.direction === 'out')).toBe(true);
    expect(JSON.stringify(log)).not.toContain('super-secret');
    const target = join(root, 'log.json');
    await h.service.exportLog(thread.id, target);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toMatchObject({ thread: { id: thread.id } });
  });

  it('attaches the browser tools to the session and asks before browser_evaluate', async () => {
    root = makeRoot();
    const confirms: string[] = [];
    let threadId = '';
    let service: AgentService | null = null;
    const h = setup({
      mcp: () =>
        openBrowserTools(
          stubToolHost({
            confirm: async (request) => {
              confirms.push(request.title);
              const answer = await service?.requestToolPermission(threadId, {
                title: request.title,
                detail: request.detail,
                toolKind: 'execute',
                persistent: true,
              });
              return answer === 'allow_once';
            },
          }),
          { command: process.execPath, script: 'unused.js' },
          '0.0.0',
        ),
    });
    service = h.service;
    const thread = h.service.createThread(FAKE);
    threadId = thread.id;
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'evaluate the title' }]);
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission'), { timeout: 15_000 })
      .toBeDefined();
    const permission = h.service.getThread(thread.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    expect(permission.title).toBe('Run JavaScript in the page');
    expect(permission.options.map((o) => o.kind)).toEqual([
      'allow_once',
      'allow_always',
      'reject_once',
      'reject_always',
    ]);
    h.service.respondPermission(thread.id, permission.requestId, 'allow');
    expect(await turn).toEqual({ stopReason: 'end_turn' });
    expect(confirms).toEqual(['Run JavaScript in the page']);
    const messages = h.service
      .getThread(thread.id)
      ?.events.flatMap((e) => (e.kind === 'agent_message' ? e.blocks : []))
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    expect(messages).toContain('Page title: "Stub page"');
    // No "tools not loaded" warning: the agent listed them at session/new.
    expect(h.service.getThread(thread.id)?.events.some((e) => e.kind === 'notice')).toBe(false);

    const log = h.service.getLog(thread.id);
    expect(log.some((e) => e.direction === 'info' && String(e.message) === 'browser tools attached over http')).toBe(
      true,
    );
    const sessionNew = log.find(
      (e) => e.direction === 'out' && (e.message as { method?: string }).method === 'session/new',
    );
    expect(sessionNew?.message).toMatchObject({
      params: {
        mcpServers: [
          { type: 'http', name: 'arbora-browser', headers: [{ name: 'Authorization', value: '[redacted]' }] },
        ],
      },
    });
    const prompt = log.find(
      (e) => e.direction === 'out' && (e.message as { method?: string }).method === 'session/prompt',
    );
    expect(JSON.stringify(prompt?.message)).toContain('arbora-browser');
    expect(JSON.stringify(log)).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
  });

  it("passes the user's MCP servers to session/new", async () => {
    root = makeRoot();
    const asked: [string, boolean][] = [];
    const h = setup({
      userMcpServers: (agentId, http) => {
        asked.push([agentId, http]);
        return [{ name: 'docs', command: 'definitely-not-a-command', args: [], env: [] }];
      },
    });
    const thread = h.service.createThread(FAKE);
    await h.service.prompt(thread.id, [{ type: 'text', text: 'list mcp servers' }]);
    expect(asked).toEqual([[FAKE, true]]);
    const text = h.service
      .getThread(thread.id)
      ?.events.flatMap((e) => (e.kind === 'agent_message' ? e.blocks : []))
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    expect(text).toContain('MCP servers: docs (not connected)');
    expect(h.service.getLog(thread.id).some((e) => String(e.message) === 'your MCP servers: docs')).toBe(true);
  });

  it('warns once when the agent never lists the browser tools', async () => {
    root = makeRoot();
    const h = setup({
      mcp: () => Promise.resolve({ servers: () => [], toolsListed: false, close: () => Promise.resolve() }),
    });
    const thread = h.service.createThread(FAKE);
    await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    await h.service.prompt(thread.id, [{ type: 'text', text: 'hello again' }]);
    const notices = h.service.getThread(thread.id)?.events.filter((e) => e.kind === 'notice') ?? [];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ severity: 'warning', title: expect.stringMatching(/browser tools/) as unknown });
  });

  it('creates threads with a title, a lead and auto-approve edits', async () => {
    root = makeRoot();
    const h = setup();
    const lead = h.service.createThread(FAKE, { title: '  fix the nav  ' });
    expect(lead).toMatchObject({
      title: 'fix the nav',
      parentThreadId: null,
      archivedAt: null,
      autoApproveEdits: false,
    });
    const helper = h.service.createThread(FAKE, { parentThreadId: lead.id, autoApproveEdits: true });
    expect(helper).toMatchObject({ title: DEFAULT_THREAD_TITLE, parentThreadId: lead.id, autoApproveEdits: true });
    expect(h.service.createThread(FAKE, { parentThreadId: 'gone' }).parentThreadId).toBeNull();
    await h.service.prompt(lead.id, [{ type: 'text', text: 'hello' }]);
    expect(summaryOf(h, lead.id)?.title).toBe('fix the nav');
  });

  it('reports the session ending when the process stops', async () => {
    root = makeRoot();
    const ended: string[] = [];
    const h = setup({ onSessionEnded: (threadId) => ended.push(threadId) });
    const thread = h.service.createThread(FAKE);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('ready');
    expect(ended).toEqual([]);
    await h.service.stopProcess(thread.id);
    expect(ended).toEqual([thread.id]);
  });

  it('stops the process and starts it again on the next prompt', async () => {
    root = makeRoot();
    const h = setup();
    const thread = h.service.createThread(FAKE);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('ready');
    await h.service.stopProcess(thread.id);
    expect(latestState(h, thread.id)?.status).toBe('idle');
    expect(h.service.isSettled(thread.id)).toBe(true);
    expect((await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }])).stopReason).toBe('end_turn');

    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'slow' }]);
    await expect.poll(() => latestState(h, thread.id)?.status).toBe('prompting');
    await h.service.stopProcess(thread.id);
    expect(await turn).toEqual({ stopReason: 'cancelled' });
    expect(latestState(h, thread.id)?.status).toBe('idle');
  });

  it('archives a thread, refuses prompts while archived, and restores it', async () => {
    root = makeRoot();
    const first = setup();
    const thread = first.service.createThread(FAKE);
    await first.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    await first.service.setArchived(thread.id, true);
    const archived = summaryOf(first, thread.id);
    expect(archived?.archivedAt).toEqual(expect.any(Number));
    expect(archived?.state.status).toBe('idle');
    expect(first.service.isSettled(thread.id)).toBe(true);
    await expect(first.service.prompt(thread.id, [{ type: 'text', text: 'again' }])).rejects.toThrow(/archived/);
    await first.service.dispose();
    first.terminals.dispose();
    harnesses.splice(0);

    const second = setup();
    expect(summaryOf(second, thread.id)?.archivedAt).toBe(archived?.archivedAt);
    await second.service.setArchived(thread.id, false);
    expect(summaryOf(second, thread.id)?.archivedAt).toBeNull();
    expect((await second.service.prompt(thread.id, [{ type: 'text', text: 'again' }])).stopReason).toBe('end_turn');
  });

  it('waits for threads to settle and gives up on a timeout, an abort or the end of the lead turn', async () => {
    root = makeRoot();
    const h = setup();
    const a = h.service.createThread(FAKE);
    const b = h.service.createThread(FAKE);
    expect(h.service.isSettled(a.id)).toBe(false);
    expect(await h.service.waitForSettled([a.id, b.id], { until: 'all', timeoutMs: 15_000 })).toBe(true);

    const slowA = h.service.prompt(a.id, [{ type: 'text', text: 'slow' }]);
    expect(h.service.isSettled(a.id)).toBe(false);
    expect(await h.service.waitForSettled([a.id], { until: 'all', timeoutMs: 100 })).toBe(false);
    const controller = new AbortController();
    const aborted = h.service.waitForSettled([a.id], { until: 'all', timeoutMs: 15_000, signal: controller.signal });
    controller.abort();
    expect(await aborted).toBe(false);

    const quick = h.service.prompt(b.id, [{ type: 'text', text: 'hello' }]);
    expect(await h.service.waitForSettled([a.id, b.id], { until: 'any', timeoutMs: 15_000 })).toBe(true);
    await quick;

    await expect.poll(() => latestState(h, a.id)?.status).toBe('prompting');
    const slowB = h.service.prompt(b.id, [{ type: 'text', text: 'slow' }]);
    const leadWait = h.service.waitForSettled([b.id], { until: 'all', timeoutMs: 15_000, turnOf: a.id });
    await h.service.cancel(a.id);
    expect(await leadWait).toBe(false);
    expect((await slowA).stopReason).toBe('cancelled');

    const settled = h.service.waitForSettled([b.id], { until: 'all', timeoutMs: 15_000 });
    await expect.poll(() => latestState(h, b.id)?.status).toBe('prompting');
    await h.service.cancel(b.id);
    expect(await settled).toBe(true);
    expect((await slowB).stopReason).toBe('cancelled');
  });

  it('counts a thread that waits on the user, and a deleted thread, as settled', async () => {
    root = makeRoot();
    writeFileSync(join(root, 'App.tsx'), 'export {};\n');
    const h = setup();
    const a = h.service.createThread(FAKE);
    const turn = h.service.prompt(a.id, [{ type: 'text', text: 'Please add a comment to App.tsx' }]);
    expect(await h.service.waitForSettled([a.id], { until: 'all', timeoutMs: 15_000 })).toBe(true);
    const permission = h.service.getThread(a.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    expect(permission.outcome).toBeNull();
    h.service.respondPermission(a.id, permission.requestId, 'reject');
    expect((await turn).stopReason).toBe('end_turn');

    const b = h.service.createThread(FAKE);
    const slow = h.service.prompt(b.id, [{ type: 'text', text: 'slow' }]);
    const waiting = h.service.waitForSettled([b.id], { until: 'all', timeoutMs: 15_000 });
    await h.service.deleteThread(b.id);
    expect(await waiting).toBe(true);
    await slow;
  });

  it('lets a lead start a helper with the Grove tools, wait for it and read its reply', async () => {
    root = makeRoot();
    let service: AgentService | null = null;
    const h = setup({
      mcp: (threadId) => {
        const thread = service?.listThreads().find((t) => t.id === threadId);
        const grove =
          thread?.parentThreadId === null
            ? new GroveHost({
                threadId,
                agents: () => service,
                agentSettings: () => ({ defaultAgent: FAKE, hidden: [], verified: {} }),
                projectDefaultAgent: () => undefined,
                maxHelpers: () => 2,
              })
            : undefined;
        return openBrowserTools(stubToolHost({}), { command: process.execPath, script: 'unused.js' }, '0.0.0', {
          grove,
        });
      },
    });
    service = h.service;
    h.service.saveGroups([{ id: 'ui', name: 'UI', color: 'blue', collapsed: false }]);
    const lead = h.service.createThread(FAKE, { groupId: 'ui', autoApproveEdits: true });
    const turn = h.service.prompt(lead.id, [{ type: 'text', text: 'grove delegate' }]);
    await expect
      .poll(() => h.service.getThread(lead.id)?.events.find((e) => e.kind === 'permission'), { timeout: 15_000 })
      .toBeDefined();
    const permission = h.service.getThread(lead.id)?.events.find((e) => e.kind === 'permission');
    if (permission?.kind !== 'permission') throw new Error('no permission');
    expect(permission.title).toBe('grove delegate wants to start helper agents');
    expect(permission.options.map((o) => o.kind)).toEqual(['allow_once', 'reject_once']);
    h.service.respondPermission(lead.id, permission.requestId, 'allow');
    expect(await turn).toEqual({ stopReason: 'end_turn' });

    const helper = h.service.listThreads().find((t) => t.parentThreadId === lead.id);
    expect(helper).toMatchObject({ title: 'say hello from the helper', groupId: 'ui', autoApproveEdits: true });
    if (!helper) throw new Error('no helper');
    expect(agentText(h, helper.id)).toContain('Working on: say hello from the helper');
    const reply = agentText(h, lead.id);
    expect(reply).toContain('Settled:');
    expect(reply).toContain('The helper said: "Working on: say hello from the helper');
    const sentPrompt = (threadId: string): string =>
      JSON.stringify(
        h.service
          .getLog(threadId)
          .find((e) => e.direction === 'out' && (e.message as { method?: string }).method === 'session/prompt')
          ?.message,
      );
    expect(sentPrompt(lead.id)).toContain('grove_start_agent');
    // One level: a helper gets the browser tools but not the Grove tools.
    expect(sentPrompt(helper.id)).toContain('arbora-browser');
    expect(sentPrompt(helper.id)).not.toContain('grove_');
  });
});

/** A browser-tools host with a page titled "Stub page" whose CDP only answers `Runtime.evaluate`. */
function stubToolHost(overrides: Partial<BrowserToolHost>): BrowserToolHost {
  const page = { url: 'http://localhost:5173/', title: 'Stub page', loading: false, error: null };
  const cdp: Cdp = {
    send: (method) =>
      Promise.resolve(method === 'Runtime.evaluate' ? { result: { type: 'string', value: 'Stub page' } } : {}),
    on: () => () => undefined,
  };
  const fail = (): never => {
    throw new Error('not in this test');
  };
  return {
    cdp: () => Promise.resolve(cdp),
    page: () => page,
    devUrl: () => page.url,
    navigate: fail,
    reload: fail,
    history: fail,
    screenshot: fail,
    consoleLogs: () => [],
    networkErrors: () => [],
    navigatedAt: () => 0,
    elementSource: fail,
    setViewport: fail,
    devServerStatus: () => ({ running: false, command: null, url: null }),
    devServerLogs: () => [],
    devServerRestart: fail,
    terminalRun: fail,
    policy: () => 'ask',
    confirm: () => Promise.resolve(false),
    ...overrides,
  };
}
