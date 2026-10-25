/**
 * Mountain tiles. Each Rock tile becomes one sprite: a lit heightfield patch (continuous with its neighbours because
 * vertex heights come from a global function) plus cliff skirts down to the ground where it borders open land.
 * Pure (node-testable).
 */
import { PixelBuffer } from './pixel';
import { Scene3D, type Shader } from './mesh';
import { hex, mix, rgba, scale, type Col } from './color';
import { ihash } from './noise';
import { ramp } from './palette';
import { hf } from './draw';

export interface RockSource {
  w: number;
  h: number;
  isRock(x: number, y: number): boolean;
  /** Chebyshev distance to the nearest non-rock tile (>= 1 for rock tiles). */
  dist(x: number, y: number): number;
  /** Climate band of a row: 0 north, 1 central, 2 south. */
  climate(y: number): number;
}

export interface MountainSprite {
  pb: PixelBuffer;
  /** Anchor at the diamond centre of the tile (art px inside the sprite). */
  ax: number;
  ay: number;
}

const ROCK = ramp('#74707c', 0.62, 1.3);
const ROCK_WARM = ramp('#7d6c5a', 0.64, 1.25);
const SNOW = hex('#f4f7fb');
const SNOW_L = hex('#ffffff');
const SNOW_D = hex('#c8d4e6');
const SNOW_DD = hex('#9fb0ca');
const MOSS = [hex('#4f6b3a'), hex('#5f7f44'), hex('#7a9a52')];
const AUTUMN_MOSS = [hex('#6f6a32'), hex('#8a7f3c'), hex('#a8903f')];

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0,1]. */
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = ihash(x0, y0, seed) / 4294967296;
  const b = ihash(x0 + 1, y0, seed) / 4294967296;
  const c = ihash(x0, y0 + 1, seed) / 4294967296;
  const d = ihash(x0 + 1, y0 + 1, seed) / 4294967296;
  return a + (b - a) * fx + (c + (d - c) * fx - a - (b - a) * fx) * fy;
}

/** Height (art px) at global vertex coordinates; used as the continuous height function. */
function vertexHeight(src: RockSource, i: number, j: number): number {
  const r00 = src.isRock(i - 1, j - 1);
  const r10 = src.isRock(i, j - 1);
  const r01 = src.isRock(i - 1, j);
  const r11 = src.isRock(i, j);
  if (!(r00 && r10 && r01 && r11)) {
    // Boundary vertex: the top edge of a cliff.
    return 7 + vnoise(i * 0.8, j * 0.8, 3) * 9;
  }
  const d = Math.min(src.dist(i - 1, j - 1), src.dist(i, j - 1), src.dist(i - 1, j), src.dist(i, j));
  const inner = Math.min(1, (d - 1) / 3);
  const base = 10 + (Math.min(d, 10) - 1) * 8.2;
  const ridge = 1 - Math.abs(2 * vnoise(i * 0.33, j * 0.33, 7) - 1);
  const broad = vnoise(i * 0.11, j * 0.11, 9) * 18;
  return base * 0.85 + ridge * ridge * 26 * inner + broad * Math.min(1, (d - 1) / 2) + vnoise(i * 0.9, j * 0.9, 5) * 5 * inner;
}

/** Surface height inside a tile: bilinear of corner heights plus craggy noise (global, so seams match). */
function surfaceHeight(c00: number, c10: number, c01: number, c11: number, u: number, v: number, gx: number, gy: number, crag: number): number {
  const a = c00 + (c10 - c00) * u;
  const b = c01 + (c11 - c01) * u;
  const h = a + (b - a) * v;
  const n = (vnoise(gx * 1.7, gy * 1.7, 21) - 0.5) * 7 + (vnoise(gx * 4.1, gy * 4.1, 22) - 0.5) * 1.6;
  return h + n * crag;
}

export function snowLine(climate: number, season: number): number {
  const base = climate === 0 ? 20 : climate === 1 ? 48 : 70;
  const s = season === 3 ? -22 : season === 1 ? 8 : season === 2 ? -4 : 0;
  return base + s;
}

export function genMountainTile(src: RockSource, x: number, y: number, season: number): MountainSprite {
  const c00 = vertexHeight(src, x, y);
  const c10 = vertexHeight(src, x + 1, y);
  const c01 = vertexHeight(src, x, y + 1);
  const c11 = vertexHeight(src, x + 1, y + 1);
  const maxH = Math.max(c00, c10, c01, c11) + 14;
  const oy = Math.ceil(maxH) + 2;
  const W = 34;
  const H = oy + 20;
  const sc = new Scene3D(W, H, 17, oy);
  const climate = src.climate(y);
  const sl = snowLine(climate, season);
  const crag = Math.min(1, (src.dist(x, y) - 1) / 1.5);
  const hAt = (u: number, v: number): number => surfaceHeight(c00, c10, c01, c11, u, v, x + u, y + v, crag);

  const topShader: Shader = (u, v, lit, px, py) => {
    const z = hAt(u, v);
    const gx = x + u;
    const gy = y + v;
    const n1 = vnoise(gx * 3.1, gy * 3.1, 31);
    const n2 = hf(px, py, 41);
    // strata bands by altitude
    const band = Math.floor((z + n1 * 5) / 5);
    const warm = (band & 1) === 0;
    const rampR = z < 9 ? ROCK_WARM : ROCK;
    let l = lit + (n2 - 0.5) * 0.16 + (warm ? 0.03 : -0.02);
    let c: Col = l < 0.7 ? rampR.dd : l < 0.82 ? rampR.d : l < 0.96 ? rampR.b : rampR.l;
    // vegetation near the foot of the mountain
    if (z < 16 && lit > 0.9 && vnoise(gx * 2.2, gy * 2.2, 51) > 0.5 && n2 < 0.8) {
      const m = season === 2 ? AUTUMN_MOSS : MOSS;
      c = season === 3 ? c : l < 0.9 ? m[0] : l < 1.02 ? m[1] : m[2];
    }
    // snow
    const sn = z + (n1 - 0.5) * 16 + (lit - 0.85) * 22;
    if (sn > sl) {
      const k = sn - sl;
      c = lit > 1.0 ? (n2 > 0.9 ? SNOW_L : SNOW) : lit > 0.86 ? SNOW : lit > 0.74 ? SNOW_D : SNOW_DD;
      if (k < 3 && n2 < 0.4) c = lit > 0.9 ? SNOW_D : SNOW_DD;
    }
    return c;
  };

  // Top surface in 4x4 cells.
  sc.heightfield(0, 0, 1, 1, 4, 4, hAt, topShader);

  const skirtShader = (side: 0 | 1): Shader => (s, t, lit, px, py) => {
    // s: px along the edge, t: px above ground
    const n1 = vnoise(s * 0.18 + x * 3 + side * 11, t * 0.22 + y * 5, 61);
    const n2 = hf(px, py, 43);
    const band = Math.floor((t + n1 * 6) / 4);
    let l = lit * (side === 0 ? 1 : 0.86) + (n2 - 0.5) * 0.12 + (n1 - 0.5) * 0.1 + ((band & 1) === 0 ? 0.03 : -0.03);
    const rampR = t < 6 ? ROCK_WARM : ROCK;
    // dark crevices
    if (n1 > 0.72 && n2 < 0.5) l -= 0.1;
    let c: Col = l < 0.62 ? rampR.dd : l < 0.78 ? rampR.d : l < 0.95 ? rampR.b : rampR.l;
    const sn = t + (n1 - 0.5) * 14;
    if (sn > sl + 4 && (n2 > 0.35 || t > sl + 10)) c = lit > 0.85 ? SNOW : SNOW_D;
    return c;
  };

  // Cliff skirts toward open ground (only the camera-facing edges).
  const stripes = 4;
  if (!src.isRock(x + 1, y)) {
    // right face: plane u = 1, v from 0 to 1
    const sh = skirtShader(1);
    for (let i = 0; i < stripes; i++) {
      const v0 = i / stripes;
      const v1 = (i + 1) / stripes;
      const h0 = hAt(1, v0);
      const h1 = hAt(1, v1);
      sc.tri([1, v0, 0], [1, v1, 0], [1, v1, h1], v0 * 16, 0, v1 * 16, 0, v1 * 16, h1, 0.78, sh);
      sc.tri([1, v0, 0], [1, v1, h1], [1, v0, h0], v0 * 16, 0, v1 * 16, h1, v0 * 16, h0, 0.78, sh);
    }
  }
  if (!src.isRock(x, y + 1)) {
    // left face: plane v = 1, u from 0 to 1
    const sh = skirtShader(0);
    for (let i = 0; i < stripes; i++) {
      const u0 = i / stripes;
      const u1 = (i + 1) / stripes;
      const h0 = hAt(u0, 1);
      const h1 = hAt(u1, 1);
      sc.tri([u0, 1, 0], [u1, 1, 0], [u1, 1, h1], u0 * 16, 0, u1 * 16, 0, u1 * 16, h1, 0.92, sh);
      sc.tri([u0, 1, 0], [u1, 1, h1], [u0, 1, h0], u0 * 16, 0, u1 * 16, h1, u0 * 16, h0, 0.92, sh);
    }
  }
  const pb = sc.pb;
  void mix;
  void rgba;
  void scale;
  return { pb, ax: 17, ay: oy + 8 };
}
