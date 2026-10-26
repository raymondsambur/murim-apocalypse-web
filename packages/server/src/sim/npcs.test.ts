import { describe, expect, it } from 'vitest';
import { FACTION_BY_ID, ITEMS, SKILLS, guardHeadcount, isPassable, rankOf, type NpcRole, type NpcState, type SimEvent } from '@murim/shared';
import { PROD_SEED, makeSim, runDays, stateOf, worldFor } from './testkit';
import type { Sim } from './api';

function count(sim: Sim, sid: number, role: NpcRole): number {
  return sim.npcs(sid).filter((n) => n.role === role).length;
}

describe('initial roster', () => {
  const world = worldFor(PROD_SEED);
  const sim = makeSim();
  const all = sim.npcs();

  it('has unique ids starting at 1, valid names, looks and passable homes near their buildings', () => {
    const ids = new Set(all.map((n) => n.id));
    expect(ids.size).toBe(all.length);
    expect(Math.min(...ids)).toBe(1);
    expect(stateOf(sim).nextNpcId).toBe(Math.max(...ids) + 1);
    for (const n of all) {
      expect(n.name.length).toBeGreaterThan(4);
      expect(n.alive).toBe(true);
      expect(n.look.outfit).toBeGreaterThanOrEqual(0);
      expect(isPassable(world, n.homeX, n.homeY)).toBe(true);
      const def = world.settlements[n.settlementId];
      // A legend's hermitage stands a few tiles beyond the ring.
      expect(Math.hypot(n.homeX - def.x, n.homeY - def.y)).toBeLessThanOrEqual(def.radius + (n.role === 'legend' ? 16 : 4));
      expect(n.level).toBeGreaterThanOrEqual(1);
      expect(n.age).toBeGreaterThan(10);
    }
    expect(sim.npc(all[0].id)).toBe(all[0]);
    expect(sim.npc(99999)).toBeUndefined();
  });

  it('staffs every living settlement with the services the brief requires; the ruin is empty', () => {
    const ruin = world.settlements.length - 1;
    expect(sim.npcs(ruin)).toHaveLength(0);
    for (const def of world.settlements) {
      if (def.kind === 'ruin') continue;
      const id = def.id;
      expect(count(sim, id, 'guard')).toBe(guardHeadcount(def.kind));
      expect(count(sim, id, 'elder')).toBe(1);
      expect(count(sim, id, 'merchant')).toBe(1);
      const villagers = count(sim, id, 'villager');
      expect(villagers).toBeGreaterThanOrEqual(3);
      expect(villagers).toBeLessThanOrEqual(6);
      const hasInn = def.buildingIds.some((b) => world.buildings[b].kind === 'inn');
      expect(count(sim, id, 'innkeeper')).toBe(hasInn ? 1 : 0);
      expect(count(sim, id, 'smith')).toBe(['village', 'town', 'fort'].includes(def.kind) ? 1 : 0);
      expect(count(sim, id, 'alchemist')).toBe(['village', 'town', 'sectHall'].includes(def.kind) ? 1 : 0);
      const masters = count(sim, id, 'master');
      if (def.kind === 'sectHall') expect(masters).toBeGreaterThanOrEqual(3);
      if (def.kind === 'sectHall') expect(masters).toBeLessThanOrEqual(4);
      if (def.kind === 'fort') expect([2, 3]).toContain(masters);
      if (def.kind === 'town') expect([1, 2]).toContain(masters);
      if (def.kind === 'village') expect(masters).toBeGreaterThanOrEqual(1);
    }
  });

  it('assigns shops to the right roles', () => {
    for (const n of all) {
      const want: Partial<Record<NpcRole, string>> = { merchant: 'general', smith: 'weapons', alchemist: 'medicine', innkeeper: 'food' };
      expect(n.shop).toBe(want[n.role] ?? 'none');
    }
  });

  it('masters belong to a faction and teach 2-4 skills of its schools within their rank', () => {
    const masters = all.filter((n) => n.role === 'master');
    expect(masters.length).toBeGreaterThanOrEqual(10);
    const world2 = world;
    for (const m of masters) {
      expect(m.faction).toBeTruthy();
      expect(m.teaches.length).toBeGreaterThanOrEqual(2);
      expect(m.teaches.length).toBeLessThanOrEqual(4);
      const schools = FACTION_BY_ID[m.faction!].schools;
      for (const id of m.teaches) {
        expect(SKILLS[id]).toBeTruthy();
        expect(schools).toContain(SKILLS[id].school);
        expect(SKILLS[id].req.rank).toBeLessThanOrEqual(rankOf(m.level));
      }
      const kind = world2.settlements[m.settlementId].kind;
      const [lo, hi] = kind === 'village' ? [8, 18] : kind === 'town' ? [14, 30] : [20, 40];
      expect(m.level).toBeGreaterThanOrEqual(lo);
      expect(m.level).toBeLessThanOrEqual(hi + 6); // teaching a high-rank skill may lift the level
      const ctl = stateOf(sim).settlements[m.settlementId].controller;
      if (ctl) expect(m.faction).toBe(ctl);
    }
    // The starting village offers a first lesson of at least two schools.
    const startMasters = all.filter((n) => n.role === 'master' && n.settlementId === 0);
    expect(startMasters.length).toBeGreaterThanOrEqual(2);
    const schoolsTaught = new Set(startMasters.flatMap((m) => m.teaches.map((id) => SKILLS[id].school)));
    expect(schoolsTaught.size).toBeGreaterThanOrEqual(2);
    expect(startMasters.some((m) => m.teaches.some((id) => SKILLS[id].tier === 1))).toBe(true);
  });

  it('has legends: about one per two settlements at levels 36-60', () => {
    const legends = all.filter((n) => n.role === 'legend');
    expect(legends.length).toBeGreaterThanOrEqual(3);
    expect(legends.length).toBeLessThanOrEqual(5);
    for (const l of legends) {
      expect(l.legend).toBe(true);
      expect(l.title.length).toBeGreaterThan(3);
      expect(l.level).toBeGreaterThanOrEqual(36);
      expect(l.level).toBeLessThanOrEqual(60);
      expect(l.settlementId).not.toBe(0);
      expect(l.teaches.length).toBeGreaterThan(0);
    }
  });
});

describe('read side', () => {
  const sim = makeSim();
  const all = sim.npcs();

  it('greets by role and condition with the player name and never mutates the sim', () => {
    const before = sim.serialize().json;
    for (const n of all) {
      const g = sim.greeting(n, 'Mi-rae');
      expect(g.length).toBeGreaterThan(10);
      expect(g).not.toMatch(/\{p\}/);
    }
    const guard = all.find((n) => n.role === 'guard')!;
    expect(sim.greeting(guard, 'Mi-rae')).toBe(sim.greeting(guard, 'Mi-rae'));
    expect(sim.serialize().json).toBe(before);
    const stNpc = stateOf(sim).settlements[guard.settlementId];
    stNpc.siegeUntil = stateOf(sim).clock.totalHours + 10;
    const lines = new Set<string>();
    for (let i = 0; i < 40; i++) lines.add(sim.greeting(guard, `P${i}`));
    expect([...lines].some((l) => /gates|surrounded|blade/.test(l))).toBe(true);
    stNpc.siegeUntil = 0;
  });

  it('lists shops by type with valid items and a sell multiplier of 0.4-0.5', () => {
    for (const n of all) {
      const shop = sim.shopFor(n);
      if (n.shop === 'none') {
        expect(shop).toBeNull();
        continue;
      }
      expect(shop).not.toBeNull();
      expect(shop!.items.length).toBeGreaterThan(2);
      expect(shop!.sellMult).toBeGreaterThanOrEqual(0.4);
      expect(shop!.sellMult).toBeLessThanOrEqual(0.5);
      for (const id of shop!.items) expect(ITEMS[id], id).toBeTruthy();
      expect(new Set(shop!.items).size).toBe(shop!.items.length);
      if (n.shop === 'weapons') expect(shop!.items.every((id) => /^(w_|o_)/.test(id))).toBe(true);
      if (n.shop === 'medicine') expect(shop!.items).toContain('antidote');
      if (n.shop === 'general') expect(shop!.items).toContain('cooked_meat');
    }
  });

  it('weapon shops stock better gear in richer settlements', () => {
    const smith = all.find((n) => n.role === 'smith')!;
    const s = stateOf(sim).settlements[smith.settlementId];
    const p = s.prosperity;
    s.prosperity = 20;
    const poor = sim.shopFor(smith)!.items.length;
    s.prosperity = 85;
    const rich = sim.shopFor(smith)!.items.length;
    s.prosperity = p;
    expect(rich).toBeGreaterThan(poor);
    expect(sim.shopFor({ ...smith, alive: false })).toBeNull();
  });
});

describe('lives, deaths and succession', () => {
  it('ages one year per 120 days', () => {
    const sim = makeSim();
    const probe = sim.npcs().find((n) => n.role === 'guard')!;
    const a0 = probe.age;
    runDays(sim, 120);
    if (probe.alive) expect(probe.age - a0).toBeCloseTo(1, 1);
  });

  it('trains masters: xp turns into levels', () => {
    const sim = makeSim();
    const masters = sim.npcs().filter((n) => n.role === 'master');
    const before = masters.reduce((a, m) => a + m.level, 0);
    runDays(sim, 240);
    const after = masters.filter((m) => m.alive).reduce((a, m) => a + m.level, 0);
    const alive = masters.filter((m) => m.alive).length;
    const adjusted = before - masters.filter((m) => !m.alive).reduce((a, m) => a + m.level, 0);
    expect(alive).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(adjusted);
  });

  it('old masters die of old age, are chronicled, and a successor inherits the teachings', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const hall = worldFor(PROD_SEED).settlements.find((x) => x.kind === 'sectHall')!;
    const victim = sim.npcs().find((n) => n.role === 'master' && n.settlementId === hall.id)!;
    const teaches = [...victim.teaches];
    const sid = victim.settlementId;
    const mastersBefore = count(sim, sid, 'master');
    victim.age = 140; // far past any longevity
    const events: SimEvent[] = [];
    for (let d = 0; d < 40 && victim.alive; d++) events.push(...runDays(sim, 1));
    events.push(...runDays(sim, 6)); // time for the successor to arrive
    expect(victim.alive).toBe(false);
    expect(victim.causeOfDeath).toBe('old age');
    expect(victim.diedDay).not.toBeNull();
    expect(events).toContainEqual({ k: 'npcDied', id: victim.id });
    const line = st.chronicle.find((c) => c.text.includes(victim.name) && /died of old age/.test(c.text));
    expect(line).toBeTruthy();
    expect(line!.importance).toBeGreaterThanOrEqual(2);
    // Succession.
    const born = events.filter((e): e is Extract<SimEvent, { k: 'npcBorn' }> => e.k === 'npcBorn');
    const heirs = born.map((b) => sim.npc(b.id)!).filter((n) => n.role === 'master' && n.settlementId === sid);
    expect(heirs.length).toBeGreaterThanOrEqual(1);
    expect(heirs.some((h) => teaches.every((t) => h.teaches.includes(t)))).toBe(true);
    expect(st.chronicle.some((c) => /takes the mantle of Master/.test(c.text) && c.text.includes(victim.name))).toBe(true);
    expect(count(sim, sid, 'master')).toBeGreaterThanOrEqual(mastersBefore - 1);
  });

  it('shopkeepers are replaced so services never vanish', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const smith = sim.npcs().find((n) => n.role === 'smith')!;
    const alch = sim.npcs().find((n) => n.role === 'alchemist')!;
    const merchant = sim.npcs().find((n) => n.role === 'merchant')!;
    for (const n of [smith, alch, merchant]) n.age = 150;
    for (let d = 0; d < 60 && [smith, alch, merchant].some((n) => n.alive); d++) runDays(sim, 1);
    runDays(sim, 6);
    for (const n of [smith, alch, merchant]) {
      expect(n.alive).toBe(false);
      expect(sim.npcs(n.settlementId).some((x) => x.role === n.role && x.alive && x.id !== n.id)).toBe(true);
    }
    expect(st.ext.stats.successions).toBeGreaterThanOrEqual(3);
  });

  it('keeps every service staffed and the roster size stable over 360 days', () => {
    const world = worldFor(PROD_SEED);
    const sim = makeSim();
    const st = stateOf(sim);
    const start = sim.npcs().length;
    const sizes: number[] = [];
    const gaps: Record<string, number> = {};
    let worstGap = 0;
    runDays(sim, 360, () => {
      sizes.push(sim.npcs().length);
      for (const s of st.settlements) {
        if (s.status === 'fallen') continue;
        const def = world.settlements[s.id];
        const need: NpcRole[] = ['merchant', 'elder'];
        if (['village', 'town', 'fort'].includes(def.kind)) need.push('smith');
        if (['village', 'town', 'sectHall'].includes(def.kind)) need.push('alchemist');
        if (def.kind !== 'hamlet') need.push('master');
        for (const role of need) {
          const key = `${s.id}:${role}`;
          if (count(sim, s.id, role) === 0) {
            gaps[key] = (gaps[key] ?? 0) + 1;
            worstGap = Math.max(worstGap, gaps[key]);
          } else gaps[key] = 0;
        }
      }
    });
    expect(worstGap).toBeLessThanOrEqual(10);
    for (const n of sizes) {
      expect(n).toBeGreaterThan(start * 0.7);
      expect(n).toBeLessThan(start * 1.35);
    }
    expect(sim.npcs().filter((n) => n.legend).length).toBeGreaterThanOrEqual(2);
    expect(st.ext.stats.npcDeaths).toBeGreaterThanOrEqual(5);
    // Dead NPCs are pruned from the book after a while, never reused.
    const ids = st.npcs.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(st.npcs.filter((n) => !n.alive).length).toBeLessThan(60);
  });

  it('emits npcMoved when legends wander and keeps their records consistent', () => {
    const sim = makeSim();
    const ev = runDays(sim, 90);
    const moved = ev.filter((e): e is Extract<SimEvent, { k: 'npcMoved' }> => e.k === 'npcMoved');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((m) => !!sim.npc(m.id))).toBe(true);
    const world = worldFor(PROD_SEED);
    for (const n of sim.npcs()) {
      expect(isPassable(world, n.homeX, n.homeY)).toBe(true);
      expect(stateOf(sim).settlements[n.settlementId].status).not.toBe('fallen');
    }
  });

  it('a fallen settlement kills or scatters its people and is restaffed when retaken', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const world = worldFor(PROD_SEED);
    // Any living town (derived from the world, not a magic id).
    const sid = world.settlements.find((d) => d.kind === 'town')!.id;
    const before = sim.npcs(sid).length;
    expect(before).toBeGreaterThan(8);
    // Force a Blight fall by a decisive siege.
    const s = st.settlements[sid];
    s.defense = 0;
    s.siegeUntil = st.clock.totalHours + 2;
    s.siegeStrength = 500;
    s.siegeBy = 'blight';
    s.status = 'besieged';
    const ev = runDays(sim, 1);
    expect(s.status as string).toBe('fallen');
    expect(sim.npcs(sid)).toHaveLength(0);
    const departed = ev.filter((e) => e.k === 'npcDied' || e.k === 'npcMoved').length;
    expect(departed).toBeGreaterThanOrEqual(before - 2);
    // Retake and restaff.
    for (let d = 0; d < 200 && (s.status as string) === 'fallen'; d++) runDays(sim, 1);
    expect(s.status as string).not.toBe('fallen');
    runDays(sim, 3);
    expect(sim.npcs(sid).length).toBeGreaterThan(5);
    expect(count(sim, sid, 'merchant')).toBeGreaterThanOrEqual(1);
  });
});

describe('npc records', () => {
  it('survive a save/restore with identical content', () => {
    const sim = makeSim();
    runDays(sim, 30);
    const copy = makeSim(PROD_SEED, JSON.parse(JSON.stringify(sim.serialize())));
    const a: NpcState[] = sim.npcs();
    const b: NpcState[] = copy.npcs();
    expect(b).toEqual(a);
    for (const n of a) expect(copy.npc(n.id)).toEqual(n);
  });
});
