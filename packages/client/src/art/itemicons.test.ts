import { describe, expect, it } from 'vitest';
import { ITEMS, WEAPON_TYPES, type ItemDef } from '@murim/shared';
import { ca } from './color';
import { ICON_PX, genItemIcon } from './itemicons';
import { INK_SOFT } from './palette';
import type { PixelBuffer } from './pixel';

const all = Object.values(ITEMS);
const opaque = (pb: PixelBuffer): number => pb.px.reduce((n, c) => n + (ca(c) > 0 ? 1 : 0), 0);
const hash = (pb: PixelBuffer): string => {
  let h = 2166136261;
  for (const c of pb.px) h = Math.imul(h ^ c, 16777619) >>> 0;
  return h.toString(16);
};

describe('item icons', () => {
  it('there is an icon for every item definition (112 at the time of writing, whatever the data holds)', () => {
    expect(all.length).toBeGreaterThanOrEqual(100);
    for (const d of all) {
      const ic = genItemIcon(d);
      expect(ic.pb.w, d.id).toBe(ICON_PX);
      expect(ic.pb.h, d.id).toBe(ICON_PX);
      expect(opaque(ic.pb), `${d.id} is not empty`).toBeGreaterThan(60);
    }
  });

  it('every kind of item is covered, with the counts the data has', () => {
    const kinds = new Set(all.map((d) => d.kind));
    for (const k of ['weapon', 'outfit', 'accessory', 'material', 'consumable', 'manual'] as const) expect(kinds.has(k), k).toBe(true);
    expect(all.filter((d) => d.kind === 'weapon').length).toBe(WEAPON_TYPES.length * 5);
  });

  it('icons stay inside the canvas with room for the outline and are not tiny or full-bleed', () => {
    for (const d of all) {
      const b = genItemIcon(d).pb.bounds()!;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      expect(Math.max(w, h), `${d.id} ${w}x${h}`).toBeGreaterThanOrEqual(14);
      expect(b.x0, d.id).toBeGreaterThanOrEqual(0);
      expect(b.y0, d.id).toBeGreaterThanOrEqual(0);
      expect(b.x1, d.id).toBeLessThan(ICON_PX);
      expect(b.y1, d.id).toBeLessThan(ICON_PX);
    }
  });

  it('hard edges: every colour pixel is fully opaque (only the glow layer may be translucent)', () => {
    for (const d of all) {
      const { pb } = genItemIcon(d);
      for (const c of pb.px) if (ca(c) > 0) expect(ca(c), d.id).toBe(255);
    }
  });

  it('has the dark outline: an opaque pixel next to a transparent one inside the canvas is the ink colour', () => {
    for (const d of all) {
      const { pb } = genItemIcon(d);
      let bad = 0;
      let edge = 0;
      for (let y = 1; y < pb.h - 1; y++)
        for (let x = 1; x < pb.w - 1; x++) {
          if (!ca(pb.px[y * pb.w + x])) continue;
          const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !ca(pb.px[(y + dy) * pb.w + x + dx]));
          if (!open) continue;
          edge++;
          if (pb.px[y * pb.w + x] !== INK_SOFT) bad++;
        }
      expect(edge, d.id).toBeGreaterThan(10);
      expect(bad, `${d.id}: ${bad} of ${edge} edge pixels are not ink`).toBe(0);
    }
  });

  it('every item has its own picture', () => {
    const seen = new Map<string, string>();
    for (const d of all) {
      const h = hash(genItemIcon(d).pb);
      expect(seen.get(h), `${d.id} looks identical to ${seen.get(h)}`).toBeUndefined();
      seen.set(h, d.id);
    }
  });

  it('is deterministic', () => {
    for (const d of all) {
      const a = genItemIcon(d).pb;
      const b = genItemIcon(d).pb;
      expect(a.px.every((v, i) => v === b.px[i]), d.id).toBe(true);
    }
  });

  it('higher weapon tiers do not draw smaller weapons, rarity only adds to weapons', () => {
    for (const wt of ['sword', 'blade', 'spear', 'staff'] as const) {
      let prev = 0;
      for (let t = 1; t <= 5; t++) {
        const n = opaque(genItemIcon(ITEMS[`w_${wt}_${t}`]).pb);
        expect(n, `${wt} tier ${t}`).toBeGreaterThanOrEqual(prev * 0.95);
        prev = n;
      }
    }
    const pill: ItemDef = ITEMS.pill_heal_s;
    expect(genItemIcon(pill, 0).pb.px.every((v, i) => v === genItemIcon(pill, 4).pb.px[i])).toBe(true);
  });

  it('manuals differ by school and by skill', () => {
    const a = genItemIcon(ITEMS.manual_sword_basic).pb;
    const b = genItemIcon(ITEMS.manual_blade_wild).pb;
    expect(a.px.some((v, i) => v !== b.px[i])).toBe(true);
    // the cover colour (a pixel inside the cover) follows the school
    const cover = (d: ItemDef): number => genItemIcon(d).pb.px[28 * ICON_PX + 20];
    expect(cover(ITEMS.manual_sword_basic)).not.toBe(cover(ITEMS.manual_blade_wild));
  });
});
