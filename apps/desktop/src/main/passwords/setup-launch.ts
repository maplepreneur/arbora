import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Platform } from '@arbora/shared';

export interface TerminalLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

const WALK_LIMIT = 8;

/** The checkout script, walking up from each start. A packaged app has none of these. */
export function findSetupScript(
  starts: readonly string[],
  platform: Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const name = platform === 'win32' ? 'setup-1password.ps1' : 'setup-1password.sh';
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < WALK_LIMIT; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = join(dir, 'scripts', name);
      if (exists(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** What to show or copy. The app itself never runs sudo. */
export function setupCommandText(platform: Platform, script: string | null): string {
  if (!script) return 'pnpm setup:1password --yes';
  if (platform === 'win32') return `powershell -NoProfile -ExecutionPolicy Bypass -File ${shellQuote(script)} --yes`;
  return `sh ${shellQuote(script)} --yes`;
}

/**
 * A terminal that can answer the Linux prompt before sudo. Null when none of the known
 * terminal programs is on PATH.
 */
export function setupTerminalLaunch(
  platform: Platform,
  script: string,
  resolve: (name: string) => string | undefined,
): TerminalLaunch | null {
  switch (platform) {
    case 'darwin':
      return {
        command: 'osascript',
        args: ['-e', `tell application "Terminal" to do script ${JSON.stringify(setupCommandText(platform, script))}`],
      };
    case 'win32':
      return {
        command: 'cmd.exe',
        args: [
          '/c',
          'start',
          '1Password setup',
          'powershell',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '--yes',
        ],
      };
    case 'linux': {
      const inner = `${setupCommandText(platform, script)}; printf '\\nPress Enter to close\\n'; read _`;
      const terminals: readonly { readonly name: string; readonly args: readonly string[] }[] = [
        { name: 'x-terminal-emulator', args: ['-e', 'sh', '-lc', inner] },
        { name: 'gnome-terminal', args: ['--', 'sh', '-lc', inner] },
        { name: 'konsole', args: ['-e', 'sh', '-lc', inner] },
        { name: 'xfce4-terminal', args: ['-e', 'sh', '-lc', inner] },
        { name: 'xterm', args: ['-e', 'sh', '-lc', inner] },
      ];
      for (const terminal of terminals) {
        const command = resolve(terminal.name);
        if (command) return { command, args: terminal.args };
      }
      return null;
    }
    default: {
      const unreachable: never = platform;
      return unreachable;
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
