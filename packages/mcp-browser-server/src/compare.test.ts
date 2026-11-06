import { describe, expect, it } from 'vitest';
import { compareBitmaps } from './compare.js';
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
