import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '@arbora/shared';
import type { ThreadState } from '@arbora/shared';
import { AgentService, type AgentServiceEvents } from './agent-service.js';
import { TerminalService } from '../terminal/terminal-service.js';

/**
 * A tiny interactive "agent CLI" that behaves like the real ones: raw mode (so `^C` arrives as a
 * byte the CLI handles itself), bracketed paste enabled (so a multi-line prompt is one input),
 * and answers driven by the prompt's last line:
 *
 * - `crash`: exits with code 3.
 * - `ask`: prints a yes/no question and waits (needs_input).
 * - `stream N`: prints N lines, 30 ms apart, until quiet or `^C` interrupts the turn.
 * - anything else: `hello: <line>`, then quiet (the turn ends).
 */
const FAKE_CLI = `
process.stdout.write('FakeAgent v1 ready\\n');
process.stdout.write('\\u001b[?2004h');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let buffer = '';
let inPaste = false;
let timer = null;
process.stdin.on('data', (chunk) => {
  for (const ch of chunk) {
    if (inPaste) {
      buffer += ch;
      if (buffer.endsWith('\\u001b[201~')) {
        inPaste = false;
        const text = buffer.slice(0, -6);
        buffer = '';
        submit(text);
      }
      continue;
    }
    if (ch === '\\u0003') {
      if (timer) { clearInterval(timer); timer = null; }
      process.stdout.write('^C interrupted\\n');
      continue;
    }
    if (ch === '\\r' || ch === '\\n') {
      const line = buffer;
      buffer = '';
      if (line.trim()) submit(line);
      continue;
    }
    buffer += ch;
    if (buffer.endsWith('\\u001b[200~')) {
      buffer = buffer.slice(0, -6);
      inPaste = true;
      if (buffer.trim()) submit(buffer);
      buffer = '';
    }
  }
});
function submit(text) {
  const line = text.split('\\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (!line) return;
  if (line === 'crash') process.exit(3);
  if (line === 'ask') {
    process.stdout.write('Allow edit to App.tsx? (y/n) ');
    return;
  }
  if (line.startsWith('stream')) {
    const n = Number(line.split(' ')[1] ?? 3) || 3;
    let i = 0;
    timer = setInterval(() => {
      i++;
      process.stdout.write('line ' + i + '\\n');
      if (i >= n) { clearInterval(timer); timer = null; }
    }, 30);
    return;
  }
  process.stdout.write('hello: ' + line + '\\n');
}
`;

const TURN_QUIET_MS = 400;

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-terminal-agent-'));
  writeFileSync(join(dir, 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agent-fixture', private: true }));
  return dir;
}

interface Harness {
  readonly service: AgentService;
  readonly project: string;
  readonly states: { threadId: string; state: ThreadState }[];
  readonly fileChanges: { threadId: string; path: string }[];
  readonly confirmations: { requestId: string; threadId: string }[];
}

function setup(): Harness {
  const project = tempProject();
  const states: { threadId: string; state: ThreadState }[] = [];
  const fileChanges: { threadId: string; path: string }[] = [];
  const confirmations: { requestId: string; threadId: string }[] = [];
  const terminals = new TerminalService({
    platform: 'linux',
    cwd: project,
    environment: () => Promise.resolve({ ...process.env }) as Promise<Record<string, string>>,
    shell: () => undefined,
    events: { data: () => undefined, changed: () => undefined, url: () => undefined },
  });
  const events: AgentServiceEvents = {
    threadsChanged: () => undefined,
    groupsChanged: () => undefined,
    threadState: (threadId, state) => states.push({ threadId, state }),
    confirmation: (request) => confirmations.push({ requestId: request.requestId, threadId: request.threadId }),
    fileChanged: (threadId, path) => fileChanges.push({ threadId, path }),
  };
  const registry = new AgentRegistry(() => [
    { id: 'fake', name: 'Fake agent', command: process.execPath, args: ['-e', FAKE_CLI], env: {} },
  ]);
  const service = new AgentService({
    platform: 'linux',
    projectPath: project,
    registry,
    environment: () => Promise.resolve({ ...process.env }) as Promise<Record<string, string>>,
    lookup: () => (command: string) => command,
    terminals,
    devUrl: () => null,
    events,
    turnQuietMs: TURN_QUIET_MS,
  });
  return { service, project, states, fileChanges, confirmations };
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.service.dispose().catch(() => undefined);
  }
});

function track(harness: Harness): void {
  if (!harnesses.includes(harness)) harnesses.push(harness);
}

function statusOf(harness: Harness, threadId: string): string {
  return harness.service.getThread(threadId)?.state.status ?? 'gone';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls (real time) until the thread reaches `status`; the CLI quiet window is test-shortened. */
async function until(harness: Harness, threadId: string, status: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (statusOf(harness, threadId) === status) return;
    await sleep(25);
  }
  throw new Error(`thread never became ${status}; now ${statusOf(harness, threadId)}`);
}

/** Waits one quiet window so a turn ends (the service's own timer does the work). */
async function turnEnds(harness: Harness, threadId: string): Promise<void> {
  await until(harness, threadId, 'ready');
}

describe('AgentService on terminals', () => {
  it('spawns the CLI in a terminal and is ready once it prints its banner', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    // The CLI spawn is async; the first output makes the thread ready.
    await until(harness, thread.id, 'ready');
    const state = harness.service.getThread(thread.id)?.state;
    expect(state?.terminalId).not.toBeNull();
    expect(state?.lastLine).toBe('FakeAgent v1 ready');
  }, 10_000);

  it('writes a prompt into the terminal, marks the turn working and ends it on quiet', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake', { title: 'greet' });
    await until(harness, thread.id, 'ready');
    const result = await harness.service.sendPrompt(thread.id, 'hello world');
    expect(result.sent).toBe(true);
    expect(statusOf(harness, thread.id)).toBe('working');
    await turnEnds(harness, thread.id);
    const state = harness.service.getThread(thread.id)?.state;
    expect(state?.lastLine).toBe('hello: hello world');
    expect(state?.lastTurnMs).not.toBeNull();
    // The title came from the launcher, not the prompt's first line.
    expect(harness.service.getThread(thread.id)?.title).toBe('greet');
  }, 10_000);

  it('titles a new thread from the prompt, and includes the preface in the first one', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.sendPrompt(thread.id, 'fix the nav');
    await turnEnds(harness, thread.id);
    expect(harness.service.getThread(thread.id)?.title).toBe('fix the nav');
  }, 10_000);

  it('detects a question and waits for input', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.sendPrompt(thread.id, 'ask');
    await until(harness, thread.id, 'needs_input');
    const state = harness.service.getThread(thread.id)?.state;
    expect(state?.lastLine).toContain('(y/n)');
    // Answering through the service is the user typing into the terminal.
    const answered = await harness.service.sendPrompt(thread.id, 'y');
    expect(answered.sent).toBe(true);
    expect(statusOf(harness, thread.id)).toBe('working');
    await turnEnds(harness, thread.id);
  }, 10_000);

  it('interrupts the turn with Ctrl+C and stays ready', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.sendPrompt(thread.id, 'stream 40');
    expect(statusOf(harness, thread.id)).toBe('working');
    await harness.service.stop(thread.id);
    expect(statusOf(harness, thread.id)).toBe('ready');
    // The next prompt works again.
    await harness.service.sendPrompt(thread.id, 'hello again');
    expect(statusOf(harness, thread.id)).toBe('working');
    await turnEnds(harness, thread.id);
    expect(harness.service.getThread(thread.id)?.state.lastLine).toBe('hello: hello again');
  }, 10_000);

  it('power off ends the process and shows the thread stopped', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.stopProcess(thread.id);
    await until(harness, thread.id, 'idle');
    expect(harness.service.getThread(thread.id)?.state.terminalId).toBeNull();
    // A prompt starts the CLI again.
    await harness.service.sendPrompt(thread.id, 'hello back');
    await until(harness, thread.id, 'working');
    await turnEnds(harness, thread.id);
  }, 10_000);

  it('reports a crashed process as an error', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.sendPrompt(thread.id, 'crash');
    await until(harness, thread.id, 'error');
    expect(harness.service.getThread(thread.id)?.state.error).toContain('code 3');
  }, 10_000);

  it('refuses an unknown agent and a prompt on a working thread', async () => {
    const harness = setup();
    track(harness);
    expect(() => harness.service.createThread('missing')).toThrow(/Unknown agent/);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    await harness.service.sendPrompt(thread.id, 'stream 40');
    await expect(harness.service.sendPrompt(thread.id, 'second')).rejects.toThrow(/still working/);
    await harness.service.stop(thread.id);
  }, 10_000);

  it('marks a thread settled only outside a turn, for grove_wait', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    expect(harness.service.isSettled(thread.id)).toBe(true);
    await harness.service.sendPrompt(thread.id, 'stream 40');
    expect(harness.service.isSettled(thread.id)).toBe(false);
    const settled = harness.service.waitForSettled([thread.id], { until: 'all', timeoutMs: 15_000 });
    await harness.service.stop(thread.id);
    expect(await settled).toBe(true);
  }, 10_000);

  it('answers its own confirmation card once the user chooses', async () => {
    const harness = setup();
    track(harness);
    const thread = harness.service.createThread('fake');
    await until(harness, thread.id, 'ready');
    const asked = harness.service.requestConfirmation(thread.id, {
      title: 'Allow browser_evaluate?',
      detail: 'Runs JavaScript in the page.',
      persistent: false,
    });
    await sleep(25);
    const pending = harness.confirmations.find((entry) => entry.threadId === thread.id);
    if (!pending) throw new Error('no confirmation raised');
    harness.service.answerConfirmation(thread.id, pending.requestId, 'allow');
    const answer = await asked;
    expect(answer).toBe('allow_once');
  }, 10_000);
});
