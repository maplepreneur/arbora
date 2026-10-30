import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the user's project resolves `name` from, or null when it does not have it installed. */
export function resolveProjectModule(root: string, name: string): string | null {
  try {
    return createRequire(join(root, 'package.json')).resolve(name);
  } catch {
    return null;
  }
}

/**
 * Loads a package from the user's project (its own Prettier or ESLint). This is a lazy boundary:
 * the module is only known at runtime and must come from the project, never from Arbora's bundle.
 */
export async function importProjectModule<T>(root: string, name: string): Promise<T | null> {
  const resolved = resolveProjectModule(root, name);
  if (!resolved) return null;
  return (await import(pathToFileURL(resolved).href)) as T;
}
