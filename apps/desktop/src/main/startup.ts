import { isAbsolute, resolve } from 'node:path';
import type { Platform } from '@arbora/shared';

export interface ChromiumSwitch {
  readonly name: string;
  readonly value?: string;
}

/** Parses `ARBORA_FLAGS` ("--disable-gpu-sandbox --ozone-platform=x11") into Chromium switches. */
export function parseArboraFlags(flags: string | undefined): ChromiumSwitch[] {
  if (flags === undefined) return [];
  return flags
    .split(/\s+/u)
    .map((token) => token.replace(/^-+/u, ''))
    .filter((token) => token !== '')
    .map((token) => {
      const separator = token.indexOf('=');
      return separator === -1
        ? { name: token }
        : { name: token.slice(0, separator), value: token.slice(separator + 1) };
    });
}

/**
 * Switches applied before `app.ready`. On Linux Arbora runs natively on Wayland when available
 * (otherwise Electron silently falls back to XWayland and text blurs under fractional scaling).
 * Feature lists from `ARBORA_FLAGS` are merged rather than replaced.
 */
export function computeChromiumSwitches(
  platform: Platform,
  arboraFlags: string | undefined,
): ChromiumSwitch[] {
  const features = new Set<string>();
  const switches: ChromiumSwitch[] = [];
  if (platform === 'linux') {
    switches.push({ name: 'ozone-platform-hint', value: 'auto' });
    features.add('WaylandWindowDecorations');
  }
  for (const flag of parseArboraFlags(arboraFlags)) {
    if (flag.name === 'enable-features') {
      for (const feature of (flag.value ?? '').split(',')) {
        if (feature !== '') features.add(feature);
      }
      continue;
    }
    const existing = switches.findIndex((entry) => entry.name === flag.name);
    if (existing === -1) {
      switches.push(flag);
    } else {
      switches[existing] = flag;
    }
  }
  if (features.size > 0) {
    switches.push({ name: 'enable-features', value: [...features].join(',') });
  }
  return switches;
}

/**
 * Finds the project path in a command line (`arbora <path>`). Unpackaged runs (`electron <app>
 * <path>`) carry the app entry as the first argument, so it is skipped. Switches are ignored.
 */
export function parseProjectArg(
  argv: readonly string[],
  isDefaultApp: boolean,
  cwd: string,
): string | undefined {
  const args = argv.slice(isDefaultApp ? 2 : 1);
  const candidate = args.find((arg) => !arg.startsWith('-'));
  if (candidate === undefined) return undefined;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(cwd, candidate);
}
