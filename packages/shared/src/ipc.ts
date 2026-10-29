import { z } from 'zod';

/** Every Arbora IPC channel name is sent over Electron IPC with this prefix. */
export const IPC_PREFIX = 'arbora:';

export interface ChannelDef<Req extends z.ZodType = z.ZodType, Res extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly request: Req;
  readonly response: Res;
}

export interface EventDef<P extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly payload: P;
}

export function defineChannel<Req extends z.ZodType, Res extends z.ZodType>(
  name: string,
  request: Req,
  response: Res,
): ChannelDef<Req, Res> {
  return { name, request, response };
}

export function defineEvent<P extends z.ZodType>(name: string, payload: P): EventDef<P> {
  return { name, payload };
}

export type ChannelMap = Record<string, ChannelDef>;
export type EventMap = Record<string, EventDef>;

export type RequestOf<C extends ChannelDef> = z.input<C['request']>;
export type ResponseOf<C extends ChannelDef> = z.output<C['response']>;
export type PayloadOf<E extends EventDef> = z.output<E['payload']>;

export class IpcValidationError extends Error {
  constructor(
    readonly channel: string,
    readonly direction: 'request' | 'response' | 'event',
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Invalid ${direction} on "${channel}": ${z.prettifyError(new z.ZodError(issues))}`);
    this.name = 'IpcValidationError';
  }
}

function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  channel: string,
  direction: IpcValidationError['direction'],
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new IpcValidationError(channel, direction, result.error.issues);
  }
  return result.data;
}

export function ipcName(name: string): string {
  return `${IPC_PREFIX}${name}`;
}

export type Handler<C extends ChannelDef> = (
  request: z.output<C['request']>,
) => Promise<z.input<C['response']>> | z.input<C['response']>;

/**
 * Wraps a handler so the request is validated on receipt and the response before it is sent.
 * Transport-neutral: main registers the returned function with `ipcMain.handle`.
 */
export function wrapHandler<C extends ChannelDef>(
  channel: C,
  handler: Handler<C>,
): (raw: unknown) => Promise<ResponseOf<C>> {
  return async (raw) => {
    const request = parseOrThrow<C['request']>(channel.request, raw, channel.name, 'request');
    const response = await handler(request);
    return parseOrThrow<C['response']>(channel.response, response, channel.name, 'response');
  };
}

export function parseEventPayload<E extends EventDef>(event: E, raw: unknown): PayloadOf<E> {
  return parseOrThrow<E['payload']>(event.payload, raw, event.name, 'event');
}

/** Minimal transport the preload implements on top of `ipcRenderer`. */
export interface ClientTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export type ClientInvoke<C extends ChannelMap> = <K extends keyof C & string>(
  name: K,
  ...args: z.input<C[K]['request']> extends undefined ? [request?: RequestOf<C[K]>] : [request: RequestOf<C[K]>]
) => Promise<ResponseOf<C[K]>>;

export type ClientOn<E extends EventMap> = <K extends keyof E & string>(
  name: K,
  listener: (payload: PayloadOf<E[K]>) => void,
) => () => void;

export interface IpcClient<C extends ChannelMap, E extends EventMap> {
  invoke: ClientInvoke<C>;
  on: ClientOn<E>;
}

/**
 * Builds a typed client from the channel registry. Validates the request before sending and the
 * response and event payloads on receipt. Unknown channel names are rejected.
 */
export function createClient<C extends ChannelMap, E extends EventMap>(
  channels: C,
  events: E,
  transport: ClientTransport,
): IpcClient<C, E> {
  const invoke = async (name: string, request?: unknown): Promise<unknown> => {
    const channel = Object.hasOwn(channels, name) ? channels[name] : undefined;
    if (!channel) {
      throw new Error(`Unknown IPC channel "${name}"`);
    }
    const validRequest = parseOrThrow(channel.request, request, channel.name, 'request');
    const raw = await transport.invoke(ipcName(channel.name), validRequest);
    return parseOrThrow(channel.response, raw, channel.name, 'response');
  };

  const on = (name: string, listener: (payload: unknown) => void): (() => void) => {
    const event = Object.hasOwn(events, name) ? events[name] : undefined;
    if (!event) {
      throw new Error(`Unknown IPC event "${name}"`);
    }
    return transport.on(ipcName(event.name), (raw) => {
      const result = event.payload.safeParse(raw);
      if (result.success) {
        listener(result.data);
      } else {
        console.error(new IpcValidationError(event.name, 'event', result.error.issues).message);
      }
    });
  };

  // The generic signatures are enforced by the IpcClient type; the implementation is untyped by name.
  return { invoke: invoke as ClientInvoke<C>, on: on as ClientOn<E> };
}
