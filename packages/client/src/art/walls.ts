/** Fort wall tiles (connected by neighbour mask, crenellated) and bridge railings. Pure. */
import { hex, mix, scale } from './color';
import { hf } from './draw';
import { PixelBuffer } from './pixel';
import { Scene3D, LIT_LEFT, LIT_RIGHT, type Shader } from './mesh';
import { SNOW, SNOW_D, SNOW_DD, lc, wallShader, stoneTop, type Style, LACQUER } from './arch';

export const W_NE = 1;
export const W_SE = 2;
export const W_SW = 4;
export const W_NW = 8;

export interface TileSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
}

/** Fort wall: about 2.7 persons tall (see scale.ts), merlons included. */
const WALL_H = 66;
const MERLON_H = 8;

function wallStyle(season: number, fallen: boolean, seed: number): Style {
  return { roof: hex('#4e5a68'), accent: LACQUER, wall: hex('#d6cdb8'), timber: hex('#5a3a26'), stone: hex('#8d8a84'), season, fallen, seed, soot: hex('#2a2226') };
}

/** One wall tile. `mask` uses the W_* bits for the connected neighbours. */
export function genWallTile(mask: number, season: number, fallen: boolean, variant = 0): TileSprite {
  const st = wallStyle(season, fallen, 31 + variant * 7);
  const oy = WALL_H + 14;
  const sc = new Scene3D(34, oy + 22, 17, oy);
  const T = 0.2;
  const U = 0.8;
  const boxes: [number, number, number, number][] = [[T, T, U, U]];
  if (mask & W_NE) boxes.push([T, 0, U, 0.5]);
  if (mask & W_SE) boxes.push([0.5, T, 1, U]);
  if (mask & W_SW) boxes.push([T, 0.5, U, 1]);
  if (mask & W_NW) boxes.push([0, T, 0.5, U]);
  if (mask === 0) boxes.push([0.1, 0.1, 0.9, 0.9]);
  const ruin = fallen ? 24 : 0;
  const side = (off: number): Shader => {
    const base = wallShader(st, { kind: 'stone', base: st.stone, H: WALL_H, eave: 0, off });
    return (s, t, lit, x, y) => {
      if (ruin && t > WALL_H - ruin * (0.3 + 0.7 * hf((s + off) | 0, 2, st.seed))) return 0;
      let c = base(s, t, lit, x, y);
      if (season !== 3 && t < 10 && hf(x >> 1, y >> 1, 5) < 0.25 && season !== 2) c = mix(c, hex('#4d6a3c'), 0.5); // moss at the foot
      if (season === 1 && t > WALL_H - 3 && hf(x, y, 9) < 0.3) c = scale(c, 1.1);
      return c;
    };
  };
  const top: Shader = (u, v, lit, x, y) => {
    let c = stoneTop(st, scale(st.stone, 1.08))(u, v, lit, x, y);
    if (season === 3 && hf(x, y, 11) < 0.82) c = lit > 0.95 ? SNOW : SNOW_D;
    return c;
  };
  for (const [u0, v0, u1, v1] of boxes) {
    sc.box(u0, v0, 0, u1, v1, WALL_H, top, side(Math.floor(u0 * 10)), side(Math.floor(v0 * 10) + 5));
  }
  // merlons along the visible outer edges
  const merlon = (off: number): Shader => {
    const b = wallShader(st, { kind: 'stone', base: scale(st.stone, 1.06), H: MERLON_H, eave: 0, off });
    return (s, t, lit, x, y) => {
      if (fallen && hf(x >> 2, 1, st.seed) < 0.4) return 0;
      const c = b(s, t, lit, x, y);
      return c;
    };
  };
  const mtop: Shader = (u, v, lit, x, y) => (season === 3 ? (lit > 0.95 ? SNOW : SNOW_D) : stoneTop(st, scale(st.stone, 1.1))(u, v, lit, x, y));
  for (const [u0, v0, u1, v1] of boxes) {
    const alongU = u1 - u0 >= v1 - v0;
    if (alongU) {
      // edge facing +v
      const n = Math.max(1, Math.round((u1 - u0) / 0.25));
      for (let i = 0; i < n; i += 2) {
        const a = u0 + ((u1 - u0) * i) / n;
        const b = u0 + ((u1 - u0) * (i + 1)) / n;
        sc.box(a, v1 - 0.1, WALL_H, b, v1, WALL_H + MERLON_H, mtop, merlon(i), merlon(i + 3));
      }
    } else {
      const n = Math.max(1, Math.round((v1 - v0) / 0.25));
      for (let i = 0; i < n; i += 2) {
        const a = v0 + ((v1 - v0) * i) / n;
        const b = v0 + ((v1 - v0) * (i + 1)) / n;
        sc.box(u1 - 0.1, a, WALL_H, u1, b, WALL_H + MERLON_H, mtop, merlon(i), merlon(i + 3));
      }
    }
  }
  // inner low parapet on the back edges shows as a thin lip of stone
  const pb = sc.pb;
  pb.outline(undefined, 0.3);
  void LIT_LEFT;
  void LIT_RIGHT;
  void lc;
  void SNOW_DD;
  return { pb, ax: 17, ay: oy + 8 };
}

/** Wooden bridge railings for a bridge tile; axis 0 = runs along x, 1 = along y. */
export function genBridgeRails(axis: 0 | 1, season: number): TileSprite {
  const st = wallStyle(season, false, 77);
  const oy = 20;
  const sc = new Scene3D(34, oy + 22, 17, oy);
  const wood = hex('#6a4a32');
  const woodD = hex('#4a3322');
  const sh = (k: number): Shader => (s, t, lit, x, y) => lc(hf(x, y, 3) < 0.1 ? scale(wood, 0.8 * k) : scale(wood, k), lit);
  const railTop: Shader = (u, v, lit) => lc(season === 3 ? SNOW : wood, lit);
  const edges = axis === 0 ? [0.08, 0.92] : [0.08, 0.92];
  for (const e of edges) {
    for (let i = 0; i <= 4; i++) {
      const p = i / 4;
      const u = axis === 0 ? p : e;
      const v = axis === 0 ? e : p;
      sc.box(u - 0.04, v - 0.04, 0, u + 0.04, v + 0.04, 9, railTop, sh(1), sh(0.85));
    }
    if (axis === 0) sc.box(0, e - 0.025, 6, 1, e + 0.025, 8, railTop, sh(1), sh(0.85));
    else sc.box(e - 0.025, 0, 6, e + 0.025, 1, 8, railTop, sh(1), sh(0.85));
  }
  sc.pb.outline(undefined, 0.3);
  void woodD;
  void st;
  return { pb: sc.pb, ax: 17, ay: oy + 8 };
}
