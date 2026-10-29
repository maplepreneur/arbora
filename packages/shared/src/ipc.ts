import type { z } from 'zod';

export interface ChannelDef<Req extends z.ZodType = z.ZodType, Res extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly request: Req;
  readonly response: Res;
}

export interface EventDef<Payload extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly payload: Payload;
}

export function defineChannel<Req extends z.ZodType, Res extends z.ZodType>(
  name: string,
  request: Req,
  response: Res,
): ChannelDef<Req, Res> {
  return { name, request, response };
}

export function defineEvent<Payload extends z.ZodType>(
  name: string,
  payload: Payload,
): EventDef<Payload> {
  return { name, payload };
}

export type IpcDirection = 'request' | 'response' | 'event';

export class IpcValidationError extends Error {
  readonly channel: string;
  readonly direction: IpcDirection;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(channel: string, direction: IpcDirection, issues: readonly z.core.$ZodIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    super(`Invalid ${direction} on IPC channel "${channel}": ${summary}`);
    this.name = 'IpcValidationError';
    this.channel = channel;
    this.direction = direction;
    this.issues = issues;
  }
}

function validate<T extends z.ZodType>(
  schema: T,
  value: unknown,
  channel: string,
  direction: IpcDirection,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new IpcValidationError(channel, direction, result.error.issues);
  }
  return result.data;
}

export type ChannelRequest<C extends ChannelDef> = z.input<C['request']>;
export type ChannelResponse<C extends ChannelDef> = z.output<C['response']>;
export type EventPayload<E extends EventDef> = z.output<E['payload']>;

export type ChannelMap = Readonly<Record<string, ChannelDef>>;
export type EventMap = Readonly<Record<string, EventDef>>;

type ClientMethod<C extends ChannelDef> =
  undefined extends ChannelRequest<C>
    ? (request?: ChannelRequest<C>) => Promise<ChannelResponse<C>>
    : (request: ChannelRequest<C>) => Promise<ChannelResponse<C>>;

export type IpcClient<M extends ChannelMap> = { readonly [K in keyof M]: ClientMethod<M[K]> };

export type IpcSubscriber<M extends EventMap> = {
  readonly [K in keyof M]: (listener: (payload: EventPayload<M[K]>) => void) => () => void;
};

export type InvokeTransport = (channel: string, payload: unknown) => Promise<unknown>;
export type SubscribeTransport = (
  event: string,
  listener: (payload: unknown) => void,
) => () => void;
export type SendTransport = (event: string, payload: unknown) => void;

/** Builds a typed client that validates requests before sending and responses on arrival. */
export function createClient<M extends ChannelMap>(
  channels: M,
  invoke: InvokeTransport,
): IpcClient<M> {
  const client: Record<string, (request?: unknown) => Promise<unknown>> = {};
  for (const [key, channel] of Object.entries(channels)) {
    client[key] = async (request?: unknown) => {
      const payload = validate(channel.request, request, channel.name, 'request');
      const response = await invoke(channel.name, payload);
      return validate(channel.response, response, channel.name, 'response');
    };
  }
  return client as IpcClient<M>;
}

/** Builds typed event subscriptions that drop (and report) payloads failing validation. */
export function createSubscriber<M extends EventMap>(
  events: M,
  subscribe: SubscribeTransport,
  onInvalid: (error: IpcValidationError) => void,
): IpcSubscriber<M> {
  const subscriber: Record<string, (listener: (payload: unknown) => void) => () => void> = {};
  for (const [key, event] of Object.entries(events)) {
    subscriber[key] = (listener) =>
      subscribe(event.name, (raw) => {
        const result = event.payload.safeParse(raw);
        if (result.success) {
          listener(result.data);
        } else {
          onInvalid(new IpcValidationError(event.name, 'event', result.error.issues));
        }
      });
  }
  return subscriber as IpcSubscriber<M>;
}

export interface RegisteredHandler<Ctx> {
  readonly name: string;
  handle(raw: unknown, context: Ctx): Promise<unknown>;
}

/** Wraps a handler so both its input and its output are validated against the channel schemas. */
export function defineHandler<C extends ChannelDef, Ctx>(
  channel: C,
  handler: (
    request: z.output<C['request']>,
    context: Ctx,
  ) => ChannelResponse<C> | Promise<ChannelResponse<C>>,
): RegisteredHandler<Ctx> {
  return {
    name: channel.name,
    async handle(raw, context) {
      const request = validate<C['request']>(channel.request, raw, channel.name, 'request');
      const response = await handler(request, context);
      return validate(channel.response, response, channel.name, 'response');
    },
  };
}

export function emitEvent<E extends EventDef>(
  event: E,
  payload: z.input<E['payload']>,
  send: SendTransport,
): void {
  send(event.name, validate(event.payload, payload, event.name, 'event'));
}
