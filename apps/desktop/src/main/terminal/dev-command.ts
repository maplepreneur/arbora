import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inferDevCommand, lockfileNames } from '@arbora/shared';

/** Lockfiles in the nearest folder (the project or an ancestor, for monorepo packages) that has any. */
export function findLockfiles(projectPath: string): string[] {
  const names = lockfileNames();
  let dir = projectPath;
  for (;;) {
    const found = names.filter((name) => existsSync(join(dir, name)));
    if (found.length > 0) return found;
    const parent = dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

/** `pnpm dev` (etc.) from the project's `package.json`, or `null` when it has no dev-like script. */
export function inferProjectDevCommand(projectPath: string): string | null {
  let pkg: { scripts?: Record<string, unknown>; packageManager?: unknown };
  try {
    pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return null;
  }
  return inferDevCommand({
    scripts: pkg.scripts,
    packageManagerField: typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined,
    lockfiles: findLockfiles(projectPath),
  });
}
