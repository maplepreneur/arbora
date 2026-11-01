import type { Platform } from './platform.js';

/**
 * A normalised key chord. `key` is lowercase and layout-independent for letters and digits
 * (derived from `KeyboardEvent.code` when available), e.g. `k`, `p`, `escape`, `f5`, `/`.
 */
export interface Chord {
  readonly key: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** Shape shared by DOM `KeyboardEvent` (renderer) and Electron `Input` (main, after mapping). */
export interface KeyInput {
  readonly key: string;
  readonly code?: string | undefined;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export class ChordParseError extends Error {
  constructor(
    readonly source: string,
    reason: string,
  ) {
    super(`Invalid keybinding "${source}": ${reason}`);
    this.name = 'ChordParseError';
  }
}

const MODIFIER_TOKENS = new Set([
  'mod',
  'ctrl',
  'control',
  'cmd',
  'command',
  'meta',
  'super',
  'alt',
  'option',
  'opt',
  'shift',
]);

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  del: 'delete',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  comma: ',',
  period: '.',
  slash: '/',
};

function normaliseKeyName(raw: string): string {
  const lower = raw.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parses chords like `mod+k`, `mod+shift+p`, `ctrl+alt+t`, `escape`.
 * `mod` resolves to Meta (Cmd) on macOS and Control on Linux/Windows. Super/Meta is accepted for
 * explicit user overrides but never used by defaults (compositors claim it first on Linux).
 */
export function parseChord(source: string, platform: Platform): Chord {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new ChordParseError(source, 'empty');
  }
  // Split on "+" but allow a literal "+" key as the last token (e.g. "mod++").
  const tokens = trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  if (tokens.some((t) => t.trim().length === 0)) {
    throw new ChordParseError(source, 'empty token');
  }

  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;

  for (const [index, rawToken] of tokens.entries()) {
    const token = rawToken.trim().toLowerCase();
    const isLast = index === tokens.length - 1;
    if (!isLast) {
      if (!MODIFIER_TOKENS.has(token)) {
        throw new ChordParseError(source, `unknown modifier "${rawToken}"`);
      }
      switch (token) {
        case 'mod':
          if (platform === 'darwin') meta = true;
          else ctrl = true;
          break;
        case 'ctrl':
        case 'control':
          ctrl = true;
          break;
        case 'cmd':
        case 'command':
        case 'meta':
        case 'super':
          meta = true;
          break;
        case 'alt':
        case 'option':
        case 'opt':
          alt = true;
          break;
        case 'shift':
          shift = true;
          break;
      }
      continue;
    }
    if (MODIFIER_TOKENS.has(token)) {
      throw new ChordParseError(source, 'chord must end with a non-modifier key');
    }
    key = normaliseKeyName(rawToken.trim());
  }

  if (key === undefined) {
    throw new ChordParseError(source, 'missing key');
  }
  return { key, ctrl, meta, alt, shift };
}

const CODE_LETTER = /^Key([A-Z])$/;
const CODE_DIGIT = /^Digit([0-9])$/;

/** Normalises a key event into a chord. Uses `code` for letters/digits so Shift/Alt/layouts do not change the key. */
export function chordFromInput(input: KeyInput): Chord {
  let key: string | undefined;
  if (input.code) {
    const letter = CODE_LETTER.exec(input.code);
    const digit = CODE_DIGIT.exec(input.code);
    if (letter?.[1]) key = letter[1].toLowerCase();
    else if (digit?.[1]) key = digit[1];
    // Shift turns ` into ~, which would make `ctrl+shift+`` (new terminal) unmatchable.
    else if (input.code === 'Backquote') key = '`';
  }
  key ??= normaliseKeyName(input.key);
  return { key, ctrl: input.ctrl, meta: input.meta, alt: input.alt, shift: input.shift };
}

/** Canonical string used as a lookup key: modifiers in fixed order, then the key. */
export function chordId(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('ctrl');
  if (chord.meta) parts.push('meta');
  if (chord.alt) parts.push('alt');
  if (chord.shift) parts.push('shift');
  parts.push(chord.key);
  return parts.join('+');
}

export function isModifierKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === 'control' || lower === 'meta' || lower === 'alt' || lower === 'shift' || lower === 'os';
}

const DISPLAY_KEYS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
};

function displayKey(key: string): string {
  return DISPLAY_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
}

/** Human-readable label: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatChord(chord: Chord, platform: Platform): string {
  if (platform === 'darwin') {
    return `${chord.ctrl ? '⌃' : ''}${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.meta ? '⌘' : ''}${displayKey(chord.key)}`;
  }
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.meta) parts.push(platform === 'win32' ? 'Win' : 'Super');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(displayKey(chord.key));
  return parts.join('+');
}

/**
 * Plain `Ctrl+<key>` chords are shell line-editing keys (`Ctrl+K` kill line, `Ctrl+D` EOF). With
 * terminal passthrough enabled they go to the focused terminal instead of Arbora.
 */
export function isTerminalPassthroughChord(chord: Chord): boolean {
  return chord.ctrl && !chord.meta && !chord.alt && !chord.shift;
}

/** Context the dispatcher needs to decide whether a binding applies. */
export interface KeybindingContext {
  readonly modeActive: boolean;
  readonly terminalFocused: boolean;
  readonly terminalPassthrough: boolean;
  /** Design mode is showing. Optional so callers that predate it still match. */
  readonly designActive?: boolean;
  /** Inline text editing is active; the page must receive keys other than Escape. */
  readonly textEditing?: boolean;
  /** Focus is inside the agent panel (renderer only, so main never intercepts these chords). */
  readonly agentFocused?: boolean;
  /** The shortcut editor is recording; nothing is intercepted or dispatched. */
  readonly recording?: boolean;
}

/**
 * `always`: any context. `modeActive`: agent or design mode. `design`: design mode only.
 * `agentPanel`: focus is in the agent panel (CLI-style thread keys such as Shift+Tab).
 */
export type KeybindingWhen = 'always' | 'modeActive' | 'design' | 'agentPanel';

function bindingApplies(when: KeybindingWhen, context: KeybindingContext): boolean {
  switch (when) {
    case 'always':
      return true;
    case 'modeActive':
      return context.modeActive;
    case 'design':
      return context.designActive === true;
    case 'agentPanel':
      return context.agentFocused === true;
    default: {
      const unreachable: never = when;
      return unreachable;
    }
  }
}

export interface ResolvedKeybinding {
  readonly commandId: string;
  readonly source: string;
  readonly chord: Chord;
  readonly when: KeybindingWhen;
  /** Intercepted in main via `before-input-event` so the embedded page or terminal never sees it. */
  readonly intercept: boolean;
}

export interface KeybindingSpec {
  readonly commandId: string;
  readonly binding: string;
  readonly when: KeybindingWhen;
  readonly intercept: boolean;
}

export interface KeybindingTableBuildResult {
  readonly table: KeybindingTable;
  readonly errors: readonly ChordParseError[];
}

/** Chord-id -> bindings lookup table. Matching is a single Map lookup so it is cheap on every keystroke. */
export class KeybindingTable {
  private readonly byChord = new Map<string, ResolvedKeybinding[]>();

  constructor(readonly bindings: readonly ResolvedKeybinding[]) {
    for (const binding of bindings) {
      const id = chordId(binding.chord);
      const list = this.byChord.get(id);
      if (list) list.push(binding);
      else this.byChord.set(id, [binding]);
    }
  }

  static build(specs: readonly KeybindingSpec[], platform: Platform): KeybindingTableBuildResult {
    const bindings: ResolvedKeybinding[] = [];
    const errors: ChordParseError[] = [];
    for (const spec of specs) {
      try {
        bindings.push({
          commandId: spec.commandId,
          source: spec.binding,
          chord: parseChord(spec.binding, platform),
          when: spec.when,
          intercept: spec.intercept,
        });
      } catch (error) {
        if (error instanceof ChordParseError) errors.push(error);
        else throw error;
      }
    }
    return { table: new KeybindingTable(bindings), errors };
  }

  /** Returns the binding that should fire for this chord in this context, or undefined. */
  match(chord: Chord, context: KeybindingContext): ResolvedKeybinding | undefined {
    const candidates = this.byChord.get(chordId(chord));
    if (!candidates) return undefined;
    if (context.terminalFocused && context.terminalPassthrough && isTerminalPassthroughChord(chord)) {
      return undefined;
    }
    return candidates.find((binding) => bindingApplies(binding.when, context));
  }

  forCommand(commandId: string): ResolvedKeybinding | undefined {
    return this.bindings.find((b) => b.commandId === commandId);
  }
}
