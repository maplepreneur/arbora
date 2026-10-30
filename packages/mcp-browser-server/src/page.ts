import { sleep, ToolError, type Cdp } from './cdp.js';

export const EVALUATE_TIMEOUT_MS = 5000;
/** Results longer than this are cut so one call cannot flood the agent's context. */
export const RESULT_TEXT_LIMIT = 20_000;
/** The network counts as idle after this long without a request in flight. */
export const NETWORK_IDLE_MS = 500;
const POLL_MS = 100;

/**
 * Counts in-flight requests from CDP `Network.*` events (the browser panel enables the domain), for
 * `browser_wait_for { networkIdle }`. Long-lived connections (HMR websockets, event streams) are
 * not requests in this sense and are ignored.
 */
export class InflightRequests {
  private readonly inflight = new Set<string>();
  private lastChange = Date.now();

  constructor(private readonly now: () => number = () => Date.now()) {
    this.lastChange = now();
  }

  handle(method: string, params: unknown): void {
    const p = params as { requestId?: unknown; type?: unknown; frameId?: unknown } | null;
    const requestId = typeof p?.requestId === 'string' ? p.requestId : null;
    if (!requestId) return;
    switch (method) {
      case 'Network.requestWillBeSent':
        if (p?.type === 'EventSource' || p?.type === 'WebSocket') return;
        this.inflight.add(requestId);
        this.lastChange = this.now();
        break;
      case 'Network.loadingFinished':
      case 'Network.loadingFailed':
        if (this.inflight.delete(requestId)) this.lastChange = this.now();
        break;
      default:
        break;
    }
  }

  /** A new document drops the previous page's requests. */
  reset(): void {
    this.inflight.clear();
    this.lastChange = this.now();
  }

  get count(): number {
    return this.inflight.size;
  }

  idleFor(): number {
    return this.inflight.size > 0 ? 0 : this.now() - this.lastChange;
  }
}

export interface WaitCondition {
  readonly selector?: string | undefined;
  readonly text?: string | undefined;
  readonly textGone?: string | undefined;
  readonly networkIdle?: boolean | undefined;
}

async function evaluateBoolean(cdp: Cdp, expression: string): Promise<boolean> {
  try {
    const { result } = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      result: { value?: unknown };
    };
    return result.value === true;
  } catch {
    // Mid-navigation there is no context to evaluate in; the next poll retries.
    return false;
  }
}

/** Polls until every given condition holds; resolves with how long it took. */
export async function waitFor(
  cdp: Cdp,
  network: InflightRequests,
  condition: WaitCondition,
  timeoutMs: number,
): Promise<number> {
  const { selector, text, textGone, networkIdle } = condition;
  if (!selector && text === undefined && textGone === undefined && !networkIdle) {
    throw new ToolError('Pass at least one of selector, text, textGone or networkIdle.');
  }
  const started = Date.now();
  const checks: (() => Promise<boolean>)[] = [];
  if (selector) checks.push(() => evaluateBoolean(cdp, `!!document.querySelector(${JSON.stringify(selector)})`));
  if (text !== undefined) {
    checks.push(() =>
      evaluateBoolean(cdp, `!!document.body && document.body.innerText.includes(${JSON.stringify(text)})`),
    );
  }
  if (textGone !== undefined) {
    checks.push(() =>
      evaluateBoolean(cdp, `!!document.body && !document.body.innerText.includes(${JSON.stringify(textGone)})`),
    );
  }
  if (networkIdle) checks.push(() => Promise.resolve(network.idleFor() >= NETWORK_IDLE_MS));
  for (;;) {
    const results = await Promise.all(checks.map((check) => check()));
    if (results.every(Boolean)) return Date.now() - started;
    if (Date.now() - started >= timeoutMs) {
      const pending = [
        selector && `selector ${selector}`,
        text !== undefined && `text ${JSON.stringify(text)}`,
        textGone !== undefined && `text ${JSON.stringify(textGone)} to disappear`,
        networkIdle && `network idle (${network.count} requests in flight)`,
      ].filter(Boolean);
      throw new ToolError(`Timed out after ${timeoutMs} ms waiting for ${pending.join(', ')}`);
    }
    await sleep(POLL_MS);
  }
}

export function truncate(text: string, limit = RESULT_TEXT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text;
}

/** Runs `expression` in the page's main world and returns its JSON value as text. */
export async function evaluate(cdp: Cdp, expression: string, timeoutMs = EVALUATE_TIMEOUT_MS): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ToolError(`The expression did not finish within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const response = (await Promise.race([
      cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
        timeout: timeoutMs,
      }),
      timeout,
    ])) as {
      result: { type: string; value?: unknown; description?: string; unserializableValue?: string };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      throw new ToolError(`The page threw: ${detail.exception?.description ?? detail.text ?? 'unknown error'}`);
    }
    const { result } = response;
    if (result.type === 'undefined') return 'undefined';
    if (result.unserializableValue !== undefined) return result.unserializableValue;
    if (result.value === undefined) return result.description ?? result.type;
    return truncate(JSON.stringify(result.value, null, 2));
  } finally {
    clearTimeout(timer);
  }
}
