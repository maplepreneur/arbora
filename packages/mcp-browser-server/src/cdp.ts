/** The Chrome DevTools Protocol connection to the page (Electron's `webContents.debugger` in Arbora). */
export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Subscribes to CDP events; returns the unsubscribe function. */
  on(listener: (method: string, params: unknown) => void): () => void;
}

/** A tool argument error the agent can fix (bad ref, missing element); reported without a stack. */
export class ToolError extends Error {}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
