import type { CommandLookup, Platform } from '@arbora/shared';

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
export function spawnSpec(
  platform: Platform,
  command: string,
  args: readonly string[],
  lookup: CommandLookup,
): SpawnSpec {
  if (platform !== 'win32') return { file: command, args: [...args], shell: false };
  const resolved = lookup(command) ?? command;
  const shell = /\.(cmd|bat)$/i.test(resolved);
  return { file: resolved, args: [...args], shell };
}
