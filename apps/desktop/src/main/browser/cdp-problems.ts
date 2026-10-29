import { z } from 'zod';
import type { ProblemEntry, ProblemLevel } from '@arbora/shared';

/** A problem entry before `BrowserService` assigns its id. */
export type ProblemDraft = Omit<ProblemEntry, 'id'>;

const MAX_MESSAGE_LENGTH = 4000;

const remoteObjectSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  value: z.unknown().optional(),
  unserializableValue: z.string().optional(),
  description: z.string().optional(),
  className: z.string().optional(),
});
type RemoteObject = z.infer<typeof remoteObjectSchema>;

const callFrameSchema = z.looseObject({
  url: z.string(),
  lineNumber: z.number(),
  columnNumber: z.number(),
});

const stackTraceSchema = z.looseObject({ callFrames: z.array(callFrameSchema) });

const consoleApiCalledSchema = z.looseObject({
  type: z.string(),
  args: z.array(remoteObjectSchema),
  timestamp: z.number(),
  stackTrace: stackTraceSchema.optional(),
});

const exceptionThrownSchema = z.looseObject({
  timestamp: z.number(),
  exceptionDetails: z.looseObject({
    text: z.string(),
    lineNumber: z.number(),
    columnNumber: z.number(),
    url: z.string().optional(),
    stackTrace: stackTraceSchema.optional(),
    exception: remoteObjectSchema.optional(),
  }),
});

const logEntryAddedSchema = z.looseObject({
  entry: z.looseObject({
    source: z.string(),
    level: z.string(),
    text: z.string(),
    timestamp: z.number(),
    url: z.string().optional(),
    lineNumber: z.number().optional(),
  }),
});

const requestWillBeSentSchema = z.looseObject({
  requestId: z.string(),
  request: z.looseObject({ url: z.string(), method: z.string() }),
});

const responseReceivedSchema = z.looseObject({
  requestId: z.string(),
  response: z.looseObject({ url: z.string(), status: z.number(), statusText: z.string().optional() }),
});

const loadingFailedSchema = z.looseObject({
  requestId: z.string(),
  errorText: z.string(),
  canceled: z.boolean().optional(),
  blockedReason: z.string().optional(),
});

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

/** Renders a console argument roughly the way the DevTools console does on one line. */
export function describeRemoteObject(object: RemoteObject): string {
  if (object.unserializableValue !== undefined) return object.unserializableValue;
  switch (object.type) {
    case 'string':
      return typeof object.value === 'string' ? object.value : '';
    case 'number':
    case 'boolean':
    case 'bigint':
      return object.description ?? String(object.value);
    case 'undefined':
      return 'undefined';
    case 'symbol':
    case 'function':
      return object.description ?? object.type;
    case 'object':
      if (object.subtype === 'null') return 'null';
      return object.description ?? object.className ?? 'Object';
    default:
      return object.description ?? object.type;
  }
}

/** Applies `%s`/`%d`/`%i`/`%f`/`%o`/`%O`/`%c` substitutions from the first string argument. */
export function formatConsoleArgs(args: readonly RemoteObject[]): string {
  const [first, ...rest] = args;
  if (!first) return '';
  if (first.type !== 'string' || typeof first.value !== 'string') {
    return args.map(describeRemoteObject).join(' ');
  }
  const remaining = [...rest];
  const head = first.value.replace(/%([sdifoOc%])/g, (match, spec: string) => {
    if (spec === '%') return '%';
    const next = remaining.shift();
    if (!next) return match;
    if (spec === 'c') return '';
    const text = describeRemoteObject(next);
    if (spec === 'd' || spec === 'i') return String(Math.trunc(Number(text)));
    if (spec === 'f') return String(Number(text));
    return text;
  });
  return [head, ...remaining.map(describeRemoteObject)].join(' ');
}

export function consoleLevel(type: string): ProblemLevel {
  switch (type) {
    case 'error':
    case 'assert':
      return 'error';
    case 'warning':
      return 'warning';
    case 'debug':
      return 'debug';
    default:
      return 'info';
  }
}

function logLevel(level: string): ProblemLevel {
  switch (level) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'verbose':
      return 'debug';
    default:
      return 'info';
  }
}

const ELECTRON_SECURITY_WARNING = 'Electron Security Warning';

const TOOLING_FRAME = /^chrome-extension:\/\/|\/@vite\/|\/@react-refresh|\/node_modules\//;

function isToolingFrame(url: string): boolean {
  return TOOLING_FRAME.test(url);
}

function location(stack: z.infer<typeof stackTraceSchema> | undefined): Pick<ProblemDraft, 'url' | 'line' | 'column'> {
  const frames = stack?.callFrames.filter((f) => f.url.length > 0) ?? [];
  // DevTools extensions and dev servers wrap `console`, so their frames sit on top of the call site.
  const frame = frames.find((f) => !isToolingFrame(f.url)) ?? frames[0];
  if (!frame) return {};
  return { url: frame.url, line: frame.lineNumber + 1, column: frame.columnNumber + 1 };
}

export function fromConsoleApiCalled(params: unknown): ProblemDraft | undefined {
  const parsed = consoleApiCalledSchema.safeParse(params);
  if (!parsed.success) return undefined;
  const { type, args, timestamp, stackTrace } = parsed.data;
  const formatted = formatConsoleArgs(args);
  // Electron logs these into every page of an unpackaged app; they are about Arbora, not the page.
  if (formatted.startsWith(ELECTRON_SECURITY_WARNING)) return undefined;
  return {
    source: 'console',
    level: consoleLevel(type),
    message: truncate(type === 'assert' ? `Assertion failed: ${formatted}` : formatted),
    timestamp,
    ...location(stackTrace),
  };
}

export function fromExceptionThrown(params: unknown): ProblemDraft | undefined {
  const parsed = exceptionThrownSchema.safeParse(params);
  if (!parsed.success) return undefined;
  const { timestamp, exceptionDetails: details } = parsed.data;
  const description = details.exception ? describeRemoteObject(details.exception) : '';
  const firstLine = description.split('\n')[0] ?? '';
  const message = firstLine ? `${details.text} ${firstLine}` : details.text;
  const fromStack = location(details.stackTrace);
  return {
    source: 'exception',
    level: 'error',
    message: truncate(message),
    timestamp,
    ...(details.url ? { url: details.url, line: details.lineNumber + 1, column: details.columnNumber + 1 } : fromStack),
  };
}

export function fromLogEntryAdded(params: unknown): ProblemDraft | undefined {
  const parsed = logEntryAddedSchema.safeParse(params);
  if (!parsed.success) return undefined;
  const { entry } = parsed.data;
  // Failed requests are reported from Network events with method and status instead.
  if (entry.source === 'network') return undefined;
  return {
    source: 'browser',
    level: logLevel(entry.level),
    message: truncate(entry.text),
    timestamp: entry.timestamp,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.url && entry.lineNumber !== undefined ? { line: entry.lineNumber + 1 } : {}),
  };
}

const MAX_TRACKED_REQUESTS = 2000;

/**
 * Turns Network domain events into problem entries for failed requests and HTTP errors. Only
 * metadata is kept; bodies are never read.
 */
export class NetworkTracker {
  private readonly requests = new Map<string, { url: string; method: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  handle(method: string, params: unknown): ProblemDraft | undefined {
    switch (method) {
      case 'Network.requestWillBeSent': {
        const parsed = requestWillBeSentSchema.safeParse(params);
        if (!parsed.success) return undefined;
        this.requests.set(parsed.data.requestId, parsed.data.request);
        if (this.requests.size > MAX_TRACKED_REQUESTS) {
          const oldest = this.requests.keys().next();
          if (!oldest.done) this.requests.delete(oldest.value);
        }
        return undefined;
      }
      case 'Network.responseReceived': {
        const parsed = responseReceivedSchema.safeParse(params);
        if (!parsed.success) return undefined;
        const { response, requestId } = parsed.data;
        if (response.status < 400) return undefined;
        const request = this.requests.get(requestId);
        const statusText = response.statusText ? ` ${response.statusText}` : '';
        return {
          source: 'network',
          level: 'error',
          message: `${response.status}${statusText}`,
          timestamp: this.now(),
          url: response.url,
          method: request?.method ?? 'GET',
          status: response.status,
        };
      }
      case 'Network.loadingFinished':
        if (typeof params === 'object' && params !== null && 'requestId' in params) {
          this.requests.delete(String(params.requestId));
        }
        return undefined;
      case 'Network.loadingFailed': {
        const parsed = loadingFailedSchema.safeParse(params);
        if (!parsed.success) return undefined;
        const request = this.requests.get(parsed.data.requestId);
        this.requests.delete(parsed.data.requestId);
        // Aborted requests (navigations away, HMR reconnects, AbortController) are not problems, nor
        // are requests the page never sent (DevTools re-reads resources from cache when it opens).
        if (parsed.data.canceled || !request) return undefined;
        const blocked = parsed.data.blockedReason ? ` (blocked: ${parsed.data.blockedReason})` : '';
        return {
          source: 'network',
          level: 'error',
          message: `${parsed.data.errorText}${blocked}`,
          timestamp: this.now(),
          url: request.url,
          method: request.method,
        };
      }
      default:
        return undefined;
    }
  }

  reset(): void {
    this.requests.clear();
  }
}
