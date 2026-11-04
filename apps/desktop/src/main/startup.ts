import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Platform } from '@arbora/shared';

export interface ChromiumSwitch {
  readonly name: string;
  readonly value?: string;
}

/** Parses `ARBORA_FLAGS` (space-separated Chromium switches such as `--disable-gpu-sandbox --ozone-platform=x11`). */
export function parseArboraFlags(raw: string | undefined): ChromiumSwitch[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^--?/, ''))
    .filter((token) => token.length > 0)
    .map((token) => {
      const eq = token.indexOf('=');
      return eq === -1 ? { name: token } : { name: token.slice(0, eq), value: token.slice(eq + 1) };
    });
}

/**
 * Chromium switches applied before `ready`. On Linux, run natively on Wayland when available
 * (otherwise Electron silently falls back to XWayland and text is blurry with fractional scaling).
 * User flags come last and win; `enable-features` values are merged rather than replaced.
 */
export function startupSwitches(platform: Platform, arboraFlags: string | undefined): ChromiumSwitch[] {
  const user = parseArboraFlags(arboraFlags);
  const features = new Set<string>();
  const result: ChromiumSwitch[] = [];
  if (platform === 'linux') {
    if (!user.some((s) => s.name === 'ozone-platform-hint' || s.name === 'ozone-platform')) {
      result.push({ name: 'ozone-platform-hint', value: 'auto' });
    }
    features.add('WaylandWindowDecorations');
  }
  for (const flag of user) {
    if (flag.name === 'enable-features') {
      for (const f of (flag.value ?? '').split(',')) if (f) features.add(f);
    } else {
      result.push(flag);
    }
  }
  if (features.size > 0) {
    result.push({ name: 'enable-features', value: [...features].join(',') });
  }
  return result;
}

/** Tiling compositors (Hyprland, Sway, ...) own window geometry; restoring bounds fights them. */
export function detectTilingCompositor(platform: Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform !== 'linux') return null;
  if (env['HYPRLAND_INSTANCE_SIGNATURE']) return 'hyprland';
  if (env['SWAYSOCK']) return 'sway';
  if (env['NIRI_SOCKET']) return 'niri';
  if (env['I3SOCK']) return 'i3';
  const desktop = (env['XDG_CURRENT_DESKTOP'] ?? '').toLowerCase();
  for (const name of ['hyprland', 'sway', 'niri', 'river', 'i3', 'bspwm', 'qtile', 'awesome', 'dwm']) {
    if (desktop.split(':').includes(name)) return name;
  }
  return null;
}

/** macOS keeps a windowless app in the dock unless the user asked it to quit. */
export function shouldQuitWhenAllWindowsClosed(platform: Platform, quitOnLastWindowClose: boolean): boolean {
  return platform !== 'darwin' || quitOnLastWindowClose;
}

export function shouldRestoreBounds(platform: Platform, tilingCompositor: string | null): boolean {
  return !(platform === 'linux' && tilingCompositor !== null);
}

/**
 * Finds the project folder passed on the command line (`arbora <path>`).
 * `defaultApp` is true when launched as `electron <entry> ...`; the entry is the first non-switch
 * argument, and Chromium may put switches before it (as in `second-instance` argv).
 */
export function parseProjectArg(argv: readonly string[], cwd: string, defaultApp: boolean): string | null {
  let skipEntry = defaultApp;
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (skipEntry) {
      skipEntry = false;
      continue;
    }
    const candidate = resolve(cwd, arg);
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Unreadable paths are ignored like any other non-project argument.
    }
  }
  return null;
}
