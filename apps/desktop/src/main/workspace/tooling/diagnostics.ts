import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Diagnostic } from '@arbora/shared';

const FLAT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];
const LEGACY_CONFIGS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
];

export type EslintConfigKind = 'flat' | 'legacy';

/** Flat (`eslint.config.*`) or legacy (`.eslintrc*`, `package.json#eslintConfig`) config at the root. */
export function detectEslintConfig(root: string): { kind: EslintConfigKind; file: string } | null {
  for (const name of FLAT_CONFIGS) if (existsSync(join(root, name))) return { kind: 'flat', file: join(root, name) };
  for (const name of LEGACY_CONFIGS)
    if (existsSync(join(root, name))) return { kind: 'legacy', file: join(root, name) };
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { eslintConfig?: unknown };
    if (pkg.eslintConfig) return { kind: 'legacy', file: join(root, 'package.json') };
  } catch {
    // No or invalid package.json.
  }
  return null;
}

export interface EslintMessage {
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly severity: number;
  readonly message: string;
  readonly ruleId?: string | null;
}

/** ESLint messages as diagnostics, minus the "File ignored ..." notice for files no config covers. */
export function eslintDiagnostics(path: string, messages: readonly EslintMessage[]): Diagnostic[] {
  return messages
    .filter((m) => !(m.ruleId == null && m.severity === 1 && m.message.startsWith('File ignored')))
    .map((m) => ({
      path,
      line: Math.max(1, m.line ?? 1),
      column: Math.max(1, m.column ?? 1),
      ...(m.endLine !== undefined ? { endLine: Math.max(1, m.endLine) } : {}),
      ...(m.endColumn !== undefined ? { endColumn: Math.max(1, m.endColumn) } : {}),
      severity: m.severity >= 2 ? 'error' : 'warning',
      message: m.message,
      source: 'eslint',
      ...(m.ruleId ? { code: m.ruleId } : {}),
    }));
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/;

/**
 * `tsc --pretty false` output as diagnostics keyed by project-relative path. Continuation lines
 * (indented message chains) are appended to the previous message. Files outside `root` are dropped.
 */
export function parseTscOutput(output: string, cwd: string, root: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let last: Diagnostic | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const match = TSC_LINE.exec(raw);
    if (match) {
      const [, file = '', line = '1', column = '1', level, code, message = ''] = match;
      const rel = relative(root, resolve(cwd, file));
      if (rel.startsWith('..') || rel === '') {
        last = undefined;
        continue;
      }
      last = {
        path: rel.split(sep).join('/'),
        line: Number(line),
        column: Number(column),
        severity: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
        message,
        source: 'tsc',
        ...(code ? { code } : {}),
      };
      diagnostics.push(last);
    } else if (last && /^\s+\S/.test(raw)) {
      last.message += `\n${raw.trim()}`;
    } else {
      last = undefined;
    }
  }
  return diagnostics;
}

/** The nearest `tsconfig.json` from the file's folder up to the project root. */
export function findTsconfig(root: string, file: string): string | null {
  let dir = dirname(resolve(root, file));
  const top = resolve(root);
  for (;;) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    if (dir === top) return null;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(top)) return null;
    dir = parent;
  }
}

/** `tsc` arguments: `--build` when the config has project references, else `--noEmit -p`. */
export function tscArgs(tsconfig: string): string[] {
  let references = false;
  try {
    // tsconfig allows comments and trailing commas; a regex is enough to spot references.
    references = /"references"\s*:\s*\[\s*\{/.test(readFileSync(tsconfig, 'utf8'));
  } catch {
    // Unreadable; fall through to -p.
  }
  return references ? ['--build', tsconfig, '--pretty', 'false'] : ['--noEmit', '-p', tsconfig, '--pretty', 'false'];
}

/** Groups diagnostics by path, with an empty list for paths that had some last time. */
export function groupByPath(
  diagnostics: readonly Diagnostic[],
  previous: ReadonlySet<string>,
): Map<string, Diagnostic[]> {
  const grouped = new Map<string, Diagnostic[]>();
  for (const path of previous) grouped.set(path, []);
  for (const diagnostic of diagnostics) {
    const list = grouped.get(diagnostic.path) ?? [];
    list.push(diagnostic);
    grouped.set(diagnostic.path, list);
  }
  return grouped;
}
