/**
 * Sect compound and caravan props, drawn procedurally: sect gate (paifang), training dummy, weapon rack, banner pole with a
 * tintable cloth, handcart and pack ox. Same conventions as `arch.ts` / `props.ts` / `beasts.ts`: pixel buffers at final size,
 * shared ramps, ink outline, light from the upper left, hard edges. Isometric pieces are built in a Scene3D with a local
 * frame (`a` along the long side of the piece, `b` across) so both street axes come out of the same code. Heights are
 * screen px (Scene3D `zk` = 1). Pure (node-testable); `sectSprite` is the only function that touches the DOM.
 *
 * Facings follow the game: 0 SE (+x, down-right), 1 SW (+y), 2 NW (-x), 3 NE (-y). Asymmetric pieces (cart, ox) render
 * dirs 0 and 3 and mirror them for 1 and 2 (like the beasts). Pieces that look the same from the front and back (gate,
 * rack, dummy, banner) render one view per street axis: even dirs span x, odd dirs span y.
 */
import { LACQUER, LACQUER_DARK, GOLD, GOLD_DARK, INK_SOFT, ramp, type Ramp } from './palette';
import { hex, mix, rgba, scale, type Col } from './color';
import { groundShadow, hf, rampTone, shadedBlob } from './draw';
import { LIT_LEFT, Scene3D, type Shader } from './mesh';
import { PixelBuffer } from './pixel';
import { roof as drawRoof, type Style } from './arch';
import { makeSprite, type Sprite } from './canvas';
import { PERSON_PX, type Target } from './scale';

// ---------------------------------------------------------------------------
// Target heights (a separate block so scale.ts stays untouched; same units: multiples of PERSON_PX)
// ---------------------------------------------------------------------------

const t = (want: number, min: number, max: number): Target => ({ want, min, max });

export const SECT_TARGETS = {
  sectGate: t(2.8, 2.5, 3.1),
  trainingDummy: t(0.9, 0.8, 1.0),
  weaponRack: t(0.8, 0.7, 0.9),
  banner: t(3.0, 2.7, 3.3),
  handcart: t(0.9, 0.8, 1.0),
  packOx: t(0.85, 0.75, 0.95),
} as const satisfies Record<string, Target>;

export type SectTargetKey = keyof typeof SECT_TARGETS;

/** Length of the pack ox (nose to tail) in persons. */
export const OX_LENGTH: Target = t(1.4, 1.25, 1.55);

export interface SectSprite {
  pb: PixelBuffer;
  /** Ground-contact point (footprint centre / feet). */
  ax: number;
  ay: number;
  /** First opaque row (0 after cropping). */
  top: number;
  /** Height of the highest opaque pixel above the ground point beneath it (px). */
  heightPx: number;
  /** Footprint in tiles. */
  footprint: { w: number; d: number };
  glow: PixelBuffer | null;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const WOOD = ramp('#7a5434', 0.68, 1.22);
const WOOD_DARK = ramp('#4a3322', 0.7, 1.3);
const LAC = ramp(LACQUER, 0.7, 1.22);
const STONE = ramp('#9a958c', 0.66, 1.2);
const STRAW = ramp('#c9a649', 0.7, 1.2);
const IRON = ramp('#55565e', 0.6, 1.5);
const STEEL = hex('#d9dde4');
const CLOTH = ramp('#b6a98a', 0.72, 1.18);
const GREEN_TILE = '#5d7466';

/** Tone from a face light: top l, left b, right d. */
function tone(r: Ramp, lit: number): Col {
  return lit >= 0.98 ? r.l : lit >= 0.85 ? r.b : r.d;
}

function dark(r: Ramp, c: Col): Col {
  return c === r.l ? r.b : c === r.b ? r.d : r.dd;
}

/** Flat ramp shader with flecks and optional vertical board lines. */
function matShader(r: Ramp, seed: number, o: { fleck?: number; boards?: number } = {}): Shader {
  const fleck = o.fleck ?? 0.08;
  return (_s, _t, lit, x, y) => {
    let c = tone(r, lit);
    if (hf(x, y, seed) < fleck) c = dark(r, c);
    if (o.boards && (x + seed) % o.boards === 0) c = dark(r, c);
    return c;
  };
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

/** Local frame: `a` along the long side, `b` across. Axis 0 maps a -> u, axis 1 maps a -> v. */
class Local {
  constructor(
    readonly sc: Scene3D,
    readonly axis: 0 | 1,
  ) {}

  uv(a: number, b: number): [number, number] {
    return this.axis === 0 ? [a, b] : [b, a];
  }

  box(a0: number, b0: number, z0: number, a1: number, b1: number, z1: number, sh: Shader, emissive = false): void {
    const [ua, va] = this.uv(a0, b0);
    const [ub, vb] = this.uv(a1, b1);
    this.sc.box(Math.min(ua, ub), Math.min(va, vb), z0, Math.max(ua, ub), Math.max(va, vb), z1, sh, sh, sh, emissive);
  }

  /** Vertical column of 1 px dots (thin poles, spear shafts, blades). */
  line(a: number, b: number, z0: number, z1: number, col: Col): void {
    const [u, v] = this.uv(a, b);
    for (let z = z0; z <= z1; z += 0.5) this.sc.plot(u, v, z, col);
  }

  /** Ground shadow ellipse under (a, b). */
  shadow(a: number, b: number, rx: number, ry: number, alpha = 54): void {
    const [u, v] = this.uv(a, b);
    groundShadow(this.sc.pb, this.sc.sx(u, v) + 2, this.sc.sy(u, v, 0) + 1, rx, ry, alpha);
  }

  /**
   * Flat decal on the face that looks at the camera along the short side (`b` = max): screen-left face for axis 0,
   * screen-right face for axis 1. `a0..a1` and `z0..z1` select the rectangle.
   */
  front(a0: number, a1: number, bAt: number, z0: number, z1: number, sh: Shader, bias = 1.5): void {
    if (this.axis === 0) this.sc.left(a0, a1, bAt, z0, z1, LIT_LEFT, sh, false, bias);
    else this.sc.right(a0, a1, bAt, z0, z1, 0.64, sh, false, bias);
  }
}

function styleFor(seed: number): Style {
  return { roof: hex(GREEN_TILE), accent: LACQUER, wall: hex('#e6dcc6'), timber: hex('#5a3a26'), stone: hex('#8e8a82'), season: 1, fallen: false, seed, soot: hex('#2a2226'), zk: 1 };
}

/** Crop to the opaque bounds and move the anchor along. */
function crop(pb: PixelBuffer, glow: PixelBuffer | null, ax: number, ay: number): { pb: PixelBuffer; glow: PixelBuffer | null; ax: number; ay: number } {
  const b = pb.bounds()!;
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.px[y * w + x] = pb.px[(y + b.y0) * pb.w + x + b.x0];
  let g: PixelBuffer | null = null;
  if (glow && glow.bounds()) {
    g = new PixelBuffer(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.px[y * w + x] = glow.px[(y + b.y0) * glow.w + x + b.x0];
  }
  return { pb: out, glow: g, ax: ax - b.x0, ay: ay - b.y0 };
}

function finish(pb: PixelBuffer, glow: PixelBuffer | null, ax: number, ay: number, footprint: { w: number; d: number }, groundYAtTop = ay): SectSprite {
  pb.outline(INK_SOFT);
  const c = crop(pb, glow, Math.round(ax), Math.round(ay));
  const b0 = pb.bounds()!;
  // ground point beneath the highest pixel, in the cropped frame
  const gy = Math.round(groundYAtTop) - b0.y0;
  return { pb: c.pb, glow: c.glow, ax: c.ax, ay: c.ay, top: 0, heightPx: gy - 0 + 1, footprint };
}

/** Scene sized for a footprint of w x d tiles with `maxZ` px of height. */
function makeScene(w: number, d: number, maxZ: number): Scene3D {
  const margin = 12;
  const oy = Math.ceil(maxZ) + 14;
  const ox = d * 16 + margin;
  return new Scene3D((w + d) * 16 + margin * 2, (w + d) * 8 + oy + 12, ox, oy);
}

// ---------------------------------------------------------------------------
// 1. Sect gate (paifang): three bays, four lacquer pillars, tiled roofs, blank plaque. Footprint 4 x 1 tiles.
// ---------------------------------------------------------------------------

export const GATE_APEX = 84;

/** axis 0 spans x (the long side runs down-right on screen), axis 1 spans y (down-left). */
export function genSectGate(axis: 0 | 1 = 0): SectSprite {
  const W = 4;
  const D = 1;
  const w = axis === 0 ? W : D;
  const d = axis === 0 ? D : W;
  const sc = makeScene(w, d, GATE_APEX + 8);
  const L = new Local(sc, axis);
  const st = styleFor(11);
  const stone = matShader(STONE, 3, { fleck: 0.12 });
  const lac = matShader(LAC, 5, { fleck: 0.05 });
  const lacDark = matShader(ramp(LACQUER_DARK, 0.7, 1.25), 6, { fleck: 0.05 });
  const beam = matShader(WOOD_DARK, 7, { fleck: 0.1, boards: 5 });
  const gold: Shader = (_s, _t, lit) => tone(ramp(GOLD, 0.72, 1.18), lit);

  // pillars: [a, topZ]
  const pillars: [number, number][] = [
    [0.4, 42],
    [1.35, 58],
    [2.65, 58],
    [3.6, 42],
  ];
  for (const [a] of pillars) L.shadow(a, 0.5, 5, 1.8);
  for (const [a, top] of pillars) {
    L.box(a - 0.15, 0.35, 0, a + 0.15, 0.65, 4, stone); // stone drum
    L.box(a - 0.075, 0.425, 4, a + 0.075, 0.575, top, lac);
    L.box(a - 0.095, 0.405, top - 2, a + 0.095, 0.595, top, gold); // gold cap
  }
  // tie beams between the pillars (the passage is clear below them)
  L.box(0.4, 0.45, 32, 1.35, 0.55, 36, beam);
  L.box(1.35, 0.45, 38, 2.65, 0.55, 42, beam);
  L.box(2.65, 0.45, 32, 3.6, 0.55, 36, beam);
  // gold trim line along the lower beams
  L.box(1.35, 0.5, 41, 2.65, 0.56, 42, gold);

  // upper bracket bands under the roofs
  L.box(0.18, 0.3, 36, 1.2, 0.7, 42, lacDark);
  L.box(1.1, 0.3, 50, 2.9, 0.7, 58, lacDark);
  L.box(2.8, 0.3, 36, 3.82, 0.7, 42, lacDark);
  // little bracket blocks (dougong) under the centre eave
  for (let a = 1.25; a <= 2.8; a += 0.28) L.box(a - 0.04, 0.26, 56, a + 0.04, 0.32, 58, gold);
  // blank plaque: dark lacquer board in a gold frame
  const plaque: Shader = (s, tt, _lit, x, y) => {
    const edge = tt < 1.2 || tt > 6.4 || s < 1.2 || s > 12.4;
    return edge ? hex('#d9b867') : hf(x, y, 9) < 0.06 ? hex('#33211c') : hex('#2a1a18');
  };
  L.front(1.55, 2.45, axis === 0 ? 0.7 : 0.7, 50.5, 57.5, plaque);

  // roofs: centre hall roof higher, two lower side roofs
  const ridge = mix(st.roof, GOLD, 0.25);
  const R = (a0: number, a1: number, zEave: number, rise: number): void => {
    const [u0, v0] = L.uv(a0, 0.3);
    const [u1, v1] = L.uv(a1, 0.7);
    drawRoof(sc, st, Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1), { zEave, rise, over: 0.3, up: 5, color: st.roof, ridge, rows: 6 });
  };
  R(0.18, 1.2, 42, 14);
  R(2.8, 3.82, 42, 14);
  R(1.25, 2.75, 58, 26);

  // a pair of paper lanterns under the centre beam
  for (const a of [1.65, 2.35]) {
    const [u, v] = L.uv(a, 0.5);
    sc.blob(u, v, 30, 2.4, 3.2, (nx, ny) => (ny > 0.7 || ny < -0.7 ? hex('#2c1c14') : nx < -0.2 ? hex('#e8643f') : nx > 0.4 ? LAC.d : LAC.b));
    sc.blob(u, v, 30, 1.6, 2.4, (_nx, ny) => (Math.abs(ny) < 0.8 ? hex('#ffcf73') : 0), 'glow');
  }

  // apex ground point for the height measurement: the centre ridge starts at a = 1.75 (roof L + hip), b = 0.5
  const [au, av] = L.uv(1.3, 0.5);
  const apexGround = sc.sy(au, av, 0);
  const [cu, cv] = L.uv(W / 2, D / 2);
  return finish(sc.pb, sc.glow, sc.sx(cu, cv), sc.sy(cu, cv, 0), { w, d }, apexGround);
}

// ---------------------------------------------------------------------------
// 2. Training dummy (about 0.9 persons): post, crossbar arms, straw wrap and head
// ---------------------------------------------------------------------------

export function genTrainingDummy(axis: 0 | 1 = 0): SectSprite {
  const sc = makeScene(1, 1, 40);
  const L = new Local(sc, axis);
  const wood = matShader(WOOD, 4, { fleck: 0.1 });
  L.shadow(0.5, 0.5, 7, 2.4);
  // crossed foot beams
  L.box(0.25, 0.44, 0, 0.75, 0.56, 3, wood);
  L.box(0.44, 0.25, 0, 0.56, 0.75, 3, wood);
  // post
  L.box(0.455, 0.455, 3, 0.545, 0.545, 21, wood);
  // crossbar arms
  L.box(0.1, 0.46, 13, 0.9, 0.54, 16, wood);
  const [u, v] = L.uv(0.5, 0.5);
  // straw torso wrapped in rope, a head and the red sash
  const strawFn = (rampOf: Ramp, seed: number) => (nx: number, ny: number, x: number, y: number): Col => {
    const lit = -nx * 0.55 - ny * 0.7;
    let c = rampTone(rampOf, 0.5 + lit * 0.45 + (hf(x, y, seed) - 0.5) * 0.35);
    if (hf(x, y, seed + 1) < 0.1) c = rampOf.dd;
    return c;
  };
  sc.blob(u, v, 10.5, 4.6, 7, strawFn(STRAW, 21));
  sc.blob(u, v, 20.5, 3.8, 3.6, strawFn(STRAW, 22));
  // rope bands, a red sash and a painted target ring
  sc.blob(u, v, 10.5, 4.7, 7.1, (nx, ny, x, y) => {
    if (Math.abs(ny - 0.55) < 0.12 && hf(x, y, 3) < 0.9) return hex('#6e4a2a');
    if (Math.abs(ny + 0.3) < 0.12) return LAC.b;
    if (Math.abs(nx) < 0.3 && Math.abs(ny - 0.1) < 0.14) return LAC.d;
    return 0;
  });
  // dummy top: the head's top pixel is at about 24 + 4 = 28 -> trimmed to 27 by the blob rim
  return finish(sc.pb, null, sc.sx(u, v), sc.sy(u, v, 0), { w: 1, d: 1 });
}

// ---------------------------------------------------------------------------
// 3. Weapon rack (about 0.8 persons): frame with upright spears and swords
// ---------------------------------------------------------------------------

export function genWeaponRack(axis: 0 | 1 = 0): SectSprite {
  const sc = makeScene(1, 1, 36);
  const L = new Local(sc, axis);
  const wood = matShader(WOOD, 12, { fleck: 0.1 });
  L.shadow(0.5, 0.5, 11, 2.8);
  // frame: two A-frame legs, two rails
  for (const a of [0.1, 0.9]) {
    L.box(a - 0.05, 0.3, 0, a + 0.05, 0.7, 2, wood);
    L.box(a - 0.04, 0.46, 2, a + 0.04, 0.54, 12, wood);
  }
  L.box(0.06, 0.45, 9, 0.94, 0.55, 12, wood);
  L.box(0.06, 0.45, 4, 0.94, 0.55, 6, wood);
  // weapons: spears (even slots) and swords
  const slots = [0.2, 0.32, 0.44, 0.56, 0.68, 0.8];
  slots.forEach((a, i) => {
    const b = i % 2 ? 0.58 : 0.42;
    if (i % 3 === 0) {
      // spear: long shaft with a steel head and a red tassel
      L.line(a, b, 3, 17, WOOD.l);
      L.line(a, b, 18, 20, STEEL);
      const [u, v] = L.uv(a, b);
      sc.plot(u, v, 17, LAC.b);
      sc.plot(u + 0.06, v + 0.06, 16, LAC.d);
    } else {
      // sword: pommel up, steel blade hidden below the rail
      L.line(a, b, 3, 9, STEEL);
      L.line(a, b, 10, 15, i % 2 ? hex('#3a2a26') : hex('#5a3a2a'));
      L.line(a, b, 10, 10, GOLD);
      const [u, v] = L.uv(a, b);
      sc.plot(u - 0.05, v, 10, GOLD);
      sc.plot(u + 0.05, v, 10, GOLD);
      sc.plot(u, v, 16, GOLD_DARK);
    }
  });
  return finish(sc.pb, null, sc.sx(...L.uv(0.5, 0.5)), sc.sy(...L.uv(0.5, 0.5), 0), { w: 1, d: 1 }, sc.sy(...L.uv(0.2, 0.42), 0));
}

// ---------------------------------------------------------------------------
// 4. Banner pole (about 3 persons) with a tintable cloth
// ---------------------------------------------------------------------------

/** Neutral greys the cloth is painted with; `tintBanner` swaps them for the ramp of the sect colour. */
export const CLOTH_GREYS = { l: 0xdc, b: 0xa8, d: 0x7c, dd: 0x56 } as const;
const grey = (v: number): Col => rgba(v, v, v);

export interface BannerLayers {
  /** Pole, finials, gold emblem and outline (no cloth). */
  base: PixelBuffer;
  /** Cloth only, neutral grey tones (alpha 255 where there is cloth). */
  cloth: PixelBuffer;
  ax: number;
  ay: number;
  heightPx: number;
  footprint: { w: number; d: number };
}

export function genBannerLayers(axis: 0 | 1 = 0): BannerLayers {
  const sc = makeScene(1, 1, 92);
  const L = new Local(sc, axis);
  const [pu, pv] = L.uv(0.5, 0.5);
  const clothMark = new Uint32Array(sc.pb.px.length);
  L.shadow(0.55, 0.5, 8, 2.6, 56);
  // stone socket and the pole
  L.box(0.38, 0.38, 0, 0.62, 0.62, 5, matShader(STONE, 3, { fleck: 0.12 }));
  L.box(0.465, 0.465, 5, 0.535, 0.535, 80, matShader(WOOD, 14, { fleck: 0.1 }));
  // cross-arm the cloth hangs from
  L.box(0.28, 0.47, 72, 0.72, 0.53, 75, matShader(WOOD, 15, { fleck: 0.1 }));
  // gold finial
  const goldM = ramp(GOLD, 0.72, 1.18);
  sc.blob(pu, pv, 83, 2, 3.4, (nx, ny) => (nx < -0.1 ? goldM.l : ny > 0.4 ? goldM.d : goldM.b));
  sc.plot(pu, pv, 88, goldM.hl);
  // the cloth: a long strip on the face of the arm, waving a little, swallow-tailed
  const wave = (tt: number): number => Math.sin(tt * 0.22) * 0.9;
  const clothShader: Shader = (s, tt, lit, x, y) => {
    const W = 12.4; // cloth width in s units
    const len = 58;
    const tHere = tt; // px above z0
    if (tHere > len) return 0;
    const fromTop = len - tHere;
    // swallow tail
    const mid = W / 2;
    if (fromTop > len - 12 && Math.abs(s - mid) < ((fromTop - (len - 12)) / 12) * (W / 2) * 0.9) return 0;
    const sw = s + wave(fromTop);
    if (sw < 0 || sw > W) return 0;
    const u2 = sw / W;
    let g: number = u2 < 0.22 ? CLOTH_GREYS.l : u2 > 0.78 ? CLOTH_GREYS.d : CLOTH_GREYS.b;
    // fold shading follows the wave
    if (Math.sin(fromTop * 0.22 + 1.2) > 0.82) g = g === CLOTH_GREYS.l ? CLOTH_GREYS.b : g === CLOTH_GREYS.b ? CLOTH_GREYS.d : CLOTH_GREYS.dd;
    if (lit < 0.8 && g === CLOTH_GREYS.b) g = CLOTH_GREYS.d;
    if (fromTop < 2 || fromTop > len - 1.5) g = CLOTH_GREYS.dd;
    if (hf(x, y, 31) < 0.05) g = g === CLOTH_GREYS.l ? CLOTH_GREYS.b : g;
    const col = grey(g);
    clothMark[y * sc.pb.w + x] = col;
    return col;
  };
  // cloth plane: hangs just in front of the pole, facing the camera
  const aHalf = 0.4;
  if (axis === 0) sc.left(0.5 - aHalf * 0.5, 0.5 + aHalf * 0.5, 0.56, 15, 73, LIT_LEFT, clothShader, false, 1);
  else sc.right(0.5 - aHalf * 0.5, 0.5 + aHalf * 0.5, 0.56, 15, 73, 0.64, clothShader, false, 1);
  // gold emblem on the cloth (a disc with a dark core), part of the base layer
  const [eu, ev] = axis === 0 ? [0.5, 0.57] : [0.57, 0.5];
  sc.blob(eu, ev, 58, 3.1, 3.1, (nx, ny) => (nx * nx + ny * ny < 0.22 ? hex('#6e1f1f') : nx < -0.2 ? goldM.l : goldM.b), false);
  // trim lines top and bottom
  const base = sc.pb;
  // cloth layer = pixels still holding the cloth colour after everything else was drawn
  const cloth = new PixelBuffer(base.w, base.h);
  for (let i = 0; i < base.px.length; i++) {
    if (clothMark[i] && base.px[i] === clothMark[i]) {
      cloth.px[i] = clothMark[i];
      base.px[i] = 0;
    }
  }
  // outline the union so both layers share one silhouette
  const union = base.clone();
  union.blit(cloth, 0, 0);
  union.outline(INK_SOFT);
  for (let i = 0; i < union.px.length; i++) if (!base.px[i] && !cloth.px[i] && union.px[i]) base.px[i] = union.px[i];
  const b = union.bounds()!;
  const cut = (src: PixelBuffer): PixelBuffer => {
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const out = new PixelBuffer(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.px[y * w + x] = src.px[(y + b.y0) * src.w + x + b.x0];
    return out;
  };
  const ax = Math.round(sc.sx(pu, pv)) - b.x0;
  const ay = Math.round(sc.sy(pu, pv, 0)) - b.y0;
  return { base: cut(base), cloth: cut(cloth), ax, ay, heightPx: ay + 1, footprint: { w: 1, d: 1 } };
}

/** Swap the cloth greys for the ramp of a CSS colour. */
export function tintBanner(cloth: PixelBuffer, colorCss: string): PixelBuffer {
  const r = ramp(colorCss, 0.7, 1.22);
  const map = new Map<number, Col>([
    [grey(CLOTH_GREYS.l), r.l],
    [grey(CLOTH_GREYS.b), r.b],
    [grey(CLOTH_GREYS.d), r.d],
    [grey(CLOTH_GREYS.dd), r.dd],
  ]);
  const out = new PixelBuffer(cloth.w, cloth.h);
  for (let i = 0; i < cloth.px.length; i++) {
    const c = cloth.px[i];
    if (c >>> 24 === 0) continue;
    out.px[i] = map.get(c) ?? c;
  }
  return out;
}

export function genBanner(colorCss = '#a8302a', axis: 0 | 1 = 0): SectSprite {
  const l = genBannerLayers(axis);
  const pb = l.base.clone();
  pb.blit(tintBanner(l.cloth, colorCss), 0, 0);
  return { pb, ax: l.ax, ay: l.ay, top: 0, heightPx: l.heightPx, footprint: l.footprint, glow: null };
}

// ---------------------------------------------------------------------------
// 5. Handcart (about 0.9 persons, 1 x 2 tiles): bed, spoked wheels, shafts and a covered load
// ---------------------------------------------------------------------------

/** One wheel as a disc in the plane perpendicular to the cart's across axis. `onV` true: plane v = at (axis 0 carts). */
function wheel(sc: Scene3D, onV: boolean, c: number, at: number, zc: number, R: number, hubSeed: number): void {
  const zR = R * 19.6;
  const sh: Shader = (s, tt, lit, x, y) => {
    const nx = (s - R * 16) / (R * 16);
    const ny = (tt - zR) / zR;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1) return 0;
    if (d2 > 0.62) return tone(WOOD_DARK, lit); // rim
    if (d2 < 0.06) return tone(IRON, lit); // hub
    // spokes: eight of them
    const ang = Math.atan2(ny, nx);
    const k = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5);
    if (k > 0.34 && hf(x, y, hubSeed) < 0.97) return tone(WOOD, lit);
    return 0;
  };
  if (onV) sc.left(c - R, c + R, at, zc - zR, zc + zR, LIT_LEFT, sh, false, 0.5);
  else sc.right(c - R, c + R, at, zc - zR, zc + zR, 0.64, sh, false, 0.5);
}

/** dir 0 SE or 3 NE are the drawn facings; 1 and 2 mirror them. */
export function genHandcart(dir: 0 | 1 | 2 | 3 = 0): SectSprite {
  if (dir === 1 || dir === 2) {
    const g = genHandcart(dir === 1 ? 0 : 3);
    return mirrorSprite(g);
  }
  const heading = dir === 0 ? 0 : 1; // 0: heads +u (SE), 1: heads -v (NE)
  const w = heading === 0 ? 2 : 1;
  const d = heading === 0 ? 1 : 2;
  const sc = makeScene(w, d, 40);
  // local frame: a along the heading (0..2), b across (0..1). u,v from (a, b)
  const uv = (a: number, b: number): [number, number] => (heading === 0 ? [a, b] : [b, 2 - a]);
  const box = (a0: number, b0: number, z0: number, a1: number, b1: number, z1: number, sh: Shader): void => {
    const [ua, va] = uv(a0, b0);
    const [ub, vb] = uv(a1, b1);
    sc.box(Math.min(ua, ub), Math.min(va, vb), z0, Math.max(ua, ub), Math.max(va, vb), z1, sh, sh, sh);
  };
  const wood = matShader(WOOD, 41, { fleck: 0.09, boards: 4 });
  const woodD = matShader(WOOD_DARK, 42, { fleck: 0.09 });
  // shadow under the bed
  {
    const [u, v] = uv(0.95, 0.5);
    groundShadow(sc.pb, sc.sx(u, v) + 2, sc.sy(u, v, 0) + 1, 17, 4.6, 54);
  }
  // wheels (axle at a = 0.75), both sides; the far one first
  const R = 0.38;
  const zc = R * 19.6;
  const axleA = 0.75;
  const [uf, vf] = uv(axleA, 0.12);
  const [un, vn] = uv(axleA, 0.88);
  if (heading === 0) {
    wheel(sc, true, uf, vf, zc, R, 1);
    wheel(sc, true, un, vn, zc, R, 2);
  } else {
    wheel(sc, false, vf, uf, zc, R, 1);
    wheel(sc, false, vn, un, zc, R, 2);
  }
  // axle
  box(axleA - 0.03, 0.1, zc - 1, axleA + 0.03, 0.9, zc + 1, woodD);
  // bed and low side boards
  box(0.2, 0.18, 11, 1.4, 0.82, 13.5, wood);
  box(0.2, 0.14, 13.5, 1.4, 0.2, 16.5, wood);
  box(0.2, 0.8, 13.5, 1.4, 0.86, 16.5, wood);
  box(0.16, 0.14, 13.5, 0.22, 0.86, 16.5, wood);
  box(1.38, 0.14, 13.5, 1.44, 0.86, 16.5, wood);
  // shafts reaching ahead to a crossbar yoke
  box(1.4, 0.26, 10, 1.95, 0.32, 12, woodD);
  box(1.4, 0.68, 10, 1.95, 0.74, 12, woodD);
  box(1.88, 0.26, 10, 1.95, 0.74, 12, woodD);
  // the covered load: a canvas dome tied with rope, heightfield over the bed
  const cloth: Shader = (s, tt, lit, x, y) => {
    void s;
    void tt;
    let c = tone(CLOTH, lit);
    if (hf(x, y, 51) < 0.1) c = dark(CLOTH, c);
    return c;
  };
  const [lu0, lv0] = uv(0.26, 0.24);
  const [lu1, lv1] = uv(1.34, 0.76);
  const hu0 = Math.min(lu0, lu1);
  const hu1 = Math.max(lu0, lu1);
  const hv0 = Math.min(lv0, lv1);
  const hv1 = Math.max(lv0, lv1);
  const aSpan = (a: number): number => (a - 0.26) / 1.08;
  const load = (u: number, v: number): number => {
    const a = heading === 0 ? u : 2 - v;
    const b = heading === 0 ? v : u;
    const ta = Math.min(1, Math.max(0, 1 - Math.pow(Math.abs(aSpan(a) - 0.5) * 2, 2.2)));
    const tb = Math.min(1, Math.max(0, 1 - Math.pow(Math.abs((b - 0.24) / 0.52 - 0.5) * 2, 2)));
    return 16.5 + 9 * Math.sqrt(ta * tb);
  };
  sc.heightfield(hu0, hv0, hu1, hv1, 14, 8, load, (u, v, lit, x, y) => {
    const a = heading === 0 ? u : 2 - v;
    // rope bands
    const band = Math.abs(aSpan(a) - 0.3) < 0.025 || Math.abs(aSpan(a) - 0.7) < 0.025;
    return band ? tone(ramp('#6e4a2a', 0.7, 1.2), lit) : cloth(u, v, lit, x, y);
  });
  const [au, av] = uv(0.8, 0.5);
  const [cu, cv] = uv(1, 0.5);
  return finish(sc.pb, null, sc.sx(cu, cv), sc.sy(cu, cv, 0), { w, d }, sc.sy(au, av, 0));
}

// ---------------------------------------------------------------------------
// 6. Pack ox (about 1.4 persons long, 0.85 tall): side-profile quadruped with panniers and a saddle blanket
// ---------------------------------------------------------------------------

const OX_FUR = ramp('#7d6246', 0.62, 1.3);
const OX_BELLY = ramp('#a58c6a', 0.7, 1.15);
const OX_DARK = ramp('#3a2c22', 0.7, 1.3);
const BASKET = ramp('#a8844a', 0.66, 1.25);

export const OX_FRAMES = 2;

/** Draw facing right. `dir` 0 (SE): head slightly lowered; 3 (NE): head up and tail visible. 1 and 2 mirror. */
export function genPackOx(dir: 0 | 1 | 2 | 3 = 0, frame = 0): SectSprite {
  if (dir === 1 || dir === 2) return mirrorSprite(genPackOx(dir === 1 ? 0 : 3, frame));
  const away = dir === 3;
  const W = 56;
  const H = 40;
  const pb = new PixelBuffer(W, H);
  const gy = 34; // ground line
  const cx = 26;
  const stepA = frame === 0 ? 2 : -2;
  groundShadow(pb, cx + 2, gy, 16, 3, 54);
  // legs: top at the belly, hoof on the ground; swing shifts the foot, the far pair is darker
  const leg = (x: number, swing: number, near: boolean): void => {
    const top = 25;
    const bot = gy - (near ? 0 : 1) - (swing > 1.5 ? 1 : 0);
    const col = near ? OX_FUR : OX_DARK;
    const x0 = Math.round(x);
    for (let y = top; y <= bot; y++) {
      const t0 = (y - top) / Math.max(1, bot - top);
      const w = t0 < 0.5 ? 4 : 3;
      const sh = Math.round(swing * t0 * 0.7);
      for (let k = 0; k < w; k++) pb.set(x0 + k + sh, y, k === 0 ? col.l : k === w - 1 ? col.dd : col.b);
    }
    pb.rect(x0 + Math.round(swing * 0.7), bot - 1, 4, 2, OX_DARK.dd);
  };
  leg(cx + 11, -stepA, false);
  leg(cx - 6, stepA, false);
  // body and shoulder hump
  shadedBlob(pb, cx, 22, 14, 8, OX_FUR, { seed: 5, speckle: 0.12 });
  for (let x = cx - 9; x < cx + 9; x++) pb.setIfOpaque(x, 28, OX_BELLY.b);
  shadedBlob(pb, cx + 9, 16, 5, 4.6, OX_FUR, { seed: 8, speckle: 0.12 });
  // neck and head
  const hx = cx + 17;
  const hy = away ? 19 : 22;
  pb.thick(cx + 11, 19, hx, hy, 3.6, (x, y) => rampTone(OX_FUR, 0.5 + (hf(x, y, 3) - 0.5) * 0.3 + (y < hy - 1 ? 0.15 : 0)));
  shadedBlob(pb, hx + 1, hy + 1, 4.4, 3.8, OX_FUR, { seed: 11, speckle: 0.1 });
  pb.ellipse(hx + 5, hy + 3, 2.4, 1.9, OX_BELLY.b);
  pb.set(hx + 6, hy + 3, OX_DARK.dd);
  pb.set(hx + 2, hy, rgba(255, 244, 214));
  pb.set(hx + 2, hy + 1, OX_DARK.dd);
  // horns curving up and forward, and an ear
  const horn = hex('#d8d0b8');
  pb.line(hx - 1, hy - 3, hx - 2, hy - 5, horn);
  pb.line(hx - 2, hy - 5, hx + 1, hy - 7, horn);
  pb.set(hx + 1, hy - 8, hex('#a89e86'));
  pb.set(hx - 3, hy - 2, OX_DARK.b);
  pb.set(hx - 4, hy - 2, OX_DARK.d);
  // tail
  const tx = cx - 14;
  pb.line(tx, 17, tx - 2, 21, OX_DARK.b);
  pb.line(tx - 2, 21, tx - 2 + (frame ? 1 : 0), 26, OX_DARK.b);
  pb.rect(tx - 3 + (frame ? 1 : 0), 26, 3, 3, OX_DARK.dd);
  // pack saddle: red blanket with gold stitching, a far basket rim, the near basket and cargo on top
  pb.rect(cx - 7, 14, 15, 3, LAC.b);
  pb.rect(cx - 7, 14, 15, 1, LAC.l);
  pb.rect(cx - 7, 16, 15, 1, LAC.d);
  for (let x = cx - 7; x < cx + 8; x += 3) pb.set(x, 15, hex('#d9b867'));
  pb.rect(cx - 5, 12, 11, 3, BASKET.d);
  pb.rect(cx - 5, 12, 11, 1, BASKET.l);
  const bx = cx - 8;
  const by = 17;
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 11; x++) {
      const weave = (x + y) % 3 === 0;
      let c = x < 3 ? BASKET.l : x > 7 ? BASKET.d : BASKET.b;
      if (weave) c = x < 3 ? BASKET.b : x > 7 ? BASKET.dd : BASKET.d;
      if (y === 0) c = BASKET.l;
      if (y === 8) c = BASKET.dd;
      pb.set(bx + x, by + y, c);
    }
  pb.vline(bx + 5, 14, by + 8, hex('#6e4a2a'));
  shadedBlob(pb, cx - 2, 11, 4.2, 3, STRAW, { seed: 21, speckle: 0.16 });
  shadedBlob(pb, cx + 4, 12, 3.4, 2.8, CLOTH, { seed: 22, speckle: 0.1 });
  pb.line(cx - 5, 13, cx + 7, 13, hex('#6e4a2a'));
  // near legs
  leg(cx + 8, stepA, true);
  leg(cx - 10, -stepA, true);
  if (away) pb.set(hx + 1, hy - 2, OX_BELLY.l);
  return finish(pb, null, cx + 2, gy - 1, { w: 1, d: 1 });
}

// ---------------------------------------------------------------------------
// Directions, mirror, DOM bridge
// ---------------------------------------------------------------------------

/** Horizontal mirror of a sprite (anchor mirrored too). */
export function mirrorSprite(s: SectSprite): SectSprite {
  return { ...s, pb: s.pb.flipped(), ax: s.pb.w - 1 - s.ax, footprint: { w: s.footprint.d, d: s.footprint.w }, glow: s.glow ? s.glow.flipped() : null };
}

export interface SectAssetDef {
  id: string;
  name: string;
  key: SectTargetKey;
  footprint: { w: number; d: number };
  /** Render the sprite for a facing (0 SE, 1 SW, 2 NW, 3 NE) and animation frame. */
  make(dir: 0 | 1 | 2 | 3, frame?: number): SectSprite;
  frames: number;
}

const byAxis = (g: (axis: 0 | 1) => SectSprite) => (dir: 0 | 1 | 2 | 3): SectSprite => g((dir & 1) as 0 | 1);

export const SECT_ASSETS: SectAssetDef[] = [
  { id: 'sect_gate', name: 'sect gate', key: 'sectGate', footprint: { w: 4, d: 1 }, make: byAxis(genSectGate), frames: 1 },
  { id: 'training_dummy', name: 'training dummy', key: 'trainingDummy', footprint: { w: 1, d: 1 }, make: byAxis(genTrainingDummy), frames: 1 },
  { id: 'weapon_rack', name: 'weapon rack', key: 'weaponRack', footprint: { w: 1, d: 1 }, make: byAxis(genWeaponRack), frames: 1 },
  { id: 'banner_pole', name: 'banner pole', key: 'banner', footprint: { w: 1, d: 1 }, make: byAxis((a) => genBanner('#a8302a', a)), frames: 1 },
  { id: 'handcart', name: 'handcart', key: 'handcart', footprint: { w: 2, d: 1 }, make: (dir) => genHandcart(dir), frames: 1 },
  { id: 'pack_ox', name: 'pack ox', key: 'packOx', footprint: { w: 1, d: 1 }, make: (dir, frame = 0) => genPackOx(dir, frame), frames: OX_FRAMES },
];

/** Measured height of a generated sprite in persons. */
export const personsOf = (s: SectSprite): number => s.heightPx / PERSON_PX;

/** Upload a generated sprite (DOM): `spans` for the tall ones so plates do not float on empty corners. */
export function sectSprite(s: SectSprite, spans = false): Sprite {
  const sp = makeSprite(s.pb, s.ax, s.ay, s.glow, spans);
  sp.top = s.top;
  return sp;
}

void scale;
