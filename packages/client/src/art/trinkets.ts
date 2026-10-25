/**
 * Gear accessories (pendant, charm, bracer, silk tails, coin, seal), work tools and the craft cauldron.
 * The accessory shape is chosen by the attribute it boosts; the tier adds metal and gems.
 */
import { type StatKey } from '@murim/shared';
import { type ToolKind } from './anim';
import { hex, mix, rgba } from './color';
import { Ctx, LEATHER, OY } from './charctx';
import { rotAt, rotCtx, rotFill } from './figure';
import { BONE, COIN, FITTING, JADE, METAL, SEAL, TASSEL, TRINKET, WOOD, rarityCol } from './gear';
import { tassel } from './weapons';
import { ramp } from './palette';
import { rampTone } from './draw';
import type { ArmGeom } from './charbody';

const CORD = ramp('#5a3a28', 0.6, 1.4);

function gem(c: Ctx, x: number, y: number): void {
  const g = c.g;
  const col = rarityCol(Math.max(2, g.aR));
  c.pb.set(x, y, col);
  c.pb.set(x - 0.6, y - 0.6, mix(col, hex('#ffffff'), 0.6));
  if (g.aR >= 2) c.glow.set(x, y, (col & 0x00ffffff) | (150 << 24));
}

/** Items that hang on the chest or the hips (painted over the torso, under the arms). */
export function paintWornTrinket(c: Ctx): void {
  const k: StatKey | null = c.g.aK;
  if (!k) return;
  const { rig, pb, sh, p } = c;
  const t = Math.max(1, c.g.aT);
  const M = TRINKET[t];
  const cx = rig.cx + rig.lx * 0.7;
  const sY = rig.shY;
  const w = rig.waistY;
  const back = rig.back;
  switch (k) {
    case 'spirit': {
      // jade pendant on a cord
      if (!back) {
        pb.line(cx - 2.6, sY, cx, sY + 7, CORD.b);
        pb.line(cx + 2.6, sY, cx, sY + 7, CORD.d);
        const px = cx + p.sash * 0.1;
        const py = sY + 9.4;
        if (t >= 3) sh.clear().ell(px, py, 3.1, 3.4).shade(pb, M, { seed: 4, noRim: true });
        sh.clear().ell(px, py, 2.0, 2.4).shade(pb, JADE, { seed: 3 });
        pb.set(px - 0.5, py - 1.2, JADE.hl);
        pb.set(px, py, JADE.dd);
        if (t >= 5) gem(c, px, py + 2.4);
        if (c.g.aR >= 2) c.glow.set(px, py, (JADE.l & 0x00ffffff) | (140 << 24));
      } else pb.hline(cx - 2.2, cx + 2.2, sY + 0.4, CORD.b);
      break;
    }
    case 'vitality': {
      // bone charm necklace
      if (!back) {
        pb.line(cx - 3, sY, cx - 1.4, sY + 5, CORD.b);
        pb.line(cx + 3, sY, cx + 1.4, sY + 5, CORD.d);
        pb.hline(cx - 1.4, cx + 1.4, sY + 5, CORD.b);
        for (let i = -1; i <= 1; i++) {
          const x = cx + i * 1.7;
          const len = i === 0 ? 4.5 : 3.2;
          for (let y = 0; y < len; y++) pb.set(x, sY + 5.6 + y, y < 1 ? BONE.hl : y > len - 1.5 ? BONE.d : BONE.b);
          pb.set(x, sY + 5.6, t >= 2 ? M.b : BONE.hl);
        }
        if (t >= 4) gem(c, cx, sY + 10.4);
        if (t >= 2) {
          pb.set(cx - 3, sY + 2.4, M.l);
          pb.set(cx + 3, sY + 2.4, M.b);
        }
      } else pb.hline(cx - 2.6, cx + 2.6, sY + 0.4, CORD.b);
      break;
    }
    case 'agility': {
      // two long silk tails from the sash knot (drawn here, sways with the sash)
      const s = c.c.sash;
      const kx = back ? rig.cx - 1 : rig.cx + rig.wa - 0.6;
      const ky = w + 0.8;
      const n = 17 + t;
      for (const tail of [0, 1]) {
        const ph = tail * 1.9 + 0.4;
        for (let i = 0; i < n; i++) {
          const f = i / n;
          const x = kx + (tail ? 1.8 : -0.3) + Math.sin(i * 0.5 + ph) * (0.8 + f * 1.2) + p.sash * f * 1.4 + (tail ? f * 1.6 : -f * 0.6);
          const y = ky + 2 + i * 0.95 + f * 0.5;
          const col = i % 5 === 4 ? s.hl : tail ? s.l : s.b;
          pb.set(x, y, col);
          pb.set(x + 1, y, tail ? s.b : s.d);
          if (i > 3 && i < n - 2 && i % 3 === 0) pb.set(x + 2, y, s.d);
        }
        const ex = kx + (tail ? 1.8 : -0.3) + Math.sin(n * 0.5 + ph) * 2 + p.sash * 1.4 + (tail ? 1.6 : -0.6);
        const ey = ky + 2 + n * 0.95 + 0.5;
        if (t >= 3) {
          pb.rect(ex - 0.5, ey - 1, 3, 2, TRINKET[t].b);
          pb.set(ex - 0.5, ey - 1, TRINKET[t].hl);
        }
        if (t >= 5 && tail) gem(c, ex + 1, ey + 1.4);
      }
      break;
    }
    case 'fortune': {
      // lucky coin on a cord at the belt
      const x = cx - rig.wa - 0.4;
      const y0 = w + 1.2;
      pb.vline(x, y0, y0 + 4, CORD.b);
      const coin = t >= 4 ? COIN : t >= 3 ? ramp('#cfd6e0', 0.66, 1.25) : ramp('#b0733a', 0.62, 1.3);
      sh.clear().ell(x, y0 + 6.2, 2.6, 2.6).shade(pb, coin, { seed: 6 });
      pb.rect(x - 0.6, y0 + 5.6, 1.2, 1.2, coin.dd);
      pb.set(x - 1.4, y0 + 4.9, coin.hl);
      tassel(pb, Math.round(x), Math.round(y0 + 8.6), 5, TASSEL[Math.min(5, t + 1)], p.sash * 0.4, 1);
      if (t >= 5) gem(c, x + 2, y0 + 4.4);
      if (c.g.aR >= 3) c.glow.set(x, y0 + 6, (COIN.l & 0x00ffffff) | (150 << 24));
      break;
    }
    case 'insight': {
      // scholar's seal with a tassel at the hip
      const x = cx - rig.wa - 0.8;
      const y0 = w + 1.4;
      pb.vline(x, y0, y0 + 2.4, CORD.b);
      const body = t >= 4 ? JADE : SEAL;
      sh.clear().poly([x - 2, y0 + 2.4, x + 2, y0 + 2.4, x + 2, y0 + 6.6, x - 2, y0 + 6.6]).shade(pb, body, { seed: 7 });
      pb.hline(x - 2, x + 2, y0 + 2.4, t >= 2 ? TRINKET[Math.max(2, t)].l : body.l);
      pb.set(x - 1, y0 + 4, body.hl);
      tassel(pb, Math.round(x), Math.round(y0 + 6.8), 4 + t, TASSEL[Math.min(5, t + 1)], p.sash * 0.4, 1);
      if (t >= 4) gem(c, x + 2.2, y0 + 3);
      if (c.g.aR >= 3) c.glow.set(x, y0 + 4, (rarityCol(c.g.aR) & 0x00ffffff) | (130 << 24));
      break;
    }
    default:
      break;
  }
}

/** The might trinket: an iron bracer / ring on the near forearm (painted after the arm). */
export function paintArmTrinket(c: Ctx, geom: ArmGeom): void {
  if (c.g.aK !== 'might') return;
  const t = Math.max(1, c.g.aT);
  const M = TRINKET[t];
  const { pb, sh } = c;
  const x0 = geom.jx + (geom.ex - geom.jx) * 0.38;
  const y0 = geom.jy + (geom.ey - geom.jy) * 0.38;
  sh.clear().cap(x0, y0, geom.ex - (geom.ex - geom.jx) * 0.12, geom.ey - (geom.ey - geom.jy) * 0.12, 2.5, 2.4).shade(pb, t === 1 ? ramp('#6a6a72', 0.6, 1.4) : M, { seed: 5 });
  if (t >= 2) {
    pb.set(x0 + 0.5, y0, M.hl);
    pb.set((x0 + geom.ex) / 2, (y0 + geom.ey) / 2, M.dd);
  }
  if (t >= 4) {
    // spikes
    const mx = (x0 + geom.ex) / 2;
    const my = (y0 + geom.ey) / 2;
    pb.set(mx + 2.4, my - 0.6, M.hl);
    pb.set(mx - 2.4, my - 0.6, M.l);
  }
  if (t >= 5) gem(c, (x0 + geom.ex) / 2, (y0 + geom.ey) / 2 - 0.4);
  if (c.g.aR >= 3) c.glow.set((x0 + geom.ex) / 2, (y0 + geom.ey) / 2, (rarityCol(c.g.aR) & 0x00ffffff) | (150 << 24));
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

export function paintTool(c: Ctx, tool: ToolKind, hx: number, hy: number, ang: number): void {
  const { pb } = c;
  const ctx = rotCtx(hx, hy, ang);
  const W = WOOD[1];
  const M = METAL[2];
  const shaft = (s0: number, s1: number, hw = 0.9): void => rotFill(pb, ctx, s0, s1, () => hw, (s, o) => (o > 0.35 ? W.l : o > -0.4 ? W.b : W.d));
  switch (tool) {
    case 'hammer': {
      shaft(-3, 13);
      rotFill(pb, ctx, 10.5, 14.5, () => 2.6, (_s, o) => (o > 0.5 ? M.hl : o > -0.1 ? M.l : o > -0.6 ? M.b : M.d));
      break;
    }
    case 'hoe': {
      shaft(-3, 15.5);
      rotFill(pb, ctx, 14.5, 17.4, () => 3.4, (_s, o) => (o > 0.4 ? M.l : o > -0.4 ? M.b : M.d));
      break;
    }
    case 'pick': {
      shaft(-3, 14);
      rotFill(pb, ctx, 12.8, 14.6, (s) => 4.6 - Math.abs(s - 13.7) * 0.2, (_s, o) => (o > 0.45 ? M.hl : o > -0.3 ? M.l : M.d), undefined);
      for (const sg of [-1, 1]) pb.set(...rotAt(ctx, 13.7, sg * 5), M.dd);
      break;
    }
    case 'sickle': {
      shaft(-3, 4, 0.9);
      rotFill(pb, ctx, 4, 12.5, (s) => 1.1 - (s - 4) * 0.05, (_s, o) => (o > 0.3 ? M.hl : o > -0.3 ? M.l : M.d), (s) => ((s - 4) * (s - 4)) * 0.14);
      break;
    }
    case 'broom': {
      shaft(-5, 15.5, 0.8);
      const straw = ramp('#c8a45a', 0.66, 1.25);
      rotFill(pb, ctx, 14.5, 22, (s) => 1.6 + (s - 14.5) * 0.28, (s, o, _hw, x, y) => ((x + y + Math.floor(s)) % 3 === 0 ? straw.d : o > 0.3 ? straw.l : straw.b));
      const ba = rotAt(ctx, 15, -1.6);
      const bb = rotAt(ctx, 15, 1.6);
      pb.line(ba[0], ba[1], bb[0], bb[1], hex('#6a4a32'));
      break;
    }
    case 'cloth': {
      const x = Math.round(hx);
      const y = Math.round(hy);
      pb.rect(x - 1, y - 1, 5, 3, hex('#efe6d2'));
      pb.rect(x - 1, y + 2, 3, 1, hex('#d8cdb4'));
      pb.set(x - 1, y - 1, hex('#ffffff'));
      break;
    }
    case 'fan': {
      const [fx, fy] = rotAt(ctx, 5, 0);
      const fc = ramp('#c8452d', 0.62, 1.3);
      c.sh.clear().ell(fx, fy, 4.4, 4.0).shade(pb, fc, { seed: 3, noRim: true });
      for (let k = -3; k <= 3; k++) c.sh.line(pb, fx, fy + 3.6, fx + k * 1.2, fy - 3.6, k % 2 ? fc.dd : fc.hl);
      pb.line(hx, hy, fx, fy + 2.4, WOOD[2].b);
      break;
    }
    case 'chop': {
      shaft(-2, 9, 0.5);
      const [bx, by] = rotAt(ctx, 1, 1.1);
      pb.set(bx, by, W.l);
      break;
    }
    case 'bowl': {
      const bw = ramp('#e6eef4', 0.7, 1.1);
      c.sh.clear().ell(hx + 0.4, hy - 1.4, 3.3, 2.1).shade(pb, bw, { seed: 3 });
      pb.hline(hx - 2.6, hx + 3.4, hy - 2.6, bw.hl);
      pb.hline(hx - 1.6, hx + 2.4, hy - 2.2, hex('#f6f0dc'));
      pb.set(hx - 0.6, hy - 2.8, hex('#ffffff'));
      pb.set(hx + 1.4, hy - 2.8, hex('#f6f0dc'));
      pb.hline(hx - 1.4, hx + 2.2, hy - 0.2, hex('#5a7ab0'));
      break;
    }
    case 'abacus': {
      const fr = ramp('#6a4a2e', 0.6, 1.4);
      const x0 = Math.round(hx - 2);
      const y0 = Math.round(hy - 6);
      pb.rect(x0, y0, 9, 7, fr.b);
      pb.rect(x0 + 1, y0 + 1, 7, 5, fr.dd);
      pb.hline(x0, x0 + 8, y0, fr.l);
      for (let r = 0; r < 3; r++) {
        pb.hline(x0 + 1, x0 + 7, y0 + 2 + r * 1.5, fr.d);
        for (let k = 0; k < 3; k++) pb.set(x0 + 1.5 + ((k * 2 + r) % 5), y0 + 1.6 + r * 1.5, k % 2 ? hex('#e8c860') : hex('#c8452d'));
      }
      break;
    }
    case 'ladle': {
      shaft(-3, 9.5, 0.85);
      const [bx, by] = rotAt(ctx, 10.5, 0);
      c.sh.clear().ell(bx, by, 2.4, 1.9).shade(pb, METAL[1], { seed: 3 });
      pb.set(bx, by - 0.4, hex('#7fe0a0'));
      break;
    }
    default:
      break;
  }
}

/** A small iron cauldron in front of the crafter. */
export function paintCauldron(c: Ctx, frame: number): void {
  const { pb, sh, rig } = c;
  const cx = rig.cx + 14.5;
  const iron = ramp('#43434d', 0.6, 1.6);
  for (const lx of [-4.4, 4.4]) pb.rect(cx + lx - 0.6, 50 + OY, 1.4, 2.4, iron.dd);
  sh.clear().ell(cx, 46.4 + OY, 6.6, 5.2).shade(pb, iron, { seed: 5 });
  sh.clear().ell(cx, 41.6 + OY, 6.8, 2.5).shade(pb, iron, { seed: 6, lit: -0.12 });
  const liq = ramp('#59c98a', 0.62, 1.4);
  sh.clear().ell(cx, 41.6 + OY, 5.2, 1.7).shade(pb, liq, { seed: 7, noRim: true });
  const bub = frame % 3;
  pb.set(cx - 2 + bub, 41 + OY, liq.hl);
  pb.set(cx + 1 - bub * 0.5, 41.8 + OY, liq.hl);
  c.glow.set(cx, 41.6 + OY, rgba(120, 255, 170, 120));
  c.glow.set(cx - 1, 41.6 + OY, rgba(120, 255, 170, 80));
  c.glow.set(cx + 1, 41.6 + OY, rgba(120, 255, 170, 80));
  pb.hline(cx - 6, cx - 3, 44 + OY, iron.l);
}

export { LEATHER, rampTone };
