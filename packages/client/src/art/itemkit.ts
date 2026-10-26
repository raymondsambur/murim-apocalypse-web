/**
 * Drawing kit for the item icons: shape tests, the edge-lit `fillShape` shader, halo glow and small helpers. Pure.
 */
import { rgba, type Col } from './color';
import { bayer, hf, rampTone } from './draw';
import { INK_SOFT, ramp, type Ramp } from './palette';
import { PixelBuffer } from './pixel';

export const ICON_PX = 40;

export interface ItemIcon {
  pb: PixelBuffer;
  /** Additive glow layer (rare pills, cores); null when there is none. */
  glow: PixelBuffer | null;
}

// A shape is a point test; `fillShape` shades it with edge light (upper left lit, lower right dark).

export type Test = (x: number, y: number) => boolean;

export const ell = (cx: number, cy: number, rx: number, ry = rx): Test => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
export const box = (x0: number, y0: number, x1: number, y1: number): Test => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
export const not = (a: Test): Test => (x, y) => !a(x, y);
export const or = (...t: Test[]): Test => (x, y) => t.some((f) => f(x, y));
export const and = (...t: Test[]): Test => (x, y) => t.every((f) => f(x, y));
export const sub = (a: Test, b: Test): Test => (x, y) => a(x, y) && !b(x, y);

export function poly(pts: readonly number[]): Test {
  const n = pts.length >> 1;
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2];
      const yi = pts[i * 2 + 1];
      const xj = pts[j * 2];
      const yj = pts[j * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** Capsule from (x0,y0) to (x1,y1) with radius r0 growing to r1. */
export function cap(x0: number, y0: number, x1: number, y1: number, r0: number, r1 = r0): Test {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
    const r = r0 + (r1 - r0) * t;
    return (x - (x0 + dx * t)) ** 2 + (y - (y0 + dy * t)) ** 2 <= r * r;
  };
}

export interface FillOpts {
  seed?: number;
  /** Texture noise amplitude (0..0.4). */
  noise?: number;
  /** Strength of the light gradient across the shape (0..0.6). */
  grad?: number;
  /** Edge light strength (upper-left rim lighter, lower-right rim darker). */
  edge?: number;
  /** Paint this tone only (no shading), e.g. a flat face. */
  flat?: Col;
  /** Per-pixel colour hook: return 0 to keep the shaded tone. */
  tex?: (x: number, y: number, v: number) => Col;
}

/** Fill every pixel (centre sampled) of the shape with ramp tones chosen by light, edge and a little dither. */
export function fillShape(pb: PixelBuffer, test: Test, r: Ramp, o: FillOpts = {}): void {
  const { w, h } = pb;
  const mask = new Uint8Array(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (test(x + 0.5, y + 0.5)) {
        mask[y * w + x] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const ex = Math.max(1, (x1 - x0) / 2);
  const ey = Math.max(1, (y1 - y0) / 2);
  const grad = o.grad ?? 0.32;
  const edge = o.edge ?? 0.3;
  const noise = o.noise ?? 0.1;
  const seed = o.seed ?? 0;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!mask[y * w + x]) continue;
      if (o.flat !== undefined) {
        pb.put(x, y, o.flat);
        continue;
      }
      // light from the upper left: top-left of the shape is brighter
      let v = 0.56 - ((x - cx) / ex) * grad * 0.7 - ((y - cy) / ey) * grad * 0.9;
      if (!at(x, y - 1) || !at(x - 1, y)) v += edge;
      if (!at(x, y + 1) || !at(x + 1, y)) v -= edge;
      v += (hf(x, y, seed) - 0.5) * noise * 2 + bayer(x, y) * 0.1;
      const t = o.tex?.(x, y, v);
      pb.put(x, y, t ? t : rampTone(r, v));
    }
}

/** Single pixels / small marks. */
export const px = (pb: PixelBuffer, x: number, y: number, c: Col): void => pb.set(x, y, c);

export function line(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: Col): void {
  pb.line(x0, y0, x1, y1, c);
}

export const WHITE = rgba(255, 255, 255);
export const CORD = ramp('#5a3a28', 0.6, 1.4);

export function newIcon(): { pb: PixelBuffer; glow: PixelBuffer } {
  return { pb: new PixelBuffer(ICON_PX, ICON_PX), glow: new PixelBuffer(ICON_PX, ICON_PX) };
}

/** Soft radial glow into the additive layer. */
export function halo(g: PixelBuffer, cx: number, cy: number, r: number, c: Col, strength = 1): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      const a = Math.round(120 * strength * (1 - d) ** 1.6);
      if (a > 12) g.set(x, y, rgba(c & 255, (c >>> 8) & 255, (c >>> 16) & 255, a));
    }
}

/** Move opaque content so its bounds are centred (and optionally sit on a baseline offset). */
export function centreIcon(pb: PixelBuffer, glow?: PixelBuffer): void {
  const b = pb.bounds();
  if (!b) return;
  const dx = Math.round((pb.w - 1) / 2 - (b.x0 + b.x1) / 2);
  const dy = Math.round((pb.h - 1) / 2 - (b.y0 + b.y1) / 2);
  if (!dx && !dy) return;
  for (const buf of glow ? [pb, glow] : [pb]) {
    const src = buf.px.slice();
    buf.px.fill(0);
    for (let y = 0; y < buf.h; y++)
      for (let x = 0; x < buf.w; x++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < buf.w && ny < buf.h) buf.px[ny * buf.w + nx] = src[y * buf.w + x];
      }
  }
}

export function finish(pb: PixelBuffer, glow: PixelBuffer): ItemIcon {
  pb.outline(INK_SOFT);
  return { pb, glow: glow.bounds() ? glow : null };
}

