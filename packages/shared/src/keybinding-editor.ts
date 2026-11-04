import { CommandId, resolveKeybindingSpecs, type CommandDescriptor, type KeybindingOverrides } from './commands.js';
import { chordId, parseChord, type Chord, type KeybindingWhen } from './keybindings.js';
import type { Platform } from './platform.js';

/** Commands whose chord cannot be changed: `Esc` must always leave a mode. */
export const RESERVED_COMMANDS: ReadonlySet<string> = new Set([CommandId.exitMode]);

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ' ': 'space',
  '+': 'plus',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

/**
 * The settings string for a pressed chord. The platform's primary modifier is written as `mod`, so
 * a binding recorded on Linux (`Ctrl`) means `Cmd` when the same settings file is used on macOS.
 */
export function bindingFromChord(chord: Chord, platform: Platform): string {
  const parts: string[] = [];
  const primary = platform === 'darwin' ? chord.meta : chord.ctrl;
  if (primary) parts.push('mod');
  if (platform === 'darwin' ? chord.ctrl : chord.meta) parts.push(platform === 'darwin' ? 'ctrl' : 'meta');
  if (chord.alt) parts.push('alt');
  if (chord.shift) parts.push('shift');
  parts.push(NAMED_KEYS[chord.key] ?? chord.key);
  return parts.join('+');
}

/**
 * Whether two `when` scopes can claim the same keystroke. A `grove` binding is not a conflict with
 * an `always` one: it wins inside Grove and leaves the chord alone everywhere else, which is how
 * `Mod+1` selects a Grove row and still focuses a panel in the browser workspace.
 */
export function scopesOverlap(a: KeybindingWhen, b: KeybindingWhen): boolean {
  if (a === b) return true;
  const pair = new Set([a, b]);
  // Modes end on the way into Grove; its session pane is an agent thread.
  if (pair.has('grove')) return pair.has('agentPanel');
  if (pair.has('always')) return true;
  // Design mode is a mode; agent mode can be on while the agent panel has focus.
  return pair.has('modeActive') && (pair.has('design') || pair.has('agentPanel'));
}

/** Plain Escape, and Escape with modifiers, stay with exit-mode and dialogs. */
export function isReservedChord(chord: Chord): boolean {
  return chord.key === 'escape';
}

/** Super/Win chords are grabbed by Hyprland, GNOME and Windows before Arbora sees them. */
export function superChordWarning(chord: Chord, platform: Platform): string | null {
  if (platform === 'darwin' || !chord.meta) return null;
  return platform === 'win32'
    ? 'Windows reserves most Win chords, so this one may never reach Arbora.'
    : 'Linux desktops (Hyprland, GNOME, KDE) usually take Super chords first, so this one may never reach Arbora.';
}

export interface KeybindingRow {
  readonly commandId: string;
  readonly title: string;
  readonly category: string;
  readonly when: KeybindingWhen;
  /** Effective chord string, or null when unbound. */
  readonly binding: string | null;
  readonly defaultBinding: string | null;
  /** Where the effective binding comes from. */
  readonly source: 'default' | 'user' | 'project';
  readonly reserved: boolean;
  /** Other commands that answer the same chord in an overlapping scope. */
  readonly conflicts: readonly string[];
}

function layerBinding(
  command: CommandDescriptor,
  user: KeybindingOverrides,
  project: KeybindingOverrides | undefined,
): { binding: string | null; source: KeybindingRow['source'] } {
  if (project && Object.hasOwn(project, command.id)) return { binding: project[command.id] ?? null, source: 'project' };
  if (Object.hasOwn(user, command.id)) return { binding: user[command.id] ?? null, source: 'user' };
  return { binding: command.keybinding ?? null, source: 'default' };
}

function safeChordId(binding: string, platform: Platform): string | null {
  try {
    return chordId(parseChord(binding, platform));
  } catch {
    return null;
  }
}

/** One row per visible command for the shortcut editor, with conflicts already worked out. */
export function keybindingRows(
  commands: readonly CommandDescriptor[],
  user: KeybindingOverrides,
  project: KeybindingOverrides | undefined,
  platform: Platform,
): KeybindingRow[] {
  const specs = resolveKeybindingSpecs(commands, user, project);
  const byChord = new Map<string, { commandId: string; when: KeybindingWhen }[]>();
  for (const spec of specs) {
    const id = safeChordId(spec.binding, platform);
    if (id === null) continue;
    const list = byChord.get(id) ?? [];
    list.push({ commandId: spec.commandId, when: spec.when });
    byChord.set(id, list);
  }
  return commands
    .filter((command) => !command.hidden)
    .map((command) => {
      const { binding, source } = layerBinding(command, user, project);
      const when = command.when ?? 'always';
      const id = binding ? safeChordId(binding, platform) : null;
      const conflicts =
        id === null
          ? []
          : (byChord.get(id) ?? [])
              .filter((other) => other.commandId !== command.id && scopesOverlap(when, other.when))
              .map((other) => other.commandId);
      return {
        commandId: command.id,
        title: command.title,
        category: command.category ?? 'Other',
        when,
        binding,
        defaultBinding: command.keybinding ?? null,
        source,
        reserved: RESERVED_COMMANDS.has(command.id),
        conflicts,
      };
    });
}

/** Commands that would collide with `binding` if `commandId` used it. */
export function conflictsFor(
  commandId: string,
  binding: string,
  commands: readonly CommandDescriptor[],
  user: KeybindingOverrides,
  project: KeybindingOverrides | undefined,
  platform: Platform,
): string[] {
  const target = commands.find((c) => c.id === commandId);
  const id = safeChordId(binding, platform);
  if (!target || id === null) return [];
  const when = target.when ?? 'always';
  return resolveKeybindingSpecs(commands, user, project)
    .filter((spec) => spec.commandId !== commandId)
    .filter((spec) => safeChordId(spec.binding, platform) === id && scopesOverlap(when, spec.when))
    .map((spec) => spec.commandId);
}

/**
 * The user overrides after assigning `binding` to `commandId`. Commands that conflict lose their
 * chord (written as `null`) when `unbindConflicts` is set. Setting a command back to its default
 * removes its override.
 */
export function assignKeybinding(
  user: KeybindingOverrides,
  commands: readonly CommandDescriptor[],
  commandId: string,
  binding: string | null,
  unbind: readonly string[] = [],
): Record<string, string | null> {
  const command = commands.find((c) => c.id === commandId);
  const atDefault = (command?.keybinding ?? null) === binding;
  const next: Record<string, string | null> = Object.fromEntries(
    Object.entries(user).filter(([id]) => id !== commandId),
  );
  if (!atDefault) next[commandId] = binding;
  for (const id of unbind) next[id] = null;
  return next;
}
