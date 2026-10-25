import { INVENTORY_SLOTS, deriveForCharacter } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { makeRig, stackOf } from './econ.testkit';

describe('equip', () => {
  it('equips a weapon from the bag and shows it on the entity', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('pill_heal_s', 2), stackOf('w_sword_1', 1, { uid: 'u1', r: 2, aff: [] })];
    expect(r.run({ t: 'equip', idx: 1, id: 'w_sword_1' }).err).toBeUndefined();
    expect(r.p.save.equipment.weapon?.id).toBe('w_sword_1');
    expect(r.p.save.equipment.weapon?.r).toBe(2);
    expect(r.p.save.equipment.weapon?.uid).toBe('u1');
    expect(r.p.save.inventory.map((s) => s.id)).toEqual(['pill_heal_s']);
    expect(r.p.entity.weapon).toBe('sword');
    expect(r.conn.last('me')).toBeTruthy();
  });

  it('swaps with the current piece and puts it where the new one was', () => {
    const r = makeRig();
    r.p.save.equipment.weapon = stackOf('w_blade_1', 1, { uid: 'old' });
    r.p.save.inventory = [stackOf('grain', 3), stackOf('w_spear_1', 1, { uid: 'new' }), stackOf('hide', 1)];
    r.run({ t: 'equip', idx: 1, id: 'w_spear_1' });
    expect(r.p.save.equipment.weapon?.uid).toBe('new');
    expect(r.p.save.inventory.map((s) => s.id)).toEqual(['grain', 'w_blade_1', 'hide']);
    expect(r.p.save.inventory[1].uid).toBe('old');
    expect(r.p.entity.weapon).toBe('spear');
  });

  it('swapping works with a full bag (the old piece takes the freed slot)', () => {
    const r = makeRig();
    r.p.save.equipment.outfit = stackOf('o_1', 1, { uid: 'o-old' });
    const filler = Object.keys({ herb: 1, ore_iron: 1, hide: 1, fang: 1, meat: 1, grain: 1, cloth: 1, wine: 1 });
    r.p.save.inventory = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, i) => stackOf(filler[i % filler.length], 1));
    r.p.save.inventory.push(stackOf('o_1', 1, { uid: 'o-new' }));
    expect(r.run({ t: 'equip', idx: INVENTORY_SLOTS - 1, id: 'o_1' }).err).toBeUndefined();
    expect(r.p.save.inventory).toHaveLength(INVENTORY_SLOTS);
    expect(r.p.save.equipment.outfit?.uid).toBe('o-new');
    expect(r.p.save.inventory[INVENTORY_SLOTS - 1].uid).toBe('o-old');
  });

  it('rejects a wrong id, a bad index and things that are not equipment', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('grain', 2), stackOf('w_sword_1', 1)];
    expect(r.run({ t: 'equip', idx: 1, id: 'grain' }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'equip', idx: 5, id: 'w_sword_1' }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'equip', idx: -1, id: 'w_sword_1' }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'equip', idx: 0, id: 'grain' }).err?.code).toBe('not_equipment');
    expect(r.p.save.inventory).toHaveLength(2);
  });

  it('enforces the rank requirement (accessories one rank early)', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('w_sword_2', 1), stackOf('a_might_2', 1), stackOf('a_might_3', 1)];
    expect(r.run({ t: 'equip', idx: 0, id: 'w_sword_2' }).err?.code).toBe('rank_low');
    expect(r.run({ t: 'equip', idx: 1, id: 'a_might_2' }).err).toBeUndefined();
    expect(r.run({ t: 'equip', idx: 1, id: 'a_might_3' }).err?.code).toBe('rank_low');
    r.p.save.level = 10; // rank 2
    expect(r.run({ t: 'equip', idx: 0, id: 'w_sword_2' }).err).toBeUndefined();
    expect(r.p.save.equipment.weapon?.id).toBe('w_sword_2');
  });

  it('is refused while fighting or dead', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('w_sword_1', 1)];
    r.p.combatId = 7;
    expect(r.run({ t: 'equip', idx: 0, id: 'w_sword_1' }).err?.code).toBe('in_combat');
    r.p.combatId = null;
    r.p.entity.state = 'dead';
    expect(r.run({ t: 'equip', idx: 0, id: 'w_sword_1' }).err?.code).toBe('dead');
    expect(r.p.save.inventory).toHaveLength(1);
  });
});

describe('unequip', () => {
  it('moves the piece to the bag, keeping rarity, affixes and uid, and clamps hp to the new maximum', () => {
    const r = makeRig();
    r.p.save.level = 10;
    r.p.save.equipment.outfit = stackOf('o_2', 1, { uid: 'keep', r: 3, aff: [['hp', 50]] });
    const withGear = deriveForCharacter(r.p.save, r.ctx.now()).maxHp;
    r.p.save.hp = withGear;
    expect(r.run({ t: 'unequip', slot: 'outfit' }).err).toBeUndefined();
    expect(r.p.save.equipment.outfit).toBeNull();
    expect(r.p.save.inventory[0]).toMatchObject({ id: 'o_2', uid: 'keep', r: 3, aff: [['hp', 50]] });
    const without = deriveForCharacter(r.p.save, r.ctx.now()).maxHp;
    expect(without).toBeLessThan(withGear);
    expect(r.p.save.hp).toBe(without);
  });

  it('refuses with an empty slot, a bad slot or a full bag', () => {
    const r = makeRig();
    expect(r.run({ t: 'unequip', slot: 'weapon' }).err?.code).toBe('nothing_equipped');
    expect(r.run({ t: 'unequip', slot: 'ring' as never }).err?.code).toBe('bad_slot');
    r.p.save.equipment.weapon = stackOf('w_fist_1', 1, { uid: 'w' });
    r.p.save.inventory = Array.from({ length: INVENTORY_SLOTS }, () => stackOf('grain', 1));
    expect(r.run({ t: 'unequip', slot: 'weapon' }).err?.code).toBe('bag_full');
    expect(r.p.save.equipment.weapon?.uid).toBe('w');
  });

  it('updates the entity weapon when the weapon comes off', () => {
    const r = makeRig();
    r.p.save.equipment.weapon = stackOf('w_staff_1', 1, { uid: 'w' });
    r.h.game.ctx.markMe(r.p);
    r.h.tick();
    expect(r.p.entity.weapon).toBe('staff');
    r.run({ t: 'unequip', slot: 'weapon' });
    expect(r.p.entity.weapon).toBeUndefined();
  });
});

describe('use', () => {
  it('heals by the pill amount, capped at the missing health, and consumes one', () => {
    const r = makeRig();
    const max = deriveForCharacter(r.p.save, r.ctx.now()).maxHp;
    r.p.save.inventory = [stackOf('pill_heal_s', 2)];
    r.p.save.hp = 1;
    expect(r.run({ t: 'use', idx: 0, id: 'pill_heal_s' }).err).toBeUndefined();
    expect(r.p.save.hp).toBe(Math.min(max, 1 + 90));
    expect(r.p.save.inventory[0].qty).toBe(1);
    r.p.save.hp = max - 10;
    r.run({ t: 'use', idx: 0, id: 'pill_heal_s' });
    expect(r.p.save.hp).toBe(max);
    expect(r.p.save.inventory).toHaveLength(0);
  });

  it('does not waste a pill at full health or full qi', () => {
    const r = makeRig();
    const d = deriveForCharacter(r.p.save, r.ctx.now());
    r.p.save.hp = d.maxHp;
    r.p.save.qi = d.maxQi;
    r.p.save.inventory = [stackOf('pill_heal_s', 1), stackOf('pill_qi_s', 1), stackOf('antidote', 1)];
    expect(r.run({ t: 'use', idx: 0, id: 'pill_heal_s' }).err?.code).toBe('no_effect');
    expect(r.run({ t: 'use', idx: 1, id: 'pill_qi_s' }).err?.code).toBe('no_effect');
    expect(r.run({ t: 'use', idx: 2, id: 'antidote' }).err?.code).toBe('no_effect');
    expect(r.p.save.inventory).toHaveLength(3);
    r.p.save.qi = 0;
    expect(r.run({ t: 'use', idx: 1, id: 'pill_qi_s' }).err).toBeUndefined();
    expect(r.p.save.qi).toBe(Math.min(d.maxQi, 45));
  });

  it('checks the id against the stack at idx', () => {
    const r = makeRig();
    r.p.save.hp = 1;
    r.p.save.inventory = [stackOf('grain', 5), stackOf('pill_heal_s', 1)];
    expect(r.run({ t: 'use', idx: 0, id: 'pill_heal_s' }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'use', idx: 9, id: 'pill_heal_s' }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'use', idx: 0, id: 'grain' }).err?.code).toBe('cannot_use');
    expect(r.p.save.hp).toBe(1);
    expect(r.p.save.inventory).toHaveLength(2);
  });

  it('refuses breakthrough pills', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('pill_break_1', 1)];
    expect(r.run({ t: 'use', idx: 0, id: 'pill_break_1' }).err?.code).toBe('use_breakthrough');
    expect(r.p.save.inventory).toHaveLength(1);
  });

  it('a cultivation pill grants xp and levels up, but not past a full breakthrough bar', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('pill_train', 3)];
    r.run({ t: 'use', idx: 0, id: 'pill_train' });
    expect(r.p.save.level * 10000 + r.p.save.xp).toBeGreaterThan(10000); // xp or a level was gained
    expect(r.p.save.inventory[0].qty).toBe(2);
    r.p.save.level = 9; // stage 9: breakthrough needed
    r.p.save.xp = 99999;
    expect(r.run({ t: 'use', idx: 0, id: 'pill_train' }).err?.code).toBe('xp_full');
    expect(r.p.save.inventory[0].qty).toBe(2);
  });

  it('a manual teaches the skill, fills an empty loadout slot and is consumed', () => {
    const r = makeRig();
    r.p.save.skills = { fist_iron: { lv: 1, xp: 0 } };
    r.p.save.loadout = { active: ['fist_iron', null, null, null], internal: null, movement: null };
    r.p.save.inventory = [stackOf('manual_sword_basic', 1), stackOf('manual_int_dantian', 1), stackOf('manual_mov_light', 1)];
    expect(r.run({ t: 'use', idx: 0, id: 'manual_sword_basic' }).err).toBeUndefined();
    expect(r.p.save.skills.sword_basic).toEqual({ lv: 1, xp: 0 });
    expect(r.p.save.loadout.active).toEqual(['fist_iron', 'sword_basic', null, null]);
    r.run({ t: 'use', idx: 0, id: 'manual_int_dantian' });
    r.run({ t: 'use', idx: 0, id: 'manual_mov_light' });
    expect(r.p.save.loadout.internal).toBe('int_dantian');
    expect(r.p.save.loadout.movement).toBe('mov_light');
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.conn.of('fx').some((f) => f.kind === 'learn')).toBe(true);
  });

  it('a manual keeps its place when the skill is known or the requirements are not met', () => {
    const r = makeRig();
    r.p.save.skills = { sword_basic: { lv: 2, xp: 0 } };
    r.p.save.inventory = [stackOf('manual_sword_basic', 1), stackOf('manual_sword_heaven', 1), stackOf('manual_sword_cloud', 1)];
    expect(r.run({ t: 'use', idx: 0, id: 'manual_sword_basic' }).err?.code).toBe('already_known');
    expect(r.run({ t: 'use', idx: 1, id: 'manual_sword_heaven' }).err?.code).toBe('rank_low');
    r.p.save.stats.agility = 3;
    expect(r.run({ t: 'use', idx: 2, id: 'manual_sword_cloud' }).err?.code).toBe('stats_low');
    expect(r.p.save.inventory).toHaveLength(3);
    expect(r.p.save.skills.sword_basic.lv).toBe(2);
  });

  it('a full loadout is left alone', () => {
    const r = makeRig();
    r.p.save.skills = { a: { lv: 1, xp: 0 } };
    r.p.save.loadout.active = ['fist_iron', 'fist_tiger', 'blade_wild', 'spear_pierce'];
    r.p.save.skills = Object.fromEntries(r.p.save.loadout.active.map((s) => [s as string, { lv: 1, xp: 0 }]));
    r.p.save.inventory = [stackOf('manual_sword_basic', 1)];
    r.run({ t: 'use', idx: 0, id: 'manual_sword_basic' });
    expect(r.p.save.skills.sword_basic).toBeTruthy();
    expect(r.p.save.loadout.active).toEqual(['fist_iron', 'fist_tiger', 'blade_wild', 'spear_pierce']);
  });

  it('is refused in combat', () => {
    const r = makeRig();
    r.p.save.hp = 1;
    r.p.save.inventory = [stackOf('pill_heal_s', 1)];
    r.p.combatId = 3;
    expect(r.run({ t: 'use', idx: 0, id: 'pill_heal_s' }).err?.code).toBe('in_combat');
  });
});

describe('drop', () => {
  it('destroys part or all of a stack', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('grain', 10), stackOf('w_sword_1', 1, { uid: 'x' })];
    expect(r.run({ t: 'drop', idx: 0, id: 'grain', qty: 4 }).err).toBeUndefined();
    expect(r.p.save.inventory[0].qty).toBe(6);
    r.run({ t: 'drop', idx: 0, id: 'grain', qty: 6 });
    expect(r.p.save.inventory.map((s) => s.id)).toEqual(['w_sword_1']);
    r.run({ t: 'drop', idx: 0, id: 'w_sword_1', qty: 1 });
    expect(r.p.save.inventory).toHaveLength(0);
  });

  it('validates id, index and quantity', () => {
    const r = makeRig();
    r.p.save.inventory = [stackOf('grain', 3)];
    expect(r.run({ t: 'drop', idx: 0, id: 'herb', qty: 1 }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'drop', idx: 3, id: 'grain', qty: 1 }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'drop', idx: 0, id: 'grain', qty: 0 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'drop', idx: 0, id: 'grain', qty: 4 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'drop', idx: 0, id: 'grain', qty: 1.5 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'drop', idx: 0, id: 'grain', qty: -1 }).err?.code).toBe('bad_qty');
    expect(r.p.save.inventory[0].qty).toBe(3);
  });
});
