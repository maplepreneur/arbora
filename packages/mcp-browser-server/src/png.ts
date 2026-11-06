import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** RGBA pixels, row-major, no padding. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
  return out;
}

/** PNG of `bitmap`. Rows use filter 0 so a test can round-trip without a decoder guess. */
export function encodePng(bitmap: Bitmap): Buffer {
  const { width, height, rgba } = bitmap;
  if (rgba.length !== width * height * 4) throw new Error('RGBA length does not match the bitmap size');
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((byte, index) => {
      raw[row + 1 + index] = byte;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes an 8-bit RGBA PNG. Other colour types are rejected. */
export function decodePng(png: Buffer): Bitmap {
  if (png.length < 8 || !png.subarray(0, 8).equals(Buffer.from(SIGNATURE))) throw new Error('Not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('Only 8-bit RGBA PNGs can be compared');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width === 0 || height === 0) throw new Error('PNG is missing its header');
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  let src = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src] ?? 0;
    src += 1;
    const row = new Uint8Array(stride);
    for (let index = 0; index < stride; index += 1) {
      const value = inflated[src] ?? 0;
      src += 1;
      const left = index >= 4 ? (row[index - 4] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= 4 ? (previous[index - 4] ?? 0) : 0;
      switch (filter) {
        case 0:
          row[index] = value;
          break;
        case 1:
          row[index] = (value + left) & 255;
          break;
        case 2:
          row[index] = (value + up) & 255;
          break;
        case 3:
          row[index] = (value + Math.floor((left + up) / 2)) & 255;
          break;
        case 4:
          row[index] = (value + paeth(left, up, upLeft)) & 255;
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }
    rgba.set(row, y * stride);
    previous = row;
  }
  return { width, height, rgba };
}
