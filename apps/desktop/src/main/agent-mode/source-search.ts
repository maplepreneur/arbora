import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { InspectorSelection, SourceCandidate } from '@arbora/shared';
import { projectRelative } from './source-paths.js';

export const CANDIDATE_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 3000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_WALK_FILES = 5000;

/** Directories that never hold the user's source. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.arbora',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.vite',
  '.vercel',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
]);
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.mdx',
]);

export interface SearchTerm {
  readonly text: string;
  /** Component names match as whole words; class names as plain substrings (`md:grid-cols-2`). */
  readonly word: boolean;
}

/**
 * Grep terms for a selection: the nearest (non-minified, non-server) component names, then the
 * first two class names unique to the element (any two when none are unique).
 */
export function searchTerms(selection: Pick<InspectorSelection, 'components' | 'element'>): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  const add = (text: string, word: boolean): void => {
    if (text.length < 3 || seen.has(text)) return;
    seen.add(text);
    terms.push({ text, word });
  };
  for (const component of selection.components.slice(0, 3)) {
    if (!component.minified) add(component.name, true);
  }
  const { uniqueClasses, classes } = selection.element;
  for (const c of (uniqueClasses.length > 0 ? uniqueClasses : classes).slice(0, 2)) add(c, false);
  return terms;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rank(root: string, matches: Map<string, Set<string>>, terms: readonly SearchTerm[]): SourceCandidate[] {
  const names = new Set(terms.filter((t) => t.word).map((t) => t.text));
  const score = (path: string, matched: Set<string>): number => {
    const stem = basename(path, extname(path));
    return matched.size + (names.has(stem) ? 2 : 0);
  };
  return [...matches.entries()]
    .map(([path, matched]) => ({ path, matched, score: score(path, matched) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, CANDIDATE_LIMIT)
    .map(({ path, matched }) => ({
      path,
      relative: projectRelative(path, root),
      matched: terms.filter((t) => matched.has(t.text)).map((t) => t.text),
    }));
}

function runRipgrep(rg: string, root: string, term: SearchTerm, signal: AbortSignal): Promise<string[]> {
  const args = ['--files-with-matches', '--fixed-strings', '--max-filesize', '1M', '--no-messages'];
  if (term.word) args.push('--word-regexp');
  for (const dir of IGNORED_DIRS) args.push('--glob', `!**/${dir}/**`);
  for (const ext of SOURCE_EXTENSIONS) args.push('--glob', `*${ext}`);
  args.push('--', term.text, '.');
  return new Promise((resolve) => {
    execFile(rg, args, { cwd: root, signal, maxBuffer: 4_000_000, windowsHide: true }, (error, stdout) => {
      // Exit code 1 means "no matches"; anything else (including abort) yields what was printed.
      if (error && !stdout) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => join(root, line)),
      );
    });
  });
}

async function walk(root: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < MAX_WALK_FILES && !signal.aborted) {
    const dir = queue.shift();
    if (!dir) break;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

async function searchWithNode(
  root: string,
  terms: readonly SearchTerm[],
  signal: AbortSignal,
): Promise<Map<string, Set<string>>> {
  const matches = new Map<string, Set<string>>();
  const patterns = terms.map((term) => ({
    term,
    regex: term.word ? new RegExp(`\\b${escapeRegExp(term.text)}\\b`) : null,
  }));
  for (const file of await walk(root, signal)) {
    if (signal.aborted) break;
    try {
      if ((await stat(file)).size > MAX_FILE_BYTES) continue;
      const text = await readFile(file, 'utf8');
      for (const { term, regex } of patterns) {
        if (regex ? regex.test(text) : text.includes(term.text)) {
          const set = matches.get(file) ?? new Set<string>();
          set.add(term.text);
          matches.set(file, set);
        }
      }
    } catch {
      // Unreadable file; skip it.
    }
  }
  return matches;
}

/**
 * Up to five project files mentioning the terms, best first (more terms matched, then file names
 * equal to a component name). Uses ripgrep when it is on the PATH, else a bounded Node walk.
 */
export async function findCandidates(
  root: string,
  terms: readonly SearchTerm[],
  options: { readonly rg: string | null; readonly timeoutMs?: number },
): Promise<SourceCandidate[]> {
  if (terms.length === 0) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SEARCH_TIMEOUT_MS);
  try {
    let matches: Map<string, Set<string>>;
    if (options.rg) {
      const rg = options.rg;
      matches = new Map();
      const results = await Promise.all(terms.map((term) => runRipgrep(rg, root, term, controller.signal)));
      results.forEach((files, index) => {
        const text = terms[index]?.text;
        if (!text) return;
        for (const file of files) {
          const set = matches.get(file) ?? new Set<string>();
          set.add(text);
          matches.set(file, set);
        }
      });
    } else {
      matches = await searchWithNode(root, terms, controller.signal);
    }
    return rank(root, matches, terms);
  } finally {
    clearTimeout(timer);
  }
}
