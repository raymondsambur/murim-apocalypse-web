/**
 * Resource node sprites: herb, rare herb, ore vein, wayside shrine and the Blight heart (the apocalypse's
 * visual climax). Each returns a colour sprite and, where useful, an additive glow sprite. Pure.
 */
import type { NodeKind } from '@murim/shared';
import { corrupt, hex, mix, rgba, scale, type Col } from './color';
import { bayer, groundShadow, hf, rampTone, shadedBlob, trunk } from './draw';
import { PixelBuffer } from './pixel';
import { ramp, type Ramp } from './palette';

export interface NodeSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  /** Additive glow layer (same size), or null. */
  glow: PixelBuffer | null;
  /** Colour of the radial light pool drawn under/around the node (null = none). */
  light: Col | null;
  lightR: number;
}

export const NODE_FRAMES: Record<NodeKind, number> = { herb: 2, rareHerb: 4, ore: 4, shrine: 2, heart: 4 };

const INK = rgba(30, 22, 34);

function done(pb: PixelBuffer, ax: number, ay: number, glow: PixelBuffer | null, light: Col | null, lightR: number, outline = true): NodeSprite {
  if (outline) pb.outline(undefined, 0.3);
  return { pb, ax, ay, glow, light, lightR };
}

export function genHerb(variant: number, season: number, frame: number): NodeSprite {
  const pb = new PixelBuffer(28, 24);
  const cx = 14;
  const ay = 20;
  groundShadow(pb, cx + 2, ay + 1, 8, 2.6, 50);
  const leaf = season === 3 ? ramp('#8aa88a', 0.7, 1.2) : season === 2 ? ramp('#9aa04a', 0.7, 1.2) : ramp('#4fa642', 0.68, 1.32);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const ang = -2.4 + (k / (n - 1)) * 1.65 * 2 - 0.4 * 0 ;
    const len = 8 + hf(variant, k, 1) * 5;
    const sway = frame % 2 ? 0.5 : 0;
    let x = cx + (k - 3) * 0.8;
    let y = ay;
    for (let s = 0; s < len; s++) {
      const t = s / len;
      x += Math.sin(ang + Math.PI * 0.5 * 0) * 0 + (k - 3) * 0.18 + sway * t * 0.3;
      y -= 0.95;
      const w = t < 0.6 ? 1 : 0;
      pb.set(x, y, t > 0.7 ? leaf.l : t > 0.35 ? leaf.b : leaf.d);
      if (w) pb.set(x + 1, y, leaf.d);
    }
    // leaflet
    pb.set(x + (k % 2 ? 1 : -1), y + 1, leaf.l);
  }
  // little flowers
  const flower = season === 3 ? hex('#cdd8e6') : hex('#f2f2e8');
  for (let k = 0; k < 3; k++) {
    const fx = cx - 4 + k * 4 + (hf(variant, k, 5) - 0.5) * 2;
    const fy = ay - 10 - hf(variant, k, 6) * 4;
    pb.set(fx, fy, hex('#f5dc5a'));
    pb.set(fx - 1, fy, flower);
    pb.set(fx + 1, fy, flower);
    pb.set(fx, fy - 1, flower);
  }
  return done(pb, cx, ay, null, null, 0);
}

export function genRareHerb(variant: number, season: number, frame: number): NodeSprite {
  const pb = new PixelBuffer(32, 32);
  const glow = new PixelBuffer(32, 32);
  const cx = 16;
  const ay = 26;
  groundShadow(pb, cx + 2, ay + 1, 9, 2.8, 50);
  const leaf = ramp('#3fa6a0', 0.66, 1.4);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const len = 11 + hf(variant, k, 2) * 7;
    let x = cx + (k - 3.5) * 0.9;
    let y = ay;
    for (let s = 0; s < len; s++) {
      const t = s / len;
      x += (k - 3.5) * 0.2;
      y -= 0.95;
      pb.set(x, y, t > 0.7 ? leaf.l : t > 0.35 ? leaf.b : leaf.d);
      if (t < 0.55) pb.set(x + 1, y, leaf.d);
    }
  }
  // glowing blossoms
  const pulse = 0.55 + 0.45 * Math.sin((frame / 4) * Math.PI * 2);
  const petal = mix(hex('#bff6ff'), hex('#ffffff'), pulse * 0.6);
  const blooms: [number, number][] = [
    [cx - 5, ay - 15],
    [cx + 4, ay - 17],
    [cx - 1, ay - 21],
  ];
  for (const [bx, by] of blooms) {
    pb.set(bx, by, hex('#fff6c0'));
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      pb.set(bx + dx, by + dy, petal);
    glow.ellipse(bx, by, 4.5, 4.5, rgba(120, 230, 255, 70 + (pulse * 60) | 0));
    glow.ellipse(bx, by, 2.2, 2.2, rgba(210, 250, 255, 140));
  }
  // drifting motes
  for (let k = 0; k < 4; k++) {
    const t = (frame / 4 + k * 0.25) % 1;
    const mx = cx - 8 + hf(k, 1, 7) * 16;
    const my = ay - 8 - t * 18;
    glow.set(mx, my, rgba(200, 250, 255, 220 * (1 - t)));
  }
  return done(pb, cx, ay, glow, rgba(120, 230, 255), 26);
}

export function genOre(variant: number, season: number, frame: number): NodeSprite {
  const pb = new PixelBuffer(36, 30);
  const glow = new PixelBuffer(36, 30);
  const cx = 18;
  const ay = 25;
  groundShadow(pb, cx + 3, ay, 13, 4, 60);
  const rock = ramp('#6d6a72', 0.62, 1.3);
  shadedBlob(pb, cx - 4, ay - 6, 8, 6.5, rock, { seed: 3 + variant, speckle: 0.1 });
  shadedBlob(pb, cx + 5, ay - 5, 7.5, 5.5, rock, { seed: 9 + variant, speckle: 0.1 });
  shadedBlob(pb, cx, ay - 10, 8.5, 7.5, rock, { seed: 5 + variant, speckle: 0.1 });
  // ore veins: pale blue crystalline with gold flecks
  const vein = [hex('#8fd0ff'), hex('#c8ecff'), hex('#5aa8e0')];
  const gold = hex('#f0c850');
  const veins: [number, number, number, number][] = [
    [cx - 7, ay - 5, cx - 2, ay - 12],
    [cx + 2, ay - 14, cx + 8, ay - 7],
    [cx - 1, ay - 8, cx + 4, ay - 3],
  ];
  for (const [x0, y0, x1, y1] of veins) {
    pb.line(x0, y0, x1, y1, vein[2]);
    pb.line(x0 + 1, y0, x1 + 1, y1, vein[0]);
  }
  pb.set(cx - 3, ay - 9, gold);
  pb.set(cx + 5, ay - 9, gold);
  pb.set(cx + 1, ay - 5, gold);
  // glints that travel along the veins
  const g = frame % 4;
  const pts: [number, number][] = [
    [cx - 6, ay - 6],
    [cx - 4, ay - 9],
    [cx + 4, ay - 12],
    [cx + 6, ay - 8],
  ];
  const [gx, gy] = pts[g];
  glow.set(gx, gy, rgba(255, 255, 255, 255));
  glow.set(gx - 1, gy, rgba(200, 235, 255, 160));
  glow.set(gx + 1, gy, rgba(200, 235, 255, 160));
  glow.set(gx, gy - 1, rgba(200, 235, 255, 160));
  glow.set(gx, gy + 1, rgba(200, 235, 255, 160));
  if (season === 3) {
    for (let x = 0; x < 36; x++) {
      for (let y = 0; y < 30; y++) {
        const c = pb.px[y * 36 + x];
        if (c >>> 24 && pb.px[(y - 1) * 36 + x] >>> 24 === 0 && hf(x, y, 5) < 0.7) pb.px[y * 36 + x] = hex('#eef3f9');
      }
    }
  }
  return done(pb, cx, ay, glow, null, 0);
}

export function genShrineNode(variant: number, season: number, frame: number): NodeSprite {
  const pb = new PixelBuffer(32, 42);
  const glow = new PixelBuffer(32, 42);
  const cx = 16;
  const ay = 38;
  const stone = ramp('#9a958c', 0.64, 1.22);
  groundShadow(pb, cx + 3, ay + 1, 11, 3.4, 56);
  // base steps
  pb.rect(cx - 8, ay - 4, 17, 4, stone.d);
  pb.rect(cx - 8, ay - 4, 17, 1, stone.l);
  pb.rect(cx - 6, ay - 7, 13, 3, stone.b);
  pb.rect(cx - 6, ay - 7, 13, 1, stone.l);
  // pillar
  pb.rect(cx - 2, ay - 16, 5, 9, stone.b);
  pb.rect(cx - 2, ay - 16, 2, 9, stone.l);
  pb.rect(cx + 2, ay - 16, 1, 9, stone.d);
  // lantern box
  pb.rect(cx - 5, ay - 25, 11, 9, stone.b);
  pb.rect(cx - 5, ay - 25, 11, 1, stone.l);
  pb.rect(cx - 5, ay - 17, 11, 1, stone.d);
  const flick = frame % 2 ? 1 : 0;
  pb.rect(cx - 3, ay - 23, 7, 5, hex('#ffe9a8'));
  pb.rect(cx - 2, ay - 22, 5, 3 + flick, hex('#fff6d0'));
  pb.vline(cx, ay - 23, ay - 18, stone.d);
  // roof
  pb.poly([cx - 8, ay - 25, cx + 0.5, ay - 33, cx + 9, ay - 25], stone.d);
  pb.poly([cx - 7, ay - 25, cx, ay - 32, cx - 0.5, ay - 25], stone.l);
  pb.rect(cx - 1, ay - 36, 3, 4, stone.b);
  pb.set(cx, ay - 37, hex('#d9b867'));
  // red cloth ribbon
  pb.vline(cx + 7, ay - 24, ay - 15, hex('#a8302a'));
  pb.vline(cx + 8, ay - 22, ay - 17, hex('#c8452d'));
  glow.ellipse(cx, ay - 20.5, 9, 9, rgba(255, 210, 120, 60));
  glow.ellipse(cx, ay - 20.5, 5, 5, rgba(255, 230, 160, 110));
  void season;
  void variant;
  return done(pb, cx, ay, glow, rgba(255, 200, 110), 40);
}

// ---------------------------------------------------------------------------
// The Blight heart
// ---------------------------------------------------------------------------

export const HEART_W = 112;
export const HEART_H = 132;

export function genHeart(variant: number, season: number, frame: number): NodeSprite {
  const pb = new PixelBuffer(HEART_W, HEART_H);
  const glow = new PixelBuffer(HEART_W, HEART_H);
  const cx = 56;
  const ay = 116;
  const phase = (frame / 4) * Math.PI * 2;
  const pulse = 0.5 + 0.5 * Math.sin(phase);
  const bark = ramp('#3a2646', 0.55, 1.5);
  const barkDeep = ramp('#1e1226', 0.6, 1.5);
  const vein = hex('#b866ff');
  const veinHot = hex('#e8c4ff');
  const ooze = hex('#7a2f9a');
  void variant;
  void season;
  // ---- corrupted ground patch and cracks ----------------------------------------------------
  for (let y = ay - 20; y <= ay + 12; y++) {
    for (let x = cx - 52; x <= cx + 52; x++) {
      const dx = (x - cx) / 50;
      const dy = (y - (ay - 4)) / 15;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const edge = 1 - d2;
      const n = hf(x, y, 5);
      if (edge < 0.25 && n < 0.55) continue;
      const base = mix(rgba(36, 20, 46), rgba(18, 10, 24), edge);
      pb.set(x, y, n < 0.08 ? rgba(90, 40, 120) : base);
    }
  }
  // roots with glowing veins
  const roots = 9;
  for (let r = 0; r < roots; r++) {
    const a = (r / roots) * Math.PI * 2 + 0.3;
    let x = cx;
    let y = ay - 2;
    let w = 4.2;
    for (let s = 0; s < 34; s++) {
      const t = s / 34;
      const turn = Math.sin(s * 0.5 + r * 2) * 0.35;
      x += Math.cos(a + turn) * 1.35;
      y += Math.sin(a + turn) * 0.7;
      w = 4.2 * (1 - t) + 0.8;
      for (let yy = Math.floor(y - w / 2); yy <= Math.ceil(y + w / 2); yy++)
        for (let xx = Math.floor(x - w / 2); xx <= Math.ceil(x + w / 2); xx++) {
          const u = (xx - x) / w;
          pb.set(xx, yy, u < -0.1 ? bark.b : bark.d);
        }
      if (s % 3 === 0 && t > 0.1) {
        const vc = mix(ooze, vein, pulse * (1 - t));
        pb.set(Math.round(x), Math.round(y), vc);
        glow.set(Math.round(x), Math.round(y), rgba(184, 102, 255, 120 + (pulse * 80) | 0));
      }
    }
  }
  // ---- gnarled trunk -----------------------------------------------------------------------
  const trunkTop = ay - 70;
  for (let y = ay - 4; y >= trunkTop; y--) {
    const t = (ay - 4 - y) / (ay - 4 - trunkTop);
    const wob = Math.sin(t * 5 + 1) * 3;
    const w = 20 - t * 8 + (t < 0.15 ? (0.15 - t) * 60 : 0);
    const x0 = cx + wob - w / 2;
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      const u = (x + 0.5 - x0) / w;
      const n = hf(x, y, 3);
      let c: Col = u < 0.28 ? bark.l : u < 0.65 ? bark.b : u < 0.88 ? bark.d : barkDeep.b;
      if (((x * 3 + Math.floor(y / 5)) & 3) === 0) c = scale(c, 0.78);
      if (n < 0.05) c = barkDeep.dd;
      pb.set(x, y, c);
    }
  }
  // ---- branches (dead, curling) ----------------------------------------------------------------
  const branches: [number, number, number, number][] = [
    [-5, -66, -32, -100],
    [4, -68, 30, -104],
    [-3, -62, -22, -78],
    [5, -60, 26, -80],
    [0, -70, -4, -108],
  ];
  for (const [bx0, by0, bx1, by1] of branches) {
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = cx + bx0 + (bx1 - bx0) * t + Math.sin(t * 4) * 3;
      const y = ay + by0 + (by1 - by0) * t - Math.sin(t * Math.PI) * 5;
      const w = 5.5 * (1 - t) + 1.2;
      for (let yy = Math.floor(y - w / 2); yy <= Math.ceil(y + w / 2); yy++)
        for (let xx = Math.floor(x - w / 2); xx <= Math.ceil(x + w / 2); xx++) pb.set(xx, yy, xx < x - w * 0.15 ? bark.b : bark.d);
      if (i % 6 === 3) {
        // twig
        const dir = i % 12 === 3 ? -1 : 1;
        pb.line(x, y, x + dir * 5, y - 4, bark.d);
        pb.line(x + dir * 5, y - 4, x + dir * 7, y - 7, bark.dd);
      }
    }
  }
  // ---- the heart: a crystal cluster in a split of the trunk ------------------------------------------
  const coreY = ay - 38;
  // glowing cleft
  for (let y = coreY - 16; y <= coreY + 16; y++) {
    const half = 7 * Math.sin(((y - (coreY - 16)) / 32) * Math.PI) + 0.5;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const k = 1 - Math.abs(x - cx) / (half + 0.5);
      pb.set(x, y, mix(rgba(40, 14, 60), mix(vein, veinHot, pulse), k * 0.8));
    }
  }
  // crystal shards
  const shards: [number, number, number, number, number][] = [
    [0, 0, 6, 22, 0],
    [-8, 4, 4.5, 15, -0.4],
    [8, 5, 5, 16, 0.45],
    [-4, 9, 3.4, 10, -0.8],
    [5, 10, 3.6, 11, 0.8],
  ];
  const faceL = mix(hex('#c88cff'), hex('#ffffff'), 0.35 + pulse * 0.4);
  const faceM = mix(hex('#9040e0'), hex('#d8a0ff'), pulse * 0.6);
  const faceD = mix(hex('#4a1a80'), hex('#8a40d0'), pulse * 0.5);
  for (const [sx0, sy0, w, h, tilt] of shards) {
    const x0 = cx + sx0;
    const yb = coreY + sy0 + 8;
    const tipX = x0 + Math.sin(tilt) * h * 0.6;
    const tipY = yb - Math.cos(tilt) * h;
    pb.poly([x0 - w, yb, x0 - w * 0.6, yb - h * 0.55, tipX, tipY, x0, yb], faceL);
    pb.poly([x0, yb, tipX, tipY, x0 + w * 0.65, yb - h * 0.5, x0 + w, yb], faceD);
    pb.poly([x0 - w * 0.2, yb, tipX, tipY, x0 + w * 0.35, yb - h * 0.45, x0 + w * 0.4, yb], faceM);
    pb.line(x0, yb, tipX, tipY, hex('#ffffff'));
  }
  // dripping ooze from the cleft
  for (let i = 0; i < 6; i++) {
    const dx = -12 + i * 5 + (hf(i, 1, 2) - 0.5) * 3;
    const len = 5 + hf(i, 2, 3) * 9 + pulse * 3;
    pb.vline(cx + dx, coreY + 12, coreY + 12 + len, i % 2 ? ooze : mix(ooze, vein, 0.5));
  }
  // veins crawling up the trunk
  for (let r = 0; r < 4; r++) {
    let x = cx - 8 + r * 5;
    for (let y = ay - 6; y > ay - 66; y -= 1) {
      x += Math.sin(y * 0.25 + r * 2) * 0.55;
      if (hf(Math.round(x), y, 6) < 0.8) {
        const c = mix(ooze, vein, pulse);
        pb.set(Math.round(x), y, c);
        if (hf(Math.round(x), y, 7) < 0.3) glow.set(Math.round(x), y, rgba(184, 102, 255, 100 + (pulse * 90) | 0));
      }
    }
  }
  // glow layers
  glow.ellipse(cx, coreY, 20 + pulse * 4, 24 + pulse * 4, rgba(150, 70, 230, 40 + (pulse * 30) | 0));
  glow.ellipse(cx, coreY, 12 + pulse * 3, 16 + pulse * 3, rgba(190, 110, 255, 70 + (pulse * 50) | 0));
  glow.ellipse(cx, coreY, 5, 9, rgba(240, 210, 255, 140 + (pulse * 90) | 0));
  // orbiting shards
  for (let i = 0; i < 4; i++) {
    const a = phase + (i / 4) * Math.PI * 2;
    const ox = cx + Math.cos(a) * 30;
    const oy = coreY - 10 + Math.sin(a) * 9 - 8;
    const front = Math.sin(a) > 0;
    const col = front ? faceL : faceD;
    pb.poly([ox, oy - 4, ox + 2, oy, ox, oy + 4, ox - 2, oy], col);
    glow.ellipse(ox, oy, 4, 4, rgba(190, 110, 255, 90));
  }
  pb.outline(INK, 1, 999);
  void rampTone;
  void trunk;
  void bayer;
  void corrupt;
  return { pb, ax: cx, ay, glow, light: rgba(150, 70, 230), lightR: 90 };
}

export function genNode(kind: NodeKind, variant: number, season: number, frame: number): NodeSprite {
  switch (kind) {
    case 'herb':
      return genHerb(variant, season, frame);
    case 'rareHerb':
      return genRareHerb(variant, season, frame);
    case 'ore':
      return genOre(variant, season, frame);
    case 'shrine':
      return genShrineNode(variant, season, frame);
    case 'heart':
      return genHeart(variant, season, frame);
  }
}

export type { Ramp };
