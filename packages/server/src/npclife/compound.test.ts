import { T } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { schedWeight, scheduleKey, SCHEDULE } from './activities';
import type { LifeState } from './life';
import { NPCLIFE_TUNING } from './tuning';
import { makeLifeHarness, type LifeHarness } from './testkit';

const states = (h: LifeHarness, sid: number): LifeState[] => [...h.life.states.values()].filter((s) => s.sid === sid);
const disciples = (h: LifeHarness, sid: number): LifeState[] => states(h, sid).filter((s) => s.role === 'disciple');
const ent = (h: LifeHarness, st: LifeState) => h.ctx.npcEntity(st.npcId)!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const ticked = new WeakMap<LifeHarness, number>();
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

function hall(h: LifeHarness): number {
  const s = h.ctx.world.settlements.find((x) => x.kind === 'sectHall' && x.layout === 'compound');
  if (!s) throw new Error('no compound in the test world');
  return s.id;
}

function setupAt(h: LifeHarness, sid: number, hour: number): void {
  const s = h.ctx.world.settlements[sid];
  h.join('Hero', { x: s.spawn.x, y: s.spawn.y });
  h.setHour(hour);
  h.life.syncRoster();
}

describe('compound places and housing', () => {
  it('give a compound a yard, bunkhouses and a pavilion as places a person can reach', () => {
    const h = makeLifeHarness({ real: true });
    const sid = hall(h);
    const sp = h.life.wp.settlements.get(sid)!;
    expect(sp.byKind('yard').length).toBeGreaterThanOrEqual(1);
    expect(sp.byKind('dormitory').length).toBe(3);
    expect(sp.byKind('pavilion').length).toBe(1);
    const yard = sp.byKind('yard')[0];
    // the yard's standing room is its own floor, the middle first, and never a tile with a dummy or a rack on it
    expect(yard.enter).toBe(false);
    expect(yard.spots.length).toBeGreaterThanOrEqual(24);
    const w = h.ctx.world;
    for (const p of yard.spots) {
      expect(w.terrain[p.y * w.w + p.x]).toBe(T.Plaza);
      expect(h.life.wp.comp[p.y * w.w + p.x]).toBe(h.life.wp.compOf(sid));
    }
    h.close();
  });

  it('put every disciple in a bunkhouse, at most six to one, and the yard is their workplace', () => {
    const h = makeLifeHarness({ real: true });
    const sid = hall(h);
    const ds = disciples(h, sid);
    expect(ds.length).toBeGreaterThanOrEqual(6);
    expect(ds.length).toBeLessThanOrEqual(10);
    const beds = new Map<string, number>();
    for (const d of ds) {
      expect(d.home!.kind, `disciple ${d.npcId} home`).toBe('dormitory');
      expect(d.work!.kind).toBe('yard');
      beds.set(d.home!.id, (beds.get(d.home!.id) ?? 0) + 1);
    }
    for (const n of beds.values()) expect(n).toBeLessThanOrEqual(NPCLIFE_TUNING.dormitoryCapacity);
    // spread over the bunkhouses (the emptiest first), not piled into one
    expect(beds.size).toBeGreaterThanOrEqual(2);
    h.close();
  });

  it('give a town with a master a small compound: its disciples work in the yard and sleep at home', () => {
    const h = makeLifeHarness({ real: true });
    const town = h.ctx.world.settlements.find((s) => s.kind === 'town' && h.life.wp.settlements.get(s.id)!.byKind('yard').length > 0)!;
    const ds = disciples(h, town.id);
    expect(ds.length).toBeGreaterThanOrEqual(4);
    for (const d of ds) {
      expect(d.work!.kind).toBe('yard');
      expect(['house', 'farmhouse']).toContain(d.home!.kind);
    }
    h.close();
  });
});

describe('a disciple keeps the compound hours', () => {
  it('has its own schedule: drills at dawn, meditation by day, sparring in the afternoon', () => {
    expect(scheduleKey('disciple', 0)).toBe('disciple');
    expect(schedWeight('disciple', 6.5, 'train')).toBeGreaterThan(1.5);
    expect(schedWeight('disciple', 11, 'meditate')).toBeGreaterThan(1.5);
    expect(schedWeight('disciple', 15.5, 'spar')).toBeGreaterThan(1.5);
    expect(schedWeight('disciple', 9, 'sweep')).toBeGreaterThan(1);
    expect(schedWeight('disciple', 13.5, 'serve')).toBeGreaterThan(1);
    expect(schedWeight('disciple', 2, 'sleep')).toBeGreaterThan(1.5);
    // the table covers the whole day without a gap
    let at = 0;
    for (const [from, to] of SCHEDULE.disciple) {
      expect(from).toBe(at);
      at = to;
    }
    expect(at).toBe(24);
  });

  it('drill in the yard at dawn', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = hall(h);
    setupAt(h, sid, 5.2);
    const ds = disciples(h, sid);
    runWorld(h, 20_000);
    let drilling = 0;
    let samples = 0;
    const acts = new Set<string>();
    for (let i = 0; i < 30; i++) {
      runWorld(h, 2_000);
      const hour = h.ctx.sim.timeView(h.clock.t).hours;
      if (hour >= 7.5) break;
      for (const d of ds) {
        samples++;
        if (d.act) acts.add(d.act);
        if (d.act === 'train' && d.place?.kind === 'yard') drilling++;
      }
    }
    expect(samples).toBeGreaterThan(40);
    expect(drilling / samples).toBeGreaterThan(0.4);
    // and they do it with the yard's own cue on the entity
    expect(ds.some((d) => ent(h, d).act === 'train')).toBe(true);
    h.close();
  });

  it('meditate before the pavilion by day', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = hall(h);
    setupAt(h, sid, 8.2);
    const sp = h.life.wp.settlements.get(sid)!;
    const pavilion = sp.byKind('pavilion')[0];
    const ds = disciples(h, sid);
    let sitting = 0;
    let samples = 0;
    runWorld(h, 110_000); // let the morning plans run out; it is about 10:00
    for (let i = 0; i < 30; i++) {
      runWorld(h, 2_000);
      const hour = h.ctx.sim.timeView(h.clock.t).hours;
      if (hour >= 12) break;
      for (const d of ds) {
        samples++;
        if (d.act === 'meditate' && d.ph === 'doing') {
          sitting++;
          expect(d.place?.id).toBe(pavilion.id);
          expect(ent(h, d).state === 'meditate' || ent(h, d).act === 'meditate').toBe(true);
        }
      }
    }
    expect(samples).toBeGreaterThan(20);
    expect(sitting / samples).toBeGreaterThan(0.12); // (the rest are walking there, sweeping, or serving the masters)
    h.close();
  });

  it('spar in pairs on neighbouring tiles of the yard in the afternoon', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = hall(h);
    setupAt(h, sid, 12.4);
    const ds = disciples(h, sid);
    runWorld(h, 140_000); // about 14:45
    let pairs = 0;
    let adjacent = 0;
    for (let i = 0; i < 40; i++) {
      runWorld(h, 2_000);
      const hour = h.ctx.sim.timeView(h.clock.t).hours;
      if (hour >= 17) break;
      const sparring = ds.filter((d) => d.act === 'spar' && d.ph === 'doing');
      for (const d of sparring) {
        const mate = sparring.find((o) => o !== d && dist(ent(h, o), ent(h, d)) <= 1.2);
        if (!mate) continue;
        pairs++;
        adjacent++;
        expect(d.place?.kind).toBe('yard');
        expect(ent(h, d).act).toBe('spar');
      }
    }
    expect(adjacent).toBeGreaterThan(10);
    expect(pairs).toBe(adjacent);
    h.close();
  });

  it('wait on their master: some stand close to him at midday-afternoon', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = hall(h);
    setupAt(h, sid, 11.4);
    const ds = disciples(h, sid);
    let serving = 0;
    let close = 0;
    runWorld(h, 100_000); // about 13:00
    for (let i = 0; i < 45; i++) {
      runWorld(h, 2_000);
      const hour = h.ctx.sim.timeView(h.clock.t).hours;
      if (hour >= 14.5) break;
      for (const d of ds) {
        if (d.act !== 'serve' || d.ph !== 'doing') continue;
        const mentor = h.ctx.sim.npc(d.npcId)!.mentor;
        const me = mentor != null ? h.ctx.npcEntity(mentor) : undefined;
        if (!me) continue;
        serving++;
        // the master may walk on while the disciple is told to wait: close means within a few tiles
        if (dist(ent(h, d), me) <= 7) close++;
      }
    }
    expect(serving).toBeGreaterThan(3);
    expect(close / serving).toBeGreaterThan(0.5);
    h.close();
  });

  it('are asleep in the bunkhouses in the small hours', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    const sid = hall(h);
    setupAt(h, sid, 23.0);
    const ds = disciples(h, sid);
    runWorld(h, 150_000); // about 01:30
    const asleep = ds.filter((d) => d.act === 'sleep' && (ent(h, d).hidden || d.place?.kind === 'dormitory'));
    expect(asleep.length / ds.length).toBeGreaterThan(0.8);
    h.close();
  });
});
