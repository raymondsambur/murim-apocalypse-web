/**
 * A tiny software rasteriser for crisp pixel art (no anti-aliasing). Everything procedural is drawn
 * into a PixelBuffer and uploaded to a canvas once. Pure (no DOM) so it can be unit tested.
 */
import { ca, mix, over, scale, type Col } from './color';

export type ColorFn = (x: number, y: number) => Col;

export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.ceil(w));
    this.h = Math.max(1, Math.ceil(h));
    this.px = new Uint32Array(this.w * this.h);
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Col {
    x |= 0;
    y |= 0;
    return this.inb(x, y) ? this.px[y * this.w + x] : 0;
  }

  /** Plain write (alpha < 255 is alpha-blended over what is there). */
  set(x: number, y: number, c: Col): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c === 0) return;
    const i = y * this.w + x;
    if (c >>> 24 === 255) this.px[i] = c;
    else this.px[i] = over(this.px[i], c);
  }

  /** Overwrite including transparent values. */
  put(x: number, y: number, c: Col): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  /** Only paint where something is already opaque (for shading passes). */
  setIfOpaque(x: number, y: number, c: Col): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inb(x, y)) return;
    const i = y * this.w + x;
    if (this.px[i] >>> 24 === 0) return;
    this.px[i] = c >>> 24 === 255 ? c : over(this.px[i], c);
  }

  rect(x: number, y: number, w: number, h: number, c: Col | ColorFn): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, typeof c === 'number' ? c : c(xx, yy));
  }

  hline(x0: number, x1: number, y: number, c: Col): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: Col): void {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Col): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Thick line made of discs. */
  thick(x0: number, y0: number, x1: number, y1: number, r: number, c: Col | ColorFn): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, c);
    }
  }

  /** Filled ellipse sampled at pixel centres. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Col | ColorFn): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        if (dx * dx + dy * dy <= 1) this.set(x, y, typeof c === 'number' ? c : c(x, y));
      }
    }
  }

  /** Even-odd scanline polygon fill. `pts` is a flat [x0,y0,x1,y1,...] list. */
  poly(pts: readonly number[], c: Col | ColorFn): void {
    const n = pts.length >> 1;
    if (n < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pts[i * 2 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const ys = Math.max(0, Math.floor(minY));
    const ye = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = ys; y <= ye; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const j = (i + 1) % n;
        const bx = pts[j * 2];
        const by = pts[j * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(this.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let x = xa; x <= xb; x++) this.set(x, y, typeof c === 'number' ? c : c(x, y));
      }
    }
  }

  /** Copy another buffer on top (alpha-blended). */
  blit(src: PixelBuffer, dx: number, dy: number, flipX = false): void {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < src.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (c >>> 24 === 0) continue;
        this.set(x + dx, ty, c);
      }
    }
  }

  /**
   * Ink outline: transparent pixels touching an opaque one (4-neighbourhood) get a darkened version of
   * that neighbour (selective outline) or the given colour.
   */
  outline(ink?: Col, strength = 0.32, skipBelowY = Infinity): void {
    const { w, h, px } = this;
    const src = px.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] >>> 24 !== 0) continue;
        let nb = 0;
        if (x > 0 && src[i - 1] >>> 24 > 128) nb = src[i - 1];
        else if (x < w - 1 && src[i + 1] >>> 24 > 128) nb = src[i + 1];
        else if (y > 0 && src[i - w] >>> 24 > 128) nb = src[i - w];
        else if (y < h - 1 && src[i + w] >>> 24 > 128 && y < skipBelowY) nb = src[i + w];
        if (!nb) continue;
        px[i] = ink !== undefined ? ink : (scale(mix(nb, 0xff281c1e, 0.55), strength * 1.6) | 0xff000000) >>> 0;
      }
    }
  }

  /** Map every opaque pixel through fn. */
  map(fn: (c: Col, x: number, y: number) => Col): void {
    const { w, h, px } = this;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = px[i];
        if (c >>> 24 === 0) continue;
        px[i] = fn(c, x, y);
      }
  }

  clone(): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    b.px.set(this.px);
    return b;
  }

  flipped(): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.px[y * this.w + x] = this.px[y * this.w + (this.w - 1 - x)];
    return b;
  }

  /** Bounding box of non-transparent pixels, or null. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (ca(this.px[y * this.w + x]) > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }
}

/** Projected planar face with per-pixel (s, t) parameters for texturing. */
export interface FaceBasis {
  ox: number;
  oy: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * Fill a polygon and give the shader parametric coordinates on the face: the point is expressed as
 * origin + s * a + t * b (a, b are the projected basis vectors).
 */
export function fillFace(pb: PixelBuffer, pts: readonly number[], basis: FaceBasis, shader: (s: number, t: number, x: number, y: number) => Col): void {
  const det = basis.ax * basis.by - basis.ay * basis.bx;
  if (Math.abs(det) < 1e-9) return;
  const inv = 1 / det;
  pb.poly(pts, (x, y) => {
    const px = x + 0.5 - basis.ox;
    const py = y + 0.5 - basis.oy;
    const s = (px * basis.by - py * basis.bx) * inv;
    const t = (basis.ax * py - basis.ay * px) * inv;
    return shader(s, t, x, y);
  });
}
