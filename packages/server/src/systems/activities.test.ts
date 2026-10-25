import { describe, expect, it, vi } from 'vitest';
import { OFFLINE_CAP_MS, RECIPES, xpToNext, type WorkSiteDef } from '@murim/shared';
import { FakeConn, makeHarness, type Harness } from '../testkit';
import type { PlayerImpl } from '../game/players';
import { register } from './activities';
import {
  CRAFT_CANCEL_GRACE_MS,
  craftUnits,
  jobXpMultiplier,
  maxCraftQty,
  seasonMultFor,
  shiftOutput,
  takeWhole,
  trainXpPerHour,
} from './activities/rules';

const HOUR = 3_600_000;

function setup(): { h: Harness; p: PlayerImpl; conn: FakeConn; api: NonNullable<ReturnType<typeof getApi>>; user: ReturnType<Harness['join']>['user'] } {
  const h = makeHarness();
  register(h.game.ctx);
  const { p, conn, user } = h.join('Hero');
  h.tick(2);
  return { h, p, conn, api: getApi(h)!, user };
}
import { getActivities } from './activities';
function getApi(h: Harness) {
  return getActivities(h.game.ctx);
}

function findSite(h: Harness, kind: WorkSiteDef['kind']): WorkSiteDef {
  for (const s of h.world.settlements) {
    const site = s.sites.find((w) => w.kind === kind);
    if (site) return site;
  }
  throw new Error(`no ${kind} site in the test world`);
}
function goto(h: Harness, p: PlayerImpl, site: WorkSiteDef): void {
  h.game.movement.teleport(p.entity, site.x, site.y);
}
function start(h: Harness, p: PlayerImpl, conn: FakeConn, msg: Parameters<Harness['say']>[1]): string | null {
  conn.clear();
  h.clock.advance(1500); // astart cooldown
  h.say(p, msg);
  h.tick(1);
  return conn.last('err')?.code ?? null;
}
/** Jump the fake clock and settle. */
function later(h: Harness, ms: number): void {
  h.clock.advance(ms);
}

describe('pure rules', () => {
  it('training xp per hour', () => {
    expect(trainXpPerHour(10, 8)).toBe(40);
    expect(trainXpPerHour(10, 8, 1.5)).toBe(60);
  });

  it('shift output tables per job, level and season', () => {
    // herbalist level 1, spring (x1.2): herb (5 + 1.5) * 1.2 per hour
    const spring = shiftOutput('herbalist', 1, 0, HOUR);
    expect(spring.items[0][0]).toBe('herb');
    expect(spring.items[0][1]).toBeCloseTo(7.8, 6);
    expect(spring.gold).toBe(13);
    expect(spring.xp).toBe(60);
    // winter halves herbs, level 10 raises them
    expect(shiftOutput('herbalist', 10, 3, HOUR).items[0][1]).toBeCloseTo(10, 6);
    expect(shiftOutput('herbalist', 10, 3, HOUR).items[1][1]).toBeCloseTo(0.2, 6);
    // miner ignores seasons
    expect(shiftOutput('miner', 5, 3, HOUR).items[0][1]).toBeCloseTo(10, 6);
    expect(shiftOutput('miner', 5, 0, HOUR).items[0][1]).toBeCloseTo(10, 6);
    expect(shiftOutput('miner', 5, 0, HOUR).gold).toBe(29);
    // farmer: autumn x1.5, winter x0.25
    expect(shiftOutput('farmer', 3, 2, HOUR).items[0][1]).toBeCloseTo(24, 6);
    expect(shiftOutput('farmer', 3, 3, HOUR).items[0][1]).toBeCloseTo(4, 6);
    expect(shiftOutput('farmer', 3, 1, 30 * 60_000).gold).toBeCloseTo(7, 6);
    expect(seasonMultFor('blacksmith', 2)).toBe(1);
    expect(seasonMultFor('farmer', 6)).toBe(1.5); // wraps
  });

  it('job xp multipliers stack', () => {
    expect(jobXpMultiplier([], 'merchant_heir', 'miner')).toBe(1);
    expect(jobXpMultiplier(['green_thumb'], 'physician_apprentice', 'alchemist')).toBeCloseTo(1.56, 6);
    expect(jobXpMultiplier(['green_thumb'], 'farmer_child', 'miner')).toBe(1);
  });

  it('carry keeps fractions and survives float noise', () => {
    const c: Record<string, number> = {};
    expect(takeWhole(c, 'x', 0.4)).toBe(0);
    expect(takeWhole(c, 'x', 0.4)).toBe(0);
    expect(takeWhole(c, 'x', 0.4)).toBe(1);
    expect(c.x).toBeCloseTo(0.2, 6);
    expect(takeWhole({}, 'y', 0.9999999999999)).toBe(1);
    expect(takeWhole({}, 'z', (60 * 60_000) / HOUR)).toBe(1);
  });

  it('crafting units are whole', () => {
    expect(craftUnits(59_000, 20, 10)).toBe(2);
    expect(craftUnits(1_000_000, 20, 3)).toBe(3);
    expect(craftUnits(-5, 20, 3)).toBe(0);
    expect(maxCraftQty(1800)).toBe(16);
    expect(maxCraftQty(10)).toBe(20);
  });
});

describe('training', () => {
  it('grants dojo xp, is idempotent and honours the experience multipliers', () => {
    const { h, p, conn, api } = setup();
    const dojo = findSite(h, 'dojo');
    goto(h, p, dojo);
    p.save.stats.insight = 10;
    p.save.stats.spirit = 8;
    p.save.talents = [];
    p.save.equipment = { weapon: null, outfit: null, accessory: null };
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: dojo.id })).toBeNull();
    expect(p.save.activity?.kind).toBe('train');
    expect(p.entity.state).toBe('meditate');
    const xp0 = p.save.xp;
    later(h, HOUR);
    api.settle(p);
    // (12 + 20 + 8) * 1.5 = 60/h; level 1 needs 36 so one level-up happens
    const total = (p.save.level - 1 > 0 ? xpToNext(1) : 0) + p.save.xp - xp0;
    expect(total).toBe(60);
    const snap = JSON.stringify(p.save);
    api.settle(p);
    expect(JSON.stringify(p.save)).toBe(snap);
    h.close();
  });

  it('does not lose xp to rounding over minute-sized settles', () => {
    const { h, p, conn, api } = setup();
    const dojo = findSite(h, 'dojo');
    goto(h, p, dojo);
    p.save.talents = [];
    p.save.level = 10 - 1;
    p.save.equipment = { weapon: null, outfit: null, accessory: null };
    p.save.stats.insight = 5;
    p.save.stats.spirit = 5;
    start(h, p, conn, { t: 'astart', kind: 'train', site: dojo.id });
    const before = p.save.xp;
    for (let i = 0; i < 60; i++) {
      later(h, 60_000);
      api.settle(p);
    }
    // 27 * 1.5 = 40.5 xp/h
    expect(p.save.xp - before + 0).toBeGreaterThanOrEqual(40);
    expect(p.save.xp - before).toBeLessThanOrEqual(41);
    h.close();
  });

  it('stops at the breakthrough cap and refuses to start there', () => {
    const { h, p, conn, api } = setup();
    const dojo = findSite(h, 'dojo');
    goto(h, p, dojo);
    p.save.level = 9;
    p.save.xp = xpToNext(9);
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: dojo.id })).toBe('xp_full');
    p.save.xp = xpToNext(9) - 10;
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: dojo.id })).toBeNull();
    later(h, 2 * HOUR);
    api.settle(p);
    expect(p.save.level).toBe(9);
    expect(p.save.xp).toBe(xpToNext(9));
    expect(p.save.activity).toBeNull();
    expect(conn.of('note').some((n) => /limit/i.test(n.text))).toBe(true);
    h.close();
  });

  it('non-dojo training only needs to be inside the settlement', () => {
    const { h, p, conn } = setup();
    const farm = findSite(h, 'farm');
    const s = h.world.settlements[farm.settlementId];
    h.game.movement.teleport(p.entity, s.x, s.y);
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: farm.id })).toBeNull();
    h.close();
  });
});

describe('shifts', () => {
  it('pays items, gold and job xp with seasons, and settling twice changes nothing', () => {
    const { h, p, conn, api } = setup();
    vi.spyOn(h.game.sim, 'clock').mockReturnValue({ totalHours: 0, hour: 0, day: 0, season: 2, year: 0 });
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    p.save.talents = [];
    p.save.origin = 'merchant_heir';
    p.save.inventory = [];
    const gold0 = p.save.gold;
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' })).toBeNull();
    expect(p.entity.state).toBe('work');
    later(h, 2 * HOUR);
    api.settle(p);
    // level 1 farmer in autumn: (10 + 2) * 1.5 = 18 grain/h, gold 10/h, 60 xp/h (levels up part-way through)
    const grain = p.save.inventory.find((s) => s.id === 'grain')?.qty ?? 0;
    expect(grain).toBeGreaterThanOrEqual(34);
    expect(grain).toBeLessThanOrEqual(40);
    expect(p.save.gold - gold0).toBeGreaterThanOrEqual(20);
    expect(p.save.jobs.farmer.lv).toBeGreaterThan(1);
    const snap = JSON.stringify(p.save);
    api.settle(p);
    expect(JSON.stringify(p.save)).toBe(snap);
    expect(p.save.activity?.settled).toBe(h.clock.t);
    h.close();
  });

  it('applies the talent and origin job xp multipliers', () => {
    const { h, p, conn, api } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    p.save.talents = ['green_thumb'];
    p.save.origin = 'farmer_child';
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    later(h, 1_800_000);
    api.settle(p);
    // 30 minutes: 30 xp * 1.56 = 46.8 -> level 1 needs 80, so still level 1 with 46 xp
    expect(p.save.jobs.farmer.lv).toBe(1);
    expect(p.save.jobs.farmer.xp).toBe(46);
    h.close();
  });

  it('ends at the 8 hour cap and pays only 8 hours', () => {
    const { h, p, conn, api } = setup();
    const mine = findSite(h, 'mine');
    goto(h, p, mine);
    p.save.inventory = [];
    start(h, p, conn, { t: 'astart', kind: 'shift', site: mine.id, job: 'miner' });
    const since = p.save.activity!.since;
    later(h, 20 * HOUR);
    api.settle(p);
    expect(p.save.activity).toBeNull();
    expect(h.clock.t - since).toBe(20 * HOUR);
    // 8 h of level-1 mining pays 8 * 14.. gold (wage grows with level) - never 20 h worth
    const ore = p.save.inventory.find((s) => s.id === 'ore_iron')?.qty ?? 0;
    expect(ore).toBeGreaterThan(8 * 5 - 1);
    expect(ore).toBeLessThan(8 * 12);
    expect(conn.of('note').some((n) => /8-hour/.test(n.text))).toBe(true);
    h.close();
  });

  it('ends when the bag is full', () => {
    const { h, p, conn, api } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    p.save.inventory = Array.from({ length: 40 }, (_, i) => ({ id: 'w_sword_1', qty: 1, uid: `u${i}` }));
    later(h, HOUR);
    api.settle(p);
    expect(p.save.activity).toBeNull();
    expect(conn.of('note').some((n) => /bag is full/i.test(n.text))).toBe(true);
    h.close();
  });

  it('refuses invalid shifts', () => {
    const { h, p, conn } = setup();
    const farm = findSite(h, 'farm');
    const mine = findSite(h, 'mine');
    goto(h, p, farm);
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: 'nope', job: 'farmer' })).toBe('no_site');
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'miner' })).toBe('wrong_site');
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'blacksmith' })).toBe('bad_job');
    h.game.movement.teleport(p.entity, farm.x + 12, farm.y);
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' })).toBe('too_far');
    goto(h, p, mine);
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: mine.id, job: 'miner' })).toBeNull();
    expect(start(h, p, conn, { t: 'astart', kind: 'shift', site: mine.id, job: 'miner' })).toBe('busy');
    h.close();
  });
});

describe('crafting', () => {
  const R = RECIPES.r_heal_s; // 3 herb -> 3 Minor Healing Pill, 20 s

  it('consumes inputs up front, delivers whole units and keeps the remainder', () => {
    const { h, p, conn, api } = setup();
    const lab = findSite(h, 'alchemyLab');
    goto(h, p, lab);
    p.save.inventory = [{ id: 'herb', qty: 20 }];
    expect(start(h, p, conn, { t: 'astart', kind: 'craft', site: lab.id, recipe: R.id, qty: 5 })).toBeNull();
    expect(p.save.inventory.find((s) => s.id === 'herb')?.qty).toBe(5);
    const since = p.save.activity!.since;
    later(h, 50_000);
    api.settle(p);
    const a = p.save.activity!;
    expect(a.kind === 'craft' && a.remaining).toBe(3);
    expect(a.settled).toBe(since + 40_000);
    expect(p.save.inventory.find((s) => s.id === 'pill_heal_s')?.qty).toBe(6);
    expect(p.save.jobs.alchemist.xp).toBe(16);
    // 10 s into the next unit (past the grace): stopping forfeits that unit, refunds the two unstarted ones
    conn.clear();
    h.say(p, { t: 'astop' });
    h.tick(1);
    expect(p.save.activity).toBeNull();
    expect(p.save.inventory.find((s) => s.id === 'herb')?.qty).toBe(5 + 2 * 3);
    expect(p.entity.state).toBe('idle');
    h.close();
  });

  it('stopping inside the grace window forfeits nothing', () => {
    const { h, p, conn } = setup();
    const lab = findSite(h, 'alchemyLab');
    goto(h, p, lab);
    p.save.inventory = [{ id: 'herb', qty: 9 }];
    start(h, p, conn, { t: 'astart', kind: 'craft', site: lab.id, recipe: R.id, qty: 3 });
    later(h, CRAFT_CANCEL_GRACE_MS - 1000);
    h.say(p, { t: 'astop' });
    h.tick(1);
    expect(p.save.inventory.find((s) => s.id === 'herb')?.qty).toBe(9);
    h.close();
  });

  it('finishes the batch and ends', () => {
    const { h, p, conn, api } = setup();
    const lab = findSite(h, 'alchemyLab');
    goto(h, p, lab);
    p.save.inventory = [{ id: 'herb', qty: 6 }];
    start(h, p, conn, { t: 'astart', kind: 'craft', site: lab.id, recipe: R.id, qty: 2 });
    later(h, 3600_000);
    api.settle(p);
    expect(p.save.activity).toBeNull();
    expect(p.save.inventory).toEqual([{ id: 'pill_heal_s', qty: 6 }]);
    h.close();
  });

  it('rolls rarity and affixes for gear recipes', () => {
    const { h, p, conn, api } = setup();
    const smithy = findSite(h, 'smithy');
    goto(h, p, smithy);
    p.save.inventory = [{ id: 'ingot_iron', qty: 20 }, { id: 'hide', qty: 10 }];
    expect(start(h, p, conn, { t: 'astart', kind: 'craft', site: smithy.id, recipe: 'r_w_sword_1', qty: 10 })).toBeNull();
    later(h, 10 * 40_000);
    api.settle(p);
    const swords = p.save.inventory.filter((s) => s.id === 'w_sword_1');
    expect(swords.length).toBe(10);
    expect(new Set(swords.map((s) => s.uid)).size).toBe(10);
    expect(swords.every((s) => s.r !== undefined && s.aff !== undefined)).toBe(true);
    h.close();
  });

  it('validates crafting requests', () => {
    const { h, p, conn } = setup();
    const lab = findSite(h, 'alchemyLab');
    const smithy = findSite(h, 'smithy');
    goto(h, p, lab);
    p.save.inventory = [{ id: 'herb', qty: 100 }];
    const s = (recipe: string, qty: number, site = lab.id) => start(h, p, conn, { t: 'astart', kind: 'craft', site, recipe, qty });
    expect(s('nope', 1)).toBe('no_recipe');
    expect(s(R.id, 0)).toBe('bad_qty');
    expect(s(R.id, 21)).toBe('bad_qty');
    expect(s('r_break_4', 1)).toBe('low_level');
    p.save.jobs.alchemist.lv = 20;
    expect(s('r_break_4', 17)).toBe('too_long');
    expect(s('r_heal_s', 1, smithy.id)).toBe('wrong_site');
    expect(s('r_heal_m', 1)).toBe('no_materials');
    p.save.inventory = [{ id: 'herb', qty: 3 }, ...Array.from({ length: 39 }, (_, i) => ({ id: 'w_sword_1', qty: 1, uid: `u${i}` }))];
    p.save.inventory[0].qty = 3;
    expect(s(R.id, 1)).toBeNull(); // frees its own slot, so the pills fit
    h.close();
  });

  it('recipes query reports canCraft and reasons', () => {
    const { h, p, conn } = setup();
    const lab = findSite(h, 'alchemyLab');
    goto(h, p, lab);
    p.save.inventory = [{ id: 'herb', qty: 3 }];
    h.say(p, { t: 'q', id: 7, name: 'recipes', args: { site: lab.id } });
    const res = conn.of('res').find((r) => r.id === 7)!;
    const list = res.data as { id: string; canCraft: boolean; reason?: string }[];
    expect(res.ok).toBe(true);
    expect(list.find((r) => r.id === 'r_heal_s')?.canCraft).toBe(true);
    expect(list.find((r) => r.id === 'r_qi_s')?.canCraft).toBe(false);
    expect(list.find((r) => r.id === 'r_break_1')?.reason).toMatch(/level 3/);
    expect(list.every((r) => RECIPES[r.id].job === 'alchemist')).toBe(true);
    h.say(p, { t: 'q', id: 8, name: 'recipes', args: { site: findSite(h, 'farm').id } });
    expect(conn.of('res').find((r) => r.id === 8)?.data).toEqual([]);
    h.say(p, { t: 'q', id: 9, name: 'recipes', args: { site: 'bogus' } });
    expect(conn.of('res').find((r) => r.id === 9)?.ok).toBe(false);
    h.close();
  });
});

describe('interruptions and queries', () => {
  it('moving settles and ends the activity; a refused move does not', () => {
    const { h, p, conn } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    later(h, HOUR);
    h.say(p, { t: 'move', x: p.entity.x, y: p.entity.y });
    h.tick(1);
    expect(p.save.activity).not.toBeNull(); // clicking your own tile is not moving
    h.say(p, { t: 'move', x: p.entity.x + 3, y: p.entity.y });
    h.tick(1);
    expect(p.save.activity).toBeNull();
    expect(p.save.inventory.some((s) => s.id === 'grain')).toBe(true);
    expect(p.entity.move).not.toBeNull();
    h.close();
  });

  it('combat ends the activity', () => {
    const { h, p, conn } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    later(h, 30 * 60_000);
    p.combatId = 99;
    h.tick(4);
    expect(p.save.activity).toBeNull();
    expect(p.save.inventory.some((s) => s.id === 'grain')).toBe(true);
    p.combatId = null;
    const town = h.world.settlements[farm.settlementId];
    h.game.movement.teleport(p.entity, town.x, town.y);
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: farm.id })).toBeNull();
    p.save.activity = null;
    p.combatId = 5;
    expect(start(h, p, conn, { t: 'astart', kind: 'train', site: farm.id })).toBe('in_combat');
    h.close();
  });

  it('astop without an activity is an error; sites query lists dojo bonus and jobs', () => {
    const { h, p, conn } = setup();
    h.say(p, { t: 'astop' });
    h.tick(1);
    expect(conn.last('err')?.code).toBe('idle');
    const s = h.world.settlements.find((x) => x.sites.some((w) => w.kind === 'dojo'))!;
    h.say(p, { t: 'q', id: 1, name: 'sites', args: { settlement: s.id } });
    const list = conn.of('res').find((r) => r.id === 1)!.data as { kind: string; job?: string; trainBonus?: number; settlementId: number }[];
    expect(list.length).toBe(s.sites.length);
    expect(list.find((w) => w.kind === 'dojo')?.trainBonus).toBe(1.5);
    expect(list.find((w) => w.kind === 'farm')?.job).toBe('farmer');
    h.say(p, { t: 'q', id: 2, name: 'sites', args: { settlement: 9999 } });
    expect(conn.of('res').find((r) => r.id === 2)?.ok).toBe(false);
    h.close();
  });
});

describe('offline progress', () => {
  it('settles on login and reports what the worker earned', () => {
    const { h, p, conn, user } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    p.save.inventory = [];
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    h.game.disconnect(conn);
    const worker = h.game.players.byCharId(p.charId)!;
    expect(worker.online).toBe(false);
    later(h, 3 * HOUR);
    h.tick(1); // the minute timer settles the offline worker
    expect(worker.save.inventory.some((s) => s.id === 'grain')).toBe(true);
    later(h, 1 * HOUR);
    const conn2 = new FakeConn();
    const p2 = h.game.connect(conn2, user)!;
    h.tick(2);
    const note = conn2.of('note').find((n) => /While you were away/.test(n.text));
    expect(note?.text).toMatch(/4h 0m of work.*Grain/);
    expect(p2.save.activity).not.toBeNull();
    h.close();
  });

  it('caps the offline run, removes the idle worker and tells the player at the next login', () => {
    const { h, p, conn, user } = setup();
    const mine = findSite(h, 'mine');
    goto(h, p, mine);
    p.save.inventory = [];
    start(h, p, conn, { t: 'astart', kind: 'shift', site: mine.id, job: 'miner' });
    h.game.disconnect(conn);
    later(h, 12 * HOUR);
    h.tick(1);
    expect(h.game.players.byCharId(p.charId)).toBeUndefined(); // worker removed
    later(h, HOUR);
    const conn2 = new FakeConn();
    const p2 = h.game.connect(conn2, user)!;
    h.tick(2);
    expect(p2.save.activity).toBeNull();
    const texts = conn2.of('note').map((n) => n.text);
    expect(texts.some((t) => /While you were away \(8h 0m of work\)/.test(t))).toBe(true);
    expect(texts.some((t) => /8-hour limit/.test(t))).toBe(true);
    expect(p2.save.inventory.some((s) => s.id === 'ore_iron')).toBe(true);
    // the report is shown once
    h.game.disconnect(conn2);
    const conn3 = new FakeConn();
    h.game.connect(conn3, user);
    h.tick(2);
    expect(conn3.of('note').some((n) => /While you were away/.test(n.text))).toBe(false);
    expect(OFFLINE_CAP_MS).toBe(8 * HOUR);
    h.close();
  });

  it('is safe against clock skew', () => {
    const { h, p, conn, api } = setup();
    const farm = findSite(h, 'farm');
    goto(h, p, farm);
    start(h, p, conn, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    p.save.activity!.since += 5 * HOUR;
    p.save.activity!.settled += 5 * HOUR;
    const snap = JSON.stringify(p.save);
    api.settle(p);
    expect(JSON.stringify(p.save)).toBe(snap);
    h.close();
  });
});
