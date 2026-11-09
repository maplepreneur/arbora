import { deflateSync } from 'node:zlib';

/** A captured page, straight RGBA, top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CompareRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One cell of the 12×12 difference grid, in each capture's own pixels. */
export interface CompareCell {
  readonly col: number;
  readonly row: number;
  readonly score: number;
  readonly a: CompareRect;
  readonly b: CompareRect;
}

export type CompareMode = 'side_by_side' | 'overlay' | 'diff';

export interface CompareResult {
  /** 1 is identical. SSIM on luminance, mixed with a color-histogram distance. */
  readonly score: number;
  readonly cells: CompareCell[];
  readonly image: RgbaImage;
  readonly pngBase64: string;
}

const GRID = 12;
const WINDOW = 8;
const TOP_K = 8;
const MAX_EDGE = 1568;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

function luminance(rgba: Uint8Array, offset: number): number {
  return 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
}

function samePixels(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height || a.rgba.length !== b.rgba.length) return false;
  for (let i = 0; i < a.rgba.length; i += 1) if (a.rgba[i] !== b.rgba[i]) return false;
  return true;
}

function scaleToWidth(image: RgbaImage, width: number): RgbaImage {
  if (image.width === width) return image;
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      rgba[to] = image.rgba[from] ?? 0;
      rgba[to + 1] = image.rgba[from + 1] ?? 0;
      rgba[to + 2] = image.rgba[from + 2] ?? 0;
      rgba[to + 3] = image.rgba[from + 3] ?? 255;
    }
  }
  return { width, height, rgba };
}

function padHeight(image: RgbaImage, height: number): RgbaImage {
  if (image.height >= height) return image;
  const rgba = new Uint8Array(image.width * height * 4);
  rgba.set(image.rgba);
  for (let i = image.rgba.length; i < rgba.length; i += 4) rgba[i + 3] = 255;
  return { width: image.width, height, rgba };
}

function fitEdge(image: RgbaImage, maxEdge: number): RgbaImage {
  const edge = Math.max(image.width, image.height);
  if (edge <= maxEdge) return image;
  return scaleToWidth(image, Math.max(1, Math.round((image.width * maxEdge) / edge)));
}

function span(index: number, count: number, size: number): { start: number; length: number } {
  const base = Math.floor(size / count);
  const extra = size % count;
  return { start: index * base + Math.min(index, extra), length: base + (index < extra ? 1 : 0) };
}

function mapRect(rect: CompareRect, from: RgbaImage, to: RgbaImage): CompareRect {
  if (from.width === to.width && from.height === to.height) return rect;
  return {
    x: Math.round((rect.x * to.width) / from.width),
    y: Math.round((rect.y * to.height) / from.height),
    width: Math.max(1, Math.round((rect.width * to.width) / from.width)),
    height: Math.max(1, Math.round((rect.height * to.height) / from.height)),
  };
}

function meanSsim(a: RgbaImage, b: RgbaImage): number {
  let total = 0;
  let windows = 0;
  for (let y = 0; y + WINDOW <= a.height; y += WINDOW) {
    for (let x = 0; x + WINDOW <= a.width; x += WINDOW) {
      let sumA = 0;
      let sumB = 0;
      let sumA2 = 0;
      let sumB2 = 0;
      let sumAB = 0;
      for (let row = 0; row < WINDOW; row += 1) {
        for (let col = 0; col < WINDOW; col += 1) {
          const offset = ((y + row) * a.width + (x + col)) * 4;
          const left = luminance(a.rgba, offset);
          const right = luminance(b.rgba, offset);
          sumA += left;
          sumB += right;
          sumA2 += left * left;
          sumB2 += right * right;
          sumAB += left * right;
        }
      }
      const n = WINDOW * WINDOW;
      const muA = sumA / n;
      const muB = sumB / n;
      const varA = sumA2 / n - muA * muA;
      const varB = sumB2 / n - muB * muB;
      const cov = sumAB / n - muA * muB;
      const light = (2 * muA * muB + C1) / (muA * muA + muB * muB + C1);
      const contrast = (2 * Math.sqrt(Math.max(varA, 0) * Math.max(varB, 0)) + C2) / (varA + varB + C2);
      const structure = (cov + C2 / 2) / (Math.sqrt(Math.max(varA, 0) * Math.max(varB, 0)) + C2 / 2);
      total += light * contrast * structure;
      windows += 1;
    }
  }
  return windows === 0 ? 1 : total / windows;
}

function histogramDistance(a: RgbaImage, b: RgbaImage): number {
  const bins = 8;
  const left = new Float64Array(bins ** 3);
  const right = new Float64Array(bins ** 3);
  const count = a.width * a.height;
  const bump = (bins: Float64Array, rgba: Uint8Array, offset: number): void => {
    const index = ((rgba[offset] ?? 0) >> 5) * 64 + ((rgba[offset + 1] ?? 0) >> 5) * 8 + ((rgba[offset + 2] ?? 0) >> 5);
    bins[index] = (bins[index] ?? 0) + 1;
  };
  for (let i = 0; i < count; i += 1) {
    bump(left, a.rgba, i * 4);
    bump(right, b.rgba, i * 4);
  }
  let delta = 0;
  for (let i = 0; i < left.length; i += 1) delta += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
  return count === 0 ? 0 : delta / (2 * count);
}

function similarity(a: RgbaImage, b: RgbaImage): number {
  if (samePixels(a, b)) return 1;
  const score = (meanSsim(a, b) + (1 - histogramDistance(a, b))) / 2;
  return score > 1 - 1e-9 ? 1 : Math.max(0, Math.min(1, score));
}

function cellsOf(canvasA: RgbaImage, canvasB: RgbaImage, sourceA: RgbaImage, sourceB: RgbaImage): CompareCell[] {
  const found: CompareCell[] = [];
  for (let row = 0; row < GRID; row += 1) {
    const y = span(row, GRID, canvasA.height);
    if (y.length <= 0) continue;
    for (let col = 0; col < GRID; col += 1) {
      const x = span(col, GRID, canvasA.width);
      if (x.length <= 0) continue;
      let delta = 0;
      const pixels = x.length * y.length;
      for (let py = 0; py < y.length; py += 1) {
        for (let px = 0; px < x.length; px += 1) {
          const offset = ((y.start + py) * canvasA.width + (x.start + px)) * 4;
          delta += Math.abs(luminance(canvasA.rgba, offset) - luminance(canvasB.rgba, offset));
        }
      }
      const difference = pixels === 0 ? 0 : delta / pixels / 255;
      if (difference <= 0) continue;
      const rect = { x: x.start, y: y.start, width: x.length, height: y.length };
      found.push({
        col,
        row,
        score: 1 - difference,
        a: mapRect(rect, canvasA, sourceA),
        b: mapRect(rect, canvasB, sourceB),
      });
    }
  }
  found.sort((left, right) => left.score - right.score);
  return found.slice(0, TOP_K);
}

function render(a: RgbaImage, b: RgbaImage, mode: CompareMode): RgbaImage {
  if (mode === 'side_by_side') {
    const height = Math.max(a.height, b.height);
    const rgba = new Uint8Array((a.width + b.width) * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < a.width + b.width; x += 1) {
        const source = x < a.width ? a : b;
        const sx = x < a.width ? x : x - a.width;
        const to = (y * (a.width + b.width) + x) * 4;
        if (y >= source.height) {
          rgba[to + 3] = 255;
          continue;
        }
        const from = (y * source.width + sx) * 4;
        rgba[to] = source.rgba[from] ?? 0;
        rgba[to + 1] = source.rgba[from + 1] ?? 0;
        rgba[to + 2] = source.rgba[from + 2] ?? 0;
        rgba[to + 3] = source.rgba[from + 3] ?? 255;
      }
    }
    return { width: a.width + b.width, height, rgba };
  }
  const rgba = new Uint8Array(a.width * a.height * 4);
  for (let i = 0; i < a.width * a.height; i += 1) {
    const offset = i * 4;
    if (mode === 'overlay') {
      for (let channel = 0; channel < 4; channel += 1) {
        rgba[offset + channel] = Math.round(((a.rgba[offset + channel] ?? 0) + (b.rgba[offset + channel] ?? 0)) / 2);
      }
      continue;
    }
    const magnitude = Math.max(
      Math.abs((a.rgba[offset] ?? 0) - (b.rgba[offset] ?? 0)),
      Math.abs((a.rgba[offset + 1] ?? 0) - (b.rgba[offset + 1] ?? 0)),
      Math.abs((a.rgba[offset + 2] ?? 0) - (b.rgba[offset + 2] ?? 0)),
    );
    rgba[offset] = magnitude;
    rgba[offset + 3] = 255;
  }
  return { width: a.width, height: a.height, rgba };
}

/** Aligns both captures to one width, scores them, and draws the requested comparison. */
export function compareImages(
  a: RgbaImage,
  b: RgbaImage,
  options: { mode?: CompareMode | undefined } = {},
): CompareResult {
  const mode = options.mode ?? 'side_by_side';
  const width = Math.max(1, Math.min(a.width, b.width));
  const scaledA = scaleToWidth(a, width);
  const scaledB = scaleToWidth(b, width);
  const height = Math.max(scaledA.height, scaledB.height);
  const canvasA = padHeight(scaledA, height);
  const canvasB = padHeight(scaledB, height);
  const image = fitEdge(render(canvasA, canvasB, mode), MAX_EDGE);
  return {
    score: similarity(canvasA, canvasB),
    cells: cellsOf(canvasA, canvasB, a, b),
    image,
    pngBase64: pngBase64(image),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function pngBase64(image: RgbaImage): string {
  const stride = image.width * 4 + 1;
  const raw = Buffer.alloc(stride * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * stride] = 0;
    Buffer.from(image.rgba.buffer, image.rgba.byteOffset + y * image.width * 4, image.width * 4).copy(
      raw,
      y * stride + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
  return png.toString('base64');
}
