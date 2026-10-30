import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import ignore from 'ignore';
import { splitGlobs, type SearchMatch, type SearchQuery } from '@arbora/shared';
import { normaliseRipgrepPath, ripgrepBaseArgs } from './file-index.js';

const PREVIEW_BEFORE = 40;
const PREVIEW_AFTER = 160;
const FLUSH_MS = 50;
const FLUSH_COUNT = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface SearchCallbacks {
  matches(matches: SearchMatch[]): void;
  done(result: { total: number; truncated: boolean; error?: string }): void;
}

export interface RunningSearch {
  cancel(): void;
}

/** A match preview: the line trimmed to a window around the match, without the line end. */
export function preview(line: string, start: number, length: number): { preview: string; previewStart: number } {
  const text = line.replace(/\r?\n$/, '');
  const from = Math.max(0, start - PREVIEW_BEFORE);
  const to = Math.min(text.length, start + length + PREVIEW_AFTER);
  const head = from > 0 ? '…' : '';
  return { preview: head + text.slice(from, to), previewStart: start - from + head.length };
}

/** UTF-16 length of the first `bytes` UTF-8 bytes of `text`. */
function utf16Offset(text: string, bytes: number): number {
  return Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8').length;
}

interface RipgrepMatchLine {
  readonly type: string;
  readonly data?: {
    readonly path?: { readonly text?: string };
    readonly lines?: { readonly text?: string };
    readonly line_number?: number;
    readonly submatches?: readonly { readonly start: number; readonly end: number }[];
  };
}

/** The matches in one line of `rg --json` output (only `match` messages carry any). */
export function parseRipgrepJson(line: string): SearchMatch[] {
  let message: RipgrepMatchLine;
  try {
    message = JSON.parse(line) as RipgrepMatchLine;
  } catch {
    return [];
  }
  const data = message.data;
  const path = data?.path?.text;
  const text = data?.lines?.text;
  if (message.type !== 'match' || !path || text === undefined || data.line_number === undefined) return [];
  return (data.submatches ?? []).map((submatch) => {
    const start = utf16Offset(text, submatch.start);
    const length = utf16Offset(text, submatch.end) - start;
    return {
      path: normaliseRipgrepPath(path),
      line: data.line_number ?? 1,
      column: start + 1,
      length,
      ...preview(text, start, length),
    };
  });
}

export function ripgrepSearchArgs(query: SearchQuery): string[] {
  const args = ['--json', ...ripgrepBaseArgs(), '--max-filesize', '5M'];
  args.push(query.matchCase ? '--case-sensitive' : '--ignore-case');
  if (!query.isRegex) args.push('--fixed-strings');
  if (query.wholeWord) args.push('--word-regexp');
  for (const glob of splitGlobs(query.include)) args.push('--glob', glob);
  for (const glob of splitGlobs(query.exclude)) args.push('--glob', `!${glob}`);
  args.push('--', query.query, '.');
  return args;
}

/** Collects matches and hands them over in batches, stopping at `maxResults`. */
class Batcher {
  private batch: SearchMatch[] = [];
  private timer: NodeJS.Timeout | undefined;
  total = 0;
  truncated = false;

  constructor(
    private readonly max: number,
    private readonly emit: (matches: SearchMatch[]) => void,
  ) {}

  /** Returns false once the limit is reached. */
  add(matches: readonly SearchMatch[]): boolean {
    for (const match of matches) {
      if (this.total >= this.max) {
        this.truncated = true;
        return false;
      }
      this.batch.push(match);
      this.total++;
    }
    if (this.batch.length >= FLUSH_COUNT) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    return true;
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.batch.length === 0) return;
    const batch = this.batch;
    this.batch = [];
    this.emit(batch);
  }
}

export function searchWithRipgrep(
  rg: string,
  root: string,
  query: SearchQuery,
  callbacks: SearchCallbacks,
): RunningSearch {
  const batcher = new Batcher(query.maxResults, (m) => callbacks.matches(m));
  const child = spawn(rg, ripgrepSearchArgs(query), { cwd: root, windowsHide: true });
  let cancelled = false;
  let rest = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (batcher.truncated) return;
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      if (!batcher.add(parseRipgrepJson(line))) {
        child.kill();
        return;
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 2000) stderr += chunk;
  });
  const finish = (error?: string): void => {
    if (cancelled) return;
    cancelled = true;
    batcher.flush();
    callbacks.done({ total: batcher.total, truncated: batcher.truncated, ...(error ? { error } : {}) });
  };
  child.on('error', (error) => finish(error.message));
  child.on('close', (code) => {
    if (rest && !batcher.truncated) batcher.add(parseRipgrepJson(rest));
    // 1 means no matches; 2 means an error such as an invalid regex.
    finish(code === 2 && batcher.total === 0 ? stderr.trim().split('\n')[0] || 'Search failed' : undefined);
  });
  return {
    cancel: () => {
      cancelled = true;
      batcher.flush();
      child.kill();
    },
  };
}

/** The query as a global RegExp, or an error message (invalid regex). */
export function queryRegExp(query: SearchQuery): RegExp | string {
  const source = query.isRegex ? query.query : query.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(query.wholeWord ? `\\b(?:${source})\\b` : source, query.matchCase ? 'g' : 'gi');
  } catch (error) {
    return (error as Error).message;
  }
}

/** Include/exclude globs with ripgrep's meaning, for the Node fallback. */
export function globFilter(query: SearchQuery): (path: string) => boolean {
  const includes = splitGlobs(query.include);
  const excludes = splitGlobs(query.exclude);
  const include = includes.length > 0 ? ignore().add(includes) : null;
  const exclude = excludes.length > 0 ? ignore().add(excludes) : null;
  return (path) => (include ? include.ignores(path) : true) && !(exclude?.ignores(path) ?? false);
}

/** Search without ripgrep: scans the indexed files line by line. */
export function searchWithNode(
  root: string,
  files: () => Promise<readonly string[]>,
  query: SearchQuery,
  callbacks: SearchCallbacks,
): RunningSearch {
  const run = { cancelled: false };
  const batcher = new Batcher(query.maxResults, (m) => callbacks.matches(m));
  const regex = queryRegExp(query);
  void (async () => {
    if (typeof regex === 'string') {
      callbacks.done({ total: 0, truncated: false, error: regex });
      return;
    }
    const accept = globFilter(query);
    for (const path of await files()) {
      if (run.cancelled || batcher.truncated) break;
      if (!accept(path)) continue;
      let text: string;
      try {
        if ((await stat(join(root, path))).size > MAX_FILE_BYTES) continue;
        text = await readFile(join(root, path), 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;
      const lines = text.split('\n');
      for (const [index, line] of lines.entries()) {
        regex.lastIndex = 0;
        const found: SearchMatch[] = [];
        for (let match = regex.exec(line); match; match = regex.exec(line)) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          found.push({
            path,
            line: index + 1,
            column: match.index + 1,
            length: match[0].length,
            ...preview(line, match.index, match[0].length),
          });
        }
        if (found.length > 0 && !batcher.add(found)) break;
      }
    }
    if (run.cancelled) return;
    batcher.flush();
    callbacks.done({ total: batcher.total, truncated: batcher.truncated });
  })();
  return {
    cancel: () => {
      run.cancelled = true;
    },
  };
}
