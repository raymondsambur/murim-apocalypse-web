import { describe, expect, it } from 'vitest';
import { FACTIONS } from '@murim/shared';
import { PROD_SEED, makeSim, runDays, stateOf, worldFor } from './testkit';

describe('initial holdings', () => {
  it('assigns controllers by faction home kind; the starting village is independent; the ruin is fallen', () => {
    const world = worldFor(PROD_SEED);
    const st = stateOf(makeSim());
    const kindOf = (id: string) => {
      const owned = st.settlements.filter((s) => s.controller === id);
      expect(owned).toHaveLength(1);
      return world.settlements[owned[0].id];
    };
    expect(kindOf('azure').kind).toBe('sectHall');
    expect(kindOf('tiger').kind).toBe('fort');
    expect(kindOf('jade').kind).toBe('town');
    expect(kindOf('crimson').kind).toBe('town');
    expect(['village', 'hamlet']).toContain(kindOf('blackwind').kind);
    expect(st.settlements[0].controller).toBeNull();
    const ruin = st.settlements[st.settlements.length - 1];
    expect(ruin.status).toBe('fallen');
    expect(ruin.controller).toBeNull();
    // Jade holds the town nearest the start, Crimson the other; Black Wind hides far from the start.
    const d = (id: number) => Math.hypot(world.settlements[id].x - world.settlements[0].x, world.settlements[id].y - world.settlements[0].y);
    const jade = st.settlements.find((s) => s.controller === 'jade')!.id;
    const crimson = st.settlements.find((s) => s.controller === 'crimson')!.id;
    expect(d(jade)).toBeLessThan(d(crimson));
    const bw = st.settlements.find((s) => s.controller === 'blackwind')!.id;
    const others = world.settlements.filter((s) => (s.kind === 'village' || s.kind === 'hamlet') && s.id !== 0 && s.id !== bw);
    for (const o of others) expect(d(bw)).toBeGreaterThanOrEqual(d(o.id));
  });

  it('starts every faction with relations from the shared table and a capital', () => {
    const st = stateOf(makeSim());
    expect(st.factions.map((f) => f.id)).toEqual(FACTIONS.map((f) => f.id));
    for (const f of st.factions) {
      expect(Object.keys(f.relations)).toHaveLength(4);
      expect(f.atWarWith).toEqual([]);
      expect(st.settlements[f.capital].controller).toBe(f.id);
      expect(f.power).toBeGreaterThan(0);
    }
    expect(st.factions.find((f) => f.id === 'azure')!.relations.crimson).toBe(-70);
    expect(st.factions.find((f) => f.id === 'azure')!.relations.tiger).toBe(45);
  });
});

describe('long-run behaviour', () => {
  const seeds = [PROD_SEED, 7, 21];
  const runs = seeds.map((seed) => {
    const sim = makeSim(seed);
    const st = stateOf(sim);
    const landDays: Record<string, number> = {};
    const wars = new Set<string>();
    const peace = new Set<string>();
    let everAtWar = false;
    let warEnded = false;
    let captures = 0;
    let maxShare = 0;
    let boundsOk = true;
    let prevWars = 0;
    let lossAndRecovery = false;
    const everOwned: Record<string, Set<number>> = {};
    const lost: Record<string, Set<number>> = {};
    let ownerPrev = st.settlements.map((s) => s.controller);
    // The chronicle is a ring buffer: read every line as it is written, not what is left after a year.
    const texts: string[] = [];
    let lastId = 0;
    runDays(sim, 360, () => {
      for (const c of st.chronicle) {
        if (c.id <= lastId) continue;
        lastId = c.id;
        texts.push(c.text);
      }
      const living = st.settlements.filter((s) => s.status !== 'fallen').length;
      let warCount = 0;
      for (const f of st.factions) {
        const own = st.settlements.filter((s) => s.controller === f.id && s.status !== 'fallen').length;
        if (own > 0) landDays[f.id] = (landDays[f.id] ?? 0) + 1;
        maxShare = Math.max(maxShare, own / living);
        if (f.power < 5 || f.power > 100 || f.wealth < 0 || !Number.isFinite(f.power)) boundsOk = false;
        warCount += f.atWarWith.length;
        for (const w of f.atWarWith) wars.add([f.id, w].sort().join('|'));
      }
      if (warCount > 0) everAtWar = true;
      if (warCount < prevWars) warEnded = true;
      prevWars = warCount;
      st.settlements.forEach((s, i) => {
        const prev = ownerPrev[i];
        if (prev !== s.controller) {
          if (prev && s.controller) captures++;
          if (prev) (lost[prev] ??= new Set()).add(i);
          if (s.controller) {
            if (lost[s.controller]?.has(i)) lossAndRecovery = true;
            (everOwned[s.controller] ??= new Set()).add(i);
          }
        }
      });
      ownerPrev = st.settlements.map((s) => s.controller);
    });
    void peace;
    return { seed, sim, st, texts, landDays, wars, everAtWar, warEnded, captures, maxShare, boundsOk, lossAndRecovery };
  });

  it('wars start and end', () => {
    for (const r of runs) {
      expect(r.everAtWar).toBe(true);
      expect(r.warEnded).toBe(true);
      expect(r.wars.size).toBeGreaterThanOrEqual(2);
      expect(r.st.chronicle.length).toBeGreaterThan(50);
    }
    const lines = runs.flatMap((r) => r.texts);
    expect(lines.some((t) => /declared war/.test(t))).toBe(true);
    expect(lines.some((t) => /truce/.test(t))).toBe(true);
  });

  it('settlements change hands by force', () => {
    for (const r of runs) {
      expect(r.captures).toBeGreaterThanOrEqual(3);
      expect(r.st.ext.stats.raids).toBeGreaterThanOrEqual(10);
    }
    const lines = runs.flatMap((r) => r.texts);
    expect(lines.some((t) => /seized .* from the/.test(t))).toBe(true);
    expect(lines.some((t) => /drove .* from the gates/.test(t))).toBe(true);
  });

  it('stays stable: bounded stats, no runaway winner, nobody locked out for ever', () => {
    for (const r of runs) {
      expect(r.boundsOk).toBe(true);
      expect(r.maxShare).toBeLessThanOrEqual(4 / 6 + 1e-9);
      for (const f of r.st.factions) {
        expect(r.landDays[f.id] ?? 0).toBeGreaterThan(20);
      }
    }
    // Across seeds the weakest factions still hold ground a decent share of the time.
    for (const id of ['crimson', 'blackwind']) {
      const avg = runs.reduce((a, r) => a + (r.landDays[id] ?? 0), 0) / runs.length;
      expect(avg).toBeGreaterThan(360 * 0.15);
    }
    // And the strongest do not hold on to everything: at the end nobody owns more than 4.
    for (const r of runs) {
      for (const f of r.st.factions) expect(r.st.settlements.filter((s) => s.controller === f.id).length).toBeLessThanOrEqual(4);
    }
  });

  it('factions lose and recover settlements', () => {
    expect(runs.some((r) => r.lossAndRecovery)).toBe(true);
  });

  it('keeps alliances and wars consistent and symmetric', () => {
    for (const r of runs) {
      for (const f of r.st.factions) {
        for (const o of f.atWarWith) {
          expect(r.st.factions.find((x) => x.id === o)!.atWarWith).toContain(f.id);
          expect(f.alliedWith).not.toContain(o);
        }
        for (const o of f.alliedWith) expect(r.st.factions.find((x) => x.id === o)!.alliedWith).toContain(f.id);
        for (const o of Object.keys(f.relations)) {
          expect(f.relations[o]).toBeGreaterThanOrEqual(-100);
          expect(f.relations[o]).toBeLessThanOrEqual(100);
          expect(r.st.factions.find((x) => x.id === o)!.relations[f.id]).toBe(f.relations[o]);
        }
      }
    }
  });

  it('every faction siege names an attacker and ends with a result', () => {
    const sim = makeSim(PROD_SEED);
    const st = stateOf(sim);
    let started = 0;
    let ended = 0;
    const ev = runDays(sim, 120);
    for (const e of ev) {
      if (e.k !== 'siege') continue;
      if (e.start) started++;
      else ended++;
    }
    expect(started).toBeGreaterThan(5);
    expect(started - ended).toBeLessThanOrEqual(2);
    for (const s of st.settlements) {
      if (s.siegeUntil > st.clock.totalHours) {
        expect(s.siegeBy).toBeTruthy();
        expect(s.status).toBe('besieged');
        expect(s.siegeStrength).toBeGreaterThan(0);
      } else {
        expect(s.siegeBy ?? null).toBeNull();
      }
    }
  });
});
