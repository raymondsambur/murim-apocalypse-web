import { describe, expect, it } from 'vitest';
import { emptyEquipment, gearLook, sameGearLook } from './character';

describe('gearLook', () => {
  it('is undefined when nothing is worn', () => {
    expect(gearLook(emptyEquipment())).toBeUndefined();
  });

  it('summarises tier and rarity of each slot', () => {
    const eq = emptyEquipment();
    eq.weapon = { id: 'w_sword_3', qty: 1, r: 2 };
    eq.outfit = { id: 'o_2', qty: 1 };
    eq.accessory = { id: 'a_spirit_1', qty: 1, r: 4 };
    expect(gearLook(eq)).toEqual({ w: { t: 3, r: 2 }, o: { t: 2, r: 0 }, a: { k: 'spirit', t: 1, r: 4 } });
  });

  it('ignores unknown items', () => {
    const eq = emptyEquipment();
    eq.outfit = { id: 'not_an_item', qty: 1 };
    expect(gearLook(eq)).toBeUndefined();
  });

  it('compares by value', () => {
    const a = gearLook({ weapon: { id: 'w_blade_1', qty: 1 }, outfit: null, accessory: null });
    const b = gearLook({ weapon: { id: 'w_blade_1', qty: 1 }, outfit: null, accessory: null });
    const c = gearLook({ weapon: { id: 'w_blade_2', qty: 1 }, outfit: null, accessory: null });
    expect(sameGearLook(a, b)).toBe(true);
    expect(sameGearLook(a, c)).toBe(false);
    expect(sameGearLook(a, undefined)).toBe(false);
    expect(sameGearLook(undefined, undefined)).toBe(true);
  });
});
