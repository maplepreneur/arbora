import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachmentBlocks, describeAttachment, mimeTypeFor } from './attachments.js';

describe('attachments', () => {
  it('maps extensions to MIME types and kinds', () => {
    expect(mimeTypeFor('shot.PNG')).toBe('image/png');
    expect(mimeTypeFor('a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('App.tsx')).toBe('text/typescript');
    expect(mimeTypeFor('readme')).toBe('application/octet-stream');
  });

  it('describes files on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbora-attach-'));
    const image = join(dir, 'pic.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'notes.md'), '# hi');
    expect(describeAttachment(image)).toEqual({
      path: image,
      name: 'pic.png',
      mimeType: 'image/png',
      size: 4,
      kind: 'image',
    });
    expect(describeAttachment(join(dir, 'notes.md'))).toMatchObject({
      kind: 'file',
      mimeType: 'text/markdown',
      size: 4,
    });
    expect(describeAttachment(join(dir, 'missing.txt'))).toBeNull();
  });

  it('turns attachments into image blocks when supported, resource links otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbora-attach-'));
    const image = join(dir, 'pic.png');
    writeFileSync(image, Buffer.from([1, 2, 3]));
    const attachments = [
      { path: image, name: 'pic.png', mimeType: 'image/png', size: 3, kind: 'image' as const },
      { path: join(dir, 'src.ts'), name: 'src.ts', mimeType: 'text/typescript', size: 10, kind: 'file' as const },
    ];
    const withImages = await attachmentBlocks(attachments, { image: true });
    expect(withImages[0]).toEqual({
      type: 'image',
      data: Buffer.from([1, 2, 3]).toString('base64'),
      mimeType: 'image/png',
      uri: `file://${image}`,
    });
    expect(withImages[1]).toMatchObject({
      type: 'resource_link',
      name: 'src.ts',
      uri: `file://${join(dir, 'src.ts')}`,
      mimeType: 'text/typescript',
      size: 10,
    });
    const withoutImages = await attachmentBlocks(attachments, { image: false });
    expect(withoutImages[0]).toMatchObject({ type: 'resource_link', name: 'pic.png' });
  });
});
