// node-pty 1.1.0's macOS prebuilds ship `spawn-helper` without the execute bit, so every terminal
// fails with "posix_spawnp failed". Restore it after install (no-op on other platforms).
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.platform === 'darwin') {
  const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  const candidates = [join(root, 'build/Release/spawn-helper')];
  const prebuilds = join(root, 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const dir of readdirSync(prebuilds)) candidates.push(join(prebuilds, dir, 'spawn-helper'));
  }
  for (const file of candidates) if (existsSync(file)) chmodSync(file, 0o755);
}
