import { INVENTORY_SLOTS, ITEMS, SKILLS, deriveForCharacter, stackValue } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { makeRig, NPC, stackOf, type Rig } from './econ.testkit';
import { buyPrice, repDiscount, restPrice, sellPrice, shopAccepts } from './shops';

/** A rig standing next to the merchant (id 2, general store with grain, minor healing pills and cloth). */
function shopRig(): { r: Rig; id: number } {
  const r = makeRig();
  const { ent } = r.npc(NPC.merchant);
  r.stand(ent);
  return { r, id: NPC.merchant };
}

/** Let every NPC shop sell a fixed list so other shop kinds can be tested with the stub sim. */
function openShops(r: Rig, items: string[], sellMult = 0.4): void {
  Object.assign(r.sim, { shopFor: (npc: { shop: string }) => (npc.shop === 'none' ? null : { items, sellMult }) });
}

describe('buy', () => {
  it('charges ceil(value * 1.15 * priceMult * reputation discount) per unit and records the trade', () => {
    const { r, id } = shopRig();
    const trades: unknown[][] = [];
    Object.assign(r.sim, { recordTrade: (...a: unknown[]) => void trades.push(a) });
    r.p.save.gold = 500;
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 3 }).err).toBeUndefined();
    expect(buyPrice(r.ctx, r.p, r.sim.npc(id)!, 'pill_heal_s')).toBe(23); // ceil(20 * 1.15)
    expect(r.p.save.gold).toBe(500 - 3 * 23);
    expect(r.p.save.inventory).toEqual([{ id: 'pill_heal_s', qty: 3 }]);
    expect(trades).toEqual([[r.sim.npc(id)!.settlementId, 'pill_heal_s', 3, 'buy']]);
    r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 2 });
    expect(r.p.save.inventory).toEqual([{ id: 'pill_heal_s', qty: 5 }]);
  });

  it('follows the settlement price multiplier and the reputation discount', () => {
    const { r, id } = shopRig();
    const { npc } = r.npc(id, { faction: 'jade' });
    r.p.save.gold = 1000;
    const price = () => buyPrice(r.ctx, r.p, npc, 'pill_heal_s');
    expect(price()).toBe(23);
    r.p.save.reputation.jade = 30;
    expect(price()).toBe(22); // ceil(21.85)
    r.p.save.reputation.jade = 60;
    expect(price()).toBe(21); // ceil(20.7)
    r.p.save.reputation.jade = -30;
    expect(price()).toBe(26); // ceil(25.3)
    r.p.save.reputation.jade = 0;
    Object.assign(r.sim, { priceMult: () => 1.5 });
    expect(price()).toBe(35); // ceil(34.5)
    r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 2 });
    expect(r.p.save.gold).toBe(1000 - 70);
    expect([repDiscount(29), repDiscount(30), repDiscount(59), repDiscount(60), repDiscount(-29), repDiscount(-30)]).toEqual([1, 0.95, 0.95, 0.9, 1, 1.1]);
  });

  it('refuses service at reputation -70 or worse', () => {
    const { r, id } = shopRig();
    r.npc(id, { faction: 'azure' });
    r.p.save.gold = 100;
    r.p.save.reputation.azure = -70;
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 1 }).err?.code).toBe('refused');
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'grain', qty: 1 }).err?.code).toBe('refused');
    r.p.save.reputation.azure = -69;
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 1 }).err).toBeUndefined();
  });

  it('refuses bad requests without touching gold or bag', () => {
    const { r, id } = shopRig();
    r.p.save.gold = 40;
    const gold = () => r.p.save.gold;
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 0 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 100 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 1.5 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_l', qty: 1 }).err?.code).toBe('not_sold');
    expect(r.run({ t: 'buy', npc: id, item: 'nonsense', qty: 1 }).err?.code).toBe('not_sold');
    expect(r.run({ t: 'buy', npc: id, item: 'pill_heal_s', qty: 2 }).err?.code).toBe('no_gold');
    expect(r.run({ t: 'buy', npc: 9999, item: 'pill_heal_s', qty: 1 }).err?.code).toBe('not_found');
    expect(r.run({ t: 'buy', npc: NPC.guard, item: 'pill_heal_s', qty: 1 }).err?.code).toBe('no_shop');
    expect(gold()).toBe(40);
    expect(r.p.save.inventory).toHaveLength(0);
  });

  it('needs distance <= 6 tiles, no fight, and a live player', () => {
    const { r, id } = shopRig();
    r.p.save.gold = 100;
    r.p.combatId = 1;
    expect(r.run({ t: 'buy', npc: id, item: 'grain', qty: 1 }).err?.code).toBe('in_combat');
    r.p.combatId = null;
    r.p.entity.state = 'dead';
    expect(r.run({ t: 'buy', npc: id, item: 'grain', qty: 1 }).err?.code).toBe('dead');
    r.p.entity.state = 'idle';
    const far = r.h.world.settlements[1].spawn;
    r.h.game.movement.teleport(r.p.entity, far.x, far.y);
    expect(r.run({ t: 'buy', npc: id, item: 'grain', qty: 1 }).err?.code).toBe('too_far');
    expect(r.p.save.gold).toBe(100);
  });

  it('is all-or-nothing when the bag cannot hold the purchase', () => {
    const { r, id } = shopRig();
    r.p.save.gold = 10000;
    r.p.save.inventory = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, i) => stackOf(i % 2 ? 'herb' : 'hide', 99));
    r.p.save.inventory.push(stackOf('grain', 98));
    // 1 free slot in the last stack + 0 free slots: room for exactly 1 more grain.
    expect(r.run({ t: 'buy', npc: id, item: 'grain', qty: 2 }).err?.code).toBe('bag_full');
    expect(r.p.save.gold).toBe(10000);
    expect(r.run({ t: 'buy', npc: id, item: 'grain', qty: 1 }).err).toBeUndefined();
    expect(r.p.save.inventory.at(-1)?.qty).toBe(99);
  });

  it('equipment is bought at rarity 0 with a fresh uid per piece', () => {
    const { r, id } = shopRig();
    openShops(r, ['w_sword_1', 'o_1']);
    r.p.save.gold = 1000;
    r.run({ t: 'buy', npc: id, item: 'w_sword_1', qty: 2 });
    expect(r.p.save.inventory).toHaveLength(2);
    expect(r.p.save.inventory.every((s) => s.r === 0 && s.qty === 1 && !!s.uid)).toBe(true);
    expect(new Set(r.p.save.inventory.map((s) => s.uid)).size).toBe(2);
    expect(r.p.save.gold).toBe(1000 - 2 * Math.ceil(ITEMS.w_sword_1.value * 1.15));
  });
});

describe('sell', () => {
  it('pays floor(value * sellMult * clamped priceMult) per unit', () => {
    const { r, id } = shopRig();
    r.p.save.inventory = [stackOf('hide', 10), stackOf('grain', 3)];
    const trades: unknown[][] = [];
    Object.assign(r.sim, { recordTrade: (...a: unknown[]) => void trades.push(a) });
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'hide', qty: 5 }).err).toBeUndefined();
    expect(r.p.save.gold).toBe(5 * 4); // floor(10 * 0.4)
    expect(r.p.save.inventory[0].qty).toBe(5);
    expect(trades.at(-1)).toEqual([r.sim.npc(id)!.settlementId, 'hide', 5, 'sell']);
    Object.assign(r.sim, { priceMult: () => 2.5 }); // clamped to 1.5
    r.run({ t: 'sell', npc: id, idx: 0, id: 'hide', qty: 1 });
    expect(r.p.save.gold).toBe(20 + 6); // floor(10 * 0.4 * 1.5)
    Object.assign(r.sim, { priceMult: () => 0.2 }); // clamped to 0.6
    r.run({ t: 'sell', npc: id, idx: 0, id: 'hide', qty: 1 });
    expect(r.p.save.gold).toBe(26 + 2); // floor(10 * 0.4 * 0.6)
  });

  it('removes the whole stack when everything is sold and validates the request', () => {
    const { r, id } = shopRig();
    r.p.save.inventory = [stackOf('grain', 3), stackOf('hide', 2)];
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'hide', qty: 1 }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'sell', npc: id, idx: 5, id: 'hide', qty: 1 }).err?.code).toBe('bad_item');
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'grain', qty: 4 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'grain', qty: 0 }).err?.code).toBe('bad_qty');
    expect(r.run({ t: 'sell', npc: id, idx: 0, id: 'grain', qty: 1.2 }).err?.code).toBe('bad_qty');
    expect(r.p.save.gold).toBe(0);
    r.run({ t: 'sell', npc: id, idx: 0, id: 'grain', qty: 3 });
    expect(r.p.save.inventory.map((s) => s.id)).toEqual(['hide']);
  });

  it('shops only buy what their type trades in', () => {
    const { r, id } = shopRig();
    openShops(r, ['grain']);
    r.p.save.inventory = [stackOf('w_sword_1', 1), stackOf('ore_iron', 4), stackOf('herb', 4), stackOf('pill_heal_s', 1), stackOf('meat', 1), stackOf('manual_sword_basic', 1)];
    const sellIdx = (npc: number, i: number, id2: string, qty = 1) => r.run({ t: 'sell', npc, idx: i, id: id2, qty }).err?.code;
    // general: materials and consumables, not gear or manuals
    expect(sellIdx(id, 0, 'w_sword_1')).toBe('shop_refuses');
    expect(sellIdx(id, 5, 'manual_sword_basic')).toBe('shop_refuses');
    expect(sellIdx(id, 1, 'ore_iron')).toBeUndefined();
    // smith: gear, ore, ingots; not herbs or pills
    r.npc(NPC.guard, { role: 'smith', shop: 'weapons' });
    r.stand(r.ctx.npcEntity(NPC.guard)!);
    expect(sellIdx(NPC.guard, 2, 'herb')).toBe('shop_refuses');
    expect(sellIdx(NPC.guard, 3, 'pill_heal_s')).toBe('shop_refuses');
    expect(sellIdx(NPC.guard, 1, 'ore_iron', 3)).toBeUndefined();
    expect(sellIdx(NPC.guard, 0, 'w_sword_1')).toBeUndefined();
    // alchemist: herbs and pills, not gear
    r.npc(NPC.guard2, { role: 'alchemist', shop: 'medicine' });
    r.stand(r.ctx.npcEntity(NPC.guard2)!);
    r.p.save.inventory = [stackOf('w_sword_1', 1), stackOf('herb', 2), stackOf('pill_heal_s', 1)];
    expect(sellIdx(NPC.guard2, 0, 'w_sword_1')).toBe('shop_refuses');
    expect(sellIdx(NPC.guard2, 1, 'herb')).toBeUndefined();
    expect(sellIdx(NPC.guard2, 2, 'pill_heal_s')).toBeUndefined();
  });

  it('values equipment by rarity and never pays more than the shop charges', () => {
    const { r, id } = shopRig();
    openShops(r, ['w_sword_1'], 0.5);
    const npc = r.npc(id).npc;
    const plain = stackOf('w_sword_1', 1, { r: 0 });
    const epic = stackOf('w_sword_1', 1, { r: 3, aff: [] });
    expect(sellPrice(r.ctx, npc, epic, 0.5)).toBeGreaterThan(sellPrice(r.ctx, npc, plain, 0.5));
    expect(sellPrice(r.ctx, npc, epic, 0.5)).toBe(Math.floor(stackValue(epic) * 0.5));
    // No item can be bought and resold for profit, whatever the market does.
    for (const pm of [0.6, 1, 1.5, 2.5]) {
      Object.assign(r.sim, { priceMult: () => pm });
      for (const def of Object.values(ITEMS)) {
        const unit = { id: def.id, qty: 1, r: 0 as const };
        for (const rep of [0, 60]) {
          r.p.save.reputation.jade = rep;
          r.npc(id, { faction: 'jade' });
          expect(sellPrice(r.ctx, npc, unit, 0.5)).toBeLessThan(buyPrice(r.ctx, r.p, npc, def.id));
        }
      }
    }
    expect(shopAccepts('general', ITEMS.grain)).toBe(true);
    expect(shopAccepts('none', ITEMS.grain)).toBe(false);
  });
});

describe('learn', () => {
  /** The villager (id 5) becomes an Azure master teaching four sword skills. */
  function masterRig(): { r: Rig; id: number } {
    const r = makeRig();
    const { ent } = r.npc(NPC.villager, { role: 'master', faction: 'azure', teaches: ['sword_basic', 'sword_cloud', 'sword_plum', 'sword_heaven'] });
    r.stand(ent);
    r.p.save.gold = 1000;
    return { r, id: NPC.villager };
  }

  it('teaches a skill at level 1, takes the gold and fills an empty loadout slot', () => {
    const { r, id } = masterRig();
    r.p.save.skills = { fist_iron: { lv: 3, xp: 0 } };
    r.p.save.loadout.active = ['fist_iron', null, null, null];
    expect(r.run({ t: 'learn', npc: id, skill: 'sword_basic' }).err).toBeUndefined();
    expect(r.p.save.gold).toBe(1000 - SKILLS.sword_basic.req.gold);
    expect(r.p.save.skills.sword_basic).toEqual({ lv: 1, xp: 0 });
    expect(r.p.save.loadout.active).toEqual(['fist_iron', 'sword_basic', null, null]);
    expect(r.conn.of('fx').some((f) => f.kind === 'learn')).toBe(true);
  });

  it('fails for each reason without charging', () => {
    const { r, id } = masterRig();
    const learn = (skill: string) => r.run({ t: 'learn', npc: id, skill }).err?.code;
    expect(learn('fist_iron')).toBe('not_taught');
    expect(learn('nonsense')).toBe('not_taught');
    expect(learn('sword_plum')).toBe('rank_low'); // rank 2
    r.p.save.stats.agility = 4;
    expect(learn('sword_cloud')).toBe('stats_low'); // agility 8
    r.p.save.stats.agility = 10;
    r.p.save.gold = 10;
    expect(learn('sword_cloud')).toBe('no_gold');
    expect(r.p.save.gold).toBe(10);
    r.p.save.gold = 1000;
    expect(learn('sword_cloud')).toBeUndefined();
    expect(learn('sword_cloud')).toBe('already_known');
    // Tier 3 needs reputation 20 with the teacher's faction (and rank 3, might 22, insight 14).
    r.p.save.level = 19;
    r.p.save.gold = 5000;
    r.p.save.stats.might = 30;
    r.p.save.stats.insight = 20;
    r.p.save.reputation.azure = 19;
    expect(learn('sword_heaven')).toBe('rep_low');
    r.p.save.reputation.azure = 20;
    expect(learn('sword_heaven')).toBeUndefined();
    // Negative standing blocks even tier 1 skills.
    r.p.save.reputation.azure = -5;
    r.p.save.stats.agility = 20;
    expect(learn('sword_plum')).toBe('rep_low');
  });

  it('gives a disciple 20% off at his own master', () => {
    const { r, id } = masterRig();
    r.p.save.masterId = -id;
    r.run({ t: 'learn', npc: id, skill: 'sword_cloud' });
    expect(r.p.save.gold).toBe(1000 - Math.ceil(SKILLS.sword_cloud.req.gold * 0.8));
  });

  it('is refused when too far, hostile, or in a fight', () => {
    const { r, id } = masterRig();
    r.p.save.reputation.azure = -80;
    expect(r.run({ t: 'learn', npc: id, skill: 'sword_basic' }).err?.code).toBe('refused');
    r.p.save.reputation.azure = 0;
    r.p.combatId = 2;
    expect(r.run({ t: 'learn', npc: id, skill: 'sword_basic' }).err?.code).toBe('in_combat');
    r.p.combatId = null;
    const far = r.h.world.settlements[2].spawn;
    r.h.game.movement.teleport(r.p.entity, far.x, far.y);
    expect(r.run({ t: 'learn', npc: id, skill: 'sword_basic' }).err?.code).toBe('too_far');
    expect(r.p.save.skills.sword_basic).toBeUndefined();
  });
});

describe('rest', () => {
  function innRig(): { r: Rig; id: number } {
    const r = makeRig();
    const { ent } = r.npc(NPC.guard2, { role: 'innkeeper', shop: 'food' });
    r.stand(ent);
    return { r, id: NPC.guard2 };
  }

  it('fully heals for 10 + 3 per level gold and clears injury', () => {
    const { r, id } = innRig();
    r.p.save.level = 5;
    r.p.save.gold = 100;
    r.p.save.hp = 1;
    r.p.save.qi = 0;
    r.p.save.injuryStacks = 2;
    r.p.save.injuryUntil = r.ctx.now() + 600000;
    expect(restPrice(r.p)).toBe(25);
    expect(r.run({ t: 'rest', npc: id }).err).toBeUndefined();
    const d = deriveForCharacter(r.p.save, r.ctx.now());
    expect(r.p.save.gold).toBe(75);
    expect(r.p.save.hp).toBe(d.maxHp);
    expect(r.p.save.qi).toBe(d.maxQi);
    expect(r.p.save.injuryStacks).toBe(0);
    expect(r.p.save.injuryUntil).toBe(0);
  });

  it('refuses without gold, when nothing needs healing, away from an innkeeper or in a fight', () => {
    const { r, id } = innRig();
    r.p.save.hp = 1;
    r.p.save.gold = 5;
    expect(r.run({ t: 'rest', npc: id }).err?.code).toBe('no_gold');
    r.p.save.gold = 100;
    r.p.combatId = 1;
    expect(r.run({ t: 'rest', npc: id }).err?.code).toBe('in_combat');
    r.p.combatId = null;
    r.run({ t: 'rest', npc: id });
    const gold = r.p.save.gold;
    expect(r.run({ t: 'rest', npc: id }).err?.code).toBe('not_needed');
    expect(r.p.save.gold).toBe(gold);
    r.p.save.hp = 1;
    expect(r.run({ t: 'rest', npc: NPC.merchant }).err?.code).toMatch(/not_innkeeper|too_far/);
    expect(r.p.save.hp).toBe(1);
  });
});
