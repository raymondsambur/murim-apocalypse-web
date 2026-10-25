/**
 * Building sprites. `genBuilding` renders one building (by kind) into a Scene3D and returns the colour sprite, an
 * emissive (night) layer, light positions and smoke emitters. Pure (node-testable).
 */
import type { BuildingKind } from '@murim/shared';
import { addLight, addSmoke, doorPlacement, windowsFor, type BuildingArt, type BuildingSpec, type Ctx } from './bctx';
import { hex, mix, rgba, scale, type Col } from './color';
import { hf } from './draw';
import { AHW } from '../render/iso';
import { Scene3D } from './mesh';
import {
  GLOW_FIRE,
  GLOW_GREEN,
  GLOW_WARM,
  LACQUER,
  LACQUER_D,
  door,
  lantern,
  plinth,
  roof,
  walls,
  type FaceId,
  type RoofOpts,
  type Style,
} from './arch';
import * as P from './props';
import * as L from './landmarks';

export type { BuildingArt, BuildingSpec, Ctx, LightDef, SmokeDef } from './bctx';
export { addLight, addSmoke, doorPlacement, windowsFor } from './bctx';

const ROOF_DEFAULT: Record<BuildingKind, string> = {
  house: '#5b6572',
  inn: '#7a4a36',
  smithy: '#3f3a40',
  alchemy: '#3f6f5a',
  market: '#a8302a',
  shrine: '#a8302a',
  pagoda: '#3c5f86',
  hall: '#2f6a66',
  dojo: '#6a4a34',
  farmhouse: '#b89a58',
  herbHut: '#a88f50',
  mineEntrance: '#5a4a3a',
  tower: '#585e6c',
  gate: '#4d5560',
  barracks: '#4d4f5a',
  ruinedHouse: '#3a3236',
  warehouse: '#6a5546',
  teahouse: '#8a4a3a',
};

/** Kinds whose roof takes the faction colour. */
const TINTED = new Set<BuildingKind>(['house', 'inn', 'hall', 'barracks', 'tower', 'gate', 'teahouse', 'warehouse', 'dojo', 'pagoda']);

const MAX_Z: Record<BuildingKind, number> = {
  house: 70,
  inn: 82,
  smithy: 76,
  alchemy: 74,
  market: 58,
  shrine: 54,
  pagoda: 196,
  hall: 108,
  dojo: 72,
  farmhouse: 66,
  herbHut: 50,
  mineEntrance: 40,
  tower: 86,
  gate: 90,
  barracks: 72,
  ruinedHouse: 52,
  warehouse: 70,
  teahouse: 76,
};

const WALL_TONES = ['#e6dcc6', '#ddd2b8', '#e9e0cd', '#d8cbb0'];

export function genBuilding(spec: BuildingSpec): BuildingArt {
  const { w, d } = spec;
  const marginX = 14;
  const maxZ = MAX_Z[spec.kind] ?? 80;
  const oy = maxZ + 14;
  const ox = d * AHW + marginX;
  const W = (w + d) * AHW + marginX * 2;
  const H = (w + d) * 8 + oy + 10;
  const sc = new Scene3D(W, H, ox, oy);
  const seed = spec.id * 7919 + 13;
  const fallen = spec.fallen || spec.kind === 'ruinedHouse';
  const wallBase = hex(WALL_TONES[Math.abs(seed) % WALL_TONES.length]);
  const def = hex(ROOF_DEFAULT[spec.kind] ?? '#5b6572');
  let roofColor = def;
  if (spec.roofCss && TINTED.has(spec.kind)) roofColor = mix(def, hex(spec.roofCss), 0.6);
  const st: Style = {
    roof: roofColor,
    accent: spec.accentCss ? hex(spec.accentCss) : LACQUER,
    wall: wallBase,
    timber: hex('#5a3a26'),
    stone: hex('#8e8a82'),
    season: spec.season,
    fallen,
    seed,
    soot: hex('#2a2226'),
  };
  const ctx: Ctx = {
    sc,
    st,
    spec,
    w,
    d,
    roofColor,
    accent: spec.accentCss ? hex(spec.accentCss) : null,
    lights: [],
    smoke: [],
    rnd: (k) => hf(seed, k, 5),
  };
  switch (spec.kind) {
    case 'house':
      house(ctx);
      break;
    case 'inn':
      inn(ctx);
      break;
    case 'smithy':
      smithy(ctx);
      break;
    case 'alchemy':
      alchemy(ctx);
      break;
    case 'farmhouse':
      farmhouse(ctx);
      break;
    case 'herbHut':
      herbHut(ctx);
      break;
    case 'barracks':
      barracks(ctx);
      break;
    case 'warehouse':
      warehouse(ctx);
      break;
    case 'teahouse':
      teahouse(ctx);
      break;
    case 'market':
      L.market(ctx);
      break;
    case 'shrine':
      L.shrine(ctx);
      break;
    case 'pagoda':
      L.pagoda(ctx);
      break;
    case 'hall':
      L.hall(ctx);
      break;
    case 'dojo':
      L.dojo(ctx);
      break;
    case 'mineEntrance':
      L.mineEntrance(ctx);
      break;
    case 'tower':
      L.tower(ctx);
      break;
    case 'gate':
      L.gate(ctx);
      break;
    case 'ruinedHouse':
      L.ruinedHouse(ctx);
      break;
    default:
      house(ctx);
  }
  if (fallen) {
    // Smouldering ruins.
    const fx = sc.sx(w / 2, d / 2);
    ctx.smoke.push({ x: fx, y: sc.sy(w / 2, d / 2, 22), kind: 'smolder' });
  }
  // Soft outline around the whole building.
  sc.pb.outline(undefined, 0.3);
  return { pb: sc.pb, glow: sc.glow, ox, oy, lights: ctx.lights, smoke: ctx.smoke };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

export interface BasicOpts {
  inset?: number;
  H: number;
  wallKind?: 'plaster' | 'plank' | 'stone' | 'brick' | 'dark';
  wallBase?: Col;
  post?: number;
  roof: Partial<RoofOpts> & { rise: number };
  doorH?: number;
  doorW?: number;
  doorColor?: Col;
  windows?: boolean;
  windowH?: number;
  glow?: Col;
  plinthH?: number;
  timber?: Col;
}

/** Walls + plinth + door + windows + roof. Returns geometry for decoration. */
export function basic(c: Ctx, o: BasicOpts): { u0: number; u1: number; v0: number; v1: number; zWall: number; r: ReturnType<typeof roof> } {
  const { sc, st, w, d } = c;
  const ins = o.inset ?? 0.42;
  const u0 = ins;
  const u1 = w - ins;
  const v0 = ins;
  const v1 = d - ins;
  const ph = o.plinthH ?? 3;
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, ph);
  const z1 = ph + o.H;
  const stt: Style = o.timber ? { ...st, timber: o.timber } : st;
  walls(sc, stt, u0, v0, u1, v1, ph, z1, {
    kind: o.wallKind ?? 'plaster',
    base: o.wallBase ?? st.wall,
    post: o.post ?? 12,
    ruin: st.fallen ? 9 : 0,
    eave: 5,
  });
  const dp = doorPlacement(c.spec);
  const at = dp.face === 'left' ? v1 : u1;
  door(sc, stt, dp.face, at, dp.center, o.doorW ?? 0.52, ph, o.doorH ?? 17, o.doorColor);
  if (o.windows !== false) windowsFor(c, u0, u1, v0, v1, ph + (o.H > 20 ? 9 : 7), o.windowH ?? 7, o.glow ?? GLOW_WARM);
  const ro = roof(sc, st, u0, v0, u1, v1, {
    zEave: z1,
    over: 0.38,
    up: 5,
    color: c.roofColor,
    ridge: c.accent ? mix(c.roofColor, c.accent, 0.5) : undefined,
    holes: st.fallen ? 0.34 : 0,
    ...o.roof,
  });
  // door light
  addLight(c, dp.face === 'left' ? dp.center : u1 + 0.1, dp.face === 'left' ? v1 + 0.1 : dp.center, ph + 9, 28, GLOW_WARM);
  return { u0, u1, v0, v1, zWall: z1, r: ro };
}

function chimney(c: Ctx, u: number, v: number, h: (u: number, v: number) => number, up = 14): void {
  const { sc, st } = c;
  const z0 = h(u, v) - 3;
  const mk = (off: number) => (s: number, t: number, lit: number, x: number, y: number): Col => {
    let col = scale(st.stone, 0.92);
    if (hf(x, y, 8) < 0.12) col = scale(col, 0.82);
    if ((t | 0) % 4 === 0) col = scale(col, 0.75);
    void off;
    return scale(col, Math.min(1.2, lit));
  };
  sc.box(u - 0.14, v - 0.14, z0, u + 0.14, v + 0.14, z0 + up, (uu, vv, lit) => scale(hex('#4a4044'), lit), mk(0), mk(1));
  if (!st.fallen) addSmoke(c, u, v, z0 + up + 1, 'chimney');
}

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

function house(c: Ctx): void {
  const b = basic(c, { H: 30, post: 11, doorH: 20, roof: { rise: 15, over: 0.4, up: 5 } });
  if (c.rnd(1) < 0.55) chimney(c, b.u1 - 0.6, b.v0 + 0.6, b.r.h, 12);
  if (c.rnd(2) < 0.5) {
    // lantern next to the door
    const dp = doorPlacement(c.spec);
    if (dp.face === 'left') lantern(c.sc, dp.center + 0.45, b.v1 + 0.14, 24, LACQUER, GLOW_WARM, 2.6);
    addLight(c, dp.center + 0.45, b.v1 + 0.2, 20, 30, GLOW_WARM);
  }
  if (c.accent && c.rnd(3) < 0.35) {
    const f = P.flag(c.spec.accentCss ?? '#a8302a');
    c.sc.sprite(f.pb, f.ax, f.ay, c.w / 2, c.d / 2, c.sc.sy(0, 0, 0) * 0 + b.r.h(c.w / 2, c.d / 2) + 2);
  }
}

function inn(c: Ctx): void {
  const { sc, st, w, d } = c;
  const ins = 0.4;
  const u0 = ins;
  const u1 = w - ins;
  const v0 = ins;
  const v1 = d - ins;
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, 3);
  walls(sc, st, u0, v0, u1, v1, 3, 25, { kind: 'plaster', base: st.wall, post: 12, ruin: st.fallen ? 9 : 0 });
  const dp = doorPlacement(c.spec);
  door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.center, 0.72, 3, 19);
  windowsFor(c, u0, u1, v0, v1, 12, 7);
  // lower pent roof
  const lower = roof(sc, st, u0, v0, u1, v1, { zEave: 24, rise: 5, over: 0.42, up: 5, color: c.roofColor, holes: st.fallen ? 0.3 : 0, curve: 1 });
  // upper storey
  const iu0 = u0 + 0.7;
  const iu1 = u1 - 0.7;
  const iv0 = v0 + 0.7;
  const iv1 = v1 - 0.7;
  walls(sc, st, iu0, iv0, iu1, iv1, 27, 46, { kind: 'plaster', base: st.wall, post: 11, ruin: st.fallen ? 8 : 0 });
  windowsFor(c, iu0, iu1, iv0, iv1, 34, 8, GLOW_WARM, { round: true });
  const upper = roof(sc, st, iu0, iv0, iu1, iv1, { zEave: 46, rise: 17, over: 0.4, up: 6, color: c.roofColor, ridge: c.accent ?? undefined, holes: st.fallen ? 0.3 : 0 });
  // balcony rail on the lower roof (inside the overhang)
  // lanterns at the lower eave corners
  if (!st.fallen) {
    lantern(sc, lower.R - 0.05, lower.B - 0.05, 22, LACQUER, GLOW_WARM, 3.2);
    lantern(sc, (lower.L + lower.R) / 2 - 0.9, lower.B - 0.05, 22, LACQUER, GLOW_WARM, 3);
    lantern(sc, (lower.L + lower.R) / 2 + 0.9, lower.B - 0.05, 22, LACQUER, GLOW_WARM, 3);
    lantern(sc, lower.R - 0.05, (lower.T + lower.B) / 2, 22, LACQUER, GLOW_WARM, 3);
    for (const [uu, vv] of [
      [lower.R, lower.B],
      [(lower.L + lower.R) / 2, lower.B],
      [lower.R, (lower.T + lower.B) / 2],
    ])
      addLight(c, uu, vv, 18, 34, GLOW_WARM);
  }
  chimneyAt(c, u1 - 0.5, v0 + 0.5, upper.h, 13);
  // sign board over the door
  if (!st.fallen) {
    const bx = dp.face === 'left' ? dp.center : u1;
    const by = dp.face === 'left' ? v1 : dp.center;
    sc.blob(bx + (dp.face === 'left' ? 0 : 0.05), by + (dp.face === 'left' ? 0.05 : 0), 27, 5, 2.4, (nx, ny) => (Math.abs(nx) > 0.85 ? hex('#2c1c14') : ny < -0.3 ? LACQUER : LACQUER_D));
  }
  void upper;
}

function chimneyAt(c: Ctx, u: number, v: number, h: (u: number, v: number) => number, up: number): void {
  chimney(c, u, v, h, up);
}

function smithy(c: Ctx): void {
  const { sc, st, w, d } = c;
  const ins = 0.4;
  const u0 = ins;
  const u1 = w - ins;
  const v0 = ins;
  const v1 = d - ins;
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, 5, scale(st.stone, 0.92));
  walls(sc, st, u0, v0, u1, v1, 5, 29, { kind: 'dark', base: hex('#5a4a40'), post: 0, ruin: st.fallen ? 10 : 0 });
  // forge opening on the front-left face
  const dp = doorPlacement(c.spec);
  const cu = dp.face === 'left' ? dp.center : w / 2;
  const openL = Math.max(u0 + 0.2, cu - 0.62);
  const openR = Math.min(u1 - 0.2, cu + 0.62);
  const dark = (_s: number, t: number, lit: number): Col => scale(mix(hex('#1c1214'), hex('#4a2418'), Math.max(0, 1 - t / 8)), Math.min(1, lit));
  sc.left(openL, openR, v1, 5, 22, 1, dark, false, 1.5);
  const fire: (s: number, t: number) => Col = (s, t) => {
    if (t > 10) return 0;
    const f = Math.sin(s * 0.6) * 0.5 + 0.5;
    return t < 4 + f * 3 ? rgba(255, 150 + (f * 70) | 0, 40) : t < 7 + f * 2 ? rgba(255, 90, 24) : rgba(150, 40, 20);
  };
  sc.left(openL + 0.15, openR - 0.15, v1, 5, 15, 1, (s, t) => fire(s, t) || 0, true, 2);
  // opening frame
  const frame = (_s: number, _t: number, lit: number): Col => scale(st.timber, Math.min(1.1, lit));
  sc.left(openL - 0.07, openL, v1, 5, 23, 1, frame, false, 2.5);
  sc.left(openR, openR + 0.07, v1, 5, 23, 1, frame, false, 2.5);
  sc.left(openL - 0.07, openR + 0.07, v1, 22, 25, 1, frame, false, 2.5);
  addLight(c, cu, v1 + 0.2, 12, 52, GLOW_FIRE);
  // roof (dark slate, low)
  const ro = roof(sc, st, u0, v0, u1, v1, { zEave: 29, rise: 15, over: 0.36, up: 5, color: c.roofColor, ridge: scale(c.roofColor, 1.3), holes: st.fallen ? 0.34 : 0 });
  // tall chimney
  const cuh = u1 - 0.55;
  const cvh = v0 + 0.6;
  const cz = ro.h(cuh, cvh) - 3;
  const m = (s: number, t: number, lit: number, x: number, y: number): Col => scale(hf(x, y, 4) < 0.12 ? scale(st.stone, 0.78) : (t | 0) % 4 === 0 ? scale(st.stone, 0.7) : scale(st.stone, 0.95), Math.min(1.2, lit));
  sc.box(cuh - 0.17, cvh - 0.17, cz, cuh + 0.17, cvh + 0.17, cz + 24, (_u, _v, lit) => scale(hex('#3c3236'), lit), m, m);
  addSmoke(c, cuh, cvh, cz + 25, st.fallen ? 'smolder' : 'chimney');
  // props
  if (!st.fallen) {
    const a = P.anvil();
    sc.sprite(a.pb, a.ax, a.ay, cu + 0.9, v1 + 0.55, 0, 4);
    const b = P.barrel(1);
    sc.sprite(b.pb, b.ax, b.ay, u0 + 0.1, v1 + 0.45, 0, 4);
    const k = P.crate('#7a6a58', 2);
    sc.sprite(k.pb, k.ax, k.ay, u1 + 0.4, v1 - 0.2, 0, 4);
  }
}

function alchemy(c: Ctx): void {
  const { sc, st } = c;
  const g = GLOW_GREEN;
  const b = basic(c, { H: 30, post: 10, doorH: 20, wallBase: mix(st.wall, hex('#cfd8c0'), 0.5), glow: g, roof: { rise: 14, over: 0.4, up: 6 } });
  const dp = doorPlacement(c.spec);
  if (!st.fallen) {
    // green lanterns on the front eave
    for (const f of [-0.9, 0.9]) {
      lantern(sc, b.r.R * 0.0 + (dp.face === 'left' ? dp.center + f : b.u1 + 0.35), dp.face === 'left' ? b.r.B - 0.06 : dp.center + f, 22, hex('#2f7a4a'), g, 3);
      addLight(c, dp.face === 'left' ? dp.center + f : b.u1 + 0.35, dp.face === 'left' ? b.r.B : dp.center + f, 18, 34, g);
    }
    // hanging herb bundles
    for (let i = 0; i < 5; i++) {
      const hu = b.u0 + 0.35 + i * ((b.u1 - b.u0 - 0.7) / 4);
      const col = i % 2 ? hex('#6aa043') : hex('#a09a4a');
      for (let k = 0; k < 6; k++) sc.plot(hu, b.v1 + 0.22, 22 - k, k < 2 ? hex('#8a6a3a') : col);
      sc.plot(hu + 0.04, b.v1 + 0.22, 17, col);
      sc.plot(hu - 0.04, b.v1 + 0.22, 16, scale(col, 0.8));
    }
    const cz = P.cauldron(g);
    sc.sprite(cz.pb, cz.ax, cz.ay, b.u1 + 0.45, b.v1 + 0.15, 0, 4);
    addLight(c, b.u1 + 0.45, b.v1 + 0.15, 8, 38, g);
    addSmoke(c, b.u1 + 0.45, b.v1 + 0.15, 12, 'alchemy');
    const urn = P.urn();
    sc.sprite(urn.pb, urn.ax, urn.ay, b.u0 + 0.2, b.v1 + 0.45, 0, 4);
  }
  chimneyAt(c, b.u1 - 0.5, b.v0 + 0.5, b.r.h, 10);
}

function farmhouse(c: Ctx): void {
  const { sc, st } = c;
  const b = basic(c, { H: 26, post: 0, doorH: 19, wallBase: mix(st.wall, hex('#cdbd97'), 0.5), wallKind: 'plaster', roof: { rise: 15, over: 0.42, up: 3, thatch: true, color: hex('#b89a58'), curve: 1.1, ridge: undefined } });
  if (!st.fallen) {
    const h = P.haystack();
    sc.sprite(h.pb, h.ax, h.ay, b.u1 + 0.35, b.v1 + 0.2, 0, 4);
    const hb = P.haybale();
    sc.sprite(hb.pb, hb.ax, hb.ay, b.u0 + 0.3, b.v1 + 0.45, 0, 4);
  }
  chimneyAt(c, b.u0 + 0.6, b.v0 + 0.7, b.r.h, 8);
}

function herbHut(c: Ctx): void {
  const { sc, st } = c;
  const b = basic(c, { inset: 0.36, H: 17, wallKind: 'plank', wallBase: hex('#8a6a48'), post: 0, doorH: 13, doorW: 0.46, roof: { rise: 11, over: 0.34, up: 3, thatch: true, color: hex('#a88f50'), curve: 1.05 }, windowH: 5, glow: GLOW_GREEN });
  if (!st.fallen) {
    const r = P.herbRack();
    sc.sprite(r.pb, r.ax, r.ay, b.u1 + 0.3, b.v1 + 0.15, 0, 4);
    const s = P.sack();
    sc.sprite(s.pb, s.ax, s.ay, b.u0 + 0.2, b.v1 + 0.3, 0, 4);
  }
}

function barracks(c: Ctx): void {
  const { sc, st } = c;
  const b = basic(c, { H: 26, doorH: 19, wallKind: 'plank', wallBase: hex('#7a6850'), post: 0, timber: hex('#3e2a1e'), roof: { rise: 14, over: 0.38, up: 4, color: c.roofColor, ridge: scale(c.roofColor, 1.25) }, windowH: 5 });
  if (!st.fallen) {
    const col = c.spec.accentCss ?? '#a8302a';
    const fl = P.flag(col);
    sc.sprite(fl.pb, fl.ax, fl.ay, b.u0 - 0.1, b.v1 + 0.5, 0, 6);
    sc.sprite(fl.pb, fl.ax, fl.ay, b.u1 + 0.3, b.v0 + 0.5, 0, 6);
    const rk = P.weaponRack();
    sc.sprite(rk.pb, rk.ax, rk.ay, b.u1 + 0.3, b.v1 + 0.25, 0, 4);
    const dm = P.trainingDummy();
    sc.sprite(dm.pb, dm.ax, dm.ay, b.u0 + 0.7, b.v1 + 0.55, 0, 4);
  }
}

function warehouse(c: Ctx): void {
  const { sc, st, w, d } = c;
  const ins = 0.4;
  const u0 = ins;
  const u1 = w - ins;
  const v0 = ins;
  const v1 = d - ins;
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, 3);
  walls(sc, st, u0, v0, u1, v1, 3, 25, { kind: 'plank', base: hex('#85684a'), post: 0, ruin: st.fallen ? 9 : 0, timber: hex('#3e2a1e') });
  const dp = doorPlacement(c.spec);
  // big double door
  const at = dp.face === 'left' ? v1 : u1;
  door(sc, st, dp.face, at, dp.center, 1.0, 3, 20, hex('#5e4430'));
  windowsFor(c, u0, u1, v0, v1, 17, 4, GLOW_WARM);
  const ro = roof(sc, st, u0, v0, u1, v1, { zEave: 25, rise: 16, over: 0.36, up: 2, color: c.roofColor, gable: 'u', curve: 1, holes: st.fallen ? 0.3 : 0 });
  // gable end on the right face
  const R = ro.R - 0.015;
  const wallShade = (s: number, t: number, lit: number, x: number, y: number): Col => scale(hf(Math.floor(s / 3), 1, 4) < 0.3 ? scale(hex('#85684a'), 0.9) : hex('#85684a'), Math.min(1.1, lit)) | (hf(x, y, 1) < 0 ? 0 : 0);
  const seg = 10;
  for (let i = 0; i < seg; i++) {
    const va = ro.T + ((ro.B - ro.T) * i) / seg;
    const vb = ro.T + ((ro.B - ro.T) * (i + 1)) / seg;
    sc.quad([R, va, 24], [R, vb, 24], [R, vb, ro.h(R, vb) - 0.5], [R, va, ro.h(R, va) - 0.5], (vb - va) * AHW, 14, 0.7, wallShade);
  }
  if (!st.fallen) {
    const k = P.crate('#8a6840', 1);
    sc.sprite(k.pb, k.ax, k.ay, u1 + 0.3, v1 + 0.1, 0, 4);
    const k2 = P.crate('#7a5a38', 3);
    sc.sprite(k2.pb, k2.ax, k2.ay, u1 + 0.3, v1 - 0.55, 0, 4);
    const b = P.barrel(2);
    sc.sprite(b.pb, b.ax, b.ay, u0 + 0.2, v1 + 0.4, 0, 4);
    const sk = P.sack();
    sc.sprite(sk.pb, sk.ax, sk.ay, u0 + 0.6, v1 + 0.5, 0, 4);
  }
}

function teahouse(c: Ctx): void {
  const { sc, st, w, d } = c;
  const ins = 0.42;
  const u0 = ins;
  const u1 = w - ins;
  const v0 = ins;
  const v1 = d - ins;
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, 3);
  walls(sc, st, u0, v0, u1, v1, 3, 22, { kind: 'plaster', base: st.wall, post: 10, ruin: st.fallen ? 8 : 0, timber: hex('#7a2e2a') });
  const dp = doorPlacement(c.spec);
  door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.center, 0.62, 3, 17, hex('#7a3a2a'));
  windowsFor(c, u0, u1, v0, v1, 10, 7, GLOW_WARM, { round: true });
  const lower = roof(sc, st, u0, v0, u1, v1, { zEave: 22, rise: 5, over: 0.4, up: 5, color: c.roofColor, curve: 1, holes: st.fallen ? 0.3 : 0 });
  const iu0 = u0 + 0.45;
  const iu1 = u1 - 0.45;
  const iv0 = v0 + 0.45;
  const iv1 = v1 - 0.45;
  walls(sc, st, iu0, iv0, iu1, iv1, 24, 40, { kind: 'plaster', base: st.wall, post: 9, timber: hex('#7a2e2a'), ruin: st.fallen ? 8 : 0 });
  windowsFor(c, iu0, iu1, iv0, iv1, 29, 7, GLOW_WARM, { round: true });
  const up = roof(sc, st, iu0, iv0, iu1, iv1, { zEave: 40, rise: 16, over: 0.42, up: 7, color: c.roofColor, ridge: c.accent ?? undefined, holes: st.fallen ? 0.3 : 0 });
  if (!st.fallen) {
    lantern(sc, lower.R - 0.06, lower.B - 0.06, 20, LACQUER, GLOW_WARM, 3.2);
    lantern(sc, (lower.L + lower.R) / 2, lower.B - 0.06, 20, LACQUER, GLOW_WARM, 3);
    addLight(c, lower.R, lower.B, 16, 34, GLOW_WARM);
    addLight(c, (lower.L + lower.R) / 2, lower.B, 16, 34, GLOW_WARM);
    const fl = P.flag(c.spec.accentCss ?? '#d9b867');
    sc.sprite(fl.pb, fl.ax, fl.ay, lower.R + 0.1, lower.B + 0.1, 0, 6);
  }
  chimneyAt(c, iu1 - 0.3, iv0 + 0.4, up.h, 8);
}
