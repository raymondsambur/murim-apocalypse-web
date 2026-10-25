/**
 * Architecture kit for building sprites: wall/roof materials and reusable parts (plinth, walls, hip/gable roofs,
 * doors, windows, pillars, lanterns, stairs, crenellations). Everything draws into a Scene3D. Pure.
 */
import { AHW } from '../render/iso';
import { hex, mix, rgba, scale, shade, type Col } from './color';
import { hf, bayer } from './draw';
import { LIT_LEFT, LIT_RIGHT, LIT_TOP, Scene3D, type Emit, type Shader } from './mesh';
import { vnoise } from './mountain';

/** Visual context shared by all parts of one building. */
export interface Style {
  roof: Col;
  accent: Col;
  wall: Col;
  timber: Col;
  stone: Col;
  season: number;
  fallen: boolean;
  seed: number;
  /** Burn / soot tint for fallen buildings. */
  soot: Col;
}

export const SNOW = hex('#f3f6fb');
export const SNOW_D = hex('#c9d6e8');
export const SNOW_DD = hex('#9db0cb');
export const LACQUER = hex('#a8302a');
export const LACQUER_D = hex('#6e1f1f');
export const GOLD = hex('#d9b867');
export const PAPER = hex('#f0dfae');
export const GLOW_WARM = hex('#ffcf73');
export const GLOW_GREEN = hex('#9dffb0');
export const GLOW_FIRE = hex('#ff8a3a');
const PANE = hex('#2c3a4b');
const PANE_L = hex('#4b6179');

/** Lit colour: applies the face light with the hue-shifted ramp. */
export const lc = (c: Col, lit: number): Col => shade(c, lit);

function charred(st: Style, c: Col, amount: number): Col {
  return st.fallen ? mix(c, st.soot, amount) : c;
}

// ---------------------------------------------------------------------------
// Wall materials
// ---------------------------------------------------------------------------

export type WallKind = 'plaster' | 'plank' | 'stone' | 'brick' | 'dark';

export interface WallSpec {
  kind: WallKind;
  base: Col;
  /** Wall height in px (needed for beams / eave shadow). */
  H: number;
  /** Spacing of timber posts in px (0 = none). */
  post?: number;
  /** Timber colour override. */
  timber?: Col;
  /** Lift the "ragged top" of fallen walls (px, 0 = intact). */
  ruin?: number;
  /** Eave shadow height under the roof (px). */
  eave?: number;
  /** World-anchored seed offset so faces differ. */
  off?: number;
}

export function wallShader(st: Style, w: WallSpec): Shader {
  const timber = w.timber ?? st.timber;
  const post = w.post ?? 0;
  const eave = w.eave ?? 5;
  const off = w.off ?? 0;
  return (s, t, lit, x, y) => {
    if (w.ruin && w.ruin > 0) {
      const jag = w.H - w.ruin * (0.35 + 0.65 * vnoise((s + off) * 0.22, 3.1, st.seed)) - (hf((s + off) | 0, 7, st.seed) < 0.2 ? 3 : 0);
      if (t > jag) return 0;
    }
    let c: Col;
    const n = hf(x, y, st.seed + 11);
    switch (w.kind) {
      case 'stone': {
        const row = Math.floor(t / 5);
        const sx = s + (row & 1) * 5 + off;
        const bx = Math.floor(sx / 10);
        const fx = sx - bx * 10;
        const fy = t - row * 5;
        const id = hf(bx, row, st.seed);
        c = id < 0.3 ? scale(w.base, 0.86) : id > 0.75 ? scale(w.base, 1.1) : w.base;
        if (fx < 1 || fy < 1) c = scale(w.base, 0.62);
        if (n < 0.05) c = scale(c, 0.85);
        break;
      }
      case 'brick': {
        const row = Math.floor(t / 4);
        const sx = s + (row & 1) * 3 + off;
        const bx = Math.floor(sx / 6);
        const fx = sx - bx * 6;
        const fy = t - row * 4;
        const id = hf(bx, row, st.seed + 5);
        c = id < 0.3 ? scale(w.base, 0.9) : id > 0.7 ? scale(w.base, 1.08) : w.base;
        if (fx < 1 || fy < 1) c = scale(w.base, 0.7);
        break;
      }
      case 'plank': {
        const col = Math.floor((s + off) / 3);
        const id = hf(col, 1, st.seed);
        c = id < 0.3 ? scale(w.base, 0.9) : id > 0.72 ? scale(w.base, 1.1) : w.base;
        if ((s + off) % 3 < 1) c = scale(w.base, 0.7);
        if (n < 0.04) c = scale(c, 0.8);
        break;
      }
      case 'dark': {
        c = n < 0.3 ? scale(w.base, 0.9) : w.base;
        if (((s + off) | 0) % 5 === 0) c = scale(w.base, 0.75);
        break;
      }
      default: {
        // plaster panels
        c = w.base;
        const streak = vnoise((s + off) * 0.15, t * 0.05, st.seed);
        if (streak < 0.35) c = scale(c, 0.94);
        else if (streak > 0.7) c = scale(c, 1.04);
        if (n < 0.06) c = scale(c, 0.9);
        if (t < 8) c = mix(c, hex('#6b5a44'), (1 - t / 8) * 0.28); // splash grime
      }
    }
    // timber frame
    if (w.kind === 'plaster' || w.kind === 'plank') {
      const px = post > 0 ? ((s + off) % post + post) % post : 99;
      if (post > 0 && px < 2) c = px < 1 ? lc(timber, 1.05) : timber;
      if (t > w.H - 4 && t <= w.H - 1) c = t > w.H - 2 ? lc(timber, 0.8) : timber;
      if (t < 3) c = scale(st.stone, 0.9);
      if (w.kind === 'plaster' && post > 0 && t > w.H * 0.5 && t < w.H * 0.5 + 2) c = timber;
    }
    // soft shadow under the eaves
    if (t > w.H - eave) c = scale(c, 0.78);
    return charred(st, lc(c, lit), 0.55);
  };
}

/** Stone block top (plinth, platform). */
export function stoneTop(st: Style, base: Col): Shader {
  return (u, v, lit, x, y) => {
    const n = hf(x, y, st.seed + 2);
    let c = base;
    const fu = (u * 3) % 1;
    const fv = (v * 3) % 1;
    if (fu < 0.1 || fv < 0.1) c = scale(base, 0.8);
    else if (n < 0.1) c = scale(base, 0.92);
    else if (n > 0.93) c = scale(base, 1.08);
    return charred(st, lc(c, lit), 0.5);
  };
}

export function flatShader(c: Col, st?: Style, noise = 0.08): Shader {
  return (_u, _v, lit, x, y) => {
    let col = c;
    if (noise > 0) {
      const n = hf(x, y, 17);
      if (n < noise) col = scale(c, 0.88);
      else if (n > 1 - noise) col = scale(c, 1.1);
    }
    return st ? charred(st, lc(col, lit), 0.5) : lc(col, lit);
  };
}

/** Wooden floor planks (top surface). */
export function floorShader(st: Style, base: Col): Shader {
  return (u, v, lit, x, y) => {
    const row = Math.floor(v * 8);
    let c = base;
    const id = hf(row, Math.floor(u * 2), st.seed + 4);
    if (id < 0.3) c = scale(base, 0.9);
    else if (id > 0.75) c = scale(base, 1.08);
    if ((v * 8) % 1 < 0.15) c = scale(base, 0.72);
    if (hf(x, y, 3) < 0.04) c = scale(c, 0.88);
    return charred(st, lc(c, lit), 0.5);
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Stone plinth box. */
export function plinth(sc: Scene3D, st: Style, u0: number, v0: number, u1: number, v1: number, z1: number, base: Col = st.stone): void {
  const side = (off: number): Shader =>
    wallShader(st, { kind: 'stone', base, H: z1, eave: 0, off });
  sc.box(u0, v0, 0, u1, v1, z1, stoneTop(st, base), side(0), side(7));
}

/** The two visible vertical wall faces of a box (no top: a roof goes on). */
export function walls(sc: Scene3D, st: Style, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, spec: Omit<WallSpec, 'H'>): void {
  const H = z1 - z0;
  sc.left(u0, u1, v1, z0, z1, LIT_LEFT, wallShader(st, { ...spec, H, off: spec.off ?? 0 }));
  sc.right(v0, v1, u1, z0, z1, LIT_RIGHT, wallShader(st, { ...spec, H, off: (spec.off ?? 0) + 5 }));
}

export interface RoofOpts {
  zEave: number;
  rise: number;
  /** Overhang beyond the wall rectangle (tiles). */
  over: number;
  /** Upturn of the corners in px. */
  up?: number;
  /** Profile exponent; > 1 gives the classic concave sweep. */
  curve?: number;
  color: Col;
  /** gable: ridge runs along u (true) or v (false); undefined = hip. */
  gable?: 'u' | 'v';
  thatch?: boolean;
  /** Lighter tiles on the ridge line. */
  ridge?: Col;
  /** Pattern density: tile rows per tile unit. */
  rows?: number;
  /** Holes in a fallen roof. */
  holes?: number;
}

export function roofHeight(o: RoofOpts, L: number, R: number, T: number, B: number): (u: number, v: number) => number {
  const emaxHip = Math.min(R - L, B - T) / 2;
  const curve = o.curve ?? 1.25;
  const up = o.up ?? 0;
  return (u, v) => {
    const cu = Math.min(u - L, R - u);
    const cv = Math.min(v - T, B - v);
    let t: number;
    if (o.gable === 'u') t = Math.min(1, Math.min(cv, cv) / ((B - T) / 2));
    else if (o.gable === 'v') t = Math.min(1, cu / ((R - L) / 2));
    else t = Math.min(1, Math.min(cu, cv) / emaxHip);
    if (t < 0) t = 0;
    const corner = Math.max(0, 1 - (Math.max(0, cu) + Math.max(0, cv)) / 1.1);
    return o.zEave + o.rise * Math.pow(t, curve) + up * corner * corner;
  };
}

/** Hip or gable roof over the wall rectangle, with overhang, tile pattern, snow and ridge cap. Returns the rect. */
export function roof(sc: Scene3D, st: Style, u0: number, v0: number, u1: number, v1: number, o: RoofOpts): { L: number; R: number; T: number; B: number; h: (u: number, v: number) => number } {
  const L = u0 - o.over;
  const R = u1 + o.over;
  const T = v0 - o.over;
  const B = v1 + o.over;
  const h = roofHeight(o, L, R, T, B);
  const emax = o.gable === 'u' ? (B - T) / 2 : o.gable === 'v' ? (R - L) / 2 : Math.min(R - L, B - T) / 2;
  const rows = o.rows ?? 7;
  const holes = o.holes ?? 0;
  const base = charred(st, o.color, 0.3);
  const shader: Shader = (u, v, lit, x, y) => {
    const cu = Math.min(u - L, R - u);
    const cv = Math.min(v - T, B - v);
    let e: number;
    let along: number;
    if (o.gable === 'u') {
      e = cv;
      along = u;
    } else if (o.gable === 'v') {
      e = cu;
      along = v;
    } else if (cv < cu) {
      e = cv;
      along = u;
    } else {
      e = cu;
      along = v;
    }
    if (e < 0) return 0;
    if (holes > 0 && vnoise(u * 3.1, v * 3.1, st.seed + 9) > 1 - holes && e > 0.15) return 0;
    const row = Math.floor(e * rows);
    const fr = e * rows - row;
    const col = Math.floor(along * rows * 0.85 + (row & 1) * 0.5);
    const id = hf(col, row, st.seed + 3);
    let c: Col;
    if (o.thatch) {
      const n = hf(x, y, st.seed);
      c = n < 0.3 ? scale(o.color, 0.86) : n > 0.78 ? scale(o.color, 1.14) : o.color;
      if (fr < 0.2) c = scale(c, 0.78);
      // ragged eave
      if (e < 0.12 && hf(x, y, 5) < 0.4) return 0;
      c = charred(st, lc(c, lit), 0.5);
    } else {
      c = id < 0.25 ? scale(base, 0.88) : id > 0.75 ? scale(base, 1.1) : base;
      if (fr < 0.2) c = scale(base, 0.62); // row shadow
      else if (fr > 0.8) c = scale(c, 1.12);
      const fc = along * rows * 0.85 + (row & 1) * 0.5;
      if (fc - Math.floor(fc) < 0.13) c = scale(c, 0.78); // tile rib
      if (o.ridge && e > emax - 0.1) c = fr > 0.5 ? lc(o.ridge, 1.1) : o.ridge;
      c = lc(c, lit);
    }
    if (st.season === 3 && e > 0.1 && hf(col, row, 9) < 0.86) {
      const k = lit > 0.95 ? SNOW : lit > 0.8 ? SNOW_D : SNOW_DD;
      c = fr < 0.12 && lit < 1 ? SNOW_DD : k;
    } else if (st.season === 2 && hf(x, y, 21) < 0.03) c = hex('#d9772b');
    if (st.fallen) c = mix(c, st.soot, 0.35 + 0.25 * hf(x >> 1, y >> 1, 2));
    return c;
  };
  const nu = Math.max(4, Math.ceil((R - L) * 6));
  const nv = Math.max(4, Math.ceil((B - T) * 6));
  sc.heightfield(L, T, R, B, nu, nv, h, shader);
  // eave fascia on the two visible edges
  const fas: Shader = (_s, t, lit) => lc(st.fallen ? mix(LACQUER_D, st.soot, 0.6) : t > 2 ? scale(o.color, 0.55) : LACQUER_D, lit);
  const seg = Math.max(4, Math.ceil((R - L) * 4));
  for (let i = 0; i < seg; i++) {
    const a = L + ((R - L) * i) / seg;
    const b = L + ((R - L) * (i + 1)) / seg;
    const ha = h(a, B);
    const hb = h(b, B);
    sc.quad([a, B, ha - 3.5], [b, B, hb - 3.5], [b, B, hb], [a, B, ha], (b - a) * AHW, 3.5, LIT_LEFT * 0.9, fas);
  }
  const segv = Math.max(4, Math.ceil((B - T) * 4));
  for (let i = 0; i < segv; i++) {
    const a = T + ((B - T) * i) / segv;
    const b = T + ((B - T) * (i + 1)) / segv;
    const ha = h(R, a);
    const hb = h(R, b);
    sc.quad([R, a, ha - 3.5], [R, b, hb - 3.5], [R, b, hb], [R, a, ha], (b - a) * AHW, 3.5, LIT_RIGHT * 0.9, fas);
  }
  return { L, R, T, B, h };
}

// ---------------------------------------------------------------------------
// Decals: doors, windows
// ---------------------------------------------------------------------------

export type FaceId = 'left' | 'right';

/** Place a decal quad on a face. For 'left' the face plane is v = at and `pos` runs along u; for 'right' u = at, along v. */
function decalQuad(sc: Scene3D, face: FaceId, at: number, a0: number, a1: number, z0: number, z1: number, shader: Shader, emissive: Emit = false): void {
  if (face === 'left') sc.left(a0, a1, at, z0, z1, LIT_LEFT, shader, emissive, 1.5);
  else sc.right(a0, a1, at, z0, z1, LIT_RIGHT, shader, emissive, 1.5);
}

export function door(sc: Scene3D, st: Style, face: FaceId, at: number, center: number, widthT: number, z0: number, h: number, color: Col = st.timber, glowColor?: Col): void {
  const a0 = center - widthT / 2;
  const a1 = center + widthT / 2;
  const wpx = widthT * AHW;
  const sh: Shader = (s, t, lit, x, y) => {
    if (s < 1.2 || s > wpx - 1.2 || t > h - 1.5) return charred(st, lc(LACQUER_D, lit), 0.5); // frame
    if (st.fallen && hf(x, y, 6) < 0.35) return lc(hex('#1a1316'), lit);
    let c = color;
    if (Math.abs(s - wpx / 2) < 0.6) c = scale(color, 0.6); // central gap
    else if (((s | 0) + ((t / 4) | 0)) % 4 === 0) c = scale(color, 0.85);
    if (t > h * 0.4 && t < h * 0.4 + 1.2) c = scale(color, 0.7);
    if (Math.abs(s - wpx * 0.4) < 0.8 && Math.abs(t - h * 0.45) < 1.2) c = GOLD; // knocker
    return charred(st, lc(c, lit), 0.5);
  };
  decalQuad(sc, face, at, a0, a1, z0, z0 + h, sh);
  // lintel
  const lin: Shader = (_s, _t, lit) => charred(st, lc(LACQUER, lit), 0.5);
  decalQuad(sc, face, at, a0 - 0.08, a1 + 0.08, z0 + h, z0 + h + 3, lin);
  void glowColor;
}

export function windowDecal(sc: Scene3D, st: Style, face: FaceId, at: number, center: number, widthT: number, z0: number, h: number, glow: Col = GLOW_WARM, round = false): void {
  const a0 = center - widthT / 2;
  const a1 = center + widthT / 2;
  const wpx = widthT * AHW;
  const frame = st.timber;
  const sh: Shader = (s, t, lit) => {
    if (s < 1 || s > wpx - 1 || t < 1 || t > h - 1) return charred(st, lc(frame, lit), 0.5);
    if (round) {
      const dx = (s - wpx / 2) / (wpx / 2);
      const dy = (t - h / 2) / (h / 2);
      if (dx * dx + dy * dy > 1) return charred(st, lc(frame, lit), 0.5);
    }
    // lattice
    if (Math.abs(s - wpx / 2) < 0.6 || Math.abs(t - h / 2) < 0.6) return charred(st, lc(frame, lit), 0.5);
    if (st.fallen) return lc(hex('#171116'), lit);
    return lc(t > h * 0.55 && s < wpx * 0.5 ? PANE_L : PANE, lit);
  };
  decalQuad(sc, face, at, a0, a1, z0, z0 + h, sh);
  if (!st.fallen) {
    const gl: Shader = (s, t) => {
      if (s < 1.4 || s > wpx - 1.4 || t < 1.4 || t > h - 1.4) return 0;
      if (Math.abs(s - wpx / 2) < 0.6 || Math.abs(t - h / 2) < 0.6) return 0;
      return glow;
    };
    decalQuad(sc, face, at, a0, a1, z0, z0 + h, gl, 'glow');
  }
}

// ---------------------------------------------------------------------------
// Props: pillars, lanterns, stairs, crenellations, rails
// ---------------------------------------------------------------------------

/** Thin square pillar. */
export function pillar(sc: Scene3D, st: Style, u: number, v: number, z0: number, z1: number, color: Col = LACQUER, r = 0.075): void {
  const mk = (k: number): Shader => (s, t, lit, x, y) => {
    let c = color;
    if (hf(x, y, 5) < 0.06) c = scale(c, 0.85);
    if (t < 2) c = scale(st.stone, 0.9);
    return charred(st, lc(scale(c, k), lit), 0.5);
  };
  sc.box(u - r, v - r, z0, u + r, v + r, z1, flatShader(scale(color, 1.1), st, 0), mk(1), mk(0.9));
}

/** Hanging paper lantern: glowing red ellipse with caps. */
export function lantern(sc: Scene3D, u: number, v: number, z: number, color: Col = LACQUER, glow: Col = GLOW_WARM, size = 3): void {
  const body = (nx: number, ny: number): Col => {
    const c = nx < -0.2 ? mix(color, glow, 0.35) : nx > 0.4 ? scale(color, 0.78) : color;
    return ny > 0.7 || ny < -0.7 ? hex('#2c1c14') : c;
  };
  sc.blob(u, v, z - size, size * 0.8, size, (nx, ny) => body(nx, ny));
  sc.blob(u, v, z - size, size * 0.8 + 0.6, size + 0.6, (nx, ny) => (ny > 0.55 || ny < -0.55 ? 0 : 0), false);
  sc.blob(u, v, z - size, size * 0.55, size * 0.75, (nx, ny) => (Math.abs(ny) < 0.8 ? glow : 0), 'glow');
  sc.plot(u, v, z + 1, hex('#2c1c14'));
}

/** Staircase going down toward +v (left face) or +u (right face). */
export function stairs(sc: Scene3D, st: Style, face: FaceId, at: number, center: number, widthT: number, height: number, steps = 4, depth = 0.17): void {
  const a0 = center - widthT / 2;
  const a1 = center + widthT / 2;
  for (let i = 0; i < steps; i++) {
    const z1 = height * (1 - i / steps);
    const reach = depth * (i + 1);
    if (face === 'left') {
      const ss = (o: number): Shader => wallShader(st, { kind: 'stone', base: st.stone, H: z1, eave: 0, off: o });
      sc.box(a0, at, 0, a1, at + reach, z1, stoneTop(st, scale(st.stone, 1.08)), ss(0), ss(3));
    } else {
      const ss = (o: number): Shader => wallShader(st, { kind: 'stone', base: st.stone, H: z1, eave: 0, off: o });
      sc.box(at, a0, 0, at + reach, a1, z1, stoneTop(st, scale(st.stone, 1.08)), ss(0), ss(3));
    }
  }
}

/** Crenellated top edge on the visible faces of a box. */
export function crenellate(sc: Scene3D, st: Style, u0: number, v0: number, u1: number, v1: number, z: number, h = 5): void {
  const n = Math.max(2, Math.round(Math.max(u1 - u0, v1 - v0) * 2.2));
  const m: Shader = wallShader(st, { kind: 'stone', base: scale(st.stone, 1.05), H: h, eave: 0 });
  for (let i = 0; i < n; i += 2) {
    const a = u0 + ((u1 - u0) * i) / n;
    const b = u0 + ((u1 - u0) * (i + 1)) / n;
    sc.box(a, v1 - 0.16, z, b, v1, z + h, stoneTop(st, st.stone), m, m);
    const c = v0 + ((v1 - v0) * i) / n;
    const d = v0 + ((v1 - v0) * (i + 1)) / n;
    sc.box(u1 - 0.16, c, z, u1, d, z + h, stoneTop(st, st.stone), m, m);
  }
}

/** Low railing along a visible face. */
export function rail(sc: Scene3D, st: Style, face: FaceId, at: number, a0: number, a1: number, z: number, h = 6, color: Col = LACQUER): void {
  const sh: Shader = (s, t, lit) => {
    const post = (s | 0) % 6 < 1;
    if (t < 1.2 || t > h - 1.6 || post) return charred(st, lc(color, lit), 0.5);
    if (t > h * 0.45 && t < h * 0.45 + 1.1) return charred(st, lc(scale(color, 0.85), lit), 0.5);
    return 0;
  };
  decalQuad(sc, face, at, a0, a1, z, z + h, sh);
}

/** Cloth awning / flag plane with stripes, as a sloped quad over the left face direction. */
export function stripedCloth(c1: Col, c2: Col, period = 3): Shader {
  return (u, v, lit) => lc((Math.floor(u * 16 / period) & 1) === 0 ? c1 : c2, lit);
}

export { bayer, LIT_LEFT, LIT_RIGHT, LIT_TOP, rgba, scale };
