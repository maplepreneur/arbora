import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectTilingCompositor,
  parseArboraFlags,
  parseProjectArg,
  shouldQuitWhenAllWindowsClosed,
  shouldRestoreBounds,
  startupSwitches,
} from './startup.js';

describe('shouldQuitWhenAllWindowsClosed', () => {
  it('always quits on Linux and Windows', () => {
    expect(shouldQuitWhenAllWindowsClosed('linux', false)).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed('win32', false)).toBe(true);
  });

  it('follows the setting on macOS', () => {
    expect(shouldQuitWhenAllWindowsClosed('darwin', true)).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed('darwin', false)).toBe(false);
  });
});

describe('parseArboraFlags', () => {
  it('parses space-separated switches with optional values', () => {
    expect(parseArboraFlags('  --disable-gpu-sandbox --ozone-platform=x11  -foo ')).toEqual([
      { name: 'disable-gpu-sandbox' },
      { name: 'ozone-platform', value: 'x11' },
      { name: 'foo' },
    ]);
    expect(parseArboraFlags(undefined)).toEqual([]);
    expect(parseArboraFlags('')).toEqual([]);
  });
});

describe('startupSwitches', () => {
  it('enables native Wayland on Linux', () => {
    expect(startupSwitches('linux', undefined)).toEqual([
      { name: 'ozone-platform-hint', value: 'auto' },
      { name: 'enable-features', value: 'WaylandWindowDecorations' },
    ]);
  });

  it('adds nothing on macOS and Windows unless asked', () => {
    expect(startupSwitches('darwin', undefined)).toEqual([]);
    expect(startupSwitches('win32', '--disable-gpu')).toEqual([{ name: 'disable-gpu' }]);
  });

  it('lets ARBORA_FLAGS override the platform hint and merges features', () => {
    expect(startupSwitches('linux', '--ozone-platform=x11 --enable-features=Foo,Bar --disable-gpu-sandbox')).toEqual([
      { name: 'ozone-platform', value: 'x11' },
      { name: 'disable-gpu-sandbox' },
      { name: 'enable-features', value: 'WaylandWindowDecorations,Foo,Bar' },
    ]);
  });
});

describe('tiling compositor handling', () => {
  it('detects Hyprland, Sway and XDG_CURRENT_DESKTOP values on Linux only', () => {
    expect(detectTilingCompositor('linux', { HYPRLAND_INSTANCE_SIGNATURE: 'abc' })).toBe('hyprland');
    expect(detectTilingCompositor('linux', { SWAYSOCK: '/run/sway' })).toBe('sway');
    expect(detectTilingCompositor('linux', { XDG_CURRENT_DESKTOP: 'Hyprland' })).toBe('hyprland');
    expect(detectTilingCompositor('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBeNull();
    expect(detectTilingCompositor('darwin', { HYPRLAND_INSTANCE_SIGNATURE: 'abc' })).toBeNull();
  });

  it('skips bounds restore only under a Linux tiling compositor', () => {
    expect(shouldRestoreBounds('linux', 'hyprland')).toBe(false);
    expect(shouldRestoreBounds('linux', null)).toBe(true);
    expect(shouldRestoreBounds('darwin', null)).toBe(true);
    expect(shouldRestoreBounds('win32', null)).toBe(true);
  });
});

describe('parseProjectArg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbora-cli-'));
  const file = join(dir, 'file.txt');
  writeFileSync(file, 'x');

  it('skips the entry script when running as electron <entry>', () => {
    expect(parseProjectArg(['/electron', '.', dir], '/', true)).toBe(dir);
    expect(parseProjectArg(['/electron', dir], '/', true)).toBeNull();
  });

  it('skips the entry even when switches come before it (second-instance argv in dev)', () => {
    expect(parseProjectArg(['/electron', '--class=arbora', '--enable-features=X', '.', '--', dir], '/', true)).toBe(
      dir,
    );
    expect(parseProjectArg(['/electron', '--class=arbora', '.'], dir, true)).toBeNull();
  });

  it('uses the first directory argument in packaged builds', () => {
    expect(parseProjectArg(['/opt/arbora/arbora', '--no-sandbox', dir], '/', false)).toBe(dir);
  });

  it('resolves relative paths against the cwd and ignores files and switches', () => {
    expect(parseProjectArg(['/arbora', '--class=arbora', 'file.txt', '.'], dir, false)).toBe(dir);
    expect(parseProjectArg(['/arbora', file, '--flag'], '/', false)).toBeNull();
    expect(parseProjectArg(['/arbora', join(dir, 'missing')], '/', false)).toBeNull();
  });
});
