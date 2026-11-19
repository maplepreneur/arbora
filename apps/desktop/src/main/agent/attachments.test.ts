import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeAttachment, mimeTypeFor, pastedImagePath, pickPastedImageType } from './attachments.js';

describe('attachments', () => {
  it('saves pastes under .arbora/pasted with a file-safe time stamp', () => {
    const path = pastedImagePath('/p', new Date('2026-11-03T20:15:30.123Z'));
    expect(path).toBe(join('/p', '.arbora', 'pasted', 'paste-2026-11-03T20-15-30-123Z.png'));
    expect(describeAttachment(path)).toBeNull();
    expect(pastedImagePath('/p', new Date(0), 'image/jpeg')).toMatch(/\.jpg$/);
  });

  it('prefers PNG among the clipboard image types', () => {
    expect(pickPastedImageType(['text/html', 'image/jpeg', 'image/png'])).toBe('image/png');
    expect(pickPastedImageType(['image/webp'])).toBe('image/webp');
    expect(pickPastedImageType(['text/plain'])).toBeNull();
  });

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
});
