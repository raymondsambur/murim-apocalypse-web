import { AMBIENT_GLOBAL_CAP, AMBIENT_LOOKS, ambientLook, ambientQuota, crowdHourFactor, dist, isPassable } from '@murim/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeLifeHarness, type LifeHarness } from '../npclife/testkit';
import { AMBIENT_DATA } from '../ctx';
import { AMBIENT_TUNING } from './ambient';

let h: LifeHarness | null = null;
afterEach(() => {
  h?.close();
  h = null;
});

const make = (seed = 42): LifeHarness => (h = makeLifeHarness({ real: true, seed }));
const named = (x: LifeHarness, sid: number) => x.ctx.sim.npcs(sid).filter((n) => n.alive).length;
const kindId = (x: LifeHarness, kind: string): number => x.ctx.world.settlements.find((s) => s.kind === kind)!.id;
const standIn = (x: LifeHarness, sid: number, name = 'Walker') => x.join(name, x.ctx.world.settlements[sid].spawn);
/** Tick long enough for a crowd to trickle out (two per half second) and settle. */
const fill = (x: LifeHarness, seconds = 30) => x.run(seconds * 1000);

describe('ambient townsfolk', () => {
  it('exist only while a player is near', () => {
    const x = make();
    x.setHour(12);
    x.tick(30);
    expect(x.game.ambient.count).toBe(0);
    standIn(x, 0);
    fill(x);
    expect(x.game.ambient.count).toBeGreaterThan(5);
    // every settlement but the watched one stays empty
    for (const s of x.ctx.world.settlements) if (s.id !== 0) expect(x.game.ambient.membersOf(s.id), s.name).toHaveLength(0);
  });

  it('make the people on screen at midday equal the population the settlement reports', () => {
    const x = make();
    x.setHour(12);
    for (const kind of ['village', 'town', 'hamlet'] as const) {
      const sid = kindId(x, kind);
      const { p } = standIn(x, sid, `W${kind}`);
      fill(x, 40);
      const view = x.ctx.sim.settlementView(sid);
      const ambient = x.game.ambient.membersOf(sid).length;
      expect(ambient, `${kind} ambient`).toBe(ambientQuota(view.population, named(x, sid)));
      expect(named(x, sid) + ambient, `${kind} residents`).toBe(view.population);
      p.entity.hidden = false;
      x.game.movement.teleport(p.entity, 1, 1); // walk away before the next settlement
      fill(x, 20);
    }
  });

  it('keep to the streets of their own settlement, on walkable ground, with nameless, plain looks', () => {
    const x = make();
    x.setHour(11);
    standIn(x, kindId(x, 'town'));
    fill(x, 60);
    const sid = kindId(x, 'town');
    const def = x.ctx.world.settlements[sid];
    const looks = new Set(Array.from({ length: AMBIENT_LOOKS }, (_, i) => JSON.stringify(ambientLook(i))));
    for (const e of x.game.ambient.membersOf(sid)) {
      expect(e.kind).toBe('ambient');
      expect(e.name).toBe('');
      expect(isPassable(x.ctx.world, e.x, e.y)).toBe(true);
      expect(Math.max(Math.abs(e.x - def.x), Math.abs(e.y - def.y))).toBeLessThanOrEqual(def.radius + 4);
      expect(looks.has(JSON.stringify(e.look))).toBe(true);
      expect(e.role).toBe('villager');
      expect(AMBIENT_DATA.get(e)?.settlementId).toBe(sid);
    }
  });

  it('walk between places and pause there', () => {
    const x = make();
    x.setHour(10);
    standIn(x, kindId(x, 'town'));
    fill(x, 30);
    const sid = kindId(x, 'town');
    const start = new Map(x.game.ambient.membersOf(sid).map((e) => [e.id, { x: e.x, y: e.y }]));
    let moving = 0;
    for (let i = 0; i < 300; i++) {
      x.tick();
      for (const e of x.game.ambient.membersOf(sid)) if (e.move) moving++;
    }
    const moved = x.game.ambient.membersOf(sid).filter((e) => start.has(e.id) && dist(e.x, e.y, start.get(e.id)!.x, start.get(e.id)!.y) > 3);
    expect(moving).toBeGreaterThan(50);
    expect(moved.length).toBeGreaterThan(5);
  });

  it('thin out at night and fill the streets by day', () => {
    const x = make();
    const sid = kindId(x, 'town');
    standIn(x, sid);
    x.setHour(12);
    fill(x, 40);
    const day = x.game.ambient.membersOf(sid).length;
    x.setHour(2);
    fill(x, 40);
    const night = x.game.ambient.membersOf(sid).length;
    expect(day).toBeGreaterThan(30);
    expect(night).toBeLessThanOrEqual(Math.ceil(day * crowdHourFactor(2)) + 1);
    expect(night).toBeLessThan(day / 4);
  });

  it('go indoors and vanish once the last player leaves, after a grace period', () => {
    const x = make();
    x.setHour(12);
    const sid = kindId(x, 'village');
    const { p } = standIn(x, sid);
    fill(x, 30);
    expect(x.game.ambient.membersOf(sid).length).toBeGreaterThan(5);
    x.game.movement.teleport(p.entity, 5, 5);
    x.run(AMBIENT_TUNING.graceMs - 4000);
    expect(x.game.ambient.membersOf(sid).length).toBeGreaterThan(5);
    x.run(8000);
    expect(x.game.ambient.membersOf(sid)).toHaveLength(0);
    expect(x.game.ambient.count).toBe(0);
  });

  it('hide indoors when the settlement is besieged', () => {
    const x = make();
    x.setHour(12);
    const sid = kindId(x, 'village');
    standIn(x, sid);
    fill(x, 30);
    expect(x.game.ambient.membersOf(sid).length).toBeGreaterThan(5);
    x.ctx.sim.state.settlements[sid].siegeUntil = x.ctx.sim.state.clock.totalHours + 6;
    expect(x.ctx.sim.settlementView(sid).siege).toBe(true);
    fill(x, 40);
    expect(x.game.ambient.membersOf(sid)).toHaveLength(0);
  });

  it('respect the world-wide cap however many settlements are watched', () => {
    const x = make();
    x.setHour(12);
    for (const s of x.ctx.world.settlements) if (s.kind !== 'ruin') standIn(x, s.id, `P${s.id}`);
    fill(x, 60);
    let wanted = 0;
    for (const s of x.ctx.world.settlements) wanted += x.game.ambient.wantOf(s.id);
    expect(wanted).toBeLessThanOrEqual(AMBIENT_GLOBAL_CAP);
    expect(x.game.ambient.count).toBeLessThanOrEqual(AMBIENT_GLOBAL_CAP);
    expect(x.game.ambient.count).toBeGreaterThan(80);
  });

  it('cannot be talked to, and the player is told so', () => {
    const x = make();
    x.setHour(12);
    const sid = kindId(x, 'village');
    const { p, conn } = standIn(x, sid);
    fill(x, 20);
    const e = x.game.ambient.membersOf(sid)[0];
    expect(e).toBeTruthy();
    expect((p as unknown as { known: Set<number> }).known.has(e.id)).toBe(true);
    conn.clear();
    x.say(p, { t: 'interact', id: e.id });
    x.tick(5);
    expect(conn.of('err').length + conn.of('note').length).toBeGreaterThan(0);
    expect(p.entity.move).toBeNull();
  });

  it('reach clients as ordinary entities with a look and no name', () => {
    const x = make();
    x.setHour(12);
    const { conn } = standIn(x, kindId(x, 'village'));
    fill(x, 20);
    const views = conn.of('ents').flatMap((m) => m.add ?? []).filter((v) => v.kind === 'ambient');
    expect(views.length).toBeGreaterThan(5);
    for (const v of views) {
      expect(v.name).toBe('');
      expect(v.look).toBeTruthy();
    }
  });

  it('are reproducible for a seed', () => {
    const run = () => {
      const x = make(7);
      x.setHour(12);
      standIn(x, kindId(x, 'town'));
      fill(x, 45);
      const out = x.game.ambient.membersOf(kindId(x, 'town')).map((e) => `${e.x},${e.y},${AMBIENT_DATA.get(e)!.variant}`);
      x.close();
      h = null;
      return out.sort();
    };
    const a = run();
    expect(a.length).toBeGreaterThan(20);
    expect(run()).toEqual(a);
  });
});
