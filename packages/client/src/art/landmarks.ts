/**
 * Landmark and civic buildings: market, shrine, pagoda, hall, dojo, mine entrance, tower, gate, ruined house.
 * Split out of buildings.ts for size. Pure.
 */
import { AHW } from '../render/iso';
import { addLight, addSmoke, doorPlacement, windowsFor, type Ctx } from './bctx';
import { hex, mix, scale, type Col } from './color';
import { hf } from './draw';
import { LIT_LEFT, LIT_RIGHT, LIT_TOP, type Shader } from './mesh';
import { vnoise } from './mountain';
import {
  GLOW_FIRE,
  GLOW_WARM,
  GOLD,
  LACQUER,
  LACQUER_D,
  crenellate,
  door,
  flatShader,
  floorShader,
  lantern,
  lc,
  pillar,
  plinth,
  rail,
  roof,
  stairs,
  stoneTop,
  walls,
  wallShader,
  windowDecal,
} from './arch';
import * as P from './props';

const WOOD = hex('#6a4a32');
const WOOD_D = hex('#4a3322');

function awning(c: Ctx, u0: number, u1: number, v0: number, v1: number, zBack: number, zFront: number, a: Col, b: Col): void {
  const { sc, st } = c;
  const L = u0 - 0.08;
  const R = u1 + 0.08;
  const T = v0 - 0.08;
  const B = v1 + 0.1;
  const sh: Shader = (s, t, lit) => {
    const stripe = Math.floor(s / 4) & 1;
    return lc(stripe ? b : a, lit);
  };
  const wpx = (R - L) * AHW;
  sc.quad([L, T, zBack], [R, T, zBack], [R, B, zFront], [L, B, zFront], wpx, (B - T) * AHW, 1.0, (s, t, lit, x, y) => {
    const stripe = Math.floor(s / 4) & 1;
    let col = stripe ? b : a;
    if (hf(x, y, 3) < 0.05) col = scale(col, 0.9);
    return lc(col, lit);
  });
  void sh;
  // valance with scallops
  const val: Shader = (s, t, lit) => {
    const stripe = Math.floor(s / 4) & 1;
    const scallop = stripe ? 2.2 : 0.4;
    if (t < scallop) return 0;
    return lc(stripe ? b : a, lit * 0.95);
  };
  sc.quad([L, B, zFront - 4], [R, B, zFront - 4], [R, B, zFront], [L, B, zFront], wpx, 4, LIT_LEFT, val);
  sc.quad([R, T, zBack - 4 + 0], [R, B, zFront - 4], [R, B, zFront], [R, T, zBack], (B - T) * AHW, 4, LIT_RIGHT, (s, t, lit) => lc(scale(a, 0.85), lit));
  void st;
}

function stall(c: Ctx, u0: number, u1: number, v0: number, v1: number, a: Col, b: Col, goods: Col[]): void {
  const { sc, st } = c;
  // posts
  for (const [pu, pv] of [
    [u0 + 0.05, v0 + 0.05],
    [u1 - 0.05, v0 + 0.05],
    [u0 + 0.05, v1 - 0.03],
    [u1 - 0.05, v1 - 0.03],
  ])
    pillar(sc, st, pu, pv, 0, 23, WOOD, 0.05);
  // counter
  const cw: Shader = wallShader(st, { kind: 'plank', base: hex('#8a6a46'), H: 8, eave: 0 });
  sc.box(u0 + 0.12, v1 - 0.42, 0, u1 - 0.12, v1 - 0.1, 8, floorShader(st, hex('#9a7a50')), cw, wallShader(st, { kind: 'plank', base: hex('#8a6a46'), H: 8, eave: 0, off: 4 }));
  // goods
  const n = Math.max(3, Math.round((u1 - u0) * 5));
  for (let i = 0; i < n; i++) {
    const gu = u0 + 0.22 + ((u1 - u0 - 0.44) * (i + 0.5)) / n;
    const gc = goods[i % goods.length];
    sc.blob(gu, v1 - 0.26, 10.5, 1.8, 1.7, (nx, ny) => (nx < -0.2 && ny < 0 ? scale(gc, 1.25) : ny > 0.4 ? scale(gc, 0.75) : gc));
  }
  // back shelf
  sc.box(u0 + 0.15, v0 + 0.1, 0, u1 - 0.15, v0 + 0.3, 14, flatShader(hex('#7a5a3a')), wallShader(st, { kind: 'plank', base: hex('#6a4a2e'), H: 14, eave: 0 }), wallShader(st, { kind: 'plank', base: hex('#6a4a2e'), H: 14, eave: 0, off: 2 }));
  awning(c, u0, u1, v0, v1, 27, 21, a, b);
  lantern(sc, (u0 + u1) / 2, v1 + 0.06, 20, LACQUER, GLOW_WARM, 2.6);
  addLight(c, (u0 + u1) / 2, v1 + 0.1, 16, 26, GLOW_WARM);
}

export function market(c: Ctx): void {
  const cream = hex('#efe6d0');
  const cols: Col[][] = [
    [LACQUER, cream],
    [hex('#3b6bb2'), cream],
    [hex('#c29a38'), cream],
    [hex('#3e8a66'), cream],
    [hex('#8b4ba9'), cream],
    [hex('#d97a2b'), cream],
  ];
  const goods = [hex('#d9532b'), hex('#7ec26b'), hex('#e0b44a'), hex('#c8452d'), hex('#efe6d0')];
  const { w, d } = c;
  const back: [number, number][] = [];
  const nB = Math.max(2, Math.round((w - 0.3) / 1.2));
  for (let i = 0; i < nB; i++) back.push([0.2 + ((w - 0.4) * i) / nB + 0.05, 0.2 + ((w - 0.4) * (i + 1)) / nB - 0.05]);
  let k = 0;
  for (const [a, b] of back) {
    const pal = cols[(k + c.spec.id) % cols.length];
    stall(c, a, b, 0.3, 1.35, pal[0], pal[1], goods.slice(k % 2));
    k++;
  }
  const front: [number, number][] = [
    [0.45, 1.85],
    [2.1, w - 0.45],
  ];
  for (const [a, b] of front) {
    const pal = cols[(k + c.spec.id) % cols.length];
    stall(c, a, b, d - 1.35, d - 0.3, pal[0], pal[1], goods.slice((k + 1) % 3));
    k++;
  }
  if (!c.st.fallen) {
    const s = P.sack();
    c.sc.sprite(s.pb, s.ax, s.ay, 0.35, d - 0.1, 0, 4);
    const b = P.barrel(3);
    c.sc.sprite(b.pb, b.ax, b.ay, w - 0.3, d - 0.1, 0, 4);
    const kr = P.crate('#9a7a48', 2);
    c.sc.sprite(kr.pb, kr.ax, kr.ay, w - 0.25, 1.55, 0, 4);
  }
}

export function shrine(c: Ctx): void {
  const { sc, st, w, d } = c;
  // small sanctuary at the back
  plinth(sc, st, 0.4, 0.2, w - 0.4, 1.05, 3, scale(st.stone, 1.05));
  walls(sc, st, 0.52, 0.3, w - 0.52, 0.95, 3, 16, { kind: 'plaster', base: mix(LACQUER, st.wall, 0.15), post: 8, timber: LACQUER_D, ruin: st.fallen ? 6 : 0 });
  door(sc, st, 'left', 0.95, w / 2, 0.6, 3, 17, hex('#7a3a2a'));
  const ro = roof(sc, st, 0.52, 0.3, w - 0.52, 0.95, { zEave: 16, rise: 9, over: 0.24, up: 4, color: hex('#3c3a44'), ridge: LACQUER, holes: st.fallen ? 0.3 : 0 });
  void ro;
  addLight(c, w / 2, 1.0, 9, 26, GLOW_WARM);
  // torii gate
  const tv = d - 0.4;
  pillar(sc, st, 0.38, tv, 0, 30, LACQUER, 0.095);
  pillar(sc, st, w - 0.38, tv, 0, 30, LACQUER, 0.095);
  const beam = (shade: number): Shader => (s, t, lit, x, y) => lc(scale(hf(x, y, 2) < 0.06 ? LACQUER_D : LACQUER, shade), lit);
  sc.box(0.22, tv - 0.07, 21, w - 0.22, tv + 0.07, 24, flatShader(LACQUER, st, 0), beam(1), beam(0.9));
  sc.box(0.05, tv - 0.12, 29, w - 0.05, tv + 0.12, 32.5, (_u, _v, lit) => lc(hex('#2a2428'), lit), beam(0.85), beam(0.7));
  sc.box(0.0, tv - 0.12, 32.5, w, tv + 0.12, 34, (_u, _v, lit) => lc(hex('#26202a'), lit), (s, t, lit) => lc(hex('#2a2428'), lit), (s, t, lit) => lc(hex('#1e181e'), lit));
  sc.box(w / 2 - 0.12, tv - 0.05, 24, w / 2 + 0.12, tv + 0.05, 29, (_u, _v, lit) => lc(GOLD, lit), (s, t, lit) => lc(GOLD, lit), (s, t, lit) => lc(scale(GOLD, 0.8), lit));
  if (!st.fallen) {
    const lan = P.stoneLantern();
    sc.sprite(lan.pb, lan.ax, lan.ay, w - 0.3, 1.25, 0, 4);
    sc.sprite(lan.pb, lan.ax, lan.ay, 0.3, 1.25, 0, 4);
    addLight(c, w - 0.3, 1.25, 16, 26, GLOW_WARM);
    addLight(c, 0.3, 1.25, 16, 26, GLOW_WARM);
  }
}

export function pagoda(c: Ctx): void {
  const { sc, st, w, d } = c;
  const cx = w / 2;
  const cy = d / 2;
  const n = 3 + (c.spec.id % 3);
  const dp = doorPlacement(c.spec);
  plinth(sc, st, 0.3, 0.3, w - 0.3, d - 0.3, 6, scale(st.stone, 1.06));
  stairs(sc, st, dp.face, dp.face === 'left' ? d - 0.3 : w - 0.3, dp.center, 1.3, 6, 3, 0.2);
  let z = 6;
  let lastRoof: ReturnType<typeof roof> | null = null;
  for (let i = 0; i < n; i++) {
    const hs = 1.5 - i * (0.78 / Math.max(2, n - 1));
    const u0 = cx - hs;
    const u1 = cx + hs;
    const v0 = cy - hs;
    const v1 = cy + hs;
    const wh = 15;
    walls(sc, st, u0, v0, u1, v1, z, z + wh, { kind: 'plaster', base: scale(st.wall, 1.02), post: 8, timber: LACQUER, ruin: st.fallen ? 6 : 0 });
    if (i === 0) door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.center, 0.8, z, 17, hex('#7a3a2a'));
    else {
      windowDecal(sc, st, 'left', v1, cx, 0.42, z + 5, 7, GLOW_WARM, true);
      windowDecal(sc, st, 'right', u1, cy, 0.42, z + 5, 7, GLOW_WARM, true);
    }
    const ro = roof(sc, st, u0, v0, u1, v1, { zEave: z + wh, rise: 9, over: 0.58 - i * 0.04, up: 6, color: c.roofColor, ridge: GOLD, holes: st.fallen ? 0.25 : 0, rows: 8 });
    lastRoof = ro;
    if (!st.fallen) {
      lantern(sc, ro.R - 0.04, ro.B - 0.04, z + wh - 1, LACQUER, GLOW_WARM, 2.8);
      lantern(sc, ro.L + 0.04, ro.B - 0.04, z + wh - 1, LACQUER, GLOW_WARM, 2.8);
      lantern(sc, ro.R - 0.04, ro.T + 0.04, z + wh - 1, LACQUER, GLOW_WARM, 2.8);
      if (i % 2 === 0) addLight(c, ro.R, ro.B, z + wh - 6, 38, GLOW_WARM);
    }
    // next tier starts at the roof surface under its front corner
    const hsn = 1.5 - (i + 1) * (0.78 / Math.max(2, n - 1));
    z = Math.min(ro.h(cx + hsn, cy + hsn), ro.h(cx - hsn, cy + hsn), ro.h(cx + hsn, cy - hsn)) - 1;
  }
  // finial
  if (lastRoof) {
    const top = lastRoof.h(cx, cy);
    for (let k = 0; k < 26; k++) sc.plot(cx, cy, top + k, k % 3 === 0 ? scale(GOLD, 0.8) : GOLD);
    for (let k = 0; k < 5; k++) sc.blob(cx, cy, top + 4 + k * 4, 3.2 - k * 0.45, 1.3, (nx) => (nx < -0.2 ? scale(GOLD, 1.15) : GOLD));
    sc.blob(cx, cy, top + 27, 1.2, 2.2, () => scale(GOLD, 1.2));
  }
}

export function hall(c: Ctx): void {
  const { sc, st, w, d } = c;
  const dp = doorPlacement(c.spec);
  plinth(sc, st, 0.12, 0.12, w - 0.12, d - 0.12, 7, scale(st.stone, 1.07));
  stairs(sc, st, dp.face, dp.face === 'left' ? d - 0.12 : w - 0.12, dp.center, 1.7, 7, 4, 0.18);
  const u0 = 0.8;
  const u1 = w - 0.8;
  const v0 = 0.85;
  const v1 = d - 0.95;
  walls(sc, st, u0, v0, u1, v1, 7, 32, { kind: 'plaster', base: scale(st.wall, 1.02), post: 10, timber: LACQUER_D, ruin: st.fallen ? 9 : 0 });
  door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.center, 0.95, 7, 21, hex('#7a2e2a'));
  windowsFor(c, u0, u1, v0, v1, 19, 8, GLOW_WARM, { wide: 0.5 });
  // porch pillars
  const nL = Math.max(3, Math.round((u1 - u0) / 0.7));
  for (let i = 0; i <= nL; i++) pillar(sc, st, u0 + ((u1 - u0) * i) / nL, v1 + 0.28, 7, 32, LACQUER, 0.085);
  const nR = Math.max(3, Math.round((v1 - v0) / 0.7));
  for (let i = 1; i <= nR; i++) pillar(sc, st, u1 + 0.28, v0 + ((v1 - v0) * i) / nR, 7, 32, LACQUER, 0.085);
  sc.box(u0 - 0.05, v1 + 0.22, 29, u1 + 0.33, v1 + 0.34, 33, flatShader(LACQUER, st, 0), (s, t, lit) => lc(LACQUER, lit), (s, t, lit) => lc(LACQUER_D, lit));
  sc.box(u1 + 0.22, v0 - 0.05, 29, u1 + 0.34, v1 + 0.34, 33, flatShader(LACQUER, st, 0), (s, t, lit) => lc(LACQUER, lit), (s, t, lit) => lc(LACQUER_D, lit));
  const lower = roof(sc, st, u0 - 0.2, v0 - 0.2, u1 + 0.2, v1 + 0.2, { zEave: 34, rise: 8, over: 0.55, up: 7, color: c.roofColor, ridge: GOLD, holes: st.fallen ? 0.3 : 0, curve: 1.05 });
  // upper storey drum
  const iu0 = u0 + 0.7;
  const iu1 = u1 - 0.7;
  const iv0 = v0 + 0.9;
  const iv1 = v1 - 0.9;
  walls(sc, st, iu0, iv0, iu1, iv1, 38, 51, { kind: 'plaster', base: scale(st.wall, 1.04), post: 9, timber: LACQUER_D, ruin: st.fallen ? 7 : 0 });
  windowDecal(sc, st, 'left', iv1, (iu0 + iu1) / 2, 0.6, 42, 6, GLOW_WARM, true);
  const upper = roof(sc, st, iu0, iv0, iu1, iv1, { zEave: 51, rise: 17, over: 0.55, up: 8, color: c.roofColor, ridge: GOLD, holes: st.fallen ? 0.3 : 0, rows: 8 });
  void upper;
  if (!st.fallen) {
    for (let i = 0; i < 4; i++) {
      const lu = lower.L + 0.1 + ((lower.R - lower.L - 0.2) * i) / 3;
      lantern(sc, lu, lower.B - 0.06, 32, LACQUER, GLOW_WARM, 3.2);
      addLight(c, lu, lower.B, 28, 36, GLOW_WARM);
    }
    const fl = P.flag(c.spec.accentCss ?? '#a8302a');
    sc.sprite(fl.pb, fl.ax, fl.ay, dp.face === 'left' ? dp.center - 1.2 : w - 0.1, dp.face === 'left' ? d - 0.1 : dp.center - 1.2, 0, 6);
    sc.sprite(fl.pb, fl.ax, fl.ay, dp.face === 'left' ? dp.center + 1.2 : w - 0.1, dp.face === 'left' ? d - 0.1 : dp.center + 1.2, 0, 6);
    const sl = P.stoneLantern();
    sc.sprite(sl.pb, sl.ax, sl.ay, w - 0.35, d - 0.35, 0, 4);
    sc.sprite(sl.pb, sl.ax, sl.ay, 0.35, d - 0.35, 0, 4);
  }
}

export function dojo(c: Ctx): void {
  const { sc, st, w, d } = c;
  const dp = doorPlacement(c.spec);
  const side = (off: number): Shader => wallShader(st, { kind: 'plank', base: hex('#8a6a46'), H: 5, eave: 0, off });
  sc.box(0.3, 0.3, 0, w - 0.3, d - 0.3, 5, floorShader(st, hex('#a8885a')), side(0), side(5));
  stairs(sc, st, dp.face, dp.face === 'left' ? d - 0.3 : w - 0.3, dp.center, 1.4, 5, 3, 0.2);
  // back walls (interior)
  const back = wallShader(st, { kind: 'plank', base: hex('#7a5c3c'), H: 21, eave: 4 });
  sc.left(0.4, w - 0.4, 0.6, 5, 28, LIT_LEFT * 0.95, back);
  sc.right(0.4, d - 0.4, 0.6, 5, 28, LIT_RIGHT * 0.95, wallShader(st, { kind: 'plank', base: hex('#7a5c3c'), H: 21, eave: 4, off: 3 }));
  // posts and beams
  const posts: [number, number][] = [
    [0.5, 0.5],
    [w - 0.5, 0.5],
    [0.5, d - 0.5],
    [w - 0.5, d - 0.5],
    [w / 2, d - 0.5],
    [w - 0.5, d / 2],
    [0.5, d / 2],
    [w / 2, 0.5],
  ];
  for (const [pu, pv] of posts) pillar(sc, st, pu, pv, 5, 30, hex('#7a2e2a'), 0.09);
  const beam = (k: number): Shader => (s, t, lit) => lc(scale(hex('#5a2a24'), k), lit);
  sc.box(0.4, d - 0.57, 27, w - 0.4, d - 0.43, 30.5, flatShader(hex('#7a2e2a'), st, 0), beam(1), beam(0.9));
  sc.box(w - 0.57, 0.4, 27, w - 0.43, d - 0.4, 30.5, flatShader(hex('#7a2e2a'), st, 0), beam(1), beam(0.9));
  roof(sc, st, 0.4, 0.4, w - 0.4, d - 0.4, { zEave: 30, rise: 16, over: 0.5, up: 7, color: c.roofColor, ridge: c.accent ? c.accent : hex('#d9b867'), holes: st.fallen ? 0.3 : 0, rows: 8 });
  if (!st.fallen) {
    const dm = P.trainingDummy();
    sc.sprite(dm.pb, dm.ax, dm.ay, 1.3, d - 1.2, 5, 5);
    sc.sprite(dm.pb, dm.ax, dm.ay, 2.4, d - 1.0, 5, 5);
    const rk = P.weaponRack();
    sc.sprite(rk.pb, rk.ax, rk.ay, w - 1.2, 1.0, 5, 5);
    for (const [lu, lv] of [
      [0.5, d - 0.45],
      [w - 0.5, d - 0.45],
      [w - 0.45, 0.5],
    ]) {
      lantern(sc, lu, lv, 27, LACQUER, GLOW_WARM, 3.2);
      addLight(c, lu, lv, 22, 36, GLOW_WARM);
    }
  }
}

export function mineEntrance(c: Ctx): void {
  const { sc, st } = c;
  const rock = (u: number, v: number, lit: number, x: number, y: number): Col => {
    const n = hf(x, y, 5);
    const base = vnoise(u * 5, v * 5, 4) > 0.55 ? hex('#7d7872') : hex('#69656c');
    let col = n < 0.12 ? scale(base, 0.8) : n > 0.9 ? scale(base, 1.15) : base;
    if (st.season === 3 && lit > 0.9 && hf(x, y, 7) < 0.7) col = hex('#e6edf6');
    return lc(col, lit);
  };
  const h = (u: number, v: number): number => 3 + 22 * Math.pow(1 - v, 1.15) * (0.7 + 0.3 * Math.sin(u * 4)) + (vnoise(u * 3, v * 3, 12) - 0.5) * 3;
  sc.heightfield(0, 0, 1, 1, 6, 6, h, (u, v, lit, x, y) => rock(u, v, lit, x, y));
  // timber frame
  const sh = (k: number): Shader => (s, t, lit) => lc(scale(WOOD, k), lit);
  pillar(sc, st, 0.27, 0.84, 3, 18, WOOD, 0.05);
  pillar(sc, st, 0.73, 0.84, 3, 18, WOOD, 0.05);
  sc.box(0.2, 0.8, 18, 0.8, 0.88, 21, flatShader(WOOD, st, 0), sh(1), sh(0.85));
  // dark opening
  sc.left(0.3, 0.7, 0.86, 3, 18, LIT_LEFT, (s, t, lit) => scale(mix(hex('#0b080e'), hex('#241a24'), Math.min(1, t / 20)), 1), false, 1);
  if (!st.fallen) {
    lantern(sc, 0.5, 0.87, 19, hex('#7a3a2a'), GLOW_FIRE, 2.2);
    addLight(c, 0.5, 0.95, 14, 30, GLOW_FIRE);
  }
  // rails and a pile of ore
  for (let k = 0; k < 8; k++) {
    sc.plot(0.4, 0.9 + k * 0.05, 3, hex('#4a4850'));
    sc.plot(0.6, 0.9 + k * 0.05, 3, hex('#4a4850'));
  }
  for (let k = 0; k < 4; k++) sc.plot(0.86, 0.9 + k * 0.025, 3.5 + (k % 2), k % 2 ? hex('#a0a8b8') : hex('#6a6e7c'));
}

export function tower(c: Ctx): void {
  const { sc, st, w, d } = c;
  const dp = doorPlacement(c.spec);
  const u0 = 0.28;
  const u1 = w - 0.28;
  const v0 = 0.28;
  const v1 = d - 0.28;
  const ss = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.98), H: 46, eave: 0, off });
  sc.box(u0 - 0.06, v0 - 0.06, 0, u1 + 0.06, v1 + 0.06, 5, stoneTop(st, st.stone), wallShader(st, { kind: 'stone', base: scale(st.stone, 0.9), H: 5, eave: 0 }), wallShader(st, { kind: 'stone', base: scale(st.stone, 0.9), H: 5, eave: 0, off: 4 }));
  sc.box(u0, v0, 5, u1, v1, 46, stoneTop(st, scale(st.stone, 1.05)), ss(0), ss(6));
  door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.face === 'left' ? Math.min(Math.max(dp.center, u0 + 0.5), u1 - 0.5) : Math.min(Math.max(dp.center, v0 + 0.5), v1 - 0.5), 0.7, 5, 20, hex('#4a3a30'));
  for (const zz of [27, 37]) {
    windowDecal(sc, { ...st, timber: hex('#2c2830') }, 'left', v1, (u0 + u1) / 2, 0.22, zz, 7, GLOW_WARM);
    windowDecal(sc, { ...st, timber: hex('#2c2830') }, 'right', u1, (v0 + v1) / 2, 0.22, zz, 7, GLOW_WARM);
  }
  // machicolation ring + crenels
  sc.box(u0 - 0.1, v0 - 0.1, 44, u1 + 0.1, v1 + 0.1, 48, stoneTop(st, scale(st.stone, 1.1)), ss(1), ss(7));
  crenellate(sc, st, u0 - 0.1, v0 - 0.1, u1 + 0.1, v1 + 0.1, 48, 3);
  // watch pavilion
  for (const [pu, pv] of [
    [u0 + 0.3, v0 + 0.3],
    [u1 - 0.3, v0 + 0.3],
    [u0 + 0.3, v1 - 0.3],
    [u1 - 0.3, v1 - 0.3],
  ])
    pillar(sc, st, pu, pv, 48, 60, WOOD, 0.05);
  const ro = roof(sc, st, u0 + 0.2, v0 + 0.2, u1 - 0.2, v1 - 0.2, { zEave: 60, rise: 11, over: 0.4, up: 5, color: c.roofColor, ridge: c.accent ?? undefined, holes: st.fallen ? 0.3 : 0 });
  if (!st.fallen) {
    const fl = P.flag(c.spec.accentCss ?? '#a8302a');
    sc.sprite(fl.pb, fl.ax, fl.ay, (u0 + u1) / 2, (v0 + v1) / 2, ro.h((u0 + u1) / 2, (v0 + v1) / 2), 6);
    addLight(c, (u0 + u1) / 2, v1 + 0.1, 56, 30, GLOW_FIRE);
    lantern(sc, u1 - 0.2, v1 + 0.02, 59, LACQUER, GLOW_WARM, 2.6);
  }
}

export function gate(c: Ctx): void {
  const { sc, st, w, d } = c;
  const alongU = w >= d;
  const ss = (off: number): Shader => wallShader(st, { kind: 'stone', base: st.stone, H: 36, eave: 0, off });
  if (alongU) {
    sc.box(0.1, 0.2, 0, 0.95, d - 0.2, 36, stoneTop(st, st.stone), ss(0), ss(5));
    sc.box(w - 0.95, 0.2, 0, w - 0.1, d - 0.2, 36, stoneTop(st, st.stone), ss(2), ss(7));
    sc.left(0.95, w - 0.95, d - 0.2, 0, 24, LIT_LEFT * 0.7, (s, t, lit) => lc(mix(hex('#0b080e'), hex('#2a2230'), Math.min(1, t / 26)), 1));
    sc.box(0.95, 0.2, 24, w - 0.95, d - 0.2, 36, stoneTop(st, st.stone), ss(1), ss(4));
    const gv = d - 0.2;
    // arch lintel front: dark underside curve is simulated by the opening top
    for (let i = 0; i < 8; i++) sc.plot(1 + ((w - 2) * i) / 8, gv + 0.01, 24 + 1, scale(st.stone, 0.7));
    const gu0 = 0.2;
    const gu1 = w - 0.2;
    walls(sc, st, gu0 + 0.2, 0.4, gu1 - 0.2, d - 0.4, 36, 46, { kind: 'plaster', base: st.wall, post: 10, ruin: st.fallen ? 6 : 0 });
    windowDecal(sc, st, 'left', d - 0.4, w / 2, 0.5, 38, 6, GLOW_WARM);
    roof(sc, st, gu0 + 0.2, 0.4, gu1 - 0.2, d - 0.4, { zEave: 46, rise: 14, over: 0.45, up: 6, color: c.roofColor, ridge: c.accent ?? undefined, holes: st.fallen ? 0.3 : 0 });
    if (!st.fallen) {
      lantern(sc, 0.6, d - 0.1, 34, LACQUER, GLOW_WARM, 3);
      lantern(sc, w - 0.6, d - 0.1, 34, LACQUER, GLOW_WARM, 3);
      addLight(c, 0.6, d, 28, 34, GLOW_WARM);
      addLight(c, w - 0.6, d, 28, 34, GLOW_WARM);
    }
  } else {
    sc.box(0.2, 0.1, 0, d * 0 + w - 0.2, 0.95, 36, stoneTop(st, st.stone), ss(0), ss(5));
    sc.box(0.2, d - 0.95, 0, w - 0.2, d - 0.1, 36, stoneTop(st, st.stone), ss(2), ss(7));
    walls(sc, st, 0.4, 0.2, w - 0.4, d - 0.2, 36, 46, { kind: 'plaster', base: st.wall, post: 10 });
    roof(sc, st, 0.4, 0.2, w - 0.4, d - 0.2, { zEave: 46, rise: 14, over: 0.45, up: 6, color: c.roofColor });
  }
}

export function ruinedHouse(c: Ctx): void {
  const { sc, st, w, d } = c;
  const u0 = 0.42;
  const u1 = w - 0.42;
  const v0 = 0.42;
  const v1 = d - 0.42;
  plinth(sc, st, u0 - 0.08, v0 - 0.08, u1 + 0.08, v1 + 0.08, 3, scale(st.stone, 0.85));
  walls(sc, st, u0, v0, u1, v1, 3, 26, { kind: 'plaster', base: mix(st.wall, st.soot, 0.35), post: 11, ruin: 16, eave: 0 });
  // dark doorway and dead windows
  const dp = doorPlacement(c.spec);
  door(sc, st, dp.face, dp.face === 'left' ? v1 : u1, dp.center, 0.7, 3, 18);
  windowsFor(c, u0, u1, v0, v1, 12, 7);
  // broken roof: mostly gone
  const ro = roof(sc, st, u0, v0, u1, v1, { zEave: 26, rise: 14, over: 0.32, up: 2, color: c.roofColor, holes: 0.62, rows: 7 });
  void ro;
  // charred beams
  const beam = (s: number, t: number, lit: number, x: number, y: number): Col => lc(hf(x, y, 4) < 0.3 ? hex('#16110f') : hex('#2a2018'), lit);
  sc.box(u0 + 0.1, v0 + 0.3, 20, u1 - 0.2, v0 + 0.42, 24, flatShader(hex('#2a2018'), st, 0), beam, beam);
  sc.box(u0 + 0.4, v0 + 0.2, 14, u0 + 0.55, v1 - 0.5, 18, flatShader(hex('#2a2018'), st, 0), beam, beam);
  sc.box(u1 - 0.7, v0 + 0.4, 10, u1 - 0.55, v1 - 0.2, 14, flatShader(hex('#2a2018'), st, 0), beam, beam);
  // rubble
  for (let i = 0; i < 9; i++) {
    const ru = u0 - 0.1 + c.rnd(i) * (u1 - u0 + 0.2);
    const rv = v1 - 0.1 + c.rnd(i + 20) * 0.5;
    const s = 0.1 + c.rnd(i + 40) * 0.1;
    const stn: Shader = (_s, _t, lit, x, y) => lc(hf(x, y, 3) < 0.2 ? scale(st.stone, 0.7) : scale(st.stone, 0.9), lit);
    sc.box(ru, rv, 0, ru + s, rv + s, 3 + c.rnd(i + 60) * 4, stoneTop(st, scale(st.stone, 0.85)), stn, stn);
  }
  // overgrowth
  for (let i = 0; i < 24; i++) {
    const side = i % 2;
    const pos = c.rnd(i + 80);
    const gu = side ? u1 + 0.02 : u0 + pos * (u1 - u0);
    const gv = side ? v0 + pos * (v1 - v0) : v1 + 0.02;
    const gz = 3 + c.rnd(i + 100) * 14;
    sc.plot(gu, gv, gz, hex(i % 3 ? '#3d6a30' : '#5a8a3a'));
    sc.plot(gu, gv, gz - 1, hex('#2f5428'));
  }
  addSmoke(c, w / 2, d / 2, 18, 'smolder');
  void LIT_TOP;
  void LIT_RIGHT;
  void rail;
  void GLOW_FIRE;
}
