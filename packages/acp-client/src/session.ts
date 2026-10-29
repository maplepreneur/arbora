import {
  client,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type AnyMessage,
  type ClientConnection,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type InitializeResponse,
  type KillTerminalRequest,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionNotification,
  type SetSessionConfigOptionResponse,
  type Stream,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk';
import type { ContentBlock as SharedContentBlock } from '@arbora/shared';

export const ACP_CLIENT_NAME = 'arbora';
export const AUTH_REQUIRED_CODE = -32000;
const INTERNAL_ERROR_CODE = -32603;
const LEGACY_SET_MODEL_METHOD = 'session/set_model';

/**
 * The SDK answers a thrown non-`RequestError` with a bare "Internal error", which hides why a
 * file write or terminal was refused. Keep the message so the agent can tell the user.
 */
function toRequestError(error: unknown): RequestError {
  if (error instanceof RequestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RequestError(INTERNAL_ERROR_CODE, message, { cause: message });
}

/**
 * Arbora's zod-inferred blocks allow `_meta: undefined`, which the SDK's exact-optional types do
 * not; drop the key so the same values satisfy both.
 */
export function toAcpBlocks(blocks: readonly SharedContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block._meta !== undefined) return block as ContentBlock;
    const { _meta: _dropped, ...rest } = block;
    return rest as ContentBlock;
  });
}

export interface AcpLogMessage {
  readonly direction: 'in' | 'out';
  readonly message: AnyMessage;
}

/** What the agent can ask of the client; Arbora implements these in main. */
export interface AcpSessionHandlers {
  requestPermission(request: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse>;
  readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  writeTextFile(request: WriteTextFileRequest): Promise<void>;
  readonly terminal: {
    create(request: CreateTerminalRequest): Promise<CreateTerminalResponse>;
    output(request: TerminalOutputRequest): Promise<TerminalOutputResponse>;
    waitForExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
    kill(request: KillTerminalRequest): Promise<void>;
    release(request: ReleaseTerminalRequest): Promise<void>;
  };
  onUpdate(notification: SessionNotification): void;
  onLog(entry: AcpLogMessage): void;
  /** The connection closed (agent exited or `close()` was called). */
  onClosed(error?: unknown): void;
}

export interface NegotiatedCapabilities {
  readonly loadSession: boolean;
  readonly resume: boolean;
  readonly image: boolean;
  readonly embeddedContext: boolean;
}

/** Tees every JSON-RPC message to `log` without altering the stream the SDK sees. */
function loggingStream(
  stream: Stream,
  log: (entry: AcpLogMessage) => void,
  onIncoming: (message: AnyMessage) => void,
): Stream {
  const readable = stream.readable.pipeThrough(
    new TransformStream<AnyMessage, AnyMessage>({
      transform(message, controller) {
        log({ direction: 'in', message });
        onIncoming(message);
        controller.enqueue(message);
      },
    }),
  );
  const writer = stream.writable.getWriter();
  const writable = new WritableStream<AnyMessage>({
    write(message) {
      log({ direction: 'out', message });
      return writer.write(message);
    },
    close() {
      return writer.close();
    },
    abort(reason) {
      return writer.abort(reason);
    },
  });
  return { readable, writable };
}

/**
 * One ACP connection to one agent process, using the SDK's stable v1 entrypoint. Holds the
 * negotiated capabilities and exposes the agent-side calls Arbora needs; everything the agent
 * asks of the client is delegated to `handlers`.
 */
export class AcpSession {
  private readonly connection: ClientConnection;
  private initializeResponse: InitializeResponse | null = null;
  /**
   * The SDK resolves responses synchronously but runs notification handlers through async hops,
   * so a `session/update` sent just before a response can be applied after the response's
   * promise settles. These counters let callers wait for the updates that preceded a response.
   */
  private updatesReceived = 0;
  private updatesDispatched = 0;
  private drainWaiters: (() => void)[] = [];

  constructor(stream: Stream, handlers: AcpSessionHandlers) {
    const guarded = this.guarded.bind(this);
    const app = client({ name: ACP_CLIENT_NAME })
      .onRequest(methods.client.session.requestPermission, ({ params, signal }) =>
        guarded(() => handlers.requestPermission(params, signal)),
      )
      .onRequest(methods.client.fs.readTextFile, ({ params }) => guarded(() => handlers.readTextFile(params)))
      .onRequest(methods.client.fs.writeTextFile, ({ params }) =>
        guarded(async () => {
          await handlers.writeTextFile(params);
          return {};
        }),
      )
      .onRequest(methods.client.terminal.create, ({ params }) => guarded(() => handlers.terminal.create(params)))
      .onRequest(methods.client.terminal.output, ({ params }) => guarded(() => handlers.terminal.output(params)))
      .onRequest(methods.client.terminal.waitForExit, ({ params }) =>
        guarded(() => handlers.terminal.waitForExit(params)),
      )
      .onRequest(methods.client.terminal.kill, ({ params }) =>
        guarded(async () => {
          await handlers.terminal.kill(params);
          return {};
        }),
      )
      .onRequest(methods.client.terminal.release, ({ params }) =>
        guarded(async () => {
          await handlers.terminal.release(params);
          return {};
        }),
      )
      .onNotification(methods.client.session.update, ({ params }) => {
        try {
          handlers.onUpdate(params);
        } finally {
          this.updatesDispatched++;
          this.wakeDrainWaiters();
        }
      });
    this.connection = app.connect(
      loggingStream(
        stream,
        (entry) => handlers.onLog(entry),
        (message) => {
          if ('method' in message && !('id' in message) && message.method === methods.client.session.update) {
            this.updatesReceived++;
          }
        },
      ),
    );
    void this.connection.closed.then(
      () => handlers.onClosed(),
      (error: unknown) => handlers.onClosed(error),
    );
  }

  /**
   * Runs an agent-initiated request after the `session/update`s that preceded it on the wire
   * have been applied (the SDK dispatches requests ahead of still-queued notifications), and
   * turns handler failures into JSON-RPC errors that keep their message.
   */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    await this.drainUpdates();
    try {
      return await run();
    } catch (error) {
      throw toRequestError(error);
    }
  }

  get closed(): Promise<void> {
    return this.connection.closed;
  }

  get initialized(): InitializeResponse | null {
    return this.initializeResponse;
  }

  get capabilities(): NegotiatedCapabilities | null {
    const caps = this.initializeResponse?.agentCapabilities;
    if (!this.initializeResponse) return null;
    return {
      loadSession: caps?.loadSession ?? false,
      resume: Boolean(caps?.sessionCapabilities?.resume),
      image: caps?.promptCapabilities?.image ?? false,
      embeddedContext: caps?.promptCapabilities?.embeddedContext ?? false,
    };
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: ACP_CLIENT_NAME, version: '0.0.1' },
    });
    this.initializeResponse = response;
    return response;
  }

  async authenticate(methodId: string): Promise<void> {
    await this.connection.agent.request(methods.agent.authenticate, { methodId });
  }

  newSession(cwd: string, mcpServers: McpServer[]): Promise<NewSessionResponse> {
    return this.connection.agent.request(methods.agent.session.new, { cwd, mcpServers });
  }

  /** Replays the session's history through `session/update` before resolving. */
  async loadSession(sessionId: string, cwd: string, mcpServers: McpServer[]): Promise<LoadSessionResponse> {
    const response = await this.connection.agent.request(methods.agent.session.load, { sessionId, cwd, mcpServers });
    await this.drainUpdates();
    return response;
  }

  async resumeSession(sessionId: string, cwd: string, mcpServers: McpServer[]): Promise<ResumeSessionResponse> {
    const response = await this.connection.agent.request(methods.agent.session.resume, {
      sessionId,
      cwd,
      mcpServers,
    });
    await this.drainUpdates();
    return response;
  }

  /** Resolves after the turn's final `session/update` has been handed to `onUpdate`. */
  async prompt(sessionId: string, blocks: readonly SharedContentBlock[]): Promise<PromptResponse> {
    const response = await this.connection.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt: toAcpBlocks(blocks),
    });
    await this.drainUpdates();
    return response;
  }

  /** `session/cancel` is a notification; the pending `prompt` resolves with `cancelled`. */
  cancel(sessionId: string): Promise<void> {
    return this.connection.agent.notify(methods.agent.session.cancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId });
  }

  setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse> {
    return this.connection.agent.request(
      methods.agent.session.setConfigOption,
      typeof value === 'boolean'
        ? { sessionId, configId, type: 'boolean', value }
        : { sessionId, configId, value },
    );
  }

  /**
   * Pre-`configOptions` model switch (`session/set_model`), still what Claude Code's adapter and
   * Grok implement. Not part of the stable v1 method table, so it goes out as a raw request.
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.connection.agent.request<unknown, { sessionId: string; modelId: string }>(LEGACY_SET_MODEL_METHOD, {
      sessionId,
      modelId,
    });
  }

  close(): Promise<void> {
    this.connection.close();
    this.wakeDrainWaiters();
    return this.connection.closed.catch(() => undefined);
  }

  /** Waits (bounded) until every `session/update` received so far has been dispatched. */
  private drainUpdates(timeoutMs = 2000): Promise<void> {
    const mark = this.updatesReceived;
    if (this.updatesDispatched >= mark) return Promise.resolve();
    return new Promise<void>((resolveDrain) => {
      const done = (): void => {
        clearTimeout(timer);
        this.drainWaiters = this.drainWaiters.filter((w) => w !== waiter);
        resolveDrain();
      };
      const timer = setTimeout(done, timeoutMs);
      const waiter = (): void => {
        if (this.updatesDispatched >= mark || this.connection.signal.aborted) done();
      };
      this.drainWaiters.push(waiter);
    });
  }

  private wakeDrainWaiters(): void {
    for (const waiter of [...this.drainWaiters]) waiter();
  }

  static isAuthRequired(error: unknown): boolean {
    return (
      (error instanceof RequestError && error.code === AUTH_REQUIRED_CODE) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === AUTH_REQUIRED_CODE)
    );
  }
}
