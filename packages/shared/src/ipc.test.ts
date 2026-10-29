import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createClient,
  createSubscriber,
  defineChannel,
  defineEvent,
  defineHandler,
  emitEvent,
  IpcValidationError,
} from './ipc';

const add = defineChannel(
  'math:add',
  z.object({ a: z.number(), b: z.number() }),
  z.object({ sum: z.number() }),
);
const ping = defineChannel('app:ping', z.undefined(), z.literal('pong'));
const tick = defineEvent('clock:tick', z.object({ at: z.number() }));

describe('createClient', () => {
  it('validates the request, invokes the transport and validates the response', async () => {
    const invoke = vi.fn(async () => ({ sum: 3 }));
    const client = createClient({ add }, invoke);

    await expect(client.add({ a: 1, b: 2 })).resolves.toEqual({ sum: 3 });
    expect(invoke).toHaveBeenCalledWith('math:add', { a: 1, b: 2 });
  });

  it('rejects invalid requests without calling the transport', async () => {
    const invoke = vi.fn(async () => ({ sum: 3 }));
    const client = createClient({ add }, invoke);

    // @ts-expect-error deliberately wrong type
    await expect(client.add({ a: '1', b: 2 })).rejects.toBeInstanceOf(IpcValidationError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid responses', async () => {
    const client = createClient({ add }, async () => ({ sum: 'three' }));

    const error = await client.add({ a: 1, b: 2 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IpcValidationError);
    expect((error as IpcValidationError).direction).toBe('response');
    expect((error as IpcValidationError).message).toContain('sum');
  });

  it('allows calling channels without a request payload', async () => {
    const client = createClient({ ping }, async () => 'pong');
    await expect(client.ping()).resolves.toBe('pong');
  });
});

describe('defineHandler', () => {
  it('passes the parsed request and context to the handler', async () => {
    const handler = defineHandler(add, ({ a, b }, ctx: { offset: number }) => ({
      sum: a + b + ctx.offset,
    }));

    expect(handler.name).toBe('math:add');
    await expect(handler.handle({ a: 1, b: 2 }, { offset: 10 })).resolves.toEqual({ sum: 13 });
  });

  it('rejects invalid requests before running the handler', async () => {
    const impl = vi.fn(() => ({ sum: 0 }));
    const handler = defineHandler(add, impl);

    await expect(handler.handle({ a: 1 }, undefined)).rejects.toMatchObject({
      direction: 'request',
      channel: 'math:add',
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects handler output that does not match the response schema', async () => {
    const handler = defineHandler(add, () => ({ sum: Number.NaN, extra: true }) as never);
    await expect(handler.handle({ a: 1, b: 2 }, undefined)).rejects.toMatchObject({
      direction: 'response',
    });
  });
});

describe('events', () => {
  it('delivers valid payloads and reports invalid ones', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const onInvalid = vi.fn();
    const subscriber = createSubscriber(
      { tick },
      (name, listener) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
      onInvalid,
    );
    const received: number[] = [];
    const unsubscribe = subscriber.tick(({ at }) => received.push(at));

    listeners.get('clock:tick')?.({ at: 1 });
    listeners.get('clock:tick')?.({ at: 'later' });
    unsubscribe();

    expect(received).toEqual([1]);
    expect(onInvalid).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('validates emitted payloads', () => {
    const send = vi.fn();
    emitEvent(tick, { at: 5 }, send);
    expect(send).toHaveBeenCalledWith('clock:tick', { at: 5 });
    // @ts-expect-error deliberately wrong type
    expect(() => emitEvent(tick, { at: 'now' }, send)).toThrow(IpcValidationError);
  });
});
