import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Platform } from '@arbora/shared';

/**
 * Finds `command` on `env.PATH` (honouring `PATHEXT` on Windows), like `which`/`where`. Paths with
 * a directory component are returned as-is when they exist. Returns undefined when not found.
 */
export function findExecutable(
  command: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: Platform,
  exists: (path: string) => boolean = isFile,
): string | undefined {
  if (!command) return undefined;
  const hasDir = command.includes('/') || (platform === 'win32' && command.includes('\\'));
  if (hasDir) return isAbsolute(command) && exists(command) ? command : exists(command) ? command : undefined;
  const separator = platform === 'win32' ? ';' : ':';
  const path = env['PATH'] ?? env['Path'] ?? '';
  const extensions = platform === 'win32' ? ['', ...(env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
  for (const dir of path.split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

const MARKER = '__ARBORA_SHELL_ENV__';
const RESOLVE_TIMEOUT_MS = 5000;

/** Reads `PATH` from `env` output printed between two markers (rc files may print anything around it). */
export function parseShellEnvOutput(output: string): string | undefined {
  const start = output.indexOf(MARKER);
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (start === -1 || end === -1) return undefined;
  for (const line of output.slice(start + MARKER.length, end).split('\n')) {
    if (line.startsWith('PATH=')) return line.slice('PATH='.length).trim();
  }
  return undefined;
}

/** Login-shell entries first (that is the user's intended order), then anything only Arbora had. */
export function mergePath(loginPath: string | undefined, currentPath: string | undefined, sep = delimiter): string {
  const entries: string[] = [];
  for (const part of [...(loginPath ?? '').split(sep), ...(currentPath ?? '').split(sep)]) {
    if (part && !entries.includes(part)) entries.push(part);
  }
  return entries.join(sep);
}

/**
 * GUI launches (Dock, Finder, Hyprland binds, `.desktop` files) do not run the user's shell
 * profile, so `~/.local/bin`, nvm, volta, mise and Homebrew are missing from PATH. Resolve the
 * login shell's PATH once at startup and give it to every child process.
 */
export class ShellEnvironment {
  private path: string | undefined;
  readonly ready: Promise<void>;

  constructor(
    private readonly platform: Platform,
    private readonly base: NodeJS.ProcessEnv = process.env,
  ) {
    this.ready = platform === 'win32' ? Promise.resolve() : this.resolve();
  }

  /** Environment for child processes: the app's env with the merged PATH. */
  env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.base)) if (value !== undefined) env[key] = value;
    if (this.platform !== 'win32') env['PATH'] = mergePath(this.path, this.base['PATH']);
    return env;
  }

  private async resolve(): Promise<void> {
    const shell = this.base['SHELL'] || (this.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const output = await new Promise<string>((resolveOutput) => {
      let text = '';
      const child = spawn(shell, ['-ilc', `echo ${MARKER}; command env; echo ${MARKER}`], {
        env: { ...this.base, ARBORA_RESOLVING_ENVIRONMENT: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
      });
      const timer = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Already exited.
        }
      }, RESOLVE_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      child.on('error', () => {
        clearTimeout(timer);
        resolveOutput('');
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolveOutput(text);
      });
    });
    this.path = parseShellEnvOutput(output);
    if (!this.path) console.warn(`[terminal] could not read PATH from the login shell (${shell})`);
  }
}
