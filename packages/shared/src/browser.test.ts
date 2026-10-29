import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  isLocalHostname,
  normalizeUrl,
  RingBuffer,
  roundRect,
  stepZoom,
  urlSecurity,
  VIEWPORT_PRESETS,
} from './browser.js';

describe('normalizeUrl', () => {
  it('defaults bare hosts to http', () => {
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeUrl('  localhost:5173/about?x=1 ')).toBe('http://localhost:5173/about?x=1');
    expect(normalizeUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
    expect(normalizeUrl('example.com')).toBe('http://example.com/');
  });

  it('keeps explicit http and https URLs', () => {
    expect(normalizeUrl('https://localhost:5173/')).toBe('https://localhost:5173/');
    expect(normalizeUrl('HTTP://Example.com/a')).toBe('http://example.com/a');
  });

  it('rewrites wildcard bind addresses to localhost', () => {
    expect(normalizeUrl('0.0.0.0:5173')).toBe('http://localhost:5173/');
    expect(normalizeUrl('http://[::]:4000/x')).toBe('http://localhost:4000/x');
  });

  it('rejects other schemes and junk', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('two words')).toBeNull();
    expect(normalizeUrl('http://')).toBeNull();
  });
});

describe('isLocalHostname / urlSecurity', () => {
  it('recognises loopback hosts', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]', 'app.localhost', '0.0.0.0']) {
      expect(isLocalHostname(host)).toBe(true);
    }
    for (const host of ['example.com', '10.0.0.1', 'localhost.example.com', '128.0.0.1']) {
      expect(isLocalHostname(host)).toBe(false);
    }
  });

  it('classifies URLs for the URL bar badge', () => {
    expect(urlSecurity('http://localhost:5173/')).toBe('local');
    expect(urlSecurity('https://example.com/')).toBe('secure');
    expect(urlSecurity('http://example.com/')).toBe('insecure');
    expect(urlSecurity('')).toBe('none');
    expect(urlSecurity('about:blank')).toBe('none');
  });
});

describe('fitViewport', () => {
  const area = { x: 10.4, y: 20.6, width: 800, height: 600 };

  it('fills the area for the responsive preset', () => {
    expect(fitViewport(area, 'responsive')).toEqual({ rect: roundRect(area), emulation: null });
  });

  it('centres a preset that fits at 1:1', () => {
    const { rect, emulation } = fitViewport({ x: 0, y: 0, width: 1000, height: 1000 }, 'mobile');
    expect(rect).toEqual({ x: 305, y: 78, width: 390, height: 844 });
    expect(emulation).toEqual({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true, scale: 1 });
  });

  it('scales a preset down to fit, never up', () => {
    const { rect, emulation } = fitViewport({ x: 0, y: 0, width: 960, height: 2000 }, 'desktop');
    expect(emulation?.scale).toBe(0.5);
    expect(rect).toEqual({ x: 0, y: 730, width: 960, height: 540 });
    expect(emulation?.width).toBe(1920);
  });

  it('defines every preset id once', () => {
    const ids = VIEWPORT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roundRect', () => {
  it('rounds edges rather than sizes so adjacent rects do not gap', () => {
    expect(roundRect({ x: 0.5, y: 0.4, width: 10.2, height: 10.2 })).toEqual({ x: 1, y: 0, width: 10, height: 11 });
  });
});

describe('RingBuffer', () => {
  it('keeps the newest entries up to capacity', () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) buffer.push(i);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
    buffer.clear();
    expect(buffer.toArray()).toEqual([]);
  });

  it('rejects invalid capacities', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});

describe('stepZoom', () => {
  it('moves between Chromium zoom levels and clamps at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.05, -1)).toBe(1);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
});
