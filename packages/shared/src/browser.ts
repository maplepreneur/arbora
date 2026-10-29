import { z } from 'zod';

/** A rectangle in CSS pixels. Window rects are relative to the app window's content area. */
export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
});
export type Rect = z.infer<typeof rectSchema>;

export const viewportPresetIdSchema = z.enum(['responsive', 'mobile', 'tablet', 'laptop', 'desktop']);
export type ViewportPresetId = z.infer<typeof viewportPresetIdSchema>;

export interface ViewportPreset {
  readonly id: ViewportPresetId;
  readonly label: string;
  /** CSS pixel size of the emulated viewport; `null` for responsive (fills the panel). */
  readonly size: { readonly width: number; readonly height: number } | null;
  readonly deviceScaleFactor: number;
  readonly mobile: boolean;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'responsive', label: 'Responsive', size: null, deviceScaleFactor: 0, mobile: false },
  { id: 'mobile', label: 'Mobile (390×844)', size: { width: 390, height: 844 }, deviceScaleFactor: 3, mobile: true },
  { id: 'tablet', label: 'Tablet (820×1180)', size: { width: 820, height: 1180 }, deviceScaleFactor: 2, mobile: true },
  { id: 'laptop', label: 'Laptop (1280×800)', size: { width: 1280, height: 800 }, deviceScaleFactor: 0, mobile: false },
  {
    id: 'desktop',
    label: 'Desktop (1920×1080)',
    size: { width: 1920, height: 1080 },
    deviceScaleFactor: 0,
    mobile: false,
  },
];

export function viewportPreset(id: ViewportPresetId): ViewportPreset {
  const preset = VIEWPORT_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown viewport preset ${id}`);
  return preset;
}

/**
 * Device emulation applied through CDP `Emulation.setDeviceMetricsOverride`. `scale` shrinks the
 * emulated viewport to fit the panel without changing the CSS viewport the page sees.
 * `deviceScaleFactor: 0` keeps the screen's real DPR.
 */
export const viewportEmulationSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().min(0),
  mobile: z.boolean(),
  scale: z.number().positive().max(1),
});
export type ViewportEmulation = z.infer<typeof viewportEmulationSchema>;

export interface ViewportFit {
  /** Where the `WebContentsView` goes, in window CSS pixels (integers). */
  readonly rect: Rect;
  readonly emulation: ViewportEmulation | null;
}

/** Letterboxes a preset inside `area`: centred and scaled down (never up) to fit. */
export function fitViewport(area: Rect, presetId: ViewportPresetId): ViewportFit {
  const preset = viewportPreset(presetId);
  const rounded = roundRect(area);
  if (!preset.size || rounded.width <= 0 || rounded.height <= 0) {
    return { rect: rounded, emulation: null };
  }
  const scale = Math.min(1, rounded.width / preset.size.width, rounded.height / preset.size.height);
  const width = Math.max(1, Math.floor(preset.size.width * scale));
  const height = Math.max(1, Math.floor(preset.size.height * scale));
  return {
    rect: {
      x: rounded.x + Math.floor((rounded.width - width) / 2),
      y: rounded.y + Math.floor((rounded.height - height) / 2),
      width,
      height,
    },
    emulation: {
      width: preset.size.width,
      height: preset.size.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile,
      scale,
    },
  };
}

export function roundRect(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return {
    x,
    y,
    width: Math.max(0, Math.round(rect.x + rect.width) - x),
    height: Math.max(0, Math.round(rect.y + rect.height) - y),
  };
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0', '[::]']);

/** Loopback and `*.localhost` hosts; these are the user's own dev servers. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host);
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Turns URL bar input into a loadable URL: bare `localhost:5173` gets `http://`, and wildcard
 * hosts (`0.0.0.0`, `[::]`) that dev servers print are rewritten to `localhost`, which Chromium
 * can actually connect to. Returns `null` for anything that is not http(s).
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  // `localhost:5173` parses as scheme "localhost:", so only treat it as a scheme when followed by `//`.
  const hasScheme = SCHEME.test(trimmed) && /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.hostname.length === 0) return null;
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost';
  return url.toString();
}

export type UrlSecurity = 'local' | 'secure' | 'insecure' | 'none';

export function urlSecurity(url: string): UrlSecurity {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'none';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'none';
  if (isLocalHostname(parsed.hostname)) return 'local';
  return parsed.protocol === 'https:' ? 'secure' : 'insecure';
}

export const loadErrorSchema = z.object({
  code: z.number().int(),
  description: z.string(),
  url: z.string(),
});
export type LoadError = z.infer<typeof loadErrorSchema>;

export const navigationStateSchema = z.object({
  /** Empty until the first navigation. */
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
  zoomFactor: z.number().positive(),
  preset: viewportPresetIdSchema,
  devToolsOpen: z.boolean(),
  /** Main-frame load failure (unreachable dev server, certificate error, ...). */
  error: loadErrorSchema.nullable(),
  /** The page's `browser-preload` reported in on the current document. */
  pageReady: z.boolean(),
});
export type NavigationState = z.infer<typeof navigationStateSchema>;

export const problemLevelSchema = z.enum(['error', 'warning', 'info', 'debug']);
export type ProblemLevel = z.infer<typeof problemLevelSchema>;

export const problemSourceSchema = z.enum(['console', 'exception', 'browser', 'network']);
export type ProblemSource = z.infer<typeof problemSourceSchema>;

export const problemEntrySchema = z.object({
  id: z.number().int(),
  source: problemSourceSchema,
  level: problemLevelSchema,
  message: z.string(),
  /** Epoch milliseconds. */
  timestamp: z.number(),
  /** Script or request URL. */
  url: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  /** Network entries only. */
  method: z.string().optional(),
  status: z.number().int().optional(),
});
export type ProblemEntry = z.infer<typeof problemEntrySchema>;

export const screenshotRequestSchema = z.object({
  mode: z.enum(['viewport', 'element', 'fullPage']),
  /** Element mode: the area to capture, in page CSS pixels relative to the viewport. */
  rect: rectSchema.optional(),
  /** Burns a 2px outline into the image. Viewport coordinates, or document coordinates for full page. */
  highlight: rectSchema.optional(),
  /** Also writes the PNG to `<project>/.arbora/screenshots/`. */
  save: z.boolean().optional(),
});
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>;

export const screenshotResultSchema = z.object({
  pngBase64: z.string(),
  /** Image size in device pixels. */
  width: z.number().int(),
  height: z.number().int(),
  /** Device pixels per page CSS pixel; multiply page rects by this to map them onto the image. */
  dpr: z.number().positive(),
  path: z.string().optional(),
});
export type ScreenshotResult = z.infer<typeof screenshotResultSchema>;

export const browserHistoryEntrySchema = z.object({
  url: z.string(),
  title: z.string(),
  visitedAt: z.number(),
});
export type BrowserHistoryEntry = z.infer<typeof browserHistoryEntrySchema>;

export const browserActionSchema = z.enum([
  'back',
  'forward',
  'reload',
  'hardReload',
  'stop',
  'openExternal',
  'toggleDevTools',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'focusPage',
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

/** Fixed-size FIFO; the oldest entries fall off once `capacity` is reached. */
export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive integer');
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }
}

export const ZOOM_LEVELS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];

/** Next zoom step in `direction` from `current`, like Chromium's zoom menu. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + 0.001) ?? current;
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? current;
}
