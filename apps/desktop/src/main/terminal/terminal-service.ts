import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import {
  detectShell,
  findDevUrls,
  LineBuffer,
  ScrollbackBuffer,
  shellCommandArgs,
  TERMINAL_LINE_BUFFER,
  type Platform,
  type TerminalInfo,
  type TerminalKind,
  type TerminalSize,
} from '@arbora/shared';
import { killProcessTree } from './process-tree.js';
import { findExecutable } from './shell-env.js';

const SCROLLBACK_CHARS = 256 * 1024;
const DATA_FLUSH_MS = 8;
/** A URL on an unfinished line is only trusted once output pauses (it may still be arriving). */
const PENDING_URL_DELAY_MS = 250;
const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };

export interface TerminalServiceEvents {
  data(id: string, data: string): void;
  changed(terminals: TerminalInfo[]): void;
  /** A local dev-server URL this terminal had not printed since it (re)started. */
  url(id: string, url: string): void;
}

export interface TerminalServiceOptions {
  readonly platform: Platform;
  readonly cwd: string;
  /** Child-process environment (login-shell PATH applied); awaited before the first spawn. */
  readonly environment: () => Promise<Record<string, string>>;
  /** Shell override from settings. */
  readonly shell: () => string | undefined;
  readonly events: TerminalServiceEvents;
}

export interface CreateTerminalOptions extends Partial<TerminalSize> {
  readonly kind?: TerminalKind;
  readonly title?: string;
  /** Run this command line through the shell instead of an interactive shell. */
  readonly command?: string;
  /**
   * When given, `command` is executed directly with these arguments (no shell), as ACP's
   * `terminal/create` specifies. The PATH used for lookup is still the login-shell one.
   */
  readonly args?: readonly string[];
  /** Working directory; defaults to the project root. */
  readonly cwd?: string;
  /** Extra environment variables merged over the login-shell environment. */
  readonly env?: Readonly<Record<string, string>>;
  readonly readOnly?: boolean;
  /** Receives raw process output from the first byte (registered before the process starts). */
  readonly onData?: (data: string) => void;
}

export interface TerminalExit {
  readonly exitCode: number | null;
  readonly signal: number | null;
}

interface TerminalRecord {
  info: TerminalInfo;
  readonly command: string | undefined;
  readonly args: readonly string[] | undefined;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>> | undefined;
  readonly listeners: Set<(data: string) => void>;
  lastExit: TerminalExit | null;
  pty: IPty | null;
  size: TerminalSize;
  readonly lines: LineBuffer;
  readonly scrollback: ScrollbackBuffer;
  readonly urls: Set<string>;
  pending: string;
  flushTimer: NodeJS.Timeout | undefined;
  urlTimer: NodeJS.Timeout | undefined;
  exited: Promise<void>;
  /** Exits caused by `restart` are not reported as the terminal's final exit. */
  generation: number;
}

/**
 * Terminals for one project, on `node-pty`. Transport-neutral: the renderer's Terminal panel,
 * ACP agent terminals (Stage 3) and the MCP dev-server tools (Stage 5) all go through this API.
 */
export class TerminalService {
  private readonly terminals = new Map<string, TerminalRecord>();
  private counter = 0;
  private disposed = false;

  constructor(private readonly options: TerminalServiceOptions) {}

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((t) => t.info);
  }

  get(id: string): TerminalInfo | undefined {
    return this.terminals.get(id)?.info;
  }

  async create(request: CreateTerminalOptions = {}): Promise<TerminalInfo> {
    if (this.disposed) throw new Error('Terminals are closed');
    const kind = request.kind ?? 'shell';
    const shell = this.shell();
    const command = request.command;
    const id = randomUUID();
    const commandLine = command ? [command, ...(request.args ?? [])].join(' ') : undefined;
    const title = request.title ?? (commandLine ? commandLine : basename(shell.file).replace(/\.exe$/i, ''));
    const cwd = request.cwd ?? this.options.cwd;
    const record: TerminalRecord = {
      info: {
        id,
        title: kind === 'shell' && !request.title ? this.nextShellTitle(title) : title,
        kind,
        cwd,
        command: commandLine ?? basename(shell.file),
        pid: null,
        exitCode: null,
        readOnly: request.readOnly ?? kind === 'agent',
      },
      command,
      args: request.args,
      cwd,
      env: request.env,
      listeners: new Set(request.onData ? [request.onData] : []),
      lastExit: null,
      pty: null,
      size: { cols: request.cols ?? DEFAULT_SIZE.cols, rows: request.rows ?? DEFAULT_SIZE.rows },
      lines: new LineBuffer(TERMINAL_LINE_BUFFER),
      scrollback: new ScrollbackBuffer(SCROLLBACK_CHARS),
      urls: new Set(),
      pending: '',
      flushTimer: undefined,
      urlTimer: undefined,
      exited: Promise.resolve(),
      generation: 0,
    };
    this.terminals.set(id, record);
    await this.start(record);
    this.emitChanged();
    return record.info;
  }

  write(id: string, data: string): void {
    const record = this.terminals.get(id);
    if (!record?.pty || record.info.readOnly) return;
    record.pty.write(data);
  }

  resize(id: string, size: TerminalSize): void {
    const record = this.terminals.get(id);
    if (!record) return;
    if (record.size.cols === size.cols && record.size.rows === size.rows) return;
    record.size = size;
    try {
      record.pty?.resize(size.cols, size.rows);
    } catch {
      // The pty closed between the exit and this resize.
    }
  }

  rename(id: string, title: string): void {
    const record = this.terminals.get(id);
    if (!record) return;
    record.info = { ...record.info, title };
    this.emitChanged();
  }

  lines(id: string, count?: number): string[] {
    return this.terminals.get(id)?.lines.tail(count) ?? [];
  }

  /**
   * Recent raw output. Pending output is flushed first, so `data` events sent after this returns
   * carry only newer output (IPC replies and events share one ordered pipe).
   */
  scrollback(id: string): string {
    const record = this.terminals.get(id);
    if (!record) return '';
    this.flush(record);
    return record.scrollback.toString();
  }

  /**
   * Raw output as it arrives (unlike the batched `data` event), for consumers in main such as ACP
   * agent terminals. Returns the unsubscribe function.
   */
  subscribe(id: string, listener: (data: string) => void): () => void {
    const record = this.terminals.get(id);
    if (!record) return () => undefined;
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  /** Resolves with the exit of the current process, or immediately if it already exited. */
  async waitForExit(id: string): Promise<TerminalExit> {
    const record = this.terminals.get(id);
    if (!record) throw new Error(`Unknown terminal ${id}`);
    if (record.lastExit && !record.pty) return record.lastExit;
    await record.exited;
    return record.lastExit ?? { exitCode: null, signal: null };
  }

  /** Kills the process tree and waits for the pty to report the exit. */
  async kill(id: string): Promise<void> {
    const record = this.terminals.get(id);
    if (!record) return;
    this.killRecord(record);
    await record.exited;
  }

  /**
   * Kills the process and starts the same command (or shell) again in the same terminal.
   * `beforeStart` runs between the exit and the new spawn (e.g. waiting for the port to free up).
   */
  async restart(id: string, beforeStart?: () => Promise<void>): Promise<TerminalInfo | undefined> {
    const record = this.terminals.get(id);
    if (!record) return undefined;
    record.generation++;
    this.killRecord(record);
    await record.exited;
    await beforeStart?.();
    if (this.disposed || !this.terminals.has(id)) return undefined;
    record.urls.clear();
    this.output(record, '\r\n\u001b[2m— restarting —\u001b[0m\r\n');
    await this.start(record);
    this.emitChanged();
    return record.info;
  }

  async close(id: string): Promise<void> {
    const record = this.terminals.get(id);
    if (!record) return;
    this.terminals.delete(id);
    this.killRecord(record);
    this.flush(record);
    clearTimeout(record.urlTimer);
    this.emitChanged();
    await record.exited;
  }

  dispose(): void {
    this.disposed = true;
    for (const record of this.terminals.values()) {
      clearTimeout(record.flushTimer);
      clearTimeout(record.urlTimer);
      this.killRecord(record);
    }
    this.terminals.clear();
  }

  private shell(): { file: string; args: readonly string[] } {
    return detectShell(this.options.platform, process.env, existsSync, this.options.shell());
  }

  private nextShellTitle(base: string): string {
    this.counter++;
    return this.counter === 1 ? base : `${base} ${this.counter}`;
  }

  private async start(record: TerminalRecord): Promise<void> {
    const env = await this.options.environment();
    if (this.disposed || !this.terminals.has(record.info.id)) return;
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'arbora',
      ARBORA: '1',
      ARBORA_PROJECT: this.options.cwd,
      ...record.env,
    });
    const shell = this.shell();
    let file: string;
    let args: string[];
    if (record.command !== undefined && record.args !== undefined) {
      // Direct exec (ACP terminals). node-pty does not search PATH itself; use the login-shell PATH.
      file = findExecutable(record.command, env, this.options.platform) ?? record.command;
      args = [...record.args];
    } else if (record.command !== undefined) {
      file = shell.file;
      args = shellCommandArgs(this.options.platform, shell.file, record.command);
    } else {
      file = shell.file;
      args = [...shell.args];
    }
    let pty: IPty;
    try {
      pty = spawnPty(file, args, {
        name: 'xterm-256color',
        cols: record.size.cols,
        rows: record.size.rows,
        cwd: record.cwd,
        env,
        ...(this.options.platform === 'win32' ? { useConpty: true } : {}),
      });
    } catch (error) {
      this.output(record, `\r\n\u001b[31mCould not start ${file}: ${(error as Error).message}\u001b[0m\r\n`);
      record.info = { ...record.info, pid: null, exitCode: -1 };
      record.lastExit = { exitCode: -1, signal: null };
      return;
    }
    record.pty = pty;
    record.lastExit = null;
    record.info = { ...record.info, pid: pty.pid, exitCode: null };
    const generation = record.generation;
    record.exited = new Promise<void>((resolveExit) => {
      pty.onExit(({ exitCode, signal }) => {
        if (record.pty === pty) record.pty = null;
        this.flush(record);
        // node-pty reports "no signal" as 0 on POSIX and undefined on Windows.
        record.lastExit = { exitCode, signal: signal ? signal : null };
        if (generation === record.generation && this.terminals.has(record.info.id)) {
          record.info = { ...record.info, pid: null, exitCode };
          // Shown in the tab only: subscribers (ACP `terminal/output`) get the process output alone.
          this.output(record, `\r\n\u001b[2m[process exited with code ${exitCode}]\u001b[0m\r\n`, { notify: false });
          this.emitChanged();
        }
        resolveExit();
      });
    });
    pty.onData((data) => this.output(record, data));
  }

  private killRecord(record: TerminalRecord): void {
    const pty = record.pty;
    if (!pty) return;
    killProcessTree(pty.pid, this.options.platform);
    try {
      pty.kill();
    } catch {
      // Already exited.
    }
  }

  private output(record: TerminalRecord, data: string, { notify = true } = {}): void {
    if (notify) for (const listener of record.listeners) listener(data);
    record.scrollback.push(data);
    for (const line of record.lines.push(data)) this.detectUrls(record, line);
    clearTimeout(record.urlTimer);
    if (record.lines.pending) {
      record.urlTimer = setTimeout(() => this.detectUrls(record, record.lines.pending), PENDING_URL_DELAY_MS);
    }
    record.pending += data;
    record.flushTimer ??= setTimeout(() => this.flush(record), DATA_FLUSH_MS);
  }

  private flush(record: TerminalRecord): void {
    clearTimeout(record.flushTimer);
    record.flushTimer = undefined;
    if (!record.pending) return;
    const data = record.pending;
    record.pending = '';
    this.options.events.data(record.info.id, data);
  }

  private detectUrls(record: TerminalRecord, line: string): void {
    for (const url of findDevUrls(line)) {
      if (record.urls.has(url)) continue;
      record.urls.add(url);
      this.options.events.url(record.info.id, url);
    }
  }

  private emitChanged(): void {
    if (!this.disposed) this.options.events.changed(this.list());
  }
}
