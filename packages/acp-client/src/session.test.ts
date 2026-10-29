import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateTerminalRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { AgentProcess } from './process.js';
import { AcpSession, type AcpSessionHandlers } from './session.js';
import { FAKE_AGENT_PATH } from './testing/fake-agent-path.js';
import { TerminalOutputBuffer } from './terminal-output.js';
import { UpdateNormalizer } from './normalizer.js';
import { resolveInsideRoot } from './path-scope.js';
import { readFile, writeFile } from 'node:fs/promises';

interface Harness {
  readonly process: AgentProcess;
  readonly session: AcpSession;
  readonly updates: SessionNotification[];
  readonly permissions: RequestPermissionRequest[];
  readonly stderr: string[];
  readonly log: { direction: 'in' | 'out'; message: unknown }[];
  readonly normalizer: UpdateNormalizer;
  readonly writes: string[];
  answer: (request: RequestPermissionRequest) => RequestPermissionResponse;
}

const TEST_TIMEOUT = 30_000;

describe('AcpSession against the fake agent', () => {
  let root: string;
  let harness: Harness;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'arbora-acp-')));
    writeFileSync(join(root, 'App.tsx'), 'export const App = () => null;\n');
  });

  afterEach(async () => {
    await harness.session.close();
    harness.process.kill();
    await harness.process.exited;
    rmSync(root, { recursive: true, force: true });
  });

  function start(env: Record<string, string> = {}): Harness {
    const stderr: string[] = [];
    const updates: SessionNotification[] = [];
    const permissions: RequestPermissionRequest[] = [];
    const log: Harness['log'] = [];
    const writes: string[] = [];
    let id = 0;
    const normalizer = new UpdateNormalizer({ nextId: () => `e${++id}`, now: () => Date.now() });
    const terminals = new Map<string, { buffer: TerminalOutputBuffer; exit: Promise<number | null> }>();
    const agentProcess = new AgentProcess({
      platform: 'linux',
      command: process.execPath,
      args: [FAKE_AGENT_PATH],
      env: { ...processEnv(), ...env },
      cwd: root,
      lookup: (command) => command,
      onStderr: (line) => stderr.push(line),
    });
    const handlers: AcpSessionHandlers = {
      requestPermission: (request) => {
        permissions.push(request);
        return Promise.resolve(h.answer(request));
      },
      readTextFile: async ({ path }) => ({ content: await readFile(resolveInsideRoot(root, path), 'utf8') }),
      writeTextFile: async ({ path, content }) => {
        const target = resolveInsideRoot(root, path);
        await writeFile(target, content, 'utf8');
        writes.push(target);
      },
      terminal: {
        create: (request: CreateTerminalRequest) => {
          const terminalId = `term-${terminals.size + 1}`;
          const buffer = new TerminalOutputBuffer(request.outputByteLimit ?? null);
          const child = spawn(request.command, request.args ?? [], { cwd: request.cwd ?? root, shell: false });
          child.stdout.on('data', (chunk: Buffer) => buffer.push(chunk.toString('utf8')));
          const exit = new Promise<number | null>((resolveExit) => child.on('close', (code) => resolveExit(code)));
          terminals.set(terminalId, { buffer, exit });
          return Promise.resolve({ terminalId });
        },
        output: ({ terminalId }) =>
          Promise.resolve({ ...terminals.get(terminalId)!.buffer.snapshot(), exitStatus: null }),
        waitForExit: async ({ terminalId }) => ({ exitCode: await terminals.get(terminalId)!.exit, signal: null }),
        kill: () => Promise.resolve(),
        release: ({ terminalId }) => {
          terminals.delete(terminalId);
          return Promise.resolve();
        },
      },
      onUpdate: (notification) => {
        updates.push(notification);
        normalizer.apply(notification.update);
      },
      onLog: (entry) => log.push(entry),
      onClosed: () => undefined,
    };
    const session = new AcpSession(agentProcess.stream, handlers);
    const h: Harness = {
      process: agentProcess,
      session,
      updates,
      permissions,
      stderr,
      log,
      normalizer,
      writes,
      answer: (request) => ({ outcome: { outcome: 'selected', optionId: request.options[0]!.optionId } }),
    };
    harness = h;
    return h;
  }

  it(
    'initialises, creates a session and streams a prompt turn with a permissioned file edit',
    async () => {
      const h = start();
      const init = await h.session.initialize();
      expect(init.agentCapabilities?.promptCapabilities?.image).toBe(true);
      expect(h.session.capabilities).toEqual({ loadSession: true, resume: false, image: true, embeddedContext: true });

      const created = await h.session.newSession(root, []);
      expect(created.sessionId).toMatch(/^fake-/);
      expect(created.modes?.currentModeId).toBe('ask');

      const response = await h.session.prompt(created.sessionId, [
        { type: 'text', text: 'add a comment to `App.tsx`' },
      ]);
      expect(response.stopReason).toBe('end_turn');

      const kinds = h.normalizer.events.map((e) => e.kind);
      expect(kinds).toEqual(['agent_thought', 'agent_message', 'tool_call', 'agent_message']);
      const tool = h.normalizer.events[2];
      expect(tool).toMatchObject({ kind: 'tool_call', toolKind: 'edit', status: 'completed' });
      expect(tool?.kind === 'tool_call' && tool.content[0]).toMatchObject({
        type: 'diff',
        path: join(root, 'App.tsx'),
      });

      expect(h.permissions).toHaveLength(1);
      expect(h.permissions[0]?.options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
      expect(h.writes).toEqual([join(root, 'App.tsx')]);
      expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toBe(
        '// Arbora fake agent was here\nexport const App = () => null;\n',
      );

      // Raw traffic was logged both ways and stderr was captured.
      expect(
        h.log.some((e) => e.direction === 'out' && (e.message as { method?: string }).method === 'initialize'),
      ).toBe(true);
      expect(
        h.log.some((e) => e.direction === 'in' && (e.message as { method?: string }).method === 'session/update'),
      ).toBe(true);
      await expect.poll(() => h.stderr.join('\n')).toContain('fake agent ready');
    },
    TEST_TIMEOUT,
  );

  it(
    'honours a rejected permission',
    async () => {
      const h = start();
      h.answer = (request) => ({
        outcome: { outcome: 'selected', optionId: request.options.find((o) => o.kind === 'reject_once')!.optionId },
      });
      await h.session.initialize();
      const { sessionId } = await h.session.newSession(root, []);
      await h.session.prompt(sessionId, [{ type: 'text', text: 'add a comment to `App.tsx`' }]);
      expect(h.writes).toEqual([]);
      expect(h.normalizer.events.find((e) => e.kind === 'tool_call')).toMatchObject({ status: 'failed' });
    },
    TEST_TIMEOUT,
  );

  it(
    'runs a client terminal and reads its output back',
    async () => {
      const h = start();
      await h.session.initialize();
      const { sessionId } = await h.session.newSession(root, []);
      await h.session.prompt(sessionId, [{ type: 'text', text: 'run echo' }]);
      const message = h.normalizer.events.filter((e) => e.kind === 'agent_message').pop();
      expect(
        message?.kind === 'agent_message' && message.blocks[0]?.type === 'text' && message.blocks[0].text,
      ).toContain('hello from fake agent');
      const tool = h.normalizer.events.find((e) => e.kind === 'tool_call');
      expect(tool).toMatchObject({ toolKind: 'execute', status: 'completed' });
    },
    TEST_TIMEOUT,
  );

  it(
    'cancels a running turn and resolves the prompt with stopReason cancelled',
    async () => {
      const h = start();
      await h.session.initialize();
      const { sessionId } = await h.session.newSession(root, []);
      const turn = h.session.prompt(sessionId, [{ type: 'text', text: 'work slowly' }]);
      await expect.poll(() => h.normalizer.events.length).toBeGreaterThan(0);
      await h.session.cancel(sessionId);
      const response = await turn;
      expect(response.stopReason).toBe('cancelled');
    },
    TEST_TIMEOUT,
  );

  it(
    'requires authenticate when the agent advertises auth methods and rejects session/new',
    async () => {
      const h = start({ FAKE_AGENT_AUTH: '1' });
      const init = await h.session.initialize();
      expect(init.authMethods?.map((m) => m.id)).toEqual(['fake-login']);
      await expect(h.session.newSession(root, [])).rejects.toMatchObject({ code: -32000 });
      expect(AcpSession.isAuthRequired(await h.session.newSession(root, []).catch((e: unknown) => e))).toBe(true);
      await h.session.authenticate('fake-login');
      const created = await h.session.newSession(root, []);
      expect(created.sessionId).toMatch(/^fake-/);
    },
    TEST_TIMEOUT,
  );

  it(
    'loads a previous session, replaying its history, and switches modes and config options',
    async () => {
      const h = start();
      await h.session.initialize();
      const { sessionId } = await h.session.newSession(root, []);
      await h.session.prompt(sessionId, [{ type: 'text', text: 'say hi' }]);
      const before = h.updates.length;

      await h.session.loadSession(sessionId, root, []);
      const replayed = h.updates.slice(before).map((u) => u.update.sessionUpdate);
      expect(replayed).toContain('user_message_chunk');
      expect(replayed).toContain('agent_message_chunk');

      await h.session.setMode(sessionId, 'code');
      await expect
        .poll(() => h.updates.filter((u) => u.update.sessionUpdate === 'current_mode_update').length)
        .toBeGreaterThan(0);
      await h.session.setConfigOption(sessionId, 'model', 'smart');
      await expect
        .poll(() => h.updates.filter((u) => u.update.sessionUpdate === 'config_option_update').length)
        .toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'reports the exit code when the agent crashes',
    async () => {
      const h = start();
      await h.session.initialize();
      const { sessionId } = await h.session.newSession(root, []);
      await h.session.prompt(sessionId, [{ type: 'text', text: 'please crash' }]).catch(() => undefined);
      const exit = await h.process.exited;
      expect(exit.code).toBe(3);
    },
    TEST_TIMEOUT,
  );
});

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return env;
}
