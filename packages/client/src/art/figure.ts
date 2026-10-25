/**
 * Figure toolkit for the paper-doll renderer: a mask based shape shader (union of capsules / ellipses / polygons that is
 * then shaded as one piece with rim light, dithering and ambient occlusion), two-bone IK, rotated weapon shapes,
 * selective outlining and nearest-neighbour rotation. Pure (no DOM), so everything is node-testable.
 */
import { mix, rgba, scale, type Col } from './color';
import { bayer, hf, rampTone } from './draw';
import { PixelBuffer } from './pixel';
import type { Ramp } from './palette';

export interface ShadeOpts {
  /** Noise seed for the speckle. */
  seed?: number;
  /** Shift the whole tone (+ lighter). */
  lit?: number;
  /** Ambient occlusion strength toward the bottom. */
  ao?: number;
  /** Disable the rim light / rim shadow. */
  noRim?: boolean;
  /** Horizontal shading sharpness (default 0.46). */
  grad?: number;
  flip?: boolean;
  /** Use the specular tone on the lit rim (large flat shapes). */
  hlRim?: boolean;
}

/** Shape accumulator + shader. One instance per figure (cheap), `clear()` between parts. */
export class Shaper {
  readonly w: number;
  readonly h: number;
  readonly m: Uint8Array;
  private rl: Int16Array;
  private rr: Int16Array;
  x0 = 1e9;
  y0 = 1e9;
  x1 = -1;
  y1 = -1;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.m = new Uint8Array(w * h);
    this.rl = new Int16Array(h);
    this.rr = new Int16Array(h);
  }

  clear(): this {
    if (this.x1 >= this.x0) for (let y = this.y0; y <= this.y1; y++) this.m.fill(0, y * this.w + this.x0, y * this.w + this.x1 + 1);
    this.x0 = 1e9;
    this.y0 = 1e9;
    this.x1 = -1;
    this.y1 = -1;
    return this;
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.m[y * this.w + x] === 1;
  }

  private mark(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.m[y * this.w + x] = 1;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }

  ell(cx: number, cy: number, rx: number, ry: number): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        if (dx * dx + dy * dy <= 1) this.mark(x, y);
      }
    }
    return this;
  }

  /** Tapered capsule between two points. */
  cap(ax: number, ay: number, bx: number, by: number, r0: number, r1 = r0): this {
    const minx = Math.floor(Math.min(ax - r0, bx - r1));
    const maxx = Math.ceil(Math.max(ax + r0, bx + r1));
    const miny = Math.floor(Math.min(ay - r0, by - r1));
    const maxy = Math.ceil(Math.max(ay + r0, by + r1));
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-6;
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        let t = (px * dx + py * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t;
        const ey = py - dy * t;
        const r = r0 + (r1 - r0) * t;
        if (ex * ex + ey * ey <= r * r) this.mark(x, y);
      }
    return this;
  }

  /** Even-odd polygon fill sampled at pixel centres. */
  poly(pts: readonly number[]): this {
    const n = pts.length >> 1;
    if (n < 3) return this;
    let minY = 1e9;
    let maxY = -1e9;
    for (let i = 0; i < n; i++) {
      minY = Math.min(minY, pts[i * 2 + 1]);
      maxY = Math.max(maxY, pts[i * 2 + 1]);
    }
    const xs: number[] = [];
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ay = pts[i * 2 + 1];
        const by = pts[j * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(pts[i * 2] + ((sy - ay) / (by - ay)) * (pts[j * 2] - pts[i * 2]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k] - 0.5);
        const xb = Math.ceil(xs[k + 1] - 0.5) - 1;
        for (let x = xa; x <= xb; x++) this.mark(x, y);
      }
    }
    return this;
  }

  /** Add every pixel in the box for which fn is true. */
  fill(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => boolean): this {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (fn(x, y)) this.mark(x, y);
    return this;
  }

  /** Remove an ellipse from the mask (cut-outs). */
  cutEll(cx: number, cy: number, rx: number, ry: number): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        if (dx * dx + dy * dy <= 1 && x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = 0;
      }
    }
    return this;
  }

  get empty(): boolean {
    return this.x1 < this.x0;
  }

  /** Paint the mask with 3-4 tone left-lit shading, rim light and ambient occlusion. */
  shade(pb: PixelBuffer, r: Ramp, o: ShadeOpts = {}): this {
    if (this.empty) return this;
    const { w, m, rl, rr } = this;
    const seed = o.seed ?? 0;
    const lit = o.lit ?? 0;
    const ao = o.ao ?? 0.14;
    const grad = o.grad ?? 0.46;
    for (let y = this.y0; y <= this.y1; y++) {
      let a = -1;
      let b = -1;
      for (let x = this.x0; x <= this.x1; x++)
        if (m[y * w + x]) {
          if (a < 0) a = x;
          b = x;
        }
      rl[y] = a;
      rr[y] = b;
    }
    const hgt = this.y1 - this.y0 + 1;
    for (let y = this.y0; y <= this.y1; y++) {
      const a = rl[y];
      const b = rr[y];
      if (a < 0) continue;
      const rw = b - a + 1;
      for (let x = a; x <= b; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        let u = rw <= 1 ? 0.35 : (x - a + 0.5) / rw;
        if (o.flip) u = 1 - u;
        const t = (y - this.y0 + 0.5) / hgt;
        const v = 0.84 - grad * u - ao * t + lit + bayer(x, y) * 0.09 + (hf(x, y, seed) - 0.5) * 0.05;
        let c = rampTone(r, v);
        if (!o.noRim && rw >= 3 && hgt >= 3) {
          const L = x <= 0 || !m[i - 1];
          const R = x >= w - 1 || !m[i + 1];
          const T = y <= 0 || !m[i - w];
          const B = y >= this.h - 1 || !m[i + w];
          if (B) c = r.dd;
          else if (R && !L) c = r.d;
          else if (L && !R) c = o.hlRim && v > 0.55 ? r.hl : r.l;
          else if (T) c = r.l;
        }
        pb.set(x, y, c);
      }
    }
    return this;
  }

  /** Paint with a custom colour function. */
  paint(pb: PixelBuffer, fn: (x: number, y: number) => Col): this {
    for (let y = this.y0; y <= this.y1; y++) for (let x = this.x0; x <= this.x1; x++) if (this.m[y * this.w + x]) pb.set(x, y, fn(x, y));
    return this;
  }

  /** Draw a line only where the mask is set (cloth folds, seams, trims). */
  line(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: Col): this {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    let lx = -1e9;
    let ly = -1e9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.floor(x0 + (x1 - x0) * t);
      const y = Math.floor(y0 + (y1 - y0) * t);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      if (this.has(x, y)) pb.set(x, y, c);
    }
    return this;
  }
}

// ---------------------------------------------------------------------------
// IK
// ---------------------------------------------------------------------------

/** Two-bone IK. out = [jointX, jointY, endX, endY]. `bend` +1 / -1 selects the elbow side. */
export function ik2(sx: number, sy: number, tx: number, ty: number, l1: number, l2: number, bend: number, out: number[]): number[] {
  let dx = tx - sx;
  let dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.02;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  if (d < 0.8) {
    d = 0.8;
    if (dx === 0 && dy === 0) dy = 0.8;
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d;
  const uy = dy / d;
  out[0] = sx + ux * a - uy * h * bend;
  out[1] = sy + uy * a + ux * h * bend;
  out[2] = sx + dx;
  out[3] = sy + dy;
  return out;
}

// ---------------------------------------------------------------------------
// rotated weapon shapes
// ---------------------------------------------------------------------------

export interface RotCtx {
  /** Pivot (hand) and axis direction. */
  hx: number;
  hy: number;
  dx: number;
  dy: number;
  /** Which perpendicular side is lit (+1 / -1). */
  lit: number;
}

export function rotCtx(hx: number, hy: number, angleDeg: number): RotCtx {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // perpendicular (-dy, dx); light comes from the upper left (-0.55, -0.83)
  const lit = -dy * -0.55 + dx * -0.83 > 0 ? 1 : -1;
  return { hx, hy, dx, dy, lit };
}

/** Point along the axis (s) and across (o). */
export function rotAt(c: RotCtx, s: number, o = 0): [number, number] {
  return [c.hx + c.dx * s - c.dy * o, c.hy + c.dy * s + c.dx * o];
}

/**
 * Fill the region s0..s1 with half width hw(s) (null = skip). color(s, oNorm, hw, litSide) is called per pixel where
 * oNorm in -1..1 is the signed across position with +1 on the lit side.
 */
export function rotFill(
  pb: PixelBuffer,
  c: RotCtx,
  s0: number,
  s1: number,
  hw: (s: number) => number,
  color: (s: number, o: number, hw: number, x: number, y: number) => Col,
  bend?: (s: number) => number,
): void {
  const maxHw = 6;
  const ex = [c.hx + c.dx * s0, c.hx + c.dx * s1];
  const ey = [c.hy + c.dy * s0, c.hy + c.dy * s1];
  const minx = Math.floor(Math.min(ex[0], ex[1]) - maxHw);
  const maxx = Math.ceil(Math.max(ex[0], ex[1]) + maxHw);
  const miny = Math.floor(Math.min(ey[0], ey[1]) - maxHw);
  const maxy = Math.ceil(Math.max(ey[0], ey[1]) + maxHw);
  for (let y = miny; y <= maxy; y++)
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5 - c.hx;
      const py = y + 0.5 - c.hy;
      const s = px * c.dx + py * c.dy;
      if (s < s0 || s > s1) continue;
      const o = -px * c.dy + py * c.dx - (bend ? bend(s) : 0);
      const w = hw(s);
      if (w <= 0) continue;
      if (Math.abs(o) > w + 0.3) continue;
      const on = Math.max(-1, Math.min(1, (o / (w + 0.3)) * c.lit));
      pb.set(x, y, color(s, on, w, x, y));
    }
}

// ---------------------------------------------------------------------------
// outline + rotation
// ---------------------------------------------------------------------------

/**
 * Selective outline: transparent pixels next to an opaque one become ink. On the lit side (upper left) the outline takes
 * a dark version of the neighbour's colour so the silhouette stays soft; elsewhere it is full ink.
 */
export function selOutline(pb: PixelBuffer, ink: Col): void {
  const { w, h, px } = pb;
  const src = px.slice();
  const op = (i: number): boolean => src[i] >>> 24 > 150;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] >>> 24 !== 0) continue;
      const nR = x < w - 1 && op(i + 1);
      const nB = y < h - 1 && op(i + w);
      const nL = x > 0 && op(i - 1);
      const nT = y > 0 && op(i - w);
      if (!(nR || nB || nL || nT)) continue;
      // transparent pixel on the lit side of the figure: neighbour to its right/below
      if ((nR || nB) && !(nL || nT)) {
        const nb = src[nR ? i + 1 : i + w];
        px[i] = (scale(mix(nb, ink, 0.62), 0.9) | 0xff000000) >>> 0;
      } else px[i] = ink;
    }
}

/** Rotate by `deg` degrees (clockwise on screen) about a pivot, nearest neighbour, into a same-sized buffer. */
export function rotateNearest(src: PixelBuffer, deg: number, pivX: number, pivY: number, shX = 0, shY = 0): PixelBuffer {
  const out = new PixelBuffer(src.w, src.h);
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const dx = x + 0.5 - pivX - shX;
      const dy = y + 0.5 - pivY - shY;
      const sx = Math.floor(pivX + dx * ca + dy * sa);
      const sy = Math.floor(pivY - dx * sa + dy * ca);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      out.px[y * out.w + x] = src.px[sy * src.w + sx];
    }
  return out;
}

export const rgbaCol = rgba;
