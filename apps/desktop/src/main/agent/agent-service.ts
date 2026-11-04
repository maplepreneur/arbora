import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  McpServer,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
} from '@agentclientprotocol/sdk';
import {
  AcpSession,
  AgentProcess,
  firstPromptPreface,
  isPrefaceTitle,
  LEGACY_MODEL_OPTION_ID,
  PathScopeError,
  redact,
  resolveInsideRoot,
  restartDelay,
  sessionConfigOptions,
  UpdateNormalizer,
  withLegacyModel,
  type AcpLogMessage,
  type AgentRegistry,
  type CommandLookup,
  type StateUpdate,
} from '@arbora/acp-client';
import {
  ACP_LOG_LIMIT,
  DEFAULT_THREAD_TITLE,
  EDIT_TOOL_KINDS,
  idleThreadState,
  permissionMemoryKey,
  stopReasonSchema,
  type AcpLogEntry,
  type AgentAvailability,
  type AgentDefinition,
  type AgentGroup,
  type Attachment,
  type AuthMethod,
  type ContentBlock,
  type PermissionOptionKind,
  type Platform,
  type RememberedPermissions,
  type Thread,
  type ThreadChange,
  type ThreadEvent,
  type ThreadState,
  type ThreadSummary,
  type ToolKind,
} from '@arbora/shared';
import type { TerminalService } from '../terminal/terminal-service.js';
import { AgentTerminals } from './agent-terminals.js';
import { runAgentTask } from './agent-task.js';
import { attachmentBlocks } from './attachments.js';
import { AgentGroupStore, ThreadStore } from './thread-store.js';

export interface AgentServiceEvents {
  threadsChanged(threads: ThreadSummary[]): void;
  groupsChanged(groups: AgentGroup[]): void;
  threadEvents(threadId: string, changes: ThreadChange[]): void;
  threadState(threadId: string, state: ThreadState): void;
  log(threadId: string, entry: AcpLogEntry): void;
  fileChanged(threadId: string, path: string): void;
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
  /** Model (a `model` config option value) to apply to a brand-new session of `agentId`. */
  readonly defaultModel?: (agentId: string) => string | undefined;
  readonly permissions: {
    get(): RememberedPermissions;
    remember(key: string, decision: 'allow' | 'reject'): void;
  };
  readonly events: AgentServiceEvents;
  readonly now?: () => number;
  /** Arbora's MCP servers (the Stage 5 browser tools) for a new agent session of `threadId`. */
  readonly mcp?: (threadId: string) => Promise<McpAttachment>;
  /** `stdio` sends every agent through the shim, even with `mcpCapabilities.http` (`ARBORA_MCP_TRANSPORT`). */
  readonly mcpTransport?: 'auto' | 'stdio';
  /** The user's own MCP servers (Settings > MCP servers) for a session of `agentId`. */
  readonly userMcpServers?: (agentId: string, http: boolean) => McpServer[];
}

/** MCP servers Arbora runs for one agent session; closed when the agent process stops. */
export interface McpAttachment {
  /** `mcpServers` for `session/new`/`load`/`resume`; `http` is the agent's `mcpCapabilities.http`. */
  servers(http: boolean): McpServer[];
  /** Whether the agent has asked for the tool list (agents that cannot reach the server never do). */
  readonly toolsListed: boolean;
  /** The server also carries the Grove orchestration tools (a lead session). */
  readonly groveTools?: boolean;
  close(): Promise<void>;
}

/** A permission card Arbora raises itself (browser tools), not the agent. */
export interface ToolPermissionRequest {
  readonly title: string;
  readonly detail: string;
  readonly toolKind: ToolKind;
  /** Offer "always"/"never" answers, which the caller persists. */
  readonly persistent: boolean;
}

export type BrowserPreviewEvent = Omit<Extract<ThreadEvent, { kind: 'browser_preview' }>, 'id' | 'at' | 'kind'>;

/** One agent process plus its ACP connection; `sessionId` is set once `session/new` or load succeeded. */
class Runtime {
  readonly session: AcpSession;
  sessionId: string | null = null;
  mcp: McpAttachment | null = null;

  constructor(
    readonly process: AgentProcess,
    readonly terminals: AgentTerminals,
    makeSession: (runtime: Runtime) => AcpSession,
  ) {
    this.session = makeSession(this);
  }
}

interface PendingPermission {
  resolve(optionId: string | null): void;
}

interface ThreadRecord {
  thread: Thread;
  normalizer: UpdateNormalizer;
  log: AcpLogEntry[];
  logCounter: number;
  runtime: Runtime | null;
  starting: Promise<Runtime> | null;
  /** `session/load` replays history Arbora already has; transcript updates are dropped meanwhile. */
  replaying: boolean;
  pendingPermissions: Map<string, PendingPermission>;
  pendingPrompt: { blocks: ContentBlock[]; attachments: Attachment[]; title: string | undefined } | null;
  crashes: number;
  saveTimer: NodeJS.Timeout | undefined;
  /** The user pressed Stop: a start in flight ends quietly and a killed turn ends as cancelled. */
  stopRequested: boolean;
  /** Model picked for this thread when it was created; wins over the agent's default model. */
  initialModel: string | undefined;
  /** Prompts accepted but not finished, including ones still waiting for the agent to start. */
  promptsInFlight: number;
}

export interface CreateThreadOptions {
  /** A value of the agent's `model` config option; wins over the user's default model. */
  readonly model?: string | undefined;
  /** Agent group; an unknown id files the thread as ungrouped. */
  readonly groupId?: string | null | undefined;
  /** The lead session that starts this one as a helper (Grove orchestration). */
  readonly parentThreadId?: string | null | undefined;
  /** Names the thread before its first prompt (Grove's launcher, `grove_start_agent`). */
  readonly title?: string | undefined;
  readonly autoApproveEdits?: boolean | undefined;
}

export interface WaitOptions {
  /** `all`: every thread settled; `any`: at least one. */
  readonly until: 'all' | 'any';
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /**
   * The thread whose turn is waiting (a lead in `grove_wait`). The wait ends with `false` once that
   * turn is over: not every agent drops its MCP request when its turn is cancelled.
   */
  readonly turnOf?: string;
}

const SAVE_DELAY_MS = 300;
const MAX_AUTO_RESTARTS = 3;
/** How long Stop waits for the agent to honour `session/cancel` before it stops the process. */
export const STOP_GRACE_MS = 3000;
const TITLE_LENGTH = 60;

export class AgentServiceError extends Error {}

/** A start or turn ended because the user pressed Stop. */
class AgentStoppedError extends AgentServiceError {
  constructor() {
    super('Stopped');
  }
}

/**
 * Agent threads for one project: one ACP session (and process) per thread, started on the first
 * prompt (or eagerly for a brand-new thread), persisted to `.arbora/threads/<id>.json`.
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

  getThread(threadId: string): Thread | null {
    const record = this.records.get(threadId);
    return record ? { ...record.thread, state: record.thread.state, events: [...record.normalizer.events] } : null;
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
      sessionId: null,
      autoApproveEdits: options.autoApproveEdits ?? false,
      groupId: known ? groupId : null,
      pinned: false,
      archivedAt: null,
      parentThreadId: parentThreadId != null && this.records.has(parentThreadId) ? parentThreadId : null,
      state: idleThreadState(),
      events: [],
    };
    const record = this.record(thread);
    record.initialModel = options.model;
    this.records.set(thread.id, record);
    this.store.save(this.getThread(thread.id) ?? thread);
    this.emitThreads();
    // Start now so modes, models and slash commands are there before the first prompt.
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
   * Moves a thread to Grove's Recent, stopping its process first, or brings it back. The
   * transcript stays; the next prompt after a restore starts the agent again.
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

  setAutoApproveEdits(threadId: string, enabled: boolean): void {
    const record = this.require(threadId);
    record.thread = { ...record.thread, autoApproveEdits: enabled };
    this.scheduleSave(record);
    this.emitThreads();
  }

  // --- Turns ---------------------------------------------------------------------------------

  /**
   * `title` names a new thread when the first text block is not a good title (agent mode's prompt
   * starts with a Markdown template).
   */
  async prompt(
    threadId: string,
    blocks: ContentBlock[],
    attachments: Attachment[] = [],
    options: { readonly title?: string } = {},
  ): Promise<{ stopReason: string | null; error?: string }> {
    const record = this.require(threadId);
    if (blocks.length === 0 && attachments.length === 0) throw new AgentServiceError('Nothing to send');
    if (record.thread.archivedAt !== null) {
      throw new AgentServiceError('This session is archived. Restore it before sending it a message.');
    }
    if (record.thread.state.status === 'prompting') throw new AgentServiceError('The agent is still working');

    record.promptsInFlight++;
    try {
      let runtime: Runtime;
      try {
        runtime = await this.ensureRuntime(record);
      } catch (error) {
        if (error instanceof AgentStoppedError) return { stopReason: 'cancelled' };
        if (record.thread.state.status === 'auth_required') {
          record.pendingPrompt = { blocks, attachments, title: options.title };
          return { stopReason: null, error: 'auth_required' };
        }
        return { stopReason: null, error: messageOf(error) };
      }
      if (!runtime.sessionId) return { stopReason: null, error: 'No session' };
      return await this.runTurn(record, runtime, blocks, attachments, options.title);
    } finally {
      record.promptsInFlight--;
      this.wakeWaiters();
    }
  }

  /**
   * Starts the thread's agent (if needed) and returns its prompt capabilities, so a caller can
   * decide between `image` blocks and file links before composing. Null when the agent could not
   * start or waits for a login; `prompt` then keeps the prompt as usual.
   */
  async promptCapabilities(threadId: string): Promise<ThreadState['capabilities']> {
    const record = this.require(threadId);
    try {
      await this.ensureRuntime(record);
    } catch {
      return null;
    }
    return record.thread.state.capabilities;
  }

  async cancel(threadId: string): Promise<void> {
    const record = this.require(threadId);
    const runtime = record.runtime;
    if (!runtime?.sessionId || record.thread.state.status !== 'prompting') return;
    await runtime.session.cancel(runtime.sessionId);
  }

  /**
   * Always stops the agent's current work. A turn gets `session/cancel` first; if the agent does
   * not end it within `STOP_GRACE_MS`, or the agent is still starting or waiting for a login, the
   * process is stopped (the next prompt starts it again and restores the session when it can).
   */
  async stop(threadId: string): Promise<void> {
    const record = this.require(threadId);
    record.pendingPrompt = null;
    const status = record.thread.state.status;
    const runtime = record.runtime;
    if (status === 'prompting' && runtime?.sessionId) {
      await runtime.session.cancel(runtime.sessionId).catch(() => undefined);
      if (await this.settles(record, STOP_GRACE_MS)) return;
      this.info(record, `no reply to session/cancel after ${STOP_GRACE_MS} ms; stopping the agent`);
    } else if (status !== 'starting' && status !== 'auth_required' && status !== 'prompting') {
      return;
    }
    record.stopRequested = true;
    await this.stopRuntime(record);
    this.setState(record, { status: 'idle', error: null });
  }

  /**
   * Ends the agent process whatever it is doing (Grove's Stop, archive, a lead's `grove_stop`). A
   * turn gets `session/cancel` and a short grace first so the agent can save its session; the
   * thread then shows as Stopped until the next prompt starts the agent again.
   */
  async stopProcess(threadId: string): Promise<void> {
    const record = this.require(threadId);
    record.pendingPrompt = null;
    const runtime = record.runtime;
    if (record.thread.state.status === 'prompting' && runtime?.sessionId) {
      await runtime.session.cancel(runtime.sessionId).catch(() => undefined);
      await this.settles(record, STOP_GRACE_MS);
    }
    if (!record.runtime && !record.starting && record.thread.state.status === 'idle') return;
    record.stopRequested = true;
    await this.stopRuntime(record);
    record.crashes = 0;
    this.setState(record, { status: 'idle', error: null });
  }

  /**
   * Resolves once the threads are settled (nothing more happens until someone acts: done, idle,
   * waiting on the user, failed or stopped), or with `false` on the timeout or the abort signal. A
   * deleted or archived thread counts as settled, so this never waits on something that is gone.
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
        if (this.disposed || (options.turnOf !== undefined && !this.isPrompting(options.turnOf))) {
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
    if (record.pendingPermissions.size > 0 || status === 'auth_required' || status === 'error') return true;
    if (status === 'starting' || status === 'prompting') return false;
    return record.promptsInFlight === 0;
  }

  respondPermission(threadId: string, requestId: string, optionId: string): void {
    const record = this.require(threadId);
    const pending = record.pendingPermissions.get(requestId);
    if (!pending) throw new AgentServiceError('That permission request is no longer pending');
    pending.resolve(optionId);
  }

  /**
   * Shows a permission card for one of Arbora's own tools (the browser tools' navigation,
   * `browser_evaluate`, `terminal_run`) and waits for the user. Resolves with the kind of option
   * chosen, or null when the thread, turn or agent went away first.
   */
  async requestToolPermission(threadId: string, request: ToolPermissionRequest): Promise<PermissionOptionKind | null> {
    const record = this.records.get(threadId);
    if (!record) return null;
    const options: RequestPermissionRequest['options'] = [
      { optionId: 'allow', name: request.persistent ? 'Allow this session' : 'Allow', kind: 'allow_once' },
      ...(request.persistent
        ? [{ optionId: 'allow-always', name: 'Always allow in this project', kind: 'allow_always' as const }]
        : []),
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ...(request.persistent
        ? [{ optionId: 'reject-always', name: 'Never in this project', kind: 'reject_always' as const }]
        : []),
    ];
    const requestId = randomUUID();
    this.emitChanges(
      record,
      record.normalizer.permissionRequested(requestId, {
        sessionId: record.runtime?.sessionId ?? '',
        toolCall: {
          toolCallId: `arbora-${requestId}`,
          title: request.title,
          kind: request.toolKind,
          rawInput: { detail: request.detail },
        },
        options,
      }),
    );
    const chosen = await this.waitForPermission(record, requestId);
    if (chosen === null) {
      this.emitChanges(record, record.normalizer.permissionResolved(requestId, 'cancelled'));
      return null;
    }
    this.emitChanges(record, record.normalizer.permissionResolved(requestId, { optionId: chosen, auto: false }));
    return options.find((o) => o.optionId === chosen)?.kind ?? null;
  }

  /** Mirrors a browser-tools screenshot into the thread as a thumbnail. */
  addBrowserPreview(threadId: string, preview: BrowserPreviewEvent): void {
    const record = this.records.get(threadId);
    if (record) this.emitChanges(record, record.normalizer.browserPreview(preview));
  }

  async setMode(threadId: string, modeId: string): Promise<void> {
    const record = this.require(threadId);
    const runtime = this.requireRuntime(record);
    await runtime.session.setMode(runtime.sessionId ?? '', modeId);
    const modes = record.thread.state.modes;
    if (modes) this.setState(record, { modes: { ...modes, currentModeId: modeId } });
  }

  async setConfigOption(threadId: string, configId: string, value: string | boolean): Promise<void> {
    const record = this.require(threadId);
    const runtime = this.requireRuntime(record);
    if (configId === LEGACY_MODEL_OPTION_ID) {
      if (typeof value !== 'string') throw new AgentServiceError('A model id is required');
      await runtime.session.setModel(runtime.sessionId ?? '', value);
      this.applyState(record, [
        { type: 'configOptions', options: withLegacyModel(record.thread.state.configOptions, value) },
      ]);
      return;
    }
    const response = await runtime.session.setConfigOption(runtime.sessionId ?? '', configId, value);
    this.applyState(record, [{ type: 'configOptions', options: sessionConfigOptions(response) }]);
  }

  async authenticate(threadId: string, methodId: string): Promise<void> {
    const record = this.require(threadId);
    const runtime = record.runtime;
    if (!runtime) throw new AgentServiceError('The agent is not running');
    this.setState(record, { status: 'starting', error: null });
    try {
      await runtime.session.authenticate(methodId);
      this.info(record, `authenticated with ${methodId}`);
      await this.openSession(record, runtime);
    } catch (error) {
      if (AcpSession.isAuthRequired(error)) {
        this.setState(record, { status: 'auth_required', error: messageOf(error) });
        return;
      }
      this.setState(record, { status: 'error', error: messageOf(error) });
      throw error;
    }
    const pending = record.pendingPrompt;
    record.pendingPrompt = null;
    if (pending && runtime.sessionId) {
      void this.runTurn(record, runtime, pending.blocks, pending.attachments, pending.title);
    }
  }

  /** Stops the agent process; the next prompt starts it again from scratch. */
  async restart(threadId: string): Promise<void> {
    const record = this.require(threadId);
    await this.stopRuntime(record);
    record.crashes = 0;
    record.pendingPrompt = null;
    this.setState(record, { ...idleThreadState() });
    void this.ensureRuntime(record).catch(() => undefined);
  }

  /**
   * One prompt to `agentId` in a session of its own that is not a thread (commit messages, pull
   * request text). `model` null uses the user's default model for that agent.
   */
  async runTask(agentId: string, model: string | null, prompt: string): Promise<string> {
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
      model: model ?? this.options.defaultModel?.(agentId) ?? null,
      prompt,
    });
  }

  // --- Log -----------------------------------------------------------------------------------

  getLog(threadId: string): AcpLogEntry[] {
    return [...this.require(threadId).log];
  }

  async exportLog(threadId: string, path: string): Promise<void> {
    const record = this.require(threadId);
    const payload = {
      exportedAt: new Date(this.now()).toISOString(),
      thread: { id: record.thread.id, agentId: record.thread.agentId, title: record.thread.title },
      entries: record.log,
    };
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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

  private record(thread: Thread): ThreadRecord {
    const events = [...thread.events];
    return {
      thread: { ...thread, events: [] },
      normalizer: new UpdateNormalizer({ nextId: () => randomUUID(), now: this.now, events }),
      log: [],
      logCounter: 0,
      runtime: null,
      starting: null,
      replaying: false,
      pendingPermissions: new Map(),
      pendingPrompt: null,
      crashes: 0,
      stopRequested: false,
      saveTimer: undefined,
      initialModel: undefined,
      promptsInFlight: 0,
    };
  }

  private wakeWaiters(): void {
    for (const check of [...this.settleWaiters]) check();
  }

  private isPrompting(threadId: string): boolean {
    return this.records.get(threadId)?.thread.state.status === 'prompting';
  }

  /** Resolves true once the thread is no longer prompting, false after `timeoutMs`. */
  private async settles(record: ThreadRecord, timeoutMs: number): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (record.thread.state.status === 'prompting') {
      if (this.now() >= deadline) return false;
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
    return true;
  }

  private require(threadId: string): ThreadRecord {
    const record = this.records.get(threadId);
    if (!record) throw new AgentServiceError(`Unknown thread ${threadId}`);
    return record;
  }

  private requireRuntime(record: ThreadRecord): Runtime {
    if (!record.runtime?.sessionId) throw new AgentServiceError('The agent has not started a session yet');
    return record.runtime;
  }

  private summary(record: ThreadRecord): ThreadSummary {
    const { events: _events, ...summary } = record.thread;
    return summary;
  }

  private emitThreads(): void {
    if (!this.disposed) this.options.events.threadsChanged(this.listThreads());
  }

  private emitChanges(record: ThreadRecord, changes: ThreadChange[]): void {
    if (changes.length === 0) return;
    record.thread = { ...record.thread, updatedAt: this.now() };
    if (!this.disposed) this.options.events.threadEvents(record.thread.id, changes);
    this.scheduleSave(record);
    this.wakeWaiters();
  }

  private setState(record: ThreadRecord, patch: Partial<ThreadState>): void {
    record.thread = { ...record.thread, state: { ...record.thread.state, ...patch } };
    if (!this.disposed) {
      this.options.events.threadState(record.thread.id, record.thread.state);
      if (patch.status !== undefined) this.emitThreads();
    }
    this.wakeWaiters();
  }

  private applyState(record: ThreadRecord, updates: StateUpdate[]): void {
    for (const update of updates) {
      switch (update.type) {
        case 'availableCommands':
          this.setState(record, { availableCommands: update.commands });
          break;
        case 'currentMode': {
          const modes = record.thread.state.modes;
          if (modes) this.setState(record, { modes: { ...modes, currentModeId: update.modeId } });
          break;
        }
        case 'configOptions':
          this.setState(record, { configOptions: update.options });
          break;
        case 'title':
          // Kimi titles the thread after the first prompt, which is our preface; keep ours then.
          if (isPrefaceTitle(update.title)) break;
          record.thread = { ...record.thread, title: update.title.slice(0, 200) };
          this.scheduleSave(record);
          this.emitThreads();
          break;
        default: {
          const unreachable: never = update;
          throw new Error(`Unhandled state update ${String(unreachable)}`);
        }
      }
    }
  }

  private scheduleSave(record: ThreadRecord): void {
    clearTimeout(record.saveTimer);
    record.saveTimer = setTimeout(() => this.saveNow(record), SAVE_DELAY_MS);
  }

  private saveNow(record: ThreadRecord): void {
    record.saveTimer = undefined;
    if (!this.records.has(record.thread.id)) return;
    try {
      this.store.save({ ...record.thread, events: record.normalizer.events });
    } catch (error) {
      console.warn(`[agent] could not save thread ${record.thread.id}: ${messageOf(error)}`);
    }
  }

  private pushLog(record: ThreadRecord, entry: Omit<AcpLogEntry, 'id' | 'at'>): void {
    const full: AcpLogEntry = { id: ++record.logCounter, at: this.now(), ...entry };
    record.log.push(full);
    if (record.log.length > ACP_LOG_LIMIT) record.log.splice(0, record.log.length - ACP_LOG_LIMIT);
    if (!this.disposed) this.options.events.log(record.thread.id, full);
  }

  private info(record: ThreadRecord, message: string): void {
    this.pushLog(record, { direction: 'info', message });
  }

  /** Spawns the agent, negotiates capabilities and opens (or restores) the ACP session. */
  private ensureRuntime(record: ThreadRecord): Promise<Runtime> {
    if (record.runtime?.sessionId) return Promise.resolve(record.runtime);
    if (record.starting) return record.starting;
    if (record.runtime && record.thread.state.status === 'auth_required') {
      // The process is up and waiting for `authenticate`; spawning another would leak this one.
      return Promise.reject(new AgentServiceError(record.thread.state.error ?? 'The agent needs you to log in'));
    }
    record.stopRequested = false;
    const starting = this.start(record).finally(() => {
      record.starting = null;
    });
    record.starting = starting;
    return starting;
  }

  private async start(record: ThreadRecord): Promise<Runtime> {
    const agent = this.options.registry.get(record.thread.agentId);
    if (!agent) {
      this.setState(record, { status: 'error', error: `Agent ${record.thread.agentId} is not configured` });
      throw new AgentServiceError(`Agent ${record.thread.agentId} is not configured`);
    }
    if (record.crashes >= MAX_AUTO_RESTARTS) {
      const error = `${agent.name} exited ${record.crashes} times in a row. Use Restart to try again.`;
      this.setState(record, { status: 'error', error });
      throw new AgentServiceError(error);
    }
    const delay = restartDelay(record.crashes);
    if (delay > 0) {
      this.info(record, `restarting ${agent.name} in ${delay} ms`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }
    this.setState(record, { status: 'starting', error: null, authMethods: [] });
    // Never replace a live runtime without stopping it, or its process outlives the thread.
    if (record.runtime) await this.stopRuntime(record);

    const env = await this.options.environment();
    if (record.stopRequested) throw this.stopped(record);
    Object.assign(env, agent.env);
    const lookup = this.options.lookup();
    const resolved = lookup(agent.command);
    if (!resolved) {
      const error = `${agent.command} was not found on PATH. ${agent.installHint ?? ''}`.trim();
      this.setState(record, { status: 'error', error });
      throw new AgentServiceError(error);
    }
    this.info(record, `spawning ${resolved} ${agent.args.join(' ')}`);
    const process = new AgentProcess({
      platform: this.options.platform,
      command: resolved,
      args: agent.args,
      env,
      cwd: this.options.projectPath,
      lookup,
      onStderr: (line) => this.pushLog(record, { direction: 'stderr', message: line }),
    });
    const terminals = new AgentTerminals(this.options.terminals, this.options.projectPath, () => record.thread.title);
    const runtime = new Runtime(
      process,
      terminals,
      (self) =>
        new AcpSession(process.stream, {
          requestPermission: (request, signal) => this.onPermission(record, request, signal),
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(record, request),
          terminal: terminals.terminal,
          onUpdate: (notification) => this.onUpdate(record, self, notification),
          onLog: (entry) => this.onLog(record, entry),
          onClosed: (error) => this.onClosed(record, self, error),
        }),
    );
    record.runtime = runtime;

    try {
      const initialized = await runtime.session.initialize();
      const capabilities = runtime.session.capabilities;
      this.setState(record, {
        capabilities,
        authMethods: (initialized.authMethods ?? []).map((m): AuthMethod => ({
          id: m.id,
          name: m.name,
          ...(m.description != null ? { description: m.description } : {}),
        })),
      });
      this.info(
        record,
        `initialized ${initialized.agentInfo?.name ?? agent.name} ${initialized.agentInfo?.version ?? ''} (protocol ${initialized.protocolVersion})`.trim(),
      );
      await this.attachMcp(record, runtime);
      await this.openSession(record, runtime);
      return runtime;
    } catch (error) {
      if (this.wasStopped(record)) throw this.stopped(record);
      if (AcpSession.isAuthRequired(error)) {
        const authMethods = record.thread.state.authMethods;
        const hint = agent.installHint ? ` ${agent.installHint}` : '';
        this.setState(record, {
          status: 'auth_required',
          error:
            authMethods.length > 0
              ? `${agent.name} needs you to log in.${hint}`
              : `${agent.name} rejected the session: not authenticated.${hint}`,
        });
        throw error;
      }
      const message = process.startError ? process.startError.message : messageOf(error);
      this.setState(record, { status: 'error', error: message });
      await this.stopRuntime(record);
      throw error;
    }
  }

  /** Read through a call: `stop()` sets the flag while an `await` is pending, which narrowing cannot see. */
  private wasStopped(record: ThreadRecord): boolean {
    return record.stopRequested;
  }

  private stopped(record: ThreadRecord): AgentStoppedError {
    this.setState(record, { status: 'idle', error: null });
    return new AgentStoppedError();
  }

  /** Starts the browser-tools MCP server for this process; the session works without it. */
  private async attachMcp(record: ThreadRecord, runtime: Runtime): Promise<void> {
    if (!this.options.mcp) return;
    try {
      runtime.mcp = await this.options.mcp(record.thread.id);
      this.info(record, `browser tools attached over ${this.httpMcp(runtime) ? 'http' : 'stdio shim'}`);
    } catch (error) {
      this.info(record, `browser tools unavailable: ${messageOf(error)}`);
    }
  }

  private httpMcp(runtime: Runtime): boolean {
    return runtime.session.supportsHttpMcp && this.options.mcpTransport !== 'stdio';
  }

  private mcpServers(record: ThreadRecord, runtime: Runtime): McpServer[] {
    const http = runtime.session.supportsHttpMcp;
    const own = runtime.mcp?.servers(this.httpMcp(runtime)) ?? [];
    const user = this.options.userMcpServers?.(record.thread.agentId, http) ?? [];
    if (user.length > 0) this.info(record, `your MCP servers: ${user.map((server) => server.name).join(', ')}`);
    return [...own, ...user];
  }

  /** `session/load` or `session/resume` when advertised and we have a session id; else `session/new`. */
  private async openSession(record: ThreadRecord, runtime: Runtime): Promise<void> {
    const previous = record.thread.sessionId;
    const capabilities = runtime.session.capabilities;
    let restored = false;
    if (previous && capabilities) {
      if (capabilities.loadSession) {
        restored = await this.tryRestore(record, runtime, 'load', previous);
      } else if (capabilities.resume) {
        restored = await this.tryRestore(record, runtime, 'resume', previous);
      }
    }
    if (!restored) {
      const response = await runtime.session.newSession(this.options.projectPath, this.mcpServers(record, runtime));
      runtime.sessionId = response.sessionId;
      // Some agents number sessions per process, so a fresh session may reuse the old id.
      const contextLost = previous !== null;
      record.thread = { ...record.thread, sessionId: response.sessionId };
      this.setState(record, {
        status: 'ready',
        error: null,
        modes: response.modes ?? null,
        configOptions: sessionConfigOptions(response),
        contextLost,
      });
      if (contextLost) {
        this.emitChanges(
          record,
          record.normalizer.apply({
            sessionUpdate: 'notice',
            severity: 'warning',
            title: 'Previous session could not be restored',
            description: 'The agent starts a new session and does not remember this transcript.',
          }).changes,
        );
      }
      this.info(record, `session/new -> ${response.sessionId}`);
      if (previous === null) await this.applyDefaultModel(record);
    }
    record.crashes = 0;
    this.scheduleSave(record);
  }

  /** Switches a brand-new session to the user's default model for this agent, when it offers it. */
  private async applyDefaultModel(record: ThreadRecord): Promise<void> {
    const wanted = record.initialModel ?? this.options.defaultModel?.(record.thread.agentId);
    if (!wanted) return;
    const option = record.thread.state.configOptions.find(
      (o): o is Extract<typeof o, { type: 'select' }> => o.type === 'select' && o.category === 'model',
    );
    if (!option || option.currentValue === wanted) return;
    const values = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry])).map((o) => o.value);
    if (!values.includes(wanted)) {
      this.info(record, `default model ${wanted} is not offered by this agent; keeping ${option.currentValue}`);
      return;
    }
    try {
      await this.setConfigOption(record.thread.id, option.id, wanted);
      this.info(record, `default model ${wanted} applied`);
    } catch (error) {
      this.info(record, `could not apply default model ${wanted}: ${messageOf(error)}`);
    }
  }

  private async tryRestore(
    record: ThreadRecord,
    runtime: Runtime,
    how: 'load' | 'resume',
    sessionId: string,
  ): Promise<boolean> {
    record.replaying = true;
    try {
      const servers = this.mcpServers(record, runtime);
      const response =
        how === 'load'
          ? await runtime.session.loadSession(sessionId, this.options.projectPath, servers)
          : await runtime.session.resumeSession(sessionId, this.options.projectPath, servers);
      runtime.sessionId = sessionId;
      this.setState(record, {
        status: 'ready',
        error: null,
        modes: response.modes ?? record.thread.state.modes,
        configOptions: sessionConfigOptions(response),
        contextLost: false,
      });
      this.info(record, `session/${how} ${sessionId} ok`);
      return true;
    } catch (error) {
      if (AcpSession.isAuthRequired(error)) throw error;
      this.info(record, `session/${how} ${sessionId} failed: ${messageOf(error)}`);
      return false;
    } finally {
      record.replaying = false;
    }
  }

  private async runTurn(
    record: ThreadRecord,
    runtime: Runtime,
    blocks: ContentBlock[],
    attachments: Attachment[],
    title?: string,
  ): Promise<{ stopReason: string | null; error?: string }> {
    const sessionId = runtime.sessionId;
    if (!sessionId) return { stopReason: null, error: 'No session' };
    const capabilities = record.thread.state.capabilities ?? { image: false };
    const attached = await attachmentBlocks(attachments, capabilities);
    const shown = [...blocks, ...attached];
    const firstPrompt = !record.normalizer.events.some((e) => e.kind === 'user_message');
    const sent: ContentBlock[] = firstPrompt
      ? [
          {
            type: 'text',
            text: firstPromptPreface({
              projectPath: this.options.projectPath,
              devUrl: this.options.devUrl(),
              browserTools: runtime.mcp !== null,
              groveTools: runtime.mcp?.groveTools === true,
            }),
          },
          ...shown,
        ]
      : shown;

    if (record.thread.title === DEFAULT_THREAD_TITLE) {
      const text =
        title?.trim() || blocks.find((b): b is ContentBlock & { type: 'text' } => b.type === 'text')?.text.trim();
      if (text) {
        record.thread = {
          ...record.thread,
          title: text.split('\n')[0]?.slice(0, TITLE_LENGTH) ?? DEFAULT_THREAD_TITLE,
        };
        this.emitThreads();
      }
    }
    this.emitChanges(record, record.normalizer.userMessage(shown));
    record.stopRequested = false;
    this.setState(record, { status: 'prompting', error: null });
    try {
      const response = await runtime.session.prompt(sessionId, sent);
      const stopReason = stopReasonSchema.safeParse(response.stopReason);
      this.emitChanges(record, record.normalizer.turnEnded(stopReason.success ? stopReason.data : 'end_turn'));
      if (firstPrompt) this.warnIfToolsUnused(record, runtime);
      if (record.runtime === runtime) this.setState(record, { status: 'ready' });
      return { stopReason: response.stopReason };
    } catch (error) {
      if (this.wasStopped(record)) {
        this.emitChanges(record, record.normalizer.turnEnded('cancelled'));
        return { stopReason: 'cancelled' };
      }
      const message = messageOf(error);
      if (AcpSession.isAuthRequired(error) && record.runtime === runtime) {
        // Claude Code's adapter accepts `session/new` and only refuses the first prompt; keep the
        // prompt so it goes out once the user has logged in.
        record.pendingPrompt = { blocks, attachments, title };
        this.setState(record, { status: 'auth_required', error: this.authHint(record, message) });
        return { stopReason: null, error: 'auth_required' };
      }
      this.emitChanges(record, record.normalizer.error(message));
      if (record.runtime === runtime) this.setState(record, { status: 'ready', error: message });
      return { stopReason: null, error: message };
    } finally {
      this.cancelPendingPermissions(record);
    }
  }

  /**
   * An agent that never listed the tools after a whole turn could not reach the server (a strict
   * network sandbox) or ignores client MCP servers; say so once instead of failing silently.
   */
  private warnIfToolsUnused(record: ThreadRecord, runtime: Runtime): void {
    if (!runtime.mcp || runtime.mcp.toolsListed) return;
    this.info(record, 'the agent did not list the arbora-browser MCP tools during its first turn');
    this.emitChanges(
      record,
      record.normalizer.apply({
        sessionUpdate: 'notice',
        severity: 'warning',
        title: 'The agent has not loaded Arbora’s browser tools',
        description:
          'It cannot see or drive the browser panel, so it cannot check its own changes. Its sandbox may block localhost, or it may not support MCP servers from the client.',
      }).changes,
    );
  }

  private authHint(record: ThreadRecord, message: string): string {
    const agent = this.options.registry.get(record.thread.agentId);
    const hint = agent?.installHint ? ` ${agent.installHint}` : '';
    return `${agent?.name ?? record.thread.agentId}: ${message}.${hint}`;
  }

  private onUpdate(record: ThreadRecord, runtime: Runtime, notification: SessionNotification): void {
    if (record.runtime !== runtime) return;
    if (record.replaying) {
      // History we already have; keep only session-level facts.
      const scratch = new UpdateNormalizer({ nextId: () => randomUUID(), now: this.now });
      this.applyState(record, scratch.apply(notification.update).state);
      return;
    }
    const result = record.normalizer.apply(notification.update);
    this.emitChanges(record, result.changes);
    this.applyState(record, result.state);
  }

  private onLog(record: ThreadRecord, entry: AcpLogMessage): void {
    this.pushLog(record, { direction: entry.direction, message: redact(entry.message) });
  }

  private onClosed(record: ThreadRecord, runtime: Runtime, error: unknown): void {
    if (record.runtime !== runtime) return;
    void runtime.process.exited.then((exit) => {
      if (record.runtime !== runtime) return;
      record.runtime = null;
      this.cancelPendingPermissions(record);
      void runtime.terminals.dispose();
      void runtime.mcp?.close().catch(() => undefined);
      const wasPrompting = record.thread.state.status === 'prompting';
      const detail = exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'unknown'}`;
      const message = error ? `${messageOf(error)} (${detail})` : `Agent exited with ${detail}`;
      this.info(record, message);
      if (this.disposed || !this.records.has(record.thread.id)) return;
      if (record.thread.state.status === 'idle') return;
      record.crashes++;
      if (wasPrompting) this.emitChanges(record, record.normalizer.error(message));
      this.setState(record, { status: 'error', error: message });
    });
  }

  private async stopRuntime(record: ThreadRecord): Promise<void> {
    const runtime = record.runtime;
    record.runtime = null;
    this.cancelPendingPermissions(record);
    if (!runtime) return;
    await runtime.terminals.dispose();
    await runtime.session.close();
    await runtime.mcp?.close().catch(() => undefined);
    runtime.process.kill();
    await Promise.race([runtime.process.exited, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000))]);
    runtime.process.kill('SIGKILL');
  }

  private cancelPendingPermissions(record: ThreadRecord): void {
    for (const pending of record.pendingPermissions.values()) pending.resolve(null);
    record.pendingPermissions.clear();
  }

  // --- Client-side handlers -------------------------------------------------------------------

  private async onPermission(
    record: ThreadRecord,
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    const toolCall = request.toolCall;
    const toolKind: ToolKind = toolCall.kind ?? record.normalizer.toolKindOf(toolCall.toolCallId) ?? 'other';
    const options = request.options;
    const requestId = randomUUID();
    this.emitChanges(record, record.normalizer.permissionRequested(requestId, request));

    const locations = toolCall.locations ?? record.normalizer.toolLocationsOf(toolCall.toolCallId);
    const auto = this.automaticAnswer(record, toolKind, locations, options);
    if (auto) {
      this.emitChanges(record, record.normalizer.permissionResolved(requestId, { optionId: auto, auto: true }));
      return { outcome: { outcome: 'selected', optionId: auto } };
    }

    const chosen = await this.waitForPermission(record, requestId, signal);
    if (chosen === null) {
      this.emitChanges(record, record.normalizer.permissionResolved(requestId, 'cancelled'));
      return { outcome: { outcome: 'cancelled' } };
    }
    const option = options.find((o) => o.optionId === chosen);
    if (option?.kind === 'allow_always')
      this.options.permissions.remember(permissionMemoryKey(record.thread.agentId, toolKind), 'allow');
    if (option?.kind === 'reject_always')
      this.options.permissions.remember(permissionMemoryKey(record.thread.agentId, toolKind), 'reject');
    this.emitChanges(record, record.normalizer.permissionResolved(requestId, { optionId: chosen, auto: false }));
    return { outcome: { outcome: 'selected', optionId: chosen } };
  }

  /** Waits for the renderer's answer to a permission card; null when cancelled or aborted. */
  private waitForPermission(record: ThreadRecord, requestId: string, signal?: AbortSignal): Promise<string | null> {
    return new Promise<string | null>((resolvePermission) => {
      const pending: PendingPermission = {
        resolve: (optionId) => {
          record.pendingPermissions.delete(requestId);
          signal?.removeEventListener('abort', onAbort);
          resolvePermission(optionId);
        },
      };
      const onAbort = (): void => pending.resolve(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      record.pendingPermissions.set(requestId, pending);
      this.wakeWaiters();
    });
  }

  /** The option id to answer without asking, from remembered "always" choices or auto-approve edits. */
  private automaticAnswer(
    record: ThreadRecord,
    toolKind: ToolKind,
    locations: readonly { path: string }[],
    options: RequestPermissionRequest['options'],
  ): string | null {
    const allow = options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always');
    const reject = options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always');
    const remembered = this.options.permissions.get()[permissionMemoryKey(record.thread.agentId, toolKind)];
    if (remembered === 'allow' && allow) return allow.optionId;
    if (remembered === 'reject' && reject) return reject.optionId;
    // Without any location we cannot tell what the edit touches, so the card is shown.
    if (record.thread.autoApproveEdits && EDIT_TOOL_KINDS.has(toolKind) && allow && locations.length > 0) {
      const insideProject = locations.every((location) => {
        try {
          resolveInsideRoot(this.options.projectPath, location.path);
          return true;
        } catch {
          return false;
        }
      });
      if (insideProject) return allow.optionId;
    }
    return null;
  }

  private async readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const path = this.scoped(request.path);
    const text = await readFile(path, 'utf8');
    if (request.line == null && request.limit == null) return { content: text };
    const lines = text.split('\n');
    const start = Math.max(0, (request.line ?? 1) - 1);
    const end = request.limit != null ? start + request.limit : lines.length;
    return { content: lines.slice(start, end).join('\n') };
  }

  private async writeTextFile(record: ThreadRecord, request: WriteTextFileRequest): Promise<void> {
    const path = this.scoped(request.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, request.content, 'utf8');
    if (!this.disposed) this.options.events.fileChanged(record.thread.id, path);
  }

  private scoped(path: string): string {
    try {
      return resolveInsideRoot(this.options.projectPath, path);
    } catch (error) {
      if (error instanceof PathScopeError) {
        throw new Error(`Access denied: ${path} is outside the project folder`, { cause: error });
      }
      throw error;
    }
  }
}

/** Config options in Arbora's schema; variants from newer protocol versions are skipped. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
