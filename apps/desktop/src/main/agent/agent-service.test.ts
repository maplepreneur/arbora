import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, FAKE_AGENT_PATH } from '@arbora/acp-client';
import {
  toPlatform,
  type AcpLogEntry,
  type RememberedPermissions,
  type ThreadChange,
  type ThreadState,
  type ThreadSummary,
} from '@arbora/shared';
import { TerminalService } from '../terminal/terminal-service.js';
import { AgentService } from './agent-service.js';
import { threadsDir } from './thread-store.js';

const platform = toPlatform(process.platform);
const FAKE = 'fake';

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
    rmSync(root, { recursive: true, force: true });
  });

  function setup(options: { env?: Record<string, string>; permissions?: RememberedPermissions } = {}): Harness {
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
      permissions: {
        get: () => h.permissions,
        remember: (key, decision) => {
          h.permissions = { ...h.permissions, [key]: decision };
        },
      },
      events: {
        threadsChanged: (threads) => (h.threads = threads),
        threadEvents: (threadId, changes) => h.changes.set(threadId, [...(h.changes.get(threadId) ?? []), ...changes]),
        threadState: (threadId, state) => h.states.set(threadId, [...(h.states.get(threadId) ?? []), state]),
        log: (_threadId, entry) => h.logs.push(entry),
        fileChanged: (_threadId, path) => h.fileChanges.push(path),
      },
    });
    harnesses.push(h);
    return h;
  }

  function latestState(h: Harness, threadId: string): ThreadState | undefined {
    const states = h.states.get(threadId);
    return states?.[states.length - 1];
  }

  it('creates a thread, edits a file after a permission card is answered, and persists the transcript', async () => {
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
    const h = setup();
    const thread = h.service.createThread(FAKE);
    const turn = h.service.prompt(thread.id, [{ type: 'text', text: 'slow' }]);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('prompting');
    await h.service.cancel(thread.id);
    expect((await turn).stopReason).toBe('cancelled');
    expect(h.service.getThread(thread.id)?.events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'cancelled' });
  });

  it('restores persisted threads on construction and loads the session where advertised', async () => {
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
    const h = setup({ env: { FAKE_AGENT_AUTH: '1' } });
    const thread = h.service.createThread(FAKE);
    await expect.poll(() => latestState(h, thread.id)?.status, { timeout: 15_000 }).toBe('auth_required');
    expect(latestState(h, thread.id)?.authMethods).toEqual([
      { id: 'fake-login', name: 'Fake login', description: 'Pretend to log in' },
    ]);
    const result = await h.service.prompt(thread.id, [{ type: 'text', text: 'hello' }]);
    expect(result).toEqual({ stopReason: null, error: 'auth_required' });
    await h.service.authenticate(thread.id, 'fake-login');
    // The pending prompt is sent once the session exists.
    await expect
      .poll(() => h.service.getThread(thread.id)?.events.some((e) => e.kind === 'turn_end'), { timeout: 10_000 })
      .toBe(true);
    expect(latestState(h, thread.id)?.status).toBe('ready');
  });

  it('redacts secrets in the log and exports it', async () => {
    root = mkdtempSync(join(tmpdir(), 'arbora-agent-'));
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
});
