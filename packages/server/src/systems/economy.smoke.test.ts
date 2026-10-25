/**
 * Smoke test of the economy modules against the REAL world simulation: NPC menus from the real roster, shops with
 * real prices, and every kind of mission the real boards produce, accepted and handed in.
 */
import { ITEMS, MONSTERS, type ActiveMission, type MissionOffer, type MissionType, type NpcMenu, type NpcState, type S2C } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import type { Entity } from '../ctx';
import { makeRig, stackOf, type Rig } from './econ.testkit';
import type { MonsterKilledEvent } from './events';
import { TURNIN_ROLES } from './missions';
import { getServices } from './services';

function kill(r: Rig, extra: Partial<MonsterKilledEvent>): void {
  r.ctx.events.emit('monsterKilled', { killers: [r.p], entityId: 1, defId: 'wolf', family: 'beast', level: 2, elite: 0, x: 0, y: 0, spawnId: 1, siege: null, bountyFor: null, heartId: null, ...extra });
}

function npcWith(r: Rig, settlement: number, pred: (n: NpcState) => boolean): { npc: NpcState; ent: Entity } | undefined {
  for (const npc of r.sim.npcs(settlement)) {
    const ent = r.ctx.npcEntity(npc.id);
    if (ent && pred(npc)) return { npc, ent };
  }
  return undefined;
}

describe('economy against the real sim', () => {
  it('shops, teachers and innkeepers of the starting village work end to end', () => {
    const r = makeRig({ real: true });
    const merchant = npcWith(r, 0, (n) => n.role === 'merchant')!;
    expect(merchant).toBeTruthy();
    r.stand(merchant.ent);
    r.conn.clear();
    r.h.say(r.p, { t: 'interact', id: merchant.ent.id });
    r.h.tick();
    const menu = r.conn.last('npc')?.menu as NpcMenu;
    expect(menu.shop?.entries.length).toBeGreaterThan(3);
    for (const e of menu.shop!.entries) {
      expect(ITEMS[e.id]).toBeTruthy();
      expect(e.price).toBeGreaterThanOrEqual(1);
    }
    expect(menu.greeting.length).toBeGreaterThan(5);
    const entry = menu.shop!.entries.find((e) => e.id === 'pill_heal_s') ?? menu.shop!.entries[0];
    r.p.save.gold = entry.price * 3;
    expect(r.run({ t: 'buy', npc: merchant.npc.id, item: entry.id, qty: 3 }).err).toBeUndefined();
    expect(r.p.save.gold).toBe(0);
    const sold = r.run({ t: 'sell', npc: merchant.npc.id, idx: 0, id: entry.id, qty: 3 });
    expect(sold.err).toBeUndefined();
    expect(r.p.save.gold).toBeGreaterThan(0);
    expect(r.p.save.gold).toBeLessThan(entry.price * 3);

    const master = npcWith(r, 0, (n) => n.role === 'master' && n.teaches.length > 0)!;
    expect(master).toBeTruthy();
    r.stand(master.ent);
    r.p.save.gold = 10_000;
    r.p.save.stats = { might: 40, agility: 40, vitality: 40, spirit: 40, insight: 40, fortune: 10 };
    const mm = r.ask('npc', { id: master.npc.id })?.data as NpcMenu;
    expect(mm.teaches!.length).toBe(master.npc.teaches.length);
    const first = mm.teaches!.find((t) => t.ok)!;
    expect(first).toBeTruthy();
    expect(r.run({ t: 'learn', npc: master.npc.id, skill: first.skill }).err).toBeUndefined();
    expect(r.p.save.skills[first.skill]).toEqual({ lv: 1, xp: 0 });
    expect(r.p.save.gold).toBe(10_000 - first.gold);

    const inn = npcWith(r, 0, (n) => n.role === 'innkeeper');
    if (inn) {
      r.stand(inn.ent);
      r.p.save.hp = 1;
      expect((r.ask('npc', { id: inn.npc.id })?.data as NpcMenu).restPrice).toBe(10 + 3 * r.p.save.level);
      expect(r.run({ t: 'rest', npc: inn.npc.id }).err).toBeUndefined();
      expect(r.p.save.hp).toBeGreaterThan(1);
    }
    r.h.close();
  });

  it('every offer type the real boards post can be accepted, finished and handed in', () => {
    const r = makeRig({ real: true });
    const spawned: unknown[][] = [];
    getServices(r.ctx).monsters = {
      spawnBounty: (owner, defId, level, elite, near) => (spawned.push([defId, level, elite, near]), r.ctx.entities.create({ kind: 'monster', name: 'Bounty', x: owner.entity.x, y: owner.entity.y })),
      removeBounty: () => {},
    };
    const done = new Set<MissionType>();
    const fanned: S2C['t'][] = [];
    const settlements = r.h.world.settlements.filter((s) => s.kind !== 'ruin');
    let completed = 0;
    for (const s of settlements) {
      r.h.game.movement.teleport(r.p.entity, s.spawn.x, s.spawn.y);
      r.h.tick(2);
      const board = r.ask('board', { settlement: s.id });
      if (!board?.ok) continue;
      const offers = (board.data as { offers: MissionOffer[] }).offers;
      for (const o of offers) {
        if (done.has(o.type)) continue;
        r.p.save.inventory = [];
        r.p.save.level = (o.minRank - 1) * 9 + 1;
        r.h.game.movement.teleport(r.p.entity, s.spawn.x, s.spawn.y);
        r.h.tick(2);
        const acc = r.run({ t: 'maccept', offer: o.id, settlement: s.id });
        expect(acc.err, `${o.type} ${o.id}`).toBeUndefined();
        const m = r.p.save.missions.find((x) => x.id === o.id) as ActiveMission;
        expect(m).toBeTruthy();
        const t = m.target;
        switch (m.type) {
          case 'hunt':
            for (let i = 0; i < t.count; i++) kill(r, { defId: t.monster ?? 'wolf', family: MONSTERS[t.monster ?? 'wolf']?.family ?? 'beast' });
            break;
          case 'purify':
            for (let i = 0; i < t.count; i++) kill(r, { defId: 'hollow', family: 'blight', x: t.x!, y: t.y! });
            break;
          case 'bounty':
            expect(spawned.at(-1)).toEqual([t.monster, m.level, t.elite, s.id]);
            kill(r, { defId: t.monster!, family: MONSTERS[t.monster!].family, bountyFor: r.p.charId });
            break;
          case 'investigate':
            r.h.game.movement.teleport(r.p.entity, t.x!, t.y!);
            r.h.tick(12);
            break;
          case 'gather':
          case 'deliver':
            expect(ITEMS[t.item!]).toBeTruthy();
            r.p.save.inventory = [stackOf(t.item!, t.count)];
            r.h.tick(12);
            break;
          default:
            continue;
        }
        const live = r.p.save.missions.find((x) => x.id === o.id)!;
        expect(live.done, `${o.type} should be finished`).toBe(true);
        // Hand it in where it belongs.
        const where = m.type === 'deliver' ? t.toSettlement! : s.id;
        const taker = npcWith(r, where, (n) => TURNIN_ROLES.has(n.role) || n.id === m.giverId);
        expect(taker, `a taker in settlement ${where}`).toBeTruthy();
        r.stand(taker!.ent);
        const gold = r.p.save.gold;
        r.conn.clear();
        const res = r.run({ t: 'mturnin', id: o.id });
        expect(res.err, `${o.type} hand-in`).toBeUndefined();
        fanned.push(...r.conn.sent.map((x) => x.t));
        expect(r.p.save.gold).toBeGreaterThanOrEqual(gold + m.reward.gold);
        expect(r.p.save.missions.find((x) => x.id === o.id)).toBeUndefined();
        done.add(o.type);
        completed++;
      }
    }
    expect(done.has('hunt')).toBe(true);
    expect(done.has('gather') || done.has('deliver')).toBe(true);
    expect(r.p.save.completedMissions).toBe(completed);
    expect(completed).toBeGreaterThanOrEqual(4);
    // The world heard about it (settlement view pushed through the fan-out).
    expect(fanned).toContain('settle');
    r.h.close();
  });

  it('defend jobs appear during a siege and count kills of the siege wave', () => {
    const r = makeRig({ real: true });
    const st = r.sim.state.settlements[0];
    st.siegeBy = 'blight';
    st.siegeStrength = 40;
    st.siegeUntil = r.sim.state.clock.totalHours + 60;
    for (let i = 0; i < 24 && !r.sim.board(0).some((o) => o.type === 'defend'); i++) r.h.game.advanceHour(r.ctx.now());
    const offer = r.sim.board(0).find((o) => o.type === 'defend');
    expect(offer, 'a defend offer on the besieged board').toBeTruthy();
    expect(r.run({ t: 'maccept', offer: offer!.id, settlement: 0 }).err).toBeUndefined();
    for (let i = 0; i < offer!.target.count; i++) kill(r, { defId: 'hollow', family: 'blight', siege: 0 });
    expect(r.p.save.missions[0].done).toBe(true);
    r.stand(npcWith(r, 0, (n) => TURNIN_ROLES.has(n.role))!.ent);
    const strength = st.siegeStrength;
    expect(r.run({ t: 'mturnin', id: offer!.id }).err).toBeUndefined();
    // recordMissionDone applied the rally effect to the siege.
    expect(st.siegeStrength).toBeLessThan(strength);
    r.h.close();
  });

  it('jobs expire and the hourly sweep copes with the real clock', () => {
    const r = makeRig({ real: true });
    const offers = r.sim.board(0).filter((o) => o.minRank <= 1).slice(0, 3);
    for (const o of offers) expect(r.run({ t: 'maccept', offer: o.id, settlement: 0 }).err).toBeUndefined();
    const taken = r.p.save.missions.length;
    expect(taken).toBe(offers.length);
    const last = Math.max(...offers.map((o) => o.expires));
    const day0 = r.sim.clock().day;
    for (let i = 0; i < (last - day0 + 1) * 24; i++) r.h.game.advanceHour(r.ctx.now());
    expect(r.p.save.missions).toHaveLength(0);
    expect(r.conn.of('note').filter((n) => n.text.startsWith('Mission expired')).length).toBe(taken);
    r.h.close();
  });
});
