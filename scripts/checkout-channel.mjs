// Which branch scripts/arbora-local moves a clean source checkout to, from Settings → Updates.
//
//   node scripts/checkout-channel.mjs   # prints main (Stable), beta (Beta) or off (Development)
//
// ARBORA_UPDATES=off wins over the setting. A missing or unreadable settings file means Stable,
// which is the app's default. Keep in step with checkoutBranch in packages/shared/src/updates.ts.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkoutBranchFor(settingsText, env) {
  const override = env.ARBORA_UPDATES?.trim().toLowerCase();
  if (override === 'off' || override === '0' || override === 'false') return null;
  let channel = 'latest';
  try {
    const parsed = settingsText ? JSON.parse(settingsText) : {};
    if (typeof parsed?.updates?.channel === 'string') channel = parsed.updates.channel;
  } catch {
    // A half-written file falls back to Stable, as the app does.
  }
  if (channel === 'beta') return 'beta';
  if (channel === 'off') return null;
  return 'main';
}

/** Electron's userData for app name `arbora` (Linux and macOS), or ARBORA_USER_DATA_DIR. */
export function settingsPath(env, platform = process.platform, home = homedir()) {
  if (env.ARBORA_USER_DATA_DIR) return join(env.ARBORA_USER_DATA_DIR, 'settings.json');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'arbora', 'settings.json');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'arbora', 'settings.json');
}

function main() {
  let text = '';
  try {
    text = readFileSync(settingsPath(process.env), 'utf8');
  } catch {
    // No settings yet: Stable.
  }
  console.log(checkoutBranchFor(text, process.env) ?? 'off');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
