import { z } from 'zod';
import { rectSchema, type Rect } from './browser.js';

/**
 * Agent mode (Stage 4): what the inspector in the user's page reports about a selected element,
 * and what main sends back to the renderer once it has resolved source files and a screenshot.
 */

export const frameworkIdSchema = z.enum(['react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'html']);
export type FrameworkId = z.infer<typeof frameworkIdSchema>;

export const frameworkInfoSchema = z.object({
  /** The most specific match: `next` over `react`, `nuxt` over `vue`. */
  id: frameworkIdSchema,
  react: z.boolean(),
  vue: z.boolean(),
  /** React's major version from the DevTools hook or the renderer, when known. */
  reactVersion: z.string().nullable(),
});
export type FrameworkInfo = z.infer<typeof frameworkInfoSchema>;

/** A source location as the framework reported it (absolute path, `webpack://`, Vite `/src/...` URL). */
export const rawSourceSchema = z.object({
  file: z.string().max(2000),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
});
export type RawSource = z.infer<typeof rawSourceSchema>;

export const componentEntrySchema = z.object({
  name: z.string().max(200),
  /** One- or two-letter names from a production build; shown as "anonymous component". */
  minified: z.boolean(),
  /** React Server Component, known only by name (from the fiber's `_debugInfo`). */
  server: z.boolean(),
  /**
   * Where the component's own JSX/template lives. React: the source of an element it rendered;
   * Vue: `type.__file`.
   */
  definedAt: rawSourceSchema.nullable(),
  /** Where the parent rendered it (React `_debugSource`/`_debugStack` of the component's fiber). */
  renderedAt: rawSourceSchema.nullable(),
  /** Union of the component's top-level DOM nodes, in viewport CSS pixels. */
  rect: rectSchema.nullable(),
});
export type ComponentEntry = z.infer<typeof componentEntrySchema>;

export const elementDescriptorSchema = z.object({
  tag: z.string().max(100),
  id: z.string().max(200).nullable(),
  classes: z.array(z.string().max(200)).max(50),
  /** Classes no other element in the document has; the best grep terms. */
  uniqueClasses: z.array(z.string().max(200)).max(50),
  text: z.string().max(400),
  /** Trimmed `outerHTML`: three levels deep, long text cut, event-handler attributes dropped. */
  html: z.string().max(10_000),
  styles: z.record(z.string(), z.string().max(300)),
  /** Viewport CSS pixels. */
  rect: rectSchema,
});
export type ElementDescriptor = z.infer<typeof elementDescriptorSchema>;

export const pageViewportSchema = z.object({
  innerWidth: z.number().positive(),
  innerHeight: z.number().positive(),
  devicePixelRatio: z.number().positive(),
});
export type PageViewport = z.infer<typeof pageViewportSchema>;

/** Page -> main when the user clicks an element in agent mode. */
export const inspectorSelectionSchema = z.object({
  url: z.string().max(4000),
  title: z.string().max(500),
  /** `data-arbora-ref` value set on the element (only ever on selection). */
  ref: z.string().max(20),
  /** id > data-testid > nth-child path. */
  selector: z.string().max(2000),
  framework: frameworkInfoSchema,
  /** Nearest component first. Library components (node_modules) are already filtered out. */
  components: z.array(componentEntrySchema).max(30),
  /** Which entry of `components` the user picked from the breadcrumb (0 when they clicked the page). */
  targetIndex: z.number().int().min(0),
  element: elementDescriptorSchema,
  viewport: pageViewportSchema,
  /** Things the agent should know, e.g. "cross-origin iframe: contents are not inspectable". */
  notes: z.array(z.string().max(300)).max(10),
});
export type InspectorSelection = z.infer<typeof inspectorSelectionSchema>;

/** A source location mapped onto a file that exists inside the project. */
export const resolvedSourceSchema = z.object({
  path: z.string(),
  /** Project-relative, forward slashes. */
  relative: z.string(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
});
export type ResolvedSource = z.infer<typeof resolvedSourceSchema>;

export const resolvedComponentSchema = componentEntrySchema.extend({
  definedIn: resolvedSourceSchema.nullable(),
  renderedIn: resolvedSourceSchema.nullable(),
});
export type ResolvedComponent = z.infer<typeof resolvedComponentSchema>;

export const sourceCandidateSchema = z.object({
  path: z.string(),
  relative: z.string(),
  /** Which search terms (component names, class names) matched the file. */
  matched: z.array(z.string()),
});
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;

/**
 * 1: a file and line from the framework (React <= 18 dev builds).
 * 2: a file without a reliable line (Vue `__file`, React 19 stack frames).
 * 3: names and HTML only; the agent gets grep candidates.
 */
export const sourceTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type SourceTier = z.infer<typeof sourceTierSchema>;

/** Main -> renderer: a selection with its sources resolved and a clean (overlay-free) screenshot. */
export const agentModeSelectionSchema = inspectorSelectionSchema.extend({
  id: z.string(),
  components: z.array(resolvedComponentSchema),
  candidates: z.array(sourceCandidateSchema),
  consoleErrors: z.array(z.string()),
  screenshot: z.object({
    /** `data:image/png;base64,...` of the viewport, without the outline (the renderer draws it). */
    dataUrl: z.string(),
    width: z.number().int(),
    height: z.number().int(),
  }),
});
export type AgentModeSelection = z.infer<typeof agentModeSelectionSchema>;

export const agentModeIncludeSchema = z.object({
  screenshot: z.boolean(),
  /** Source files (tier 1/2) or grep candidates (tier 3) as `resource_link`s. */
  sources: z.boolean(),
  /** Trimmed HTML, computed styles and console errors. */
  context: z.boolean(),
});
export type AgentModeInclude = z.infer<typeof agentModeIncludeSchema>;

export const agentModeTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread'), threadId: z.string() }),
  z.object({ type: z.literal('new'), agentId: z.string() }),
]);
export type AgentModeTarget = z.infer<typeof agentModeTargetSchema>;

/** The component the prompt is about: the chosen chain entry, if any. */
export function targetComponent<T extends ComponentEntry>(
  selection: { components: readonly T[]; targetIndex: number },
  index: number = selection.targetIndex,
): T | null {
  return selection.components[index] ?? selection.components[0] ?? null;
}

/** How precisely the target can be located in source; drives the prompt wording and grep candidates. */
export function sourceTier(component: ResolvedComponent | null): SourceTier {
  if (!component) return 3;
  const sources = [component.renderedIn, component.definedIn].filter((s) => s !== null);
  if (sources.some((s) => s.line !== null)) return 1;
  return sources.length > 0 ? 2 : 3;
}

/** `src/components/Card.tsx:19` (line omitted when unknown). */
export function formatSource(source: ResolvedSource): string {
  return source.line === null ? source.relative : `${source.relative}:${source.line}`;
}

export interface ViewTransform {
  /** The page's CSS viewport size (`innerWidth`/`innerHeight`). */
  readonly viewport: { readonly innerWidth: number; readonly innerHeight: number };
  /** The `WebContentsView` bounds in window CSS pixels. */
  readonly view: Rect;
}

/**
 * Maps a rect in page CSS pixels (relative to the page viewport) to window CSS pixels. The ratio
 * of view width to `innerWidth` folds in the page zoom and the device-emulation scale, so this
 * holds for every viewport preset. Screen pixels are never needed: the renderer positions DOM in
 * window CSS pixels and screenshots carry their own `dpr`.
 */
export function pageRectToWindow(rect: Rect, transform: ViewTransform): Rect {
  const { viewport, view } = transform;
  const sx = viewport.innerWidth > 0 ? view.width / viewport.innerWidth : 1;
  const sy = viewport.innerHeight > 0 ? view.height / viewport.innerHeight : sx;
  return {
    x: view.x + rect.x * sx,
    y: view.y + rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/** Clips `rect` to `bounds`; zero-sized when they do not overlap. */
export function clipRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(rect.x, bounds.x);
  const y = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export interface PopoverPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: 'below' | 'above' | 'right' | 'left' | 'inside';
}

function overlapArea(a: Rect, b: Rect): number {
  const clipped = clipRect(a, b);
  return clipped.width * clipped.height;
}

/**
 * Places a popover of `size` next to `anchor` inside `area` (all in the same coordinates): below
 * the anchor, else above, else to its right or left. When none fits (a short panel), it is pinned
 * to the top or bottom of the area, whichever covers less of the anchor.
 */
export function placePopover(
  anchor: Rect,
  size: { readonly width: number; readonly height: number },
  area: Rect,
  gap = 8,
): PopoverPlacement {
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));
  const x = clamp(anchor.x, area.x, area.x + area.width - size.width);
  const y = clamp(anchor.y, area.y, area.y + area.height - size.height);
  const below = anchor.y + anchor.height + gap;
  if (below + size.height <= area.y + area.height) return { x, y: below, side: 'below' };
  const above = anchor.y - gap - size.height;
  if (above >= area.y) return { x, y: above, side: 'above' };
  const right = anchor.x + anchor.width + gap;
  if (right + size.width <= area.x + area.width) return { x: right, y, side: 'right' };
  const left = anchor.x - gap - size.width;
  if (left >= area.x) return { x: left, y, side: 'left' };
  const top = area.y;
  const bottom = Math.max(area.y, area.y + area.height - size.height);
  const cover = (py: number): number => overlapArea({ x, y: py, ...size }, anchor);
  return { x, y: cover(top) < cover(bottom) ? top : bottom, side: 'inside' };
}
