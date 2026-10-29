import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createClient,
  defineChannel,
  defineEvent,
  IpcValidationError,
  ipcName,
  wrapHandler,
  type ClientTransport,
} from './ipc.js';

const channels = {
  'math.add': defineChannel('math.add', z.object({ a: z.number(), b: z.number() }), z.number()),
  'app.ping': defineChannel('app.ping', z.undefined(), z.literal('pong')),
};
const events = {
  'counter.changed': defineEvent('counter.changed', z.object({ value: z.number() })),
};

/** Loopback transport that routes invokes to wrapped handlers, like ipcRenderer -> ipcMain. */
function loopback(handlers: Record<string, (raw: unknown) => Promise<unknown>>) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const transport: ClientTransport = {
    invoke: (name, payload) => {
      const handler = handlers[name];
      if (!handler) return Promise.reject(new Error(`no handler for ${name}`));
      return handler(structuredClone(payload));
    },
    on: (name, listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
  };
  const emit = (name: string, payload: unknown) => {
    for (const l of listeners.get(name) ?? []) l(payload);
  };
  return { transport, emit };
}

describe('wrapHandler', () => {
  it('validates the request and response', async () => {
    const add = wrapHandler(channels['math.add'], ({ a, b }) => a + b);
    await expect(add({ a: 1, b: 2 })).resolves.toBe(3);
    await expect(add({ a: '1', b: 2 })).rejects.toBeInstanceOf(IpcValidationError);
  });

  it('rejects an invalid response from the handler', async () => {
    const bad = wrapHandler(channels['math.add'], () => 'three' as unknown as number);
    const error = await bad({ a: 1, b: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpcValidationError);
    expect((error as IpcValidationError).direction).toBe('response');
  });
});

describe('createClient', () => {
  it('round-trips through a transport with prefixed channel names', async () => {
    const { transport } = loopback({
      [ipcName('math.add')]: wrapHandler(channels['math.add'], ({ a, b }) => a + b),
      [ipcName('app.ping')]: wrapHandler(channels['app.ping'], () => 'pong' as const),
    });
    const client = createClient(channels, events, transport);
    await expect(client.invoke('math.add', { a: 2, b: 3 })).resolves.toBe(5);
    await expect(client.invoke('app.ping')).resolves.toBe('pong');
  });

  it('validates requests before sending', async () => {
    const invoke = vi.fn();
    const client = createClient(channels, events, { invoke, on: () => () => undefined });
    await expect(client.invoke('math.add', { a: 1 } as never)).rejects.toBeInstanceOf(IpcValidationError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates responses on receipt', async () => {
    const client = createClient(channels, events, {
      invoke: () => Promise.resolve('not a number'),
      on: () => () => undefined,
    });
    await expect(client.invoke('math.add', { a: 1, b: 1 })).rejects.toBeInstanceOf(IpcValidationError);
  });

  it('rejects unknown channels and events', async () => {
    const client = createClient(channels, events, { invoke: vi.fn(), on: vi.fn() });
    await expect((client.invoke as (n: string) => Promise<unknown>)('nope')).rejects.toThrow(/Unknown IPC channel/);
    expect(() => (client.on as (n: string, l: () => void) => void)('nope', () => undefined)).toThrow(/Unknown IPC event/);
    await expect((client.invoke as (n: string) => Promise<unknown>)('toString')).rejects.toThrow(/Unknown IPC channel/);
  });

  it('delivers valid events and drops invalid ones', () => {
    const { transport, emit } = loopback({});
    const client = createClient(channels, events, transport);
    const listener = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const off = client.on('counter.changed', listener);
    emit(ipcName('counter.changed'), { value: 1 });
    emit(ipcName('counter.changed'), { value: 'x' });
    off();
    emit(ipcName('counter.changed'), { value: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ value: 1 });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
