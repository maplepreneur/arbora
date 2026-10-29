import { connect } from 'node:net';
import type { DevServerStatus, ProjectSettings, TerminalInfo, TerminalSize } from '@arbora/shared';
import { inferProjectDevCommand } from './dev-command.js';
import type { TerminalService } from './terminal-service.js';

const PORT_FREE_TIMEOUT_MS = 5000;

export interface DevServerOptions {
  readonly terminals: TerminalService;
  readonly projectPath: string;
  readonly settings: () => ProjectSettings;
  /** Persists a command inferred from `package.json` to `.arbora/project.json`. */
  readonly saveDevCommand: (command: string) => void;
}

export interface DevServerRunResult {
  readonly terminal: TerminalInfo | null;
  readonly error?: string;
}

function isListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolveListening) => {
    const socket = connect({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolveListening(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolveListening(false);
    });
    socket.once('error', () => resolveListening(false));
  });
}

/** Waits until nothing accepts connections on `port` (IPv4 or IPv6 loopback), up to a timeout. */
export async function waitForPortFree(port: number, timeoutMs = PORT_FREE_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = (await Promise.all([isListening(port, '127.0.0.1'), isListening(port, '::1')])).some(Boolean);
    if (!busy) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function portOf(url: string | null): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

/**
 * The project's dev server: one dedicated `dev` terminal running the `.arbora/project.json`
 * `devCommand` (inferred from `package.json` scripts and the lockfile on first run).
 * `restart` is what the Stage 5 `devserver_restart` tool calls.
 */
export class DevServer {
  private terminalId: string | null = null;
  private url: string | null = null;

  constructor(private readonly options: DevServerOptions) {}

  status(): DevServerStatus {
    const terminal = this.terminal();
    return {
      terminalId: terminal?.id ?? null,
      running: terminal !== undefined && terminal.exitCode === null && terminal.pid !== null,
      command: terminal?.command ?? this.options.settings().devCommand ?? null,
      url: this.url,
    };
  }

  /** Starts the dev server, or restarts it when it is already running. */
  async run(size: Partial<TerminalSize> = {}): Promise<DevServerRunResult> {
    let command = this.options.settings().devCommand;
    if (!command) {
      const inferred = inferProjectDevCommand(this.options.projectPath);
      if (!inferred) {
        return {
          terminal: null,
          error: 'No dev, start or serve script in package.json. Set "devCommand" in .arbora/project.json.',
        };
      }
      command = inferred;
      this.options.saveDevCommand(command);
    }
    const existing = this.terminal();
    if (existing && existing.command === command) {
      return { terminal: (await this.restart()) ?? null };
    }
    if (existing) await this.options.terminals.close(existing.id);
    this.url = null;
    const terminal = await this.options.terminals.create({ kind: 'dev', title: 'dev', command, ...size });
    this.terminalId = terminal.id;
    return { terminal };
  }

  /** Kills the dev server's process tree, waits for its port to be released, and runs it again. */
  async restart(): Promise<TerminalInfo | undefined> {
    const terminal = this.terminal();
    if (!terminal) return (await this.run()).terminal ?? undefined;
    const port = portOf(this.url);
    this.url = null;
    return this.options.terminals.restart(terminal.id, async () => {
      if (port !== null) await waitForPortFree(port);
    });
  }

  async stop(): Promise<void> {
    const terminal = this.terminal();
    if (terminal) await this.options.terminals.kill(terminal.id);
  }

  /** Called for every URL a terminal prints; the dev terminal's first URL is the server's. */
  noteUrl(terminalId: string, url: string): void {
    if (terminalId === this.terminalId) this.url ??= url;
  }

  private terminal(): TerminalInfo | undefined {
    return this.terminalId === null ? undefined : this.options.terminals.get(this.terminalId);
  }
}
