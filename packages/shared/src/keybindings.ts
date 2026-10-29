import type { KeybindingOverrides } from './settings';

export type Platform = 'darwin' | 'linux' | 'win32';

export function toPlatform(value: string): Platform {
  return value === 'darwin' || value === 'win32' ? value : 'linux';
}

export interface Chord {
  /** Normalised `KeyboardEvent.key`, lower case (`"k"`, `"escape"`, `"arrowup"`, `" "`). */
  readonly key: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export class KeybindingParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid keybinding "${input}": ${reason}`);
    this.name = 'KeybindingParseError';
  }
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  plus: '+',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
};

type Modifier = 'ctrl' | 'meta' | 'alt' | 'shift' | 'mod';

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

/**
 * Parses chords such as `mod+k`, `mod+shift+p` or `escape`. `mod` is Cmd on macOS and Ctrl
 * everywhere else; Super is never implied because compositors and OSes claim it first.
 */
export function parseChord(input: string, platform: Platform): Chord {
  const tokens = input
    .trim()
    .toLowerCase()
    .split(/\s*\+\s*/u);
  if (tokens.some((token) => token === '')) {
    throw new KeybindingParseError(input, 'empty key segment');
  }
  const keyToken = tokens.at(-1);
  if (keyToken === undefined) {
    throw new KeybindingParseError(input, 'missing key');
  }
  const modifiers = { ctrl: false, meta: false, alt: false, shift: false };
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[token];
    if (modifier === undefined) {
      throw new KeybindingParseError(input, `unknown modifier "${token}"`);
    }
    const resolved = modifier === 'mod' ? (platform === 'darwin' ? 'meta' : 'ctrl') : modifier;
    if (modifiers[resolved]) {
      throw new KeybindingParseError(input, `duplicate modifier "${token}"`);
    }
    modifiers[resolved] = true;
  }
  if (MODIFIER_ALIASES[keyToken] !== undefined) {
    throw new KeybindingParseError(input, 'chord must end with a non-modifier key');
  }
  return { key: KEY_ALIASES[keyToken] ?? keyToken, ...modifiers };
}

const DISPLAY_KEYS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  delete: 'Del',
  backspace: 'Backspace',
  tab: 'Tab',
};

export function formatChord(chord: Chord, platform: Platform): string {
  const key = DISPLAY_KEYS[chord.key] ?? chord.key.toUpperCase();
  if (platform === 'darwin') {
    return `${chord.ctrl ? '⌃' : ''}${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.meta ? '⌘' : ''}${key}`;
  }
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push(platform === 'win32' ? 'Win' : 'Super');
  parts.push(key);
  return parts.join('+');
}

/** Shape shared by DOM `KeyboardEvent` and (after mapping) Electron's `before-input-event` input. */
export interface KeyInput {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function keyFromCode(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const letter = /^Key([A-Z])$/u.exec(code);
  if (letter?.[1] !== undefined) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/u.exec(code);
  if (digit?.[1] !== undefined) return digit[1];
  return undefined;
}

export function chordMatches(chord: Chord, input: KeyInput): boolean {
  if (
    chord.ctrl !== input.ctrlKey ||
    chord.meta !== input.metaKey ||
    chord.alt !== input.altKey ||
    chord.shift !== input.shiftKey
  ) {
    return false;
  }
  const key = input.key.toLowerCase();
  // Fall back to the physical key so chords still work with Alt/Option-modified characters and
  // non-Latin layouts, where `key` is not the Latin letter.
  return key === chord.key || keyFromCode(input.code) === chord.key;
}

export const CommandId = {
  agentMode: 'arbora.agentMode',
  designMode: 'arbora.designMode',
  exitMode: 'arbora.exitMode',
  commandPalette: 'arbora.commandPalette',
  quickOpen: 'arbora.quickOpen',
  openProject: 'arbora.openProject',
  toggleTheme: 'arbora.toggleTheme',
  useSystemTheme: 'arbora.useSystemTheme',
  openSettingsJson: 'arbora.openSettingsJson',
  toggleSidebar: 'arbora.toggleSidebar',
  toggleAgentPanel: 'arbora.toggleAgentPanel',
  toggleBottomPanel: 'arbora.toggleBottomPanel',
} as const;
export type CommandId = (typeof CommandId)[keyof typeof CommandId];

export type KeybindingWhen = 'always' | 'modeActive';

export interface KeybindingDefault {
  readonly command: CommandId;
  readonly chord: string;
  /**
   * Intercepted in main via `before-input-event` so it works when the embedded page or another
   * webContents has focus and wins over the page's own handlers.
   */
  readonly intercept: boolean;
  readonly when: KeybindingWhen;
}

export const defaultKeybindings: readonly KeybindingDefault[] = [
  { command: CommandId.agentMode, chord: 'mod+k', intercept: true, when: 'always' },
  { command: CommandId.designMode, chord: 'mod+d', intercept: true, when: 'always' },
  { command: CommandId.exitMode, chord: 'escape', intercept: true, when: 'modeActive' },
  { command: CommandId.commandPalette, chord: 'mod+shift+p', intercept: true, when: 'always' },
  { command: CommandId.quickOpen, chord: 'mod+p', intercept: false, when: 'always' },
  { command: CommandId.openProject, chord: 'mod+o', intercept: false, when: 'always' },
  { command: CommandId.toggleSidebar, chord: 'mod+b', intercept: false, when: 'always' },
  { command: CommandId.toggleBottomPanel, chord: 'mod+j', intercept: false, when: 'always' },
];

export interface CompiledKeybinding {
  readonly command: string;
  readonly source: string;
  readonly chord: Chord;
  readonly intercept: boolean;
  readonly when: KeybindingWhen;
}

export interface KeybindingProblem {
  readonly command: string;
  readonly chord: string;
  readonly message: string;
}

export interface CompiledKeybindings {
  readonly bindings: readonly CompiledKeybinding[];
  readonly problems: readonly KeybindingProblem[];
}

/**
 * Merges defaults with override layers (app settings, then project settings; later wins). An
 * override of `null` unbinds the command. Commands without a default can be bound by override
 * and are dispatched from the renderer.
 */
export function compileKeybindings(
  platform: Platform,
  defaults: readonly KeybindingDefault[],
  ...overrides: readonly KeybindingOverrides[]
): CompiledKeybindings {
  const effective = new Map<
    string,
    { chord: string | null; intercept: boolean; when: KeybindingWhen }
  >();
  for (const binding of defaults) {
    effective.set(binding.command, {
      chord: binding.chord,
      intercept: binding.intercept,
      when: binding.when,
    });
  }
  for (const layer of overrides) {
    for (const [command, chord] of Object.entries(layer)) {
      const existing = effective.get(command);
      effective.set(command, {
        chord,
        intercept: existing?.intercept ?? false,
        when: existing?.when ?? 'always',
      });
    }
  }

  const bindings: CompiledKeybinding[] = [];
  const problems: KeybindingProblem[] = [];
  for (const [command, { chord, intercept, when }] of effective) {
    if (chord === null) continue;
    try {
      bindings.push({
        command,
        source: chord,
        chord: parseChord(chord, platform),
        intercept,
        when,
      });
    } catch (error) {
      problems.push({
        command,
        chord,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { bindings, problems };
}

export interface KeyContext {
  readonly modeActive: boolean;
  readonly terminalFocused: boolean;
  readonly terminalPassthrough: boolean;
}

function isPlainCtrlChord(chord: Chord): boolean {
  return chord.ctrl && !chord.meta && !chord.alt && !chord.shift;
}

/**
 * Finds the binding for a key press. `stage` selects the dispatch path: `main` only considers
 * intercepted bindings (checked in `before-input-event`), `renderer` only the rest.
 */
export function findKeybinding(
  bindings: readonly CompiledKeybinding[],
  input: KeyInput,
  context: KeyContext,
  stage: 'main' | 'renderer',
): CompiledKeybinding | undefined {
  return bindings.find((binding) => {
    if (binding.intercept !== (stage === 'main')) return false;
    if (binding.when === 'modeActive' && !context.modeActive) return false;
    // Shells own Ctrl+K (kill line) and Ctrl+D (EOF); let plain Ctrl chords through to them.
    if (context.terminalFocused && context.terminalPassthrough && isPlainCtrlChord(binding.chord)) {
      return false;
    }
    return chordMatches(binding.chord, input);
  });
}
