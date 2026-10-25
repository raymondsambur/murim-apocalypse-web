import { describe, expect, it } from 'vitest';
import { O } from '@murim/shared';
import { genBuilding } from './buildings';
import { genObject, VARIANTS } from './flora';
import { genBeast, BEAST_KEYS } from './beasts';
import { referenceItems } from './scaleRef';
import { BUILDING_ZK, CHAR_K, DESIGN_PERSON_PX, PERSON_PX, TARGETS, targetPx, type TargetKey } from './scale';

const items = referenceItems();
const by = (name: string) => items.find((i) => i.name === name)!;
const ratio = (px: number): number => px / PERSON_PX;
const inRange = (k: TargetKey, px: number): void => {
  const t = TARGETS[k];
  const r = ratio(px);
  expect(r, `${k}: ${px}px = ${r.toFixed(2)} persons (want ${t.min}-${t.max})`).toBeGreaterThanOrEqual(t.min);
  expect(r, `${k}: ${px}px = ${r.toFixed(2)} persons (want ${t.min}-${t.max})`).toBeLessThanOrEqual(t.max);
};

describe('world scale: one table of target heights', () => {
  it('derives the reduction from the table', () => {
    expect(CHAR_K).toBeCloseTo(PERSON_PX / DESIGN_PERSON_PX, 6);
    expect(targetPx('person')).toBe(PERSON_PX);
    expect(BUILDING_ZK).toBeGreaterThan(1.5);
  });

  it('every measured reference item stays inside its target range', () => {
    for (const it of items) {
      if (!it.key) continue;
      if (it.key === 'houseEave') continue; // measured on the eave line below, not on the chimney
      inRange(it.key, it.h);
    }
  });

  it('house: door 1.1-1.4 persons, eave about 2 persons, door below the eave', () => {
    const house = by('house 3x3');
    inRange('houseDoor', house.door!);
    inRange('houseEave', house.eave!);
    expect(house.door!).toBeLessThan(house.eave!);
  });

  it('a person is never taller than a house wall or a fort wall, and trees dwarf people', () => {
    const person = by('person').h;
    expect(by('house 3x3').eave!).toBeGreaterThan(person * 1.7);
    expect(by('fort wall').h).toBeGreaterThan(person * 2.4);
    for (const n of ['pine', 'oak', 'bamboo']) expect(by(n).h).toBeGreaterThan(person * 2.9);
    expect(by('blight lord').h).toBeGreaterThan(by('elite+').h);
    expect(by('boar').h).toBeLessThan(person * 0.7);
    expect(by('bear').h).toBeGreaterThan(by('wolf').h);
  });

  it('all tree variants and beasts keep their ratio in every variant', () => {
    for (const [code, key] of [[O.Pine, 'pine'], [O.Oak, 'oak'], [O.Bamboo, 'bamboo']] as [number, TargetKey][])
      for (let v = 0; v < VARIANTS; v++)
        for (const season of [0, 1, 2, 3]) {
          const g = genObject(code, v, season, 0)!;
          const b = g.pb.bounds()!;
          inRange(key, g.ay - b.y0 + 1);
        }
    for (const k of BEAST_KEYS) {
      if (k === 'wolf_blight') continue;
      const g = genBeast({ key: k, state: 'idle', dir: 0, frame: 0 });
      const b = g.pb.bounds()!;
      inRange(k as TargetKey, g.ay - b.y0 + 1);
    }
  });

  it('pagoda 3 to 5 tiers stays within 5-8 persons', () => {
    for (const id of [3, 4, 5]) {
      const a = genBuilding({ id, kind: 'pagoda', w: 4, d: 4, door: { dx: 1, dy: 4 }, season: 1, roofCss: null, accentCss: null, fallen: false });
      const b = a.pb.bounds()!;
      inRange('pagoda', Math.round(a.oy + 4 * 8) - b.y0 + 1);
    }
  });
});
