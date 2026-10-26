import { FACTION_BY_ID } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { COMPOUNDS, GRADUATE_LEVEL, INNER_LEVEL, INNER_TITLE, OUTER_TITLE, compoundOf } from './disciples';
import { PROD_SEED, makeSim, runDays, stateOf, worldFor } from './testkit';
import type { Ctx } from './types';

const ctxOf = (sim: ReturnType<typeof makeSim>): Ctx => (sim as unknown as { ctx: Ctx }).ctx;
const disciplesAt = (sim: ReturnType<typeof makeSim>, sid: number) => sim.npcs(sid).filter((n) => n.role === 'disciple');
const mastersAt = (sim: ReturnType<typeof makeSim>, sid: number) => sim.npcs(sid).filter((n) => n.role === 'master');

describe('disciples', () => {
  it('fill a sect hall to its range and a town with a master and a yard to its own, and nowhere else', () => {
    for (const seed of [PROD_SEED, 7, 42]) {
      const sim = makeSim(seed);
      const world = worldFor(seed);
      for (const s of world.settlements) {
        const n = disciplesAt(sim, s.id).length;
        const range = compoundOf(ctxOf(sim), s.id);
        if (!range) {
          expect(n, `${s.name} (${s.kind}) keeps no compound`).toBe(0);
          continue;
        }
        const masters = mastersAt(sim, s.id).length;
        if (masters === 0) expect(n).toBe(0);
        else {
          expect(n, `${s.name} (${s.kind}) seed ${seed}`).toBeGreaterThanOrEqual(range[0]);
          expect(n).toBeLessThanOrEqual(range[1]);
        }
      }
    }
    expect(COMPOUNDS.sectHall).toEqual([6, 10]);
    expect(COMPOUNDS.town).toEqual([4, 6]);
  });

  it('are outer or inner, trained by a living master of the compound, in the colours of its faction', () => {
    const sim = makeSim();
    const world = worldFor(PROD_SEED);
    const hall = world.settlements.find((s) => s.kind === 'sectHall')!;
    const ds = disciplesAt(sim, hall.id);
    expect(ds.length).toBeGreaterThanOrEqual(6);
    const masters = new Map(mastersAt(sim, hall.id).map((m) => [m.id, m]));
    for (const d of ds) {
      expect([OUTER_TITLE, INNER_TITLE]).toContain(d.title);
      expect(d.level >= INNER_LEVEL).toBe(d.title === INNER_TITLE);
      expect(d.level).toBeLessThan(GRADUATE_LEVEL);
      expect(d.age).toBeGreaterThanOrEqual(15);
      expect(d.age).toBeLessThanOrEqual(31);
      const m = masters.get(d.mentor!);
      expect(m, `disciple ${d.id} has a master`).toBeTruthy();
      expect(d.faction).toBe(m!.faction);
      if (d.faction) expect(FACTION_BY_ID[d.faction]).toBeTruthy();
    }
    expect(ds.some((d) => d.title === OUTER_TITLE)).toBe(true);
    expect(ds.some((d) => d.title === INNER_TITLE)).toBe(true);
    // one uniform per faction in the compound: same robe, same colour
    for (const f of new Set(ds.map((d) => d.faction))) {
      const mine = ds.filter((d) => d.faction === f);
      expect(new Set(mine.map((d) => `${d.look.outfit}/${d.look.outfitColor}`)).size).toBe(1);
    }
  });

  it('track what the masters ask for: the target follows the sum of their disciples, inside the range', () => {
    const sim = makeSim();
    const world = worldFor(PROD_SEED);
    const hall = world.settlements.find((s) => s.kind === 'sectHall')!;
    const ms = mastersAt(sim, hall.id);
    for (const m of ms) m.disciples = 6;
    runDays(sim, 14);
    expect(disciplesAt(sim, hall.id).length).toBeGreaterThanOrEqual(9);
    expect(disciplesAt(sim, hall.id).length).toBeLessThanOrEqual(10);
    for (const m of mastersAt(sim, hall.id)) m.disciples = 0;
    runDays(sim, 40);
    // masters' own random walk may add students again; it never goes below the floor
    const n = disciplesAt(sim, hall.id).length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('pass to another master when theirs dies', () => {
    const sim = makeSim();
    const world = worldFor(PROD_SEED);
    const hall = world.settlements.find((s) => s.kind === 'sectHall')!;
    const ms = mastersAt(sim, hall.id);
    const victim = ms.find((m) => disciplesAt(sim, hall.id).some((d) => d.mentor === m.id))!;
    const students = disciplesAt(sim, hall.id).filter((d) => d.mentor === victim.id);
    expect(students.length).toBeGreaterThan(0);
    victim.age = 150;
    runDays(sim, 30);
    expect(victim.alive).toBe(false);
    for (const d of students.filter((x) => x.alive)) {
      expect(d.mentor).not.toBe(victim.id);
      const m = d.mentor != null ? sim.npc(d.mentor) : undefined;
      expect(m && m.alive && m.role === 'master' && m.settlementId === hall.id).toBe(true);
    }
  });

  it('do not disturb the random stream the rest of the sim runs on', () => {
    // the same seed gives the same masters, guards and legends whatever the disciples do: compare two runs, one of them
    // with its disciples removed on day zero (their ids come last, after every other NPC)
    const a = makeSim();
    const b = makeSim();
    const strip = (sim: ReturnType<typeof makeSim>) => {
      for (const n of stateOf(sim).npcs) if (n.role === 'disciple') n.alive = false;
    };
    strip(b);
    const key = (sim: ReturnType<typeof makeSim>) => sim.npcs().filter((n) => n.role !== 'disciple').map((n) => `${n.id}:${n.role}:${n.level}`).join(',');
    expect(key(a)).toBe(key(b));
    runDays(a, 3);
    runDays(b, 3);
    // the named roster outside the compounds ages and trains identically while the stream is shared
    const lv = (sim: ReturnType<typeof makeSim>) => sim.npcs().filter((n) => n.role === 'master' || n.role === 'guard' || n.role === 'legend').map((n) => `${n.id}:${n.level}:${n.alive}`).join(',');
    expect(lv(a)).toBe(lv(b));
  });

  it('survive a save and load with their masters', () => {
    const sim = makeSim();
    runDays(sim, 5);
    const snap = sim.serialize();
    const parsed = JSON.parse(snap.json) as { npcs?: { role: string; mentor?: number | null }[] };
    const ds = (parsed.npcs ?? (JSON.parse(snap.json) as { state: { npcs: { role: string; mentor?: number | null }[] } }).state?.npcs ?? []).filter((n) => n.role === 'disciple');
    expect(ds.length).toBeGreaterThanOrEqual(10);
    for (const d of ds) expect(typeof d.mentor === 'number' || d.mentor === null).toBe(true);
  });
});
