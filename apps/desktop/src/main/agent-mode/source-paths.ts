import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawSource, ResolvedSource } from '@arbora/shared';

/** Bundler prefixes in front of a project-relative path. */
const PREFIXES: readonly RegExp[] = [
  /^webpack:\/\/_N_E\//,
  /^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/,
  /^webpack:\/\/[^/]*\//,
  /^webpack:\/\/\//,
  /^\[project\]\//,
];

function stripQuery(path: string): string {
  return path.replace(/[?#].*$/, '');
}

/** `C:/x` or `C:\x` (a Windows drive path, even when the host is not Windows). */
function isWindowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Turns a framework-reported source (absolute path, `file://` URL, `webpack://` URI, Vite
 * `/src/...` or `/@fs/...` URL, Turbopack `[project]/...` id) into absolute paths to try, most
 * likely first. Nothing is checked on disk here.
 */
export function sourcePathCandidates(file: string, projectRoot: string): string[] {
  let value = file.trim();
  if (!value) return [];
  // React replays server stacks as `rsc://React/Server/file:///abs/path?42`.
  const embedded = /(file:\/\/\/?.+)$/.exec(value);
  if (embedded?.[1] && !value.startsWith('file:')) value = embedded[1];
  // Turbopack ids end with ` [app-client] (ecmascript)`.
  value = value.replace(/\s+\[[^\]]*\](?:\s+\([^)]*\))?\s*$/, '');

  if (value.startsWith('file:')) {
    try {
      return [fileURLToPath(stripQuery(value))];
    } catch {
      return [];
    }
  }
  for (const prefix of PREFIXES) {
    if (prefix.test(value)) return [join(projectRoot, stripQuery(value.replace(prefix, '')))];
  }
  if (/^https?:\/\//i.test(value)) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(value).pathname);
    } catch {
      return [];
    }
    return urlPathCandidates(pathname, projectRoot);
  }
  value = stripQuery(value);
  if (isWindowsAbsolute(value)) return [value];
  if (value.startsWith('/')) return [value, ...urlPathCandidates(value, projectRoot)];
  return isAbsolute(value) ? [value] : [join(projectRoot, value)];
}

function urlPathCandidates(pathname: string, projectRoot: string): string[] {
  // Vite serves files outside the root as `/@fs/<absolute path>`.
  const fs = /^\/@fs(\/.*)$/.exec(pathname);
  if (fs?.[1]) {
    const abs = fs[1];
    return [/^\/[A-Za-z]:\//.test(abs) ? abs.slice(1) : abs];
  }
  const local = pathname.replace(/^\/+/, '');
  return local ? [join(projectRoot, local)] : [];
}

/**
 * True when `path` is inside `root` and not under `node_modules` or a dot-directory, where build
 * output lives (`.next/dev/server/chunks/...` shows up in React's replayed server stacks).
 */
export function isProjectSource(path: string, root: string): boolean {
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  const dirs = rel.split(sep).slice(0, -1);
  return !dirs.some((dir) => dir === 'node_modules' || dir.startsWith('.'));
}

/** Project-relative path with forward slashes. */
export function projectRelative(path: string, root: string): string {
  return relative(root, path).split(sep).join('/');
}

/** Maps a raw source onto a file that exists inside the project, or null. */
export function resolveSource(
  raw: RawSource | null,
  projectRoot: string,
  exists: (path: string) => boolean,
): ResolvedSource | null {
  if (!raw) return null;
  for (const candidate of sourcePathCandidates(raw.file, projectRoot)) {
    const path = normalize(candidate);
    if (!isProjectSource(path, projectRoot) || !exists(path)) continue;
    return { path, relative: projectRelative(path, projectRoot), line: raw.line, column: raw.column };
  }
  return null;
}
