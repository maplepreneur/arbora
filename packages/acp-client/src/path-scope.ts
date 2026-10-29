import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class PathScopeError extends Error {
  constructor(
    readonly path: string,
    readonly root: string,
    reason: string,
  ) {
    super(`Path ${path} is not inside the project (${reason})`);
    this.name = 'PathScopeError';
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

/**
 * The nearest existing ancestor of `path` (or `path` itself), resolved through symlinks, plus the
 * remaining non-existent suffix. New files and folders inherit the scope of where they would land.
 */
function realExistingPrefix(path: string): { real: string; rest: string[] } {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      return { real: realpathSync(current), rest };
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`No existing ancestor for ${path}`);
      rest.unshift(current.slice(parent.length).replace(/^[\\/]/, ''));
      current = parent;
    }
  }
}

/**
 * Validates that an agent-supplied absolute path stays inside `root` (the project folder), with
 * both a lexical check and a `realpath` check so symlinks cannot escape. Returns the canonical
 * absolute path to use for the file operation.
 */
export function resolveInsideRoot(root: string, path: string): string {
  if (!isAbsolute(path)) throw new PathScopeError(path, root, 'relative path');
  const realRoot = realpathSync(root);
  const normalized = resolve(path);
  if (!isInside(realRoot, normalized) && !isInside(root, normalized)) {
    throw new PathScopeError(path, root, 'outside the project folder');
  }
  const { real, rest } = realExistingPrefix(normalized);
  const target = rest.length > 0 ? resolve(real, ...rest) : real;
  if (!isInside(realRoot, target)) throw new PathScopeError(path, root, 'resolves outside the project folder');
  return target;
}
