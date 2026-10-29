import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';
import type { Platform } from '@arbora/shared';
import type { CommandLookup } from './registry.js';

export interface SpawnSpec {
  readonly file: string;
  readonly args: string[];
  readonly shell: boolean;
}

/**
 * How to spawn an agent command. On Windows, `npx`/`npm` are `.cmd` shims that Node will not
 * spawn without a shell (CVE-2024-27980), so they go through `cmd.exe`; real executables run
 * directly.
 */
export function spawnSpec(platform: Platform, command: string, args: readonly string[], lookup: CommandLookup): SpawnSpec {
  if (platform !== 'win32') return { file: command, args: [...args], shell: false };
  const resolved = lookup(command) ?? command;
  const shell = /\.(cmd|bat)$/i.test(resolved);
  return { file: resolved, args: [...args], shell };
}

const MAX_RESTART_DELAY_MS = 30_000;

/** Delay before the n-th automatic restart after a crash (0 for the first start). */
export function restartDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(1000 * 2 ** (attempt - 1), MAX_RESTART_DELAY_MS);
}

export interface AgentProcessOptions {
  readonly platform: Platform;
  readonly command: string;
  readonly args: readonly string[];
  /** Full child environment (the caller merges the login-shell PATH and the agent's env). */
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly lookup: CommandLookup;
  onStderr(line: string): void;
}

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * One spawned ACP agent: stdin/stdout carry newline-delimited JSON-RPC, stderr is forwarded line
 * by line to the log viewer. Restarting is the owner's job (see `restartDelay`).
 */
export class AgentProcess {
  readonly stream: Stream;
  readonly exited: Promise<ProcessExit>;
  readonly pid: number | undefined;
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private spawnError: Error | null = null;

  constructor(options: AgentProcessOptions) {
    const spec = spawnSpec(options.platform, options.command, options.args, options.lookup);
    this.child = spawn(spec.file, spec.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spec.shell,
      windowsHide: true,
    });
    this.pid = this.child.pid;
    let partial = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) options.onStderr(line);
    });
    this.child.stdin.on('error', () => {
      // EPIPE after the agent exited; the exit handler reports it.
    });
    this.exited = new Promise<ProcessExit>((resolveExit) => {
      this.child.on('error', (error) => {
        this.spawnError = error;
        options.onStderr(`Could not start ${spec.file}: ${error.message}`);
      });
      this.child.on('close', (code, signal) => {
        if (partial.trim()) options.onStderr(partial);
        resolveExit({ code, signal });
      });
    });
    // Node's web-stream adapters give the SDK the byte streams it expects.
    this.stream = ndJsonStream(
      Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
    );
  }

  /** The spawn failure, when the executable could not be started at all. */
  get startError(): Error | null {
    return this.spawnError;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      this.child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}
