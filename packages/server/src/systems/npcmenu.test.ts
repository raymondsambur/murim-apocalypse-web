import type { ActiveMission, NpcMenu } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { makeRig, NPC, stackOf } from './econ.testkit';
import { npcMenuDecorators } from './npcmenu';

const active = (id: string, extra: Partial<ActiveMission> = {}): ActiveMission => ({
  id,
  type: 'hunt',
  title: 'Cull the Wolves',
  desc: '',
  settlementId: 0,
  target: { monster: 'wolf', count: 3 },
  minRank: 1,
  level: 2,
  reward: { xp: 10, gold: 5 },
  expires: 99,
  progress: 3,
  acceptedDay: 0,
  done: true,
  ...extra,
});

describe('npc menu', () => {
  it('opens when the player reaches an NPC, with shop prices and the greeting', () => {
    const r = makeRig();
    const { npc, ent } = r.npc(NPC.merchant, { faction: 'jade' });
    r.stand(ent);
    r.conn.clear();
    r.h.say(r.p, { t: 'interact', id: ent.id });
    r.h.tick();
    const menu = r.conn.last('npc')?.menu as NpcMenu;
    expect(menu).toBeTruthy();
    expect(menu).toMatchObject({ id: npc.id, name: npc.name, role: 'merchant', faction: 'jade', settlementId: npc.settlementId, level: npc.level, turnIns: [] });
    expect(menu.greeting).toBe(r.sim.greeting(npc, r.p.name));
    expect(menu.shop?.sellMult).toBe(0.4);
    expect(menu.shop?.entries).toEqual([
      { id: 'grain', price: 5, stock: null }, // ceil(4 * 1.15)
      { id: 'pill_heal_s', price: 23, stock: null },
      { id: 'cloth', price: 11, stock: null }, // ceil(9 * 1.15)
    ]);
    expect(menu.teaches).toBeUndefined();
    expect(menu.restPrice).toBeUndefined();
    // No generic greeting note: the menu handled the interaction.
    expect(r.conn.of('note')).toHaveLength(0);
  });

  it('shows reputation-adjusted prices', () => {
    const r = makeRig();
    const { npc, ent } = r.npc(NPC.merchant, { faction: 'jade' });
    r.stand(ent);
    r.p.save.reputation.jade = 60;
    const menu = r.ask('npc', { id: npc.id })?.data as NpcMenu;
    expect(menu.shop?.entries.find((e) => e.id === 'pill_heal_s')?.price).toBe(21);
  });

  it('the npc query returns the same menu, within range only', () => {
    const r = makeRig();
    const { npc, ent } = r.npc(NPC.merchant);
    r.stand(ent);
    r.conn.clear();
    r.h.say(r.p, { t: 'interact', id: ent.id });
    r.h.tick();
    const fromInteract = r.conn.last('npc')?.menu;
    const res = r.ask('npc', { id: npc.id });
    expect(res?.ok).toBe(true);
    expect(res?.data).toEqual(fromInteract);
    expect(r.ask('npc', { id: 99999 })?.err).toBe('not_found');
    expect(r.ask('npc', { id: 'x' })?.err).toBe('not_found');
    const far = r.h.world.settlements[1].spawn;
    r.h.game.movement.teleport(r.p.entity, far.x, far.y);
    expect(r.ask('npc', { id: npc.id })?.err).toBe('too_far');
  });

  it('masters list what they teach with ok / reason and the price they would charge', () => {
    const r = makeRig();
    const { ent } = r.npc(NPC.villager, { role: 'master', faction: 'azure', teaches: ['sword_basic', 'sword_plum', 'sword_cloud'] });
    r.stand(ent);
    r.p.save.gold = 50;
    r.p.save.skills = { sword_cloud: { lv: 1, xp: 0 } };
    r.p.save.masterId = -NPC.villager;
    const menu = r.ask('npc', { id: NPC.villager })?.data as NpcMenu;
    expect(menu.teaches).toEqual([
      { skill: 'sword_basic', gold: 24, learned: false, ok: true }, // 30 gold, 20% off for his own disciple
      { skill: 'sword_plum', gold: expect.any(Number), learned: false, ok: false, reason: 'Requires Second-Rate rank.' },
      { skill: 'sword_cloud', gold: 72, learned: true, ok: false, reason: 'Already learned.' },
    ]);
    r.p.save.gold = 10;
    const poor = r.ask('npc', { id: NPC.villager })?.data as NpcMenu;
    expect(poor.teaches?.[0]).toMatchObject({ skill: 'sword_basic', ok: false, reason: 'Costs 24 gold.' });
  });

  it('innkeepers show the rest price', () => {
    const r = makeRig();
    const { ent } = r.npc(NPC.guard2, { role: 'innkeeper', shop: 'food' });
    r.stand(ent);
    r.p.save.level = 4;
    expect((r.ask('npc', { id: NPC.guard2 })?.data as NpcMenu).restPrice).toBe(22);
  });

  it('lists the finished missions this NPC can take, and nothing else', () => {
    const r = makeRig();
    r.p.save.missions = [
      active('m1'),
      active('m2', { done: false, progress: 1 }),
      active('m3', { type: 'deliver', target: { item: 'grain', count: 2, toSettlement: 1 }, settlementId: 0, done: false, progress: 0 }),
      active('m4', { type: 'gather', target: { item: 'herb', count: 2 }, done: false, progress: 0 }),
    ];
    r.p.save.inventory = [stackOf('herb', 5), stackOf('grain', 9)];
    const elder = r.npc(NPC.elder);
    r.stand(elder.ent);
    const ids = (r.ask('npc', { id: NPC.elder })?.data as NpcMenu).turnIns;
    // m1 finished, m4 satisfied by the bag; m2 not finished; m3 is handed in at settlement 1 (and carries no cargo state yet).
    expect(ids.sort()).toEqual(['m1', 'm4']);
    // A villager takes nothing.
    const vill = r.npc(NPC.villager);
    r.stand(vill.ent);
    expect((r.ask('npc', { id: NPC.villager })?.data as NpcMenu).turnIns).toEqual([]);
  });

  it('hostile NPCs offer no services', () => {
    const r = makeRig();
    const { ent } = r.npc(NPC.merchant, { faction: 'jade' });
    r.stand(ent);
    r.p.save.reputation.jade = -80;
    const menu = r.ask('npc', { id: NPC.merchant })?.data as NpcMenu;
    expect(menu.shop).toBeUndefined();
    expect(menu.turnIns).toEqual([]);
    expect(menu.greeting).toContain('turns away');
  });

  it('runs decorators registered by other modules', () => {
    const r = makeRig();
    const { ent } = r.npc(NPC.villager, { role: 'master' });
    r.stand(ent);
    const dec = (_p: unknown, _n: unknown, menu: NpcMenu) => {
      menu.disciple = { ok: true, already: false };
    };
    npcMenuDecorators.push(dec);
    try {
      expect((r.ask('npc', { id: NPC.villager })?.data as NpcMenu).disciple).toEqual({ ok: true, already: false });
      npcMenuDecorators.push(() => {
        throw new Error('boom');
      });
      expect(r.ask('npc', { id: NPC.villager })?.ok).toBe(true);
    } finally {
      npcMenuDecorators.length = 0;
    }
  });
});
