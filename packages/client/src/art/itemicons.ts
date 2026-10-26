/**
 * Inventory item icons, drawn in code: one 40 x 40 pixel icon for every entry of `data/items.ts` (weapons by type and tier,
 * outfits, accessories by attribute and tier, materials, consumables, manuals by school). Same conventions as the world art:
 * hard edges, alpha 0 or 255 only, a 1 px dark outline, 3 to 4 tone ramps from `palette.ramp`, light from the upper left.
 * Weapons reuse `drawWeapon` so an icon shows the same blade, guard and wrap as the figure holding it.
 *
 * `genItemIcon` is pure (node-testable); `itemIconCanvas` is the cached DOM bridge. Not wired into the inventory UI yet.
 * Weapons, outfits and accessories are painted here, materials / consumables / manuals in `itemmisc.ts`.
 */
import type { ItemDef } from '@murim/shared';
import { hex, mix, rgba } from './color';
import { pbToCanvas } from './canvas';
import { BONE, COIN, FITTING, JADE, SEAL, TRINKET } from './gear';
import { ramp } from './palette';
import { PixelBuffer } from './pixel';
import { drawWeapon, fistGear } from './weapons';
import { CORD, ICON_PX, WHITE, and, box, cap, ell, fillShape, finish, halo, line, newIcon, not, or, poly, px, sub, type ItemIcon } from './itemkit';
import { consumableIcon, manualIcon, materialIcon } from './itemmisc';

export { ICON_PX, type ItemIcon };

// ---------------------------------------------------------------------------
// Weapons (drawWeapon at 45 degrees) and fist gear
// ---------------------------------------------------------------------------

function weaponIcon(def: ItemDef, rarity: number): ItemIcon {
  const wt = def.weaponType!;
  const tier = Math.max(1, Math.min(5, def.tier));
  if (wt === 'fist') return fistIcon(tier);
  const big = new PixelBuffer(96, 96);
  const bigGlow = new PixelBuffer(96, 96);
  // hand at the lower left of the middle, axis pointing up and to the right
  drawWeapon({ pb: big, glow: bigGlow, weapon: wt, tier, rar: rarity, hx: 40, hy: 56, ang: -45 });
  const { pb, glow } = newIcon();
  const b = big.bounds()!;
  const ox = Math.round((ICON_PX - (b.x1 - b.x0 + 1)) / 2) - b.x0;
  const oy = Math.round((ICON_PX - (b.y1 - b.y0 + 1)) / 2) - b.y0;
  pb.blit(shifted(big, ox, oy, ICON_PX), 0, 0);
  const g = bigGlow.bounds() ? shifted(bigGlow, ox, oy, ICON_PX) : null;
  if (g) glow.blit(g, 0, 0);
  return finish(pb, glow);
}

function shifted(src: PixelBuffer, dx: number, dy: number, size: number): PixelBuffer {
  const out = new PixelBuffer(size, size);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const nx = x + dx;
      const ny = y + dy;
      const c = src.px[y * src.w + x];
      if (c >>> 24 && nx >= 0 && ny >= 0 && nx < size && ny < size) out.px[ny * size + nx] = c;
    }
  return out;
}

/** A clenched fist in a glove or gauntlet, forearm band at the bottom, knuckle studs on top. */
function fistIcon(tier: number): ItemIcon {
  const { pb, glow } = newIcon();
  const f = fistGear(tier);
  const cloth = f.cloth;
  // forearm sleeve
  fillShape(pb, poly([13, 36, 11, 24, 29, 22, 31, 35]), f.fore, { seed: tier, noise: 0.14 });
  // palm / fist block with finger bumps on top
  fillShape(pb, or(box(11, 12, 30, 25), ell(14.5, 12.5, 3.6, 3.2), ell(20, 11, 3.6, 3.4), ell(25.5, 12, 3.6, 3.2), ell(29.5, 15, 2.6, 3.4)), f.hand, { seed: tier + 5, noise: 0.12 });
  // finger gaps
  for (const gx of [17, 23]) line(pb, gx, 10, gx, 17, f.hand.dd);
  // thumb across the front
  fillShape(pb, cap(13, 22, 24, 18, 2.6, 2.2), f.hand, { seed: tier + 9 });
  if (cloth) {
    // wrapped linen strips
    for (let i = 0; i < 4; i++) line(pb, 11, 27 + i * 2, 30, 25 + i * 2, i % 2 ? f.fore.d : f.fore.l);
    for (let i = 0; i < 3; i++) line(pb, 12, 17 + i * 2.5, 29, 15 + i * 2.5, f.hand.d);
  } else {
    // cuff band and studs
    const stud = f.stud ?? FITTING[tier];
    fillShape(pb, box(10, 24, 31, 27), stud, { noise: 0.05 });
    for (let i = 0; i < 4; i++) px(pb, 14 + i * 5, 14, stud.l);
    for (let i = 0; i < 4; i++) px(pb, 14 + i * 5, 15, stud.dd);
    if (tier >= 4) for (let i = 0; i < 3; i++) px(pb, 15 + i * 5, 29, stud.l);
  }
  if (tier >= 5) halo(glow, 20, 16, 14, hex('#5fe8c0'), 0.8);
  return finish(pb, glow);
}

// ---------------------------------------------------------------------------
// Outfits (tiers 1-5): a folded robe seen from the front
// ---------------------------------------------------------------------------

function outfitIcon(def: ItemDef): ItemIcon {
  const t = Math.max(1, Math.min(5, def.tier));
  const { pb, glow } = newIcon();
  const cloth = [ramp('#b5a584', 0.7, 1.15), ramp('#6b5a46', 0.62, 1.25), ramp('#5f7396', 0.64, 1.25), ramp('#a8302a', 0.62, 1.3), ramp('#eef0e4', 0.78, 1.05)][t - 1];
  const trim = [ramp('#8a7a5c', 0.7, 1.2), ramp('#c9bfa6', 0.7, 1.15), ramp('#e6e2d0', 0.72, 1.12), ramp('#e6c04e', 0.66, 1.3), ramp('#47c79a', 0.6, 1.35)][t - 1];
  const sash = [ramp('#6a4a32', 0.62, 1.25), ramp('#3e2f26', 0.62, 1.3), ramp('#33457c', 0.62, 1.3), ramp('#26222c', 0.7, 1.6), ramp('#d8b254', 0.66, 1.3)][t - 1];
  // sleeves first (hang behind the body edge), then body
  const sleeveL = poly([13, 9, 6, 12, 3, 26, 11, 28, 13, 20]);
  const sleeveR = poly([27, 9, 34, 12, 37, 26, 29, 28, 27, 20]);
  const body = poly([14, 8, 26, 8, 28, 11, 28, 34, 12, 34, 12, 11]);
  fillShape(pb, sleeveL, cloth, { seed: t, noise: 0.12 });
  fillShape(pb, sleeveR, cloth, { seed: t + 1, noise: 0.12 });
  fillShape(pb, body, cloth, { seed: t + 2, noise: 0.12 });
  // sleeve cuffs and hem trim
  fillShape(pb, poly([3, 26, 11, 28, 11, 30, 3, 28.5]), trim, { noise: 0.05 });
  fillShape(pb, poly([37, 26, 29, 28, 29, 30, 37, 28.5]), trim, { noise: 0.05 });
  fillShape(pb, box(12, 32, 28, 34.5), trim, { noise: 0.05 });
  // crossed collar (right lapel over left)
  fillShape(pb, poly([15, 8, 19, 8, 26, 24, 22, 25]), trim, { noise: 0.05, edge: 0.2 });
  fillShape(pb, poly([25, 8, 21, 8, 14, 24, 18, 25]), trim, { noise: 0.05, edge: 0.2 });
  line(pb, 20, 9, 20, 11, cloth.dd);
  // belt and knot
  fillShape(pb, box(12, 24, 28, 27), sash, { noise: 0.06 });
  fillShape(pb, box(18, 23, 22.5, 29), sash, { noise: 0.04 });
  px(pb, 19, 29, sash.d);
  px(pb, 21, 30, sash.dd);
  if (t === 1) {
    // patches and a rope belt
    for (const [x, y, c] of [[15, 14, cloth.l], [23, 19, cloth.d], [17, 30, cloth.d]] as const) {
      pb.rect(x, y, 3, 3, c);
      px(pb, x, y, cloth.dd);
      px(pb, x + 2, y + 2, cloth.dd);
    }
  } else if (t === 2) {
    // leather vest over the shirt: dark panels with studs
    const lea = ramp('#7a5434', 0.6, 1.3);
    fillShape(pb, poly([14, 9, 18, 9, 18.5, 24, 13, 24]), lea, { seed: 3, noise: 0.14 });
    fillShape(pb, poly([26, 9, 22, 9, 21.5, 24, 27, 24]), lea, { seed: 4, noise: 0.14 });
    for (const y of [13, 17, 21]) {
      px(pb, 16, y, FITTING[3].l);
      px(pb, 24, y, FITTING[3].l);
    }
  } else if (t === 3) {
    // cloud swirls on the hem and sleeves
    for (const [x, y] of [[15, 31], [20, 31], [25, 31], [6, 25], [34, 25]] as const) {
      pb.ellipse(x, y, 1.6, 1.2, cloth.l);
      px(pb, x + 1, y, cloth.dd);
    }
  } else if (t === 4) {
    // gold-edged shoulder plates and a chest medallion
    fillShape(pb, ell(12, 11, 5, 3.6), FITTING[3], { seed: 8 });
    fillShape(pb, ell(28, 11, 5, 3.6), FITTING[3], { seed: 9 });
    pb.ellipse(20, 17, 2.4, 2.4, FITTING[4].l);
    px(pb, 19, 16, WHITE);
    px(pb, 20, 18, FITTING[4].dd);
  } else {
    // embroidered dragon of gold thread, a jade clasp and a soft aura
    const g = FITTING[5];
    for (let i = 0; i < 9; i++) {
      const x = 15 + i * 1.2;
      const y = 14 + Math.sin(i * 0.9) * 3 + i * 0.9;
      px(pb, x, y, g.l);
      px(pb, x + 1, y + 1, g.d);
    }
    pb.ellipse(20, 25.5, 2, 1.6, JADE.b);
    px(pb, 19, 25, JADE.hl);
    halo(glow, 20, 21, 17, hex('#aef5d8'), 0.7);
  }
  return finish(pb, glow);
}

// ---------------------------------------------------------------------------
// Accessories: ring (might), sash (agility), bone charm (vitality), jade pendant (spirit), seal (insight), coin (fortune)
// ---------------------------------------------------------------------------

const GEM_BY_TIER = [hex('#d8453a'), hex('#d8453a'), hex('#47c79a'), hex('#5fa4e8'), hex('#ff5a4a')];

function gem(pb: PixelBuffer, glow: PixelBuffer, cx: number, cy: number, tier: number): void {
  const c = GEM_BY_TIER[Math.min(4, tier)];
  fillShape(pb, poly([cx, cy - 3.4, cx + 3, cy, cx, cy + 3.4, cx - 3, cy]), ramp(c, 0.6, 1.4), { noise: 0.04, edge: 0.35 });
  px(pb, cx - 1, cy - 1, mix(c, WHITE, 0.75));
  if (tier >= 4) halo(glow, cx, cy, 8, c, 0.9);
}

function accessoryIcon(def: ItemDef): ItemIcon {
  const t = Math.max(1, Math.min(4, def.tier));
  const key = def.stat?.key ?? 'might';
  const M = TRINKET[t];
  const { pb, glow } = newIcon();
  switch (key) {
    case 'might': {
      // an iron ring seen at an angle: outer ellipse minus the hole, with a gem on top from tier 3
      const outer = ell(20, 23, 12.5, 11);
      const hole = ell(20, 23.5, 7, 5.8);
      fillShape(pb, sub(outer, hole), M, { seed: t, noise: 0.12, grad: 0.4 });
      // thick front band: re-lit lower arc
      fillShape(pb, sub(and(outer, not(ell(20, 21, 12.5, 10))), hole), M, { seed: t + 4, noise: 0.1, grad: 0.1, edge: 0.2 });
      if (t >= 3) gem(pb, glow, 20, 11.5, t);
      if (t >= 2) for (const [x, y] of [[9, 20], [31, 20]] as const) px(pb, x, y, M.hl);
      if (t === 1) {
        px(pb, 15, 29, M.dd);
        px(pb, 26, 17, M.dd);
      }
      break;
    }
    case 'agility': {
      // a knotted silk sash with two loops and swallow-tailed ends
      const silk = [ramp('#cfc9b8', 0.72, 1.12), ramp('#4aa391', 0.64, 1.25), ramp('#c8452d', 0.64, 1.3), ramp('#8b4ba9', 0.64, 1.3)][t - 1];
      fillShape(pb, poly([16, 21, 21, 21, 20.5, 38, 18, 34.5, 14, 38, 15, 29]), silk, { seed: 4, noise: 0.1 });
      fillShape(pb, poly([19, 21, 24, 21, 26.5, 29, 26, 38, 22, 34.5, 19.5, 38]), silk, { seed: 5, noise: 0.1 });
      fillShape(pb, sub(ell(12, 16, 9, 6.6), ell(12.5, 16.5, 4.4, 3)), silk, { seed: 2, noise: 0.1 });
      fillShape(pb, sub(ell(28, 16, 9, 6.6), ell(27.5, 16.5, 4.4, 3)), silk, { seed: 3, noise: 0.1 });
      fillShape(pb, or(ell(20, 18.5, 4, 4.6), box(17, 15, 23, 22)), silk, { seed: 6, noise: 0.06, edge: 0.4 });
      line(pb, 18, 16, 18, 21, silk.l);
      if (t >= 3) {
        const g = FITTING[t];
        for (let i = 0; i < 5; i++) px(pb, 18 + i * 1.2, 16 + i, g.l);
        line(pb, 15, 37, 19, 37, g.b);
        line(pb, 22, 37, 26, 37, g.b);
      }
      break;
    }
    case 'vitality': {
      // a bone fang charm on a cord loop
      line(pb, 12, 6, 20, 14, CORD.b);
      line(pb, 28, 6, 20, 14, CORD.b);
      line(pb, 13, 6, 21, 14, CORD.l);
      px(pb, 12, 5, CORD.d);
      px(pb, 28, 5, CORD.d);
      const fang = poly([14, 14, 26, 14, 24, 27, 20, 38, 16, 27]);
      fillShape(pb, fang, BONE, { seed: 5, noise: 0.1, grad: 0.4 });
      line(pb, 18, 17, 20, 31, BONE.l);
      fillShape(pb, box(13, 12, 27, 16), t >= 2 ? M : CORD, { noise: 0.1 });
      if (t >= 2) for (const x of [13, 27]) fillShape(pb, ell(x, 8.5 + (x < 20 ? 0 : 0), 2, 2), M, { noise: 0.05, edge: 0.4 });
      if (t >= 2) for (const x of [16, 20, 24]) px(pb, x, 14, M.hl);
      if (t >= 3) gem(pb, glow, 20, 22, t);
      if (t === 1) {
        px(pb, 22, 24, BONE.dd);
        px(pb, 18, 20, BONE.d);
      }
      break;
    }
    case 'spirit': {
      // a jade bi disc with a tassel; gold rim from tier 3
      const jade = t === 1 ? ramp('#7c9a88', 0.66, 1.2) : JADE;
      line(pb, 20, 4, 14, 11, CORD.b);
      line(pb, 20, 4, 26, 11, CORD.b);
      if (t >= 3) fillShape(pb, sub(ell(20, 20, 13, 13), ell(20, 20, 11, 11)), M, { noise: 0.06 });
      fillShape(pb, sub(ell(20, 20, 11.5, 11.5), ell(20, 20, 4, 4)), jade, { seed: 6, noise: 0.1, grad: 0.5 });
      px(pb, 13, 15, jade.hl);
      px(pb, 14, 14, jade.hl);
      px(pb, 15, 13, jade.hl);
      // carved ring
      for (let a = 0; a < 16; a++) px(pb, 20 + Math.cos(a * 0.3927) * 8, 20 + Math.sin(a * 0.3927) * 8, a % 2 ? jade.d : jade.l);
      // tassel
      line(pb, 20, 32, 20, 35, CORD.b);
      fillShape(pb, poly([18, 35, 22, 35, 23, 40, 17, 40]), ramp('#a8302a', 0.64, 1.3), { noise: 0.08 });
      if (t >= 4) halo(glow, 20, 20, 17, hex('#8ff0c8'), 0.8);
      break;
    }
    case 'insight': {
      // a carved chop seen from above-left: top face, two sides, a knob and a red stamped face below
      const mat = [ramp('#7a5434', 0.64, 1.25), ramp('#9a958c', 0.66, 1.2), JADE, ramp('#e6c04e', 0.66, 1.3)][t - 1];
      fillShape(pb, poly([20, 14, 31, 19.5, 20, 25, 9, 19.5]), mat, { flat: mat.l });
      fillShape(pb, poly([9, 19.5, 20, 25, 20, 34, 9, 28.5]), mat, { flat: mat.b });
      fillShape(pb, poly([31, 19.5, 20, 25, 20, 34, 31, 28.5]), mat, { flat: mat.d });
      // knob: a small lion-like cap
      fillShape(pb, or(ell(20, 11.5, 4, 3.4), box(17.5, 11, 22.5, 17)), mat, { seed: 8, noise: 0.08, grad: 0.5 });
      px(pb, 19, 10, mat.hl);
      // stamped face hint on the left side
      for (let i = 0; i < 4; i++) px(pb, 12 + i * 2, 24 + i, SEAL.b);
      for (let i = 0; i < 3; i++) px(pb, 12 + i * 2, 26 + i, SEAL.l);
      if (t >= 3) for (const [x, y] of [[22, 29], [26, 27]] as const) px(pb, x, y, mat.hl);
      if (t === 4) halo(glow, 20, 22, 14, hex('#ffd060'), 0.6);
      break;
    }
    default: {
      // a coin with a square hole (fortune), two stacked from tier 3, red tassel on top
      const coin = [ramp('#7a6a5a', 0.62, 1.2), ramp('#b0733a', 0.62, 1.3), ramp('#cfd6e0', 0.68, 1.2), COIN][t - 1];
      const draw = (cx: number, cy: number): void => {
        fillShape(pb, sub(ell(cx, cy, 11.5, 11.5), box(cx - 3, cy - 3, cx + 3, cy + 3)), coin, { seed: 10 + t, noise: 0.1, grad: 0.5 });
        // raised rim
        for (let a = 0; a < 40; a++) {
          const ang = (a / 40) * Math.PI * 2;
          const x = cx + Math.cos(ang) * 9.8;
          const y = cy + Math.sin(ang) * 9.8;
          px(pb, x, y, Math.cos(ang) + Math.sin(ang) < 0 ? coin.l : coin.d);
        }
        for (const [dx, dy] of [[0, -6.5], [6.5, 0], [0, 6.5], [-6.5, 0]] as const) px(pb, cx + dx, cy + dy, coin.dd);
      };
      if (t >= 3) {
        draw(16, 25);
        draw(25, 18);
      } else draw(20, 22);
      line(pb, 20, 3, 20, t >= 3 ? 8 : 9, CORD.b);
      fillShape(pb, ell(20, 5, 2.6, 2.6), ramp('#a8302a', 0.64, 1.3), { noise: 0.05 });
      break;
    }
  }
  return finish(pb, glow);
}

/** Icon for an item definition. `rarity` (0-4) only changes weapons (edge shine, glow). */
export function genItemIcon(def: ItemDef, rarity = 0): ItemIcon {
  switch (def.kind) {
    case 'weapon':
      return weaponIcon(def, rarity);
    case 'outfit':
      return outfitIcon(def);
    case 'accessory':
      return accessoryIcon(def);
    case 'material':
      return materialIcon(def);
    case 'consumable':
      return consumableIcon(def);
    default:
      return manualIcon(def);
  }
}

const cache = new Map<string, { cv: HTMLCanvasElement; glow: HTMLCanvasElement | null }>();

/** Cached canvases for an item (DOM). */
export function itemIconCanvas(def: ItemDef, rarity = 0): { cv: HTMLCanvasElement; glow: HTMLCanvasElement | null } {
  const key = `${def.id}|${rarity}`;
  let e = cache.get(key);
  if (!e) {
    const g = genItemIcon(def, rarity);
    e = { cv: pbToCanvas(g.pb), glow: g.glow ? pbToCanvas(g.glow) : null };
    cache.set(key, e);
  }
  return e;
}

