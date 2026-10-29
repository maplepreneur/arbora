import { describe, expect, it } from 'vitest';
import {
  formatConsoleArgs,
  fromConsoleApiCalled,
  fromExceptionThrown,
  fromLogEntryAdded,
  NetworkTracker,
} from './cdp-problems.js';

const str = (value: string) => ({ type: 'string', value });
const num = (value: number) => ({ type: 'number', value, description: String(value) });

describe('formatConsoleArgs', () => {
  it('joins arguments like the DevTools console', () => {
    expect(formatConsoleArgs([str('a'), num(1), { type: 'undefined' }, { type: 'object', subtype: 'null' }])).toBe(
      'a 1 undefined null',
    );
    expect(formatConsoleArgs([{ type: 'object', className: 'Object', description: 'Object' }])).toBe('Object');
  });

  it('applies printf-style substitutions and drops %c styles', () => {
    expect(formatConsoleArgs([str('%s has %d items%%'), str('cart'), num(3.7)])).toBe('cart has 3 items%');
    expect(formatConsoleArgs([str('%cstyled'), str('color: red'), str('extra')])).toBe('styled extra');
    expect(formatConsoleArgs([str('missing %s')])).toBe('missing %s');
  });
});

describe('fromConsoleApiCalled', () => {
  it('maps level, message and the first frame with a URL (1-based)', () => {
    const entry = fromConsoleApiCalled({
      type: 'error',
      args: [str('fixture: intentional error')],
      timestamp: 1700000000000,
      executionContextId: 1,
      stackTrace: {
        callFrames: [
          { url: '', lineNumber: 0, columnNumber: 0, functionName: '' },
          { url: 'http://localhost:5173/src/App.tsx', lineNumber: 21, columnNumber: 30, functionName: 'onAction' },
        ],
      },
    });
    expect(entry).toEqual({
      source: 'console',
      level: 'error',
      message: 'fixture: intentional error',
      timestamp: 1700000000000,
      url: 'http://localhost:5173/src/App.tsx',
      line: 22,
      column: 31,
    });
  });

  it('skips extension and dev-server frames that wrap console', () => {
    const frame = (url: string) => ({ url, lineNumber: 0, columnNumber: 0, functionName: '' });
    const at = (urls: string[]) =>
      fromConsoleApiCalled({ type: 'error', args: [], timestamp: 0, stackTrace: { callFrames: urls.map(frame) } })?.url;
    expect(at(['chrome-extension://abc/build/installHook.js', 'http://localhost:5173/src/App.tsx'])).toBe(
      'http://localhost:5173/src/App.tsx',
    );
    expect(
      at([
        'chrome-extension://abc/build/installHook.js',
        'http://localhost:5173/@vite/client',
        'http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1',
        'http://localhost:5173/src/App.tsx',
      ]),
    ).toBe('http://localhost:5173/src/App.tsx');
    expect(at(['chrome-extension://abc/build/installHook.js'])).toBe('chrome-extension://abc/build/installHook.js');
  });

  it('maps console types to levels', () => {
    const level = (type: string) => fromConsoleApiCalled({ type, args: [], timestamp: 0 })?.level;
    expect(level('warning')).toBe('warning');
    expect(level('log')).toBe('info');
    expect(level('debug')).toBe('debug');
    expect(level('assert')).toBe('error');
  });

  it('ignores malformed params and Electron security warnings', () => {
    expect(fromConsoleApiCalled({ type: 'log' })).toBeUndefined();
    const warning = '%cElectron Security Warning (Insecure Content-Security-Policy)';
    expect(
      fromConsoleApiCalled({
        type: 'warning',
        args: [str(warning), str('font-weight: bold;'), str('...')],
        timestamp: 0,
      }),
    ).toBeUndefined();
  });
});

describe('fromExceptionThrown', () => {
  it('uses the first line of the exception description', () => {
    const entry = fromExceptionThrown({
      timestamp: 5,
      exceptionDetails: {
        text: 'Uncaught',
        lineNumber: 9,
        columnNumber: 4,
        url: 'http://localhost:5173/main.js',
        exception: { type: 'object', subtype: 'error', description: 'Error: boom\n    at main.js:10:5' },
      },
    });
    expect(entry).toEqual({
      source: 'exception',
      level: 'error',
      message: 'Uncaught Error: boom',
      timestamp: 5,
      url: 'http://localhost:5173/main.js',
      line: 10,
      column: 5,
    });
  });
});

describe('fromLogEntryAdded', () => {
  it('keeps browser log entries but skips network ones', () => {
    expect(
      fromLogEntryAdded({ entry: { source: 'security', level: 'error', text: 'Mixed content', timestamp: 1 } }),
    ).toEqual({ source: 'browser', level: 'error', message: 'Mixed content', timestamp: 1 });
    expect(
      fromLogEntryAdded({ entry: { source: 'network', level: 'error', text: 'Failed to load', timestamp: 1 } }),
    ).toBeUndefined();
    const text = 'Electron Security Warning (Insecure Content-Security-Policy) This renderer process has...';
    expect(
      fromLogEntryAdded({ entry: { source: 'javascript', level: 'warning', text, timestamp: 1 } }),
    ).toBeUndefined();
  });
});

describe('NetworkTracker', () => {
  it('reports HTTP errors with the request method', () => {
    const tracker = new NetworkTracker(() => 42);
    tracker.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'http://x/a', method: 'POST' } });
    expect(
      tracker.handle('Network.responseReceived', {
        requestId: '1',
        response: { url: 'http://x/a', status: 404, statusText: 'Not Found' },
      }),
    ).toEqual({
      source: 'network',
      level: 'error',
      message: '404 Not Found',
      timestamp: 42,
      url: 'http://x/a',
      method: 'POST',
      status: 404,
    });
    expect(
      tracker.handle('Network.responseReceived', { requestId: '2', response: { url: 'http://x/b', status: 200 } }),
    ).toBeUndefined();
  });

  it('reports failed requests but not cancelled ones', () => {
    const tracker = new NetworkTracker(() => 7);
    tracker.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'http://x/api', method: 'GET' } });
    tracker.handle('Network.requestWillBeSent', { requestId: '2', request: { url: 'http://x/hmr', method: 'GET' } });
    expect(
      tracker.handle('Network.loadingFailed', { requestId: '1', errorText: 'net::ERR_CONNECTION_REFUSED' }),
    ).toEqual({
      source: 'network',
      level: 'error',
      message: 'net::ERR_CONNECTION_REFUSED',
      timestamp: 7,
      url: 'http://x/api',
      method: 'GET',
    });
    expect(
      tracker.handle('Network.loadingFailed', { requestId: '2', errorText: 'net::ERR_ABORTED', canceled: true }),
    ).toBeUndefined();
    expect(
      tracker.handle('Network.loadingFailed', { requestId: '99', errorText: 'net::ERR_CACHE_MISS' }),
    ).toBeUndefined();
  });
});
