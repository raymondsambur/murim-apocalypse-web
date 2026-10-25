/**
 * Head painter: neck, face (eyes, brows, nose hint, mouth, ears), 7 hair styles with strands and highlights, hats,
 * helmets and masks. Front (SE/SW) and back (NE/NW) views.
 */
import { LOOK_RANGES } from '@murim/shared';
import { hex, mix, rgba, type Col } from './color';
import { hf } from './draw';
import { Ctx, STEEL } from './charctx';
import { ramp, type Ramp } from './palette';

const EYE_DARK = hex('#2a1c22');
const IRIS = hex('#3a2a30');
const SCLERA = hex('#f1e8df');

export function paintNeck(c: Ctx): void {
  const { rig, p, pb, sh } = c;
  const nx = rig.cx + p.lean * 0.45;
  sh.clear().cap(rig.hx - 0.4, rig.hy + rig.hry - 2.2, nx, rig.shY + 1.2, 2.0).shade(pb, c.c.skin, { lit: -0.14, seed: 5, noRim: true });
}

export function paintHead(c: Ctx): void {
  const { rig, p, pb, sh, spec } = c;
  const l = spec.look;
  const style = ((l.hairStyle % LOOK_RANGES.hairStyle) + LOOK_RANGES.hairStyle) % LOOK_RANGES.hairStyle;
  const acc = ((l.accessory % LOOK_RANGES.accessory) + LOOK_RANGES.accessory) % LOOK_RANGES.accessory;
  const role = spec.role ?? null;
  const hollow = c.hollow;
  const back = rig.back;
  const female = rig.female;
  const { hx, hy, hrx, hry } = rig;
  const hair = c.c.hair;
  const skin = c.c.skin;
  const sw = p.hair;
  const noHair = style === 5 || c.special === 'hollow_monk';
  const fcx = hx + 1.2 + p.turn * 1.5;
  const seedH = l.hairColor * 7 + l.hairStyle;

  // ---- hair behind the head --------------------------------------------------------------------
  if (!noHair) {
    if (style === 2) {
      const len = female ? 17 : 14;
      const s = Math.round(sw * 0.8);
      sh.clear().poly([hx - hrx - 0.8, hy - 2, hx + hrx + 0.8, hy - 2, hx + hrx + 1.6 + s * 0.5, hy + len * 0.6, hx + hrx + 1.0 + s, hy + len, hx - hrx - 1.2 + s, hy + len + 1, hx - hrx - 1.8 + s * 0.5, hy + len * 0.6]);
      sh.shade(pb, hair, { seed: seedH });
      for (let k = -3; k <= 3; k++) sh.line(pb, hx + k * 1.7, hy, hx + k * 1.9 + s, hy + len, k % 2 ? hair.d : hair.l);
      // locks falling over the near shoulder
      if (!back) {
        sh.clear().cap(hx + hrx - 0.5, hy + 2, hx + hrx - 0.8 + s * 0.4, hy + len * 0.75, 1.5, 1.1).shade(pb, hair, { seed: seedH + 3, noRim: true });
      }
    } else if (style === 3) {
      const dir = back ? 1 : -1;
      const tx = hx - hrx - 2.5 + dir * 0.6 + sw;
      sh.clear().cap(hx - hrx + 0.8, hy - hry + 2.5, tx, hy + 4, 2.2, 2.1).cap(tx, hy + 4, tx - 1.2 + sw * 0.8, hy + 11.5, 2.1, 0.9).shade(pb, hair, { seed: seedH });
      sh.line(pb, tx + 0.3, hy + 3, tx - 0.8 + sw * 0.8, hy + 10.5, hair.hl);
    } else if (style === 4 && back) {
      for (let i = 0; i < 14; i++) {
        const xx = hx - 0.5 + Math.sin(i * 0.9) * 0.9 + sw * (i / 14);
        pb.set(xx, hy + 3 + i, i % 3 === 2 ? hair.d : hair.b);
        pb.set(xx + 1, hy + 3 + i, i % 3 === 0 ? hair.l : hair.d);
      }
    } else if (style === 6) {
      // futou wings behind the head
      const capC = ramp('#26222c', 0.7, 1.55);
      sh.clear().poly([hx - hrx + 0.5, hy - hry + 1, hx - hrx - 4.5 + sw * 0.5, hy - hry - 0.5 + 2.5, hx - hrx - 7 + sw, hy - hry + 6.5, hx - hrx - 1.5, hy - hry + 4.5]).shade(pb, capC);
    }
  }

  // ---- skull ---------------------------------------------------------------------------------------
  const jaw = female ? 0.62 : 0.7;
  sh.clear().ell(hx, hy, hrx, hry).poly([hx - hrx * jaw, hy + hry * 0.45, hx + hrx * jaw, hy + hry * 0.45, hx + hrx * 0.34, hy + hry + 0.9, hx - hrx * 0.34, hy + hry + 0.9]);
  sh.shade(pb, skin, { seed: 7, lit: 0.03, ao: 0.1 });
  // ears
  if (!back) {
    sh.clear().ell(hx - hrx + 0.1, hy + 1.2, 1.2, 1.9).shade(pb, skin, { seed: 2, noRim: true });
    pb.set(hx - hrx + 0.4, hy + 1.2, skin.dd);
    sh.clear().ell(hx + hrx - 0.2, hy + 1.2, 0.9, 1.7).shade(pb, skin, { seed: 2, lit: -0.25, noRim: true });
  } else {
    pb.set(hx - hrx + 0.6, hy + 1, skin.b);
    pb.set(hx - hrx + 0.6, hy + 2, skin.d);
  }

  // ---- face ----------------------------------------------------------------------------------------
  if (!back) {
    const ey = Math.round(hy + 0.6);
    const x0 = Math.round(fcx - 3);
    const x1 = Math.round(fcx + 1.2);
    const hairD = mix(hair.d, EYE_DARK, 0.4);
    if (hollow) {
      for (const xx of [x0, x1]) {
        pb.rect(xx, ey - 0.5, 2, 2, hex('#14101a'));
        pb.set(xx + (p.turn > 0 ? 1 : 0), ey, hex('#b866ff'));
        pb.set(xx + (p.turn > 0 ? 1 : 0), ey + 1, hex('#e9c8ff'));
        c.glow.set(xx, ey, rgba(180, 100, 255, 150));
        c.glow.set(xx + 1, ey, rgba(180, 100, 255, 110));
      }
      pb.hline(x0 - 1, x0 + 1, ey - 2, hex('#2a1a38'));
      pb.hline(x1, x1 + 2, ey - 2, hex('#2a1a38'));
      pb.hline(fcx - 1.5, fcx + 1.5, ey + 4, hex('#2a1a38'));
      pb.set(fcx + 1, ey + 5, rgba(150, 70, 220));
      pb.set(fcx + 1, ey + 6, rgba(110, 50, 170));
      pb.set(fcx - 2, ey + 5, rgba(120, 60, 190));
    } else {
      c.eyes = [[x0, ey], [x1, ey]];
      for (const xx of [x0, x1]) {
        if (p.blink) {
          pb.set(xx, ey + 1, EYE_DARK);
          pb.set(xx + 1, ey + 1, EYE_DARK);
        } else {
          pb.set(xx, ey, EYE_DARK);
          pb.set(xx + 1, ey, EYE_DARK);
          const iris = p.turn >= 0;
          pb.set(xx, ey + 1, iris ? SCLERA : IRIS);
          pb.set(xx + 1, ey + 1, iris ? IRIS : SCLERA);
        }
        if (female) pb.set(xx === x0 ? xx - 1 : xx + 2, ey, EYE_DARK);
      }
      // brows
      const bandit = c.bandit;
      pb.set(x0, ey - 2 + (bandit ? 0 : 0), hairD);
      pb.set(x0 + 1, ey - 2 - (bandit ? 0 : 0) + (bandit ? 1 : 0), hairD);
      pb.set(x1, ey - 2 + (bandit ? 1 : 0), hairD);
      pb.set(x1 + 1, ey - 2, hairD);
      if (!female) {
        pb.set(x0 - 1, ey - 2, mix(hairD, skin.b, 0.5));
        pb.set(x1 + 2, ey - 2, mix(hairD, skin.b, 0.5));
      }
      // nose, mouth
      pb.set(fcx + 0.3, ey + 2, skin.hl);
      pb.set(fcx + 0.6, ey + 3, skin.d);
      const lip = mix(skin.d, hex(female ? '#c4505e' : '#a04a4a'), female ? 0.75 : 0.55);
      if (p.talk) {
        pb.rect(fcx - 0.6, ey + 4.4, 2, 2, hex('#5a1c24'));
        pb.set(fcx - 0.6, ey + 4.4, SCLERA);
      } else {
        pb.set(fcx - 0.6, ey + 4.6, lip);
        pb.set(fcx + 0.4, ey + 4.6, lip);
        if (female) pb.set(fcx - 0.2, ey + 5.4, mix(lip, skin.b, 0.5));
      }
      if (female || l.skin < 2) {
        const blush = mix(skin.b, hex('#e07a8a'), 0.3);
        pb.set(x0 - 0.5, ey + 3, blush);
        pb.set(x1 + 2.5, ey + 3, blush);
      }
    }
    // shadow under the hairline on the forehead
    sh.clear();
  }

  // ---- hair cap ------------------------------------------------------------------------------------
  if (!noHair) {
    const hrx2 = hrx + (back ? 0.5 : 0.9);
    const hry2 = hry + (back ? 0.5 : 0.8);
    sh.clear().fill(hx - hrx2 - 1, hy - hry2 - 1, hx + hrx2 + 1, hy + hry2, (x, y) => {
      const nx = (x + 0.5 - hx) / hrx2;
      const ny = (y + 0.5 - (hy - 0.4)) / hry2;
      if (nx * nx + ny * ny > 1) return false;
      if (back) return y + 0.5 < hy + hry * 0.92;
      const fringe = Math.floor(hf(x, 3, seedH) * 1.6);
      const hairline = hy - hry * 0.34 - (x + 0.5 - fcx) * 0.22 + fringe;
      if (y + 0.5 < hairline) return true;
      // temple / sideburn hair on both sides
      if (nx < -0.62 && y < hy + 2.5) return true;
      if (nx > 0.8 && y < hy - 0.5) return true;
      return false;
    });
    sh.shade(pb, hair, { seed: seedH + 11, lit: 0.04, ao: 0.1 });
    // strands + highlight
    for (let k = -4; k <= 4; k++) {
      const sx = hx + k * 1.35;
      sh.line(pb, sx, hy - hry - 0.5, sx + (back ? k * 0.35 : -(k * 0.2) + 0.6), hy - hry * 0.2 + (back ? 4 : 0), k % 2 ? hair.d : hair.b);
    }
    sh.line(pb, hx - hrx * 0.7, hy - hry + 1.2, hx + hrx * 0.1, hy - hry - 0.2, hair.hl);
    sh.line(pb, hx - hrx * 0.4, hy - hry + 2.4, hx - hrx * 0.1, hy - hry + 0.8, hair.hl);
    switch (style) {
      case 0:
        // short crop: a few spikes on top
        for (let k = -2; k <= 2; k++) pb.set(hx + k * 1.8 + 0.5, hy - hry - 0.9 + (k % 2 ? 0 : -1), k % 2 ? hair.b : hair.l);
        break;
      case 1: {
        // topknot with band
        sh.clear().ell(hx + 0.4 + sw * 0.3, hy - hry - 3.3, 2.9, 3.1).shade(pb, hair, { seed: seedH + 5 });
        pb.hline(hx - 1.4, hx + 2.4, hy - hry - 0.3, c.c.sash.b);
        pb.hline(hx - 1.4, hx + 2.4, hy - hry + 0.7, c.c.sash.d);
        pb.set(hx + 0.4, hy - hry - 6, hair.hl);
        break;
      }
      case 3:
        pb.rect(hx - hrx + 0.6, hy - hry + 1.6, 2, 2, c.c.sash.b);
        pb.set(hx - hrx + 0.6, hy - hry + 1.6, c.c.sash.l);
        break;
      case 4: {
        // braid over the near shoulder
        if (!back) {
          const bx = hx + hrx - 0.3;
          for (let i = 0; i < 15; i++) {
            const xx = bx + Math.sin(i * 0.7) * 0.7 + sw * (i / 15) * 0.8 + i * 0.06;
            const yy = hy + 2 + i;
            pb.set(xx, yy, i % 3 === 0 ? hair.l : i % 3 === 1 ? hair.b : hair.d);
            pb.set(xx + 1, yy, i % 3 === 0 ? hair.b : hair.d);
            pb.set(xx + 2, yy, hair.dd);
          }
          pb.rect(bx + sw * 0.8 + 0.8, hy + 17, 3, 1, c.c.sash.b);
          pb.set(bx + sw * 0.8 + 1.4, hy + 18, c.c.sash.d);
        }
        break;
      }
      case 6: {
        // scholar cap (futou) with a short bun
        const capC = ramp('#26222c', 0.7, 1.55);
        sh.clear().fill(hx - hrx - 0.8, hy - hry - 1.6, hx + hrx + 0.8, hy - hry + 3.4, (x, y) => {
          const nx = (x + 0.5 - hx) / (hrx + 0.9);
          return Math.abs(nx) <= 1 && y >= Math.floor(hy - hry - 1 + nx * nx * 1.2) && y < hy - hry + 3.6;
        });
        sh.shade(pb, capC, { seed: 4 });
        sh.clear().poly([hx - 3, hy - hry - 1.2, hx + 3, hy - hry - 1.2, hx + 2.4, hy - hry - 5.2, hx - 2.4, hy - hry - 5.2]).shade(pb, capC);
        pb.hline(hx - hrx, hx + hrx, hy - hry + 3, capC.dd);
        pb.set(hx - 1, hy - hry - 4, capC.hl);
        break;
      }
      default:
        break;
    }
  } else if (!hollow && !back) {
    pb.set(hx - 1.4, hy - hry + 1, skin.hl);
    pb.set(hx - 0.4, hy - hry + 0.6, skin.hl);
    pb.set(hx - 2.4, hy - hry + 2, skin.l);
  }

  // ---- hats, helmets, masks, accessories --------------------------------------------------------------
  paintHeadgear(c, acc, role, back);
}

function paintHeadgear(c: Ctx, acc: number, role: string | null, back: boolean): void {
  const { rig, p, pb, sh, spec } = c;
  const { hx, hy, hrx, hry } = rig;
  const sw = p.hair;
  const sp = c.special;
  if (role === 'guard' && sp === 'none') {
    // conical steel helmet, red plume
    sh.clear().poly([hx - hrx - 1.3, hy - 0.5, hx - hrx + 0.2, hy - hry - 2.5, hx, hy - hry - 6.2, hx + hrx - 0.2, hy - hry - 2.5, hx + hrx + 1.3, hy - 0.5, hx + hrx + 0.5, hy - 0.5, hx - hrx - 0.5, hy - 0.5]);
    sh.shade(pb, STEEL, { seed: 3 });
    pb.hline(hx - hrx - 1.3, hx + hrx + 1.3, hy - 0.5, STEEL.dd);
    pb.set(hx - 2, hy - hry - 3, STEEL.hl);
    pb.set(hx - 1, hy - hry - 4.2, STEEL.hl);
    sh.clear().cap(hx, hy - hry - 5.2, hx - 0.5 + sw * 0.6, hy - hry - 8.4, 1.1, 0.8).shade(pb, ramp('#c8452d', 0.62, 1.3), { noRim: true });
    pb.set(hx - 0.5 + sw * 0.6, hy - hry - 9, hex('#ff8a6a'));
    // cheek guards
    pb.vline(hx - hrx - 0.4, hy - 0.5, hy + 3, STEEL.d);
    if (!back) pb.vline(hx + hrx + 0.6, hy - 0.5, hy + 2.4, STEEL.dd);
    return;
  }
  const role2 = role;
  const hatRole = role2 === 'merchant' || role2 === 'wanderer';
  if ((acc === 2 || hatRole) && sp === 'none' && role2 !== 'guard') {
    const straw = role2 === 'merchant' ? ramp('#c8a45a', 0.7, 1.22) : ramp('#cdb676', 0.7, 1.2);
    const wide = role2 === 'merchant' ? 11 : 11.5;
    const top = hy - hry - 4.6;
    const brimY = hy - hry + 3.2;
    // cone
    sh.clear().poly([hx + 0.3, top, hx + wide, brimY, hx + wide * 0.6, brimY + 1.8, hx - wide * 0.6, brimY + 1.8, hx - wide, brimY]);
    sh.shade(pb, straw, { seed: 8, ao: 0.2 });
    // weave
    for (let k = -4; k <= 4; k++) sh.line(pb, hx + 0.3 + k * 0.4, top + 0.5, hx + 0.3 + k * 2.6, brimY + 1, k % 2 ? straw.d : straw.l);
    for (let r = 1; r < 3; r++) sh.line(pb, hx - wide, brimY - r * 1.6 + 1.6, hx + wide, brimY - r * 1.6 + 1.6, straw.d);
    pb.hline(hx - wide * 0.6, hx + wide * 0.6, brimY + 1.8, straw.dd);
    pb.set(hx + 0.3, top, straw.hl);
    pb.set(hx - 0.7, top + 1, straw.hl);
    if (role2 === 'merchant') pb.hline(hx - 2, hx + 3, brimY - 1, hex('#8a2a2a'));
    if (!back) {
      pb.set(hx - hrx + 0.4, hy + 2.6, hex('#6a2a2a'));
      pb.set(hx - hrx + 0.4, hy + 3.6, hex('#6a2a2a'));
      pb.set(hx + hrx - 0.4, hy + 2.6, hex('#6a2a2a'));
      pb.set(hx + hrx - 0.4, hy + 3.6, hex('#5a2222'));
    }
  } else if (acc === 1 || c.bandit) {
    const band = c.bandit ? ramp('#8a2a2a', 0.62, 1.5) : c.c.sash;
    for (let x = Math.floor(hx - hrx - 0.5); x <= Math.ceil(hx + hrx + 0.5); x++) {
      const nx = (x + 0.5 - hx) / (hrx + 0.5);
      if (Math.abs(nx) > 1) continue;
      const yy = Math.round(hy - hry * 0.4 - nx * 0.8 + 0.5);
      pb.set(x, yy, x < hx ? band.l : band.b);
      pb.set(x, yy + 1, x < hx ? band.b : band.d);
      pb.set(x, yy + 2, band.d);
    }
    // knot + tails fluttering
    const kx = hx - hrx - 1.2;
    pb.set(kx, hy - 1.5, band.b);
    for (let i = 0; i < 5; i++) {
      pb.set(kx - 1 - i * 0.7 + sw * (i / 5), hy - 1 + i * 0.9, i % 2 ? band.d : band.b);
      pb.set(kx - 2 - i * 0.6 + sw * (i / 5), hy + i * 0.9, band.dd);
    }
  } else if (acc === 4) {
    const gold = hex('#d9b867');
    pb.line(hx + 2.5, hy - hry - 1.5, hx - 3.5, hy - hry + 2.5, gold);
    pb.line(hx + 2.5, hy - hry - 0.5, hx - 3.5, hy - hry + 3.5, hex('#9a7a38'));
    pb.set(hx + 2.5, hy - hry - 2.4, hex('#ffe6a0'));
    pb.set(hx + 3.5, hy - hry - 1.4, hex('#c8452d'));
    pb.set(hx + 3.5, hy - hry - 0.4, hex('#ffcf8a'));
  }
  if ((acc === 3 || c.bandit) && !back && acc !== 2) {
    const mask = c.bandit ? ramp('#7a2a2a', 0.62, 1.4) : ramp('#2c2a34', 0.62, 1.6);
    sh.clear().fill(hx - hrx, hy + 2, hx + hrx, hy + hry + 1, (x, y) => {
      const nx = (x + 0.5 - hx) / hrx;
      const ny = (y + 0.5 - hy) / hry;
      return nx * nx + ny * ny <= 1.05 && y >= Math.round(hy + 2.4 + Math.abs(nx) * 0.4 - 0.2);
    });
    sh.shade(pb, mask, { seed: 6 });
    pb.hline(hx - hrx + 1, hx + hrx - 1, hy + 2.4, mask.hl);
  }
  if (sp === 'hollow_lord') {
    for (let i = -3; i <= 3; i++) {
      const hh = 4 + (Math.abs(i) % 2 ? 1 : 3);
      for (let k = 0; k < hh; k++) pb.set(hx + i * 1.7, hy - hry - 1 - k, k > hh - 2 ? hex('#d6a0ff') : hex('#2a1a38'));
    }
  }
  if ((spec.role === 'master' || spec.role === 'elder') && sp === 'none' && !back) {
    // long beard / moustache
    const white = ramp('#ece8f0', 0.78, 1.04);
    const fx = hx + 1.2 + p.turn * 1.5;
    sh.clear().poly([fx - 3.2, hy + 3.4, fx + 3.4, hy + 3.4, fx + 2.2, hy + hry + 2.5 + (spec.role === 'master' ? 5 : 2), fx + 0.2, hy + hry + 5 + (spec.role === 'master' ? 5 : 2), fx - 1.8, hy + hry + 2.5 + (spec.role === 'master' ? 5 : 2)]);
    sh.shade(pb, white, { seed: 4, noRim: true });
    pb.hline(fx - 2.5, fx + 2.5, hy + 3.6, white.l);
  }
}

export type { Col };
