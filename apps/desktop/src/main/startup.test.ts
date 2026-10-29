import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeChromiumSwitches, parseArboraFlags, parseProjectArg } from './startup';

describe('parseArboraFlags', () => {
  it('splits switches and values', () => {
    expect(parseArboraFlags(' --disable-gpu-sandbox  --ozone-platform=x11 ')).toEqual([
      { name: 'disable-gpu-sandbox' },
      { name: 'ozone-platform', value: 'x11' },
    ]);
    expect(parseArboraFlags(undefined)).toEqual([]);
    expect(parseArboraFlags('')).toEqual([]);
  });
});

describe('computeChromiumSwitches', () => {
  it('enables native Wayland on Linux only', () => {
    expect(computeChromiumSwitches('linux', undefined)).toEqual([
      { name: 'ozone-platform-hint', value: 'auto' },
      { name: 'enable-features', value: 'WaylandWindowDecorations' },
    ]);
    expect(computeChromiumSwitches('darwin', undefined)).toEqual([]);
    expect(computeChromiumSwitches('win32', undefined)).toEqual([]);
  });

  it('lets ARBORA_FLAGS override switches and merges enable-features', () => {
    expect(
      computeChromiumSwitches(
        'linux',
        '--ozone-platform-hint=x11 --enable-features=VaapiVideoDecoder --disable-gpu-sandbox',
      ),
    ).toEqual([
      { name: 'ozone-platform-hint', value: 'x11' },
      { name: 'disable-gpu-sandbox' },
      { name: 'enable-features', value: 'WaylandWindowDecorations,VaapiVideoDecoder' },
    ]);
  });
});

describe('parseProjectArg', () => {
  const cwd = resolve('/home/me');

  it('reads the first positional argument of a packaged app', () => {
    expect(parseProjectArg(['/opt/arbora/arbora', '--no-sandbox', 'site'], false, cwd)).toBe(
      resolve(cwd, 'site'),
    );
  });

  it('skips the app entry when running unpackaged', () => {
    expect(parseProjectArg(['electron', 'out/main/index.js', '/srv/app'], true, cwd)).toBe(
      resolve('/srv/app'),
    );
    expect(parseProjectArg(['electron', '.', '--class=arbora'], true, cwd)).toBeUndefined();
  });
});
