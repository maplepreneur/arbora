import { z } from 'zod';
import { designCommandSchema, designOpSchema, designStateSchema } from './design.js';
import { inspectorSelectionSchema } from './inspector.js';

/**
 * Private IPC between the browser-panel preload (running inside the user's page) and main. Kept
 * separate from the app channels: main only accepts these from browser-panel webContents, and the
 * app handlers reject browser-panel senders.
 */
export const PAGE_IPC_PREFIX = 'arbora:page:';

export function pageIpcName(name: string): string {
  return `${PAGE_IPC_PREFIX}${name}`;
}

/** Page -> main one-way messages. Stage 6 adds design messages here. */
export const pageMessages = {
  ready: z.object({ url: z.string(), title: z.string() }),
  /** Reply to the `ping` event; proves the main -> page -> main round trip. */
  pong: z.object({ nonce: z.string() }),
  /** Agent mode: the user clicked an element (or a breadcrumb entry). */
  'inspector.selected': inspectorSelectionSchema,
  /** Agent mode: `Esc` reached the page (main normally intercepts it first). */
  'inspector.cancelled': z.object({}),
  /** The overlay finished showing or hiding (two animation frames later), for clean screenshots. */
  'inspector.overlayApplied': z.object({ nonce: z.string() }),
  /** Design mode: the op list, cursor and selection. Main persists this as it arrives. */
  'design.state': designStateSchema,
  /** Design mode: Escape with nothing selected (main normally intercepts Escape first). */
  'design.exitRequested': z.object({}),
  'design.overlayApplied': z.object({ nonce: z.string() }),
} as const;

export type PageMessageName = keyof typeof pageMessages;
export type PageMessage<K extends PageMessageName> = z.infer<(typeof pageMessages)[K]>;
/** A validated page message, discriminated by `name`. */
export type PageMessageEnvelope = { [K in PageMessageName]: { name: K; payload: PageMessage<K> } }[PageMessageName];

/** Main -> page events. */
export const pageEvents = {
  ping: z.object({ nonce: z.string() }),
  /** Agent mode: show the hover highlight and wait for a click. Restarts after a selection. */
  'inspector.start': z.object({}),
  /** Agent mode: remove the overlay and release every listener. */
  'inspector.stop': z.object({}),
  'inspector.setOverlay': z.object({ visible: z.boolean(), nonce: z.string() }),
  /** Design mode: show the overlay. `ops` is a crash draft to re-apply. */
  'design.start': z.object({ ops: z.array(designOpSchema).max(500), cursor: z.number().int().min(0) }),
  /** Design mode: remove the overlay. `revert` restores the DOM. */
  'design.stop': z.object({ revert: z.boolean() }),
  'design.setOverlay': z.object({ visible: z.boolean(), nonce: z.string() }),
  'design.command': designCommandSchema,
} as const;

export type PageEventName = keyof typeof pageEvents;
export type PageEvent<K extends PageEventName> = z.infer<(typeof pageEvents)[K]>;
