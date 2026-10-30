import { z } from 'zod';
import { frameworkInfoSchema } from './inspector.js';

/**
 * Design mode (Stage 6). Ops are the ordered change list the page applies live and main persists.
 * `before` / `after` are what the change list shows. Style ops also keep the previous inline
 * declaration so revert can put the element back without a reload.
 */

export const stylingApproachSchema = z.enum(['tailwind', 'css-modules', 'styled-components', 'emotion', 'plain-css']);
export type StylingApproach = z.infer<typeof stylingApproachSchema>;

export const DESIGN_INSTRUCTION =
  'implement these changes in source so the app matches the after screenshot; do not add inline styles; verify in the browser';

/** Computed properties the properties panel reads and writes. One style op per property. */
export const DESIGN_STYLE_PROPS = [
  'display',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
  'background-color',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'box-shadow',
  'opacity',
  'visibility',
] as const;

export type DesignStyleProp = (typeof DESIGN_STYLE_PROPS)[number];

const designTargetSchema = z.object({
  ref: z.string().max(20),
  selector: z.string().max(2000),
  /** Nearest component first. */
  componentChain: z.array(z.string().max(200)).max(30),
  /** Framework-reported file, resolved to a project path on save. */
  sourceFile: z.string().max(2000).nullable(),
  sourceLine: z.number().int().nullable(),
});
export type DesignTarget = z.infer<typeof designTargetSchema>;

const opBase = {
  id: z.string().max(40),
  target: designTargetSchema,
  stale: z.boolean(),
  /** Switched off in the Changes list: kept in the list, but not on the page and not sent. */
  muted: z.boolean().optional(),
};

export const designInsertKindSchema = z.enum(['div', 'text', 'image', 'button', 'duplicate']);
export type DesignInsertKind = z.infer<typeof designInsertKindSchema>;

const placeSchema = z.object({
  parentRef: z.string().max(20),
  index: z.number().int().min(0).max(10_000),
});

export const designOpSchema = z.discriminatedUnion('kind', [
  z.object({
    ...opBase,
    kind: z.literal('style'),
    property: z.string().max(80),
    /** Computed value before the edit (what the panel was showing). */
    before: z.string().max(500),
    /** The value the user typed, also written as an inline style. */
    after: z.string().max(500),
    computedAfter: z.string().max(500),
    /** Previous inline value, so revert does not bake the computed value into the element. */
    inlineBefore: z.string().max(500),
    inlinePriority: z.enum(['', 'important']),
  }),
  z.object({
    ...opBase,
    kind: z.literal('text'),
    before: z.string().max(20_000),
    after: z.string().max(20_000),
  }),
  z.object({
    ...opBase,
    kind: z.literal('attr'),
    name: z.string().max(80),
    before: z.string().max(2000).nullable(),
    after: z.string().max(2000).nullable(),
  }),
  z.object({
    ...opBase,
    kind: z.literal('move'),
    before: placeSchema,
    after: placeSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal('insert'),
    elementKind: designInsertKindSchema,
    parentRef: z.string().max(20),
    index: z.number().int().min(0).max(10_000),
    html: z.string().max(20_000).nullable(),
  }),
  z.object({
    ...opBase,
    kind: z.literal('delete'),
    parentRef: z.string().max(20),
    index: z.number().int().min(0).max(10_000),
    html: z.string().max(20_000),
  }),
]);
export type DesignOp = z.infer<typeof designOpSchema>;

export const designSelectionSchema = z.object({
  ref: z.string().max(20),
  selector: z.string().max(2000),
  tag: z.string().max(100),
  text: z.string().max(4000),
  componentChain: z.array(z.string().max(200)).max(30),
  sourceFile: z.string().max(2000).nullable(),
  sourceLine: z.number().int().nullable(),
  styles: z.record(z.string(), z.string().max(500)),
  /** False when the element or an ancestor has a CSS transform; spacing handles stay hidden. */
  handles: z.boolean(),
  /** Nearest parent first, up to `<body>`; `selectAncestor` with depth `i + 1` selects entry `i`. */
  ancestors: z.array(z.object({ label: z.string().max(200) })).max(12),
});
export type DesignSelection = z.infer<typeof designSelectionSchema>;

export const designStateSchema = z.object({
  ops: z.array(designOpSchema).max(500),
  cursor: z.number().int().min(0),
  textEditing: z.boolean(),
  selectionCount: z.number().int().min(0).max(50),
  selection: designSelectionSchema.nullable(),
  /** Move, insert or delete is in the applied list; a re-render may reset the preview. */
  structureWarning: z.boolean(),
  framework: frameworkInfoSchema,
  /** The page is temporarily showing the original, without the applied ops. */
  showingOriginal: z.boolean(),
});
export type DesignState = z.infer<typeof designStateSchema>;

export const designCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('redo') }),
  z.object({ type: z.literal('deselect') }),
  z.object({ type: z.literal('endText') }),
  z.object({ type: z.literal('style'), property: z.string().min(1).max(80), value: z.string().max(500) }),
  z.object({ type: z.literal('text'), value: z.string().max(20_000) }),
  z.object({ type: z.literal('duplicate') }),
  z.object({ type: z.literal('delete') }),
  z.object({ type: z.literal('insert'), elementKind: z.enum(['div', 'text', 'image', 'button']) }),
  z.object({ type: z.literal('selectAncestor'), depth: z.number().int().min(1).max(12) }),
  /** Before/after compare: `on` shows the page without the applied ops, without dropping them. */
  z.object({ type: z.literal('showOriginal'), on: z.boolean() }),
  /** Selects the element a change is on, scrolls to it, and shows its styles. */
  z.object({ type: z.literal('selectOp'), id: z.string().max(40) }),
  /** Drops one change from the list and the page; later changes stay applied. */
  z.object({ type: z.literal('removeOp'), id: z.string().max(40) }),
  /** Switches one change off (or back on) without dropping it. */
  z.object({ type: z.literal('muteOp'), id: z.string().max(40), muted: z.boolean() }),
  /** Outlines the element a change is on while its row is hovered; null clears it. */
  z.object({ type: z.literal('highlightOp'), id: z.string().max(40).nullable() }),
]);

/** Applied changes that are switched on: what the page shows and what Save sends. */
export function activeOps(ops: readonly DesignOp[], cursor: number): DesignOp[] {
  return ops.slice(0, cursor).filter((op) => !op.muted);
}
export type DesignCommand = z.infer<typeof designCommandSchema>;

const KIND_TITLE: Readonly<Record<DesignOp['kind'], string>> = {
  style: 'Style',
  text: 'Text',
  attr: 'Attribute',
  move: 'Move',
  insert: 'Insert',
  delete: 'Delete',
};

function short(value: string, max = 60): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** One-line summary of an op for the Changes list: what changed, and from what to what. */
export function describeOp(op: DesignOp): { title: string; before: string; after: string } {
  switch (op.kind) {
    case 'style':
      return { title: op.property, before: op.before || '—', after: op.after };
    case 'text':
      return { title: KIND_TITLE.text, before: `“${short(op.before)}”`, after: `“${short(op.after)}”` };
    case 'attr':
      return { title: op.name, before: op.before ?? '—', after: op.after ?? 'removed' };
    case 'move':
      return {
        title: KIND_TITLE.move,
        before: `position ${op.before.index + 1}`,
        after: `position ${op.after.index + 1}`,
      };
    case 'insert':
      return { title: KIND_TITLE.insert, before: '—', after: op.elementKind };
    case 'delete':
      return { title: KIND_TITLE.delete, before: 'element', after: 'removed' };
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

export const designSessionSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  url: z.string(),
  opCount: z.number().int(),
  approach: stylingApproachSchema,
});
export type DesignSessionSummary = z.infer<typeof designSessionSummarySchema>;

/** Tailwind spacing scale in CSS pixels (default theme, no custom spacing). */
const SPACING_PX: readonly [number, string][] = [
  [0, '0'],
  [1, 'px'],
  [2, '0.5'],
  [4, '1'],
  [6, '1.5'],
  [8, '2'],
  [10, '2.5'],
  [12, '3'],
  [14, '3.5'],
  [16, '4'],
  [20, '5'],
  [24, '6'],
  [28, '7'],
  [32, '8'],
  [36, '9'],
  [40, '10'],
  [44, '11'],
  [48, '12'],
  [56, '14'],
  [64, '16'],
  [80, '20'],
  [96, '24'],
];

const FONT_PX: readonly [number, string][] = [
  [12, 'text-xs'],
  [14, 'text-sm'],
  [16, 'text-base'],
  [18, 'text-lg'],
  [20, 'text-xl'],
  [24, 'text-2xl'],
  [30, 'text-3xl'],
  [36, 'text-4xl'],
  [48, 'text-5xl'],
];

const RADIUS_PX: readonly [number, string][] = [
  [0, 'rounded-none'],
  [2, 'rounded-sm'],
  [4, 'rounded'],
  [6, 'rounded-md'],
  [8, 'rounded-lg'],
  [12, 'rounded-xl'],
  [16, 'rounded-2xl'],
  [24, 'rounded-3xl'],
  [9999, 'rounded-full'],
];

const FONT_WEIGHT: Readonly<Record<string, string>> = {
  '400': 'font-normal',
  '500': 'font-medium',
  '600': 'font-semibold',
  '700': 'font-bold',
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

const DISPLAY: Readonly<Record<string, string>> = {
  flex: 'flex',
  'inline-flex': 'inline-flex',
  grid: 'grid',
  'inline-grid': 'inline-grid',
  block: 'block',
  'inline-block': 'inline-block',
  inline: 'inline',
  none: 'hidden',
};

const FLEX_DIRECTION: Readonly<Record<string, string>> = {
  row: 'flex-row',
  column: 'flex-col',
  'row-reverse': 'flex-row-reverse',
  'column-reverse': 'flex-col-reverse',
};

const ALIGN: Readonly<Record<string, string>> = {
  'flex-start': 'items-start',
  start: 'items-start',
  'flex-end': 'items-end',
  end: 'items-end',
  center: 'items-center',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const JUSTIFY: Readonly<Record<string, string>> = {
  'flex-start': 'justify-start',
  start: 'justify-start',
  'flex-end': 'justify-end',
  end: 'justify-end',
  center: 'justify-center',
  'space-between': 'justify-between',
  'space-around': 'justify-around',
  'space-evenly': 'justify-evenly',
};

const WRAP: Readonly<Record<string, string>> = {
  wrap: 'flex-wrap',
  nowrap: 'flex-nowrap',
  'wrap-reverse': 'flex-wrap-reverse',
};

const POSITION: Readonly<Record<string, string>> = {
  static: 'static',
  relative: 'relative',
  absolute: 'absolute',
  fixed: 'fixed',
  sticky: 'sticky',
};

const TEXT_ALIGN: Readonly<Record<string, string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

const SPACING_PREFIX: Readonly<Record<string, string>> = {
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  padding: 'p',
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  margin: 'm',
  gap: 'gap',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

/** Default Tailwind palette entries the mapper knows without reading a config. Hex is lowercase. */
const DEFAULT_COLORS: Readonly<Record<string, string>> = {
  '#000000': 'black',
  '#ffffff': 'white',
  '#f8fafc': 'slate-50',
  '#f1f5f9': 'slate-100',
  '#e2e8f0': 'slate-200',
  '#cbd5e1': 'slate-300',
  '#94a3b8': 'slate-400',
  '#64748b': 'slate-500',
  '#475569': 'slate-600',
  '#334155': 'slate-700',
  '#1e293b': 'slate-800',
  '#0f172a': 'slate-900',
  '#f9fafb': 'gray-50',
  '#f3f4f6': 'gray-100',
  '#e5e7eb': 'gray-200',
  '#d1d5db': 'gray-300',
  '#9ca3af': 'gray-400',
  '#6b7280': 'gray-500',
  '#4b5563': 'gray-600',
  '#374151': 'gray-700',
  '#1f2937': 'gray-800',
  '#111827': 'gray-900',
  '#ef4444': 'red-500',
  '#dc2626': 'red-600',
  '#f97316': 'orange-500',
  '#f59e0b': 'amber-500',
  '#eab308': 'yellow-500',
  '#22c55e': 'green-500',
  '#10b981': 'emerald-500',
  '#14b8a6': 'teal-500',
  '#06b6d4': 'cyan-500',
  '#0ea5e9': 'sky-500',
  '#3b82f6': 'blue-500',
  '#6366f1': 'indigo-500',
  '#8b5cf6': 'violet-500',
  '#a855f7': 'purple-500',
  '#d946ef': 'fuchsia-500',
  '#ec4899': 'pink-500',
  '#f43f5e': 'rose-500',
};

const APPROACH_NOTE: Readonly<Record<StylingApproach, string>> = {
  tailwind:
    'Suggestions use the default Tailwind spacing scale, font sizes and radius, plus colours from the default palette and any hex colours found in the Tailwind config. Values off the scale use arbitrary values such as p-[13px]. Classes that are not already in the compiled CSS will not show until the dev server rebuilds them; the preview uses inline styles.',
  'css-modules': 'The project has CSS modules (*.module.css). Put the changes in the module for the component.',
  'styled-components':
    'The project depends on styled-components. Change the styled component, not a global stylesheet.',
  emotion: 'The project depends on Emotion. Change the styled component or the css prop, not a global stylesheet.',
  'plain-css': 'No Tailwind config, CSS modules or CSS-in-JS dependency was found. Edit the plain stylesheet.',
};

export function stylingNote(approach: StylingApproach): string {
  return APPROACH_NOTE[approach];
}

export function normalizeHex(value: string): string | null {
  const raw = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short?.[1]) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const long = /^#([0-9a-f]{6})$/.exec(raw);
  return long ? `#${long[1]}` : null;
}

/** `rgb(239, 68, 68)` / `rgba(...)` to `#ef4444`. Alpha other than 1 returns null. */
export function rgbToHex(value: string): string | null {
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  if (match[4] !== undefined && Number(match[4]) !== 1) return null;
  const channel = (part: string): string | null => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    return n.toString(16).padStart(2, '0');
  };
  const r = channel(match[1]);
  const g = channel(match[2]);
  const b = channel(match[3]);
  return r && g && b ? `#${r}${g}${b}` : null;
}

function colorHex(value: string): string | null {
  return normalizeHex(value) ?? rgbToHex(value);
}

const COLOR_PATH_SKIP = new Set(['theme', 'colors', 'extend']);

/**
 * Reads hex colours out of a Tailwind config, including nested shades
 * (`brand: { 500: '#aabbcc' }` becomes `brand-500`). `theme`, `extend` and `colors` are not part
 * of the name.
 */
export function parseConfigColors(source: string): Map<string, string> {
  const colors = new Map<string, string>();
  const stack: string[] = [];
  const tokens = /(['"]?)([A-Za-z0-9_-]+)\1\s*:\s*(?:(['"])(#[0-9a-fA-F]{3,8})\3|\{)|\}/g;
  for (let match = tokens.exec(source); match; match = tokens.exec(source)) {
    if (match[0] === '}') {
      stack.pop();
      continue;
    }
    const key = match[2];
    if (!key) continue;
    const hex = match[4] ? normalizeHex(match[4]) : null;
    if (hex) {
      const path = [...stack, key].filter((part) => !COLOR_PATH_SKIP.has(part));
      colors.set(hex, path.join('-') || key);
    } else {
      stack.push(key);
    }
  }
  return colors;
}

/** Hex (lowercase) to a Tailwind colour name. Config colours win over the default palette. */
export function colorName(value: string, config: ReadonlyMap<string, string>): string | null {
  const hex = colorHex(value);
  if (!hex) return null;
  return config.get(hex) ?? DEFAULT_COLORS[hex] ?? null;
}

function pxValue(value: string): number | null {
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function spacingToken(px: number): string | null {
  const found = SPACING_PX.find(([n]) => n === px);
  return found ? found[1] : null;
}

function spacingClass(prefix: string, px: number): string {
  const negative = px < 0;
  const token = spacingToken(Math.abs(px));
  if (token === null) {
    const raw = `${Math.abs(px)}px`;
    return negative ? `-${prefix}-[${raw}]` : `${prefix}-[${raw}]`;
  }
  if (negative && token === '0') return `${prefix}-0`;
  return negative ? `-${prefix}-${token}` : `${prefix}-${token}`;
}

function lookup(table: Readonly<Record<string, string>>, value: string): string | null {
  return table[value.trim()] ?? null;
}

function arbitrary(prefix: string, value: string): string {
  return `${prefix}-[${value.trim().replace(/\s+/g, '_')}]`;
}

/**
 * A Tailwind utility for one CSS declaration, or null when the property is not mapped.
 * `config` maps lowercase hex to a colour name (`red-500`).
 */
export function suggestTailwind(
  property: string,
  value: string,
  config: ReadonlyMap<string, string> = new Map(),
): string | null {
  const prop = property.trim().toLowerCase();
  const raw = value.trim();
  if (!raw) return null;

  const spacing = SPACING_PREFIX[prop];
  if (spacing) {
    const px = pxValue(raw);
    if (px === null) return arbitrary(spacing, raw);
    return spacingClass(spacing, px);
  }

  switch (prop) {
    case 'display':
      return lookup(DISPLAY, raw);
    case 'flex-direction':
      return lookup(FLEX_DIRECTION, raw);
    case 'align-items':
      return lookup(ALIGN, raw);
    case 'justify-content':
      return lookup(JUSTIFY, raw);
    case 'flex-wrap':
      return lookup(WRAP, raw);
    case 'position':
      return lookup(POSITION, raw);
    case 'text-align':
      return lookup(TEXT_ALIGN, raw);
    case 'font-weight':
      return lookup(FONT_WEIGHT, raw) ?? arbitrary('font', raw);
    case 'font-size': {
      const px = pxValue(raw);
      if (px === null) return arbitrary('text', raw);
      return FONT_PX.find(([n]) => n === px)?.[1] ?? `text-[${raw}]`;
    }
    case 'border-radius': {
      const px = pxValue(raw);
      if (px === null) return arbitrary('rounded', raw);
      return RADIUS_PX.find(([n]) => n === px)?.[1] ?? `rounded-[${raw}]`;
    }
    case 'opacity': {
      const percent = raw.endsWith('%') ? Number(raw.slice(0, -1)) : Number(raw) * 100;
      if (!Number.isFinite(percent)) return null;
      const rounded = Math.round(percent);
      if (rounded >= 0 && rounded <= 100 && rounded % 5 === 0) return `opacity-${rounded}`;
      return `opacity-[${raw}]`;
    }
    case 'width':
    case 'height': {
      const prefix = prop === 'width' ? 'w' : 'h';
      if (raw === '100%') return `${prefix}-full`;
      if (raw === 'auto') return `${prefix}-auto`;
      const px = pxValue(raw);
      if (px === null) return arbitrary(prefix, raw);
      const token = spacingToken(px);
      return token ? `${prefix}-${token}` : `${prefix}-[${raw}]`;
    }
    case 'color':
    case 'background-color':
    case 'border-color': {
      const prefix = prop === 'color' ? 'text' : prop === 'background-color' ? 'bg' : 'border';
      if (raw === 'transparent') return `${prefix}-transparent`;
      const name = colorName(raw, config);
      if (name) return `${prefix}-${name}`;
      const hex = colorHex(raw);
      return hex ? `${prefix}-[${hex}]` : arbitrary(prefix, raw);
    }
    default:
      return null;
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function styleBullet(
  op: Extract<DesignOp, { kind: 'style' }>,
  approach: StylingApproach,
  config: ReadonlyMap<string, string>,
): string {
  const suggestion =
    approach === 'tailwind' ? suggestTailwind(op.property, op.computedAfter || op.after, config) : null;
  const typed = op.after !== op.computedAfter && op.computedAfter ? ` (computed ${op.computedAfter})` : '';
  const suggested = suggestion ? ` (suggested \`${suggestion}\`)` : '';
  const stale = op.stale ? ' (stale: the element was not on the page after a re-render)' : '';
  return `- \`${op.property}\`: ${op.before || '(empty)'} → ${op.after}${typed}${suggested}${stale}`;
}

function staleSuffix(op: DesignOp): string {
  return op.stale ? ' (stale: the element was not on the page after a re-render)' : '';
}

function bullet(op: DesignOp, approach: StylingApproach, config: ReadonlyMap<string, string>): string {
  switch (op.kind) {
    case 'style':
      return styleBullet(op, approach, config);
    case 'text':
      return `- text: ${quote(op.before)} → ${quote(op.after)}${staleSuffix(op)}`;
    case 'attr':
      return `- attribute \`${op.name}\`: ${op.before === null ? '(none)' : quote(op.before)} → ${op.after === null ? '(removed)' : quote(op.after)}${staleSuffix(op)}`;
    case 'move':
      return `- move: parent ${op.before.parentRef} index ${op.before.index} → parent ${op.after.parentRef} index ${op.after.index}${staleSuffix(op)}`;
    case 'insert':
      return `- insert ${op.elementKind} at parent ${op.parentRef} index ${op.index}${staleSuffix(op)}`;
    case 'delete':
      return `- delete the element at parent ${op.parentRef} index ${op.index}${staleSuffix(op)}`;
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

function groupLabel(op: DesignOp): string {
  return op.target.componentChain.length > 0
    ? op.target.componentChain.join(' ← ')
    : op.target.selector || op.target.ref;
}

/** Markdown change list: one bullet per applied op, grouped by component. */
export function renderChangeList(
  ops: readonly DesignOp[],
  approach: StylingApproach,
  config: ReadonlyMap<string, string> = new Map(),
): string {
  if (ops.length === 0) return '_No changes._';
  const groups = new Map<string, DesignOp[]>();
  for (const op of ops) {
    const label = groupLabel(op);
    const list = groups.get(label);
    if (list) list.push(op);
    else groups.set(label, [op]);
  }
  const sections: string[] = [];
  for (const [label, list] of groups) {
    sections.push(`### ${label}`, '', ...list.map((op) => bullet(op, approach, config)), '');
  }
  return sections.join('\n').trimEnd();
}

export interface StylingInput {
  /** `package.json` text, or null when the file is missing. */
  readonly packageJson: string | null;
  /** Project-relative paths using forward slashes. */
  readonly paths: readonly string[];
  /** Reads a project-relative file. Null when it cannot be read. */
  read(relativePath: string): string | null;
}

function packageDepends(packageJson: string | null, name: string): boolean {
  if (!packageJson) return false;
  try {
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(parsed.dependencies?.[name] || parsed.devDependencies?.[name]);
  } catch {
    return false;
  }
}

function isTailwindConfig(path: string): boolean {
  return /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(path.split('/').pop() ?? '');
}

function mentionsTailwind(css: string): boolean {
  return /@import\s+['"]tailwindcss['"]/.test(css) || /@tailwind\s+(base|components|utilities)/.test(css);
}

/**
 * Tailwind, then CSS modules, then styled-components, then Emotion, otherwise plain CSS.
 * Config colours are returned for the Tailwind mapper; other approaches get an empty map.
 */
export function detectStyling(input: StylingInput): {
  approach: StylingApproach;
  colors: Map<string, string>;
  note: string;
} {
  const colors = new Map<string, string>();
  const configs = input.paths.filter(isTailwindConfig);
  let tailwind = configs.length > 0;
  for (const path of configs) {
    const text = input.read(path);
    if (!text) continue;
    for (const [hex, name] of parseConfigColors(text)) colors.set(hex, name);
  }
  if (!tailwind) {
    for (const path of input.paths) {
      if (!/\.(css|scss|sass)$/.test(path)) continue;
      const text = input.read(path);
      if (text && mentionsTailwind(text)) {
        tailwind = true;
        break;
      }
    }
  }
  if (tailwind) return { approach: 'tailwind', colors, note: stylingNote('tailwind') };
  if (input.paths.some((path) => path.endsWith('.module.css'))) {
    return { approach: 'css-modules', colors, note: stylingNote('css-modules') };
  }
  if (packageDepends(input.packageJson, 'styled-components')) {
    return { approach: 'styled-components', colors, note: stylingNote('styled-components') };
  }
  if (packageDepends(input.packageJson, '@emotion/react') || packageDepends(input.packageJson, '@emotion/styled')) {
    return { approach: 'emotion', colors, note: stylingNote('emotion') };
  }
  return { approach: 'plain-css', colors, note: stylingNote('plain-css') };
}
