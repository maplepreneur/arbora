import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { baseName, parentPath } from '@arbora/shared';

/** Folders that are never watched, indexed or searched, whatever `.gitignore` says. */
export const ALWAYS_IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '.nuxt', '.output', '.svelte-kit']);
/** Never listed in the explorer either. */
export const HIDDEN = new Set(['.git']);

/**
 * `.gitignore` semantics for a project: the root and nested `.gitignore` files plus
 * `.git/info/exclude`, read lazily and cached until `invalidate`. Paths are project-relative with `/`.
 */
export class IgnoreRules {
  private readonly perDir = new Map<string, Ignore | null>();
  private readonly verdicts = new Map<string, boolean>();

  constructor(private readonly root: string) {}

  /** Forget cached rules, e.g. after a `.gitignore` changed. */
  invalidate(): void {
    this.perDir.clear();
    this.verdicts.clear();
  }

  /** Whether `path` (or any folder above it) is ignored. */
  ignores(path: string, isDir: boolean): boolean {
    if (path === '') return false;
    const segments = path.split('/');
    let prefix = '';
    for (const [index, segment] of segments.entries()) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`;
      const last = index === segments.length - 1;
      if (this.own(prefix, last ? isDir : true)) return true;
    }
    return false;
  }

  /** Whether `path` itself matches a rule (its parents are not checked). */
  private own(path: string, isDir: boolean): boolean {
    const key = `${isDir ? 'd' : 'f'}:${path}`;
    const cached = this.verdicts.get(key);
    if (cached !== undefined) return cached;
    let verdict = isDir && ALWAYS_IGNORED.has(baseName(path));
    if (!verdict) {
      // Each `.gitignore` from the root down to the parent folder applies, relative to its folder.
      const parent = parentPath(path);
      const dirs = parent === '' ? [''] : ['', ...prefixes(parent)];
      for (const dir of dirs) {
        const rules = this.rulesFor(dir);
        if (!rules) continue;
        const relative = dir === '' ? path : path.slice(dir.length + 1);
        if (rules.ignores(isDir ? `${relative}/` : relative)) {
          verdict = true;
          break;
        }
      }
    }
    if (this.verdicts.size > 50_000) this.verdicts.clear();
    this.verdicts.set(key, verdict);
    return verdict;
  }

  private rulesFor(dir: string): Ignore | null {
    if (this.perDir.has(dir)) return this.perDir.get(dir) ?? null;
    const sources = [read(join(this.root, dir, '.gitignore'))];
    if (dir === '') sources.push(read(join(this.root, '.git', 'info', 'exclude')));
    const text = sources.filter((s): s is string => s !== null).join('\n');
    const rules = text.trim() === '' ? null : ignore().add(text);
    this.perDir.set(dir, rules);
    return rules;
  }
}

function prefixes(path: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const segment of path.split('/')) {
    current = current === '' ? segment : `${current}/${segment}`;
    out.push(current);
  }
  return out;
}

function read(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
