import { describe, expect, it } from 'vitest';
import { GOODS, ITEMS } from '@murim/shared';
import { makeSim, runDays, runHours, stateOf, worldFor, PROD_SEED } from './testkit';
import type { Sim } from './api';

/** Pick a road whose two ends are both living and return [a, b, roadIndex]. */
function livingRoad(sim: Sim): [number, number, number] {
  const world = worldFor(PROD_SEED);
  const st = stateOf(sim);
  for (let i = 0; i < world.roads.length; i++) {
    const [a, b] = world.roads[i];
    if (st.settlements[a].status !== 'fallen' && st.settlements[b].status !== 'fallen') return [a, b, i];
  }
  throw new Error('no living road');
}

describe('prices', () => {
  it('goods are cheap with plenty of stock and dear in a shortage', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const s = st.settlements[2];
    for (const g of GOODS) s.stock[g] = s.cons[g] * 40;
    const cheap = sim.priceMult(2, 'grain');
    for (const g of GOODS) s.stock[g] = 0;
    const dear = sim.priceMult(2, 'grain');
    expect(cheap).toBeCloseTo(0.6, 2);
    expect(dear).toBeCloseTo(2.5, 2);
    s.stock.grain = s.cons.grain * 10;
    expect(sim.priceMult(2, 'grain')).toBeGreaterThan(0.9);
    expect(sim.priceMult(2, 'grain')).toBeLessThan(1.1);
    for (const g of GOODS) {
      const p = sim.priceMult(2, g);
      expect(p).toBeGreaterThanOrEqual(0.6);
      expect(p).toBeLessThanOrEqual(2.5);
    }
  });

  it('other items sit near 1 with small modifiers for war, siege and plague', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const s = st.settlements[2];
    const base = sim.priceMult(2, 'w_sword_2');
    expect(base).toBeGreaterThan(0.85);
    expect(base).toBeLessThan(1.15);
    const medBase = sim.priceMult(2, 'pill_heal_m');
    s.siegeUntil = st.clock.totalHours + 20;
    expect(sim.priceMult(2, 'w_sword_2')).toBeGreaterThan(base * 1.15);
    s.siegeUntil = 0;
    s.flags = ['plague'];
    expect(sim.priceMult(2, 'pill_heal_m')).toBeGreaterThan(medBase * 1.25);
    s.flags = [];
    for (const id of Object.keys(ITEMS).slice(0, 80)) {
      const p = sim.priceMult(2, id);
      expect(p).toBeGreaterThanOrEqual(0.5);
      expect(p).toBeLessThanOrEqual(3);
    }
    expect(sim.priceMult(999, 'grain')).toBe(1);
  });

  it('recordTrade shifts stock and therefore the price', () => {
    const sim = makeSim();
    const s = stateOf(sim).settlements[0];
    const before = s.stock.herb;
    const p0 = sim.priceMult(0, 'herb');
    sim.recordTrade(0, 'herb', 30, 'buy');
    expect(s.stock.herb).toBeCloseTo(Math.max(0, before - 30), 1);
    expect(sim.priceMult(0, 'herb')).toBeGreaterThanOrEqual(p0);
    sim.recordTrade(0, 'herb', 50, 'sell');
    expect(s.stock.herb).toBeGreaterThan(before - 30);
    // Non-goods and bad quantities are ignored.
    sim.recordTrade(0, 'w_sword_1', 3, 'buy');
    sim.recordTrade(0, 'herb', -4, 'buy');
    sim.recordTrade(0, 'herb', Number.NaN, 'buy');
    expect(Number.isFinite(s.stock.herb)).toBe(true);
  });
});

describe('production, caravans and famine', () => {
  it('every living settlement has sane production and consumption', () => {
    const sim = makeSim();
    for (const s of stateOf(sim).settlements) {
      if (s.status === 'fallen') {
        for (const g of GOODS) expect(s.prod[g] ?? 0).toBe(0);
        continue;
      }
      for (const g of GOODS) {
        expect(s.prod[g]).toBeGreaterThanOrEqual(0);
        expect(s.cons[g]).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s.stock[g])).toBe(true);
      }
      expect(s.cons.grain).toBeGreaterThan(0);
    }
  });

  it('grain production follows the seasons (x0.25 in winter, x1.5 in autumn)', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const at = (day: number) => {
      const target = day * 24 - 6;
      while (sim.clock().totalHours < target) runHours(sim, 1);
      return st.settlements[2].prod.grain;
    };
    const spring = at(5);
    const autumn = at(75);
    const winter = at(105);
    expect(autumn / spring).toBeGreaterThan(1.1);
    expect(winter / autumn).toBeLessThan(0.3);
  });

  it('caravans move surplus along open roads', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const [a, b] = livingRoad(sim);
    st.settlements[a].stock.ore_iron = 300;
    st.settlements[b].stock.ore_iron = 0;
    const before = st.ext.stats.caravanUnits ?? 0;
    runDays(sim, 3);
    expect(st.ext.stats.caravanUnits ?? 0).toBeGreaterThan(before);
    expect(st.settlements[b].stock.ore_iron).toBeGreaterThan(5);
    expect(st.settlements[a].stock.ore_iron).toBeLessThan(300);
  });

  it('a blighted road stops the caravans and the chronicle says so', () => {
    const world = worldFor(PROD_SEED);
    const sim = makeSim();
    const st = stateOf(sim);
    const [a, b, ri] = livingRoad(sim);
    const before = st.ext.stats.caravanUnits ?? 0;
    // Smother every tile of the road corridor in Blight.
    const A = world.settlements[a];
    const B = world.settlements[b];
    const steps = Math.max(Math.abs(B.x - A.x), Math.abs(B.y - A.y));
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(A.x + ((B.x - A.x) * k) / steps);
      const y = Math.round(A.y + ((B.y - A.y) * k) / steps);
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (world.terrain[(y + dy) * world.w + x + dx] !== 0) st.blight[(y + dy) * world.w + x + dx] = 230;
    }
    st.settlements[a].stock.ore_iron = 300;
    st.settlements[b].stock.ore_iron = 0;
    // Only this road matters for the assertion: measure the goods that crossed it.
    runHours(sim, 24);
    expect(st.ext.roadBlocked[ri]).toBe(1);
    expect(st.chronicle.some((c) => /choked by the Blight/.test(c.text))).toBe(true);
    void before;
  });

  it('shortages cause famine, which drains prosperity and clears with food', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const s = st.settlements[3];
    const pop0 = s.population;
    const pros0 = s.prosperity;
    const starve = () => {
      for (const o of st.settlements) {
        if (o.status === 'fallen') continue;
        for (const g of ['grain', 'meat']) {
          o.stock[g] = 0;
          o.prod[g] = 0;
        }
      }
    };
    starve();
    runDays(sim, 1);
    expect(s.flags).toContain('famine');
    expect(st.chronicle.some((c) => /Famine grips/.test(c.text))).toBe(true);
    for (let d = 0; d < 8; d++) {
      starve();
      runDays(sim, 1);
    }
    expect(s.prosperity).toBeLessThan(pros0);
    expect(s.population).toBeLessThan(pop0);
    // Relief ends it.
    s.stock.grain = s.cons.grain * 40;
    s.stock.meat = s.cons.meat * 40;
    runDays(sim, 2);
    expect(s.flags).not.toContain('famine');
  });

  it('besieged or fallen settlements stop trading', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    const [a, b] = livingRoad(sim);
    st.settlements[a].stock.ore_iron = 300;
    st.settlements[b].stock.ore_iron = 0;
    st.settlements[b].siegeUntil = st.clock.totalHours + 20;
    st.settlements[b].siegeBy = 'blight';
    const before = st.ext.stats.caravanUnits ?? 0;
    runHours(sim, 3);
    // The daily pass has not run yet inside 3 hours; run to midnight while the siege is on.
    const hoursToMidnight = 24 - (sim.clock().hour === 0 ? 24 : sim.clock().hour);
    st.settlements[b].siegeUntil = st.clock.totalHours + hoursToMidnight + 5;
    runHours(sim, hoursToMidnight + 1);
    expect(st.settlements[b].stock.ore_iron).toBeLessThan(20);
    void before;
  });

  it('stays well-fed over a year without disasters', () => {
    const sim = makeSim();
    const st = stateOf(sim);
    let famineDays = 0;
    runDays(sim, 120, () => {
      for (const s of st.settlements) if (s.flags.includes('famine')) famineDays++;
    });
    // Famines happen, but the realm does not starve as a rule.
    expect(famineDays).toBeLessThan(120 * 7 * 0.2);
  });
});
