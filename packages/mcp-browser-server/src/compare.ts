import { decodePng, encodePng, type Bitmap } from './png.js';

export type CompareMode = 'side_by_side' | 'overlay' | 'diff';

export interface CompareRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CompareCell {
  readonly col: number;
  readonly row: number;
  /** 0..1. Higher means the cell differs more. */
  readonly difference: number;
  readonly a: CompareRect;
  readonly b: CompareRect;
}

export interface CompareJson {
  readonly score: number;
  readonly ssim: number;
  readonly histogramDistance: number;
  readonly cells: readonly CompareCell[];
  readonly width: number;
  readonly height: number;
}

export interface CompareOutput {
  readonly json: CompareJson;
  readonly png: Buffer;
}

const GRID = 12;
const WINDOW = 8;
const MAX_EDGE = 1568;
const TOP_K = 5;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Crops a capture to a CSS rectangle. The result's CSS size is the rectangle that was kept. */
export function cropBitmap(
  bitmap: Bitmap,
  cssWidth: number,
  cssHeight: number,
  rect: CompareRect,
): { bitmap: Bitmap; cssWidth: number; cssHeight: number; origin: { x: number; y: number } } {
  if (cssWidth <= 0 || cssHeight <= 0 || bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('The capture has no size');
  }
  const scaleX = bitmap.width / cssWidth;
  const scaleY = bitmap.height / cssHeight;
  const x = clampInt(rect.x * scaleX, 0, bitmap.width - 1);
  const y = clampInt(rect.y * scaleY, 0, bitmap.height - 1);
  const width = clampInt(rect.width * scaleX, 1, bitmap.width - x);
  const height = clampInt(rect.height * scaleY, 1, bitmap.height - y);
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const src = ((y + row) * bitmap.width + x) * 4;
    rgba.set(bitmap.rgba.subarray(src, src + width * 4), row * width * 4);
  }
  return {
    bitmap: { width, height, rgba },
    cssWidth: width / scaleX,
    cssHeight: height / scaleY,
    origin: { x: x / scaleX, y: y / scaleY },
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function comparePngs(
  aPng: Buffer,
  bPng: Buffer,
  mode: CompareMode,
  css: { aWidth: number; aHeight: number; bWidth: number; bHeight: number },
): CompareOutput {
  return compareBitmaps(decodePng(aPng), decodePng(bPng), mode, css);
}

/**
 * Scales both captures to the same CSS width, scores them (SSIM on a slightly blurred luminance
 * plus a colour-histogram distance) and renders `side_by_side`, a 50% `overlay` or a `diff` heatmap.
 * The score is deterministic. Rects are in each capture's own CSS pixels.
 */
export function compareBitmaps(
  a: Bitmap,
  b: Bitmap,
  mode: CompareMode,
  css: { aWidth: number; aHeight: number; bWidth: number; bHeight: number },
): CompareOutput {
  const targetWidth = Math.max(1, Math.round(Math.min(css.aWidth, css.bWidth)));
  const aScaled = scaleToWidth(a, targetWidth, css.aWidth, css.aHeight);
  const bScaled = scaleToWidth(b, targetWidth, css.bWidth, css.bHeight);
  const height = Math.max(aScaled.height, bScaled.height);
  const left = pad(blur(aScaled), targetWidth, height);
  const right = pad(blur(bScaled), targetWidth, height);
  const ssim = meanSsim(left, right);
  const histogramDistance = histogramDistanceOf(left, right);
  const score = clamp(0.8 * ssim + 0.2 * (1 - histogramDistance));
  const cells = worstCells(left, right, css, aScaled.height);
  const rendered = render(unblurPair(a, b, targetWidth, css), mode);
  const fitted = fitEdge(rendered, MAX_EDGE);
  return {
    png: encodePng(fitted),
    json: {
      score: round(score),
      ssim: round(ssim),
      histogramDistance: round(histogramDistance),
      cells,
      width: fitted.width,
      height: fitted.height,
    },
  };
}

function unblurPair(
  a: Bitmap,
  b: Bitmap,
  targetWidth: number,
  css: { aWidth: number; aHeight: number; bWidth: number; bHeight: number },
): { left: Bitmap; right: Bitmap } {
  return {
    left: scaleToWidth(a, targetWidth, css.aWidth, css.aHeight),
    right: scaleToWidth(b, targetWidth, css.bWidth, css.bHeight),
  };
}

function render(pair: { left: Bitmap; right: Bitmap }, mode: CompareMode): Bitmap {
  switch (mode) {
    case 'side_by_side':
      return sideBySide(pair.left, pair.right);
    case 'overlay':
      return overlay(pair.left, pair.right);
    case 'diff':
      return heatmap(pair.left, pair.right);
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function scaleToWidth(bitmap: Bitmap, pixelWidth: number, cssWidth: number, cssHeight: number): Bitmap {
  const height = Math.max(1, Math.round((pixelWidth / Math.max(1, cssWidth)) * cssHeight));
  return resize(bitmap, pixelWidth, height);
}

function resize(bitmap: Bitmap, width: number, height: number): Bitmap {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcY = (y + 0.5) * (bitmap.height / height) - 0.5;
    const y0 = clampIndex(Math.floor(srcY), bitmap.height);
    const y1 = clampIndex(y0 + 1, bitmap.height);
    const fy = srcY - Math.floor(srcY);
    for (let x = 0; x < width; x += 1) {
      const srcX = (x + 0.5) * (bitmap.width / width) - 0.5;
      const x0 = clampIndex(Math.floor(srcX), bitmap.width);
      const x1 = clampIndex(x0 + 1, bitmap.width);
      const fx = srcX - Math.floor(srcX);
      const at = (px: number, py: number): number => (py * bitmap.width + px) * 4;
      const dest = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = lerp(bitmap.rgba[at(x0, y0) + channel] ?? 0, bitmap.rgba[at(x1, y0) + channel] ?? 0, fx);
        const bottom = lerp(bitmap.rgba[at(x0, y1) + channel] ?? 0, bitmap.rgba[at(x1, y1) + channel] ?? 0, fx);
        rgba[dest + channel] = Math.round(lerp(top, bottom, fy));
      }
    }
  }
  return { width, height, rgba };
}

function blur(bitmap: Bitmap): Bitmap {
  const rgba = new Uint8Array(bitmap.rgba.length);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const px = x + dx;
            const py = y + dy;
            if (px < 0 || py < 0 || px >= bitmap.width || py >= bitmap.height) continue;
            sum += bitmap.rgba[(py * bitmap.width + px) * 4 + channel] ?? 0;
            count += 1;
          }
        }
        rgba[(y * bitmap.width + x) * 4 + channel] = Math.round(sum / count);
      }
      rgba[(y * bitmap.width + x) * 4 + 3] = 255;
    }
  }
  return { width: bitmap.width, height: bitmap.height, rgba };
}

function pad(bitmap: Bitmap, width: number, height: number): Bitmap {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255);
  for (let y = 0; y < bitmap.height; y += 1) {
    rgba.set(bitmap.rgba.subarray(y * bitmap.width * 4, (y + 1) * bitmap.width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

function luminance(bitmap: Bitmap, x: number, y: number): number {
  const index = (y * bitmap.width + x) * 4;
  const r = bitmap.rgba[index] ?? 0;
  const g = bitmap.rgba[index + 1] ?? 0;
  const b = bitmap.rgba[index + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function meanSsim(a: Bitmap, b: Bitmap): number {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  if (width < WINDOW || height < WINDOW) return ssimWindow(a, b, 0, 0, width, height);
  let total = 0;
  let count = 0;
  for (let y = 0; y + WINDOW <= height; y += WINDOW) {
    for (let x = 0; x + WINDOW <= width; x += WINDOW) {
      total += ssimWindow(a, b, x, y, WINDOW, WINDOW);
      count += 1;
    }
  }
  return count === 0 ? 1 : total / count;
}

function ssimWindow(a: Bitmap, b: Bitmap, x0: number, y0: number, width: number, height: number): number {
  const n = width * height;
  if (n === 0) return 1;
  let sumA = 0;
  let sumB = 0;
  const valuesA: number[] = [];
  const valuesB: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const la = luminance(a, x0 + x, y0 + y);
      const lb = luminance(b, x0 + x, y0 + y);
      valuesA.push(la);
      valuesB.push(lb);
      sumA += la;
      sumB += lb;
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let index = 0; index < n; index += 1) {
    const da = (valuesA[index] ?? 0) - meanA;
    const db = (valuesB[index] ?? 0) - meanB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;
  const numerator = (2 * meanA * meanB + C1) * (2 * cov + C2);
  const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);
  return denominator === 0 ? 1 : numerator / denominator;
}

function histogramDistanceOf(a: Bitmap, b: Bitmap): number {
  const left = histogram(a);
  const right = histogram(b);
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    const sum = x + y;
    if (sum > 0) distance += (x - y) ** 2 / sum;
  }
  return clamp(distance / 2);
}

function histogram(bitmap: Bitmap): number[] {
  const bins = new Array<number>(24).fill(0);
  const count = bitmap.width * bitmap.height;
  if (count === 0) return bins;
  for (let index = 0; index < bitmap.rgba.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const bin = Math.min(7, (bitmap.rgba[index + channel] ?? 0) >> 5);
      bins[channel * 8 + bin] = (bins[channel * 8 + bin] ?? 0) + 1 / count;
    }
  }
  return bins;
}

function worstCells(
  a: Bitmap,
  b: Bitmap,
  css: { aWidth: number; aHeight: number; bWidth: number; bHeight: number },
  aHeight: number,
): CompareCell[] {
  const cells: CompareCell[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const ax = Math.floor((col * a.width) / GRID);
      const ay = Math.floor((row * Math.min(a.height, aHeight)) / GRID);
      const aw = Math.max(1, Math.floor(a.width / GRID));
      const ah = Math.max(1, Math.floor(Math.min(a.height, aHeight)) / GRID);
      const similarity = ssimWindow(a, b, ax, ay, Math.min(aw, a.width - ax), Math.min(ah, a.height - ay));
      cells.push({
        col,
        row,
        difference: round(clamp(1 - similarity)),
        a: cssRect(col, row, css.aWidth, css.aHeight),
        b: cssRect(col, row, css.bWidth, css.bHeight),
      });
    }
  }
  return cells
    .sort((left, right) => right.difference - left.difference || left.row - right.row || left.col - right.col)
    .slice(0, TOP_K);
}

/** Moves crop-relative cells into the tab's own CSS pixels. */
export function placeCompareCells(
  cells: readonly CompareCell[],
  originA: { readonly x: number; readonly y: number },
  originB: { readonly x: number; readonly y: number },
): CompareCell[] {
  return cells.map((cell) => ({
    ...cell,
    a: { ...cell.a, x: round(cell.a.x + originA.x), y: round(cell.a.y + originA.y) },
    b: { ...cell.b, x: round(cell.b.x + originB.x), y: round(cell.b.y + originB.y) },
  }));
}

function cssRect(col: number, row: number, width: number, height: number): CompareRect {
  const x = (col / GRID) * width;
  const y = (row / GRID) * height;
  return {
    x: round(x),
    y: round(y),
    width: round(width / GRID),
    height: round(height / GRID),
  };
}

function sideBySide(a: Bitmap, b: Bitmap): Bitmap {
  const gap = 4;
  const height = Math.max(a.height, b.height);
  const width = a.width + gap + b.width;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 24;
    rgba[index + 1] = 24;
    rgba[index + 2] = 24;
    rgba[index + 3] = 255;
  }
  blit(rgba, width, a, 0, 0);
  blit(rgba, width, b, a.width + gap, 0);
  return { width, height, rgba };
}

function overlay(a: Bitmap, b: Bitmap): Bitmap {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dest = (y * width + x) * 4;
      const ia = sample(a, x, y);
      const ib = sample(b, x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[dest + channel] = Math.round(((ia[channel] ?? 255) + (ib[channel] ?? 255)) / 2);
      }
      rgba[dest + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function heatmap(a: Bitmap, b: Bitmap): Bitmap {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ia = sample(a, x, y);
      const ib = sample(b, x, y);
      const delta =
        (Math.abs((ia[0] ?? 0) - (ib[0] ?? 0)) +
          Math.abs((ia[1] ?? 0) - (ib[1] ?? 0)) +
          Math.abs((ia[2] ?? 0) - (ib[2] ?? 0))) /
        3;
      const dest = (y * width + x) * 4;
      rgba[dest] = Math.min(255, Math.round(delta * 2));
      rgba[dest + 1] = Math.round(32 + (255 - delta) * 0.15);
      rgba[dest + 2] = Math.round(32 * (1 - delta / 255));
      rgba[dest + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function fitEdge(bitmap: Bitmap, maxEdge: number): Bitmap {
  const edge = Math.max(bitmap.width, bitmap.height);
  if (edge <= maxEdge) return bitmap;
  const scale = maxEdge / edge;
  return resize(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
}

function blit(dest: Uint8Array, destWidth: number, source: Bitmap, x: number, y: number): void {
  for (let row = 0; row < source.height; row += 1) {
    const from = row * source.width * 4;
    dest.set(source.rgba.subarray(from, from + source.width * 4), ((y + row) * destWidth + x) * 4);
  }
}

function sample(bitmap: Bitmap, x: number, y: number): number[] {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return [255, 255, 255, 255];
  const index = (y * bitmap.width + x) * 4;
  return [
    bitmap.rgba[index] ?? 255,
    bitmap.rgba[index + 1] ?? 255,
    bitmap.rgba[index + 2] ?? 255,
    bitmap.rgba[index + 3] ?? 255,
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
