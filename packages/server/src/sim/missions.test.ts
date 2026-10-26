import { describe, expect, it } from 'vitest';
import { FACTION_BY_ID, GOODS, ITEMS, MONSTERS, SKILLS, type MissionOffer, type MissionType } from '@murim/shared';
import { PROD_SEED, makeSim, runDays, runHours, stateOf, worldFor } from './testkit';
import type { Sim } from './api';

const TYPES: MissionType[] = ['hunt', 'gather', 'deliver', 'purify', 'defend', 'bounty', 'investigate'];

function validate(sim: Sim, o: MissionOffer, sid: number): void {
  const world = worldFor(PROD_SEED);
  const st = stateOf(sim);
  const day = sim.clock().day;
  expect(o.id).toMatch(/^m\d+$/);
  expect(TYPES).toContain(o.type);
  expect(o.title.length).toBeGreaterThan(4);
  expect(o.desc.length).toBeGreaterThan(20);
  expect(o.settlementId).toBe(sid);
  expect(Number.isInteger(o.level)).toBe(true);
  expect(o.level).toBeGreaterThanOrEqual(1);
  expect(o.level).toBeLessThanOrEqual(60);
  expect(o.minRank).toBeGreaterThanOrEqual(1);
  expect(o.minRank).toBeLessThanOrEqual(8);
  expect(Number.isInteger(o.expires)).toBe(true);
  expect(o.expires).toBeGreaterThan(day);
  expect(o.expires).toBeLessThanOrEqual(day + 14);
  expect(o.target.count).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(o.target.count)).toBe(true);
  // Rewards follow the formula within a generous multiplier range.
  const baseXp = 25 + o.level * 9;
  const baseGold = 12 + o.level * 6;
  expect(o.reward.xp).toBeGreaterThanOrEqual(Math.round(baseXp * 0.7));
  expect(o.reward.xp).toBeLessThanOrEqual(Math.round(baseXp * 5));
  expect(o.reward.gold).toBeGreaterThanOrEqual(Math.round(baseGold * 0.7));
  expect(o.reward.gold).toBeLessThanOrEqual(Math.round(baseGold * 5));
  if (o.reward.rep) {
    expect(FACTION_BY_ID[o.reward.rep.faction]).toBeTruthy();
    expect(o.reward.rep.amount).toBeGreaterThanOrEqual(2);
    expect(o.reward.rep.amount).toBeLessThanOrEqual(8);
  }
  for (const it of o.reward.items ?? []) {
    expect(ITEMS[it.id], it.id).toBeTruthy();
    expect(it.qty).toBeGreaterThanOrEqual(1);
    if (it.id.startsWith('manual_')) {
      const skill = SKILLS[it.id.slice(7)];
      expect(skill).toBeTruthy();
      expect(skill.tier).toBeLessThanOrEqual(Math.max(1, Math.floor((o.level - 1) / 9) + 1));
    }
  }
  if (o.giverId !== undefined) expect(sim.npc(o.giverId)?.settlementId).toBe(sid);
  const t = o.target;
  switch (o.type) {
    case 'hunt':
      expect(MONSTERS[t.monster!]).toBeTruthy();
      expect(MONSTERS[t.monster!].family).toBe(t.family);
      expect(t.count).toBeGreaterThanOrEqual(3);
      expect(t.count).toBeLessThanOrEqual(8);
      break;
    case 'gather':
      expect(['herb', 'ore_iron', 'hide', 'meat', 'fang']).toContain(t.item);
      expect(ITEMS[t.item!]).toBeTruthy();
      break;
    case 'deliver': {
      expect(ITEMS[t.item!]).toBeTruthy();
      expect(GOODS as readonly string[]).toContain(t.item);
      const dest = t.toSettlement!;
      expect(dest).not.toBe(sid);
      expect(world.roads.some(([a, b]) => (a === sid && b === dest) || (b === sid && a === dest))).toBe(true);
      expect(st.settlements[dest].status).not.toBe('fallen');
      break;
    }
    case 'purify':
      expect(t.family).toBe('blight');
      expect(t.radius).toBeGreaterThan(0);
      expect(sim.blightAt(t.x!, t.y!)).toBeGreaterThan(0); // posted where it was >= 45; it drifts a little
      expect(t.count).toBeGreaterThanOrEqual(5);
      break;
    case 'defend':
      expect(['blight', 'bandit']).toContain(t.family);
      expect(st.settlements[sid].siegeUntil).toBeGreaterThan(st.clock.totalHours);
      break;
    case 'bounty':
      expect(MONSTERS[t.monster!].elite || MONSTERS[t.monster!].boss).toBeTruthy();
      expect([1, 2]).toContain(t.elite);
      expect(t.count).toBe(1);
      break;
    case 'investigate':
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(world.w);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(world.h);
      break;
    default:
      break;
  }
}

describe('boards', () => {
  it('every living settlement starts with 4-8 valid offers; the ruin has none', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    for (const s of st.settlements) {
      const board = sim.board(s.id);
      if (s.status === 'fallen') {
        expect(board).toHaveLength(0);
        continue;
      }
      expect(board.length).toBeGreaterThanOrEqual(4);
      expect(board.length).toBeLessThanOrEqual(8);
      const ids = new Set(board.map((o) => o.id));
      expect(ids.size).toBe(board.length);
      for (const o of board) validate(sim, o, s.id);
    }
  });

  it('offers at the starting village are level 1-4 and have no bounties', () => {
    const sim = makeSim();
    for (let d = 0; d < 40; d++) {
      for (const o of sim.board(0)) {
        expect(o.level).toBeLessThanOrEqual(4);
        expect(o.type).not.toBe('bounty');
      }
      runDays(sim, 1);
    }
  });

  it('boards stay populated and valid over 120 days, and defend offers appear only during sieges', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    let defendSeen = 0;
    const types = new Set<string>();
    const hourlyCheck = () => {
      for (const s of st.settlements) {
        const besieged = s.siegeUntil > st.clock.totalHours;
        for (const o of sim.board(s.id)) {
          if (o.type === 'defend') {
            defendSeen++;
            expect(besieged).toBe(true);
          }
        }
      }
    };
    for (let d = 0; d < 120; d++) {
      for (let h = 0; h < 24; h += 6) {
        runHours(sim, 6);
        hourlyCheck();
      }
      for (const s of st.settlements) {
        const board = sim.board(s.id);
        if (s.status === 'fallen') {
          expect(board).toHaveLength(0);
          continue;
        }
        expect(board.length).toBeGreaterThanOrEqual(3); // may dip briefly after players take offers
        expect(board.length).toBeLessThanOrEqual(10);
        for (const o of board) {
          validate(sim, o, s.id);
          types.add(o.type);
        }
      }
    }
    expect(defendSeen).toBeGreaterThan(0);
    for (const t of ['hunt', 'gather', 'deliver', 'purify', 'investigate'] as MissionType[]) expect(types.has(t), t).toBe(true);
  });

  it('gather offers pay more for scarce goods', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const rewards: Record<'scarce' | 'plenty', number[]> = { scarce: [], plenty: [] };
    for (let round = 0; round < 12; round++) {
      for (const mode of ['scarce', 'plenty'] as const) {
        for (const s of st.settlements) {
          if (s.status === 'fallen') continue;
          for (const g of ['herb', 'ore_iron', 'hide', 'meat']) s.stock[g] = mode === 'scarce' ? 0 : s.cons[g] * 50;
        }
        // Force fresh offers.
        for (const s of st.settlements) st.boards[s.id] = [];
        runDays(sim, 1);
        for (const s of st.settlements) {
          for (const o of sim.board(s.id)) {
            if (o.type === 'gather' && ['herb', 'ore_iron', 'hide', 'meat'].includes(o.target.item!)) rewards[mode].push(o.reward.gold / (12 + o.level * 6));
          }
        }
      }
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(rewards.scarce.length).toBeGreaterThan(5);
    expect(rewards.plenty.length).toBeGreaterThan(5);
    expect(avg(rewards.scarce)).toBeGreaterThan(avg(rewards.plenty));
  });

  it('deliver offers pay a relief bonus when the destination is starving', () => {
    const collect = (starve: boolean): number => {
      const sim = makeSim();
      const st = stateOf(sim);
      const ratios: number[] = [];
      for (let round = 0; round < 25; round++) {
        if (starve) {
          for (const s of st.settlements) {
            if (s.status === 'fallen') continue;
            s.stock.grain = 0;
            s.stock.meat = 0;
            s.prod.grain = 0;
            s.prod.meat = 0;
          }
        }
        runDays(sim, 1);
        for (const s of st.settlements) {
          for (const o of sim.board(s.id)) if (o.type === 'deliver') ratios.push(o.reward.gold / (12 + o.level * 6));
        }
      }
      expect(ratios.length).toBeGreaterThan(5);
      if (starve) expect(st.settlements.filter((s) => s.flags.includes('famine')).length).toBeGreaterThan(3);
      return ratios.reduce((a, b) => a + b, 0) / ratios.length;
    };
    expect(collect(true)).toBeGreaterThan(collect(false) + 0.15);
  });

  it('purify offers point at real Blight near living settlements', () => {
    // Only one or two settlements sit within reach of the Blight in a given world, so how many offers appear
    // depends on the dice of that one seeded history: count over a few worlds.
    let found = 0;
    for (const seed of [PROD_SEED, 7, 21]) {
      const sim = makeSim(seed);
      const world = worldFor(seed);
      for (let d = 0; d < 60; d++) {
        for (const s of stateOf(sim).settlements) {
          for (const o of sim.board(s.id)) {
            if (o.type !== 'purify') continue;
            found++;
            const def = world.settlements[s.id];
            expect(Math.hypot(o.target.x! - def.x, o.target.y! - def.y)).toBeLessThanOrEqual(38);
          }
        }
        runDays(sim, 1);
      }
    }
    expect(found).toBeGreaterThan(5);
  });
});

describe('taking and returning offers', () => {
  it('takeOffer removes the offer once; returnOffer puts it back unless expired', () => {
    const sim = makeSim();
    const board = sim.board(2);
    const offer = board[0];
    const taken = sim.takeOffer(2, offer.id);
    expect(taken).toEqual(offer);
    expect(sim.board(2).some((o) => o.id === offer.id)).toBe(false);
    expect(sim.takeOffer(2, offer.id)).toBeNull();
    expect(sim.takeOffer(2, 'nope')).toBeNull();
    expect(sim.takeOffer(99, offer.id)).toBeNull();
    sim.returnOffer(taken!);
    expect(sim.board(2).some((o) => o.id === offer.id)).toBe(true);
    // No duplicates on a double return.
    sim.returnOffer(taken!);
    expect(sim.board(2).filter((o) => o.id === offer.id)).toHaveLength(1);
    // Expired offers stay gone.
    const old = sim.takeOffer(2, offer.id)!;
    runDays(sim, 15);
    sim.returnOffer(old);
    expect(sim.board(2).some((o) => o.id === old.id)).toBe(false);
  });

  it('boards are topped up and announced after offers are taken', () => {
    const sim = makeSim();
    const before = sim.board(4).length;
    for (const o of sim.board(4).slice(0, 3)) sim.takeOffer(4, o.id);
    const ev = runHours(sim, 2);
    expect(sim.board(4).length).toBeGreaterThanOrEqual(Math.min(before, 4));
    expect(ev).toContainEqual({ k: 'board', settlementId: 4 });
  });

  it('expired offers disappear on the daily refresh', () => {
    const sim = makeSim();
    const first = sim.board(3).map((o) => o.id);
    runDays(sim, 9);
    const now = sim.board(3).map((o) => o.id);
    expect(now.filter((id) => first.includes(id)).length).toBeLessThan(first.length);
  });
});

describe('recordMissionDone', () => {
  it('lets finished work help the settlement', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const s = st.settlements[2];
    // deliver -> destination stock rises
    const deliver = {
      id: 'mX1',
      type: 'deliver' as const,
      title: 't',
      desc: 'd',
      settlementId: 2,
      target: { item: 'grain', count: 8, toSettlement: 3 },
      minRank: 1,
      level: 5,
      reward: { xp: 70, gold: 42 },
      expires: 99,
    };
    const dest = st.settlements[3];
    dest.stock.grain = 5;
    const ev = sim.recordMissionDone(deliver, 'Tester');
    expect(dest.stock.grain).toBeCloseTo(13, 1);
    expect(ev.some((e) => e.k === 'settle' && e.id === 3)).toBe(true);
    // gather -> own stock rises
    const gather = { ...deliver, id: 'mX2', type: 'gather' as const, target: { item: 'herb', count: 10 } };
    const herb = s.stock.herb;
    sim.recordMissionDone(gather, 'Tester');
    expect(s.stock.herb).toBeCloseTo(herb + 10, 1);
    // purify -> Blight drops near the target and a chronicle line is written
    const h = st.hearts[0];
    const purify = { ...deliver, id: 'mX3', type: 'purify' as const, level: 12, target: { family: 'blight', count: 6, x: h.x - 6, y: h.y, radius: 8 } };
    const b0 = sim.blightAt(h.x - 6, h.y);
    const ev2 = sim.recordMissionDone(purify, 'Tester');
    expect(sim.blightAt(h.x - 6, h.y)).toBeLessThan(b0);
    expect(ev2.some((e) => e.k === 'blight')).toBe(true);
    expect(ev2.some((e) => e.k === 'chron' && /Tester/.test(e.entry.text))).toBe(true);
    // defend during a siege -> siege strength drops
    s.siegeUntil = st.clock.totalHours + 20;
    s.siegeBy = 'blight';
    s.siegeStrength = 50;
    s.status = 'besieged';
    const defend = { ...deliver, id: 'mX4', type: 'defend' as const, target: { family: 'blight', count: 8, x: 136, y: 58, radius: 20 } };
    sim.recordMissionDone(defend, 'Tester');
    expect(s.siegeStrength).toBeLessThan(50);
    // bounty -> chronicle
    const bounty = { ...deliver, id: 'mX5', type: 'bounty' as const, target: { monster: 'tiger', family: 'beast', count: 1, elite: 1 } };
    const ev3 = sim.recordMissionDone(bounty, 'Tester');
    expect(ev3.some((e) => e.k === 'chron' && /Tester slew the Mountain Tiger/.test(e.entry.text))).toBe(true);
  });
});
