import { statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Attachment } from '@arbora/shared';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.mts': 'text/typescript',
  '.cts': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.html': 'text/html',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.txt': 'text/plain',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.toml': 'application/toml',
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.sh': 'application/x-sh',
};

const PASTE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** The clipboard type to save for a pasted image, PNG first; null when there is no image. */
export function pickPastedImageType(types: readonly string[]): string | null {
  return Object.keys(PASTE_EXTENSIONS).find((type) => types.includes(type)) ?? null;
}

/** Where a pasted clipboard image is saved: `.arbora/pasted/paste-<ISO time>.<ext>`. */
export function pastedImagePath(projectPath: string, now: Date, mimeType = 'image/png'): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(projectPath, '.arbora', 'pasted', `paste-${stamp}${PASTE_EXTENSIONS[mimeType] ?? '.png'}`);
}

/** Image types shown with an image chip in the composer (SVG is text, so it is a file). */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function mimeTypeFor(name: string): string {
  return MIME_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/** Metadata for one picked or dropped file; null when it is not a readable regular file. */
export function describeAttachment(path: string): Attachment | null {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return null;
    const mimeType = mimeTypeFor(path);
    return {
      path,
      name: basename(path),
      mimeType,
      size: stats.size,
      kind: IMAGE_TYPES.has(mimeType) ? 'image' : 'file',
    };
  } catch {
    return null;
  }
}
