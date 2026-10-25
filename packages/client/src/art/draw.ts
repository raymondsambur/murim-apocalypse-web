/** Shared pixel-art drawing helpers (pure). */
import { mix, rgba, scale, shade, type Col } from './color';
import { ihash } from './noise';
import { PixelBuffer } from './pixel';
import type { Ramp } from './palette';

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither offset in [-0.5, 0.5). */
export const bayer = (x: number, y: number): number => (BAYER4[(x & 3) + ((y & 3) << 2)] + 0.5) / 16 - 0.5;

/** Deterministic float in [0,1) from integer coordinates. */
export const hf = (a: number, b = 0, c = 0): number => ihash(a, b, c) / 4294967296;

/** Pick a ramp tone from a 0..1 value using four bands (dd, d, b, l). */
export function rampTone(r: Ramp, v: number): Col {
  return v < 0.27 ? r.dd : v < 0.46 ? r.d : v < 0.72 ? r.b : r.l;
}

export const INK_SHADOW = rgba(28, 20, 34, 255);

/** Soft ground shadow: a flattened translucent ellipse, offset toward the lower right (light from upper left). */
export function groundShadow(pb: PixelBuffer, cx: number, cy: number, rx: number, ry: number, alpha = 70): void {
  const c = rgba(24, 14, 40, alpha);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (dy * dy > 1) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      // dither the rim so the shadow edge looks hand-placed
      if (d > 0.7 && (x + y) & 1) continue;
      pb.set(x, y, c);
    }
  }
}

export interface BlobOpts {
  /** Light direction (towards the light), default upper-left. */
  lx?: number;
  ly?: number;
  /** Noise seed. */
  seed?: number;
  /** Fraction of pixels that get leaf speckle. */
  speckle?: number;
  /** Per-pixel colour override hook (blossoms, snow...). Return 0 to keep the shaded colour. */
  accent?: (x: number, y: number, v: number) => Col;
  /** Darken the lower rim to separate stacked clumps. */
  rim?: number;
}

/** Shaded, dithered, speckled ellipse (foliage clump, bush, rock). */
export function shadedBlob(pb: PixelBuffer, cx: number, cy: number, rx: number, ry: number, r: Ramp, o: BlobOpts = {}): void {
  const lx = o.lx ?? -0.55;
  const ly = o.ly ?? -0.8;
  const seed = o.seed ?? 0;
  const sp = o.speckle ?? 0.14;
  const rim = o.rim ?? 0.12;
  const len = Math.hypot(lx, ly);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const ny = (y + 0.5 - cy) / ry;
    if (ny * ny > 1) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      let v = 0.48 + 0.42 * ((nx * lx + ny * ly) / len) * (1 - nz * 0.4) + 0.16 * nz - 0.14;
      const h = hf(x, y, seed);
      v += (h - 0.5) * 0.2 + bayer(x, y) * 0.16;
      if (h < sp) v += 0.2;
      else if (h > 1 - sp * 0.7) v -= 0.18;
      if (ny > 0.55) v -= (ny - 0.55) * rim * 3;
      let c = rampTone(r, v);
      if (o.accent) {
        const a = o.accent(x, y, v);
        if (a) c = a;
      }
      pb.set(x, y, c);
    }
  }
}

/** Vertical tapered trunk with simple left-lit shading and bark flecks. */
export function trunk(pb: PixelBuffer, x: number, yTop: number, yBot: number, wTop: number, wBot: number, r: Ramp, seed = 0): void {
  const h = Math.max(1, yBot - yTop);
  for (let y = Math.floor(yTop); y <= Math.ceil(yBot); y++) {
    const t = (y - yTop) / h;
    const w = wTop + (wBot - wTop) * t;
    const x0 = x - w / 2;
    for (let xx = Math.floor(x0); xx < Math.ceil(x0 + w); xx++) {
      const u = (xx + 0.5 - x0) / w;
      let c = u < 0.34 ? r.l : u < 0.7 ? r.b : r.d;
      if (hf(xx, y, seed) < 0.12) c = r.d;
      if (u > 0.9) c = r.dd;
      pb.set(xx, y, c);
    }
  }
}

/** Thick branch from (x0,y0) to (x1,y1) shaded by a ramp. */
export function branch(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, r: Ramp): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const w = w0 + (w1 - w0) * t;
    const half = w / 2;
    for (let yy = Math.floor(y - half); yy <= Math.ceil(y + half); yy++)
      for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half); xx++) {
        const dx = xx + 0.5 - x;
        pb.set(xx, yy, dx < -half * 0.2 ? r.l : dx > half * 0.5 ? r.d : r.b);
      }
  }
}

/** Convenience: tinted copy of a colour. */
export const tint = (c: Col, to: Col, t: number): Col => mix(c, to, t);
export { scale, shade, mix };

/** Mirror a buffer horizontally into a new one (anchor must be mirrored by the caller). */
export function mirrored(pb: PixelBuffer): PixelBuffer {
  return pb.flipped();
}
