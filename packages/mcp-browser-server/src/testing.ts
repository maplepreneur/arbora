import type { Cdp } from './cdp.js';

type Handler = (params: Record<string, unknown>) => unknown;

/** A scripted CDP connection for unit tests: answers by method and records every call. */
export class FakeCdp implements Cdp {
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  private readonly listeners = new Set<(method: string, params: unknown) => void>();

  constructor(private readonly handlers: Record<string, Handler> = {}) {}

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    const handler = this.handlers[method];
    if (!handler) return Promise.resolve({});
    try {
      return Promise.resolve(handler(params));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  on(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) listener(method, params);
  }

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }
}
