import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { joinPath, type FileChange } from '@arbora/shared';
import { ALWAYS_IGNORED, type IgnoreRules } from './ignore-rules.js';

export const MAX_INDEXED_FILES = 200_000;

export interface FileList {
  readonly files: string[];
  readonly truncated: boolean;
}

/** ripgrep arguments shared by the index and search: hidden files, `.gitignore` even outside git. */
export function ripgrepBaseArgs(): string[] {
  const args = ['--hidden', '--no-require-git', '--no-messages'];
  for (const dir of ALWAYS_IGNORED) args.push('--glob', `!**/${dir}/**`);
  return args;
}

/** `./src/a.ts` or `src\a.ts` as `src/a.ts`. */
export function normaliseRipgrepPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function listWithRipgrep(rg: string, root: string, limit: number): Promise<FileList> {
  return new Promise((resolve, reject) => {
    const child = spawn(rg, ['--files', ...ripgrepBaseArgs()], { cwd: root, windowsHide: true });
    const files: string[] = [];
    let truncated = false;
    let rest = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (truncated) return;
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const path = normaliseRipgrepPath(line.replace(/\r$/, ''));
        if (!path) continue;
        if (files.length >= limit) {
          truncated = true;
          child.kill();
          break;
        }
        files.push(path);
      }
    });
    child.on('error', reject);
    child.on('close', () => {
      if (!truncated && rest.trim()) files.push(normaliseRipgrepPath(rest.trim()));
      resolve({ files, truncated });
    });
  });
}

/** Breadth-first walk honouring `rules`; symlinked folders are not followed. */
export async function walkFiles(root: string, rules: IgnoreRules, limit: number): Promise<FileList> {
  const files: string[] = [];
  const queue = [''];
  while (queue.length > 0) {
    const dir = queue.shift() ?? '';
    let entries;
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = joinPath(dir, entry.name);
      if (entry.isDirectory()) {
        if (!rules.ignores(path, true)) queue.push(path);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && !rules.ignores(path, false)) {
        if (files.length >= limit) return { files, truncated: true };
        files.push(path);
      }
    }
  }
  return { files, truncated: false };
}

/** Every non-ignored file in the project, sorted; cached until files are added or removed. */
export class FileIndex {
  private cached: Promise<FileList> | null = null;

  constructor(
    private readonly root: string,
    private readonly rules: IgnoreRules,
    private readonly rg: () => Promise<string | null>,
    private readonly limit = MAX_INDEXED_FILES,
  ) {}

  list(): Promise<FileList> {
    this.cached ??= this.build().catch((error: unknown) => {
      this.cached = null;
      throw error;
    });
    return this.cached;
  }

  /** Drops the cache when the set of files changed (edits to existing files do not matter). */
  onChanges(changes: readonly FileChange[]): void {
    if (changes.some((c) => c.type !== 'change')) this.cached = null;
  }

  private async build(): Promise<FileList> {
    const rg = await this.rg();
    let list: FileList;
    try {
      list = rg ? await listWithRipgrep(rg, this.root, this.limit) : await walkFiles(this.root, this.rules, this.limit);
    } catch {
      list = await walkFiles(this.root, this.rules, this.limit);
    }
    list.files.sort();
    return list;
  }
}
