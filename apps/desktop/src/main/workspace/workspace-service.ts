import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { resolveInsideRoot } from '@arbora/acp-client';
import {
  applyEol,
  detectEol,
  joinPath,
  LARGE_FILE_BYTES,
  MAX_OPEN_BYTES,
  type Eol,
  type FileChange,
  type FileContent,
  type FileEntry,
  type FileKind,
  type SaveResult,
  type SearchMatch,
  type SearchQuery,
} from '@arbora/shared';
import { FileIndex, type FileList } from './file-index.js';
import { HIDDEN, IgnoreRules } from './ignore-rules.js';
import { searchWithNode, searchWithRipgrep, type RunningSearch } from './text-search.js';
import type { ToolingService } from './tooling/tooling-service.js';
import { ProjectWatcher } from './watcher.js';

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const BINARY_SNIFF_BYTES = 8000;

export interface WorkspaceServiceOptions {
  readonly root: string;
  /** ripgrep on the login-shell PATH, or null to use the Node fallbacks. */
  readonly rg: () => Promise<string | null>;
  readonly trash: (absolutePath: string) => Promise<void>;
  readonly reveal: (absolutePath: string) => void;
  readonly tooling: ToolingService | null;
  readonly formatOnSave: () => boolean;
  readonly events: {
    changed(changes: FileChange[]): void;
    watchWarning(message: string): void;
    searchResults(searchId: string, matches: SearchMatch[]): void;
    searchDone(searchId: string, result: { total: number; truncated: boolean; error?: string }): void;
  };
}

export class WorkspaceError extends Error {}

/** One project's files: listing, reading, writing, the watcher, quick-open index and search. */
export class WorkspaceService {
  readonly rules: IgnoreRules;
  private readonly watcher: ProjectWatcher;
  private readonly index: FileIndex;
  private readonly searches = new Map<string, RunningSearch>();

  constructor(private readonly options: WorkspaceServiceOptions) {
    this.rules = new IgnoreRules(options.root);
    this.index = new FileIndex(options.root, this.rules, options.rg);
    this.watcher = new ProjectWatcher({
      root: options.root,
      rules: this.rules,
      onChanges: (changes) => {
        this.index.onChanges(changes);
        options.events.changed(changes);
      },
      onWarning: (message) => options.events.watchWarning(message),
    });
    this.watcher.start();
  }

  /** Absolute path for a project-relative one, refusing anything that resolves outside the project. */
  resolve(path: string): string {
    try {
      return resolveInsideRoot(this.options.root, join(this.options.root, path));
    } catch (error) {
      throw new WorkspaceError((error as Error).message);
    }
  }

  async readDir(path: string): Promise<FileEntry[]> {
    const dir = this.resolve(path);
    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: FileEntry[] = [];
    for (const dirent of dirents) {
      if (HIDDEN.has(dirent.name)) continue;
      const entryPath = joinPath(path, dirent.name);
      let kind: FileKind = dirent.isDirectory() ? 'directory' : 'file';
      const symlink = dirent.isSymbolicLink();
      if (symlink) {
        try {
          kind = (await stat(join(dir, dirent.name))).isDirectory() ? 'directory' : 'file';
        } catch {
          kind = 'file';
        }
      }
      entries.push({
        name: dirent.name,
        path: entryPath,
        kind,
        symlink,
        ignored: this.rules.ignores(entryPath, kind === 'directory'),
      });
    }
    entries.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
    this.watcher.noteOpenedDir(path);
    return entries;
  }

  async read(path: string): Promise<FileContent> {
    const file = this.resolve(path);
    const info = await stat(file);
    if (info.isDirectory()) throw new WorkspaceError(`${path} is a folder`);
    const base = { size: info.size, mtimeMs: info.mtimeMs };
    if (info.size > MAX_OPEN_BYTES) return { type: 'tooLarge', ...base };
    const mime = IMAGE_TYPES[extname(file).toLowerCase()];
    if (mime) {
      const data = await readFile(file);
      return { type: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}`, ...base };
    }
    if (await looksBinary(file)) return { type: 'binary', ...base };
    const content = await readFile(file, 'utf8');
    return { type: 'text', content, eol: detectEol(content), large: info.size > LARGE_FILE_BYTES, ...base };
  }

  /** Formats (when asked and enabled), writes with `eol`, then starts diagnostics. */
  async save(path: string, content: string, eol: Eol, format: boolean): Promise<SaveResult> {
    const file = this.resolve(path);
    let text = applyEol(content, 'lf');
    let formatted = false;
    let formatError: string | undefined;
    const tooling = this.options.tooling;
    if (format && tooling && this.options.formatOnSave()) {
      const result = await tooling.format(path, text);
      if (result.content !== null && result.content !== text) {
        text = applyEol(result.content, 'lf');
        formatted = true;
      }
      if (result.error) formatError = result.error;
    }
    await writeFile(file, applyEol(text, eol), 'utf8');
    const info = await stat(file);
    tooling?.afterSave(path, text);
    return { content: text, mtimeMs: info.mtimeMs, formatted, ...(formatError ? { formatError } : {}) };
  }

  async format(path: string, content: string): Promise<{ content: string | null; error?: string }> {
    this.resolve(path);
    const tooling = this.options.tooling;
    if (!tooling) return { content: null };
    return tooling.format(path, applyEol(content, 'lf'));
  }

  async create(path: string, kind: FileKind): Promise<void> {
    const target = this.resolve(path);
    if (await exists(target)) throw new WorkspaceError(`${path} already exists`);
    if (kind === 'directory') {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, '', { flag: 'wx' });
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (from === '' || to === '') throw new WorkspaceError('Cannot move the project folder');
    if (`${to}/`.startsWith(`${from}/`)) throw new WorkspaceError('Cannot move a folder into itself');
    // A case-only rename on a case-insensitive disk resolves to the same file; let it through.
    if (source.toLowerCase() !== target.toLowerCase() && (await exists(target))) {
      throw new WorkspaceError(`${to} already exists`);
    }
    await lstat(source);
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }

  async delete(path: string): Promise<void> {
    if (path === '') throw new WorkspaceError('Cannot delete the project folder');
    await this.options.trash(this.resolve(path));
  }

  reveal(path: string): void {
    this.options.reveal(this.resolve(path));
  }

  listFiles(): Promise<FileList> {
    return this.index.list();
  }

  async search(query: SearchQuery): Promise<string> {
    const searchId = randomUUID();
    const rg = await this.options.rg();
    const callbacks = {
      matches: (matches: SearchMatch[]) => this.options.events.searchResults(searchId, matches),
      done: (result: { total: number; truncated: boolean; error?: string }) => {
        this.searches.delete(searchId);
        this.options.events.searchDone(searchId, result);
      },
    };
    const running = rg
      ? searchWithRipgrep(rg, this.options.root, query, callbacks)
      : searchWithNode(this.options.root, async () => (await this.index.list()).files, query, callbacks);
    this.searches.set(searchId, running);
    return searchId;
  }

  cancelSearch(searchId: string): void {
    this.searches.get(searchId)?.cancel();
    this.searches.delete(searchId);
  }

  async dispose(): Promise<void> {
    for (const search of this.searches.values()) search.cancel();
    this.searches.clear();
    this.options.tooling?.dispose();
    await this.watcher.dispose();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** A NUL byte in the first 8 KB, as git decides. */
async function looksBinary(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
