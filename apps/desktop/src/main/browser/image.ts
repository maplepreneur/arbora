import type { Rect } from '@arbora/shared';

export const HIGHLIGHT_COLOR = { r: 0xff, g: 0x3b, b: 0x6b } as const;

/**
 * Draws a rectangle outline into a 32-bit BGRA bitmap (what `NativeImage.toBitmap()` returns), in
 * place. `rect` is in device pixels; it is rounded (fractional scaling produces non-integer rects)
 * and clipped to the image. The outline is drawn inside the rect so it never covers neighbours.
 */
export function drawOutline(
  bitmap: Uint8Array,
  width: number,
  height: number,
  rect: Rect,
  thickness: number,
  color: { r: number; g: number; b: number } = HIGHLIGHT_COLOR,
): void {
  if (bitmap.length < width * height * 4) throw new RangeError('bitmap is smaller than width * height * 4');
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.round(rect.x + rect.width);
  const bottom = Math.round(rect.y + rect.height);
  const t = Math.max(1, Math.round(thickness));

  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    const xs = Math.max(0, x0);
    const xe = Math.min(width, x1);
    const ys = Math.max(0, y0);
    const ye = Math.min(height, y1);
    for (let y = ys; y < ye; y++) {
      for (let x = xs; x < xe; x++) {
        const i = (y * width + x) * 4;
        bitmap[i] = color.b;
        bitmap[i + 1] = color.g;
        bitmap[i + 2] = color.r;
        bitmap[i + 3] = 0xff;
      }
    }
  };

  if (right <= left || bottom <= top) return;
  fill(left, top, right, Math.min(bottom, top + t));
  fill(left, Math.max(top, bottom - t), right, bottom);
  fill(left, top, Math.min(right, left + t), bottom);
  fill(Math.max(left, right - t), top, right, bottom);
}

export function scaleRect(rect: Rect, factor: number): Rect {
  return { x: rect.x * factor, y: rect.y * factor, width: rect.width * factor, height: rect.height * factor };
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.byteLength < 24 || view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG');
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
