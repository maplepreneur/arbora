import type { DesignOp, StylingApproach } from './design.js';
import { suggestTailwind } from './design.js';

/**
 * Design-mode write-through (Stage 11). A session can be applied straight to source when every
 * applied change is a Tailwind class on a tier-1 target (a file and a line). Anything else stays
 * on the agent path.
 */

export interface TailwindClassChange {
  readonly className: string;
  readonly property: string;
}

export interface WriteThroughEdit {
  readonly file: string;
  readonly line: number;
  readonly classes: readonly TailwindClassChange[];
}

export type WriteThroughPlan =
  { readonly ok: true; readonly edits: readonly WriteThroughEdit[] } | { readonly ok: false; readonly reason: string };

export type PatchResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

const DISPLAY = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden']);
const POSITION = new Set(['static', 'relative', 'absolute', 'fixed', 'sticky']);
const FLEX_DIRECTION = new Set(['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse']);
const WRAP = new Set(['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse']);
const TEXT_ALIGN = new Set(['text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end']);
const JUSTIFY = new Set([
  'justify-start',
  'justify-end',
  'justify-center',
  'justify-between',
  'justify-around',
  'justify-evenly',
]);
const BACKGROUND_SKIP = new Set([
  'bg-cover',
  'bg-contain',
  'bg-center',
  'bg-top',
  'bg-bottom',
  'bg-left',
  'bg-right',
  'bg-fixed',
  'bg-local',
  'bg-scroll',
  'bg-no-repeat',
  'bg-repeat',
  'bg-repeat-x',
  'bg-repeat-y',
  'bg-auto',
  'bg-none',
]);

/** True when every applied op is a Tailwind class edit on a tier-1 source location. */
export function planWriteThrough(
  ops: readonly DesignOp[],
  approach: StylingApproach,
  colors: ReadonlyMap<string, string> = new Map(),
): WriteThroughPlan {
  if (approach !== 'tailwind') return { ok: false, reason: 'This project is not using Tailwind.' };
  if (ops.length === 0) return { ok: false, reason: 'Nothing to apply.' };
  const grouped = new Map<string, WriteThroughEdit & { classes: TailwindClassChange[] }>();
  for (const op of ops) {
    if (op.kind !== 'style') {
      return { ok: false, reason: 'Write-through only applies style changes. Ask an agent to apply the rest.' };
    }
    if (op.stale) return { ok: false, reason: 'A change is stale, so it was left for an agent.' };
    const file = op.target.sourceFile;
    const line = op.target.sourceLine;
    if (!file || line === null || line < 1) {
      return { ok: false, reason: 'Write-through needs a file and a line for every change.' };
    }
    const className = suggestTailwind(op.property, op.computedAfter || op.after, colors);
    if (!className) return { ok: false, reason: `No Tailwind class for ${op.property}.` };
    const key = `${file}\0${line}`;
    const edit = grouped.get(key) ?? { file, line, classes: [] };
    edit.classes.push({ className, property: op.property });
    grouped.set(key, edit);
  }
  return { ok: true, edits: [...grouped.values()].map((edit) => ({ ...edit, classes: dedupe(edit.classes) })) };
}

/**
 * Rewrites `class` / `className` on the opening tag at each edit's line. A later edit of the same
 * property wins. Directional utilities (`pt-10`) sit beside a shorthand (`p-6`); the shorthand is
 * replaced only when the edit is that shorthand. A dynamic `className={...}` is refused.
 */
export function patchTailwindSource(
  source: string,
  fileName: string,
  edits: readonly Pick<WriteThroughEdit, 'line' | 'classes'>[],
): PatchResult {
  const byLine = new Map<number, TailwindClassChange[]>();
  for (const edit of edits) {
    const list = byLine.get(edit.line) ?? [];
    list.push(...edit.classes);
    byLine.set(edit.line, list);
  }
  let text = source;
  for (const [line, classes] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const found = openingTagAt(text, line);
    if (!found) return { ok: false, reason: `No element tag on line ${line}.` };
    const rewritten = rewriteTag(found.tag, fileName, dedupe(classes));
    if (!rewritten.ok) return rewritten;
    text = text.slice(0, found.start) + rewritten.text + text.slice(found.end + 1);
  }
  return { ok: true, text };
}

/** Replaces conflicting utilities and appends the new ones. Variant-prefixed classes stay. */
export function mergeTailwindClasses(current: readonly string[], additions: readonly TailwindClassChange[]): string[] {
  const adds = dedupe(additions);
  const next = current.filter((token) => {
    const { variant, utility } = splitVariant(token);
    if (variant !== '') return true;
    return !adds.some((add) => conflicts(add.property, utility));
  });
  for (const add of adds) {
    if (!next.includes(add.className)) next.push(add.className);
  }
  return next;
}

function dedupe(classes: readonly TailwindClassChange[]): TailwindClassChange[] {
  const byProperty = new Map<string, TailwindClassChange>();
  for (const change of classes) byProperty.set(change.property, change);
  return [...byProperty.values()];
}

function splitVariant(token: string): { variant: string; utility: string } {
  let bracket = 0;
  let splitAt = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === ':' && bracket === 0) splitAt = i;
  }
  if (splitAt === -1) return { variant: '', utility: token };
  return { variant: token.slice(0, splitAt), utility: token.slice(splitAt + 1) };
}

function bare(utility: string): string {
  return utility.startsWith('!') ? utility.slice(1) : utility;
}

function isTextColor(utility: string): boolean {
  if (TEXT_ALIGN.has(utility)) return false;
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(utility)) return false;
  if (/^text-\[(?!#)/.test(utility)) return false;
  return utility.startsWith('text-');
}

function isBackground(utility: string): boolean {
  if (BACKGROUND_SKIP.has(utility)) return false;
  if (/^bg-\[url/.test(utility)) return false;
  return utility.startsWith('bg-');
}

function isBorderColor(utility: string): boolean {
  if (/^border-(transparent|black|white|inherit|current)$/.test(utility)) return true;
  if (/^border-[a-z]+-\d{2,3}$/.test(utility)) return true;
  if (/^border-\[#/.test(utility)) return true;
  if (/^border-\[(?:rgb|hsl|oklch)/.test(utility)) return true;
  return false;
}

function conflicts(property: string, utility: string): boolean {
  const name = bare(utility);
  switch (property) {
    case 'padding':
      return /^-?p(?:t|r|b|l|x|y|s|e)?-/.test(name);
    case 'padding-top':
      return /^-?pt-/.test(name);
    case 'padding-right':
      return /^-?pr-/.test(name);
    case 'padding-bottom':
      return /^-?pb-/.test(name);
    case 'padding-left':
      return /^-?pl-/.test(name);
    case 'margin':
      return /^-?m(?:t|r|b|l|x|y|s|e)?-/.test(name);
    case 'margin-top':
      return /^-?mt-/.test(name);
    case 'margin-right':
      return /^-?mr-/.test(name);
    case 'margin-bottom':
      return /^-?mb-/.test(name);
    case 'margin-left':
      return /^-?ml-/.test(name);
    case 'gap':
      return /^-?gap-/.test(name);
    case 'top':
      return /^-?top-/.test(name);
    case 'right':
      return /^-?right-/.test(name);
    case 'bottom':
      return /^-?bottom-/.test(name);
    case 'left':
      return /^-?left-/.test(name);
    case 'display':
      return DISPLAY.has(name);
    case 'flex-direction':
      return FLEX_DIRECTION.has(name);
    case 'align-items':
      return name.startsWith('items-');
    case 'justify-content':
      return JUSTIFY.has(name);
    case 'flex-wrap':
      return WRAP.has(name);
    case 'position':
      return POSITION.has(name);
    case 'text-align':
      return TEXT_ALIGN.has(name);
    case 'font-weight':
      return /^(font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|font-\[)/.test(name);
    case 'font-size':
      return /^(text-(xs|sm|base|lg|xl|[2-9]xl))$/.test(name) || /^text-\[(?!#)/.test(name);
    case 'border-radius':
      return name === 'rounded' || name.startsWith('rounded-');
    case 'opacity':
      return name.startsWith('opacity-');
    case 'width':
      return name.startsWith('w-');
    case 'height':
      return name.startsWith('h-');
    case 'color':
      return isTextColor(name);
    case 'background-color':
      return isBackground(name);
    case 'border-color':
      return isBorderColor(name);
    default:
      return false;
  }
}

const SIMPLE_ATTR = /\b(className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/;

function classAttribute(fileName: string, tag: string): 'class' | 'className' {
  const existing = /\b(className|class)\s*=/.exec(tag);
  if (existing?.[1] === 'class' || existing?.[1] === 'className') return existing[1];
  if (/\.(vue|html|htm|svelte|astro)$/i.test(fileName)) return 'class';
  return 'className';
}

function rewriteTag(tag: string, fileName: string, classes: readonly TailwindClassChange[]): PatchResult {
  const simple = SIMPLE_ATTR.exec(tag);
  if (/\b(?:className|class)\s*=/.test(tag) && !simple) {
    return { ok: false, reason: 'The class attribute is an expression, so it was left for an agent.' };
  }
  const current = simple ? (simple[2] ?? simple[3] ?? simple[4] ?? simple[5] ?? '') : '';
  const value = mergeTailwindClasses(current.split(/\s+/).filter(Boolean), classes).join(' ');
  if (!simple) return { ok: true, text: insertClass(tag, classAttribute(fileName, tag), value) };
  const quote = simple[2] !== undefined || simple[4] !== undefined ? '"' : "'";
  const braced = simple[4] !== undefined || simple[5] !== undefined;
  const name = simple[1] === 'class' ? 'class' : 'className';
  const replacement = braced ? `${name}={${quote}${value}${quote}}` : `${name}=${quote}${value}${quote}`;
  return { ok: true, text: tag.slice(0, simple.index) + replacement + tag.slice(simple.index + simple[0].length) };
}

function insertClass(tag: string, name: 'class' | 'className', value: string): string {
  const close = tag.lastIndexOf('>');
  if (close < 0) return tag;
  const self = tag[close - 1] === '/';
  const at = self ? close - 1 : close;
  const prefix = tag[at - 1] === ' ' || tag[at - 1] === '\n' ? '' : ' ';
  const inserted = `${prefix}${name}="${value}"${self ? ' ' : ''}`;
  return tag.slice(0, at) + inserted + tag.slice(at);
}

function lineStartOffset(source: string, line: number): number {
  let offset = 0;
  let current = 1;
  while (current < line && offset < source.length) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) return source.length;
    offset = newline + 1;
    current++;
  }
  return offset;
}

function openingTagAt(source: string, line: number): { start: number; end: number; tag: string } | null {
  const lineStart = lineStartOffset(source, line);
  const newline = source.indexOf('\n', lineStart);
  const lineEnd = newline === -1 ? source.length : newline;
  const windowStart = Math.max(0, lineStart - 1500);
  for (let i = lineEnd; i >= windowStart; i--) {
    if (source[i] !== '<') continue;
    const next = source[i + 1];
    if (!next || !/[A-Za-z]/.test(next)) continue;
    const end = tagEnd(source, i);
    if (end === null || end < lineStart) continue;
    return { start: i, end, tag: source.slice(i, end + 1) };
  }
  return null;
}

function tagEnd(source: string, start: number): number | null {
  let quote: '"' | "'" | '`' | null = null;
  let brace = 0;
  const limit = Math.min(source.length, start + 2000);
  for (let i = start + 1; i < limit; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      brace++;
      continue;
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1);
      continue;
    }
    if (ch === '>' && brace === 0) return i;
  }
  return null;
}
