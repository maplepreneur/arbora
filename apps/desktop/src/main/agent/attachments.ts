import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Attachment, ContentBlock } from '@arbora/shared';

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

/** Image types ACP agents accept as `image` blocks (SVG is text, so it goes as a file). */
const IMAGE_BLOCK_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

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
      kind: IMAGE_BLOCK_TYPES.has(mimeType) ? 'image' : 'file',
    };
  } catch {
    return null;
  }
}

/**
 * Content blocks for the prompt: images are inlined as base64 when the agent advertised
 * `promptCapabilities.image`; everything else is a `resource_link` the agent reads itself.
 */
export async function attachmentBlocks(
  attachments: readonly Attachment[],
  capabilities: { readonly image: boolean },
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const attachment of attachments) {
    const uri = pathToFileURL(attachment.path).toString();
    if (attachment.kind === 'image' && capabilities.image) {
      const data = await readFile(attachment.path);
      blocks.push({ type: 'image', data: data.toString('base64'), mimeType: attachment.mimeType, uri });
      continue;
    }
    blocks.push({
      type: 'resource_link',
      uri,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
  }
  return blocks;
}
