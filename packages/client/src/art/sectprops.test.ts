import { describe, expect, it } from 'vitest';
import { ca } from './color';
import { CHAR_K, PERSON_PX, TARGETS, type Target } from './scale';
import {
  CLOTH_GREYS,
  OX_FRAMES,
  OX_LENGTH,
  SECT_ASSETS,
  SECT_TARGETS,
  genBanner,
  genBannerLayers,
  genHandcart,
  genPackOx,
  genSectGate,
  genTrainingDummy,
  genWeaponRack,
  mirrorSprite,
  tintBanner,
  type SectSprite,
} from './sectprops';

const persons = (px: number): number => px / PERSON_PX;
const inRange = (name: string, px: number, t: Target): void => {
  const r = persons(px);
  expect(r, `${name}: ${px}px = ${r.toFixed(2)} persons (want ${t.min}-${t.max})`).toBeGreaterThanOrEqual(t.min);
  expect(r, `${name}: ${px}px = ${r.toFixed(2)} persons (want ${t.min}-${t.max})`).toBeLessThanOrEqual(t.max);
};
const opaque = (s: SectSprite): number => s.pb.px.reduce((n, c) => n + (ca(c) > 0 ? 1 : 0), 0);

describe('sect props: target heights (the scale table is the reference)', () => {
  it('the new constants sit next to the shared ones in persons', () => {
    expect(CHAR_K).toBeGreaterThan(0);
    // the gate is between a hall and a tower, the ox between a bear and a boar
    expect(SECT_TARGETS.sectGate.want).toBeGreaterThan(TARGETS.hall.min - 1);
    expect(SECT_TARGETS.sectGate.want).toBeLessThan(TARGETS.tower.want);
    expect(SECT_TARGETS.packOx.want).toBeGreaterThanOrEqual(TARGETS.boar.want);
    expect(SECT_TARGETS.packOx.want).toBeLessThanOrEqual(TARGETS.bear.want + 0.1);
  });

  for (const a of SECT_ASSETS) {
    for (const dir of [0, 1, 2, 3] as const) {
      it(`${a.id} dir ${dir} height is inside its range`, () => {
        for (let f = 0; f < a.frames; f++) inRange(`${a.id}/${dir}/${f}`, a.make(dir, f).heightPx, SECT_TARGETS[a.key]);
      });
    }
  }

  it('the measured top pixel really is where heightPx says (no self-reported numbers)', () => {
    for (const a of SECT_ASSETS) {
      const s = a.make(0, 0);
      const b = s.pb.bounds()!;
      expect(s.top).toBe(b.y0);
      // the highest pixel can sit up to one footprint diagonal above the anchor row, never below the ground point
      expect(s.ay - b.y0 + 1).toBeGreaterThanOrEqual(s.heightPx - 1);
      expect(s.ay - b.y0 + 1).toBeLessThanOrEqual(s.heightPx + (s.footprint.w + s.footprint.d) * 8);
    }
  });

  it('the ox is 1.4 persons long', () => {
    for (const dir of [0, 3] as const) {
      const s = genPackOx(dir, 0);
      const b = s.pb.bounds()!;
      // the baked ground shadow is translucent; the animal itself is the opaque part
      let x0 = s.pb.w;
      let x1 = -1;
      for (let y = 0; y < s.pb.h; y++)
        for (let x = 0; x < s.pb.w; x++) if (ca(s.pb.px[y * s.pb.w + x]) === 255) (x < x0 && (x0 = x), x > x1 && (x1 = x));
      inRange(`ox length dir ${dir}`, x1 - x0 + 1, OX_LENGTH);
      expect(b.x1).toBeGreaterThan(b.x0);
    }
  });
});

describe('sect props: sprite contract', () => {
  it('every piece has an anchor on its canvas and an anchor below its top', () => {
    for (const a of SECT_ASSETS)
      for (const dir of [0, 1, 2, 3] as const) {
        const s = a.make(dir, 0);
        expect(s.ax).toBeGreaterThanOrEqual(0);
        expect(s.ax).toBeLessThan(s.pb.w);
        expect(s.ay).toBeGreaterThan(s.top);
        expect(s.ay).toBeLessThan(s.pb.h);
        expect(opaque(s)).toBeGreaterThan(80);
      }
  });

  it('all non-shadow pixels are fully opaque (hard edges, no anti-aliasing)', () => {
    for (const a of SECT_ASSETS) {
      const s = a.make(0, 0);
      let solid = 0;
      let part = 0;
      for (const c of s.pb.px) {
        const al = ca(c);
        if (al === 255) solid++;
        else if (al > 0) part++;
      }
      // translucent pixels are only the baked ground shadow, a small share
      expect(part, a.id).toBeLessThan(solid * 0.25);
    }
  });

  it('is deterministic', () => {
    for (const a of SECT_ASSETS) {
      const p = a.make(0, 0);
      const q = a.make(0, 0);
      expect(p.pb.px.every((v, i) => v === q.pb.px[i])).toBe(true);
    }
  });

  it('mirrors anchor, canvas and footprint', () => {
    const s = genHandcart(0);
    const m = mirrorSprite(s);
    expect(m.ax).toBe(s.pb.w - 1 - s.ax);
    expect(m.footprint).toEqual({ w: s.footprint.d, d: s.footprint.w });
    expect(m.pb.get(m.ax, m.ay)).toBe(s.pb.get(s.ax, s.ay));
    expect(genHandcart(1).ax).toBe(m.ax);
  });

  it('even dirs span x, odd dirs span y for the symmetric pieces; the two views differ', () => {
    for (const make of [genSectGate, genTrainingDummy, genWeaponRack]) {
      const a = make(0);
      const b = make(1);
      expect(a.pb.px.some((v, i) => b.pb.w !== a.pb.w || v !== b.pb.px[i])).toBe(true);
    }
    const gate0 = genSectGate(0);
    const gate1 = genSectGate(1);
    expect(gate0.footprint).toEqual({ w: 4, d: 1 });
    expect(gate1.footprint).toEqual({ w: 1, d: 4 });
    // 4 tiles of 16 px along the long side: both views are about 5 tiles wide
    expect(gate0.pb.w).toBeGreaterThan(70);
    expect(gate1.pb.w).toBeGreaterThan(70);
  });

  it('the cart has a 1 x 2 footprint and the ox walk cycle has two different frames', () => {
    expect(genHandcart(0).footprint).toEqual({ w: 2, d: 1 });
    expect(genHandcart(3).footprint).toEqual({ w: 1, d: 2 });
    expect(OX_FRAMES).toBe(2);
    const f0 = genPackOx(0, 0);
    const f1 = genPackOx(0, 1);
    expect(f0.pb.px.some((v, i) => v !== f1.pb.px[i])).toBe(true);
  });
});

describe('banner: tintable cloth layer', () => {
  it('splits into a neutral grey cloth layer and the rest', () => {
    const l = genBannerLayers(0);
    let cloth = 0;
    for (const c of l.cloth.px) {
      if (!ca(c)) continue;
      cloth++;
      const r = c & 255;
      expect([r, (c >>> 8) & 255, (c >>> 16) & 255], 'cloth is neutral grey').toEqual([r, r, r]);
      expect(Object.values(CLOTH_GREYS)).toContain(r);
    }
    expect(cloth).toBeGreaterThan(150);
    // cloth and base never overlap
    for (let i = 0; i < l.base.px.length; i++) expect(ca(l.base.px[i]) > 0 && ca(l.cloth.px[i]) > 0).toBe(false);
  });

  it('recolours only the cloth and keeps the pole', () => {
    const red = genBanner('#a8302a');
    const blue = genBanner('#2f5fa8');
    expect(red.pb.w).toBe(blue.pb.w);
    let diff = 0;
    let same = 0;
    for (let i = 0; i < red.pb.px.length; i++) {
      if (!ca(red.pb.px[i])) continue;
      if (red.pb.px[i] === blue.pb.px[i]) same++;
      else diff++;
    }
    expect(diff).toBeGreaterThan(100);
    expect(same).toBeGreaterThan(100); // pole, finial, emblem, outline
    const tinted = tintBanner(genBannerLayers(0).cloth, '#2f5fa8');
    for (const c of tinted.px) if (ca(c)) expect(((c & 255) === ((c >>> 8) & 255)) && ((c & 255) === ((c >>> 16) & 255))).toBe(false);
  });
});
