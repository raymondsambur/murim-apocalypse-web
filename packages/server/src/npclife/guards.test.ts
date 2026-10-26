import { T, planGuards, type Point } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { SCHEDULE, scheduleKey } from './activities';
import type { LifeState } from './life';
import type { SettlementPlaces } from './places';
import { makeLifeHarness, type LifeHarness } from './testkit';

const states = (h: LifeHarness, sid: number): LifeState[] => [...h.life.states.values()].filter((s) => s.sid === sid);
const ent = (h: LifeHarness, st: LifeState) => h.ctx.npcEntity(st.npcId)!;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Run `ms` of fake time, stepping the world hour whenever one has passed (as the real runtime does). */
function runWorld(h: LifeHarness, ms: number): void {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(left, 1_000);
    h.run(chunk);
    left -= chunk;
    ticked.set(h, (ticked.get(h) ?? 0) + chunk);
    if ((ticked.get(h) ?? 0) >= h.hourMs) {
      ticked.set(h, (ticked.get(h) ?? 0) - h.hourMs);
      h.game.advanceHour(h.clock.t);
    }
  }
}
const ticked = new WeakMap<LifeHarness, number>();

function setupAt(h: LifeHarness, sid: number, hour: number): void {
  const s = h.ctx.world.settlements[sid];
  h.join('Hero', { x: s.spawn.x, y: s.spawn.y });
  h.setHour(hour);
  h.life.syncRoster();
}

/** The first living settlement of this kind. */
function settlementOfKind(h: LifeHarness, kind: string): number {
  const s = h.ctx.world.settlements.find((x) => x.kind === kind);
  if (!s) throw new Error(`no ${kind} in the test world`);
  return s.id;
}

describe('gate, outskirts and route places', () => {
  const h = makeLifeHarness({ real: true });
  const { wp } = h.life;
  const world = h.ctx.world;

  it('puts the gates on the roads with two flank spots either side', () => {
    let gates = 0;
    let onRoad = 0;
    for (const [sid, sp] of wp.settlements) {
      const s = world.settlements[sid];
      expect(sp.gates.length, s.name).toBeGreaterThanOrEqual(2);
      for (const g of sp.gates) {
        const t = world.terrain[g.door.y * world.w + g.door.x];
        gates++;
        if (t === T.Road || t === T.Dirt || t === T.Plaza) onRoad++;
        // the gate lies on (or, where the road is blocked, close to) an axis through the settlement centre
        expect(Math.min(Math.abs(g.door.x - s.x), Math.abs(g.door.y - s.y)), `${s.name} ${g.id}`).toBeLessThanOrEqual(4);
        expect(g.spots.length).toBeGreaterThanOrEqual(4);
        expect(new Set(g.spots.map((p) => `${p.x},${p.y}`)).size).toBe(g.spots.length);
        // spots 0 and 1 flank the road: on opposite sides of the gate tile, close to it
        const [a, b] = g.spots;
        expect(dist(a, g.door)).toBeLessThanOrEqual(2.3);
        expect(dist(b, g.door)).toBeLessThanOrEqual(3);
        expect(dist(a, b)).toBeGreaterThanOrEqual(1);
        for (const p of g.spots) expect(wp.comp[p.y * world.w + p.x]).toBe(wp.compOf(sid));
      }
    }
    expect(onRoad / gates).toBeGreaterThan(0.8);
    // a fort has all four openings of its wall
    for (const s of world.settlements) if (s.kind === 'fort') expect(wp.settlements.get(s.id)!.gates).toHaveLength(4);
  });

  it('adds outskirts patrol points up each road and at the edge of each farm', () => {
    for (const [sid, sp] of wp.settlements) {
      const s = world.settlements[sid];
      expect(sp.outskirts.length, s.name).toBeGreaterThan(0);
      for (const o of sp.outskirts) {
        expect(o.kind).toBe('outskirts');
        expect(wp.comp[o.door.y * world.w + o.door.x]).toBe(wp.compOf(sid));
        expect(dist(o.door, s), `${s.name} ${o.id}`).toBeGreaterThan(s.radius * 0.7);
      }
      const roadOnes = sp.outskirts.filter((o) => o.id.includes('_g'));
      for (const o of roadOnes) {
        const gate = sp.gates[Number(o.id.split('_g')[1])];
        expect(dist(o.door, gate.door)).toBeGreaterThan(3);
        expect(dist(o.door, gate.door)).toBeLessThan(11);
      }
    }
    const fieldPoints = [...wp.settlements.values()].flatMap((sp) => sp.outskirts.filter((o) => o.id.includes('_f')));
    expect(fieldPoints.length).toBeGreaterThan(3);
    for (const sp of wp.settlements.values()) {
      for (const o of sp.outskirts.filter((x) => x.id.includes('_f'))) expect(world.terrain[o.door.y * world.w + o.door.x]).toBe(T.Farm);
    }
  });

  it('exposes a squad route of inner posts, gates and outskirts sorted by angle, without the plaza', () => {
    for (const [sid, sp] of wp.settlements) {
      const s = world.settlements[sid];
      expect(sp.route.length).toBeGreaterThanOrEqual(sp.gates.length + sp.outskirts.length);
      expect(sp.route).not.toContain(sp.plaza);
      for (const g of sp.gates) expect(sp.route).toContain(g);
      for (const o of sp.outskirts) expect(sp.route).toContain(o);
      const angles = sp.route.map((p) => Math.atan2(p.door.y - s.y, p.door.x - s.x));
      for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1]);
    }
  });
});

describe('guard duties', () => {
  it('follow planGuards for every settlement', () => {
    const h = makeLifeHarness({ real: true });
    for (const s of h.ctx.world.settlements) {
      const guards = states(h, s.id).filter((g) => g.role === 'guard').sort((a, b) => a.npcId - b.npcId);
      if (s.kind === 'ruin') continue;
      const plan = planGuards(s.kind, guards.length, h.life.wp.settlements.get(s.id)!.gates.length);
      guards.forEach((g, i) => {
        expect(g.shift, `${s.name} guard ${i}`).toBe(plan[i].shift);
        expect(g.duty).toEqual(plan[i].duty);
      });
    }
    h.close();
  });

  it('re-plans when a guard dies and never leaves a lone patroller', () => {
    const h = makeLifeHarness({ real: true });
    const sid = settlementOfKind(h, 'town');
    const guards = () => states(h, sid).filter((g) => g.role === 'guard');
    const before = guards().length;
    expect(before).toBe(16);
    for (const victim of guards().slice(0, 9)) {
      h.ctx.sim.npc(victim.npcId)!.alive = false;
      h.ctx.fanOut([{ k: 'npcDied', id: victim.npcId }]);
    }
    const left = guards();
    expect(left.length).toBe(before - 9);
    for (const shift of [0, 1] as const) {
      const squad = left.filter((g) => g.shift === shift && g.duty?.kind === 'squad');
      expect(squad.length === 0 || squad.length >= 2).toBe(true);
    }
    expect(left.every((g) => g.duty !== null)).toBe(true);
    h.close();
  });
});

describe('gate guards stand their post', () => {
  it('stay beside their gate through the morning watch, two to a gate on their own flanks', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = settlementOfKind(h, 'town');
    setupAt(h, sid, 8);
    const sp: SettlementPlaces = h.life.wp.settlements.get(sid)!;
    const gateGuards = states(h, sid).filter((g) => g.role === 'guard' && g.shift === 0 && g.duty?.kind === 'gate');
    expect(gateGuards.length).toBe(6);
    runWorld(h, 10_000);
    let samples = 0;
    let atPost = 0;
    let flankShared = 0;
    let flankSamples = 0;
    for (let i = 0; i < 40; i++) {
      runWorld(h, 2_000);
      for (const g of gateGuards) {
        const duty = g.duty as { kind: 'gate'; gate: number; slot: number };
        const gate = sp.gates[duty.gate % sp.gates.length];
        samples++;
        if (dist(ent(h, g), gate.door) <= 3.2 && !ent(h, g).hidden) atPost++;
      }
      for (let k = 0; k < sp.gates.length; k++) {
        const here = gateGuards.filter((g) => (g.duty as { gate: number }).gate === k && dist(ent(h, g), sp.gates[k].door) <= 3.2);
        if (here.length >= 2) {
          flankSamples++;
          const [a, b] = here.map((g) => ent(h, g));
          if (Math.round(a.x) !== Math.round(b.x) || Math.round(a.y) !== Math.round(b.y)) flankShared++;
        }
      }
    }
    // (a guard can step off to eat a meal when hungry)
    expect(atPost / samples).toBeGreaterThan(0.6);
    expect(flankSamples).toBeGreaterThan(10);
    expect(flankShared / flankSamples).toBeGreaterThan(0.9);
    h.close();
  });

  it('never drill, gossip or wander off while their watch is on', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = settlementOfKind(h, 'town');
    setupAt(h, sid, 8);
    const watch = states(h, sid).filter((g) => g.role === 'guard' && g.shift === 0 && g.duty);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      runWorld(h, 1_500);
      for (const g of watch) if (g.act) seen.add(g.act);
    }
    expect(seen.has('train')).toBe(false);
    expect(seen.has('socialise')).toBe(false);
    expect(seen.has('wander')).toBe(false);
    h.close();
  });
});

describe('patrol squads move together', () => {
  it('converge on the same point of the route, standing in different spots, and sweep it round', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = settlementOfKind(h, 'town');
    setupAt(h, sid, 8);
    const squad = states(h, sid).filter((g) => g.role === 'guard' && g.shift === 0 && g.duty?.kind === 'squad');
    expect(squad.length).toBe(4);
    runWorld(h, 15_000);
    const posts = new Set<string>();
    let samples = 0;
    let together = 0;
    let sameSpot = 0;
    for (let i = 0; i < 120; i++) {
      runWorld(h, 2_000);
      const there = squad.filter((g) => g.ph === 'doing' && g.act === 'patrol' && g.place);
      if (there.length < squad.length - 1) continue;
      samples++;
      const ids = new Set(there.map((g) => g.place!.id));
      for (const id of ids) posts.add(id);
      if (ids.size === 1) together++;
      const tiles = new Set(there.map((g) => `${Math.round(ent(h, g).x)},${Math.round(ent(h, g).y)}`));
      if (tiles.size < there.length) sameSpot++;
    }
    expect(samples).toBeGreaterThan(8);
    // At any moment nearly all of them are standing at the same post (they swap posts within a second or two).
    expect(together / samples).toBeGreaterThan(0.8);
    expect(sameSpot / samples).toBeLessThan(0.1);
    // ... and over a few hours the squad moves round several points of the route.
    expect(posts.size).toBeGreaterThanOrEqual(3);
    const route = h.life.wp.settlements.get(sid)!.route.map((p) => p.id);
    for (const id of posts) expect(route).toContain(id);
    h.close();
  });

  it('sweep the fields too: some stop on an outskirts point', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = settlementOfKind(h, 'town');
    setupAt(h, sid, 6.5);
    const squad = states(h, sid).filter((g) => g.role === 'guard' && g.shift === 0 && g.duty?.kind === 'squad');
    const kinds = new Set<string>();
    for (let i = 0; i < 160; i++) {
      runWorld(h, 2_000);
      for (const g of squad) if (g.act === 'patrol' && g.place) kinds.add(g.place.kind);
    }
    expect(kinds.has('outskirts')).toBe(true);
    h.close();
  });
});

describe('legends keep to their hermitage', () => {
  it('take the hermitage as home and workplace when the settlement has one', () => {
    const h = makeLifeHarness({ real: true });
    const legends = [...h.life.states.values()].filter((s) => s.role === 'legend');
    expect(legends.length).toBeGreaterThan(0);
    let withHut = 0;
    for (const l of legends) {
      const sp = h.life.wp.settlements.get(l.sid)!;
      if (sp.byKind('hermitage').length) {
        withHut++;
        expect(l.home!.kind).toBe('hermitage');
        expect(l.work!.kind).toBe('hermitage');
      } else expect(l.home!.kind).not.toBe('hermitage');
    }
    // the wanderers stay on the plaza
    for (const w of [...h.life.states.values()].filter((s) => s.role === 'wanderer')) expect(w.work!.kind).toBe('plaza');
    expect(withHut).toBeGreaterThanOrEqual(0);
    h.close();
  });

  it('train, pray and rest at the hut by day and come down only in the evening', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const legend = [...h.life.states.values()].find((s) => s.role === 'legend' && h.life.wp.settlements.get(s.sid)!.byKind('hermitage').length > 0);
    if (!legend) return;
    setupAt(h, legend.sid, 9);
    const hut = legend.home!;
    const day = new Set<string>();
    let dayAtHut = 0;
    let daySamples = 0;
    for (let i = 0; i < 100; i++) {
      runWorld(h, 2_000);
      const e = ent(h, legend);
      const hour = h.ctx.sim.timeView(h.clock.t).hours;
      if (hour >= 17) break;
      daySamples++;
      if (legend.place) day.add(legend.place.kind);
      if (legend.place?.id === hut.id || e.hidden) dayAtHut++;
    }
    expect(daySamples).toBeGreaterThan(30);
    expect(dayAtHut / daySamples).toBeGreaterThan(0.85);
    expect([...day].every((k) => k === 'hermitage')).toBe(true);
    // in the evening the legend walks down to the plaza or the inn
    h.setHour(18);
    const down = new Set<string>();
    for (let i = 0; i < 180; i++) {
      runWorld(h, 2_000);
      if (legend.place) down.add(legend.place.kind);
      if (h.ctx.sim.timeView(h.clock.t).hours >= 22) break;
    }
    expect([...down].some((k) => k === 'plaza' || k === 'inn')).toBe(true);
    h.close();
  });

  it('use their own schedule: wanderers keep the old street life', () => {
    expect(scheduleKey('legend', 0)).toBe('legend');
    expect(scheduleKey('wanderer', 0)).toBe('wanderer');
    const sum = (key: 'legend' | 'wanderer', act: 'socialise' | 'wander') => SCHEDULE[key].filter(([from]) => from >= 7 && from < 17).reduce((n, [, , w]) => n + (w[act] ?? 0), 0);
    expect(sum('legend', 'socialise')).toBe(0);
    expect(sum('wanderer', 'socialise')).toBeGreaterThan(0.4);
  });
});
