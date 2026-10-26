/**
 * Sprite import pipeline, the pure part (no DOM, no file system): turns an arbitrary source picture (an AI render, a
 * scan, a vector export) into a game sprite. Steps, in order: background removal, crop, resize to the target pixel height
 * (area average or nearest), alpha forced to 0 / 255, specks removed, every pixel snapped to the game palette, the 1 px ink
 * outline, then the anchor and the occlusion row spans. `scripts/art/import-sprite.ts` wraps this with file IO;
 * `imported.ts` is the runtime loader of the result.
 */
import { cb, cg, cr, rgba, type Col } from './color';
import { rowSpans, type RowSpans } from '../render/occlusion';
import type { RawImage } from './png';

export type { RawImage } from './png';

// ---------------------------------------------------------------------------
// Palette: derived from the colours the generators really paint with
// ---------------------------------------------------------------------------

/** Frequency table of opaque colours (packed game colours, alpha forced to 255). */
export type ColourCounts = Map<number, number>;

/** Add the opaque pixels of a packed buffer to a frequency table. Translucent pixels (baked shadows) are skipped. */
export function countColours(px: ArrayLike<number>, into: ColourCounts = new Map()): ColourCounts {
  for (let i = 0; i < px.length; i++) {
    const c = px[i] >>> 0;
    if (c >>> 24 !== 255) continue;
    into.set(c, (into.get(c) ?? 0) + 1);
  }
  return into;
}

interface Box {
  cols: [number, number][];
  total: number;
}

function boxRange(b: Box): { ch: 0 | 1 | 2; span: number } {
  let lo = [255, 255, 255];
  let hi = [0, 0, 0];
  for (const [c] of b.cols) {
    const v = [cr(c), cg(c), cb(c)];
    for (let k = 0; k < 3; k++) {
      if (v[k] < lo[k]) lo[k] = v[k];
      if (v[k] > hi[k]) hi[k] = v[k];
    }
  }
  const s = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const ch = s[1] >= s[0] && s[1] >= s[2] ? 1 : s[0] >= s[2] ? 0 : 2;
  return { ch, span: s[ch] };
}

/**
 * Weighted median cut to `n` colours, then a few k-means passes so the entries sit on real clusters. `forced` colours
 * (ink, lacquer, gold) are always kept and take part as fixed centres. Deterministic.
 */
export function derivePalette(counts: ColourCounts, n: number, forced: readonly Col[] = []): Col[] {
  const out: Col[] = [...new Set(forced.map((c) => (c | 0xff000000) >>> 0))];
  const want = Math.max(1, n - out.length);
  const all: [number, number][] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (all.length <= want) return [...out, ...all.map(([c]) => c)].slice(0, n);
  const boxes: Box[] = [{ cols: all, total: all.reduce((s, [, w]) => s + w, 0) }];
  while (boxes.length < want) {
    // split the box with the largest weighted extent
    let bi = -1;
    let best = -1;
    boxes.forEach((b, i) => {
      if (b.cols.length < 2) return;
      const score = boxRange(b).span * Math.sqrt(b.total);
      if (score > best) {
        best = score;
        bi = i;
      }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    const { ch } = boxRange(b);
    const get = (c: number): number => (ch === 0 ? cr(c) : ch === 1 ? cg(c) : cb(c));
    const sorted = [...b.cols].sort((p, q) => get(p[0]) - get(q[0]) || p[0] - q[0]);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i][1];
      cut = i + 1;
      if (acc >= b.total / 2) break;
    }
    const left = sorted.slice(0, cut);
    const right = sorted.slice(cut);
    boxes.splice(bi, 1, { cols: left, total: left.reduce((s, [, w]) => s + w, 0) }, { cols: right, total: right.reduce((s, [, w]) => s + w, 0) });
  }
  let centres = boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const [c, w] of b.cols) {
      r += cr(c) * w;
      g += cg(c) * w;
      bl += cb(c) * w;
    }
    return [r / b.total, g / b.total, bl / b.total];
  });
  const fixed = out.map((c) => [cr(c), cg(c), cb(c)]);
  for (let it = 0; it < 4; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const [c, w] of all) {
      const p = [cr(c), cg(c), cb(c)];
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < centres.length; i++) {
        const d = (centres[i][0] - p[0]) ** 2 + (centres[i][1] - p[1]) ** 2 + (centres[i][2] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      // a colour closer to a forced centre does not pull the free ones
      let fd = Infinity;
      for (const f of fixed) fd = Math.min(fd, (f[0] - p[0]) ** 2 + (f[1] - p[1]) ** 2 + (f[2] - p[2]) ** 2);
      if (fd <= bd) continue;
      sum[bi][0] += p[0] * w;
      sum[bi][1] += p[1] * w;
      sum[bi][2] += p[2] * w;
      sum[bi][3] += w;
    }
    centres = centres.map((c, i) => (sum[i][3] > 0 ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const seen = new Set(out);
  for (const c of centres) {
    const col = rgba(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]));
    if (!seen.has(col)) {
      seen.add(col);
      out.push(col);
    }
  }
  return out;
}

/** '#rrggbb' strings (the committed palette file format) to packed colours and back. */
export const paletteFromHex = (list: readonly string[]): Col[] =>
  list.map((h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
  });
export const paletteToHex = (pal: readonly Col[]): string[] => pal.map((c) => `#${((1 << 24) | (cr(c) << 16) | (cg(c) << 8) | cb(c)).toString(16).slice(1)}`);

/** Perceptual-ish distance (redmean weighting), squared. */
export function colourDist2(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** Nearest palette entry (index) for an RGB value. */
export function nearestIndex(pal: readonly Col[], r: number, g: number, b: number): number {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const d = colourDist2(r, g, b, cr(pal[i]), cg(pal[i]), cb(pal[i]));
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

/** Snap every opaque pixel to the palette. Transparent pixels stay 0. Returns the number of distinct colours used. */
export function snapToPalette(img: RawImage, pal: readonly Col[]): number {
  const used = new Set<number>();
  const cache = new Map<number, number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = nearestIndex(pal, d[i], d[i + 1], d[i + 2]);
      cache.set(key, idx);
    }
    const c = pal[idx];
    d[i] = cr(c);
    d[i + 1] = cg(c);
    d[i + 2] = cb(c);
    d[i + 3] = 255;
    used.add(idx);
  }
  return used.size;
}

// ---------------------------------------------------------------------------
// Alpha, background, cropping, resizing
// ---------------------------------------------------------------------------

/** Force alpha to 0 or 255 (threshold) and clear the colour of transparent pixels. Returns the opaque pixel count. */
export function cleanAlpha(img: RawImage, threshold = 128): number {
  let n = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= threshold) {
      d[i + 3] = 255;
      n++;
    } else {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
  }
  return n;
}

export const cloneImage = (img: RawImage): RawImage => ({ w: img.w, h: img.h, data: img.data.slice() });

/** The most common colour on the border (bucketed to 16 levels per channel), as [r, g, b]. */
export function borderColour(img: RawImage): [number, number, number] {
  const { w, h, data } = img;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number): void => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    buckets.set(key, e);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [0, 0, 0];
}

export interface BgOptions {
  /** 'auto': transparent border keeps its alpha, otherwise flood the dominant border colour. 'none' leaves the picture alone. */
  mode?: 'auto' | 'none';
  /** Explicit background colour instead of the detected one. */
  colour?: [number, number, number];
  /** Flood tolerance in colour-distance units (redmean, not squared). */
  tolerance?: number;
  /**
   * Also take soft cast shadows: pixels touching the cleared background that are just a darker, equally neutral version of it
   * (default on). Without this a drop shadow under a picture becomes a pale blob glued to the feet.
   */
  shadows?: boolean;
}

/** A darkened copy of the background: every channel between 45% and 100% of it and the same (low) colour spread. */
export function isShadowOf(r: number, g: number, b: number, bg: readonly [number, number, number]): boolean {
  const spread = (x: number, y: number, z: number): number => Math.max(x, y, z) - Math.min(x, y, z);
  if (r > bg[0] + 4 || g > bg[1] + 4 || b > bg[2] + 4) return false;
  if (r < bg[0] * 0.45 || g < bg[1] * 0.45 || b < bg[2] * 0.45) return false;
  return Math.abs(spread(r, g, b) - spread(bg[0], bg[1], bg[2])) <= 22;
}

/**
 * Remove a flat background by flood fill from the border (4-connected), so the same colour inside the object survives.
 * An image whose border is already transparent is left as it is. Returns the number of pixels cleared.
 */
export function removeBackground(img: RawImage, o: BgOptions = {}): number {
  if (o.mode === 'none') return 0;
  const { w, h, data } = img;
  let borderTransparent = 0;
  let borderTotal = 0;
  const probe = (x: number, y: number): void => {
    borderTotal++;
    if (data[(y * w + x) * 4 + 3] < 128) borderTransparent++;
  };
  for (let x = 0; x < w; x++) {
    probe(x, 0);
    probe(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    probe(0, y);
    probe(w - 1, y);
  }
  if (!o.colour && borderTransparent > borderTotal * 0.5) return 0;
  const bg = o.colour ?? borderColour(img);
  const tol = (o.tolerance ?? 40) ** 2 * 6;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (seen[k]) return;
    const i = k * 4;
    if (data[i + 3] >= 128 && colourDist2(data[i], data[i + 1], data[i + 2], bg[0], bg[1], bg[2]) > tol && !(o.shadows !== false && isShadowOf(data[i], data[i + 1], data[i + 2], bg))) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  let n = 0;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k - x) / w;
    const i = k * 4;
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    n++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return n;
}

/** Bounds of the pixels with alpha above the threshold, or null. */
export function opaqueBounds(img: RawImage, threshold = 1): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Crop to the opaque bounds plus `pad` transparent pixels on every side. */
export function cropToBounds(img: RawImage, pad = 0): RawImage {
  const b = opaqueBounds(img);
  if (!b) throw new Error('image has no opaque pixels after background removal');
  const w = b.x1 - b.x0 + 1 + pad * 2;
  const h = b.y1 - b.y0 + 1 + pad * 2;
  const out: RawImage = { w, h, data: new Uint8Array(w * h * 4) };
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), ((y - b.y0 + pad) * w + (x - b.x0 + pad)) * 4);
  return out;
}

export type ResizeMethod = 'area' | 'nearest';

/**
 * Resize to a target height keeping the aspect ratio. 'area' averages the covered source pixels (alpha-weighted, so edges do not
 * bleed the background colour in; best for painted or photographic sources), 'nearest' picks the centre pixel (best for
 * sources that are already pixel art at a larger scale).
 */
export function resizeToHeight(img: RawImage, targetH: number, method: ResizeMethod = 'area'): RawImage {
  const th = Math.max(1, Math.round(targetH));
  const k = th / img.h;
  const tw = Math.max(1, Math.round(img.w * k));
  const out: RawImage = { w: tw, h: th, data: new Uint8Array(tw * th * 4) };
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const o = (y * tw + x) * 4;
      const sx0 = (x * img.w) / tw;
      const sx1 = ((x + 1) * img.w) / tw;
      const sy0 = (y * img.h) / th;
      const sy1 = ((y + 1) * img.h) / th;
      if (method === 'nearest') {
        const sx = Math.min(img.w - 1, Math.floor((sx0 + sx1) / 2));
        const sy = Math.min(img.h - 1, Math.floor((sy0 + sy1) / 2));
        out.data.set(img.data.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), o);
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          const wx = Math.min(xx + 1, sx1) - Math.max(xx, sx0);
          const wgt = wx * wy;
          const i = (Math.min(yy, img.h - 1) * img.w + Math.min(xx, img.w - 1)) * 4;
          const al = img.data[i + 3] / 255;
          r += img.data[i] * al * wgt;
          g += img.data[i + 1] * al * wgt;
          b += img.data[i + 2] * al * wgt;
          a += al * wgt;
          wsum += wgt;
        }
      }
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
        out.data[o + 3] = Math.round((a / wsum) * 255);
      }
    }
  return out;
}

/** Remove opaque 8-connected islands smaller than `minFrac` of the biggest one. Returns the pixels removed. */
export function removeSpecks(img: RawImage, minFrac = 0.02): number {
  const { w, h, data } = img;
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || data[s * 4 + 3] === 0) continue;
    const id = sizes.length;
    let n = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      const x = k % w;
      const y = (k - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (label[nk] >= 0 || data[nk * 4 + 3] === 0) continue;
          label[nk] = id;
          stack.push(nk);
        }
    }
    sizes.push(n);
  }
  const max = Math.max(0, ...sizes);
  let removed = 0;
  for (let k = 0; k < w * h; k++) {
    if (label[k] >= 0 && sizes[label[k]] < max * minFrac) {
      data.fill(0, k * 4, k * 4 + 4);
      removed++;
    }
  }
  return removed;
}

/**
 * Add a 1 px outline around the opaque shape (4-neighbourhood) in `ink`. Grows the image by one pixel on every side.
 * Pixels already inside the shape are not touched.
 */
export function addOutline(img: RawImage, ink: Col): RawImage {
  const w = img.w + 2;
  const h = img.h + 2;
  const out: RawImage = { w, h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + 1) * w + 1) * 4);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && out.data[(y * w + x) * 4 + 3] === 255;
  const mark: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) mark.push(y * w + x);
    }
  for (const k of mark) {
    out.data[k * 4] = cr(ink);
    out.data[k * 4 + 1] = cg(ink);
    out.data[k * 4 + 2] = cb(ink);
    out.data[k * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anchor, spans, measurements
// ---------------------------------------------------------------------------

export type AnchorMode = 'feet' | 'footprint';

/**
 * Ground-contact point. 'feet': bottom row of the silhouette, horizontal centre of its bounds (people, animals, poles; pass an explicit x,y for a lopsided pose).
 * 'footprint': the centre of the ground diamond of a w x d footprint, whose nearest corner touches the bottom row, so the
 * anchor is (w + d) * 4 px above it (a tile diamond is 32 x 16 px: half height 8 per tile of w or d... centre at (w + d) * 4).
 */
export function anchorFor(img: RawImage, mode: AnchorMode, fp: { w: number; d: number } = { w: 1, d: 1 }): { ax: number; ay: number } {
  const b = opaqueBounds(img);
  if (!b) throw new Error('empty image');
  if (mode === 'footprint') return { ax: Math.round((b.x0 + b.x1) / 2), ay: b.y1 - Math.round((fp.w + fp.d) * 4) };
  return { ax: Math.round((b.x0 + b.x1) / 2), ay: b.y1 };
}

/** Packed game pixels (little-endian ImageData order) from RGBA bytes. */
export function packPixels(img: RawImage): Uint32Array {
  const out = new Uint32Array(img.w * img.h);
  for (let i = 0; i < out.length; i++) out[i] = ((img.data[i * 4 + 3] << 24) | (img.data[i * 4 + 2] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4]) >>> 0;
  return out;
}

/** Opaque extent per row, same format as `rowSpans` in render/occlusion.ts. */
export const spansOf = (img: RawImage): RowSpans => rowSpans(packPixels(img), img.w, img.h);

/** Mirror a row-span table for a horizontally flipped sprite of width `w`. */
export function mirrorSpans(s: RowSpans, w: number): RowSpans {
  const min = new Int16Array(s.min.length);
  const max = new Int16Array(s.max.length);
  for (let y = 0; y < s.min.length; y++) {
    if (s.max[y] < 0) {
      min[y] = 32767;
      max[y] = -1;
    } else {
      min[y] = w - 1 - s.max[y];
      max[y] = w - 1 - s.min[y];
    }
  }
  return { min, max };
}

/** Distinct opaque colours and the share of translucent pixels, for the quality report. */
export function imageStats(img: RawImage): { opaque: number; translucent: number; colours: number } {
  let opaque = 0;
  let translucent = 0;
  const cols = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a === 255) {
      opaque++;
      cols.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    } else if (a > 0) translucent++;
  }
  return { opaque, translucent, colours: cols.size };
}

/**
 * Isometric angle check: fits the left and right silhouette edges of the lower part of the image (where the ground diamond
 * is) and returns their slopes |dy/dx|. A 2:1 tile diamond has 0.5. NaN where there are too few edge pixels.
 */
export function groundEdgeSlopes(img: RawImage, bottomFrac = 0.3): { left: number; right: number } {
  const b = opaqueBounds(img);
  if (!b) return { left: NaN, right: NaN };
  const y0 = Math.floor(b.y1 - (b.y1 - b.y0) * bottomFrac);
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  for (let y = y0; y <= b.y1; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = b.x0; x <= b.x1; x++)
      if (img.data[(y * img.w + x) * 4 + 3] > 0) {
        if (lo < 0) lo = x;
        hi = x;
      }
    if (lo >= 0) {
      L.push([lo, y]);
      R.push([hi, y]);
    }
  }
  const slope = (pts: [number, number][]): number => {
    if (pts.length < 4) return NaN;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const [x, y] of pts) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
    }
    return sxx < 1e-9 ? Infinity : Math.abs(sxy / sxx);
  };
  return { left: slope(L), right: slope(R) };
}

// ---------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------

export interface ProcessOptions {
  /** Final height of the opaque silhouette in px, outline included. */
  height: number;
  palette: readonly Col[];
  method?: ResizeMethod;
  bg?: BgOptions;
  /** 1 px ink outline colour; null skips the outline. */
  ink?: Col | null;
  anchor?: AnchorMode | { ax: number; ay: number };
  footprint?: { w: number; d: number };
  /** Alpha threshold (0-255) used when the resize leaves partial coverage. */
  alphaThreshold?: number;
  /** Subtract this many px from the measured height above the anchor (deep footprints whose far end rises above the ground point). */
  apexOffset?: number;
}

export interface ProcessedSprite {
  img: RawImage;
  ax: number;
  ay: number;
  top: number;
  heightPx: number;
  footprint: { w: number; d: number };
  spans: RowSpans;
  stats: { opaque: number; translucent: number; colours: number; bgRemoved: number; specksRemoved: number };
}

export function processSprite(src: RawImage, o: ProcessOptions): ProcessedSprite {
  const work = cloneImage(src);
  const bgRemoved = removeBackground(work, o.bg);
  cleanAlpha(work, 128);
  let img = cropToBounds(work);
  const outlinePx = o.ink === null ? 0 : 2;
  img = resizeToHeight(img, Math.max(1, o.height - outlinePx), o.method ?? 'area');
  cleanAlpha(img, o.alphaThreshold ?? 128);
  const specksRemoved = removeSpecks(img);
  img = cropToBounds(img);
  snapToPalette(img, o.palette);
  if (o.ink !== null) img = addOutline(img, o.ink ?? rgba(0x1c, 0x18, 0x20));
  const fp = o.footprint ?? { w: 1, d: 1 };
  const an = !o.anchor || typeof o.anchor === 'string' ? anchorFor(img, o.anchor ?? 'feet', fp) : o.anchor;
  const b = opaqueBounds(img)!;
  const st = imageStats(img);
  return {
    img,
    ax: an.ax,
    ay: an.ay,
    top: b.y0,
    heightPx: an.ay - b.y0 + 1 - (o.apexOffset ?? 0),
    footprint: fp,
    spans: spansOf(img),
    stats: { ...st, bgRemoved, specksRemoved },
  };
}
