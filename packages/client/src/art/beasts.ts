/**
 * Beast sprites: boar, wolf, snake, bear, tiger and the Blight hound. Side-profile quadrupeds facing right (mirrored for
 * west facings), with a lower head for south-facing and a raised one for north-facing views. Drawn at their final
 * pixel size (no resampling) with mask shading, two-bone IK legs, fur / scale texture, readable eyes and a glow layer for
 * glowing eyes. States: idle, walk, fight (ready stance), attack (2 variants), hit, die, dead and the fidgets sniff,
 * graze, stretch (ear / tail flicks are part of idle). Pure (node-testable).
 */
import type { Dir } from '@murim/shared';
import { corrupt, hex, mix, rgba, type Col } from './color';
import { bayer, hf, rampTone } from './draw';
import { ik2, selOutline, Shaper } from './figure';
import { PixelBuffer } from './pixel';
import { ramp, type Ramp } from './palette';

/** Design canvas (scaled by the animal's size). */
export const BEAST_W = 72;
export const BEAST_H = 52;
export const BEAST_AX = 36;
export const BEAST_AY = 44;

export type BeastKey = 'boar' | 'wolf' | 'snake' | 'bear' | 'tiger' | 'wolf_blight';
export type BeastState = 'idle' | 'walk' | 'fight' | 'attack' | 'hit' | 'die' | 'dead' | 'sniff' | 'graze' | 'stretch';
export const BEAST_FRAMES: Record<BeastState, number> = { idle: 4, walk: 8, fight: 4, attack: 5, hit: 2, die: 4, dead: 1, sniff: 4, graze: 4, stretch: 4 };
/** Milliseconds per frame for the time driven states (walk follows the step time). */
export const BEAST_MS: Record<BeastState, number> = { idle: 420, walk: 95, fight: 230, attack: 95, hit: 110, die: 170, dead: 1000, sniff: 380, graze: 420, stretch: 520 };
export const BEAST_KEYS: BeastKey[] = ['boar', 'wolf', 'snake', 'bear', 'tiger', 'wolf_blight'];

export interface BeastSpec {
  key: BeastKey;
  state: BeastState;
  dir: Dir;
  frame: number;
  elite?: 0 | 1 | 2;
  /** Attack variant 0 bite / 1 swipe (gore for boars). */
  variant?: number;
}

interface Def {
  L: number;
  H: number;
  leg: number;
  legW: number;
  headR: number;
  snout: number;
  body: Ramp;
  belly: Ramp;
  dark: Ramp;
  earKind: 'point' | 'round';
  tail: 'bushy' | 'thin' | 'curl' | 'stub';
  tusks?: boolean;
  hump?: boolean;
  stripes?: boolean;
  bristles?: boolean;
  ruff?: boolean;
  claws?: boolean;
  whiskers?: boolean;
  eye: Col;
  scale: number;
}

const DEFS: Record<Exclude<BeastKey, 'snake'>, Def> = {
  boar: { L: 24, H: 12, leg: 6.5, legW: 3.4, headR: 5, snout: 5, body: ramp('#7a5a44', 0.62, 1.32), belly: ramp('#a68868', 0.7, 1.15), dark: ramp('#3a2a22', 0.7, 1.3), earKind: 'point', tail: 'curl', tusks: true, bristles: true, eye: hex('#ffcf5a'), scale: 1.18 },
  wolf: { L: 25, H: 9.5, leg: 8.5, legW: 2.8, headR: 4.6, snout: 5.2, body: ramp('#8c8f98', 0.6, 1.3), belly: ramp('#cfcfd2', 0.74, 1.1), dark: ramp('#4a4d56', 0.7, 1.3), earKind: 'point', tail: 'bushy', ruff: true, eye: hex('#ffd84a'), scale: 1.18 },
  wolf_blight: { L: 26, H: 9.5, leg: 8.5, legW: 2.6, headR: 4.8, snout: 5.2, body: ramp('#4e4660', 0.58, 1.42), belly: ramp('#6a5a7a', 0.7, 1.3), dark: ramp('#241c30', 0.7, 1.3), earKind: 'point', tail: 'bushy', ruff: true, eye: hex('#d58aff'), scale: 1.26 },
  bear: { L: 28, H: 16, leg: 8, legW: 4.8, headR: 6.4, snout: 4.4, body: ramp('#4a3a32', 0.58, 1.38), belly: ramp('#6a5a4c', 0.7, 1.2), dark: ramp('#241a16', 0.7, 1.3), earKind: 'round', tail: 'stub', hump: true, claws: true, eye: hex('#e0c068'), scale: 1.38 },
  tiger: { L: 31, H: 11.5, leg: 9.5, legW: 3.4, headR: 5.6, snout: 4.8, body: ramp('#dc8c3c', 0.62, 1.25), belly: ramp('#f0e4cc', 0.8, 1.05), dark: ramp('#2a1c16', 0.7, 1.3), earKind: 'round', tail: 'thin', stripes: true, claws: true, whiskers: true, eye: hex('#fff1a0'), scale: 1.3 },
};

const INK = rgba(30, 22, 34);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// poses
// ---------------------------------------------------------------------------

interface BP {
  bob: number;
  crouchF: number;
  crouchR: number;
  lunge: number;
  headDx: number;
  headDy: number;
  jaw: number;
  tail: number;
  ear: number;
  /** Foot offsets x / lift for FF, FN, HF, HN. */
  fx: [number, number, number, number];
  fl: [number, number, number, number];
  swipe: number;
  squint: boolean;
  pitch: number;
  legsUp: number;
  glare: boolean;
}

function legCycle(p: number, S: number, H: number, stance: number): [number, number] {
  p -= Math.floor(p);
  if (p < stance) return [S * (1 - 2 * (p / stance)), 0];
  const q = (p - stance) / (1 - stance);
  const e = q * q * (3 - 2 * q);
  return [-S + 2 * S * e, H * Math.sin(Math.PI * q)];
}

function beastPose(spec: BeastSpec, d: Def, k: number): BP {
  const f = spec.frame;
  const p: BP = { bob: 0, crouchF: 0, crouchR: 0, lunge: 0, headDx: 0, headDy: 0, jaw: 0, tail: 0, ear: 0, fx: [-1.2 * k, 0.6 * k, 1.2 * k, -0.6 * k], fl: [0, 0, 0, 0], swipe: 0, squint: false, pitch: 0, legsUp: 0, glare: false };
  const blight = spec.key === 'wolf_blight';
  const n = BEAST_FRAMES[spec.state];
  const u = f / n;
  switch (spec.state) {
    case 'idle':
      p.bob = [0, -0.5, -0.8, -0.4][f] * k;
      p.tail = Math.sin(TAU * u) * 1.5 * k;
      p.ear = f === 2 ? 1 : 0;
      p.headDy = [0, 0, -0.6, 0][f] * k;
      if (blight) {
        // twitching: jerky offsets
        p.headDx = [0, 0.8, -0.4, 0.5][f] * k;
        p.headDy += [0, -0.5, 0.6, 0][f] * k;
        p.jaw = f === 1 ? 0.25 : 0;
        p.ear = f % 2 ? 1 : 0;
        p.bob += f === 3 ? 0.6 * k : 0;
      }
      break;
    case 'sniff':
      p.headDy = [2, 5, 5.5, 3][f] * k;
      p.headDx = [0.5, 1.5, 2, 1][f] * k;
      p.pitch = [0.5, 1.2, 1.2, 0.5][f] * k;
      p.tail = Math.sin(TAU * u) * 1.2 * k;
      p.bob = f % 2 ? 0.3 * k : 0;
      break;
    case 'graze':
      p.headDy = [6, 9.5, 9.5, 7][f] * k;
      p.headDx = [1, 3, 3.4, 2][f] * k;
      p.pitch = 2 * k;
      p.crouchF = [1, 2, 2, 1][f] * k;
      p.jaw = f === 1 || f === 3 ? 0.55 : 0;
      p.tail = Math.sin(TAU * u) * 1.6 * k;
      p.ear = f === 2 ? 1 : 0;
      break;
    case 'stretch':
      p.pitch = [1, 3, 3.4, 1.5][f] * k;
      p.crouchF = [1, 3.2, 3.6, 1.4][f] * k;
      p.crouchR = -[0, 0.7, 0.9, 0.3][f] * k;
      p.headDy = [1, 3, 3.4, 2][f] * k;
      p.headDx = [1, 3, 4, 2][f] * k;
      p.jaw = f === 2 ? 0.9 : f === 1 ? 0.3 : 0;
      p.tail = -(f === 1 || f === 2 ? 3.2 : 1) * k;
      p.squint = f === 1 || f === 2;
      p.fx = [-3.2 * k, 3 * k, 1.8 * k, -0.6 * k];
      break;
    case 'walk': {
      const S = (d.L > 27 ? 4.4 : 3.8) * k;
      const H = 2.8 * k;
      const wob = blight ? Math.sin(f * 2.3) * 0.7 * k : 0;
      const [a, al] = legCycle(u, S, H, 0.58);
      const [b, bl] = legCycle(u + 0.5, S, H, 0.58);
      // near front + far hind together, far front + near hind together
      p.fx = [b + -1.2 * k, a + 0.6 * k, a + 1.2 * k + wob, b - 0.6 * k - wob];
      p.fl = [bl, al, al, bl];
      if (blight) p.fl = [bl, al * 0.8, al * 1.3, bl * 0.7];
      p.bob = (0.7 * Math.cos(TAU * u * 2) - 0.2) * k + (blight ? Math.sin(f * 1.9) * 0.5 * k : 0);
      p.tail = Math.sin(TAU * (u - 0.125)) * 1.8 * k;
      p.headDy = Math.sin(TAU * u * 2) * 0.5 * k + (blight ? 1.2 * k : 0);
      p.headDx = blight ? Math.sin(f * 2.1) * 0.8 * k : 0;
      p.ear = blight && f % 3 === 0 ? 1 : 0;
      break;
    }
    case 'fight':
      p.crouchF = 1.6 * k;
      p.crouchR = 0.8 * k;
      p.headDy = [1.6, 2.4, 1.6, 2.2][f] * k;
      p.headDx = [0, 0.7, 0, 0.7][f] * k;
      p.jaw = f % 2 ? 0.4 : 0;
      p.bob = [0, -0.4, 0, -0.4][f] * k;
      p.fx = [-2 * k, 2.6 * k, 2.4 * k, -2.4 * k];
      p.ear = 2;
      p.tail = Math.sin(TAU * u) * 0.8 * k;
      p.glare = true;
      break;
    case 'attack': {
      const v = (spec.variant ?? 0) % 2;
      p.glare = true;
      p.ear = 2;
      p.fx = [-2 * k, 2.6 * k, 2.4 * k, -2.4 * k];
      p.tail = 0.5 * k;
      if (v === 0) {
        // bite lunge
        p.lunge = [-2.5, 3, 5.5, 3.5, 1][f] * k;
        p.crouchF = [2, 0.4, 0, 0.3, 1][f] * k;
        p.crouchR = [1.4, 0.6, 0.2, 0.4, 0.8][f] * k;
        p.headDy = [1.6, -0.4, 0.4, 1.2, 1.6][f] * k;
        p.jaw = [0.3, 0.7, 1, 0.15, 0][f];
        p.fx = [[-2, 2.6, 2.4, -2.4], [-1, 4.4, 2, -2.8], [0, 6, 1.4, -3.4], [-1, 4, 2, -2.8], [-2, 2.6, 2.4, -2.4]][f].map((x) => x * k) as BP['fx'];
      } else if (spec.key === 'boar') {
        // gore: head down, then hooked upward
        p.lunge = [-2, 2, 4.5, 3, 1][f] * k;
        p.headDy = [3, 4.2, -3, -1.5, 1][f] * k;
        p.crouchF = [2, 2.4, 0, 0.4, 1][f] * k;
        p.jaw = f === 2 ? 0.4 : 0;
      } else {
        // claw swipe with the near front paw
        p.pitch = [-1.5, -2.5, -1, 0, 0][f] * k;
        p.crouchR = [1.6, 1.6, 0.8, 0.8, 0.8][f] * k;
        p.lunge = [-1.5, 0.5, 2.8, 1.8, 0.5][f] * k;
        p.swipe = [0.2, 0.55, 1, 0.55, 0.15][f];
        p.jaw = f === 2 ? 0.6 : 0.15;
        p.headDy = [1, 0, 0.6, 1, 1.4][f] * k;
      }
      break;
    }
    case 'hit':
      p.lunge = [-2.4, -1][f] * k;
      p.crouchF = [1, 0.4][f] * k;
      p.headDy = [-1.4, -0.4][f] * k;
      p.jaw = f === 0 ? 0.45 : 0;
      p.squint = true;
      p.ear = 2;
      p.tail = 1.4 * k;
      break;
    case 'die':
      p.lunge = [-2.6, -2, -1, 0][f] * k;
      p.crouchF = [1.4, 3 * 1.0, 5.2, 6.4][f] * k;
      p.crouchR = [0.6, 2.4, 4.6, 5.6][f] * k;
      p.headDy = [-1.4, 1.4, 4, 5][f] * k;
      p.jaw = [0.5, 0.4, 0.2, 0][f];
      p.squint = true;
      p.ear = 2;
      p.fx = [[-1.2, 0.6, 1.2, -0.6], [-2.5, 2.2, 2.2, -2.5], [-3.5, 3.4, 3.2, -3.4], [-4, 4, 3.6, -4]][f].map((x) => x * k) as BP['fx'];
      p.legsUp = f === 3 ? 0.45 : 0;
      break;
    case 'dead':
      p.legsUp = 1;
      break;
  }
  return p;
}

// ---------------------------------------------------------------------------
// drawing helpers
// ---------------------------------------------------------------------------

const TMP = [0, 0, 0, 0];

function darker(r: Ramp, d: Ramp): Ramp {
  return { ...r, l: r.b, b: r.d, d: r.dd, dd: d.b, hl: r.l };
}

/** Short dark fur strokes and light flecks across the painted animal. */
function furPass(pb: PixelBuffer, d: Def, seed: number): void {
  const dk = d.dark.b;
  const { w, h, px } = pb;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = px[i];
      if (c >>> 24 !== 255) continue;
      const hh = hf(x, y, seed);
      if (hh < 0.045) {
        px[i] = mix(c, dk, 0.32);
        const j = i + w + 1;
        if (px[j] >>> 24 === 255 && hf(x, y, seed + 3) < 0.6) px[j] = mix(px[j], dk, 0.2);
      } else if (hh > 0.972) {
        px[i] = mix(c, hex('#ffffff'), 0.22);
      }
    }
}

function pawAt(pb: PixelBuffer, sh: Shaper, x: number, y: number, w: number, r: Ramp, d: Def, k: number): void {
  sh.clear().ell(x + 0.6 * k, y - 0.5 * k, w * 0.75, Math.max(1.2, 1.1 * k)).shade(pb, r, { seed: 5, noRim: true });
  if (d.claws) {
    pb.set(x + w * 0.9, y + 0.2, hex('#f2ecd8'));
    pb.set(x + w * 0.4, y + 0.4, hex('#e0d8c0'));
  }
}

function eyeAt(pb: PixelBuffer, glow: PixelBuffer, x: number, y: number, d: Def, k: number, squint: boolean, glare: boolean, key: BeastKey, slit: boolean): void {
  const e = Math.max(2, Math.round(1.5 * k));
  if (squint) {
    pb.hline(x - 1, x + e, y + 1, INK);
    return;
  }
  pb.rect(x, y, e, e, d.eye);
  const pupil = glare || key === 'wolf_blight' ? mix(d.eye, hex('#000000'), 0.5) : INK;
  if (slit) pb.rect(x + (e >> 1), y, 1, e, pupil);
  else pb.rect(x + e - 1, y + (e > 2 ? 1 : 0), 1, Math.max(1, e - 1), pupil);
  pb.set(x, y, mix(d.eye, hex('#ffffff'), 0.7));
  // brow ridge
  pb.hline(x - 1, x + e, y - 1, d.dark.dd);
  if (glare) pb.set(x + e, y - 2, d.dark.dd);
  if (key === 'wolf_blight') {
    for (let i = -1; i <= e; i++) glow.set(x + i, y + 1, rgba(200, 120, 255, 150));
    glow.set(x + 1, y, rgba(220, 160, 255, 200));
    glow.set(x, y - 1, rgba(200, 120, 255, 90));
  } else if (glare) glow.set(x + 1, y + 1, rgba(255, 220, 120, 70));
}

// ---------------------------------------------------------------------------
// quadrupeds
// ---------------------------------------------------------------------------

function drawQuadruped(spec: BeastSpec, d: Def, k: number, W: number, H: number): { pb: PixelBuffer; glow: PixelBuffer } {
  const pb = new PixelBuffer(W, H);
  const glow = new PixelBuffer(W, H);
  const sh = new Shaper(W, H);
  const up = spec.dir === 3 || spec.dir === 2;
  const p = beastPose(spec, d, k);
  const gy = BEAST_AY * k;
  const bx = BEAST_AX * k - k;
  const L = d.L * k;
  const Hh = d.H * k;
  const leg = d.leg * k;
  const legW = Math.max(2.4, d.legW * k);
  const hr = d.headR * k;
  const sn = d.snout * k;
  const blight = spec.key === 'wolf_blight';
  const bodyBase = gy - leg * 0.96 - Hh / 2;
  const by = bodyBase + p.bob + (p.crouchF + p.crouchR) * 0.5;
  const byF = by + (p.crouchF - p.crouchR) * 0.5 + p.pitch * 0.5;
  const byR = by - (p.crouchF - p.crouchR) * 0.5 - p.pitch * 0.4;

  if (spec.state === 'dead' || p.legsUp > 0) return drawDead(pb, glow, sh, spec, d, k, p, bx, gy, L, Hh, leg, hr, sn);

  const shX = bx + L * 0.27 + p.lunge * 0.55;
  const hipX = bx - L * 0.3 + p.lunge * 0.1;
  const farBody = darker(d.body, d.dark);

  // ---- far legs ----------------------------------------------------------------------
  const drawLeg = (hx: number, hy: number, fx: number, lift: number, r: Ramp, front: boolean, near: boolean, swipe = 0): void => {
    let tx = hx + fx;
    let ty = gy - lift;
    if (swipe > 0) {
      tx = hx + (3 + 7 * swipe) * k;
      ty = hy + leg * (0.7 - 0.5 * swipe);
    }
    ik2(hx, hy, tx, ty, leg * 0.58, leg * 0.58, front ? -1 : 1, TMP);
    const [jx, jy, ex, ey] = TMP;
    const wTop = legW * (front ? 0.62 : 0.7);
    sh.clear().cap(hx, hy, jx, jy, wTop, wTop * 0.8).cap(jx, jy, ex, ey - 0.8 * k, wTop * 0.78, wTop * 0.58).shade(pb, r, { seed: near ? 7 : 8, grad: 0.5, noRim: false });
    pawAt(pb, sh, ex - legW * 0.35, ey, legW, near ? d.body : farBody, d, k);
    if (swipe > 0.5) {
      // claw rake marks
      for (let c = 0; c < 3; c++) pb.set(ex + 2 + c, ey - 1 + c * 0.7, hex('#fff6dc'));
    }
  };
  const hipY = byR + Hh * 0.32;
  const shY = byF + Hh * 0.32;
  drawLeg(shX + 1.6 * k, shY, p.fx[0], p.fl[0], farBody, true, false);
  drawLeg(hipX + 1.6 * k, hipY, p.fx[2], p.fl[2], farBody, false, false);

  // ---- tail ----------------------------------------------------------------------------
  const tx = bx - L * 0.5;
  const tyb = (byR - Hh * 0.18);
  if (d.tail === 'bushy') {
    let px = tx;
    let py = tyb;
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const nx = px - 1.9 * k;
      const ny = py + (1.2 + t * 1.6) * k + p.tail * 0.35;
      const r = (2.6 + Math.sin(t * Math.PI) * 1.2) * k * 0.62;
      sh.clear().cap(px, py, nx, ny, r, r * 0.9).shade(pb, d.body, { seed: 20 + i, noRim: i < 5 });
      px = nx;
      py = ny;
    }
    pb.set(px, py + 0.5 * k, d.belly.l);
    if (blight) pb.set(px - 1, py, rgba(185, 110, 255));
  } else if (d.tail === 'thin') {
    for (let i = 0; i < 15; i++) {
      const t = i / 14;
      const xx = tx - 1 - i * 1.5 * k * 0.8;
      const yy = tyb + Math.sin(t * 3 + p.tail * 0.3) * 2 * k + t * 3 * k * 0.8 - (p.tail < -1 ? 4 * k * t : 0);
      sh.clear().ell(xx, yy, 0.9 * k + 0.6, 0.9 * k + 0.6).shade(pb, i % 3 === 0 ? d.dark : d.body, { noRim: true });
    }
    pb.set(tx - 1 - 14 * 1.2 * k, tyb + 3 * k + 1, d.dark.dd);
  } else if (d.tail === 'curl') {
    sh.clear().cap(tx, tyb, tx - 2.4 * k, tyb - 2 * k, 1.1 * k, 0.9 * k).cap(tx - 2.4 * k, tyb - 2 * k, tx - 3.8 * k, tyb - 3.8 * k + p.tail * 0.2, 0.9 * k, 0.7 * k).shade(pb, d.body, { noRim: true });
  } else sh.clear().ell(tx - k, tyb, 2 * k, 2 * k).shade(pb, d.body, { seed: 3 });

  // ---- body ------------------------------------------------------------------------------
  sh.clear();
  sh.ell(bx + L * 0.18 + p.lunge * 0.3, byF, L * 0.34, Hh * 0.54);
  sh.ell(bx - L * 0.2, byR + 0.5 * k, L * 0.34, Hh * 0.5);
  sh.poly([bx - L * 0.2, byR - Hh * 0.46, bx + L * 0.2 + p.lunge * 0.3, byF - Hh * 0.5, bx + L * 0.2 + p.lunge * 0.3, byF + Hh * 0.46, bx - L * 0.2, byR + Hh * 0.48]);
  if (d.hump) sh.ell(bx + L * 0.12, byF - Hh * 0.48, L * 0.24, Hh * 0.34);
  sh.shade(pb, d.body, { seed: 11, grad: 0.5, ao: 0.12 });
  // belly: lighter underside following the body mask
  const bodyMask = sh.m.slice();
  {
    const x0 = Math.floor(bx - L * 0.55);
    const x1 = Math.ceil(bx + L * 0.55);
    sh.clear().fill(x0, byR, x1, byF + Hh, (x, y) => {
      if (!bodyMask[y * W + x]) return false;
      const belly = (byR + byF) / 2 + Hh * 0.13 + Math.sin((x - bx) * 0.35) * 0.4;
      return y + 0.5 > belly;
    });
    sh.paint(pb, (x, y) => rampTone(d.belly, 0.7 - 0.28 * ((x - x0) / (x1 - x0)) + bayer(x, y) * 0.12 - (y - (byF + Hh * 0.3)) * 0.02));
  }
  // underside fur fringe
  for (let x = Math.floor(bx - L * 0.5); x < bx + L * 0.5; x += 2) {
    let yb = -1;
    for (let y = Math.floor(byF + Hh); y > byR; y--) if (bodyMask[y * W + x]) {
      yb = y;
      break;
    }
    if (yb > 0 && hf(x, 2, 6) < 0.5) pb.set(x, yb + 1, d.belly.d);
  }
  if (d.stripes) stripes(pb, bodyMask, W, bx, L, byR, byF, Hh, d.dark.b, k);
  if (d.bristles) for (let i = -4; i < 6; i++) {
    const x = bx + i * 2 * k * 0.9;
    pb.vline(x, byF - Hh * 0.58 - 2 * k - (i & 1), byF - Hh * 0.4, d.dark.b);
    pb.set(x + 1, byF - Hh * 0.55 - k, d.dark.dd);
  }
  if (blight) {
    // exposed ribs, sores and corruption drips
    for (let i = 0; i < 4; i++) pb.line(bx - 4 * k + i * 3 * k, byF - k, bx - 2 * k + i * 3 * k, byF + 3 * k, hex('#cdb8e8'));
    for (let i = 0; i < 3; i++) {
      pb.set(bx - 3 * k + i * 4 * k, byF - Hh * 0.3, rgba(185, 110, 255));
      glow.set(bx - 3 * k + i * 4 * k, byF - Hh * 0.3, rgba(185, 110, 255, 160));
    }
  }

  // ---- near legs ---------------------------------------------------------------------------
  drawLeg(hipX - 1 * k, hipY, p.fx[3], p.fl[3], d.body, false, true);
  drawLeg(shX - 1 * k, shY, p.fx[1], p.fl[1], d.body, true, true, p.swipe);

  // ---- neck, head ---------------------------------------------------------------------------
  const hx = bx + L * 0.5 + 1 * k + p.lunge + p.headDx;
  const hy = byF - Hh * 0.05 + (up ? -3.5 * k : 1.5 * k) + p.headDy + (d.hump ? -1 * k : 0);
  sh.clear().cap(shX - 1.5 * k, byF - Hh * 0.12, hx - hr * 0.4, hy + 0.2 * k, Hh * 0.46, hr * 0.8).shade(pb, d.body, { seed: 14, noRim: true });
  if (d.ruff) {
    // jagged ruff under the jaw
    for (let i = 0; i < 4; i++) {
      pb.set(hx - 2.4 * k + i * 1.2 * k, hy + hr * 0.85 + (i % 2), d.belly.b);
      pb.set(hx - 2.4 * k + i * 1.2 * k, hy + hr * 0.85 + (i % 2) + 1, i % 2 ? d.belly.d : d.belly.l);
    }
  }
  // ears
  const flick = p.ear;
  if (d.earKind === 'point') {
    const lean = flick === 2 ? -2.6 * k : flick === 1 ? -1.2 * k : 0;
    sh.clear().poly([hx - 3.4 * k, hy - hr + 1 * k, hx - 1.4 * k + lean, hy - hr - 5.2 * k + (flick === 2 ? 2 * k : 0), hx + 1.4 * k, hy - hr + 1 * k]).shade(pb, d.body, { noRim: false });
    sh.clear().poly([hx - 2.5 * k, hy - hr + 1 * k, hx - 1.4 * k + lean * 0.8, hy - hr - 3.2 * k + (flick === 2 ? 1.6 * k : 0), hx + 0.2 * k, hy - hr + 1 * k]).shade(pb, d.dark, { noRim: true });
  } else {
    const ex = hx - 2.2 * k + (flick ? -0.8 * k : 0);
    sh.clear().ell(ex, hy - hr + 0.6 * k, 2.4 * k, 2.3 * k).shade(pb, d.body, { seed: 17 });
    sh.clear().ell(ex + 0.2, hy - hr + 0.8 * k, 1.2 * k, 1.2 * k).shade(pb, d.dark, { noRim: true });
  }
  // skull and snout
  sh.clear().ell(hx, hy, hr, hr * 0.9).shade(pb, d.body, { seed: 15, grad: 0.5 });
  const open = p.jaw * 3.4 * k;
  const snx0 = hx + hr * 0.45;
  const sny0 = hy + 0.5 * k;
  const snx1 = hx + hr * 0.8 + sn;
  sh.clear().cap(snx0, sny0, snx1, sny0 + 0.9 * k, hr * 0.52, hr * 0.4).shade(pb, d.belly, { seed: 16, grad: 0.55 });
  if (open > 0.5) {
    // open jaw: dark mouth, lower jaw rotated down, teeth
    sh.clear().cap(snx0 - 0.5 * k, sny0 + hr * 0.5, snx1 - 0.5 * k, sny0 + hr * 0.5 + open, hr * 0.3, hr * 0.24).shade(pb, d.belly, { seed: 4, ao: 0.2 });
    pb.rect(Math.round(hx + 1.6 * k), Math.round(sny0 + hr * 0.38), Math.round(sn + hr * 0.5), Math.max(1, Math.round(open * 0.7)), hex('#7a1f2a'));
    for (let i = 0; i < 3; i++) {
      pb.set(hx + 2.6 * k + i * 1.8 * k, sny0 + hr * 0.38, hex('#ffffff'));
      pb.set(hx + 2.6 * k + i * 1.8 * k, sny0 + hr * 0.5 + open - 0.4 * k, hex('#f4f0e6'));
    }
    pb.set(hx + 3.4 * k, sny0 + hr * 0.6 + open * 0.3, hex('#d85a6a'));
  } else {
    pb.hline(hx + hr * 0.5, snx1 - 0.6 * k, sny0 + hr * 0.5, d.dark.d);
    pb.set(snx1 - 0.6 * k, sny0 + hr * 0.5 + 1, d.dark.d);
  }
  // nose
  const nx = snx1 + hr * 0.2;
  sh.clear().ell(nx, sny0 - 0.2 * k, 1.1 * k, 1.1 * k).shade(pb, d.dark, { noRim: true });
  pb.set(nx - 0.4, sny0 - 0.8 * k, hex('#8a8a96'));
  if (!up) eyeAt(pb, glow, hx + hr * 0.28, hy - hr * 0.3, d, k, p.squint, p.glare || blight, spec.key, spec.key === 'wolf' || spec.key === 'tiger' || blight);
  if (d.tusks) {
    pb.set(hx + hr + 1 * k, sny0 + 2.2 * k, hex('#f2ecd8'));
    pb.set(hx + hr + 1.6 * k, sny0 + 1.2 * k, hex('#fffaf0'));
    pb.set(hx + hr + 2.2 * k, sny0 + 0.2 * k, hex('#fffaf0'));
    pb.set(hx + hr + 1 * k, sny0 + 1.6 * k, hex('#d8d0b8'));
  }
  if (d.whiskers) {
    for (let i = 0; i < 3; i++) pb.line(hx + hr * 0.7, sny0 + 1.2 * k + i * 0.8, hx + hr * 0.7 + 3 * k, sny0 + 0.6 * k + i * 1.6, hex('#fff6e6'));
    // face stripes
    pb.vline(hx - 1 * k, hy - hr + 1 * k, hy - hr + 3.4 * k, d.dark.b);
    pb.vline(hx + 1 * k, hy - hr + 1 * k, hy - hr + 2.6 * k, d.dark.b);
    pb.hline(hx - 3.6 * k, hx - 1 * k, hy + 1 * k, d.dark.b);
    pb.hline(hx - 3.2 * k, hx - 1 * k, hy + 2.4 * k, d.dark.b);
  }
  if (blight) {
    // black thorn crest and dripping corruption
    for (let i = 0; i < 3; i++) {
      pb.set(hx - 1 * k + i * 1.2 * k, hy - hr - 1 * k - i, rgba(185, 110, 255));
      glow.set(hx - 1 * k + i * 1.2 * k, hy - hr - 1 * k - i, rgba(185, 110, 255, 150));
    }
    for (let i = 0; i < 3; i++) {
      pb.vline(hx + 2 * k + i * 1.6 * k, sny0 + hr * 0.5 + open + 1, sny0 + hr * 0.5 + open + 2 + ((i + (spec.frame >> 1)) % 3), rgba(150, 70, 220));
    }
  }
  furPass(pb, d, spec.key.length * 5 + 3);
  void gy;
  return { pb, glow };
}

function stripes(pb: PixelBuffer, mask: Uint8Array, W: number, bx: number, L: number, byR: number, byF: number, Hh: number, dark: Col, k: number): void {
  const x0 = Math.floor(bx - L * 0.5);
  const x1 = Math.floor(bx + L * 0.45);
  for (let x = x0; x <= x1; x++) {
    const wave = Math.sin(x * 0.9 + 1.3) * 1.2;
    const on = Math.floor((x + wave) / (3 * Math.max(1, k * 0.8))) % 2 === 0;
    if (!on) continue;
    for (let y = Math.floor(byR - Hh * 0.6); y <= Math.ceil(byF + Hh * 0.4); y++) {
      if (!mask[y * W + x]) continue;
      if (((x + y) & 7) === 0) continue;
      const c = pb.px[y * pb.w + x];
      if (c >>> 24 === 255 && y < byF + Hh * 0.3) pb.px[y * pb.w + x] = mix(c, dark, 0.72);
    }
  }
}

function drawDead(pb: PixelBuffer, glow: PixelBuffer, sh: Shaper, spec: BeastSpec, d: Def, k: number, p: BP, bx: number, gy: number, L: number, Hh: number, leg: number, hr: number, sn: number): { pb: PixelBuffer; glow: PixelBuffer } {
  const cy = gy - Hh * 0.46;
  const up = p.legsUp;
  sh.clear().ell(bx - 4 * k, cy, L * 0.32, Hh * 0.5).ell(bx + 5 * k, cy - 0.5 * k, L * 0.35, Hh * 0.56).shade(pb, d.body, { seed: 6, grad: 0.5 });
  const bm = sh.m.slice();
  sh.clear().fill(bx - L * 0.6, cy, bx + L * 0.6, cy + Hh, (x, y) => !!bm[y * pb.w + x] && y > cy + Hh * 0.05);
  sh.paint(pb, (x, y) => rampTone(d.belly, 0.62 + bayer(x, y) * 0.12));
  // legs sticking out stiffly (or still folding while it settles)
  for (let i = 0; i < 4; i++) {
    const lx = bx - 8 * k + i * 5 * k;
    const dir = i % 2 ? 1 : -1;
    const len = leg * (0.4 + 0.6 * up);
    const ey = cy - Hh * 0.38 - len;
    sh.clear().cap(lx, cy - Hh * 0.3, lx + dir * 2.4 * k * up, ey, d.legW * k * 0.6, d.legW * k * 0.46).shade(pb, i < 2 ? d.body : darker(d.body, d.dark), { seed: 9 + i, grad: 0.5 });
    pawAt(pb, sh, lx + dir * 2.4 * k * up - d.legW * k * 0.3, ey + 0.5, d.legW * k, d.dark, d, k);
  }
  // head resting on the ground, tongue out, X eye
  const hx = bx + L * 0.5 + 1.5 * k;
  const hy = cy + 1.2 * k;
  sh.clear().ell(hx, hy, hr * 0.95, hr * 0.8).cap(hx + hr * 0.4, hy + 0.4 * k, hx + hr * 0.8 + sn, hy + 1 * k, hr * 0.46, hr * 0.38).shade(pb, d.body, { seed: 7 });
  if (d.earKind === 'point') sh.clear().poly([hx - 2.6 * k, hy - hr * 0.7, hx - 3.4 * k, hy - hr - 3 * k, hx - 0.4 * k, hy - hr * 0.8]).shade(pb, d.body, { noRim: true });
  else sh.clear().ell(hx - 2 * k, hy - hr * 0.8, 2 * k, 2 * k).shade(pb, d.body, { noRim: true });
  const ex = hx + hr * 0.3;
  pb.line(ex - 1, hy - 1.4 * k, ex + 1.5 * k, hy - 0.2 * k, INK);
  pb.line(ex - 1, hy - 0.2 * k, ex + 1.5 * k, hy - 1.4 * k, INK);
  pb.set(hx + hr * 0.8 + sn * 0.9, hy + 1.6 * k, hex('#d85a6a'));
  pb.set(hx + hr * 0.8 + sn * 0.9, hy + 2.6 * k, hex('#c04a5a'));
  pb.set(hx + hr * 0.9 + sn, hy + 0.2 * k, INK);
  pb.set(bx - L * 0.5 - 2 * k, cy + 1.4 * k, d.body.d);
  pb.set(bx - L * 0.5 - 3 * k, cy + 1.8 * k, d.body.b);
  if (spec.key === 'wolf_blight') for (let i = 0; i < 5; i++) pb.set(bx - 6 * k + i * 3 * k, cy + Hh * 0.45, rgba(150, 70, 220));
  void glow;
  furPass(pb, d, 41);
  return { pb, glow };
}

// ---------------------------------------------------------------------------
// snake
// ---------------------------------------------------------------------------

function drawSnake(spec: BeastSpec, k: number, W: number, H: number): { pb: PixelBuffer; glow: PixelBuffer } {
  const pb = new PixelBuffer(W, H);
  const glow = new PixelBuffer(W, H);
  const sh = new Shaper(W, H);
  const f = spec.frame;
  const st = spec.state;
  const body = ramp('#4f9a48', 0.58, 1.38);
  const belly = ramp('#d8d49a', 0.74, 1.1);
  const mark = hex('#e0c040');
  const gy = BEAST_AY * k;
  const bx = BEAST_AX * k;
  const n = BEAST_FRAMES[st];
  const t = (f / n) * TAU;
  if (st === 'dead' || (st === 'die' && f === 3)) {
    for (let i = 0; i < 28; i++) {
      const x = bx - 15 * k + i * k * 0.9;
      const y = gy - 2 * k + Math.sin(i * 0.5) * 1.4 * k;
      sh.clear().ell(x, y, 1.6 * k + 0.3, 1.8 * k + 0.3).shade(pb, i % 4 === 0 ? ramp('#e0c040', 0.7, 1.2) : body, { seed: i, noRim: true });
    }
    pb.set(bx + 13 * k, gy - 1.2 * k, INK);
    pb.set(bx + 14 * k, gy - 1.2 * k, body.d);
    pb.set(bx + 15 * k, gy - 0.4 * k, hex('#c8452d'));
    return { pb, glow };
  }
  let strike = 0;
  let raise = 1;
  let sway = 0.8;
  let recoil = 0;
  let squint = false;
  let jaw = 0;
  switch (st) {
    case 'fight':
      raise = 1.15;
      sway = 1.1;
      break;
    case 'attack':
      strike = [-0.6, 0.2, 1, 0.5, 0][f] * (spec.variant === 1 ? 1.25 : 1);
      raise = [1.3, 1.1, 0.6, 0.8, 1][f];
      jaw = [0, 0.4, 1, 0.3, 0][f];
      sway = 0.5;
      break;
    case 'hit':
      recoil = [-2.5, -1][f] * k;
      squint = true;
      raise = 0.7;
      break;
    case 'die':
      raise = [0.7, 0.4, 0.2][f];
      squint = true;
      break;
    case 'sniff':
      raise = [1, 1.3, 1.5, 1.2][f];
      sway = 1.6;
      break;
    case 'graze':
      raise = [0.3, 0.2, 0.2, 0.3][f];
      sway = 0.4;
      break;
    case 'stretch':
      raise = [1.2, 1.9, 2.1, 1.5][f];
      sway = 0.6;
      jaw = f === 2 ? 0.6 : 0;
      break;
    case 'walk':
      sway = 2.4;
      raise = 0.55;
      break;
  }
  const nseg = 24;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < nseg; i++) {
    const u = i / (nseg - 1);
    const x = bx + 8 * k - u * 28 * k + strike * (1 - u) * 8 * k + recoil * (1 - u);
    const wob = Math.sin(u * 7 - t * (st === 'walk' ? 2 : 1)) * (3.2 - u * 1.4) * k * (sway / 1.2);
    const lift = Math.max(0, 1 - u * 3.2) * (st === 'walk' ? 3.4 : 8 + 3 * strike) * k * raise;
    const y = gy - 3 * k - wob * 0.5 - lift;
    pts.push([x, y, (2.9 * (1 - u * 0.8) + 0.6) * k]);
  }
  for (let i = nseg - 1; i >= 0; i--) {
    const [x, y, r] = pts[i];
    sh.clear().ell(x, y, r + 0.3, r).shade(pb, body, { seed: 30 + i, grad: 0.55, noRim: i > 0 });
    // belly strip and diamond scales
    if (r > 1.4) {
      pb.set(x, y + r - 0.6, belly.b);
      pb.set(x + 1, y + r - 0.6, belly.d);
    }
    if (i % 3 === 1) {
      pb.set(x, y - r * 0.55, mark);
      pb.set(x + 1, y - r * 0.2, body.dd);
      pb.set(x - 1, y - r * 0.2, body.dd);
    } else if (i % 3 === 0) pb.set(x, y, body.l);
  }
  const [hx, hy] = pts[0];
  sh.clear().ell(hx + 1.6 * k, hy, 3.8 * k, 2.9 * k).cap(hx + 2 * k, hy + 0.4 * k, hx + 5 * k, hy + 0.6 * k, 1.8 * k, 1.5 * k).shade(pb, body, { seed: 44, grad: 0.5 });
  if (jaw > 0.1) {
    pb.rect(hx + 3 * k, hy + 0.8 * k, 3.2 * k, Math.max(2, jaw * 3 * k), hex('#7a1f2a'));
    pb.set(hx + 4 * k, hy + 0.6 * k, hex('#ffffff'));
    pb.set(hx + 5 * k, hy + 0.6 * k, hex('#ffffff'));
    pb.set(hx + 4 * k, hy + 0.8 * k + jaw * 3 * k, hex('#ffffff'));
  } else if (f % 2 || st === 'sniff') {
    // forked tongue
    const tx = hx + 6 * k;
    pb.hline(tx, tx + 2 * k, hy + 0.9 * k, hex('#c8452d'));
    pb.set(tx + 2.4 * k, hy + 0.1 * k, hex('#c8452d'));
    pb.set(tx + 2.4 * k, hy + 1.8 * k, hex('#c8452d'));
  }
  if (squint) pb.hline(hx + 1.4 * k, hx + 3.4 * k, hy - 0.4 * k, INK);
  else {
    pb.rect(hx + 2 * k, hy - 1 * k, Math.max(2, 1.4 * k), Math.max(2, 1.4 * k), hex('#ffd84a'));
    pb.rect(hx + 2.6 * k, hy - 1 * k, 1, Math.max(2, 1.4 * k), INK);
    pb.set(hx + 2 * k, hy - 1 * k, hex('#fff6b0'));
    pb.hline(hx + 1.4 * k, hx + 4 * k, hy - 1.6 * k, body.dd);
  }
  return { pb, glow };
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

export interface BeastSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  top: number;
  glow: PixelBuffer | null;
}

export function beastScale(key: BeastKey, elite?: 0 | 1 | 2): number {
  const base = key === 'snake' ? 1.25 : DEFS[key].scale;
  return base * (elite === 2 ? 1.4 : elite === 1 ? 1.15 : 1);
}

export function genBeast(spec: BeastSpec): BeastSprite {
  const mirror = spec.dir === 1 || spec.dir === 2;
  const k = beastScale(spec.key, spec.elite);
  const W = Math.ceil(BEAST_W * k);
  const H = Math.ceil(BEAST_H * k);
  const r = spec.key === 'snake' ? drawSnake(spec, k, W, H) : drawQuadruped(spec, DEFS[spec.key], k, W, H);
  const pb = r.pb;
  if (spec.key === 'wolf_blight') pb.map((c, x, y) => (hf(x, y, 9) < 0.035 ? mix(c, rgba(190, 120, 255), 0.5) : corrupt(c, 0.1)));
  selOutline(pb, INK);
  const b = pb.bounds();
  const out = mirror ? pb.flipped() : pb;
  const gl = r.glow.bounds() ? (mirror ? r.glow.flipped() : r.glow) : null;
  const ax = mirror ? pb.w - 1 - Math.round(BEAST_AX * k) : Math.round(BEAST_AX * k);
  return { pb: out, ax, ay: Math.round(BEAST_AY * k), top: b ? b.y0 : 0, glow: gl };
}
