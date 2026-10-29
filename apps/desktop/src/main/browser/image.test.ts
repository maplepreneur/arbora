import { describe, expect, it } from 'vitest';
import { drawOutline, pngSize, scaleRect } from './image.js';

const RED = { r: 255, g: 0, b: 0 };

function painted(bitmap: Uint8Array, width: number, x: number, y: number): boolean {
  const i = (y * width + x) * 4;
  return bitmap[i] === 0 && bitmap[i + 1] === 0 && bitmap[i + 2] === 255 && bitmap[i + 3] === 255;
}

describe('drawOutline', () => {
  it('draws a border inside the rect and leaves the interior alone', () => {
    const width = 10;
    const bitmap = new Uint8Array(width * 10 * 4);
    drawOutline(bitmap, width, 10, { x: 2, y: 2, width: 6, height: 6 }, 2, RED);
    expect(painted(bitmap, width, 2, 2)).toBe(true);
    expect(painted(bitmap, width, 3, 3)).toBe(true);
    expect(painted(bitmap, width, 7, 7)).toBe(true);
    expect(painted(bitmap, width, 4, 4)).toBe(false);
    expect(painted(bitmap, width, 1, 1)).toBe(false);
    expect(painted(bitmap, width, 8, 8)).toBe(false);
  });

  it('rounds fractional rects and clips to the image', () => {
    const width = 4;
    const bitmap = new Uint8Array(width * 4 * 4);
    drawOutline(bitmap, width, 4, { x: -1.4, y: 0.6, width: 10, height: 2.2 }, 1, RED);
    expect(painted(bitmap, width, 0, 1)).toBe(true);
    expect(painted(bitmap, width, 3, 2)).toBe(true);
    expect(painted(bitmap, width, 0, 0)).toBe(false);
  });

  it('rejects undersized bitmaps', () => {
    expect(() => drawOutline(new Uint8Array(4), 2, 2, { x: 0, y: 0, width: 1, height: 1 }, 1)).toThrow(RangeError);
  });
});

describe('scaleRect / pngSize', () => {
  it('scales rects to device pixels', () => {
    expect(scaleRect({ x: 1, y: 2, width: 3, height: 4 }, 1.5)).toEqual({ x: 1.5, y: 3, width: 4.5, height: 6 });
  });

  it('reads PNG dimensions from the header', () => {
    const header = new Uint8Array(24);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x89504e47);
    view.setUint32(16, 640);
    view.setUint32(20, 480);
    expect(pngSize(header)).toEqual({ width: 640, height: 480 });
    expect(() => pngSize(new Uint8Array(24))).toThrow(/Not a PNG/);
  });
});
