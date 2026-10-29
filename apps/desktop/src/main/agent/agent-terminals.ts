import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  ReleaseTerminalRequest,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk';
import { PathScopeError, resolveInsideRoot, TerminalOutputBuffer, type AcpSessionHandlers } from '@arbora/acp-client';
import type { TerminalService } from '../terminal/terminal-service.js';

interface AgentTerminal {
  readonly buffer: TerminalOutputBuffer;
  readonly unsubscribe: () => void;
  exit: { exitCode: number | null; signal: string | null } | null;
}

const SIGNAL_NAMES: Readonly<Record<number, string>> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM',
};

/**
 * ACP `terminal/*` methods for one thread, backed by the project's `TerminalService`. Each agent
 * command shows up as a read-only `agent` tab; output is buffered ANSI-stripped and capped at the
 * agent's `outputByteLimit`. Released terminals stay visible until the user closes the tab.
 */
export class AgentTerminals implements Pick<AcpSessionHandlers, 'terminal'> {
  private readonly active = new Map<string, AgentTerminal>();

  constructor(
    private readonly terminals: TerminalService,
    private readonly projectPath: string,
    private readonly threadTitle: () => string,
  ) {}

  readonly terminal = {
    create: (request: CreateTerminalRequest): Promise<CreateTerminalResponse> => this.create(request),
    output: (request: TerminalOutputRequest): Promise<TerminalOutputResponse> => this.output(request),
    waitForExit: (request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> =>
      this.waitForExit(request),
    kill: (request: KillTerminalRequest): Promise<void> => this.terminals.kill(request.terminalId),
    release: (request: ReleaseTerminalRequest): Promise<void> => this.release(request),
  };

  /** Kills every terminal this thread still owns (session ended). */
  async dispose(): Promise<void> {
    const ids = [...this.active.keys()];
    for (const id of ids) {
      this.active.get(id)?.unsubscribe();
      this.active.delete(id);
      await this.terminals.kill(id);
    }
  }

  private async create(request: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    let cwd: string | undefined;
    if (request.cwd) {
      try {
        cwd = resolveInsideRoot(this.projectPath, request.cwd);
      } catch (error) {
        if (error instanceof PathScopeError) {
          throw new Error(`cwd must be inside the project: ${request.cwd}`, { cause: error });
        }
        throw error;
      }
    }
    const env: Record<string, string> = {};
    for (const variable of request.env ?? []) env[variable.name] = variable.value;
    const buffer = new TerminalOutputBuffer(request.outputByteLimit ?? null);
    const info = await this.terminals.create({
      kind: 'agent',
      title: `${this.threadTitle()}: ${[request.command, ...(request.args ?? [])].join(' ').slice(0, 60)}`,
      command: request.command,
      args: request.args ?? [],
      ...(cwd !== undefined ? { cwd } : {}),
      env,
      readOnly: true,
    });
    const record: AgentTerminal = {
      buffer,
      unsubscribe: this.terminals.subscribe(info.id, (data) => buffer.push(data)),
      exit: null,
    };
    // Output that arrived before `subscribe` is in the scrollback.
    buffer.push(this.terminals.scrollback(info.id));
    this.active.set(info.id, record);
    void this.terminals.waitForExit(info.id).then((exit) => {
      record.exit = { exitCode: exit.exitCode, signal: exit.signal === null ? null : (SIGNAL_NAMES[exit.signal] ?? String(exit.signal)) };
    });
    return { terminalId: info.id };
  }

  private output(request: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const record = this.require(request.terminalId);
    const snapshot = record.buffer.snapshot();
    return Promise.resolve({
      output: snapshot.output,
      truncated: snapshot.truncated,
      exitStatus: record.exit ? { exitCode: record.exit.exitCode, signal: record.exit.signal } : null,
    });
  }

  private async waitForExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const record = this.require(request.terminalId);
    if (record.exit) return record.exit;
    const exit = await this.terminals.waitForExit(request.terminalId);
    const signal = exit.signal === null ? null : (SIGNAL_NAMES[exit.signal] ?? String(exit.signal));
    record.exit = { exitCode: exit.exitCode, signal };
    return record.exit;
  }

  private async release(request: ReleaseTerminalRequest): Promise<void> {
    const record = this.active.get(request.terminalId);
    if (!record) return;
    this.active.delete(request.terminalId);
    record.unsubscribe();
    // The protocol says release kills a still-running command; the tab stays for the user.
    if (!record.exit) await this.terminals.kill(request.terminalId);
  }

  private require(terminalId: string): AgentTerminal {
    const record = this.active.get(terminalId);
    if (!record) throw new Error(`Unknown terminal ${terminalId}`);
    return record;
  }
}
