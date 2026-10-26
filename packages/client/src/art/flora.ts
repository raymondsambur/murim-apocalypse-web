/**
 * Vegetation and small props: pine, oak, bamboo, boulder, bush, reeds, dead tree, bones, flowers, banner.
 * Every generator returns a pixel buffer plus the anchor (the ground point). Pure.
 *
 * Variants: `variant` (0..VARIANTS-1) picks the shape; `season` 0..3; `tier` is the Blight tier
 * (0 healthy, 1 sickly, 2 dead).
 */
import { O } from '@murim/shared';
import { corrupt, hex, mix, rgba, scale, type Col } from './color';
import { branch, groundShadow, hf, rampTone, shadedBlob, trunk, bayer } from './draw';
import { PixelBuffer } from './pixel';
import { ramp } from './palette';
import { stoneLantern, well } from './props';
import { genBanner as genSectBanner, genTrainingDummy, genWeaponRack } from './sectprops';

export interface ObjSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  /** False for sprites that should not be drawn at all (e.g. flowers in winter). */
  visible: boolean;
}

export const VARIANTS = 4;

const SNOW = hex('#f1f5fa');
const SNOW_D = hex('#c9d6e6');
const SNOW_DD = hex('#a4b4cc');

const WOOD = ramp('#6a4a32', 0.7, 1.25);
const WOOD_PALE = ramp('#8a6e50', 0.7, 1.2);
const DEAD_WOOD = ramp('#6b5e56', 0.66, 1.25);

const PINE = ramp('#2f6a3d', 0.7, 1.35);
const PINE_AUTUMN = ramp('#3d6a38', 0.7, 1.3);

const OAK_SPRING = ramp('#82c04c', 0.74, 1.22);
const OAK_SUMMER = ramp('#3f8f3e', 0.7, 1.28);
const OAK_AUTUMN = [ramp('#d9792b', 0.72, 1.2), ramp('#b9432b', 0.72, 1.22), ramp('#e2a838', 0.74, 1.18), ramp('#c46a2b', 0.72, 1.2)];
const BUSH_SUMMER = ramp('#427f35', 0.7, 1.3);
const BUSH_SPRING = ramp('#78b445', 0.72, 1.25);
const BUSH_AUTUMN = ramp('#a8662c', 0.72, 1.25);

const ROCK = ramp('#8a867f', 0.66, 1.25);
const BLIGHT_TINT = rgba(60, 30, 78);

function snowCap(pb: PixelBuffer, depth: number, seed: number, prob = 0.92): void {
  // Replace the first `depth` opaque pixels of every column (measured from the top) with snow.
  for (let x = 0; x < pb.w; x++) {
    let run = 0;
    for (let y = 0; y < pb.h; y++) {
      const c = pb.px[y * pb.w + x];
      if (c >>> 24 < 200) {
        run = 0;
        continue;
      }
      if (run < depth && hf(x, y, seed) < prob) {
        const lit = hf(x + 3, y, seed + 1);
        pb.px[y * pb.w + x] = run === 0 ? SNOW : lit < 0.25 ? SNOW_D : SNOW;
        if (run === depth - 1) pb.px[y * pb.w + x] = x & 1 ? SNOW_D : SNOW;
      }
      run++;
      if (run >= depth) break;
    }
  }
}

/** Corrupt every opaque pixel by t (Blight tiers). */
function sicken(pb: PixelBuffer, t: number): void {
  pb.map((c) => corrupt(c, t));
}

function blightTint(pb: PixelBuffer, tier: number): void {
  if (tier === 1) sicken(pb, 0.5);
  else if (tier >= 2) sicken(pb, 0.85);
}

function finish(pb: PixelBuffer, ax: number, ay: number, tier: number, outline = true): ObjSprite {
  blightTint(pb, tier);
  if (outline) pb.outline();
  return { pb, ax, ay, visible: true };
}

// ---------------------------------------------------------------------------

export function genPine(variant: number, season: number, tier: number): ObjSprite {
  // about 3.5 persons tall (scale.ts): 6-7 tiers
  const W = 64;
  const H = 124;
  const pb = new PixelBuffer(W, H);
  const cx = 32;
  const ay = 116;
  const seed = 100 + variant;
  groundShadow(pb, cx + 5, ay + 1, 19, 5.5, 64);
  trunk(pb, cx, ay - 26, ay + 1, 3.5, 6, WOOD, seed);
  const n = 6 + (variant % 2);
  const SP = 14.2 - variant * 0.35;
  const hwBase = 19 + (variant === 2 ? 2 : 0);
  const rampP = season === 2 ? PINE_AUTUMN : PINE;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hw = hwBase * (1 - 0.6 * t);
    const yBot = ay - 14 - i * SP;
    const lh = 25 - i * 2.5;
    const yTop = yBot - lh;
    for (let y = Math.floor(yTop); y <= Math.ceil(yBot); y++) {
      const f = (y + 0.5 - yTop) / lh;
      if (f < 0 || f > 1) continue;
      const w = Math.max(0.6, hw * Math.pow(f, 0.9));
      for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
        const u = (x + 0.5 - cx) / w;
        if (Math.abs(u) > 1) continue;
        // scalloped skirt
        const scallop = 1.6 * Math.abs(Math.sin((x - cx) * 0.85 + i * 1.7));
        if (y + 0.5 > yBot - scallop + 0.6) continue;
        let v = 0.58 - 0.34 * u - 0.12 * Math.abs(u) * 0 + (hf(x, y, seed + i) - 0.5) * 0.22 + bayer(x, y) * 0.14;
        if (f > 0.62) v -= (f - 0.62) * 0.7;
        if (((x * 2 + y) & 3) === 0) v -= 0.1;
        if (u > 0.78) v -= 0.12;
        let c: Col = rampTone(rampP, v);
        if (season === 3 && f < 0.52 + (hf(x, y, 5) - 0.5) * 0.2) {
          // snow settles on the upper part of every tier, lit side brighter
          c = v > 0.5 ? SNOW : v > 0.32 ? SNOW_D : SNOW_DD;
        }
        pb.set(x, y, c);
      }
    }
  }
  // dark tip
  pb.set(cx, Math.floor(ay - 14 - (n - 1) * SP - (25 - (n - 1) * 2.5)) - 1, season === 3 ? SNOW : PINE.l);
  return finish(pb, cx, ay, tier);
}

export function genOak(variant: number, season: number, tier: number): ObjSprite {
  // about 3.3 persons tall (scale.ts): taller trunk and an anisotropic crown
  const W = 92;
  const H = 124;
  const pb = new PixelBuffer(W, H);
  const cx = 46;
  const ay = 110;
  const seed = 200 + variant;
  const KX = 1.45;
  const KY = 2.05;
  groundShadow(pb, cx + 6, ay + 1, 24, 6.5, 66);
  const trunkH = 41 + (variant % 2) * 4;
  trunk(pb, cx, ay - trunkH, ay + 1, 6, 9, WOOD, seed);
  // flared roots
  pb.set(cx - 5, ay, WOOD.d);
  pb.set(cx + 5, ay, WOOD.d);
  pb.set(cx - 6, ay, WOOD.dd);
  pb.set(cx + 6, ay, WOOD.dd);
  const topY = ay - trunkH;
  if (season === 3) {
    // bare crown: forking branches with snow on top
    const rr = (a: number, b: number): number => a + hf(variant, a * 7 + b, 9) * (b - a);
    const rx = (a: number, b: number): number => rr(a, b) * KX;
    const ry = (a: number, b: number): number => rr(a, b) * KY;
    const tips: [number, number][] = [];
    const main: [number, number, number, number][] = [
      [cx, topY, cx - rx(8, 15), topY - ry(14, 22)],
      [cx, topY, cx + rx(8, 15), topY - ry(14, 22)],
      [cx, topY + 3, cx - rx(14, 20), topY - ry(2, 8)],
      [cx, topY + 3, cx + rx(14, 20), topY - ry(2, 8)],
      [cx, topY - 2, cx + rx(-3, 3), topY - ry(22, 28)],
    ];
    for (const [x0, y0, x1, y1] of main) {
      branch(pb, x0, y0, x1, y1, 4, 1.4, WOOD);
      tips.push([x1, y1]);
      // twigs
      for (let k = 0; k < 3; k++) {
        const t = 0.45 + k * 0.2;
        const bx = x0 + (x1 - x0) * t;
        const by = y0 + (y1 - y0) * t;
        const dir = k % 2 ? 1 : -1;
        branch(pb, bx, by, bx + dir * rx(4, 8), by - ry(3, 7), 1.8, 1.1, WOOD);
      }
    }
    snowCap(pb, 2, seed, 0.85);
    return finish(pb, cx, ay, tier);
  }
  const base = season === 0 ? OAK_SPRING : OAK_SUMMER;
  const blobs: [number, number, number, number][] = [
    [-13 + (variant % 2) * 2, -6, 12, 9.5],
    [14 - (variant % 3), -7, 11.5, 9],
    [0, -12, 17, 13],
    [-5 - variant, -22, 11.5, 9.5],
    [8 + variant, -20, 10, 8.5],
  ];
  blobs.forEach(([dx, dy, rx, ry], i) => {
    const r = season === 2 ? OAK_AUTUMN[(variant + i) % OAK_AUTUMN.length] : base;
    shadedBlob(pb, cx + dx * KX, topY + dy * KY + 6, rx * KX, ry * KY, r, {
      seed: seed + i,
      speckle: season === 2 ? 0.18 : 0.14,
      accent:
        season === 0
          ? (x, y, v) => (v > 0.4 && hf(x, y, 77) < 0.045 ? (hf(x, y, 78) < 0.5 ? hex('#f7c6d9') : hex('#ffffff')) : 0)
          : undefined,
    });
  });
  // fallen leaves under the tree in autumn
  if (season === 2) for (let k = 0; k < 9; k++) pb.set(cx - 20 + Math.floor(hf(variant, k, 3) * 40), ay - 1 + Math.floor(hf(variant, k, 4) * 5), OAK_AUTUMN[k % 4].b);
  return finish(pb, cx, ay, tier);
}

export function genDeadTree(variant: number, season: number, tier: number): ObjSprite {
  // about 2.5 persons tall
  const W = 80;
  const H = 96;
  const pb = new PixelBuffer(W, H);
  const cx = 40;
  const ay = 88;
  const seed = 300 + variant;
  const DK = 1.6;
  groundShadow(pb, cx + 5, ay + 1, 15, 4.5, 56);
  const lean = (hf(variant, 1, 1) - 0.5) * 12;
  const topX = cx + lean;
  const topY = ay - 52 - variant * 3;
  branch(pb, cx, ay + 1, topX, topY, 8, 3.5, DEAD_WOOD);
  const rr = (a: number, b: number, s: number): number => a + hf(variant, s, 11) * (b - a);
  const br: [number, number, number, number, number][] = [
    [0.45, -rr(8, 15, 1) * DK, -rr(8, 14, 2) * DK, 4, 1.4],
    [0.6, rr(8, 15, 3) * DK, -rr(7, 13, 4) * DK, 4, 1.4],
    [0.78, -rr(6, 11, 5) * DK, -rr(6, 10, 6) * DK, 3, 1.2],
    [0.9, rr(4, 9, 7) * DK, -rr(6, 11, 8) * DK, 2.4, 1.1],
    [0.3, rr(7, 12, 9) * DK, -rr(3, 7, 10) * DK, 3.2, 1.4],
  ];
  for (const [t, dx, dy, w0, w1] of br) {
    const bx = cx + (topX - cx) * t;
    const by = ay + (topY - ay) * t;
    branch(pb, bx, by, bx + dx, by + dy, w0, w1, DEAD_WOOD);
    branch(pb, bx + dx, by + dy, bx + dx * 1.4, by + dy * 1.5, 1.2, 1, DEAD_WOOD);
  }
  if (season === 3) snowCap(pb, 2, seed, 0.8);
  // hollow knot
  for (let i = 0; i < 4; i++) pb.set(cx - 1, ay - 12 - i, DEAD_WOOD.dd);
  if (tier >= 1) {
    sicken(pb, 0.3);
  }
  pb.outline();
  return { pb, ax: cx, ay, visible: true };
}

export function genBamboo(variant: number, season: number, tier: number): ObjSprite {
  // about 3.4 persons tall (stalks 75-110 px)
  const W = 60;
  const H = 134;
  const pb = new PixelBuffer(W, H);
  const cx = 30;
  const ay = 126;
  const seed = 400 + variant;
  groundShadow(pb, cx + 4, ay + 1, 17, 5, 56);
  const stalkR = season === 2 ? ramp('#9bb04a', 0.72, 1.2) : season === 3 ? ramp('#8fb07a', 0.72, 1.2) : ramp('#5aa044', 0.7, 1.25);
  const leafR = season === 2 ? ramp('#c9b83a', 0.7, 1.2) : season === 3 ? ramp('#7fa078', 0.7, 1.2) : season === 0 ? ramp('#86c456', 0.72, 1.22) : ramp('#3f8f3c', 0.7, 1.28);
  const n = 4 + (variant % 3);
  for (let k = 0; k < n; k++) {
    const ox = Math.round((k - (n - 1) / 2) * 6 + (hf(variant, k, 1) - 0.5) * 3);
    const h = 70 + hf(variant, k, 2) * 34;
    const lean = (hf(variant, k, 3) - 0.5) * 9;
    const x0 = cx + ox;
    const baseY = ay + (k % 2) * 2;
    const topY = baseY - h;
    // stalk
    for (let y = Math.floor(topY); y <= baseY; y++) {
      const t = (y - topY) / h;
      const x = Math.round(x0 + lean * (1 - t));
      const node = (baseY - y) % 11 === 0;
      pb.set(x, y, node ? stalkR.l : stalkR.b);
      pb.set(x + 1, y, node ? stalkR.d : stalkR.d);
      if ((baseY - y) % 11 === 1) {
        pb.set(x, y, stalkR.dd);
        pb.set(x + 1, y, stalkR.dd);
      }
    }
    // leaves: clusters near the top and a couple down the stalk
    const clusters = [0, 0.14, 0.3];
    for (const ct of clusters) {
      const ly = topY + h * ct * 0.9 + 2;
      const lx = x0 + lean * (1 - ct * 0.9) ;
      const blades = ct === 0 ? 6 : 3;
      for (let b = 0; b < blades; b++) {
        const dir = b % 2 ? 1 : -1;
        const len = 8 + hf(variant, k * 9 + b, 5) * 6;
        const ang = (0.25 + hf(variant, k * 9 + b, 6) * 0.9) * (ct === 0 && b < 2 ? 0.4 : 1);
        let px = lx;
        let py = ly;
        for (let s = 0; s < len; s++) {
          px += dir * Math.cos(ang);
          py += Math.sin(ang) * 0.55 + (s > len * 0.5 ? 0.3 : -0.05);
          pb.set(px, py, s % 3 === 0 ? leafR.l : s > len - 2 ? leafR.d : leafR.b);
          if (s < len - 3 && s % 2 === 0) pb.set(px, py + 1, leafR.d);
        }
      }
    }
  }
  // grass tufts at the base
  for (let k = 0; k < 10; k++) pb.set(cx - 16 + Math.floor(hf(variant, k, 8) * 32), ay - Math.floor(hf(variant, k, 9) * 3), season === 3 ? SNOW : leafR.d);
  if (season === 3) snowCap(pb, 1, seed, 0.5);
  return finish(pb, cx, ay, tier);
}

export function genBoulder(variant: number, season: number, tier: number): ObjSprite {
  const W = 40;
  const H = 32;
  const pb = new PixelBuffer(W, H);
  const cx = 20;
  const ay = 27;
  const seed = 500 + variant;
  groundShadow(pb, cx + 3, ay, 14, 4.2, 66);
  const rx = 10 + variant * 1.5;
  const ry = 8 + (variant % 2) * 2.5;
  // irregular dome: ellipse with per-angle radius noise
  const cy = ay - ry + 2;
  for (let y = Math.floor(cy - ry - 2); y <= ay + 1; y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const ang = Math.atan2(dy, dx);
      const wob = 1 + 0.16 * Math.sin(ang * 3 + variant * 2.1) + 0.1 * Math.sin(ang * 5 + variant);
      const d2 = (dx * dx + dy * dy) / (wob * wob);
      if (d2 > 1 || y > ay + 1) continue;
      const nz = Math.sqrt(1 - d2);
      let v = 0.5 + 0.4 * (-dx * 0.55 - dy * 0.8) * (1 - nz * 0.3) + 0.12 * nz - 0.1;
      // facets
      v += (Math.floor((dx * 3 + dy * 2 + variant) * 1.4) % 2 ? 0.06 : -0.05) + (hf(x, y, seed) - 0.5) * 0.14 + bayer(x, y) * 0.12;
      let c = rampTone(ROCK, v);
      if (season !== 3 && v > 0.45 && dy < -0.1 && hf(x >> 1, y >> 1, seed + 3) < 0.4 && (season === 1 || season === 0)) c = rampTone(ramp('#4f7f3a'), v - 0.1); // moss
      pb.set(x, y, c);
    }
  }
  // cracks
  const cxk = cx + (variant - 1) * 2;
  pb.line(cxk, ay - ry - 1, cxk + 2, ay - ry + 4, ROCK.dd);
  pb.line(cxk + 2, ay - ry + 4, cxk + 1, ay - 3, ROCK.dd);
  if (season === 3) snowCap(pb, 3, seed, 0.9);
  return finish(pb, cx, ay, tier);
}

export function genBush(variant: number, season: number, tier: number): ObjSprite {
  const W = 32;
  const H = 26;
  const pb = new PixelBuffer(W, H);
  const cx = 16;
  const ay = 22;
  const seed = 600 + variant;
  groundShadow(pb, cx + 3, ay, 11, 3.5, 60);
  const r = season === 2 ? BUSH_AUTUMN : season === 0 ? BUSH_SPRING : BUSH_SUMMER;
  const blobs: [number, number, number, number][] = [
    [-6, -5, 7, 5.5],
    [6, -5, 7, 5.5],
    [0, -8, 8.5, 6.5],
  ];
  blobs.forEach(([dx, dy, rx, ry], i) =>
    shadedBlob(pb, cx + dx, ay + dy, rx, ry, season === 3 ? ramp('#6a7c58') : r, {
      seed: seed + i,
      speckle: 0.16,
      accent:
        season === 0
          ? (x, y, v) => (v > 0.4 && hf(x, y, 31) < 0.07 ? hex('#fbd0de') : 0)
          : season === 1 && variant % 2 === 0
            ? (x, y) => (hf(x, y, 32) < 0.04 ? hex('#d6364a') : 0)
            : undefined,
    }),
  );
  if (season === 3) snowCap(pb, 3, seed, 0.9);
  return finish(pb, cx, ay, tier);
}

export function genReeds(variant: number, season: number, tier: number): ObjSprite {
  const W = 28;
  const H = 40;
  const pb = new PixelBuffer(W, H);
  const cx = 14;
  const ay = 35;
  const seed = 700 + variant;
  const r = season === 3 ? ramp('#c8bfa0', 0.7, 1.15) : season === 2 ? ramp('#b79c55', 0.7, 1.2) : ramp('#7aa04a', 0.7, 1.25);
  const n = 7 + (variant % 3);
  for (let k = 0; k < n; k++) {
    const x0 = cx + Math.round((k - (n - 1) / 2) * 2.1 + (hf(variant, k, 1) - 0.5) * 1.5);
    const h = 12 + hf(variant, k, 2) * 9;
    const bend = (hf(variant, k, 3) - 0.5) * 7;
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const x = Math.round(x0 + bend * t * t);
      const yy = ay - y;
      pb.set(x, yy, t > 0.7 ? r.l : t > 0.3 ? r.b : r.d);
    }
    if (k % 3 === 0) {
      // cattail head
      const hx = Math.round(x0 + bend);
      for (let y = 0; y < 4; y++) {
        pb.set(hx, ay - Math.floor(h) - y + 1, hex('#6b4a2e'));
        pb.set(hx + 1, ay - Math.floor(h) - y + 1, hex('#4e3622'));
      }
    }
  }
  for (let k = 0; k < 6; k++) pb.set(cx - 9 + Math.floor(hf(variant, k, 5) * 18), ay + Math.floor(hf(variant, k, 6) * 3), season === 3 ? SNOW_D : r.dd);
  if (season === 3) snowCap(pb, 1, seed, 0.4);
  return finish(pb, cx, ay, tier);
}

const FLOWER_SETS: Col[][] = [
  [hex('#f6b3cf'), hex('#ffffff'), hex('#f5e27a'), hex('#e98ab8')],
  [hex('#f2c440'), hex('#e9573f'), hex('#ffffff'), hex('#a76bd6')],
  [hex('#c98a4a'), hex('#d7b25c'), hex('#b0603c'), hex('#8a7a58')],
];

export function genFlowers(variant: number, season: number, tier: number): ObjSprite {
  const W = 24;
  const H = 18;
  const pb = new PixelBuffer(W, H);
  const cx = 12;
  const ay = 14;
  if (season === 3) return { pb, ax: cx, ay, visible: false };
  const set = FLOWER_SETS[season === 0 ? 0 : season === 1 ? 1 : 2];
  const n = season === 2 ? 4 : 7;
  const stem = season === 2 ? hex('#8a7a4a') : hex('#4a9a3c');
  for (let k = 0; k < n; k++) {
    const x = cx - 8 + Math.floor(hf(variant, k, 1) * 16);
    const y = ay - Math.floor(hf(variant, k, 2) * 4);
    const h = 3 + Math.floor(hf(variant, k, 3) * 4);
    for (let i = 0; i < h; i++) pb.set(x, y - i, i % 2 ? stem : scale(stem, 0.8));
    pb.set(x - 1, y - 1, scale(stem, 0.9));
    pb.set(x + 1, y - 2, scale(stem, 1.1));
    const col = set[(k + variant) % set.length];
    const hy = y - h;
    pb.set(x, hy, season === 2 ? col : hex('#f5dc5a'));
    pb.set(x - 1, hy, col);
    pb.set(x + 1, hy, col);
    pb.set(x, hy - 1, col);
    if (season !== 2) pb.set(x, hy + 1, col);
  }
  blightTint(pb, tier);
  return { pb, ax: cx, ay, visible: true };
}

export function genBones(variant: number, season: number, tier: number): ObjSprite {
  const W = 32;
  const H = 18;
  const pb = new PixelBuffer(W, H);
  const cx = 16;
  const ay = 12;
  const bone = hex('#e6dfcc');
  const boneD = hex('#b8ae96');
  const boneDD = hex('#7d745f');
  groundShadow(pb, cx + 2, ay + 1, 10, 3, 46);
  // ribcage arcs
  for (let i = 0; i < 4; i++) {
    const x0 = cx - 8 + i * 3;
    for (let t = 0; t <= 1; t += 0.12) {
      const x = x0 + t * 5 * (variant % 2 ? -1 : 1);
      const y = ay - 1 - Math.sin(t * Math.PI) * 5;
      pb.set(x, y, t < 0.5 ? bone : boneD);
    }
  }
  pb.line(cx - 9, ay - 1, cx + 5, ay - 2, boneD); // spine
  // femur
  pb.line(cx + 3, ay + 1, cx + 11, ay - 2, bone);
  pb.set(cx + 11, ay - 3, bone);
  pb.set(cx + 11, ay - 1, bone);
  pb.set(cx + 3, ay, boneD);
  // skull
  const sx = cx + (variant % 2 ? -10 : 8);
  const sy = ay - 3;
  pb.ellipse(sx, sy, 3.2, 2.6, bone);
  pb.rect(sx - 2, sy + 2, 4, 2, boneD);
  pb.set(sx - 1, sy - 0, boneDD);
  pb.set(sx + 1, sy - 0, boneDD);
  pb.set(sx, sy + 2, boneDD);
  if (season === 3) snowCap(pb, 1, variant, 0.4);
  return finish(pb, cx, ay, tier);
}

/** Tall pole with a hanging cloth banner of the given colour (CSS hex). */
export function genBanner(variant: number, season: number, tier: number, colorCss = '#a8302a'): ObjSprite {
  const W = 24;
  const H = 62;
  const pb = new PixelBuffer(W, H);
  const cx = 11;
  const ay = 56;
  groundShadow(pb, cx + 3, ay + 1, 8, 2.6, 56);
  const cloth = ramp(colorCss, 0.7, 1.22);
  // pole
  for (let y = 4; y <= ay; y++) {
    pb.set(cx, y, WOOD.l);
    pb.set(cx + 1, y, WOOD.d);
  }
  pb.rect(cx - 3, 3, 8, 2, WOOD.b); // crossbar
  pb.set(cx - 3, 2, hex('#d9b867'));
  pb.set(cx + 4, 2, hex('#d9b867'));
  pb.rect(cx, 0, 2, 3, hex('#d9b867'));
  // banner cloth with swallow-tail
  const bx = cx - 2;
  for (let y = 5; y < 36; y++) {
    const w = 8;
    const wave = Math.sin(y * 0.35 + variant) * 0.7;
    for (let x = 0; x < w; x++) {
      if (y > 30 && Math.abs(x - w / 2 + 0.5) < (y - 30) * 0.7) continue; // notch
      const xx = Math.round(bx + x + wave);
      pb.set(xx, y, x < 2 ? cloth.l : x > w - 3 ? cloth.d : cloth.b);
    }
  }
  // emblem: simple gold disc with a dark core
  pb.ellipse(cx + 1.5, 15, 2.4, 2.4, hex('#d9b867'));
  pb.set(cx + 1, 15, cloth.dd);
  pb.set(cx + 2, 15, cloth.dd);
  pb.rect(bx, 5, 8, 1, cloth.dd);
  if (season === 3) snowCap(pb, 1, 3, 0.3);
  return finish(pb, cx, ay, tier);
}

/** Dispatch by object code. Returns null for codes without a sprite. */
export function genObject(code: number, variant: number, season: number, tier: number, banner?: string): ObjSprite | null {
  // Dead vegetation: fully blighted trees become dead trees.
  const dead = tier >= 2;
  switch (code) {
    case O.Pine:
      return dead ? genDeadTree(variant, season, 2) : genPine(variant, season, tier);
    case O.Oak:
      return dead ? genDeadTree((variant + 1) % VARIANTS, season, 2) : genOak(variant, season, tier);
    case O.Bamboo:
      return dead ? witherBamboo(variant, season) : genBamboo(variant, season, tier);
    case O.Boulder:
      return genBoulder(variant, season, tier);
    case O.Bush:
      return dead ? witherBush(variant, season) : genBush(variant, season, tier);
    case O.Reeds:
      return dead ? witherReeds(variant, season) : genReeds(variant, season, tier);
    case O.DeadTree:
      return genDeadTree(variant, season, tier);
    case O.Bones:
      return genBones(variant, season, tier);
    case O.Flowers:
      return dead ? witherFlowers(variant, season) : genFlowers(variant, season, tier);
    case O.Banner:
      return genBanner(variant, season, tier, banner);
    case O.Well: {
      const p = well();
      return { pb: p.pb, ax: p.ax, ay: p.ay, visible: true };
    }
    case O.Lantern: {
      const p = stoneLantern();
      return { pb: p.pb, ax: p.ax, ay: p.ay, visible: true };
    }
    // drill-yard furniture from `sectprops.ts`: one view per street axis, picked by the variant
    case O.Dummy: {
      const s = genTrainingDummy((variant & 1) as 0 | 1);
      return { pb: s.pb, ax: s.ax, ay: s.ay, visible: true };
    }
    case O.Rack: {
      const s = genWeaponRack((variant & 1) as 0 | 1);
      return { pb: s.pb, ax: s.ax, ay: s.ay, visible: true };
    }
    case O.Standard: {
      const s = genSectBanner(banner ?? '#a8302a', (variant & 1) as 0 | 1);
      return { pb: s.pb, ax: s.ax, ay: s.ay, visible: true };
    }
    default:
      return null;
  }
}

function witherBamboo(variant: number, season: number): ObjSprite {
  const s = genBamboo(variant, 2, 0);
  s.pb.map((c) => mix(corrupt(c, 0.85), hex('#6b6a52'), 0.35));
  if (season === 3) snowCap(s.pb, 1, 5, 0.4);
  return s;
}

function witherBush(variant: number, season: number): ObjSprite {
  const s = genBush(variant, 2, 0);
  s.pb.map((c) => mix(corrupt(c, 0.9), hex('#5a4a52'), 0.45));
  if (season === 3) snowCap(s.pb, 2, 5, 0.7);
  return s;
}

function witherReeds(variant: number, season: number): ObjSprite {
  const s = genReeds(variant, 2, 0);
  s.pb.map((c) => corrupt(c, 0.9));
  void season;
  return s;
}

function witherFlowers(variant: number, season: number): ObjSprite {
  const s = genFlowers(variant, season === 3 ? 2 : 2, 0);
  s.pb.map((c) => corrupt(c, 0.95));
  return { ...s, visible: season !== 3 };
}

export const FLORA_CODES: number[] = [O.Pine, O.Oak, O.Bamboo, O.Boulder, O.Bush, O.Reeds, O.DeadTree, O.Bones, O.Flowers, O.Banner, O.Well, O.Lantern, O.Dummy, O.Rack, O.Standard];
void BLIGHT_TINT;
