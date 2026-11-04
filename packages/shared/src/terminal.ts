import { z } from 'zod';
import type { Platform } from './platform.js';

export const terminalKindSchema = z.enum(['shell', 'dev', 'agent']);
export type TerminalKind = z.infer<typeof terminalKindSchema>;

export const terminalInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: terminalKindSchema,
  cwd: z.string(),
  /** The command line shown to the user (`bash`, `pnpm dev`, ...). */
  command: z.string(),
  pid: z.number().int().nullable(),
  /** `null` while running. */
  exitCode: z.number().int().nullable(),
  /** Agent terminals (Stage 3) are output-only. */
  readOnly: z.boolean(),
  /** For agent terminals: the title of the thread that ran the command. */
  thread: z.string().optional(),
  /**
   * Set when a process recorded before the last launch was adopted. `running` still has a pid.
   * `gone` means that pid was not alive, or it was a different process.
   */
  recovered: z.enum(['running', 'gone']).optional(),
});
export type TerminalInfo = z.infer<typeof terminalInfoSchema>;

export const terminalSizeSchema = z.object({
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(1000),
});
export type TerminalSize = z.infer<typeof terminalSizeSchema>;

export const devServerStatusSchema = z.object({
  terminalId: z.string().nullable(),
  running: z.boolean(),
  command: z.string().nullable(),
  url: z.string().nullable(),
});
export type DevServerStatus = z.infer<typeof devServerStatusSchema>;

/** Lines kept per terminal for URL detection and `devserver_logs` (Stage 5). */
export const TERMINAL_LINE_BUFFER = 2000;

// CSI (incl. private modes), OSC (BEL or ST terminated), single-char escapes, and other C0 controls
// except tab/newline.
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Removes ANSI escape sequences and control characters (keeps `\n`, `\r` and `\t`). */
/**
 * A short label for a command an agent ran: the program without its directory, and the inner
 * command of a shell wrapper (`/usr/bin/bash -lc 'pnpm test'` reads `pnpm test`).
 */
export function agentCommandLabel(commandLine: string): string {
  const text = commandLine.trim();
  const wrapper = /^(?:\S*[\\/])?(?:ba|z|da|fi)?sh(?:\.exe)?\s+-[a-z]*c\s+(.+)$/is.exec(text);
  if (wrapper?.[1]) {
    const inner = wrapper[1].trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(inner);
    return agentCommandLabel(quoted?.[2] ?? inner);
  }
  const program = /^(\S+)([\s\S]*)$/.exec(text);
  if (!program?.[1]) return text;
  return `${program[1].replace(/^.*[\\/]/, '')}${program[2] ?? ''}`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

const DEV_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w-]+(?:\.[\w-]+)*\.local)(?::\d{1,5})?(?:\/[^\s"'<>`]*)?(?=$|[\s"'<>`),;\]])/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * Local dev-server URLs in a line of (ANSI-stripped) terminal output, e.g. Vite's
 * `➜  Local:   http://localhost:5173/` or Next's `- Local: http://localhost:3000`. Wildcard hosts
 * (`0.0.0.0`, `[::]`) become `localhost`, which Chromium can load.
 */
export function findDevUrls(line: string): string[] {
  const found: string[] = [];
  for (const match of line.matchAll(DEV_URL_PATTERN)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost';
    const normalized = url.toString();
    if (!found.includes(normalized)) found.push(normalized);
  }
  return found;
}

/**
 * The last `capacity` lines of a stream, ANSI-stripped. Carriage returns overwrite the current line
 * like a terminal does, so spinners and progress bars keep only their final state.
 */
export class LineBuffer {
  private readonly lines: string[] = [];
  private partial = '';

  constructor(readonly capacity: number = TERMINAL_LINE_BUFFER) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive integer');
  }

  /** Appends raw output; returns the lines completed by this chunk. */
  push(chunk: string): string[] {
    const text = this.partial + stripAnsi(chunk);
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    const completed = parts.map(collapseCarriageReturns);
    for (const line of completed) this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    return completed;
  }

  /** The unfinished last line (a prompt, or output without a trailing newline). */
  get pending(): string {
    return collapseCarriageReturns(this.partial);
  }

  /** The last `count` lines including the pending one, oldest first. */
  tail(count: number = this.capacity): string[] {
    const all = this.pending ? [...this.lines, this.pending] : [...this.lines];
    return all.slice(-count);
  }

  clear(): void {
    this.lines.length = 0;
    this.partial = '';
  }
}

function collapseCarriageReturns(line: string): string {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  const index = trimmed.lastIndexOf('\r');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Keeps the most recent `capacity` characters of raw output so a reloaded renderer can redraw. */
export class ScrollbackBuffer {
  private chunks: string[] = [];
  private length = 0;

  constructor(readonly capacity: number) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.capacity && this.chunks.length > 1) {
      this.length -= this.chunks.shift()?.length ?? 0;
    }
    if (this.length > this.capacity) {
      const only = this.chunks[0] ?? '';
      this.chunks = [only.slice(only.length - this.capacity)];
      this.length = this.capacity;
    }
  }

  toString(): string {
    return this.chunks.join('');
  }
}

export interface ClipboardKey {
  readonly code: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/**
 * Terminal copy/paste chords. Off macOS, Ctrl+C copies only while text is selected (otherwise it
 * interrupts), and plain Ctrl+V pastes: Omarchy's Super+C/V reach non-terminal apps as Ctrl+C/V.
 */
export function terminalClipboardAction(
  key: ClipboardKey,
  platform: Platform,
  hasSelection: boolean,
): 'copy' | 'paste' | null {
  if (key.alt) return null;
  if (platform === 'darwin') {
    if (!key.meta || key.ctrl) return null;
    if (key.code === 'KeyC') return 'copy';
    if (key.code === 'KeyV') return 'paste';
    return null;
  }
  if (key.meta) return null;
  if (key.ctrl && key.code === 'KeyC' && (key.shift || hasSelection)) return 'copy';
  if (key.ctrl && !key.shift && key.code === 'Insert') return 'copy';
  if (key.ctrl && key.code === 'KeyV') return 'paste';
  if (key.shift && !key.ctrl && key.code === 'Insert') return 'paste';
  return null;
}

export interface ShellSpec {
  readonly file: string;
  readonly args: readonly string[];
}

/**
 * The user's shell: `$SHELL` on macOS and Linux (login shell on macOS, where GUI apps start with a
 * bare PATH), and `pwsh`, then Windows PowerShell, then `cmd` on Windows.
 */
export function detectShell(
  platform: Platform,
  env: Readonly<Record<string, string | undefined>>,
  exists: (path: string) => boolean,
  override?: string,
): ShellSpec {
  if (platform === 'win32') {
    if (override) return { file: override, args: [] };
    const root = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows';
    const candidates = [
      ...(env['PATH'] ?? env['Path'] ?? '')
        .split(';')
        .filter(Boolean)
        .map((dir) => `${dir.replace(/\\$/, '')}\\pwsh.exe`),
      `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ];
    const powershell = candidates.find(exists);
    if (powershell) return { file: powershell, args: ['-NoLogo'] };
    return { file: env['ComSpec'] ?? env['COMSPEC'] ?? `${root}\\System32\\cmd.exe`, args: [] };
  }
  const loginArgs = platform === 'darwin' ? ['-l'] : [];
  const candidates = [override, env['SHELL'], platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return { file: candidate, args: loginArgs };
  }
  return { file: '/bin/sh', args: loginArgs };
}

/** Arguments that make `shell` run one command line and exit. */
export function shellCommandArgs(platform: Platform, shell: string, command: string): string[] {
  if (platform === 'win32') {
    const name = shell.toLowerCase().split('\\').pop() ?? '';
    if (name === 'cmd.exe' || name === 'cmd') return ['/d', '/s', '/c', command];
    // `-Command` exits 1 for any failed native command; pass the real exit code through.
    return ['-NoLogo', '-Command', `$global:LASTEXITCODE = 0; ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE }`];
  }
  return [platform === 'darwin' ? '-lc' : '-c', command];
}

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/** Scripts that start a dev server, in order of preference. */
export const DEV_SCRIPTS: readonly string[] = ['dev', 'start', 'serve'];

export interface DevCommandInput {
  readonly scripts: Readonly<Record<string, unknown>> | undefined;
  /** The `packageManager` field of `package.json` (`pnpm@10.0.0`). */
  readonly packageManagerField?: string | undefined;
  /** Lockfile names found in the project folder or its nearest ancestor that has one. */
  readonly lockfiles: readonly string[];
}

export function detectPackageManager(
  input: Pick<DevCommandInput, 'packageManagerField' | 'lockfiles'>,
): PackageManager {
  const declared = input.packageManagerField?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared;
  for (const [file, manager] of LOCKFILES) if (input.lockfiles.includes(file)) return manager;
  return 'npm';
}

export function lockfileNames(): string[] {
  return LOCKFILES.map(([file]) => file);
}

/** `pnpm dev`, `npm run dev`, `yarn start`, ... from `package.json` scripts, or `null` if none fits. */
export function inferDevCommand(input: DevCommandInput): string | null {
  const script = DEV_SCRIPTS.find((name) => typeof input.scripts?.[name] === 'string');
  if (!script) return null;
  const manager = detectPackageManager(input);
  switch (manager) {
    case 'pnpm':
      return `pnpm ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    case 'bun':
      return `bun run ${script}`;
    case 'npm':
      return script === 'start' ? 'npm start' : `npm run ${script}`;
    default: {
      const unreachable: never = manager;
      throw new Error(`Unknown package manager ${String(unreachable)}`);
    }
  }
}
