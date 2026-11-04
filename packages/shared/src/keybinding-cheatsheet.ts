import { resolveKeybindingSpecs, type CommandDescriptor, type KeybindingOverrides } from './commands.js';
import { formatChord, parseChord, type KeybindingWhen } from './keybindings.js';
import type { Platform } from './platform.js';

/** Shown beside a chord that does not apply in every workspace. `null` means global. */
const SCOPE_LABEL: Readonly<Record<KeybindingWhen, string | null>> = {
  always: null,
  modeActive: 'in a mode',
  design: 'in design mode',
  agentPanel: 'in the chat',
  grove: 'in Grove',
};

export interface KeybindingCheatRow {
  readonly commandId: string;
  readonly title: string;
  /** Platform label from `formatChord`, such as `Ctrl+K` on Linux. */
  readonly chord: string;
  /** `null` when the binding is global. Grove chords use `in Grove`. */
  readonly scope: string | null;
}

/**
 * One row per chord that currently fires a command, in command-table order. Unbound commands are
 * skipped. A command with an extra default chord gets a row for each. Built from the command list
 * and `resolveKeybindingSpecs`, so a new default shows up without a second handwritten list. User
 * and project overrides are the same layers the app uses.
 */
export function keybindingCheatRows(
  commands: readonly CommandDescriptor[],
  platform: Platform,
  ...overrideLayers: readonly (KeybindingOverrides | undefined)[]
): KeybindingCheatRow[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const rows: KeybindingCheatRow[] = [];
  for (const spec of resolveKeybindingSpecs(commands, ...overrideLayers)) {
    const command = byId.get(spec.commandId);
    if (!command) continue;
    let chord: string;
    try {
      chord = formatChord(parseChord(spec.binding, platform), platform);
    } catch {
      continue;
    }
    rows.push({
      commandId: command.id,
      title: command.title,
      chord,
      scope: SCOPE_LABEL[spec.when],
    });
  }
  return rows;
}

/** Case-insensitive match against the command title or the formatted chord. */
export function filterKeybindingCheatRows(rows: readonly KeybindingCheatRow[], query: string): KeybindingCheatRow[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...rows];
  return rows.filter((row) => row.title.toLowerCase().includes(needle) || row.chord.toLowerCase().includes(needle));
}
