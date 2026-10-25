/**
 * A tiny z-buffered software rasteriser for isometric sprites (buildings, mountains, props).
 * Pure: no DOM, unit-testable in node.
 *
 * Local space: u runs along the world x axis, v along the world y axis (both in tile units) and z is height in
 * art pixels. Projection (art px): sx = (u - v) * 16 + ox, sy = (u + v) * 8 - z + oy. The camera sits toward
 * +u +v +z, so the visible vertical faces are the "left" face (v = max, facing screen-left/down) and the "right"
 * face (u = max, facing screen-right/down).
 */
import { AHH, AHW } from '../render/iso';
import { PixelBuffer } from './pixel';
import type { Col } from './color';

export type V3 = readonly [number, number, number];

/** Shader: surface coordinates (s, t), light factor, output pixel. Return 0 to discard the pixel. */
/** true = write colour and glow, 'glow' = write only the emissive layer (depth tested, no depth write). */
export type Emit = boolean | 'glow';

export type Shader = (s: number, t: number, lit: number, x: number, y: number) => Col;

/** Art px of screen height produced by one tile of physical height (true 2:1 dimetric). */
export const Z_PER_TILE = 19.6;

// Light from the upper-left, a little toward the viewer.
const LX = -0.35;
const LY = 0.55;
const LZ = 0.75;
const LLEN = Math.hypot(LX, LY, LZ);

/** Light factor for a unit-ish normal given in (u, v, physical z). Roughly 0.62 (shadow) .. 1.12 (sun-facing). */
export function lightOf(nu: number, nv: number, nz: number): number {
  const l = Math.hypot(nu, nv, nz) || 1;
  const d = (nu * LX + nv * LY + nz * LZ) / (l * LLEN);
  return 0.64 + 0.5 * Math.max(0, d);
}

export const LIT_TOP = lightOf(0, 0, 1);
export const LIT_LEFT = lightOf(0, 1, 0);
export const LIT_RIGHT = lightOf(1, 0, 0);

export class Scene3D {
  readonly pb: PixelBuffer;
  /** Emissive layer (windows, lanterns, forge fire): drawn additively at night. */
  readonly glow: PixelBuffer;
  readonly zb: Float32Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly ox: number,
    readonly oy: number,
  ) {
    this.pb = new PixelBuffer(w, h);
    this.glow = new PixelBuffer(w, h);
    this.zb = new Float32Array(this.pb.w * this.pb.h).fill(-1e9);
  }

  sx(u: number, v: number): number {
    return (u - v) * AHW + this.ox;
  }

  sy(u: number, v: number, z: number): number {
    return (u + v) * AHH - z + this.oy;
  }

  /** Depth key: larger = closer to the camera. */
  static depth(u: number, v: number, z: number): number {
    return (u + v) * AHH + z;
  }

  /**
   * Rasterise one triangle. `a`,`b`,`c` are (u,v,z); (sa,ta)... the surface coordinates at each vertex.
   * `bias` lifts the depth so decals (windows, signs) win against the surface they sit on.
   */
  tri(a: V3, b: V3, c: V3, sa: number, ta: number, sb: number, tb: number, sc: number, tc: number, lit: number, shader: Shader, emissive: Emit = false, bias = 0): void {
    const x0 = this.sx(a[0], a[1]);
    const y0 = this.sy(a[0], a[1], a[2]);
    const x1 = this.sx(b[0], b[1]);
    const y1 = this.sy(b[0], b[1], b[2]);
    const x2 = this.sx(c[0], c[1]);
    const y2 = this.sy(c[0], c[1], c[2]);
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) return;
    const inv = 1 / area;
    const d0 = Scene3D.depth(a[0], a[1], a[2]) + bias;
    const d1 = Scene3D.depth(b[0], b[1], b[2]) + bias;
    const d2 = Scene3D.depth(c[0], c[1], c[2]) + bias;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(this.pb.w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(this.pb.h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const W = this.pb.w;
    const eps = -1e-4;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        // barycentric weights
        const l1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) * inv;
        const l2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) * inv;
        const l0 = 1 - l1 - l2;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const d = d0 * l0 + d1 * l1 + d2 * l2;
        const i = y * W + x;
        if (d < this.zb[i] - (emissive === 'glow' ? 0.5 : 0)) continue;
        const col = shader(sa * l0 + sb * l1 + sc * l2, ta * l0 + tb * l1 + tc * l2, lit, x, y);
        if (col === 0) continue;
        if (emissive === 'glow') {
          this.glow.px[i] = col;
          continue;
        }
        this.zb[i] = d;
        this.pb.px[i] = col;
        this.glow.px[i] = emissive ? col : 0;
      }
    }
  }

  /** Planar quad p0 p1 p2 p3 (counter-clockwise on the surface); surface coords (0,0) (sMax,0) (sMax,tMax) (0,tMax). */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, sMax: number, tMax: number, lit: number, shader: Shader, emissive: Emit = false, bias = 0): void {
    this.tri(p0, p1, p2, 0, 0, sMax, 0, sMax, tMax, lit, shader, emissive, bias);
    this.tri(p0, p2, p3, 0, 0, sMax, tMax, 0, tMax, lit, shader, emissive, bias);
  }

  /** Horizontal rectangle at height z. Surface coords are (u - u0, v - v0) in tile units. */
  top(u0: number, v0: number, u1: number, v1: number, z: number, lit: number, shader: Shader, emissive: Emit = false, bias = 0): void {
    this.quad([u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z], u1 - u0, v1 - v0, lit, shader, emissive, bias);
  }

  /** Vertical face on the plane v = v1 (screen-left face). s = px along u (16 per tile), t = px above z0. */
  left(u0: number, u1: number, v1: number, z0: number, z1: number, lit: number, shader: Shader, emissive: Emit = false, bias = 0): void {
    this.quad([u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1], (u1 - u0) * AHW, z1 - z0, lit, shader, emissive, bias);
  }

  /** Vertical face on the plane u = u1 (screen-right face). s = px along v (16 per tile), t = px above z0. */
  right(v0: number, v1: number, u1: number, z0: number, z1: number, lit: number, shader: Shader, emissive: Emit = false, bias = 0): void {
    this.quad([u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1], (v1 - v0) * AHW, z1 - z0, lit, shader, emissive, bias);
  }

  /** Axis-aligned box: top + the two visible side faces. */
  box(u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, topS: Shader, leftS: Shader, rightS: Shader, emissive: Emit = false): void {
    this.left(u0, u1, v1, z0, z1, LIT_LEFT, leftS, emissive);
    this.right(v0, v1, u1, z0, z1, LIT_RIGHT, rightS, emissive);
    this.top(u0, v0, u1, v1, z1, LIT_TOP, topS, emissive);
  }

  /**
   * Heightfield patch over [u0,u1] x [v0,v1]. `h(u, v)` is the height in px; each cell is split in two triangles
   * and lit from its true normal. Surface coords passed to the shader are (u, v) in tile units.
   */
  heightfield(u0: number, v0: number, u1: number, v1: number, nu: number, nv: number, h: (u: number, v: number) => number, shader: Shader, emissive: Emit = false, bias = 0, litFn?: (nu: number, nv: number, nz: number, u: number, v: number) => number): void {
    const du = (u1 - u0) / nu;
    const dv = (v1 - v0) / nv;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const ua = u0 + i * du;
        const va = v0 + j * dv;
        const ub = ua + du;
        const vb = va + dv;
        const ha = h(ua, va);
        const hb = h(ub, va);
        const hc = h(ub, vb);
        const hd = h(ua, vb);
        this.triLit([ua, va, ha], [ub, va, hb], [ub, vb, hc], shader, emissive, bias, litFn);
        this.triLit([ua, va, ha], [ub, vb, hc], [ua, vb, hd], shader, emissive, bias, litFn);
      }
    }
  }

  /** Paint a single pixel at projected (u, v, z) with depth testing (props, lanterns, sparks). */
  plot(u: number, v: number, z: number, col: Col, emissive: Emit = false): void {
    const x = Math.floor(this.sx(u, v));
    const y = Math.floor(this.sy(u, v, z));
    if (x < 0 || y < 0 || x >= this.pb.w || y >= this.pb.h) return;
    const i = y * this.pb.w + x;
    const d = Scene3D.depth(u, v, z);
    if (d < this.zb[i]) return;
    if (emissive === 'glow') {
      this.glow.px[i] = col;
      return;
    }
    this.zb[i] = d;
    this.pb.px[i] = col;
    this.glow.px[i] = emissive ? col : 0;
  }

  /** Flat ellipse billboard anchored at (u, v, z), pixel coloured by fn (props: lanterns, pots, haystacks). */
  blob(u: number, v: number, z: number, rx: number, ry: number, fn: (nx: number, ny: number, x: number, y: number) => Col, emissive: Emit = false): void {
    const cx = this.sx(u, v);
    const cy = this.sy(u, v, z);
    const d = Scene3D.depth(u, v, z);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const ny = (y + 0.5 - cy) / ry;
      if (ny * ny > 1) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        if (nx * nx + ny * ny > 1) continue;
        if (x < 0 || y < 0 || x >= this.pb.w || y >= this.pb.h) continue;
        const i = y * this.pb.w + x;
        if (d < this.zb[i]) continue;
        const col = fn(nx, ny, x, y);
        if (col === 0) continue;
        if (emissive === 'glow') {
          this.glow.px[i] = col;
          continue;
        }
        this.zb[i] = d;
        this.pb.px[i] = col;
        this.glow.px[i] = emissive ? col : 0;
      }
    }
  }

  /** Blit a small pixel buffer anchored at (u, v, z) (its (ax, ay) pixel lands on the point). */
  sprite(src: PixelBuffer, ax: number, ay: number, u: number, v: number, z: number, bias = 0): void {
    const bx = Math.round(this.sx(u, v)) - ax;
    const by = Math.round(this.sy(u, v, z)) - ay;
    const d = Scene3D.depth(u, v, z) + bias;
    for (let y = 0; y < src.h; y++) {
      const py = by + y;
      if (py < 0 || py >= this.pb.h) continue;
      for (let x = 0; x < src.w; x++) {
        const px = bx + x;
        if (px < 0 || px >= this.pb.w) continue;
        const c = src.px[y * src.w + x];
        if (c >>> 24 === 0) continue;
        const i = py * this.pb.w + px;
        if (d < this.zb[i]) continue;
        this.zb[i] = d;
        this.pb.px[i] = c;
        this.glow.px[i] = 0;
      }
    }
  }

  /** Triangle lit from its geometric normal; surface coords are the vertex (u, v). */
  triLit(a: V3, b: V3, c: V3, shader: Shader, emissive: Emit = false, bias = 0, litFn?: (nu: number, nv: number, nz: number, u: number, v: number) => number): void {
    const e1u = b[0] - a[0];
    const e1v = b[1] - a[1];
    const e1z = (b[2] - a[2]) / Z_PER_TILE;
    const e2u = c[0] - a[0];
    const e2v = c[1] - a[1];
    const e2z = (c[2] - a[2]) / Z_PER_TILE;
    let nu = e1v * e2z - e1z * e2v;
    let nv = e1z * e2u - e1u * e2z;
    let nz = e1u * e2v - e1v * e2u;
    // Face the camera (toward +u +v +z).
    if (nu + nv + nz * 0.816 < 0) {
      nu = -nu;
      nv = -nv;
      nz = -nz;
    }
    const cu = (a[0] + b[0] + c[0]) / 3;
    const cv = (a[1] + b[1] + c[1]) / 3;
    const lit = litFn ? litFn(nu, nv, nz, cu, cv) : lightOf(nu, nv, nz);
    this.tri(a, b, c, a[0], a[1], b[0], b[1], c[0], c[1], lit, shader, emissive, bias);
  }
}

/** Quantise a light factor into n visible steps (flat pixel-art shading). */
export function quant(lit: number, steps = 6): number {
  return Math.round(lit * steps) / steps;
}
