import { z } from 'zod';

/**
 * Files, search and editor types (Stage 7). Paths crossing IPC are project-relative with `/`
 * separators; `''` is the project root.
 */
export const relativePathSchema = z
  .string()
  .max(4096)
  .refine((path) => !path.startsWith('/') && !/^[a-zA-Z]:/.test(path) && !path.split('/').includes('..'), {
    message: 'must be a project-relative path',
  });

export const fileKindSchema = z.enum(['file', 'directory']);
export type FileKind = z.infer<typeof fileKindSchema>;

export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: fileKindSchema,
  /** Matched by `.gitignore` or always-ignored folders (`node_modules`, `dist`, ...); shown dimmed. */
  ignored: z.boolean(),
  symlink: z.boolean(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const eolSchema = z.enum(['lf', 'crlf']);
export type Eol = z.infer<typeof eolSchema>;

/** Text above this opens read-only without syntax highlighting. */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;
/** Text and images above this are not opened at all. */
export const MAX_OPEN_BYTES = 50 * 1024 * 1024;

export const fileContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
    eol: eolSchema,
    size: z.number().int(),
    mtimeMs: z.number(),
    /** Above `LARGE_FILE_BYTES`: read-only, no highlighting. */
    large: z.boolean(),
  }),
  z.object({ type: z.literal('image'), dataUrl: z.string(), size: z.number().int(), mtimeMs: z.number() }),
  z.object({ type: z.literal('binary'), size: z.number().int(), mtimeMs: z.number() }),
  z.object({ type: z.literal('tooLarge'), size: z.number().int(), mtimeMs: z.number() }),
]);
export type FileContent = z.infer<typeof fileContentSchema>;

export const fileChangeTypeSchema = z.enum(['add', 'addDir', 'change', 'unlink', 'unlinkDir']);
export type FileChangeType = z.infer<typeof fileChangeTypeSchema>;

export const fileChangeSchema = z.object({ type: fileChangeTypeSchema, path: z.string() });
export type FileChange = z.infer<typeof fileChangeSchema>;

export const saveResultSchema = z.object({
  /** What is on disk now (with `\n` line ends), after the formatter ran. */
  content: z.string(),
  mtimeMs: z.number(),
  formatted: z.boolean(),
  formatError: z.string().optional(),
});
export type SaveResult = z.infer<typeof saveResultSchema>;

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  isRegex: z.boolean().default(false),
  matchCase: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  /** Comma-separated globs, e.g. `src/**, *.ts`. */
  include: z.string().max(2000).default(''),
  exclude: z.string().max(2000).default(''),
  maxResults: z.number().int().min(1).max(20_000).default(2000),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchMatchSchema = z.object({
  path: z.string(),
  /** 1-based. */
  line: z.number().int(),
  /** 1-based, in UTF-16 code units like CodeMirror. */
  column: z.number().int(),
  length: z.number().int(),
  /** The matched line, trimmed to a window around the match. */
  preview: z.string(),
  /** Match position inside `preview`. */
  previewStart: z.number().int(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const diagnosticSourceSchema = z.enum(['eslint', 'tsc']);
export type DiagnosticSource = z.infer<typeof diagnosticSourceSchema>;

export const diagnosticSchema = z.object({
  path: z.string(),
  /** 1-based line and column. */
  line: z.number().int().min(1),
  column: z.number().int().min(1),
  endLine: z.number().int().min(1).optional(),
  endColumn: z.number().int().min(1).optional(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  source: diagnosticSourceSchema,
  /** ESLint rule id or `TS2322`. */
  code: z.string().optional(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

/** `\r\n` when it is the majority line end, else `\n` (new and single-line files). */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? 'crlf' : 'lf';
}

/** Rewrites every line end (`\r\n`, `\n` or lone `\r`) as `eol`. */
export function applyEol(text: string, eol: Eol): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

/** Splits `src/**, *.ts` into globs. */
export function splitGlobs(text: string): string[] {
  return text
    .split(',')
    .map((glob) => glob.trim())
    .filter(Boolean);
}

/** The file name of a project-relative path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The parent folder of a project-relative path (`''` for the root). */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/**
 * The project-relative form of `path` when it is inside `root`: absolute paths (either separator,
 * any drive-letter case) and `./`-prefixed or plain relative ones. Null when it is outside.
 */
export function toProjectPath(path: string, root: string): string | null {
  const slashes = (value: string): string => value.replace(/\\/g, '/');
  const target = slashes(path);
  const base = slashes(root).replace(/\/+$/, '');
  const absolute = target.startsWith('/') || /^[a-zA-Z]:\//.test(target);
  if (!absolute) {
    const rel = target.replace(/^(\.\/)+/, '');
    return rel.split('/').includes('..') ? null : rel;
  }
  const windows = /^[a-zA-Z]:\//.test(base);
  const same = windows ? target.toLowerCase().startsWith(`${base.toLowerCase()}/`) : target.startsWith(`${base}/`);
  if (same) return target.slice(base.length + 1);
  if (windows ? target.toLowerCase() === base.toLowerCase() : target === base) return '';
  return null;
}
