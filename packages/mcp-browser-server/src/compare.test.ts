import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compareBitmaps, cropBitmap } from './compare.js';
import { decodePng, encodePng, type Bitmap } from './png.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): Bitmap {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = rgba[0];
    pixels[index + 1] = rgba[1];
    pixels[index + 2] = rgba[2];
    pixels[index + 3] = rgba[3];
  }
  return { width, height, rgba: pixels };
}

function withBox(base: Bitmap, x: number, y: number, size: number, rgba: [number, number, number, number]): Bitmap {
  const pixels = new Uint8Array(base.rgba);
  for (let row = y; row < y + size; row += 1) {
    for (let col = x; col < x + size; col += 1) {
      const index = (row * base.width + col) * 4;
      pixels[index] = rgba[0];
      pixels[index + 1] = rgba[1];
      pixels[index + 2] = rgba[2];
      pixels[index + 3] = rgba[3];
    }
  }
  return { width: base.width, height: base.height, rgba: pixels };
}

const css = { aWidth: 48, aHeight: 48, bWidth: 48, bHeight: 48 };

describe('cropBitmap', () => {
  it('keeps a frame and ignores the chrome around it', () => {
    const page = withBox(solid(48, 48, [255, 255, 255, 255]), 16, 16, 16, [200, 30, 30, 255]);
    const frame = cropBitmap(page, 48, 48, { x: 16, y: 16, width: 16, height: 16 });
    const red = solid(frame.bitmap.width, frame.bitmap.height, [200, 30, 30, 255]);
    expect(frame.cssWidth).toBe(16);
    expect(frame.cssHeight).toBe(16);
    expect(
      compareBitmaps(frame.bitmap, red, 'side_by_side', {
        aWidth: frame.cssWidth,
        aHeight: frame.cssHeight,
        bWidth: frame.cssWidth,
        bHeight: frame.cssHeight,
      }).json.score,
    ).toBe(1);
  });
});

describe('compareBitmaps', () => {
  it('scores identical images at 1 and round-trips the PNG', () => {
    const image = solid(48, 48, [40, 120, 80, 255]);
    const result = compareBitmaps(image, image, 'side_by_side', css);
    expect(result.json.score).toBe(1);
    expect(result.json.ssim).toBe(1);
    expect(result.json.histogramDistance).toBe(0);
    const decoded = decodePng(result.png);
    expect(decoded.width).toBeGreaterThan(image.width);
    expect(decodePng(encodePng(image)).rgba).toEqual(image.rgba);
  });

  it('decodes an 8-bit RGB PNG from a browser screenshot', () => {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      body.copy(out, 4);
      out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
      return out;
    };
    const png = Buffer.concat([
      signature,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from([0, 31, 107, 74]))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(Array.from(decodePng(png).rgba)).toEqual([31, 107, 74, 255]);
  });

  it('drops the score when a box moves and names that cell as the worst', () => {
    const before = withBox(solid(48, 48, [250, 250, 250, 255]), 4, 4, 12, [20, 20, 20, 255]);
    const after = withBox(solid(48, 48, [250, 250, 250, 255]), 28, 28, 12, [20, 20, 20, 255]);
    const result = compareBitmaps(before, after, 'diff', css);
    expect(result.json.score).toBeLessThan(1);
    const worst = result.json.cells[0];
    expect(worst).toBeDefined();
    expect(worst?.difference).toBeGreaterThan(0);
    const changed = result.json.cells.some(
      (cell) => (cell.col === 0 && cell.row === 0) || (cell.col >= 6 && cell.row >= 6),
    );
    expect(changed).toBe(true);
    expect(worst && worst.a.width).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = withBox(solid(32, 32, [10, 20, 30, 255]), 8, 8, 8, [200, 10, 10, 255]);
    const b = solid(32, 32, [10, 20, 30, 255]);
    const size = { aWidth: 32, aHeight: 32, bWidth: 32, bHeight: 32 };
    const first = compareBitmaps(a, b, 'overlay', size);
    const second = compareBitmaps(a, b, 'overlay', size);
    expect(second.json).toEqual(first.json);
    expect(second.png.equals(first.png)).toBe(true);
  });
});
