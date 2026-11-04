import type { TerminalInfo } from '@arbora/shared';

/** A shell started as an interactive session, not a project command. */
const INTERACTIVE_SHELLS = new Set([
  'ash',
  'bash',
  'cmd',
  'dash',
  'elvish',
  'fish',
  'ksh',
  'nu',
  'powershell',
  'pwsh',
  'sh',
  'zsh',
]);

export function isInteractiveShell(commandLine: string): boolean {
  const name = commandLine
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase();
  return INTERACTIVE_SHELLS.has(name);
}

export interface CommandLine {
  readonly id: string;
  readonly command: string;
}

export interface ProjectTerminalGroups {
  /** Rows under TERMINALS: not an agent, and not a project command that is still running. */
  readonly terminals: readonly TerminalInfo[];
  /** The running terminal a command row should focus and close. The selected id wins; otherwise the latest. */
  readonly running: Readonly<Record<string, TerminalInfo>>;
}

/**
 * A terminal created by `grove.runCommand` stores that command line on `TerminalInfo.command`.
 * The same match covers a terminal whose command line equals a detected command. An interactive
 * shell (`bash`) never matches, even when a command string is the shell name.
 */
export function groupProjectTerminals(
  terminals: readonly TerminalInfo[],
  commands: readonly CommandLine[],
  options?: {
    readonly selectedId?: string | null;
    readonly agentIds?: ReadonlySet<string>;
  },
): ProjectTerminalGroups {
  const agentIds = options?.agentIds ?? new Set<string>();
  const selectedId = options?.selectedId ?? null;
  const byCommand = new Map<string, string>();
  for (const command of commands) byCommand.set(command.command.trim(), command.id);
  const running: Record<string, TerminalInfo> = {};
  const listed: TerminalInfo[] = [];
  for (const terminal of terminals) {
    if (agentIds.has(terminal.id)) continue;
    const commandId = matchingCommandId(terminal, byCommand);
    if (commandId !== undefined && terminal.exitCode === null) {
      const current = running[commandId];
      if (!current || current.id !== selectedId) running[commandId] = terminal;
      continue;
    }
    listed.push(terminal);
  }
  return { terminals: listed, running };
}

function matchingCommandId(terminal: TerminalInfo, byCommand: ReadonlyMap<string, string>): string | undefined {
  if (isInteractiveShell(terminal.command)) return undefined;
  return byCommand.get(terminal.command.trim());
}
