import { isPassable } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { testWorld } from '../testkit';
import { createStubSim } from './stub';

const world = testWorld();
const make = (saved = null as ReturnType<ReturnType<typeof createStubSim>['serialize']> | null) => createStubSim(world, { seed: world.seed, hourMs: 1000, nowMs: 0, saved });

describe('stub sim', () => {
  it('places a few static NPCs in every living settlement on walkable tiles', () => {
    const sim = make();
    const ruin = world.settlements.find((s) => s.kind === 'ruin')!;
    for (const s of world.settlements) {
      const npcs = sim.npcs(s.id);
      if (s.id === ruin.id) expect(npcs).toHaveLength(0);
      else {
        expect(npcs.length).toBeGreaterThanOrEqual(3);
        expect(npcs.some((n) => n.shop === 'general')).toBe(true);
        for (const n of npcs) expect(isPassable(world, n.homeX, n.homeY)).toBe(true);
      }
    }
    const ids = sim.npcs().map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sim.npc(ids[0])?.id).toBe(ids[0]);
    expect(sim.shopFor(sim.npcs().find((n) => n.shop === 'general')!)?.items.length).toBeGreaterThan(0);
    expect(sim.greeting(sim.npcs()[0], 'Hero')).toContain('Hero');
  });

  it('is deterministic', () => {
    const a = make();
    const b = make();
    for (let i = 1; i <= 50; i++) {
      expect(JSON.stringify(a.advanceHours(1, i * 1000))).toBe(JSON.stringify(b.advanceHours(1, i * 1000)));
    }
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  it('has a coherent clock and time view', () => {
    const sim = make();
    expect(sim.clock()).toMatchObject({ totalHours: 0, hour: 6, day: 0, season: 0 });
    sim.advanceHours(18, 18_000);
    expect(sim.clock()).toMatchObject({ hour: 0, day: 1 });
    const tv = sim.timeView(18_500);
    expect(tv.hours).toBeCloseTo(0.5, 1);
    expect(tv.hourMs).toBe(1000);
    expect(tv.weather).toHaveLength(3);
    // The fraction never leaves [0, 1) even long after the last advance.
    expect(sim.timeView(10_000_000).hours).toBeLessThan(1);
    sim.advanceHours(24 * 30, 99_000);
    expect(sim.clock().season).toBe(1);
  });

  it('emits chronicle, weather, day and blight events', () => {
    const sim = make();
    const kinds = new Set<string>();
    for (let i = 1; i <= 48; i++) for (const ev of sim.advanceHours(1, i * 1000)) kinds.add(ev.k);
    for (const k of ['chron', 'weather', 'newDay', 'blight']) expect(kinds.has(k)).toBe(true);
    expect(sim.state.chronicle.length).toBeGreaterThan(1);
    const e = sim.record('A hero rose.', 2, 0);
    expect(e).toMatchObject({ text: 'A hero rose.', importance: 2, settlementId: 0 });
    expect(sim.state.chronicle.at(-1)).toBe(e);
  });

  it('serialises and restores losslessly', () => {
    const a = make();
    for (let i = 1; i <= 30; i++) a.advanceHours(1, i * 1000);
    const saved = a.serialize();
    const b = make(saved);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(saved));
    expect(JSON.stringify(b.advanceHours(10, 40_000))).toBe(JSON.stringify(a.advanceHours(10, 40_000)));
    // Garbage snapshots fall back to a fresh world instead of crashing.
    expect(() => make({ json: 'oops', blight: '' })).not.toThrow();
  });

  it('views and world info are shaped for the client', () => {
    const sim = make();
    expect(sim.settlementViews()).toHaveLength(world.settlements.length);
    expect(sim.settlementView(0)).toMatchObject({ id: 0, siege: false });
    expect(() => sim.settlementView(999)).toThrow();
    const info = sim.worldInfo(3, 500);
    expect(info.online).toBe(3);
    expect(info.settlements).toHaveLength(world.settlements.length);
    expect(Buffer.from(sim.blightBase64(), 'base64').length).toBe(world.w * world.h);
    expect(sim.weatherAt(10, 5)).toBe('clear');
    expect(sim.blightAt(-1, 0)).toBe(0);
  });
});
