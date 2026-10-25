import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { createStubSim } from '../sim/stub';
import { nullLogger } from './log';
import { SIM_SNAPSHOT_KEY, chroniclePage, loadSimSnapshot, saveSimSnapshot } from './persist';
import { testWorld } from '../testkit';

const world = testWorld();

describe('world snapshots', () => {
  it('round-trips the sim state through the kv store', () => {
    const db = openDb(':memory:');
    const sim = createStubSim(world, { seed: world.seed, hourMs: 1000, nowMs: 0, saved: null });
    for (let i = 1; i <= 30; i++) sim.advanceHours(1, i * 1000);
    saveSimSnapshot(db, SIM_SNAPSHOT_KEY, sim, world.seed, 12345);
    const snap = loadSimSnapshot(db, SIM_SNAPSHOT_KEY, world.seed, nullLogger)!;
    expect(snap.savedAt).toBe(12345);
    const restored = createStubSim(world, { seed: world.seed, hourMs: 1000, nowMs: 12345, saved: snap.saved });
    expect(restored.clock()).toEqual(sim.clock());
    expect(restored.blightBase64()).toBe(sim.blightBase64());
    expect(restored.state.chronicle).toEqual(sim.state.chronicle);
    // Both continue identically.
    expect(JSON.stringify(restored.advanceHours(5, 40_000))).toBe(JSON.stringify(sim.advanceHours(5, 40_000)));
    db.close();
  });

  it('ignores snapshots from another seed and backs up corrupt ones', () => {
    const db = openDb(':memory:');
    const sim = createStubSim(world, { seed: world.seed, hourMs: 1000, nowMs: 0, saved: null });
    saveSimSnapshot(db, SIM_SNAPSHOT_KEY, sim, 999, 1);
    expect(loadSimSnapshot(db, SIM_SNAPSHOT_KEY, world.seed, nullLogger)).toBeNull();
    expect(db.kvGet(SIM_SNAPSHOT_KEY)).toBeDefined();

    db.kvSet(SIM_SNAPSHOT_KEY, '{"seed":1337,"savedAt":"x","sim":{}}');
    expect(loadSimSnapshot(db, SIM_SNAPSHOT_KEY, 1337, nullLogger)).toBeNull();
    expect(db.kvGet(SIM_SNAPSHOT_KEY)).toBeUndefined();
    expect(db.all<{ key: string }>("SELECT key FROM kv WHERE key LIKE 'sim.snapshot.corrupt.%'").length).toBe(1);

    db.kvSet(SIM_SNAPSHOT_KEY, 'not json');
    expect(loadSimSnapshot(db, SIM_SNAPSHOT_KEY, 1337, nullLogger)).toBeNull();
    db.close();
  });
});

describe('chroniclePage', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, day: 0, hour: 0, kind: 'npc' as const, text: `e${i + 1}`, importance: 1 as const, t: 0 }));
  it('returns the newest page by default and pages backwards with `before`', () => {
    expect(chroniclePage(entries).map((e) => e.id)).toEqual(entries.slice(10).map((e) => e.id));
    expect(chroniclePage(entries, 11, 5).map((e) => e.id)).toEqual([6, 7, 8, 9, 10]);
    expect(chroniclePage(entries, 1)).toEqual([]);
    expect(chroniclePage(entries, 3, 100).map((e) => e.id)).toEqual([1, 2]);
  });
  it('clamps silly limits', () => {
    expect(chroniclePage(entries, undefined, 1e9).length).toBe(50);
    expect(chroniclePage(entries, undefined, -5).length).toBe(40);
    expect(chroniclePage(entries, undefined, 0).length).toBe(40);
    expect(chroniclePage(entries, undefined, 2.7).length).toBe(2);
    expect(chroniclePage([], 5, 5)).toEqual([]);
  });
});
