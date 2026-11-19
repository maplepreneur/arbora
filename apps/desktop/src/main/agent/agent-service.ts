import { randomUUID } from 'node:crypto';
import {
  confirmationOptions,
  DEFAULT_THREAD_TITLE,
  firstPromptPreface,
  idleThreadState,
  type AgentAvailability,
  type AgentDefinition,
  type AgentGroup,
  type Attachment,
  type ConfirmationOptionKind,
  type ConfirmationRequest,
  type Platform,
  type Thread,
  type ThreadState,
  type ThreadSummary,
  BracketedPasteTracker,
  encodeTerminalPrompt,
  looksLikeInputRequest,
  START_TIMEOUT_MS,
  stripAnsi,
  THREAD_TAIL_LINES,
  toPosixPath,
  TURN_QUIET_MS,
  type AgentRegistry,
  type CommandLookup,
} from '@arbora/shared';
import type { UsageTurnInput } from '../usage/UsageLedger.js';
import type { TerminalService } from '../terminal/terminal-service.js';
import { AgentGroupStore, ThreadStore } from './thread-store.js';
import { runAgentTask } from './agent-task.js';

export interface AgentServiceEvents {
  threadsChanged(threads: ThreadSummary[]): void;
  groupsChanged(groups: AgentGroup[]): void;
  threadState(threadId: string, state: ThreadState): void;
  /** Arbora raises one of its own confirmation cards (browser tools, Grove helper starts). */
  confirmation(request: ConfirmationRequest): void;
  /** A file changed on disk while this thread's turn was running. */
  fileChanged(threadId: string, path: string): void;
}

export interface AgentUsageRecorder {
  record(input: UsageTurnInput): unknown;
}

export interface AgentServiceOptions {
  readonly platform: Platform;
  readonly projectPath: string;
  readonly registry: AgentRegistry;
  /** Child-process environment with the login-shell PATH. */
  readonly environment: () => Promise<Record<string, string>>;
  readonly lookup: () => CommandLookup;
  readonly terminals: TerminalService;
  readonly devUrl: () => string | null;
  readonly events: AgentServiceEvents;
  readonly usage?: AgentUsageRecorder;
  readonly now?: () => number;
  /** Arbora's browser-tools MCP server for a new agent process of `threadId`, as env vars. */
  readonly mcp?: (threadId: string) => Promise<McpAttachment>;
  /** How long output must stay quiet before a turn counts as ended (tests shorten this). */
  readonly turnQuietMs?: number;
}

/**
 * The browser-tools MCP server for one agent process, handed to a terminal agent as environment
 * (`ARBORA_MCP_URL`, `ARBORA_MCP_TOKEN`); closed when the agent process stops.
 */
export interface McpAttachment {
  /** `http://127.0.0.1:<port>/mcp`; the agent connects with the bearer token. */
  readonly url: string;
  readonly token: string;
  /** The server also carries the Grove orchestration tools (a lead session). */
  readonly groveTools: boolean;
  close(): Promise<void>;
}

/** A question Arbora raises itself, answered through the renderer's confirmation card. */
export interface ToolConfirmationRequest {
  readonly title: string;
  readonly detail: string;
  /** Offer "always"/"never" answers, which the caller persists. */
  readonly persistent: boolean;
}

interface PendingConfirmation {
  resolve(optionId: string | null): void;
}

interface Runtime {
  readonly terminalId: string;
  unsubscribe: () => void;
  readonly paste: BracketedPasteTracker;
  /** The process ended or the user asked for it to end; its exit is not an error. */
  stopping: boolean;
  generation: number;
}

interface ThreadRecord {
  thread: Thread;
  runtime: Runtime | null;
  starting: Promise<Runtime> | null;
  quietTimer: NodeJS.Timeout | undefined;
  startTimer: NodeJS.Timeout | undefined;
  pendingConfirmations: Map<string, PendingConfirmation>;
  saveTimer: NodeJS.Timeout | undefined;
  /** Prompts accepted but not written yet, including ones waiting for the terminal to spawn. */
  promptsInFlight: number;
  /** Prompts written this session; the first carries the Arbora preface. */
  promptsSent: number;
  /** The running turn, from its prompt to the first quiet period. */
  turn: { startedAt: number } | null;
  /** The last stripped output lines, mirrored into `thread.lastLines`. */
  tail: string[];
}

export interface CreateThreadOptions {
  /** Agent group; an unknown id files the thread as ungrouped. */
  readonly groupId?: string | null | undefined;
  /** The lead session that starts this one as a helper (Grove orchestration). */
  readonly parentThreadId?: string | null | undefined;
  /** Names the thread before its first prompt (Grove's launcher, `grove_start_agent`). */
  readonly title?: string | undefined;
}

export interface WaitOptions {
  /** `all`: every thread settled; `any`: at least one. */
  readonly until: 'all' | 'any';
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /**
   * The thread whose turn is waiting (a lead in `grove_wait`). The wait ends with `false` once that
   * turn is over: not every agent drops its MCP request when its turn is interrupted.
   */
  readonly turnOf?: string;
}

const SAVE_DELAY_MS = 300;
const TITLE_LENGTH = 60;

export class AgentServiceError extends Error {}

/**
 * Agent threads for one project: the agent CLI runs interactively in its own terminal (node-pty),
 * prompts are typed into that terminal, and status, attention and notifications are derived from
 * its output. Threads persist to `.arbora/threads/<id>.json`.
 */
export class AgentService {
  private readonly records = new Map<string, ThreadRecord>();
  private readonly store: ThreadStore;
  private readonly groups: AgentGroupStore;
  private readonly now: () => number;
  /** `waitForSettled` checks, run after anything that can settle a thread. */
  private readonly settleWaiters = new Set<() => void>();
  private disposed = false;

  constructor(private readonly options: AgentServiceOptions) {
    this.store = new ThreadStore(options.projectPath);
    this.groups = new AgentGroupStore(options.projectPath);
    this.now = options.now ?? (() => Date.now());
    for (const summary of this.store.list()) {
      const thread = this.store.load(summary.id);
      if (thread) this.records.set(thread.id, this.record(thread));
    }
  }

  // --- Agents and threads -------------------------------------------------------------------

  listAgents(): { agents: AgentDefinition[]; availability: AgentAvailability[] } {
    return { agents: this.options.registry.list(), availability: this.options.registry.detect(this.options.lookup()) };
  }

  agentName(agentId: string): string {
    return this.options.registry.get(agentId)?.name ?? agentId;
  }

  listThreads(): ThreadSummary[] {
    return [...this.records.values()].map((r) => this.summary(r)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The OS pid of the agent process for this thread, when one is running. */
  processPid(threadId: string): number | null {
    const record = this.records.get(threadId);
    const terminalId = record?.runtime?.terminalId;
    if (terminalId === undefined) return null;
    return this.options.terminals.get(terminalId)?.pid ?? null;
  }

  getThread(threadId: string): Thread | null {
    const record = this.records.get(threadId);
    return record ? { ...record.thread, lastLines: [...record.tail] } : null;
  }

  createThread(agentId: string, options: CreateThreadOptions = {}): ThreadSummary {
    const agent = this.options.registry.get(agentId);
    if (!agent) throw new AgentServiceError(`Unknown agent ${agentId}`);
    const now = this.now();
    const { groupId, parentThreadId } = options;
    const known = groupId != null && this.groups.list().some((g) => g.id === groupId);
    const title = options.title?.trim().slice(0, 200);
    const thread: Thread = {
      id: randomUUID(),
      agentId,
      title: title || DEFAULT_THREAD_TITLE,
      createdAt: now,
      updatedAt: now,
      groupId: known ? groupId : null,
      pinned: false,
      archivedAt: null,
      parentThreadId: parentThreadId != null && this.records.has(parentThreadId) ? parentThreadId : null,
      state: idleThreadState(),
      lastLines: [],
    };
    const record = this.record(thread);
    this.records.set(thread.id, record);
    this.saveNow(record);
    this.emitThreads();
    // The CLI starts right away so its login, models and slash commands are there before use.
    void this.ensureRuntime(record).catch(() => undefined);
    return this.summary(record);
  }

  async deleteThread(threadId: string): Promise<void> {
    const record = this.records.get(threadId);
    if (!record) return;
    this.records.delete(threadId);
    this.wakeWaiters();
    clearTimeout(record.saveTimer);
    await this.stopRuntime(record);
    this.store.delete(threadId);
    this.emitThreads();
  }

  /**
   * Moves a thread to Grove's Recent, stopping its process first, or brings it back. The terminal
   * tail stays; the next prompt after a restore starts the agent again.
   */
  async setArchived(threadId: string, archived: boolean): Promise<void> {
    const record = this.require(threadId);
    if (archived) await this.stopProcess(threadId);
    record.thread = { ...record.thread, archivedAt: archived ? (record.thread.archivedAt ?? this.now()) : null };
    this.scheduleSave(record);
    this.emitThreads();
    this.wakeWaiters();
  }

  renameThread(threadId: string, title: string): void {
    const record = this.require(threadId);
    record.thread = { ...record.thread, title, updatedAt: this.now() };
    this.scheduleSave(record);
    this.emitThreads();
  }

  // --- Agent groups --------------------------------------------------------------------------

  listGroups(): AgentGroup[] {
    return this.groups.list();
  }

  /** Replaces the groups; threads whose group was removed become ungrouped. */
  saveGroups(groups: AgentGroup[]): AgentGroup[] {
    const ids = new Set(groups.map((g) => g.id));
    if (ids.size !== groups.length) throw new AgentServiceError('Agent group ids must be unique');
    const saved = this.groups.save(groups);
    let orphaned = false;
    for (const record of this.records.values()) {
      if (record.thread.groupId !== null && !ids.has(record.thread.groupId)) {
        record.thread = { ...record.thread, groupId: null };
        this.scheduleSave(record);
        orphaned = true;
      }
    }
    if (!this.disposed) this.options.events.groupsChanged(saved);
    if (orphaned) this.emitThreads();
    return saved;
  }

  setThreadGroup(threadId: string, groupId: string | null): void {
    const record = this.require(threadId);
    if (groupId !== null && !this.groups.list().some((g) => g.id === groupId)) {
      throw new AgentServiceError(`Unknown agent group ${groupId}`);
    }
    record.thread = { ...record.thread, groupId };
    this.scheduleSave(record);
    this.emitThreads();
  }

  setThreadPinned(threadId: string, pinned: boolean): void {
    const record = this.require(threadId);
    record.thread = { ...record.thread, pinned };
    this.scheduleSave(record);
    this.emitThreads();
  }

  // --- Turns ---------------------------------------------------------------------------------

  /**
   * Types a prompt into the agent's terminal (spawning the CLI first when the thread is stopped).
   * `title` names a new thread when the text's first line is not a good title.
   */
  async sendPrompt(
    threadId: string,
    text: string,
    options: { readonly title?: string; readonly attachments?: readonly Attachment[] } = {},
  ): Promise<{ sent: boolean; error?: string }> {
    const record = this.require(threadId);
    const prompt = text.trim();
    if (prompt.length === 0 && (options.attachments ?? []).length === 0) {
      throw new AgentServiceError('Nothing to send');
    }
    if (record.thread.archivedAt !== null) {
      throw new AgentServiceError('This session is archived. Restore it before sending it a message.');
    }
    if (record.thread.state.status === 'working') throw new AgentServiceError('The agent is still working');

    record.promptsInFlight++;
    try {
      let runtime: Runtime;
      try {
        runtime = await this.ensureRuntime(record);
      } catch (error) {
        return { sent: false, error: messageOf(error) };
      }
      this.titleFromPrompt(record, options.title, prompt);
      const composed = this.composePrompt(record, prompt, options.attachments ?? []);
      record.promptsSent++;
      const encoded = encodeTerminalPrompt(composed, runtime.paste.value);
      if (encoded.length === 0) return { sent: false };
      this.options.terminals.write(runtime.terminalId, encoded);
      record.turn = { startedAt: this.now() };
      this.setState(record, { status: 'working', error: null, turnStartedAt: record.turn.startedAt });
      this.scheduleQuiet(record);
      return { sent: true };
    } finally {
      record.promptsInFlight--;
      this.wakeWaiters();
    }
  }

  /** Interrupts the agent's current work: Ctrl+C in its terminal. */
  stop(threadId: string): Promise<void> {
    const record = this.require(threadId);
    if (record.thread.state.status !== 'working' && record.thread.state.status !== 'needs_input') {
      return Promise.resolve();
    }
    const runtime = record.runtime;
    if (!runtime) return Promise.resolve();
    this.clearQuiet(record);
    record.turn = null;
    this.options.terminals.write(runtime.terminalId, '\u0003');
    this.setState(record, { status: 'ready', error: null, turnStartedAt: null });
    return Promise.resolve();
  }

  /** Ends the agent process whatever it is doing (Grove's power toggle, archive, a lead's
   * `grove_stop`). The thread shows as Stopped until the next prompt starts the CLI again.
   */
  async stopProcess(threadId: string): Promise<void> {
    const record = this.require(threadId);
    if (!record.runtime && !record.starting && record.thread.state.status === 'idle') return;
    await this.stopRuntime(record);
    await this.closeLeftoverTerminal(record);
    this.setState(record, { status: 'idle', error: null, terminalId: null, turnStartedAt: null });
  }

  /** Stops the agent process and starts the CLI again in a fresh terminal. */
  async restart(threadId: string): Promise<void> {
    const record = this.require(threadId);
    await this.stopRuntime(record);
    await this.closeLeftoverTerminal(record);
    this.setState(record, { ...idleThreadState() });
    void this.ensureRuntime(record).catch(() => undefined);
  }

  /** A crashed or exited CLI leaves its terminal row behind; restarting or powering off clears it. */
  private async closeLeftoverTerminal(record: ThreadRecord): Promise<void> {
    const terminalId = record.thread.state.terminalId;
    if (terminalId === null || record.runtime?.terminalId === terminalId) return;
    try {
      await this.options.terminals.close(terminalId);
    } catch {
      // The terminal was already gone.
    }
  }

  /**
   * Resolves once the threads are settled (nothing more happens until someone acts: ready, idle,
   * waiting for the user, failed or stopped), or with `false` on the timeout or the abort signal.
   * A deleted or archived thread counts as settled, so this never waits on something that is gone.
   */
  waitForSettled(threadIds: readonly string[], options: WaitOptions): Promise<boolean> {
    if (options.signal?.aborted || this.disposed) return Promise.resolve(false);
    return new Promise<boolean>((resolveWait) => {
      const finish = (settled: boolean): void => {
        clearTimeout(timer);
        this.settleWaiters.delete(check);
        options.signal?.removeEventListener('abort', onAbort);
        resolveWait(settled);
      };
      const check = (): void => {
        if (this.disposed || (options.turnOf !== undefined && !this.isWorking(options.turnOf))) {
          finish(false);
          return;
        }
        const settled = threadIds.map((id) => this.isSettled(id));
        if (options.until === 'all' ? settled.every(Boolean) : settled.some(Boolean)) finish(true);
      };
      const onAbort = (): void => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(0, options.timeoutMs));
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.settleWaiters.add(check);
      check();
    });
  }

  /** Whether the thread is settled (see `waitForSettled`); unknown and archived threads are. */
  isSettled(threadId: string): boolean {
    const record = this.records.get(threadId);
    if (!record || record.thread.archivedAt !== null) return true;
    const status = record.thread.state.status;
    if (status === 'starting' || status === 'working') return false;
    return record.promptsInFlight === 0;
  }

  // --- Arbora's own confirmation cards ---------------------------------------------------------

  answerConfirmation(threadId: string, requestId: string, optionId: string): void {
    const record = this.require(threadId);
    const pending = record.pendingConfirmations.get(requestId);
    if (!pending) throw new AgentServiceError('That confirmation is no longer pending');
    pending.resolve(optionId);
  }

  /**
   * Shows a confirmation card in the thread's pane (a browser tool leaving the dev-server origin,
   * `browser_evaluate`, `terminal_run`, or a lead starting helper agents) and waits for the user.
   * Resolves with the kind of option chosen, or null when the thread, turn or agent went away.
   */
  async requestConfirmation(
    threadId: string,
    request: ToolConfirmationRequest,
  ): Promise<ConfirmationOptionKind | null> {
    const record = this.records.get(threadId);
    if (!record) return null;
    const options = confirmationOptions(request.persistent);
    const requestId = randomUUID();
    const full: ConfirmationRequest = {
      requestId,
      threadId,
      title: request.title,
      detail: request.detail,
      options,
    };
    if (!this.disposed) this.options.events.confirmation(full);
    const chosen = await this.waitForConfirmation(record, requestId);
    return options.find((o) => o.optionId === chosen)?.kind ?? null;
  }

  /** Files that changed on disk, attributed to the thread whose turn was running. */
  noteFileChanges(paths: readonly string[]): void {
    if (paths.length === 0) return;
    // `.arbora/` is the app's own bookkeeping (thread files, screenshots), not the agent's work.
    const agentPaths = paths.filter((path) => !path.split(/[\\/]/).includes('.arbora'));
    if (agentPaths.length === 0) return;
    for (const record of this.records.values()) {
      if (record.turn === null) continue;
      for (const path of agentPaths) {
        if (!this.disposed) this.options.events.fileChanged(record.thread.id, path);
      }
    }
  }

  /**
   * One prompt to `agentId` run non-interactively in a session of its own that is not a thread
   * (commit messages, pull request text).
   */
  async runTask(agentId: string, prompt: string): Promise<string> {
    const agent = this.options.registry.get(agentId);
    if (!agent) throw new AgentServiceError(`Unknown agent ${agentId}`);
    const env = await this.options.environment();
    Object.assign(env, agent.env);
    return runAgentTask({
      platform: this.options.platform,
      projectPath: this.options.projectPath,
      agent,
      env,
      lookup: this.options.lookup(),
      prompt,
    });
  }

  // --- Lifecycle -----------------------------------------------------------------------------

  async dispose(): Promise<void> {
    this.disposed = true;
    this.wakeWaiters();
    for (const record of this.records.values()) {
      clearTimeout(record.saveTimer);
      this.saveNow(record);
    }
    await Promise.all([...this.records.values()].map((record) => this.stopRuntime(record)));
  }

  // --- Internals -----------------------------------------------------------------------------

  private readonly mcpAttachments = new Map<string, McpAttachment>();

  private record(thread: Thread): ThreadRecord {
    return {
      thread: { ...thread, lastLines: [...thread.lastLines] },
      runtime: null,
      starting: null,
      quietTimer: undefined,
      startTimer: undefined,
      pendingConfirmations: new Map(),
      saveTimer: undefined,
      promptsInFlight: 0,
      /** Prompts written this session; the first carries the Arbora preface. */
      promptsSent: 0,
      turn: null,
      tail: [...thread.lastLines],
    };
  }

  private wakeWaiters(): void {
    for (const check of [...this.settleWaiters]) check();
  }

  private isWorking(threadId: string): boolean {
    return this.records.get(threadId)?.thread.state.status === 'working';
  }

  private require(threadId: string): ThreadRecord {
    const record = this.records.get(threadId);
    if (!record) throw new AgentServiceError(`Unknown thread ${threadId}`);
    return record;
  }

  private summary(record: ThreadRecord): ThreadSummary {
    const { lastLines: _lastLines, ...summary } = record.thread;
    return summary;
  }

  private emitThreads(): void {
    if (!this.disposed) this.options.events.threadsChanged(this.listThreads());
  }

  private setState(record: ThreadRecord, patch: Partial<ThreadState>): void {
    record.thread = { ...record.thread, state: { ...record.thread.state, ...patch }, updatedAt: this.now() };
    if (!this.disposed) {
      this.options.events.threadState(record.thread.id, record.thread.state);
      if (patch.status !== undefined) this.emitThreads();
    }
    this.scheduleSave(record);
    this.wakeWaiters();
  }

  private scheduleSave(record: ThreadRecord): void {
    clearTimeout(record.saveTimer);
    record.saveTimer = setTimeout(() => this.saveNow(record), SAVE_DELAY_MS);
  }

  private saveNow(record: ThreadRecord): void {
    record.saveTimer = undefined;
    if (!this.records.has(record.thread.id)) return;
    try {
      this.store.save({ ...record.thread, lastLines: [...record.tail] });
    } catch (error) {
      console.warn(`[agent] could not save thread ${record.thread.id}: ${messageOf(error)}`);
    }
  }

  private titleFromPrompt(record: ThreadRecord, title: string | undefined, prompt: string): void {
    if (record.thread.title !== DEFAULT_THREAD_TITLE) return;
    const text = title?.trim() || prompt.split('\n')[0]?.trim();
    if (!text) return;
    record.thread = { ...record.thread, title: text.slice(0, TITLE_LENGTH) };
    this.emitThreads();
  }

  /** The first prompt carries the Arbora preface; attachments become path mentions. */
  private composePrompt(record: ThreadRecord, prompt: string, attachments: readonly Attachment[]): string {
    const parts: string[] = [];
    if (record.promptsSent === 0) {
      const mcp = record.runtime ? this.mcpOf(record) : null;
      parts.push(
        firstPromptPreface({
          projectPath: this.options.projectPath,
          devUrl: this.options.devUrl(),
          browserTools: mcp !== null,
          groveTools: mcp?.groveTools === true,
        }),
      );
    }
    parts.push(prompt);
    for (const attachment of attachments) {
      parts.push(`Attached file: ${toPosixPath(attachment.path)}`);
    }
    return parts.join('\n\n');
  }

  private mcpOf(record: ThreadRecord): McpAttachment | null {
    return this.mcpAttachments.get(record.thread.id) ?? null;
  }

  private waitForConfirmation(record: ThreadRecord, requestId: string): Promise<string | null> {
    return new Promise<string | null>((resolveConfirmation) => {
      const pending: PendingConfirmation = {
        resolve: (optionId) => {
          record.pendingConfirmations.delete(requestId);
          resolveConfirmation(optionId);
        },
      };
      record.pendingConfirmations.set(requestId, pending);
      this.wakeWaiters();
    });
  }

  private cancelPendingConfirmations(record: ThreadRecord): void {
    for (const pending of record.pendingConfirmations.values()) pending.resolve(null);
    record.pendingConfirmations.clear();
  }

  /** Spawns the agent CLI in its own terminal; `prompting` output arrives through `onData`. */
  private ensureRuntime(record: ThreadRecord): Promise<Runtime> {
    if (record.runtime) return Promise.resolve(record.runtime);
    if (record.starting) return record.starting;
    const starting = this.start(record).finally(() => {
      record.starting = null;
    });
    record.starting = starting;
    return starting;
  }

  private async start(record: ThreadRecord): Promise<Runtime> {
    const agent = this.options.registry.get(record.thread.agentId);
    if (!agent) {
      const error = `Agent ${record.thread.agentId} is not configured`;
      this.setState(record, { status: 'error', error });
      throw new AgentServiceError(error);
    }
    // Never replace a live runtime without stopping it, or its process outlives the thread.
    if (record.runtime) await this.stopRuntime(record);
    await this.closeLeftoverTerminal(record);
    this.setState(record, { status: 'starting', error: null, terminalId: null });

    const lookup = this.options.lookup();
    if (!lookup(agent.command)) {
      const error = `${agent.command} was not found on PATH. ${agent.installHint ?? ''}`.trim();
      this.setState(record, { status: 'error', error });
      throw new AgentServiceError(error);
    }

    const env: Record<string, string> = { ...agent.env };
    const mcp = await this.attachMcp(record);
    if (mcp) {
      env['ARBORA_MCP_URL'] = mcp.url;
      env['ARBORA_MCP_TOKEN'] = mcp.token;
      if (mcp.groveTools) env['ARBORA_MCP_GROVE'] = '1';
    }

    const title = record.thread.title === DEFAULT_THREAD_TITLE ? agent.name : record.thread.title;
    const info = await this.options.terminals.create({
      kind: 'agent',
      title: `${agent.name} — ${title}`.slice(0, 200),
      thread: title,
      command: agent.command,
      args: agent.args,
      env,
      readOnly: false,
    });
    const runtime: Runtime = {
      terminalId: info.id,
      unsubscribe: () => undefined,
      paste: new BracketedPasteTracker(),
      stopping: false,
      generation: 0,
    };
    record.runtime = runtime;
    this.setState(record, { terminalId: info.id });

    runtime.unsubscribe = this.options.terminals.subscribe(info.id, (data) => this.onData(record, runtime, data));
    const generation = runtime.generation;
    void this.options.terminals.waitForExit(info.id).then((exit) => {
      if (record.runtime === runtime && generation === runtime.generation) this.onExit(record, runtime, exit);
    });
    this.armStartTimer(record);
    return runtime;
  }

  /** Starts the browser-tools MCP server for this process; the session works without it. */
  private async attachMcp(record: ThreadRecord): Promise<McpAttachment | null> {
    if (!this.options.mcp) return null;
    try {
      const attachment = await this.options.mcp(record.thread.id);
      this.mcpAttachments.set(record.thread.id, attachment);
      return attachment;
    } catch {
      return null;
    }
  }

  private armStartTimer(record: ThreadRecord): void {
    clearTimeout(record.startTimer);
    record.startTimer = setTimeout(() => {
      if (record.thread.state.status !== 'starting') return;
      const agent = this.options.registry.get(record.thread.agentId);
      const name = agent?.name ?? record.thread.agentId;
      this.setState(record, { status: 'error', error: `${name} printed nothing within 30 s` });
    }, START_TIMEOUT_MS);
  }

  private onData(record: ThreadRecord, runtime: Runtime, data: string): void {
    if (record.runtime !== runtime) return;
    runtime.paste.push(data);
    clearTimeout(record.startTimer);
    for (const line of data.split('\n')) {
      const stripped = stripAnsi(line).trimEnd();
      if (stripped.trim().length === 0) continue;
      record.tail.push(stripped);
      if (record.tail.length > THREAD_TAIL_LINES) record.tail.splice(0, record.tail.length - THREAD_TAIL_LINES);
    }
    const lastLine = record.tail.at(-1) ?? null;
    const status = record.thread.state.status;
    if (status === 'starting') {
      this.setState(record, { status: 'ready', lastLine, lastOutputAt: this.now() });
    } else if (status === 'needs_input') {
      // The user answered in the terminal; the agent is back at work.
      this.setState(record, { status: 'working', error: null, lastLine, lastOutputAt: this.now() });
      this.scheduleQuiet(record);
    } else {
      this.setState(record, { lastLine, lastOutputAt: this.now() });
      if (status === 'working') this.scheduleQuiet(record);
    }
  }

  /**
   * No output for a moment after a prompt: the turn ended (a quiet agent finished), or it is
   * waiting for the user (its last lines look like a question).
   */
  private scheduleQuiet(record: ThreadRecord): void {
    clearTimeout(record.quietTimer);
    record.quietTimer = setTimeout(() => this.onQuiet(record), this.options.turnQuietMs ?? TURN_QUIET_MS);
  }

  private onQuiet(record: ThreadRecord): void {
    const status = record.thread.state.status;
    if (status !== 'working') return;
    const turn = record.turn;
    record.turn = null;
    const now = this.now();
    const lastTurnMs = turn ? Math.max(0, now - turn.startedAt) : null;
    this.setState(record, {
      status: looksLikeInputRequest(record.tail) ? 'needs_input' : 'ready',
      turnStartedAt: null,
      lastTurnMs,
    });
    if (lastTurnMs !== null) {
      this.options.usage?.record({
        id: randomUUID(),
        threadId: record.thread.id,
        agentId: record.thread.agentId,
        // Terminal agents do not report tokens through a protocol; the row keeps the working time.
        modelId: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokensReported: false,
        durationMs: lastTurnMs,
        reportedCost: null,
        parentThreadId: record.thread.parentThreadId,
      });
    }
  }

  private onExit(
    record: ThreadRecord,
    runtime: Runtime,
    exit: { exitCode: number | null; signal: number | null },
  ): void {
    if (record.runtime !== runtime) return;
    record.runtime = null;
    runtime.unsubscribe();
    this.clearQuiet(record);
    this.cancelPendingConfirmations(record);
    void this.mcpAttachments
      .get(record.thread.id)
      ?.close()
      .catch(() => undefined);
    this.mcpAttachments.delete(record.thread.id);
    if (this.disposed || !this.records.has(record.thread.id)) return;
    const detail = exit.signal ? `signal ${exit.signal}` : `code ${exit.exitCode ?? 'unknown'}`;
    if (runtime.stopping) {
      // A user action ended it (power off, restart); the status change says which.
      if (record.thread.state.status !== 'idle') {
        this.setState(record, { status: 'idle', error: null, terminalId: null, turnStartedAt: null });
      }
      return;
    }
    const wasWorking = record.thread.state.status === 'working' || record.thread.state.status === 'starting';
    record.turn = null;
    if (wasWorking || (exit.exitCode !== null && exit.exitCode !== 0)) {
      const message = `The agent exited with ${detail}`;
      // The dead terminal stays visible (its output explains the crash) until restart or power off.
      this.setState(record, { status: 'error', error: message, turnStartedAt: null });
      return;
    }
    // The user typed an exit inside the CLI (or it finished on its own): stopped, not failed.
    this.setState(record, { status: 'idle', error: null, turnStartedAt: null });
  }

  private clearQuiet(record: ThreadRecord): void {
    clearTimeout(record.quietTimer);
    record.quietTimer = undefined;
    clearTimeout(record.startTimer);
    record.startTimer = undefined;
  }

  private async stopRuntime(record: ThreadRecord): Promise<void> {
    const runtime = record.runtime;
    record.starting = null;
    if (!runtime) return;
    record.runtime = null;
    runtime.stopping = true;
    runtime.generation++;
    runtime.unsubscribe();
    this.clearQuiet(record);
    this.cancelPendingConfirmations(record);
    void this.mcpAttachments
      .get(record.thread.id)
      ?.close()
      .catch(() => undefined);
    this.mcpAttachments.delete(record.thread.id);
    try {
      await this.options.terminals.close(runtime.terminalId);
    } catch {
      // The terminal was already gone.
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
