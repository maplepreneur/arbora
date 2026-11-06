import { describe, expect, it } from 'vitest';
import { compareImages, type RgbaImage } from './compare.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  }
  return { width, height, rgba: pixels };
}

function fillRect(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: [number, number, number, number],
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = (row * image.width + col) * 4;
      image.rgba[offset] = rgba[0];
      image.rgba[offset + 1] = rgba[1];
      image.rgba[offset + 2] = rgba[2];
      image.rgba[offset + 3] = rgba[3];
    }
  }
}

describe('compareImages', () => {
  it('scores identical images at 1 and a changed cell as the worst difference', () => {
    const size = 120;
    const left = solid(size, size, [255, 255, 255, 255]);
    const right = solid(size, size, [255, 255, 255, 255]);
    const same = compareImages(left, right, { mode: 'side_by_side' });
    expect(same.score).toBe(1);

    fillRect(right, 22, 32, 6, 6, [0, 0, 0, 255]);
    const changed = compareImages(left, right, { mode: 'diff' });
    expect(changed.score).toBeLessThan(1);
    expect(changed.cells[0]).toMatchObject({ col: 2, row: 3, a: { x: 20, y: 30, width: 10, height: 10 } });
    expect(changed.image.width).toBeLessThanOrEqual(1568);
    expect(changed.image.height).toBeLessThanOrEqual(1568);
  });

  it('places the two pages next to each other, blends an overlay, and paints a diff', () => {
    const left = solid(4, 2, [0, 0, 0, 255]);
    const right = solid(4, 2, [255, 255, 255, 255]);
    const beside = compareImages(left, right, { mode: 'side_by_side' });
    expect(beside.image.width).toBe(8);
    expect(beside.image.rgba[0]).toBe(0);
    expect(beside.image.rgba[4 * 4]).toBe(255);

    const overlay = compareImages(left, right, { mode: 'overlay' });
    expect(overlay.image.width).toBe(4);
    expect(overlay.image.rgba[0]).toBe(128);

    const diff = compareImages(left, right, { mode: 'diff' });
    expect(diff.image.rgba[0]).toBeGreaterThan(200);
    expect(diff.image.rgba[1]).toBeLessThan(40);
  });
});
