/**
 * Item icons for materials, consumables and manuals (weapons, outfits and accessories are in itemicons.ts). Colours come from
 * the item definition (`def.color`) wherever the data already names one, so an icon always matches its tooltip chip. Pure.
 */
import { SKILLS, type ItemDef } from '@murim/shared';
import { hex, mix } from './color';
import { hf, shadedBlob } from './draw';
import { BONE, FITTING } from './gear';
import { ramp, type Ramp } from './palette';
import { PixelBuffer } from './pixel';
import { CORD, WHITE, box, cap, ell, fillShape, finish, halo, line, newIcon, or, poly, px, sub, type ItemIcon } from './itemkit';

const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function materialIcon(def: ItemDef): ItemIcon {
  const { pb, glow } = newIcon();
  const base = ramp(def.color, 0.62, 1.3);
  switch (def.id) {
    case 'herb': {
      // a sprig of leaves on a stem with a few roots and a pale bud
      const stem = ramp('#4f8a3a', 0.62, 1.3);
      line(pb, 20, 36, 20, 12, stem.b);
      line(pb, 21, 36, 21, 12, stem.d);
      for (const [x, y] of [[17, 36], [23, 37], [15, 38], [25, 38]] as const) line(pb, 20, 35, x, y, CORD.b);
      for (let i = 0; i < 4; i++) {
        const y = 30 - i * 5.5;
        fillShape(pb, poly([20, y, 8 + i * 1.5, y - 7, 11 + i * 1.5, y - 1]), base, { seed: i, noise: 0.1 });
        fillShape(pb, poly([21, y, 33 - i * 1.5, y - 7, 30 - i * 1.5, y - 1]), base, { seed: i + 4, noise: 0.1 });
        line(pb, 20, y, 12 + i * 1.5, y - 4, base.dd);
        line(pb, 21, y, 29 - i * 1.5, y - 4, base.dd);
      }
      pb.ellipse(20.5, 9, 2.4, 2.8, hex('#f4f0d0'));
      px(pb, 19, 8, WHITE);
      px(pb, 21, 11, hex('#cfc58a'));
      halo(glow, 20.5, 9, 7, hex('#c8ffd0'), 0.5);
      break;
    }
    case 'herb_rare': {
      // a hundred-year ginseng: a man-shaped root, rootlet hairs and a leafy top with red berries
      const root = ramp('#d9a35a', 0.64, 1.25);
      fillShape(pb, ell(20, 16, 4.4, 4.4), root, { seed: 3, noise: 0.1 });
      fillShape(pb, cap(20, 18, 20, 29, 4.6, 3.4), root, { seed: 4, noise: 0.1 });
      fillShape(pb, cap(17, 20, 9, 27, 1.8, 1.2), root, { seed: 5 });
      fillShape(pb, cap(23, 20, 31, 27, 1.8, 1.2), root, { seed: 6 });
      fillShape(pb, cap(18.5, 28, 15, 36, 2.2, 1.2), root, { seed: 7 });
      fillShape(pb, cap(21.5, 28, 25, 36, 2.2, 1.2), root, { seed: 8 });
      for (const [x, y] of [[13, 38], [17, 38], [24, 38], [28, 38], [20, 39]] as const) line(pb, 20, 34, x, y, root.d);
      for (let y = 14; y < 28; y += 3) line(pb, 17, y, 23, y + 1, root.d);
      const leaf = ramp('#4f9a3a', 0.62, 1.3);
      line(pb, 20, 12, 20, 6, leaf.d);
      for (const [dx, dy] of [[-6, -3], [0, -6], [6, -3]] as const) {
        fillShape(pb, ell(20 + dx, 6 + dy + 3, 3.2, 1.7), leaf, { seed: dx + 9, noise: 0.08 });
      }
      for (const [x, y] of [[17, 7], [23, 7], [20, 4]] as const) {
        px(pb, x, y, hex('#e0443a'));
      }
      break;
    }
    case 'ore_iron':
    case 'ore_silver': {
      const silver = def.id === 'ore_silver';
      const rock = silver ? ramp('#5d6270', 0.62, 1.3) : ramp('#7a808e', 0.6, 1.3);
      fillShape(pb, poly([9, 27, 12, 15, 21, 8, 30, 13, 33, 24, 28, 33, 15, 34]), rock, { seed: 7, noise: 0.14, grad: 0.5, edge: 0.34 });
      // facets
      line(pb, 12, 15, 20, 21, rock.dd);
      line(pb, 20, 21, 30, 13, rock.dd);
      line(pb, 20, 21, 22, 33, rock.dd);
      fillShape(pb, poly([12, 15, 21, 8, 30, 13, 20, 21]), rock, { flat: rock.l });
      for (let i = 0; i < 6; i++) px(pb, 14 + hf(i, 3, 5) * 12, 14 + hf(i, 5, 5) * 5, rock.hl);
      if (silver) {
        const sv = ramp('#e6edf6', 0.7, 1.15);
        for (const [x0, y0, x1, y1] of [[14, 29, 20, 24], [22, 28, 29, 21], [24, 17, 29, 15]] as const) {
          line(pb, x0, y0, x1, y1, sv.b);
          line(pb, x0, y0 + 1, x1, y1 + 1, sv.d);
        }
        for (const [x, y] of [[17, 26], [26, 24], [27, 16], [22, 12]] as const) {
          px(pb, x, y, WHITE);
          px(pb, x + 1, y, sv.l);
        }
        halo(glow, 22, 22, 12, hex('#dff0ff'), 0.35);
      } else {
        for (const [x, y] of [[15, 27], [24, 30], [28, 20], [19, 17]] as const) {
          px(pb, x, y, hex('#b0583a'));
          px(pb, x + 1, y, hex('#8a4030'));
        }
      }
      break;
    }
    case 'ingot_iron': {
      // two stacked iron ingots: sloped sides, a lighter top face, a darker right face and a stamped mark
      const m = ramp('#a8afbd', 0.6, 1.25);
      const ingot = (x: number, y: number, w: number, h: number, k: number): void => {
        // top face (narrower), front face (wider at the bottom), right face
        fillShape(pb, poly([x + 4, y, x + w - 2, y, x + w + 3, y + 5, x + 1, y + 5]), m, { flat: m.l });
        fillShape(pb, poly([x - 3, y + 5, x + w + 3, y + 5, x + w + 5, y + h, x - 5, y + h]), m, { flat: m.b });
        fillShape(pb, poly([x + w + 3, y + 5, x + w + 7, y + 7, x + w + 8, y + h - 1, x + w + 5, y + h]), m, { flat: m.d });
        line(pb, x + 2, y + 1, x + w - 3, y + 1, m.hl);
        line(pb, x - 3, y + 6, x + w + 2, y + 6, m.hl);
        px(pb, x + w / 2, y + 10, m.dd);
        px(pb, x + w / 2 - 1, y + 11, m.dd);
        px(pb, x + w / 2 + 1, y + 11, m.dd);
        px(pb, x + w / 2, y + 12 + k, m.dd);
      };
      ingot(8, 21, 17, 13, 0);
      ingot(11, 9, 15, 11, 1);
      break;
    }
    case 'hide': {
      // a stretched pelt: irregular outline, darker mottling, fur fringe and leg stubs
      const fur = ramp('#a97c50', 0.62, 1.28);
      fillShape(pb, poly([8, 12, 16, 9, 24, 10, 32, 9, 31, 17, 34, 26, 30, 32, 24, 30, 19, 35, 13, 30, 9, 27, 11, 19]), fur, { seed: 5, noise: 0.18, grad: 0.4 });
      for (let i = 0; i < 14; i++) {
        const x = 10 + hf(i, 1, 9) * 21;
        const y = 12 + hf(i, 2, 9) * 18;
        pb.ellipse(x, y, 1.6, 1.2, fur.dd);
      }
      for (const [x, y] of [[8, 12], [11, 19], [9, 27], [31, 17], [34, 26], [31, 9]] as const) px(pb, x, y, fur.l);
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        px(pb, 8 + t * 24, 11 + Math.sin(t * 9) * 1, fur.hl);
      }
      break;
    }
    case 'fang': {
      // a curved wolf fang: ivory, thick at the root and tapering to a point, with a bone root cap
      const f = ramp('#e8e2cf', 0.7, 1.08);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push([17 + 9 * Math.sin(t * 1.9) - 4 * t, 8 + 29 * t]);
      }
      const tooth: ((x: number, y: number) => boolean)[] = [];
      for (let i = 0; i < pts.length - 1; i++) tooth.push(cap(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 5.6 * (1 - i / 14) ** 0.85 + 0.4, 5.6 * (1 - (i + 1) / 14) ** 0.85 + 0.4));
      fillShape(pb, or(...tooth), f, { seed: 3, noise: 0.08, grad: 0.7 });
      for (let i = 1; i < 9; i++) px(pb, pts[i][0] - 2.4 * (1 - i / 14), pts[i][1], f.hl);
      for (let i = 4; i < 11; i++) px(pb, pts[i][0] + 2.6 * (1 - i / 14), pts[i][1], f.dd);
      fillShape(pb, box(10, 4, 26, 9), ramp('#a8763a', 0.62, 1.3), { seed: 4, noise: 0.1 });
      line(pb, 11, 6, 25, 6, hex('#d2a84a'));
      px(pb, 13, 7, hex('#6e4a2a'));
      px(pb, 22, 7, hex('#6e4a2a'));
      break;
    }
    case 'meat': {
      // a raw cut on the bone: marbled red meat, pale fat edge, bone knob
      const bone = BONE;
      fillShape(pb, cap(25, 25, 34, 33, 2.2, 2.2), bone, { seed: 2 });
      fillShape(pb, or(ell(34.5, 31.5, 3, 2.4), ell(32.5, 35, 3, 2.4)), bone, { seed: 3 });
      fillShape(pb, ell(19, 21, 12.5, 10), base, { seed: 4, noise: 0.12, grad: 0.5 });
      for (const [x0, y0, x1, y1] of [[10, 18, 18, 14], [14, 25, 25, 21], [20, 16, 28, 20]] as const) line(pb, x0, y0, x1, y1, hex('#f2c8c0'));
      for (let a = 0; a < 20; a++) px(pb, 19 + Math.cos(a * 0.314) * 12.4, 21 + Math.sin(a * 0.314) * 9.8, a % 3 ? hex('#f4e8d8') : hex('#e0cdb4'));
      px(pb, 13, 17, base.hl);
      break;
    }
    case 'grain': {
      // a tied sheaf of wheat
      const g = ramp('#e0c76a', 0.62, 1.25);
      const stalk = ramp('#c8a84a', 0.62, 1.2);
      for (let i = -3; i <= 3; i++) {
        const x1 = 20 + i * 3.4;
        line(pb, 20 + i * 0.7, 34, x1, 14 + Math.abs(i) * 1.6, i < 0 ? stalk.l : stalk.d);
        for (let k = 0; k < 4; k++) {
          const y = 14 + Math.abs(i) * 1.6 - k * 2.2 + 3.6;
          px(pb, x1 - 1, y, g.l);
          px(pb, x1 + 1, y - 1, g.b);
          px(pb, x1, y - 1, k % 2 ? g.d : g.l);
        }
        px(pb, x1, 10 + Math.abs(i) * 1.6 + 1, g.hl);
      }
      fillShape(pb, box(14, 26, 27, 29), CORD, { noise: 0.1 });
      px(pb, 20, 28, hex('#a8302a'));
      px(pb, 21, 29, hex('#a8302a'));
      break;
    }
    case 'cloth': {
      // a rolled bolt of cloth with a spiral end
      const c = ramp('#c9b8d8', 0.66, 1.2);
      fillShape(pb, box(10, 14, 33, 31), c, { seed: 3, noise: 0.06, grad: 0.5 });
      for (let x = 12; x < 33; x += 4) line(pb, x, 14, x, 30, c.d);
      fillShape(pb, ell(10, 22.5, 4.6, 8.5), c, { flat: c.l });
      for (const [rx, ry] of [[3.2, 6.2], [1.8, 3.4]] as const) {
        for (let a = 0; a < 24; a++) px(pb, 10 + Math.cos((a / 24) * 6.283) * rx, 22.5 + Math.sin((a / 24) * 6.283) * ry, c.d);
      }
      px(pb, 10, 22, c.dd);
      fillShape(pb, box(21, 13, 25, 32), ramp('#a8302a', 0.64, 1.3), { noise: 0.05 });
      break;
    }
    case 'wine': {
      // a glazed clay wine jug: round belly, short neck with a lip, ear handles and a red cloth stopper
      const jug = ramp(mix(hex(def.color), hex('#6a4a2a'), 0.68), 0.6, 1.3);
      fillShape(pb, or(ell(20, 26, 10.5, 10.5), ell(20, 17.5, 6.5, 3.6), box(16.5, 11, 23.5, 18)), jug, { seed: 3, noise: 0.06, grad: 0.8, edge: 0.3 });
      fillShape(pb, sub(ell(9.5, 21, 3.4, 4), ell(11, 21, 2, 2.4)), jug, { seed: 6, noise: 0.05 });
      fillShape(pb, sub(ell(30.5, 21, 3.4, 4), ell(29, 21, 2, 2.4)), jug, { seed: 7, noise: 0.05 });
      fillShape(pb, box(15, 10, 25, 13), ramp('#c9a870', 0.7, 1.2), { noise: 0.05 });
      fillShape(pb, poly([16, 10, 24, 10, 25, 4, 15, 4]), ramp('#a8302a', 0.64, 1.3), { seed: 5, noise: 0.08 });
      line(pb, 16, 9, 24, 9, CORD.b);
      px(pb, 17, 5, hex('#e0644a'));
      // glaze highlight and a drip
      for (let y = 20; y < 31; y++) px(pb, 13, y, jug.hl);
      px(pb, 14, 19, jug.hl);
      fillShape(pb, box(16, 22, 24, 30), ramp('#e8dcc0', 0.7, 1.1), { noise: 0.04, edge: 0.15 });
      for (let i = 0; i < 3; i++) line(pb, 17.5, 24 + i * 2, 22.5, 24 + i * 2, hex('#7a3a30'));
      break;
    }
    case 'insignia': {
      // a bandit command token: red lacquered plaque, gold edge, a skull mark and a tassel
      const lac = ramp('#b0453a', 0.6, 1.3);
      const gold = FITTING[3];
      fillShape(pb, poly([12, 6, 28, 6, 31, 10, 31, 28, 28, 31, 12, 31, 9, 28, 9, 10]), gold, { seed: 3, noise: 0.06 });
      fillShape(pb, poly([13.5, 8, 26.5, 8, 29, 11, 29, 26.5, 26.5, 29, 13.5, 29, 11, 26.5, 11, 11]), lac, { seed: 2, noise: 0.1, grad: 0.4 });
      // skull
      pb.ellipse(20, 16, 4.4, 4, hex('#f0e6d0'));
      pb.rect(17.5, 19, 5, 3, hex('#f0e6d0'));
      px(pb, 18, 16, hex('#3a1a1a'));
      px(pb, 19, 16, hex('#3a1a1a'));
      px(pb, 21, 16, hex('#3a1a1a'));
      px(pb, 22, 16, hex('#3a1a1a'));
      px(pb, 20, 18, hex('#3a1a1a'));
      for (const x of [18.5, 20, 21.5]) px(pb, x, 21, hex('#8a7a66'));
      line(pb, 14, 26, 26, 26, gold.l);
      px(pb, 20, 3, gold.b);
      line(pb, 20, 31, 20, 36, hex('#d9a838'));
      fillShape(pb, poly([18, 35, 22, 35, 23, 40, 17, 40]), ramp('#d9a838', 0.66, 1.3), { noise: 0.08 });
      break;
    }
    case 'blight_core': {
      // a pulsing knot of corruption: a dark violet orb in jagged spikes with bright veins
      const v = ramp('#8a3fb0', 0.5, 1.45);
      const spikes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 ? 11 : 15.5;
        spikes.push(20 + Math.cos(a) * r, 20 + Math.sin(a) * r);
      }
      fillShape(pb, poly(spikes), ramp('#3a1f52', 0.6, 1.3), { seed: 3, noise: 0.1 });
      fillShape(pb, ell(20, 20, 9.5, 9.5), v, { seed: 4, noise: 0.12, grad: 0.6 });
      const vein = hex('#e0a0ff');
      for (const [x0, y0, x1, y1] of [[20, 20, 13, 14], [20, 20, 28, 15], [20, 20, 17, 29], [20, 20, 29, 26], [13, 14, 10, 12], [28, 15, 31, 12]] as const) {
        line(pb, x0, y0, x1, y1, vein);
        px(pb, x1, y1, WHITE);
      }
      px(pb, 20, 20, WHITE);
      px(pb, 19, 20, hex('#f6d0ff'));
      halo(glow, 20, 20, 19, hex('#b866ff'), 1);
      break;
    }
    case 'spirit_dew': {
      // a drop of condensed qi: teardrop with a bright core, sparkles and a soft halo
      const dew = ramp('#8fd7e8', 0.58, 1.3);
      fillShape(pb, or(ell(20, 25, 9.5, 9.5), poly([20, 6, 28, 22, 12, 22])), dew, { seed: 3, noise: 0.08, grad: 0.7 });
      fillShape(pb, ell(18, 24, 5, 5.5), ramp('#d6f6ff', 0.8, 1.1), { seed: 5, noise: 0.05, grad: 0.3, edge: 0.1 });
      px(pb, 15, 21, WHITE);
      px(pb, 16, 20, WHITE);
      px(pb, 16, 22, WHITE);
      px(pb, 23, 30, dew.hl);
      for (const [x, y] of [[8, 11], [32, 14], [31, 31]] as const) {
        px(pb, x, y, WHITE);
        px(pb, x - 1, y, dew.l);
        px(pb, x + 1, y, dew.l);
        px(pb, x, y - 1, dew.l);
        px(pb, x, y + 1, dew.l);
      }
      halo(glow, 20, 22, 17, hex('#8fe8ff'), 0.9);
      break;
    }
    default:
      fillShape(pb, ell(20, 20, 9, 9), base, { seed: 1 });
  }
  return finish(pb, glow);
}

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------

function pill(pb: PixelBuffer, cx: number, cy: number, r: number, c: Ramp, mark?: 'swirl' | 'ring'): void {
  shadedBlob(pb, cx, cy, r, r, c, { seed: Math.round(cx * 7 + cy), speckle: 0.05, rim: 0.2 });
  px(pb, cx - r * 0.45, cy - r * 0.5, WHITE);
  px(pb, cx - r * 0.45 + 1, cy - r * 0.5, mix(c.hl, WHITE, 0.5));
  if (mark === 'swirl') {
    for (let a = 0; a < 14; a++) {
      const t = a / 14;
      px(pb, cx + Math.cos(t * 9) * t * r * 0.7, cy + Math.sin(t * 9) * t * r * 0.7, c.dd);
    }
  } else if (mark === 'ring') {
    for (let a = 0; a < 16; a++) px(pb, cx + Math.cos((a / 16) * 6.283) * r * 0.62, cy + Math.sin((a / 16) * 6.283) * r * 0.62, hex('#fff2c4'));
  }
}

export function consumableIcon(def: ItemDef): ItemIcon {
  const { pb, glow } = newIcon();
  const col = hex(def.color);
  const c = ramp(col, 0.6, 1.3);
  const t = def.tier;
  if (def.id === 'antidote') {
    // a corked glass vial with green liquid and a pale cross
    const glass = ramp('#a8d0e0', 0.62, 1.2);
    fillShape(pb, or(box(15, 14, 25, 33), ell(20, 33, 5, 2.4), box(17, 8, 23, 15)), glass, { seed: 2, noise: 0.05, grad: 0.4 });
    fillShape(pb, or(box(16, 21, 24, 32), ell(20, 32, 4, 2)), c, { seed: 4, noise: 0.08, grad: 0.5 });
    line(pb, 16, 21, 24, 21, c.hl);
    fillShape(pb, box(16.5, 5, 23.5, 10), ramp('#a8763a', 0.62, 1.3), { seed: 5, noise: 0.1 });
    line(pb, 17, 14, 17, 30, mix(glass.hl, WHITE, 0.6));
    pb.rect(19, 24, 3, 1, WHITE);
    pb.rect(20, 23, 1, 3, WHITE);
    halo(glow, 20, 26, 11, col, 0.4);
    return finish(pb, glow);
  }
  if (def.id === 'cooked_meat') {
    // a roast drumstick: glazed meat on a bone handle
    const meat = ramp('#c9763d', 0.58, 1.3);
    fillShape(pb, cap(23, 26, 31, 34, 2, 2), BONE, { seed: 3 });
    fillShape(pb, or(ell(32.5, 33, 2.8, 2.4), ell(30, 36, 2.8, 2.4)), BONE, { seed: 4 });
    fillShape(pb, or(ell(17, 17, 11.5, 9.5), cap(17, 17, 26, 26, 6, 3)), meat, { seed: 5, noise: 0.14, grad: 0.6 });
    for (const [x, y] of [[10, 13], [13, 10], [22, 22]] as const) {
      px(pb, x, y, hex('#f6c070'));
      px(pb, x + 1, y, hex('#fbd890'));
    }
    for (const [x, y] of [[18, 20], [14, 17], [21, 15]] as const) px(pb, x, y, hex('#7a3a1a'));
    halo(glow, 17, 17, 12, hex('#ffb060'), 0.25);
    return finish(pb, glow);
  }
  if (def.id.startsWith('pill_break')) {
    // a big golden-edged pill on a lotus of `tier` petal pairs, with a ring of light
    const gold = FITTING[Math.min(5, t + 1)];
    for (let i = 0; i < t + 1; i++) {
      const dx = (i - t / 2) * 6.5;
      fillShape(pb, poly([20 + dx, 33, 20 + dx - 4.5, 24, 20 + dx, 20, 20 + dx + 4.5, 24]), ramp('#e8b8c8', 0.7, 1.12), { seed: i, noise: 0.06 });
    }
    fillShape(pb, ell(20, 34, 12, 2.6), ramp('#6e3a4a', 0.64, 1.2), { noise: 0.05 });
    shadedBlob(pb, 20, 19, 9, 9, ramp(mix(col, hex('#fff0c0'), 0.15), 0.58, 1.3), { seed: 7, speckle: 0.04, rim: 0.2 });
    for (let a = 0; a < 40; a++) px(pb, 20 + Math.cos((a / 40) * 6.283) * 9.4, 19 + Math.sin((a / 40) * 6.283) * 9.4, a < 16 ? gold.l : gold.d);
    px(pb, 15, 14, WHITE);
    px(pb, 16, 13, WHITE);
    for (let i = 0; i < t; i++) px(pb, 20 + (i - (t - 1) / 2) * 3, 19, hex('#fff2c4'));
    halo(glow, 20, 19, 12 + t * 2, hex('#ffd060'), 0.55 + t * 0.12);
    return finish(pb, glow);
  }
  // pills on a small dish: count by tier, qi pills a bit blue, healing pills red, training pill with a swirl
  const dish = ramp('#5a5a68', 0.6, 1.3);
  fillShape(pb, ell(20, 31, 14, 4.8), dish, { seed: 2, noise: 0.06 });
  fillShape(pb, ell(20, 30, 11.5, 3.4), ramp('#3a3a48', 0.7, 1.3), { noise: 0.05, edge: 0.1 });
  const mark = def.id === 'pill_train' ? 'swirl' : undefined;
  const n = def.id === 'pill_train' ? 2 : t;
  if (n === 1) pill(pb, 20, 25, 7, c, mark);
  else if (n === 2) {
    pill(pb, 15, 26, 6.2, c, mark);
    pill(pb, 25, 26, 6.2, c, mark);
  } else {
    pill(pb, 14, 27, 5.6, c);
    pill(pb, 26, 27, 5.6, c);
    pill(pb, 20, 20, 6.2, c);
  }
  if (t >= 3) halo(glow, 20, 24, 15, col, 0.7);
  else if (t === 2) halo(glow, 20, 25, 11, col, 0.35);
  return finish(pb, glow);
}

// ---------------------------------------------------------------------------
// Manuals: thread-bound books, cover colour by school, emblem by school, one gold diamond per tier
// ---------------------------------------------------------------------------

const SCHOOL_COLOUR: Record<string, string> = {
  sword: '#4a6fa5',
  blade: '#a8302a',
  spear: '#3f7a52',
  staff: '#7a5a3a',
  fist: '#c98a3a',
  medicine: '#4f9a82',
  poison: '#7a4a9a',
  internal: '#2f6a66',
  movement: '#6aa8d8',
};

const EMBLEM: Record<string, string[]> = {
  sword: ['...#...', '...#...', '...#...', '...#...', '.#####.', '...#...', '...#...'],
  blade: ['.....##', '....##.', '...##..', '..##...', '.##....', '##.#...', '#..##..'],
  spear: ['...#...', '..###..', '...#...', '...#...', '...#...', '...#...', '...#...'],
  staff: ['..###..', '...#...', '...#...', '...#...', '...#...', '...#...', '..###..'],
  fist: ['.#.#.#.', '#######', '#######', '#######', '.#####.', '..###..', '..###..'],
  medicine: ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
  poison: ['...#...', '..###..', '.#####.', '#######', '#######', '.#####.', '..###..'],
  internal: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'],
  movement: ['#.#.#..', '.#.#.#.', '..#.#.#', '...#.#.', '..#.#.#', '.#.#.#.', '#.#.#..'],
};

export function manualIcon(def: ItemDef): ItemIcon {
  const { pb, glow } = newIcon();
  const skill = def.use?.teach ? SKILLS[def.use.teach] : undefined;
  const school = skill?.school ?? 'internal';
  const tier = Math.max(1, Math.min(4, def.tier));
  const cover = ramp(SCHOOL_COLOUR[school] ?? '#4a6fa5', 0.58, 1.28);
  const h = hashStr(def.id);
  const ribbonCols = ['#d9b867', '#e8e0cc', '#c8452d', '#47c79a', '#5fa4e8', '#b87ae6'];
  const ribbon = ramp(ribbonCols[h % ribbonCols.length], 0.64, 1.25);
  // page block peeking out below and to the right of the cover
  fillShape(pb, poly([13, 8, 33, 8, 33, 36, 11, 36]), ramp('#efe4c8', 0.72, 1.08), { seed: 2, noise: 0.05, grad: 0.2 });
  for (let y = 10; y < 36; y += 3) line(pb, 32, y, 32, y + 1, hex('#cdbf9c'));
  // cover
  fillShape(pb, poly([9, 5, 30, 5, 30, 33, 9, 33]), cover, { seed: h, noise: 0.1, grad: 0.5, edge: 0.3 });
  // spine strip with thread stitches
  fillShape(pb, box(9, 5, 13, 33), ramp(mix(SCHOOL_COLOUR[school] ? hex(SCHOOL_COLOUR[school]) : 0, hex('#1c1820'), 0.35), 0.7, 1.2), { noise: 0.06, edge: 0.15 });
  for (const y of [8, 15, 22, 29]) {
    px(pb, 11, y, hex('#f4ecd8'));
    px(pb, 11, y + 1, hex('#cdbf9c'));
  }
  // title label (vertical paper strip with a few brush marks)
  fillShape(pb, box(17, 8, 24, 21), ramp('#f0e6cc', 0.76, 1.08), { noise: 0.03, edge: 0.15 });
  let yy = 10;
  for (let i = 0; i < 4; i++) {
    const wdt = 2 + (hashStr(def.id + i) % 3);
    line(pb, 20.5 - wdt / 2, yy, 20.5 + wdt / 2, yy, hex('#3a2a26'));
    px(pb, 20.5, yy + 1, hex('#3a2a26'));
    yy += 3;
  }
  // school emblem in gold
  const em = EMBLEM[school] ?? EMBLEM.sword;
  const gold = FITTING[3];
  em.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && px(pb, 16 + x, 23 + y - (tier > 2 ? 0 : 0), y < 2 ? gold.l : gold.b)));
  // corner caps, tier diamonds at the bottom edge
  for (const [x, y] of [[29, 5], [29, 32]] as const) {
    px(pb, x, y, gold.l);
    px(pb, x - 1, y, gold.b);
  }
  for (let i = 0; i < tier; i++) {
    const x = 20 + (i - (tier - 1) / 2) * 3.4;
    px(pb, x, 34.2, hex('#fff2c4'));
  }
  // bookmark ribbon hanging out of the bottom
  fillShape(pb, poly([25, 33, 28, 33, 28, 39, 26.5, 37, 25, 39]), ribbon, { noise: 0.05, edge: 0.2 });
  if (tier >= 3) halo(glow, 20, 20, 18, hex('#ffd890'), 0.35 + (tier - 3) * 0.2);
  return finish(pb, glow);
}
