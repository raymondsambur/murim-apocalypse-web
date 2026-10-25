/**
 * Beast sprites: boar, wolf, snake, bear, tiger and the Blight hound. Side-profile quadrupeds facing right
 * (mirrored for west facings), with a lower head for south-facing and a raised one for north-facing views.
 * Pure (node-testable).
 */
import type { Dir } from '@murim/shared';
import { corrupt, hex, mix, rgba, scale, type Col } from './color';
import { bayer, hf, rampTone } from './draw';
import { PixelBuffer } from './pixel';
import { ramp, type Ramp } from './palette';

export const BEAST_W = 64;
export const BEAST_H = 52;
export const BEAST_AX = 32;
export const BEAST_AY = 44;

export type BeastKey = 'boar' | 'wolf' | 'snake' | 'bear' | 'tiger' | 'wolf_blight';
export type BeastState = 'idle' | 'walk' | 'fight' | 'dead';
export const BEAST_FRAMES: Record<BeastState, number> = { idle: 2, walk: 4, fight: 3, dead: 1 };
export const BEAST_KEYS: BeastKey[] = ['boar', 'wolf', 'snake', 'bear', 'tiger', 'wolf_blight'];

export interface BeastSpec {
  key: BeastKey;
  state: BeastState;
  dir: Dir;
  frame: number;
  elite?: 0 | 1 | 2;
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
  eye: Col;
  scale: number;
}

const DEFS: Record<Exclude<BeastKey, 'snake'>, Def> = {
  boar: { L: 24, H: 12, leg: 6, legW: 3.2, headR: 5, snout: 5, body: ramp('#7a5a44', 0.66, 1.3), belly: ramp('#a68868', 0.7, 1.15), dark: ramp('#3a2a22', 0.7, 1.3), earKind: 'point', tail: 'curl', tusks: true, bristles: true, eye: hex('#ffcf5a'), scale: 1.18 },
  wolf: { L: 25, H: 9.5, leg: 8, legW: 2.6, headR: 4.6, snout: 5.2, body: ramp('#8c8f98', 0.64, 1.3), belly: ramp('#cfcfd2', 0.74, 1.1), dark: ramp('#4a4d56', 0.7, 1.3), earKind: 'point', tail: 'bushy', eye: hex('#ffd84a'), scale: 1.18 },
  wolf_blight: { L: 26, H: 9.5, leg: 8, legW: 2.6, headR: 4.8, snout: 5.2, body: ramp('#4e4660', 0.6, 1.4), belly: ramp('#6a5a7a', 0.7, 1.3), dark: ramp('#241c30', 0.7, 1.3), earKind: 'point', tail: 'bushy', eye: hex('#d58aff'), scale: 1.26 },
  bear: { L: 28, H: 16, leg: 8, legW: 4.4, headR: 6.4, snout: 4.4, body: ramp('#4a3a32', 0.62, 1.35), belly: ramp('#6a5a4c', 0.7, 1.2), dark: ramp('#241a16', 0.7, 1.3), earKind: 'round', tail: 'stub', hump: true, eye: hex('#e0c068'), scale: 1.38 },
  tiger: { L: 31, H: 11.5, leg: 9, legW: 3.2, headR: 5.6, snout: 4.8, body: ramp('#dc8c3c', 0.66, 1.25), belly: ramp('#f0e4cc', 0.8, 1.05), dark: ramp('#2a1c16', 0.7, 1.3), earKind: 'round', tail: 'thin', stripes: true, eye: hex('#fff1a0'), scale: 1.3 },
};

const INK = rgba(30, 22, 34);

function disc(pb: PixelBuffer, cx: number, cy: number, rx: number, ry: number, r: Ramp, seed = 0, belly?: Ramp): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const ny = (y + 0.5 - cy) / ry;
    if (ny * ny > 1) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const v = 0.56 - 0.3 * nx - 0.34 * ny + bayer(x, y) * 0.12 + (hf(x, y, seed) - 0.5) * 0.08;
      if (belly && ny > 0.35) pb.set(x, y, rampTone(belly, v));
      else pb.set(x, y, rampTone(r, v));
    }
  }
}

function leg(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, w: number, r: Ramp, paw: Col): void {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const ww = w * (1 - 0.25 * t);
    for (let yy = Math.floor(y - ww / 2); yy <= Math.ceil(y + ww / 2); yy++)
      for (let xx = Math.floor(x - ww / 2); xx <= Math.ceil(x + ww / 2); xx++) {
        const u = (xx + 0.5 - (x - ww / 2)) / ww;
        pb.set(xx, yy, u < 0.34 ? r.l : u > 0.7 ? r.d : r.b);
      }
  }
  pb.rect(Math.round(x1 - w / 2), Math.round(y1) - 1, Math.round(w) + 1, 2, paw);
}

function stripePattern(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, dark: Col): void {
  pb.map((c, x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return c;
    const wave = Math.sin(x * 0.9 + (y - y0) * 0.25) * 1.2;
    return Math.floor((x + wave) / 3) % 2 === 0 && ((x + y) & 7) !== 0 && y < y1 - 1 ? mix(c, dark, 0.7) : c;
  });
}

function drawQuadruped(spec: BeastSpec, d: Def): PixelBuffer {
  const pb = new PixelBuffer(BEAST_W, BEAST_H);
  const up = spec.dir === 3 || spec.dir === 2; // north-facing views
  const f = spec.frame;
  const st = spec.state;
  const gy = BEAST_AY; // ground y
  const bx = BEAST_AX - 1;
  const phase = st === 'walk' ? (f % 4) / 4 : 0;
  const bob = st === 'walk' ? (f % 2 ? -1 : 0) : st === 'idle' ? (f % 2 ? -0.6 : 0) : 0;
  const crouch = st === 'fight' ? (f === 1 ? 2 : 0) : 0;
  const lunge = st === 'fight' ? (f === 2 ? 3 : f === 1 ? -2 : 0) : 0;
  const by = gy - d.leg - d.H / 2 + bob + crouch;

  if (st === 'dead') {
    // lying on its side, legs sticking out stiffly
    const cy = gy - d.H * 0.45;
    disc(pb, bx - 4, cy, d.L * 0.3, d.H * 0.5, d.body, 5, d.belly);
    disc(pb, bx + 5, cy - 0.5, d.L * 0.34, d.H * 0.55, d.body, 6, d.belly);
    for (let i = 0; i < 4; i++) {
      const lx = bx - 8 + i * 5;
      pb.line(lx, cy - d.H * 0.35, lx + (i % 2 ? 2 : -1), cy - d.H * 0.35 - d.leg * 0.8, d.dark.b);
      pb.rect(lx + (i % 2 ? 1 : -2), Math.round(cy - d.H * 0.35 - d.leg * 0.8) - 1, 3, 2, d.dark.dd);
    }
    disc(pb, bx + d.L * 0.5 + 1, cy + 1, d.headR * 0.95, d.headR * 0.8, d.body, 7);
    pb.set(Math.round(bx + d.L * 0.5 + 2), Math.round(cy), INK);
    pb.set(Math.round(bx + d.L * 0.5 + 3), Math.round(cy), INK);
    pb.set(Math.round(bx - d.L * 0.5 - 2), Math.round(cy + 1), d.body.d);
    return pb;
  }

  // far legs (behind the body, darker)
  const swing = (p: number): number => Math.sin(p * Math.PI * 2);
  const legPose = (ph: number): { dx: number; lift: number } => ({ dx: swing(ph) * 3.2, lift: Math.max(0, -Math.cos(ph * Math.PI * 2)) * 2.2 });
  const fx = bx + d.L * 0.27 + lunge * 0.5;
  const hxl = bx - d.L * 0.3;
  const dark = { ...d.body, l: d.body.b, b: d.body.d, d: d.body.dd, dd: d.dark.b };
  const fFar = legPose(phase + 0.5);
  const hFar = legPose(phase);
  leg(pb, fx + 2, by + d.H * 0.3, fx + 2 + fFar.dx, gy - fFar.lift, d.legW, dark, d.dark.b);
  leg(pb, hxl + 2, by + d.H * 0.3, hxl + 2 + hFar.dx, gy - hFar.lift, d.legW, dark, d.dark.b);

  // tail (behind body)
  const tx = bx - d.L * 0.5;
  const tailSway = st === 'idle' ? (f % 2 ? 1 : -1) : st === 'walk' ? swing(phase + 0.25) * 1.5 : 0;
  if (d.tail === 'bushy') {
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const w = 2.4 + Math.sin(t * Math.PI) * 1.6;
      disc(pb, tx - 2 - i * 1.3, by - 1 + t * 6 + tailSway * t, w * 0.8, w * 0.7, d.body, 8 + i);
    }
    pb.set(Math.round(tx - 12), Math.round(by + 5 + tailSway), d.belly.l);
  } else if (d.tail === 'thin') {
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const xx = tx - 1 - i * 1.5;
      const yy = by - 2 + Math.sin(t * 3 + tailSway * 0.4) * 2 + t * 3;
      pb.set(xx, yy, i % 3 === 0 ? d.dark.b : d.body.b);
      pb.set(xx, yy + 1, i % 3 === 0 ? d.dark.dd : d.body.d);
    }
  } else if (d.tail === 'curl') {
    pb.set(tx - 1, by - 2, d.body.b);
    pb.set(tx - 2, by - 3, d.body.b);
    pb.set(tx - 3, by - 3, d.body.d);
    pb.set(tx - 3, by - 4, d.body.b);
  } else {
    disc(pb, tx - 1, by - 1, 2, 2, d.body, 3);
  }

  // body: chest + rump
  disc(pb, bx + d.L * 0.18 + lunge * 0.3, by, d.L * 0.34, d.H * 0.54, d.body, 11, d.belly);
  disc(pb, bx - d.L * 0.2, by + 0.5, d.L * 0.34, d.H * 0.5, d.body, 12, d.belly);
  pb.rect(Math.round(bx - d.L * 0.18), Math.round(by - d.H * 0.45), Math.round(d.L * 0.38), Math.round(d.H * 0.9), d.body.b);
  // fill with shaded strip for the middle
  for (let x = Math.round(bx - d.L * 0.18); x < Math.round(bx + d.L * 0.2); x++) {
    for (let y = Math.round(by - d.H * 0.45); y < Math.round(by + d.H * 0.45); y++) {
      const ny = (y - by) / (d.H * 0.5);
      const v = 0.56 - 0.34 * ny + bayer(x, y) * 0.12;
      pb.set(x, y, ny > 0.5 ? rampTone(d.belly, v) : rampTone(d.body, v));
    }
  }
  if (d.hump) disc(pb, bx + d.L * 0.12, by - d.H * 0.48, d.L * 0.24, d.H * 0.34, d.body, 13);
  if (d.stripes) stripePattern(pb, bx - d.L * 0.5, by - d.H * 0.6, bx + d.L * 0.4, by + d.H * 0.35, d.dark.b);
  if (d.bristles) for (let i = -4; i < 6; i++) pb.vline(bx + i * 2, by - d.H * 0.58 - 2 - (i & 1), by - d.H * 0.4, d.dark.b);
  if (spec.key === 'wolf_blight') {
    // exposed ribs and corruption drips
    for (let i = 0; i < 4; i++) pb.line(bx - 4 + i * 3, by - 1, bx - 2 + i * 3, by + 3, hex('#cdb8e8'));
    pb.map((c, x, y) => (hf(x, y, 21) < 0.05 ? rgba(185, 110, 255) : c));
    for (let i = 0; i < 4; i++) pb.vline(bx - 8 + i * 5, by + d.H * 0.5, by + d.H * 0.5 + 2 + (i % 2) * 2, rgba(150, 70, 220));
  }

  // near legs
  const fNear = legPose(phase);
  const hNear = legPose(phase + 0.5);
  const reach = st === 'fight' ? (f === 2 ? 4 : f === 1 ? -3 : 0) : 0;
  leg(pb, fx - 1, by + d.H * 0.32, fx - 1 + fNear.dx + reach, gy - fNear.lift - (st === 'fight' && f === 2 ? 2 : 0), d.legW, d.body, d.dark.b);
  leg(pb, hxl - 1, by + d.H * 0.32, hxl - 1 + hNear.dx - reach * 0.6, gy - hNear.lift, d.legW, d.body, d.dark.b);

  // head
  const hx = bx + d.L * 0.5 + 1 + lunge;
  const hy = by - d.H * 0.05 + (up ? -3.5 : 1.5) + (st === 'fight' && f === 1 ? 2 : 0) + (d.hump ? -1 : 0);
  // neck
  disc(pb, hx - 3, hy + 0.5, 4.2, d.headR * 0.8, d.body, 14);
  disc(pb, hx, hy, d.headR, d.headR * 0.88, d.body, 15);
  // snout
  const open = st === 'fight' && f === 2 ? 2.4 : 0;
  disc(pb, hx + d.headR * 0.8 + 1, hy + 1.2 + open * 0.2, d.snout * 0.75, d.headR * 0.5, d.belly, 16);
  if (d.earKind === 'point') {
    pb.poly([hx - 3, hy - d.headR + 1, hx - 1, hy - d.headR - 4.5, hx + 1.2, hy - d.headR + 1], d.body.b);
    pb.poly([hx - 2.2, hy - d.headR + 1, hx - 1, hy - d.headR - 2.6, hx + 0.2, hy - d.headR + 1], d.dark.b);
  } else {
    disc(pb, hx - 2, hy - d.headR + 0.5, 2.1, 2.1, d.body, 17);
    pb.set(Math.round(hx - 2), Math.round(hy - d.headR + 0.5), d.dark.b);
  }
  // nose, mouth and eye
  const nx = hx + d.headR * 0.8 + 1 + d.snout * 0.7;
  pb.set(Math.round(nx), Math.round(hy + 0.5), d.dark.dd);
  pb.set(Math.round(nx), Math.round(hy + 1.5), d.dark.dd);
  if (open > 0) {
    pb.rect(Math.round(hx + 2), Math.round(hy + 2.4), Math.round(d.snout + 2), 2, hex('#7a1f2a'));
    for (let i = 0; i < 3; i++) pb.set(Math.round(hx + 3 + i * 2), Math.round(hy + 2.2), hex('#ffffff'));
    for (let i = 0; i < 3; i++) pb.set(Math.round(hx + 3 + i * 2), Math.round(hy + 4.2), hex('#ffffff'));
  } else {
    pb.hline(hx + 2, nx - 1, Math.round(hy + 3), d.dark.d);
  }
  if (!up) {
    pb.set(Math.round(hx + 2), Math.round(hy - 1.5), spec.key === 'wolf_blight' || st === 'fight' ? d.eye : INK);
    pb.set(Math.round(hx + 2), Math.round(hy - 0.5), spec.key === 'wolf_blight' || st === 'fight' ? mix(d.eye, hex('#000000'), 0.3) : d.dark.dd);
    pb.set(Math.round(hx + 3), Math.round(hy - 1.5), d.eye);
  }
  if (d.tusks) {
    pb.set(Math.round(hx + d.headR + 2), Math.round(hy + 2.5), hex('#f2ecd8'));
    pb.set(Math.round(hx + d.headR + 3), Math.round(hy + 1.5), hex('#f2ecd8'));
    pb.set(Math.round(hx + d.headR + 3), Math.round(hy + 0.5), hex('#fffaf0'));
  }
  if (spec.key === 'tiger') {
    // face stripes
    pb.vline(Math.round(hx - 1), Math.round(hy - d.headR + 1), Math.round(hy - d.headR + 3), d.dark.b);
    pb.vline(Math.round(hx + 1), Math.round(hy - d.headR + 1), Math.round(hy - d.headR + 2), d.dark.b);
    pb.hline(hx - 3, hx - 1, Math.round(hy + 1), d.dark.b);
  }
  if (spec.key === 'wolf_blight') {
    pb.set(Math.round(hx - 1), Math.round(hy - d.headR - 1), rgba(185, 110, 255));
    pb.set(Math.round(hx), Math.round(hy - d.headR - 2), rgba(185, 110, 255));
  }
  return pb;
}

function drawSnake(spec: BeastSpec): PixelBuffer {
  const pb = new PixelBuffer(BEAST_W, BEAST_H);
  const f = spec.frame;
  const st = spec.state;
  const body = ramp('#4f9a48', 0.62, 1.35);
  const belly = ramp('#d8d49a', 0.74, 1.1);
  const mark = hex('#e0c040');
  const gy = BEAST_AY;
  const bx = BEAST_AX;
  if (st === 'dead') {
    for (let i = 0; i < 26; i++) {
      const x = bx - 14 + i;
      const y = gy - 2 + Math.sin(i * 0.5) * 1.4;
      pb.rect(Math.round(x), Math.round(y) - 1, 1, 3, i % 4 === 0 ? mark : i % 3 === 0 ? body.d : body.b);
    }
    pb.set(bx + 12, gy - 1, INK);
    pb.set(bx + 13, gy - 1, body.d);
    pb.set(bx + 14, gy, hex('#c8452d'));
    return pb;
  }
  const t = f * 0.9;
  const strike = st === 'fight' ? (f === 2 ? 1 : f === 1 ? -0.5 : 0) : 0;
  const n = 22;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); // 0 head .. 1 tail
    const x = bx + 8 - u * 26 + strike * (1 - u) * 6;
    const wob = Math.sin(u * 7 - t * (st === 'walk' ? 2.4 : 0.8)) * (3.2 - u * 1.4);
    const y = gy - 3 - wob * 0.5 - Math.max(0, 1 - u * 3.2) * (st === 'idle' || st === 'fight' ? 8 + (st === 'fight' ? 3 * strike : 0) : 3.5);
    const r = 2.9 * (1 - u * 0.8) + 0.5;
    pts.push([x, y, r]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const [x, y, r] = pts[i];
    disc(pb, x, y, r + 0.2, r, body, 30 + i, belly);
    if (i % 4 === 1) pb.set(Math.round(x), Math.round(y - r + 0.5), mark);
    if (i % 4 === 3) pb.set(Math.round(x), Math.round(y), body.dd);
  }
  const [hx, hy] = pts[0];
  disc(pb, hx + 1.5, hy, 3.6, 2.8, body, 44);
  pb.set(Math.round(hx + 2), Math.round(hy - 1), INK);
  pb.set(Math.round(hx + 3), Math.round(hy - 1), hex('#ffd84a'));
  if (st === 'fight' && f === 2) {
    pb.rect(Math.round(hx + 3), Math.round(hy + 1), 3, 2, hex('#7a1f2a'));
    pb.set(Math.round(hx + 4), Math.round(hy + 1), hex('#ffffff'));
    pb.set(Math.round(hx + 4), Math.round(hy + 3), hex('#ffffff'));
  } else if (f % 2) {
    pb.set(Math.round(hx + 5), Math.round(hy + 1), hex('#c8452d'));
    pb.set(Math.round(hx + 6), Math.round(hy + 0), hex('#c8452d'));
    pb.set(Math.round(hx + 6), Math.round(hy + 2), hex('#c8452d'));
  }
  return pb;
}

export interface BeastSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  top: number;
}

export function genBeast(spec: BeastSpec): BeastSprite {
  const mirror = spec.dir === 1 || spec.dir === 2;
  let pb = spec.key === 'snake' ? drawSnake(spec) : drawQuadruped(spec, DEFS[spec.key]);
  if (spec.key === 'wolf_blight') pb.map((c, x, y) => (hf(x, y, 9) < 0.04 ? mix(c, rgba(190, 120, 255), 0.5) : corrupt(c, 0.1)));
  const baseScale = spec.key === 'snake' ? 1.25 : DEFS[spec.key].scale;
  const k = baseScale * (spec.elite === 2 ? 1.4 : spec.elite === 1 ? 1.15 : 1);
  if (k !== 1) {
    const w = Math.round(pb.w * k);
    const h = Math.round(pb.h * k);
    const out = new PixelBuffer(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(pb.h - 1, Math.floor(y / k));
      for (let x = 0; x < w; x++) out.px[y * w + x] = pb.px[sy * pb.w + Math.min(pb.w - 1, Math.floor(x / k))];
    }
    pb = out;
  }
  pb.outline(INK, 1, 999);
  const b = pb.bounds();
  const out = mirror ? pb.flipped() : pb;
  const ax = mirror ? pb.w - 1 - Math.round(BEAST_AX * k) : Math.round(BEAST_AX * k);
  void scale;
  return { pb: out, ax, ay: Math.round(BEAST_AY * k), top: b ? b.y0 : 0 };
}
