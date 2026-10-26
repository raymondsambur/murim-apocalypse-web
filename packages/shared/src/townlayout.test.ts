import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { ARCHETYPES, FOOTPRINT, SPECS, enclosureFor, pickArchetype, planTown, type Archetype, type Tile, type TownPlan } from './townlayout';
import type { SettlementKind } from './terrain';

const KINDS: SettlementKind[] = ['hamlet', 'village', 'town', 'fort', 'sectHall'];
const key = (t: Tile) => `${t.x},${t.y}`;

function plan(kind: SettlementKind, archetype: Archetype, seed: number, field = (_x: number, _y: number) => true, mainAxis: 'x' | 'y' = 'x'): TownPlan {
  const spec = SPECS[kind];
  return planTown({ kind, spec, archetype, field, rng: new Rng(seed), mainAxis });
}

const SOUTH_ONLY = ['smithy', 'market', 'shrine'];

describe('town layout plans', () => {
  const plans: { kind: SettlementKind; a: Archetype; seed: number; p: TownPlan }[] = [];
  for (const kind of KINDS) {
    const allowed = SPECS[kind].archetypes.map(([a]) => a);
    for (const a of allowed) for (const seed of [1, 2, 3]) plans.push({ kind, a, seed, p: plan(kind, a, seed) });
  }

  it('is deterministic', () => {
    for (const { kind, a, seed, p } of plans.slice(0, 12)) expect(plan(kind, a, seed)).toEqual(p);
  });

  it('places the whole programme on open ground', () => {
    // everything that matters is placed; a cramped settlement (a hamlet, or a village split by its river) may lack a house or two
    for (const { kind, a, seed, p } of plans) {
      expect(p.missing.filter((k) => k !== 'house'), `${kind} ${a} ${seed}`).toEqual([]);
      expect(p.missing.length, `${kind} ${a} ${seed}`).toBeLessThanOrEqual(kind === 'fort' || kind === 'sectHall' ? 0 : 2);
    }
  });

  it('never puts a building on a street, the plaza, water, another building or the enclosure', () => {
    for (const { kind, a, seed, p } of plans) {
      const paved = new Set([...p.roads, ...p.dirt, ...p.plaza, ...p.water, ...p.bridges, ...p.enclosureTiles, ...p.wells, ...p.lanterns, ...p.gardens, ...p.trees].map(key));
      const used = new Set<string>();
      for (const l of p.lots) {
        for (let y = l.y; y < l.y + l.d; y++) {
          for (let x = l.x; x < l.x + l.w; x++) {
            expect(paved.has(`${x},${y}`), `${kind} ${a} ${seed} ${l.kind} on paved ${x},${y}`).toBe(false);
            expect(used.has(`${x},${y}`), `${kind} ${a} ${seed} overlap at ${x},${y}`).toBe(false);
            used.add(`${x},${y}`);
          }
        }
      }
    }
  });

  it('turns every door to the street: south or east, on a street tile', () => {
    for (const { kind, a, seed, p } of plans) {
      const street = new Set([...p.roads, ...p.dirt, ...p.plaza, ...p.bridges].map(key));
      for (const l of p.lots) {
        expect([l.w, l.d]).toEqual(FOOTPRINT[l.kind]);
        if (l.face === 'S') expect(l.door).toEqual({ x: l.x + (l.w >> 1), y: l.y + l.d });
        else expect(l.door).toEqual({ x: l.x + l.w, y: l.y + (l.d >> 1) });
        if (l.face === 'E') expect(SOUTH_ONLY).not.toContain(l.kind);
        if (!l.needsPath) expect(street.has(key(l.door)), `${kind} ${a} ${seed} ${l.kind} door ${key(l.door)}`).toBe(true);
      }
    }
  });

  it('keeps the four axis avenues open out to the edge', () => {
    for (const { kind, a, seed, p } of plans) {
      const R = SPECS[kind].radius;
      const street = new Set([...p.roads, ...p.dirt, ...p.plaza, ...p.bridges].map(key));
      for (let k = 0; k <= R + 1; k++) for (const [x, y] of [[k, 0], [-k, 0], [0, k], [0, -k]]) expect(street.has(`${x},${y}`), `${kind} ${a} ${seed} avenue ${x},${y}`).toBe(true);
    }
  });

  it('reaches every door from the plaza along the streets', () => {
    for (const { kind, a, seed, p } of plans) {
      const walk = new Set([...p.roads, ...p.dirt, ...p.plaza, ...p.bridges].map(key));
      const seen = new Set<string>(['0,0']);
      const stack: Tile[] = [{ x: 0, y: 0 }];
      while (stack.length) {
        const t = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${t.x + dx},${t.y + dy}`;
          if (walk.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push({ x: t.x + dx, y: t.y + dy });
          }
        }
      }
      for (const l of p.lots) if (!l.needsPath) expect(seen.has(key(l.door)), `${kind} ${a} ${seed} ${l.kind} door ${key(l.door)} cut off`).toBe(true);
    }
  });

  it('encloses by kind and leaves the four axes open', () => {
    expect(enclosureFor('fort', 'walled')).toBe('wall');
    expect(enclosureFor('sectHall', 'ring')).toBe('wall');
    expect(enclosureFor('town', 'walled')).toBe('palisade');
    expect(enclosureFor('town', 'grid')).toBe('none');
    expect(enclosureFor('village', 'grid')).toBe('fence');
    expect(enclosureFor('ruin', 'cross')).toBe('none');
    for (const { kind, a, p } of plans) {
      expect(p.enclosure).toBe(enclosureFor(kind, a));
      if (p.enclosure === 'none') {
        expect(p.enclosureTiles).toHaveLength(0);
        continue;
      }
      const E = SPECS[kind].radius - 1;
      const t = new Set(p.enclosureTiles.map(key));
      expect(t.size).toBeGreaterThan(E * 4);
      for (const [x, y] of [[E, 0], [-E, 0], [0, E], [0, -E], [E, 1], [E, -1], [1, E], [-1, -E]]) expect(t.has(`${x},${y}`)).toBe(false);
      for (const tile of p.enclosureTiles) expect(Math.max(Math.abs(tile.x), Math.abs(tile.y))).toBe(E);
    }
  });

  it('gives a fort and a sect hall corner towers', () => {
    for (const { kind, p } of plans) {
      const towers = p.lots.filter((l) => l.kind === 'tower');
      expect(towers).toHaveLength(kind === 'fort' || kind === 'sectHall' ? 4 : 0);
    }
  });

  it('gives towns two barracks and the market quarter the middle', () => {
    for (const { kind, p } of plans) {
      if (kind === 'town') expect(p.lots.filter((l) => l.kind === 'barracks')).toHaveLength(2);
      if (kind === 'fort') expect(p.lots.filter((l) => l.kind === 'barracks')).toHaveLength(3);
    }
    // markets sit nearer the centre than houses, on average
    let m = 0;
    let h = 0;
    let nm = 0;
    let nh = 0;
    for (const { kind, p } of plans) {
      if (kind !== 'town' && kind !== 'village') continue;
      for (const l of p.lots) {
        const d = Math.hypot(l.x + l.w / 2, l.y + l.d / 2);
        if (l.zone === 'market') {
          m += d;
          nm++;
        } else if (l.kind === 'house') {
          h += d;
          nh++;
        }
      }
    }
    expect(m / nm).toBeLessThan(h / nh);
  });

  it('shapes the archetypes differently', () => {
    const shapes = new Map<Archetype, Set<string>>();
    for (const a of ARCHETYPES) shapes.set(a, new Set([...plan('town', a, 9).roads, ...plan('town', a, 9).dirt].map(key)));
    const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((k) => y.has(k)).length / new Set([...x, ...y]).size;
    for (let i = 0; i < ARCHETYPES.length; i++) for (let j = i + 1; j < ARCHETYPES.length; j++) expect(jaccard(shapes.get(ARCHETYPES[i])!, shapes.get(ARCHETYPES[j])!), `${ARCHETYPES[i]} vs ${ARCHETYPES[j]}`).toBeLessThan(0.85);
  });

  it('runs a river with bridges where the streets cross it', () => {
    const p = plan('town', 'river', 4);
    expect(p.water.length).toBeGreaterThan(20);
    expect(p.bridges.length).toBeGreaterThanOrEqual(4);
    const water = new Set(p.water.map(key));
    for (const b of p.bridges) expect(water.has(key(b))).toBe(false);
  });

  it('runs a main street along the chosen axis', () => {
    const roadsOf = (axis: 'x' | 'y') => {
      const p = plan('village', 'mainStreet', 5, () => true, axis);
      return new Set([...p.roads, ...p.plaza].map(key));
    };
    const ex = roadsOf('x');
    const ey = roadsOf('y');
    // a long second row of road beside the avenue (y = 1 for x, x = 1 for y)
    let rowX = 0;
    let rowY = 0;
    for (let k = -12; k <= 12; k++) {
      if (ex.has(`${k},1`)) rowX++;
      if (ey.has(`1,${k}`)) rowY++;
    }
    expect(rowX).toBeGreaterThanOrEqual(20);
    expect(rowY).toBeGreaterThanOrEqual(20);
  });

  it('adapts to ground that cannot be built on', () => {
    // water west of x = -5: no tile there is used, and the plan still places most of the programme
    const p = plan('town', 'grid', 6, (x) => x > -5);
    for (const t of [...p.roads, ...p.plaza, ...p.dirt, ...p.lots.flatMap((l) => [{ x: l.x, y: l.y }])]) expect(t.x).toBeGreaterThan(-5);
    expect(p.lots.length).toBeGreaterThan(SPECS.town.program.length * 0.6);
  });

  it('has more room, more buildings and more houses as the settlement grows', () => {
    const count = (k: SettlementKind) => SPECS[k].program.length;
    expect(SPECS.hamlet.radius).toBeLessThan(SPECS.village.radius);
    expect(SPECS.village.radius).toBeLessThan(SPECS.town.radius);
    expect(count('hamlet')).toBeLessThan(count('village'));
    expect(count('village')).toBeLessThan(count('town'));
    // beds: four to a house
    const beds = (k: SettlementKind) => 4 * SPECS[k].program.filter((b) => b === 'house' || b === 'farmhouse').length;
    expect(beds('hamlet')).toBeGreaterThanOrEqual(12);
    expect(beds('village')).toBeGreaterThanOrEqual(36);
    expect(beds('town')).toBeGreaterThanOrEqual(72);
  });

  it('picks archetypes by weight and only those a kind lists', () => {
    for (const kind of KINDS) {
      const allowed = new Set(SPECS[kind].archetypes.map(([a]) => a));
      const seen = new Set<Archetype>();
      for (let i = 0; i < 200; i++) seen.add(pickArchetype(kind, new Rng(i)));
      for (const a of seen) expect(allowed.has(a)).toBe(true);
      expect(seen.size).toBe(allowed.size);
    }
  });
});
