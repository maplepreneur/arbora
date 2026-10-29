import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  channels,
  events,
  ipcName,
  wrapHandler,
  type Channels,
  type Events,
  type PayloadOf,
  type ResponseOf,
} from '@arbora/shared';
import type { z } from 'zod';

type ChannelName = keyof Channels;

export type MainHandler<K extends ChannelName> = (
  request: z.output<Channels[K]['request']>,
  event: IpcMainInvokeEvent,
) => Promise<z.input<Channels[K]['response']>> | z.input<Channels[K]['response']>;

/**
 * Registers a validated handler. `isTrusted` rejects calls from any webContents that is not an
 * Arbora app window (e.g. the embedded user page from Stage 1).
 */
export function defineHandler<K extends ChannelName>(
  name: K,
  isTrusted: (sender: WebContents) => boolean,
  handler: MainHandler<K>,
): () => void {
  const channel = channels[name];
  const ipc = ipcName(channel.name);
  ipcMain.handle(ipc, (event, raw: unknown): Promise<ResponseOf<Channels[K]>> => {
    if (!isTrusted(event.sender)) {
      return Promise.reject(new Error(`Untrusted sender for "${channel.name}"`));
    }
    return wrapHandler(channel, (request) => handler(request, event))(raw);
  });
  return () => ipcMain.removeHandler(ipc);
}

/** Validates then sends an event to one renderer. */
export function sendEvent<K extends keyof Events>(target: WebContents, name: K, payload: PayloadOf<Events[K]>): void {
  if (target.isDestroyed()) return;
  const event = events[name];
  const parsed = event.payload.parse(payload);
  target.send(ipcName(event.name), parsed);
}
