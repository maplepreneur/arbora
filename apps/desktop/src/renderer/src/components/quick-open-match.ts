import { fuzzyFilter, type FuzzyResult } from '@arbora/shared';

export type QuickOpenRequest =
  | { readonly type: 'files'; readonly files: readonly string[] }
  | {
      readonly type: 'query';
      readonly id: number;
      readonly query: string;
      readonly recent: readonly string[];
      readonly limit: number;
    };

export interface QuickOpenResponse {
  readonly id: number;
  readonly results: FuzzyResult[];
}

/** `src/App.tsx:12:3` → the path query plus a line and column to jump to. */
export function parseQuickOpenQuery(text: string): { query: string; line?: number; column?: number } {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(text.trim());
  if (!match) return { query: text.trim() };
  const [, query = '', line, column] = match;
  return { query, line: Number(line), ...(column ? { column: Number(column) } : {}) };
}

/** Matches for a query; an empty query lists recent files first, then the rest in order. */
export function matchFiles(
  files: readonly string[],
  query: string,
  recent: readonly string[],
  limit: number,
): FuzzyResult[] {
  if (query.trim() === '') {
    const known = new Set(files);
    const first = recent.filter((path) => known.has(path));
    const firstSet = new Set(first);
    return fuzzyFilter('', [...first, ...files.filter((path) => !firstSet.has(path))], limit);
  }
  return fuzzyFilter(query, files, limit);
}
