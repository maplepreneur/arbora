import type { AppUpdater } from 'electron-updater';

/**
 * electron-updater (and its YAML, semver and fs-extra dependencies) is only needed by packaged
 * builds that update themselves, so it is loaded on the first check instead of at startup.
 */
export async function loadAutoUpdater(): Promise<AppUpdater> {
  const module = await import('electron-updater');
  return module.default.autoUpdater;
}
