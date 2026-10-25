/**
 * Weapon sprites: sword, blade, spear, staff (fist gear is the glove / gauntlet material on the arm, see `fistGear`).
 * Tier (1-5) changes materials, length and ornament; rarity (0-4) adds an edge shine / coloured glow. Shapes are drawn
 * along a rotated axis with a per-pixel shader so any angle stays crisp. Pure.
 */
import { RARITY_COLORS, type WeaponType } from '@murim/shared';
import { cb, cg, cr, hex, mix, rgba, type Col } from './color';
import { rampTone } from './draw';
import { rotAt, rotCtx, rotFill, type RotCtx } from './figure';
import { BONE, FITTING, JADE, METAL, TASSEL, WOOD, WRAP, rarityCol } from './gear';
import { PixelBuffer } from './pixel';
import { ramp, type Ramp } from './palette';

export interface WeaponDraw {
  pb: PixelBuffer;
  /** Additive glow layer (rarity). */
  glow: PixelBuffer | null;
  weapon: WeaponType;
  tier: number;
  rar: number;
  /** Hand position (grip) and axis angle in degrees. */
  hx: number;
  hy: number;
  ang: number;
  /** 0..1 portion of the blade that is out of the scabbard. */
  bladeFrac?: number;
  /** Draw the scabbard instead of the blade (carried at the hip). */
  sheathed?: boolean;
}

const WHITE = rgba(255, 255, 255);
const LACQUER = ramp('#3a2a26', 0.6, 1.5);
const RED_LACQUER = ramp('#8a2a26', 0.62, 1.4);

const SWORD_LEN = [0, 17, 19, 21, 23, 25];
const BLADE_LEN = [0, 15, 17, 18, 20, 22];

export function weaponLength(w: WeaponType, tier: number): number {
  const t = Math.max(1, Math.min(5, tier));
  switch (w) {
    case 'sword':
      return SWORD_LEN[t] + 2;
    case 'blade':
      return BLADE_LEN[t] + 2;
    case 'spear':
      return 22 + 5 + t;
    case 'staff':
      return 20;
    default:
      return 0;
  }
}

function rgbOf(c: Col): [number, number, number] {
  return [cr(c), cg(c), cb(c)];
}

/** Dangling tassel (drawn in screen space so it hangs down). */
export function tassel(pb: PixelBuffer, x: number, y: number, len: number, r: Ramp, swing = 0, fan = 1): void {
  for (let k = 0; k < len; k++) {
    const sw = Math.round((swing * k) / Math.max(1, len));
    for (let s = -fan; s <= fan; s++) {
      if (k > len - 2 && s !== 0) continue;
      pb.set(x + s + sw, y + k, s === -fan ? r.l : s === fan ? r.d : r.b);
    }
  }
  pb.set(x, y, r.dd);
  pb.set(x + Math.round(swing * 0.2), y + 1, r.d);
}

function glowAlong(g: PixelBuffer | null, ctx: RotCtx, s0: number, s1: number, hw: (s: number) => number, rar: number, bendFn?: (s: number) => number): void {
  if (!g || rar < 2) return;
  const [r, gg, b] = rgbOf(rarityCol(rar));
  const k = rar === 2 ? 0.7 : rar === 3 ? 0.85 : 1;
  rotFill(
    g,
    ctx,
    s0 - 1.5,
    s1 + 1.5,
    (s) => hw(Math.max(s0, Math.min(s1, s))) + 2.3,
    (_s, o) => rgba(r, gg, b, Math.round(165 * k * Math.pow(1 - Math.abs(o), 1.4))),
    bendFn,
  );
}

interface BladeCfg {
  s0: number;
  len: number;
  baseHw: number;
  growth: number;
  bend?: (s: number) => number;
  fuller: boolean;
}

function bladeBody(a: WeaponDraw, ctx: RotCtx, cfg: BladeCfg): void {
  const M = METAL[a.tier];
  const rc = rarityCol(a.rar);
  const edgeTint = a.rar >= 2 ? mix(M.hl, rc, 0.55) : a.rar === 1 ? M.hl : M.l;
  const frac = a.bladeFrac ?? 1;
  const L = cfg.len * frac;
  if (L < 1) return;
  const hwf = (s: number): number => {
    const t = (s - cfg.s0) / cfg.len;
    const body = cfg.baseHw * (1 + cfg.growth * t);
    if (t < 0.74) return body;
    return Math.max(0.35, body * (1 - ((t - 0.74) / 0.26) * 0.95));
  };
  glowAlong(a.glow, ctx, cfg.s0, cfg.s0 + L, hwf, a.rar, cfg.bend);
  rotFill(
    a.pb,
    ctx,
    cfg.s0,
    cfg.s0 + L,
    hwf,
    (s, o, hw) => {
      const t = (s - cfg.s0) / cfg.len;
      if (cfg.fuller && Math.abs(o) < 0.2 && t > 0.08 && t < 0.78) return a.tier === 5 ? hex('#5fe8c0') : a.tier === 4 && a.rar >= 2 ? mix(M.d, rc, 0.5) : M.d;
      if (o > 0.6) return edgeTint;
      if (o > 0.12) return M.l;
      if (o > -0.4) return M.b;
      if (o > -0.8) return M.d;
      return M.dd;
    },
    cfg.bend,
  );
  // nicks on iron, sheen on better metal
  if (a.tier === 1) {
    const [nx, ny] = rotAt(ctx, cfg.s0 + cfg.len * 0.55, 0.6);
    a.pb.set(nx, ny, M.dd);
  } else {
    const [sx, sy] = rotAt(ctx, cfg.s0 + cfg.len * 0.3, 0.6, );
    a.pb.set(sx, sy, WHITE);
  }
  const [tx, ty] = rotAt(ctx, cfg.s0 + L, 0);
  a.pb.set(tx, ty, WHITE);
}

function scabbard(a: WeaponDraw, ctx: RotCtx, s0: number, len: number, hw: number): void {
  const tier = a.tier;
  const lac = tier >= 3 ? RED_LACQUER : LACQUER;
  const F = FITTING[tier];
  rotFill(
    a.pb,
    ctx,
    s0,
    s0 + len,
    (s) => (s > s0 + len - 1.5 ? hw * 0.8 : hw),
    (s, o) => {
      const t = s - s0;
      if (t < 1.4 || (t > len * 0.5 && t < len * 0.5 + 1) || t > len - 2) return o > 0 ? F.l : F.d;
      return o > 0.45 ? lac.l : o > -0.3 ? lac.b : lac.d;
    },
  );
}

/** Draw a hand-held weapon. Returns the tip position (sprite px). */
export function drawWeapon(a: WeaponDraw): [number, number] {
  const tier = Math.max(1, Math.min(5, a.tier || 1));
  a = { ...a, tier };
  const ctx = rotCtx(a.hx, a.hy, a.ang);
  const F = FITTING[tier];
  const Wr = WRAP[tier];
  switch (a.weapon) {
    case 'sword':
    case 'blade': {
      const sword = a.weapon === 'sword';
      const L = sword ? SWORD_LEN[tier] : BLADE_LEN[tier];
      // grip
      rotFill(a.pb, ctx, -4.6, 0.3, () => 1.0, (s, o) => (o > 0.45 ? Wr.l : o < -0.45 ? Wr.dd : Math.floor(s + 12) % 2 ? Wr.d : Wr.b));
      // pommel
      rotFill(a.pb, ctx, -6.2, -4.5, () => 1.35, (_s, o) => (tier === 5 ? (o > 0 ? JADE.l : JADE.b) : o > 0.2 ? F.l : o < -0.3 ? F.dd : F.b));
      if (tier >= 3) {
        const [px, py] = rotAt(ctx, -6, 0);
        tassel(a.pb, Math.round(px), Math.round(py) + 1, tier === 3 ? 6 : tier === 4 ? 9 : 11, TASSEL[tier], ctx.dx * 1.2, tier >= 4 ? 1 : 0);
      }
      // guard
      const gw = sword ? [0, 2.6, 3.1, 3.5, 4.4, 4.8][tier] : [0, 2.2, 2.6, 2.9, 3.4, 3.8][tier];
      rotFill(a.pb, ctx, 0.3, 1.8, () => gw, (s, o) => (o > 0.3 ? F.l : o < -0.3 ? F.d : F.b));
      if (sword && tier >= 4) {
        for (const sg of [-1, 1]) {
          const [wx, wy] = rotAt(ctx, -0.7, sg * gw);
          a.pb.set(wx, wy, F.hl);
          const [vx, vy] = rotAt(ctx, 0.3, sg * (gw + 0.8));
          a.pb.set(vx, vy, F.l);
        }
        const [gx, gy] = rotAt(ctx, 1.1, 0);
        a.pb.set(gx, gy, tier === 5 ? JADE.hl : hex('#ff5a4a'));
      } else if (!sword) {
        // round hand guard disc
        rotFill(a.pb, ctx, 0.1, 1.9, () => gw * 0.9, (s, o) => (o > 0.4 ? F.hl : o < -0.4 ? F.dd : F.b));
      } else if (tier >= 2) {
        for (const sg of [-1, 1]) {
          const [wx, wy] = rotAt(ctx, -0.5, sg * gw);
          a.pb.set(wx, wy, F.l);
        }
      }
      if (a.sheathed) {
        scabbard(a, ctx, 1.8, L + 0.5, sword ? 1.5 : 1.6);
        return rotAt(ctx, 2 + L, 0);
      }
      bladeBody(a, ctx, sword
        ? { s0: 1.8, len: L, baseHw: [0, 1.45, 1.55, 1.7, 1.9, 2.0][tier], growth: 0, fuller: tier >= 3 }
        : { s0: 1.8, len: L, baseHw: [0, 1.5, 1.6, 1.75, 1.9, 2.0][tier], growth: 0.45, bend: (s) => Math.pow((s - 1.8) / L, 2) * 3.2, fuller: tier >= 4 });
      return rotAt(ctx, 1.8 + L * (a.bladeFrac ?? 1), sword ? 0 : 3.2 * Math.pow(a.bladeFrac ?? 1, 2));
    }
    case 'spear': {
      const W = WOOD[tier];
      const shaft0 = -15;
      const shaft1 = 23;
      rotFill(a.pb, ctx, shaft0, shaft1, () => 0.9, (s, o) => {
        if (tier >= 2 && (Math.floor(s) === 6 || Math.floor(s) === -9)) return o > 0 ? F.l : F.d;
        if (tier === 1 && (Math.floor(s + 20) % 9 === 0)) return W.dd;
        return o > 0.35 ? W.l : o > -0.35 ? W.b : W.d;
      });
      // butt cap
      rotFill(a.pb, ctx, shaft0 - 1.5, shaft0, () => 1.1, (_s, o) => (o > 0 ? F.l : F.d));
      // binding ring under the head: rarity finish (shine for fine, coloured for rare and up)
      if (a.rar >= 1) rotFill(a.pb, ctx, 20.2, 21.6, () => 1.25, (_s, o) => (a.rar === 1 ? (o > 0 ? WHITE : FITTING[tier].l) : o > 0 ? mix(rarityCol(a.rar), WHITE, 0.45) : rarityCol(a.rar)));
      // tassel under the head
      const [tx0, ty0] = rotAt(ctx, 22.5, 0.6);
      tassel(a.pb, Math.round(tx0), Math.round(ty0), tier >= 4 ? 8 : 6, tier === 5 ? TASSEL[5] : TASSEL[Math.max(2, tier)], -ctx.dx * 1.5, 1);
      // head
      const M = METAL[tier];
      const Hl = 4 + tier;
      const hwMax = [0, 1.3, 1.6, 1.8, 2.0, 2.1][tier];
      const rc = rarityCol(a.rar);
      const hhw = (s: number): number => {
        const t = (s - shaft1 + 1) / Hl;
        return Math.max(0.35, hwMax * Math.pow(Math.max(0, 1 - Math.pow(2 * t - 1, 2)), 0.55)) * (t < 0 ? 0 : 1) + (t >= 0 && t <= 0.15 ? 0.3 : 0);
      };
      glowAlong(a.glow, ctx, shaft1 - 1, shaft1 + Hl, hhw, a.rar);
      rotFill(a.pb, ctx, shaft1 - 1, shaft1 + Hl, hhw, (s, o) => {
        const t = (s - shaft1 + 1) / Hl;
        if (t < 0.12) return F.b;
        if (Math.abs(o) < 0.16 && tier >= 3 && t < 0.8) return tier === 5 ? hex('#5fe8c0') : M.d;
        if (o > 0.55) return a.rar >= 2 ? mix(M.hl, rc, 0.55) : M.hl;
        if (o > 0.05) return M.l;
        if (o > -0.45) return M.b;
        return M.d;
      });
      if (tier >= 4) {
        // crescent side blades
        for (const sg of [-1, 1]) {
          const c2 = rotCtx(...rotAt(ctx, shaft1 - 1.5, 0), a.ang + sg * 62);
          rotFill(a.pb, c2, 0, 4.5, (s) => Math.max(0.4, 1.0 - s * 0.16), (_s, o) => (o > 0.3 ? M.hl : o > -0.3 ? M.l : M.d));
        }
      }
      const [px, py] = rotAt(ctx, shaft1 - 1 + Hl, 0);
      a.pb.set(px, py, WHITE);
      return [px, py];
    }
    case 'staff': {
      const W = WOOD[tier];
      const s0 = -17;
      const s1 = 18;
      rotFill(a.pb, ctx, s0, s1, () => 1.05, (s, o) => {
        const k = Math.floor(s + 20);
        if (tier === 1 && k % 7 === 0) return W.l;
        if (tier === 3 && s > 6 && s < 8.5) return o > 0 ? JADE.l : JADE.d;
        if (tier >= 4 && (Math.abs(s - 12) < 0.9 || Math.abs(s + 10) < 0.9 || Math.abs(s - 2) < 0.7)) return o > 0 ? F.hl : F.d;
        return o > 0.4 ? W.l : o > -0.35 ? W.b : o > -0.75 ? W.d : W.dd;
      });
      if (tier >= 2) {
        rotFill(a.pb, ctx, s0 - 1, s0 + 2, () => 1.25, (_s, o) => (o > 0 ? F.l : F.d));
        rotFill(a.pb, ctx, s1 - 2, s1 + 0.6, () => 1.25, (_s, o) => (o > 0 ? F.l : F.d));
      }
      const rc = rarityCol(a.rar);
      if (a.rar >= 1) rotFill(a.pb, ctx, 13.2, 14.4, () => 1.35, (_s, o) => (a.rar === 1 ? (o > 0 ? WHITE : F.l) : o > 0 ? mix(rc, WHITE, 0.45) : rc));
      if (tier === 5) {
        const [ox, oy] = rotAt(ctx, s1 + 2, 0);
        const g = a.glow;
        if (g) {
          const [r, gg, b] = a.rar >= 2 ? rgbOf(rc) : [150, 255, 225];
          for (let ring = 0; ring < 4; ring++) {
            const rad = 5 - ring;
            g.ellipse(ox, oy, rad, rad, rgba(r, gg, b, 55 + ring * 40));
          }
        }
        a.pb.ellipse(ox, oy, 2.6, 2.6, a.rar >= 2 ? mix(hex('#bffff0'), rc, 0.65) : hex('#bffff0'));
        a.pb.ellipse(ox - 0.4, oy - 0.4, 1.6, 1.6, WHITE);
        a.pb.set(ox + 1, oy + 1, hex('#5fe8c0'));
      } else if (tier === 4) {
        const [ox, oy] = rotAt(ctx, s1 + 1.5, 0);
        a.pb.ellipse(ox, oy, 1.9, 1.9, F.b);
        a.pb.set(ox - 0.6, oy - 0.6, F.hl);
        for (const sg of [-1, 1]) a.pb.set(...rotAt(ctx, s1 + 2.6, sg * 2.4), F.l);
        glowAlong(a.glow, ctx, s1 - 3, s1 + 3, () => 1.6, a.rar);
      } else if (tier === 3) {
        const [ox, oy] = rotAt(ctx, s1 + 1, 0);
        a.pb.ellipse(ox, oy, 1.4, 1.4, JADE.b);
        a.pb.set(ox - 0.5, oy - 0.5, JADE.hl);
        glowAlong(a.glow, ctx, s1 - 2, s1 + 2, () => 1.4, a.rar);
      } else glowAlong(a.glow, ctx, s1 - 3, s1, () => 1.2, a.rar);
      return rotAt(ctx, s1 + (tier >= 4 ? 3 : 1), 0);
    }
    default:
      return [a.hx, a.hy];
  }
}

/** Sword-type scabbard at the hip when the hand holds nothing (draw animation, empty). */
export function drawEmptyScabbard(pb: PixelBuffer, weapon: WeaponType, tier: number, hx: number, hy: number, ang: number): void {
  const t = Math.max(1, Math.min(5, tier));
  const ctx = rotCtx(hx, hy, ang);
  const L = weaponLength(weapon, t) - 2;
  const F = FITTING[t];
  rotFill(pb, ctx, -2.2, 0.5, () => 1.2, (_s, o) => (o > 0 ? F.l : F.d));
  scabbard({ pb, glow: null, weapon, tier: t, rar: 0, hx, hy, ang }, ctx, 0.5, L, 1.5);
}

/** Material of a fist weapon's glove / gauntlet by tier. */
export function fistGear(tier: number): { fore: Ramp; hand: Ramp; stud: Ramp | null; cloth: boolean } {
  const t = Math.max(1, Math.min(5, tier));
  switch (t) {
    case 1:
      return { fore: ramp('#e8e0c8', 0.74, 1.08), hand: ramp('#efe8d4', 0.76, 1.06), stud: null, cloth: true };
    case 2:
      return { fore: ramp('#6a4a32', 0.62, 1.3), hand: ramp('#7a5a3c', 0.62, 1.3), stud: FITTING[2], cloth: false };
    case 3:
      return { fore: ramp('#5a5a64', 0.62, 1.3), hand: METAL[2], stud: FITTING[3], cloth: false };
    case 4:
      return { fore: METAL[3], hand: METAL[3], stud: FITTING[4], cloth: false };
    default:
      return { fore: FITTING[5], hand: FITTING[5], stud: JADE, cloth: false };
  }
}

/**
 * Translucent weapon smear: the blade segment (r0..r1 from the hand) swept from one hand position / angle to another,
 * older positions fainter (drawn after the outline).
 */
export function drawSmear(pb: PixelBuffer, p0x: number, p0y: number, p1x: number, p1y: number, a0: number, a1: number, r0: number, r1: number, col: Col, strength: number): void {
  if (strength <= 0) return;
  const [r, g, b] = rgbOf(col);
  const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 0.8));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const px = p0x + (p1x - p0x) * t;
    const py = p0y + (p1y - p0y) * t;
    const fade = Math.pow(t, 1.3);
    for (let rr = r0; rr <= r1; rr += 0.7) {
      const edge = (rr - r0) / (r1 - r0);
      const alpha = Math.round(Math.min(1, strength) * 215 * fade * (0.3 + 0.7 * edge));
      if (alpha < 18) continue;
      const hotCore = edge > 0.85 && t > 0.75;
      pb.set(px + ca * rr, py + sa * rr, hotCore ? rgba(255, 255, 255, Math.min(255, alpha + 40)) : rgba(r, g, b, alpha));
    }
  }
}

/** Straight thrust streak. */
export function drawStreak(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, col: Col, strength: number): void {
  const [r, g, b] = rgbOf(col);
  const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const a = Math.round(Math.min(1, strength) * 200 * t);
    pb.set(x, y, rgba(r, g, b, a));
    if (t > 0.3) pb.set(x, y + 1, rgba(r, g, b, Math.round(a * 0.45)));
  }
}

export const SMEAR_BASE: Record<WeaponType, Col> = {
  sword: hex('#dcefff'),
  blade: hex('#ffc09a'),
  spear: hex('#eef6cc'),
  staff: hex('#f2e0a8'),
  fist: hex('#fff2c4'),
};

/** Smear colour: weapon colour, tinted by rarity colour for rare and above. */
export function smearColor(weapon: WeaponType, rar: number): Col {
  const base = SMEAR_BASE[weapon];
  return rar >= 2 ? mix(base, hex(RARITY_COLORS[Math.min(4, rar)]), 0.55) : base;
}

export { BONE, rampTone };
