import { describe, expect, it } from 'vitest';
import { GOODS, type SimEvent } from '@murim/shared';
import { HOUR_MS, PROD_SEED, makeSim, runDays, runHours, stateOf, worldFor } from './testkit';

/** A scripted sequence of calls used for determinism checks. */
function script(sim: ReturnType<typeof makeSim>): void {
  runDays(sim, 6);
  sim.recordKill(150, 40, 'blight', 12, 1);
  sim.purify(150, 45, 6, 40);
  sim.recordTrade(2, 'grain', 12, 'buy');
  const offer = sim.board(2)[0];
  if (offer) {
    sim.takeOffer(2, offer.id);
    sim.recordMissionDone(offer, 'Tester');
  }
  sim.record('A test line.', 1);
  runDays(sim, 9);
  sim.damageHeart(120, 30, 'Tester');
  runDays(sim, 5);
}

describe('determinism and persistence', () => {
  it('same seed and calls produce byte-identical snapshots', () => {
    const a = makeSim();
    const b = makeSim();
    script(a);
    script(b);
    const sa = a.serialize();
    const sb = b.serialize();
    expect(sa.json).toBe(sb.json);
    expect(sa.blight).toBe(sb.blight);
  });

  it('different seeds give different worlds', () => {
    const a = makeSim(PROD_SEED);
    const b = makeSim(7);
    expect(a.serialize().json).not.toBe(b.serialize().json);
  });

  it('serialization round-trips and the restored sim continues identically', () => {
    const a = makeSim();
    runDays(a, 12);
    const snap = a.serialize();
    const b = makeSim(PROD_SEED, JSON.parse(JSON.stringify(snap)));
    // The restored sim re-serializes to the same bytes.
    expect(b.serialize().json).toBe(snap.json);
    expect(b.serialize().blight).toBe(snap.blight);
    expect(b.clock().totalHours).toBe(a.clock().totalHours);
    // And both evolve the same way afterwards, including with player calls in between.
    for (const s of [a, b]) {
      runDays(s, 4);
      s.recordKill(152, 41, 'blight', 10, 0);
      s.damageHeart(121, 40, 'Tester');
      runDays(s, 20);
    }
    expect(b.serialize().json).toBe(a.serialize().json);
    expect(b.serialize().blight).toBe(a.serialize().blight);
  });

  it('rejects a corrupt or foreign snapshot', () => {
    const a = makeSim();
    const snap = a.serialize();
    expect(() => makeSim(PROD_SEED, { json: '{nope', blight: snap.blight })).toThrow();
    expect(() => makeSim(7, snap)).toThrow(/seed/);
    expect(() => makeSim(PROD_SEED, { json: snap.json, blight: 5 as unknown as string })).toThrow();
  });

  it('read-side calls never change the simulation', () => {
    const a = makeSim();
    const b = makeSim();
    runDays(a, 10);
    runDays(b, 10);
    for (const n of b.npcs()) {
      b.greeting(n, 'Someone');
      b.shopFor(n);
    }
    b.worldInfo(3, 12345);
    b.settlementViews();
    b.timeView(99);
    b.weatherAt(10, 10);
    b.blightAt(150, 40);
    b.priceMult(0, 'grain');
    b.board(2);
    runDays(a, 3);
    runDays(b, 3);
    expect(b.serialize().json).toBe(a.serialize().json);
  });
});

describe('clock and weather', () => {
  it('advances in whole hours with the 24 h / 30 day / 120 day calendar', () => {
    const sim = makeSim();
    expect(sim.clock()).toMatchObject({ totalHours: 0, hour: 6, day: 0, season: 0, year: 0 });
    runHours(sim, 18);
    expect(sim.clock()).toMatchObject({ hour: 0, day: 1 });
    runDays(sim, 29);
    expect(sim.clock()).toMatchObject({ day: 30, season: 1 });
    runDays(sim, 90);
    expect(sim.clock()).toMatchObject({ day: 120, season: 0, year: 1 });
  });

  it('timeView returns fractional hours anchored to the last advance', () => {
    const sim = makeSim();
    sim.advanceHours(1, 1000);
    const t0 = sim.timeView(1000);
    const t1 = sim.timeView(1000 + HOUR_MS / 2);
    expect(t0.hours).toBeCloseTo(7, 5);
    expect(t1.hours).toBeCloseTo(7.5, 5);
    expect(t0.hourMs).toBe(HOUR_MS);
    expect(t0.weather).toHaveLength(3);
    expect(t0.t).toBe(1000);
    // Never runs past the next hour boundary.
    expect(sim.timeView(1000 + HOUR_MS * 50).hours).toBeLessThan(8);
  });

  it('advanceHours emits day and season events', () => {
    const sim = makeSim();
    const ev = runDays(sim, 31);
    expect(ev.filter((e) => e.k === 'newDay')).toHaveLength(31);
    const seasons = ev.filter((e): e is Extract<SimEvent, { k: 'newSeason' }> => e.k === 'newSeason');
    expect(seasons.map((s) => s.season)).toEqual([1]);
    expect(stateOf(sim).chronicle.some((c) => c.kind === 'season' && /Summer/.test(c.text))).toBe(true);
  });

  it('weather follows the seasons: snow only in winter, mostly in the north', () => {
    const sim = makeSim();
    const snowDays = [0, 0, 0, 0];
    const northSnow = { winter: 0, other: 0 };
    let southSnowWinter = 0;
    const storms = [0, 0, 0, 0];
    const kinds = new Set<string>();
    runDays(sim, 240, () => {
      const c = sim.clock();
      const s = stateOf(sim).weather;
      for (const w of s) kinds.add(w.kind);
      if (s.some((w) => w.kind === 'snow')) snowDays[c.season]++;
      if (s[0].kind === 'snow') northSnow[c.season === 3 ? 'winter' : 'other']++;
      if (c.season === 3 && s[2].kind === 'snow') southSnowWinter++;
      if (s.some((w) => w.kind === 'storm')) storms[c.season]++;
    });
    expect(snowDays[0] + snowDays[1] + snowDays[2]).toBe(0);
    expect(snowDays[3]).toBeGreaterThan(5);
    expect(northSnow.winter).toBeGreaterThan(southSnowWinter);
    expect(storms[1] + storms[2]).toBeGreaterThanOrEqual(storms[0] + storms[3]);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('weatherAt uses the climate band of y', () => {
    const world = worldFor(PROD_SEED);
    const sim = makeSim();
    runDays(sim, 5);
    const w = stateOf(sim).weather;
    expect(sim.weatherAt(10, 5)).toBe(w[0].kind);
    expect(sim.weatherAt(10, Math.floor(world.h * 0.5))).toBe(w[1].kind);
    expect(sim.weatherAt(10, world.h - 2)).toBe(w[2].kind);
    expect(sim.weatherAt(-5, -5)).toBe(w[0].kind);
  });
});

describe('views and chronicle', () => {
  it('settlement views and world info have the contract shape', () => {
    const world = worldFor(PROD_SEED);
    const sim = makeSim();
    runDays(sim, 3);
    const views = sim.settlementViews();
    expect(views).toHaveLength(world.settlements.length);
    for (const v of views) {
      expect(v).toEqual(sim.settlementView(v.id));
      expect(['thriving', 'stable', 'struggling', 'besieged', 'fallen']).toContain(v.status);
      expect(v.flags).toBeInstanceOf(Array);
      expect(v.prosperity).toBeGreaterThanOrEqual(0);
      expect(v.prosperity).toBeLessThanOrEqual(100);
    }
    expect(() => sim.settlementView(999)).toThrow();
    const info = sim.worldInfo(7, 5000);
    expect(info.online).toBe(7);
    expect(info.factions).toHaveLength(5);
    expect(info.hearts).toHaveLength(3);
    expect(info.time.t).toBe(5000);
    expect(info.chronicle.length).toBeGreaterThan(0);
    const start = views[0];
    expect(start.controller).toBeNull();
    const ruin = views[views.length - 1];
    expect(ruin.status).toBe('fallen');
  });

  it('blightBase64 round-trips the grid and blightAt reads it', () => {
    const sim = makeSim();
    const b64 = sim.blightBase64();
    const buf = Buffer.from(b64, 'base64');
    const st = stateOf(sim);
    expect(buf.length).toBe(st.blight.length);
    expect(buf.equals(Buffer.from(st.blight))).toBe(true);
    const h = st.hearts[0];
    expect(sim.blightAt(h.x, h.y)).toBe(st.blight[h.y * 192 + h.x]);
    expect(sim.blightAt(-3, 4)).toBe(0);
    expect(sim.blightAt(9999, 4)).toBe(0);
  });

  it('keeps a bounded, paced chronicle', () => {
    const sim = makeSim();
    const perDay: number[] = [];
    runDays(sim, 120, (_d, ev) => perDay.push(ev.filter((e) => e.k === 'chron').length));
    const st = stateOf(sim);
    expect(st.chronicle.length).toBeLessThanOrEqual(300);
    const avg = perDay.reduce((a, b) => a + b, 0) / perDay.length;
    expect(avg).toBeGreaterThan(2.5);
    expect(avg).toBeLessThan(14);
    expect(Math.max(...perDay)).toBeLessThan(40);
    const ids = st.chronicle.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    for (const c of st.chronicle) {
      expect([1, 2, 3]).toContain(c.importance);
      expect(c.text.length).toBeGreaterThan(5);
      expect(c.text.length).toBeLessThan(220);
    }
  });

  it('record() returns the entry without queuing a duplicate event', () => {
    const sim = makeSim();
    const e = sim.record('Aoi the Wanderer reached the Peak rank.', 2, 0, 'player');
    expect(e).toMatchObject({ kind: 'player', importance: 2, settlementId: 0 });
    expect(stateOf(sim).chronicle.at(-1)).toBe(e);
    const ev = runDays(sim, 1);
    expect(ev.filter((x) => x.k === 'chron' && x.entry.id === e.id)).toHaveLength(0);
  });
});

describe('performance', () => {
  it('one world hour costs well under 15 ms on the 192x128 world', () => {
    const sim = makeSim();
    runDays(sim, 3); // warm up
    const times: number[] = [];
    for (let h = 0; h < 24 * 20; h++) {
      const t = performance.now();
      sim.advanceHours(1, (sim.clock().totalHours + 1) * HOUR_MS);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const p99 = times[Math.floor(times.length * 0.99)];
    expect(median).toBeLessThan(5);
    expect(p99).toBeLessThan(15);
  });

  it('tracks only the goods listed in GOODS', () => {
    const sim = makeSim();
    for (const s of stateOf(sim).settlements) {
      for (const g of Object.keys(s.stock)) expect(GOODS as readonly string[]).toContain(g);
    }
  });
});
