/**
 * Minimal PNG codec for the sprite pipeline: 8/16-bit grey, grey+alpha, RGB, RGBA and palette images (no interlacing) in,
 * RGBA out. Uses the platform's CompressionStream / DecompressionStream, so it needs no dependency and runs in node
 * (scripts, tests) and in browsers alike. Pixels are plain RGBA bytes (`Uint8Array`, 4 per pixel).
 */

export interface RawImage {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  const out = new Blob([buf]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

let crcTable: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (v: number): Uint8Array => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(t, 4);
  out.set(data, 8);
  out.set(u32(crc32([t, data])), 8 + data.length);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG into RGBA. Throws on interlaced images and unsupported bit depths. */
export async function decodePng(bytes: Uint8Array): Promise<RawImage> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error('not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ctype = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(pos + 8);
      h = dv.getUint32(pos + 12);
      depth = body[8];
      ctype = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h) throw new Error('PNG without header');
  if (depth !== 8 && depth !== 16 && !(ctype === 3 && depth <= 8)) throw new Error(`unsupported PNG bit depth ${depth}`);
  const total = idat.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const p of idat) {
    joined.set(p, o);
    o += p.length;
  }
  const raw = await pipe(joined, new DecompressionStream('deflate'));
  const chans = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  const bpp = Math.max(1, (chans * depth) >> 3);
  const stride = Math.ceil((w * chans * depth) / 8);
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (row: number, idx: number): number => {
    // idx-th sample of the row (per channel), reduced to 8 bit
    if (depth === 8) return px[row * stride + idx];
    if (depth === 16) return px[row * stride + idx * 2];
    const perByte = 8 / depth;
    const byte = px[row * stride + Math.floor(idx / perByte)];
    const shift = 8 - depth * ((idx % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (ctype === 6) {
        for (let k = 0; k < 4; k++) out[i + k] = sample(y, x * 4 + k);
      } else if (ctype === 2) {
        for (let k = 0; k < 3; k++) out[i + k] = sample(y, x * 3 + k);
        out[i + 3] = 255;
      } else if (ctype === 0) {
        const g = depth < 8 ? Math.round((sample(y, x) * 255) / ((1 << depth) - 1)) : sample(y, x);
        out[i] = out[i + 1] = out[i + 2] = g;
        out[i + 3] = 255;
      } else if (ctype === 4) {
        out[i] = out[i + 1] = out[i + 2] = sample(y, x * 2);
        out[i + 3] = sample(y, x * 2 + 1);
      } else if (ctype === 3) {
        const pi = sample(y, x);
        if (!plte) throw new Error('palette PNG without PLTE');
        out[i] = plte[pi * 3];
        out[i + 1] = plte[pi * 3 + 1];
        out[i + 2] = plte[pi * 3 + 2];
        out[i + 3] = trns && pi < trns.length ? trns[pi] : 255;
      } else throw new Error(`unsupported PNG colour type ${ctype}`);
    }
  return { w, h, data: out };
}

/** Encode RGBA to a PNG (8-bit RGBA, best filter per row, deflate). */
export async function encodePng(img: RawImage): Promise<Uint8Array> {
  const { w, h, data } = img;
  const stride = w * 4;
  const rows = new Uint8Array((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      const row = cand[f];
      for (let x = 0; x < stride; x++) {
        const v = data[y * stride + x];
        const a = x >= 4 ? data[y * stride + x - 4] : 0;
        const b = y > 0 ? data[(y - 1) * stride + x] : 0;
        const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
        const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 255;
        row[x] = r;
        sum += r < 128 ? r : 256 - r;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    rows[y * (stride + 1)] = best;
    rows.set(cand[best], y * (stride + 1) + 1);
  }
  const z = await pipe(rows, new CompressionStream('deflate'));
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0);
  ihdr.set(u32(h), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array(SIG), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Packed game colours (0xAABBGGRR on little-endian, see color.ts) from RGBA bytes. */
export function rgbaToPacked(data: Uint8Array): Uint32Array {
  const out = new Uint32Array(data.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = (((data[i * 4 + 3] << 24) | (data[i * 4 + 2] << 16) | (data[i * 4 + 1] << 8) | data[i * 4]) >>> 0);
  return out;
}

/** RGBA bytes from packed game colours. */
export function packedToRgba(px: Uint32Array): Uint8Array {
  const out = new Uint8Array(px.length * 4);
  for (let i = 0; i < px.length; i++) {
    const c = px[i];
    out[i * 4] = c & 255;
    out[i * 4 + 1] = (c >>> 8) & 255;
    out[i * 4 + 2] = (c >>> 16) & 255;
    out[i * 4 + 3] = c >>> 24;
  }
  return out;
}
