import { z } from 'zod';

/**
 * Private IPC between the browser-panel preload (running inside the user's page) and main. Kept
 * separate from the app channels: main only accepts these from browser-panel webContents, and the
 * app handlers reject browser-panel senders.
 */
export const PAGE_IPC_PREFIX = 'arbora:page:';

export function pageIpcName(name: string): string {
  return `${PAGE_IPC_PREFIX}${name}`;
}

/** Page -> main one-way messages. Stages 4 and 6 add inspector and design messages here. */
export const pageMessages = {
  ready: z.object({ url: z.string(), title: z.string() }),
  /** Reply to the `ping` event; proves the main -> page -> main round trip. */
  pong: z.object({ nonce: z.string() }),
} as const;

export type PageMessageName = keyof typeof pageMessages;
export type PageMessage<K extends PageMessageName> = z.infer<(typeof pageMessages)[K]>;
/** A validated page message, discriminated by `name`. */
export type PageMessageEnvelope = { [K in PageMessageName]: { name: K; payload: PageMessage<K> } }[PageMessageName];

/** Main -> page events. */
export const pageEvents = {
  ping: z.object({ nonce: z.string() }),
} as const;

export type PageEventName = keyof typeof pageEvents;
export type PageEvent<K extends PageEventName> = z.infer<(typeof pageEvents)[K]>;
