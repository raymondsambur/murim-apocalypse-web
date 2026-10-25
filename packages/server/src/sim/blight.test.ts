import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@murim/shared';
import { coverage, makeSim, runDays, runHours, stateOf, worldFor, PROD_SEED } from './testkit';

describe('Blight field', () => {
  it('starts dense around the hearts, light over the ruin and zero at the starting village', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    for (const h of st.hearts) expect(sim.blightAt(h.x, h.y)).toBeGreaterThan(100);
    const world = worldFor(PROD_SEED);
    const ruin = world.settlements[world.settlements.length - 1];
    expect(ruin.kind).toBe('ruin');
    expect(sim.blightAt(ruin.x, ruin.y)).toBeGreaterThan(5);
    expect(sim.blightAt(world.settlements[0].x, world.settlements[0].y)).toBe(0);
    // Water and mountains never carry Blight.
    for (let i = 0; i < st.blight.length; i++) {
      const t = world.terrain[i];
      if (t === 0 || t === 1 || t === 8) expect(st.blight[i]).toBe(0);
    }
  });

  it('is dynamic but bounded over 90 world days with no players', () => {
    const world = worldFor(PROD_SEED);
    const sim = makeSim();
    const samples: number[] = [coverage(sim, world)];
    let changedEvents = 0;
    let startVillageMax = 0;
    let frontierMax = 0;
    // The two living towns nearest the fallen capital are the Blight's frontier (town ids depend on the map).
    const ruinTown = world.settlements[world.settlements.length - 1];
    const frontierIds = world.settlements
      .slice(0, -1)
      .sort((a, b) => Math.hypot(a.x - ruinTown.x, a.y - ruinTown.y) - Math.hypot(b.x - ruinTown.x, b.y - ruinTown.y))
      .slice(0, 2)
      .map((s) => s.id);
    runDays(sim, 90, (_d, ev) => {
      samples.push(coverage(sim, world));
      changedEvents += ev.filter((e) => e.k === 'blight').length;
      startVillageMax = Math.max(startVillageMax, sim.settlementView(0).blight);
      for (const id of frontierIds) frontierMax = Math.max(frontierMax, stateOf(sim).settlements[id].blight);
    });
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThan(3); // does not die out
    expect(max).toBeLessThan(35); // does not flood the continent
    expect(max - min).toBeGreaterThan(1.5); // visibly moves
    expect(changedEvents).toBeGreaterThan(300); // emits tile changes nearly every hour
    expect(startVillageMax).toBeLessThan(3); // the starting village stays safe
    // Settlements near the ruin are under pressure: the Blight reaches their surroundings.
    expect(frontierMax).toBeGreaterThan(14);
  });

  it('pulses with the seasons: it recedes through winter after peaking in late autumn', () => {
    for (const seed of [PROD_SEED, 7]) {
      const world = worldFor(seed);
      const sim = makeSim(seed);
      const cov: number[] = [];
      runDays(sim, 240, () => cov.push(coverage(sim, world)));
      const mean = (from: number, to: number) => cov.slice(from, to).reduce((x, y) => x + y, 0) / (to - from);
      // Year 2: late autumn (days 200-209) versus the end of winter (days 228-238).
      expect(mean(200, 209)).toBeGreaterThan(mean(228, 238));
    }
  });

  it('emits blight events whose indices are valid and whose values changed', () => {
    const sim = makeSim();
    const world = worldFor(PROD_SEED);
    const before = Uint8Array.from(stateOf(sim).blight);
    const ev: SimEvent[] = runHours(sim, 6);
    const idx = new Set<number>();
    for (const e of ev) {
      if (e.k !== 'blight') continue;
      for (const i of e.idx) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(world.w * world.h);
        idx.add(i);
      }
    }
    expect(idx.size).toBeGreaterThan(0);
    // Every tile that moved a full bucket is reported.
    const after = stateOf(sim).blight;
    let missed = 0;
    for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) >= 16 && !idx.has(i)) missed++;
    expect(missed).toBe(0);
  });

  it('purify lowers Blight inside the radius only and reports the changed tiles', () => {
    const sim = makeSim();
    const h = stateOf(sim).hearts[0];
    const x = h.x + 3;
    const y = h.y + 2;
    const here = sim.blightAt(x, y);
    const far = sim.blightAt(h.x + 20, h.y + 20);
    const ev = sim.purify(x, y, 5, 80);
    expect(sim.blightAt(x, y)).toBeLessThan(here - 40);
    expect(sim.blightAt(h.x + 20, h.y + 20)).toBe(far);
    const blight = ev.filter((e) => e.k === 'blight');
    expect(blight.length).toBe(1);
    expect(sim.purify(x, y, 5, 0)).toEqual([]);
  });

  it('blight-family kills lower local Blight a little; other kills do not', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const h = st.hearts[1];
    const x = h.x - 4;
    const y = h.y;
    const before = sim.blightAt(x, y);
    const ev = sim.recordKill(x, y, 'blight', 14, 0);
    const after = sim.blightAt(x, y);
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(15);
    expect(ev.some((e) => e.k === 'blight')).toBe(true);
    const mid = sim.blightAt(x, y);
    sim.recordKill(x, y, 'beast', 14, 0);
    expect(sim.blightAt(x, y)).toBe(mid);
    // Elite kills do more.
    const eliteBefore = sim.blightAt(x + 1, y);
    sim.recordKill(x + 1, y, 'blight', 14, 2);
    expect(eliteBefore - sim.blightAt(x + 1, y)).toBeGreaterThan(before - after);
  });

  it('damaging a heart weakens it and enough damage seals it for several days', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const heart = st.hearts[0];
    const full = heart.strength;
    const wound = sim.damageHeart(heart.id, 20, 'Aoi');
    expect(heart.strength).toBeCloseTo(full - 20, 5);
    expect(wound.some((e) => e.k === 'chron' && /Aoi/.test(e.entry.text))).toBe(true);
    const sealEvents = sim.damageHeart(heart.id, 500, 'Aoi');
    expect(heart.strength).toBe(0);
    const now = sim.clock().totalHours;
    const days = (heart.sealedUntil - now) / 24;
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(10);
    expect(sealEvents).toContainEqual({ k: 'heart', id: heart.id, active: false });
    const line = sealEvents.find((e) => e.k === 'chron' && /sealed/.test(e.entry.text));
    expect(line && line.k === 'chron' && line.entry.text).toMatch(/Aoi/);
    expect(line && line.k === 'chron' && line.entry.importance).toBe(3);
    // A sealed heart cannot be hurt again and stops emitting; the area clears.
    expect(sim.damageHeart(heart.id, 10, 'Aoi')).toEqual([]);
    const sealedAt = sim.blightAt(heart.x, heart.y);
    expect(sealedAt).toBeLessThan(120);
    // After the seal expires the heart stirs again.
    const ev = runDays(sim, 11);
    expect(ev).toContainEqual({ k: 'heart', id: heart.id, active: true });
    expect(heart.strength).toBeGreaterThan(0);
    expect(stateOf(sim).chronicle.some((c) => /stirs again/.test(c.text))).toBe(true);
  });

  it('unsealed hearts regrow slowly after being wounded', () => {
    const sim = makeSim();
    const heart = stateOf(sim).hearts[2];
    sim.damageHeart(heart.id, 50, 'Aoi');
    const wounded = heart.strength;
    runDays(sim, 20);
    expect(heart.strength).toBeGreaterThan(wounded + 5);
    expect(heart.strength).toBeLessThanOrEqual(100);
  });

  it('unknown hearts and bad amounts are ignored', () => {
    const sim = makeSim();
    expect(sim.damageHeart(9999, 50, 'Aoi')).toEqual([]);
    expect(sim.damageHeart(stateOf(sim).hearts[0].id, -5, 'Aoi')).toEqual([]);
    expect(sim.damageHeart(stateOf(sim).hearts[0].id, Number.NaN, 'Aoi')).toEqual([]);
  });
});
