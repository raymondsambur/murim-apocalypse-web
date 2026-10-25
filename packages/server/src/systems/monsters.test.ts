import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONSTERS, dist, levelForDanger, nearestWalkable, type SpawnPointDef } from '@murim/shared';
import type { Entity } from '../ctx';
import { getCombatApi } from './combat/api';
import { makeScene, nearSpot, powerUp, tickUntil, type Scene } from './combat/testing';
import type { MonsterKilledEvent } from './events';
import { MONSTER, MONSTER_TUNING, getMonsterApi } from './monsters';
import { getServices } from './services';

let sc: Scene | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  sc?.h.close();
  sc = null;
});

const scene = (population = false): Scene => (sc = makeScene({ population }));
const monstersOf = (s: Scene): Entity[] => s.h.game.entities.ofKind('monster');
const packOf = (s: Scene, id: number): Entity[] => monstersOf(s).filter((e) => MONSTER.get(e)?.spawnId === id);

describe('pack population', () => {
  it('fills the world from spawn points outside safe zones, with levels from the danger rating', () => {
    const s = scene(true);
    const { mon } = s;
    const all = monstersOf(s);
    expect(all.length).toBeGreaterThan(50);
    expect(mon.population()).toBe(all.length);
    const byId = new Map(s.h.world.spawnPoints.map((sp) => [sp.id, sp]));
    for (const e of all) {
      const st = MONSTER.get(e)!;
      expect(mon.isSafeZone(e.x, e.y)).toBe(false);
      expect(e.state).toBe('idle');
      expect(e.sprite).toBe(MONSTERS[st.defId].sprite);
      expect(e.lv).toBe(st.level);
      expect(e.hp).toBe(e.maxHp);
      const sp = byId.get(st.spawnId!)!;
      expect(MONSTERS[st.defId].family).toBe(sp.family);
      expect(dist(e.x, e.y, sp.x, sp.y)).toBeLessThanOrEqual(5);
      const base = Math.max(1, Math.min(48, Math.round(sp.danger * 1.55 - 1)));
      expect(st.level).toBeGreaterThanOrEqual(Math.max(1, base - 1));
      expect(st.level).toBeLessThanOrEqual(base + 1);
    }
    for (const sp of s.h.world.spawnPoints) {
      const n = packOf(s, sp.id).length;
      if (sp.family === 'blight') expect(n).toBe(0); // the stub sim has no Blight there: dormant
      else expect(n).toBeLessThanOrEqual(sp.packSize);
    }
    expect(all.filter((e) => e.elite).length).toBeLessThan(all.length / 2);
  });

  it('blight packs live only while the Blight is high, and get a level bonus', () => {
    const s = scene(true);
    const { h, mon } = s;
    const sp = h.world.spawnPoints.find((p) => p.family === 'blight')!;
    expect(packOf(s, sp.id)).toHaveLength(0);
    h.game.sim.state.blight[sp.y * h.world.w + sp.x] = 200;
    mon.checkPacks();
    const pack = packOf(s, sp.id);
    expect(pack.length).toBeGreaterThan(0);
    const base = levelForDanger(sp.danger, { int: () => 0 } as never);
    for (const e of pack) expect(MONSTER.get(e)!.level).toBeGreaterThanOrEqual(base - 1 + 5);
    h.game.sim.state.blight[sp.y * h.world.w + sp.x] = 0;
    mon.checkPacks();
    expect(packOf(s, sp.id)).toHaveLength(0);
  });

  it('respawns a wiped pack after its delay, but only when no player is near', () => {
    const s = scene(true);
    const { h, mon } = s;
    const sp = h.world.spawnPoints.find((p) => p.family === 'beast' && packOf(s, p.id).length > 0)!;
    const first = packOf(s, sp.id);
    const size = first.length;
    for (const e of first) mon.kill(e, []);
    h.tick(35);
    expect(first.every((e) => e.hidden)).toBe(true);
    const delayMs = Math.min(300, 60 + sp.danger * 8) * 1000;

    h.clock.advance(delayMs - 5000);
    mon.checkPacks();
    expect(packOf(s, sp.id).filter((e) => !e.hidden && e.state !== 'dead')).toHaveLength(0);

    // A player standing at the spawn point blocks the respawn.
    const { p } = h.join('Camper', nearestWalkable(h.game.grid, sp.x, sp.y, 4)!);
    h.clock.advance(10_000);
    mon.checkPacks();
    expect(packOf(s, sp.id).filter((e) => !e.hidden && e.state !== 'dead')).toHaveLength(0);

    h.game.movement.teleport(p.entity, h.world.settlements[0].spawn.x, h.world.settlements[0].spawn.y);
    mon.checkPacks();
    const again = packOf(s, sp.id).filter((e) => !e.hidden && e.state !== 'dead');
    expect(again).toHaveLength(size);
    expect(again.every((e) => !first.includes(e))).toBe(true);
    expect(first.every((e) => !h.game.entities.has(e.id))).toBe(true);
  });
});

describe('AI', () => {
  it('a monster notices a player in range, chases and starts the fight', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Bait', spot);
    powerUp(ctx, p, 15, 30);
    h.tick(2);
    const boar = mon.spawn({ defId: 'boar', level: 2, x: spot.x + 3, y: spot.y })!;
    expect(tickUntil(h, () => p.combatId !== null, 100)).toBeLessThan(100);
    expect(boar.combatId).toBe(p.combatId);
    expect(boar.state).toBe('fight');
    expect(conn.of('combat')[0].c.fighters).toHaveLength(2);
  });

  it('respects aggro radius, fog, night and safe zones', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Walker', spot);
    powerUp(ctx, p, 15, 30);
    const boar = mon.spawn({ defId: 'boar', level: 2, x: nearSpot(s, 4, 0).x, y: nearSpot(s, 4, 0).y })!; // aggro 3
    h.tick(2);
    const d = dist(boar.x, boar.y, p.entity.x, p.entity.y);
    expect(d).toBeGreaterThan(3.6);
    h.tick(30);
    expect(conn.of('combat')).toHaveLength(0);
    expect(mon.stateOf(boar)!.mode).toBe('idle');

    // Night makes beasts 20% sharper (3.6 tiles): still out of reach at 4+, so move the boar in to ~3.4.
    const near = mon.spawn({ defId: 'boar', level: 2, x: spot.x + 3, y: spot.y + 1 })!;
    const dn = dist(near.x, near.y, p.entity.x, p.entity.y);
    expect(dn).toBeGreaterThan(3);
    expect(dn).toBeLessThanOrEqual(3.6);
    mon.despawn(boar);
    h.tick(30);
    expect(conn.of('combat')).toHaveLength(0);
    h.game.sim.state.clock.totalHours = 16; // hour 22
    tickUntil(h, () => conn.of('combat').length > 0, 80);
    expect(conn.of('combat').length).toBeGreaterThan(0);
  });

  it('fog halves the radius; players in safe zones, busy players and offline workers are left alone', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Foggy', spot);
    powerUp(ctx, p, 15, 30);
    for (const w of h.game.sim.state.weather) w.kind = 'fog';
    mon.spawn({ defId: 'boar', level: 2, x: spot.x + 2, y: spot.y });
    h.tick(2);
    h.tick(30);
    expect(conn.of('combat')).toHaveLength(0); // radius 1.5 in fog
    for (const w of h.game.sim.state.weather) w.kind = 'clear';
    h.tick(30);
    expect(conn.of('combat').length).toBeGreaterThan(0);

    // Safe zone: the player stands in town while a wolf (aggro 5) is right next to them.
    const t = h.join('Townie');
    ctx.markMe(t.p);
    mon.spawn({ defId: 'wolf', level: 3, x: t.p.entity.x + 2, y: t.p.entity.y });
    h.tick(30);
    expect(t.p.combatId).toBeNull();

    // A player in the middle of an activity is not an aggro target.
    const w = h.join('Worker', nearSpot(s, -10, 4));
    w.p.save.activity = { kind: 'train', since: 0, settled: 0, site: 'x' };
    mon.spawn({ defId: 'wolf', level: 3, x: w.p.entity.x + 2, y: w.p.entity.y });
    h.tick(30);
    expect(w.p.combatId).toBeNull();
  });

  it('gives up when the target escapes, walks home and heals', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p } = h.join('Kite', spot);
    powerUp(ctx, p, 15, 30);
    h.tick(2);
    const thug = mon.spawn({ defId: 'thug', level: 4, x: spot.x + 4, y: spot.y })!;
    const home = { x: thug.x, y: thug.y };
    thug.hp = Math.floor(thug.maxHp! / 2);
    h.tick(4);
    expect(mon.stateOf(thug)!.mode).toBe('chase');
    const town = h.world.settlements[0];
    h.game.movement.teleport(p.entity, town.spawn.x, town.spawn.y);
    expect(tickUntil(h, () => mon.stateOf(thug)!.mode === 'idle', 600)).toBeLessThan(600);
    expect([thug.x, thug.y]).toEqual([home.x, home.y]);
    expect(thug.hp).toBe(thug.maxHp);
    expect(p.combatId).toBeNull();
  });

  it('walks a survivor home after it wins a fight', () => {
    const s = scene();
    const { h, spot, mon } = s;
    const { p } = h.join('Weakling', spot);
    h.tick(2);
    const bear = mon.spawn({ defId: 'bear', level: 22, x: nearSpot(s, 5, 0).x, y: nearSpot(s, 5, 0).y })!;
    const home = { x: bear.x, y: bear.y };
    h.tick(2);
    h.say(p, { t: 'interact', id: bear.id });
    expect(tickUntil(h, () => p.entity.state === 'dead', 600)).toBeLessThan(600);
    expect(tickUntil(h, () => mon.stateOf(bear)!.mode === 'idle' && !bear.move, 600)).toBeLessThan(600);
    expect(dist(bear.x, bear.y, home.x, home.y)).toBeLessThan(2);
    expect(bear.hp).toBe(bear.maxHp);
  });
});

describe('sieges', () => {
  function besiege(s: Scene, id: number, by: string | null, strength: number): void {
    const st = s.h.game.sim.state.settlements[id];
    st.siegeUntil = s.h.game.sim.clock().totalHours + 12;
    st.siegeStrength = strength;
    st.siegeBy = by;
  }

  it('spawns a strength-scaled wave on a siege event and removes it when the siege ends', () => {
    const s = scene();
    const { h, mon } = s;
    expect(monstersOf(s)).toHaveLength(0);
    besiege(s, 0, 'blight', 40);
    h.game.fanOut([{ k: 'siege', settlementId: 0, start: true }], h.clock.t);
    const wave = monstersOf(s);
    expect(wave).toHaveLength(8);
    const town = h.world.settlements[0];
    for (const e of wave) {
      const st = MONSTER.get(e)!;
      expect(st.siege).toBe(0);
      expect(MONSTERS[st.defId].family).toBe('blight');
      const d = dist(e.x, e.y, town.x, town.y);
      expect(d).toBeGreaterThanOrEqual(town.radius + 7);
      expect(d).toBeLessThanOrEqual(town.radius + 15);
    }
    // Killed members are topped up over the next cycles while the siege lasts.
    for (const e of wave.slice(0, 5)) mon.kill(e, []);
    h.tick(35);
    expect(monstersOf(s).filter((e) => e.state !== 'dead')).toHaveLength(3);
    h.clock.advance(MONSTER_TUNING.siegeCycleMs);
    h.tick(2);
    expect(monstersOf(s).filter((e) => e.state !== 'dead')).toHaveLength(6);

    const st = h.game.sim.state.settlements[0];
    st.siegeUntil = 0;
    st.siegeStrength = 0;
    h.game.fanOut([{ k: 'siege', settlementId: 0, start: false }], h.clock.t);
    expect(monstersOf(s)).toHaveLength(0);
  });

  it('raids by a faction bring bandits, and a siege that is already on at boot is reconciled', () => {
    const s = scene();
    besiege(s, 4, 'blackwind', 30);
    getMonsterApi(s.ctx)!.checkSieges();
    const wave = monstersOf(s);
    expect(wave.length).toBe(6);
    expect(wave.every((e) => MONSTERS[MONSTER.get(e)!.defId].family === 'bandit')).toBe(true);
    expect(wave.every((e) => MONSTER.get(e)!.siege === 4)).toBe(true);
  });

  it('siege monsters that are fighting when the siege ends vanish after the fight', () => {
    const s = scene();
    const { h, ctx, mon } = s;
    besiege(s, 0, 'blight', 20);
    mon.checkSieges();
    const m = monstersOf(s)[0];
    const { p } = h.join('Defender', nearestWalkable(h.game.grid, m.x, m.y, 4)!);
    powerUp(ctx, p, 30, 50);
    h.tick(2);
    const events: MonsterKilledEvent[] = [];
    ctx.events.on('monsterKilled', (ev) => void events.push(ev));
    h.say(p, { t: 'interact', id: m.id });
    h.tick(3);
    expect(m.combatId).toBeDefined();
    const st = h.game.sim.state.settlements[0];
    st.siegeUntil = 0;
    mon.checkSieges();
    expect(monstersOf(s).filter((e) => e.combatId === undefined)).toHaveLength(0);
    tickUntil(h, () => p.combatId === null, 1500);
    h.tick(40);
    expect(monstersOf(s)).toHaveLength(0);
    for (const ev of events) expect(ev.siege).toBe(0);
  });
});

describe('Blight heart bosses', () => {
  function heartScene(): { s: Scene; node: Entity; heartId: number } {
    const s = scene();
    const heart = s.h.game.sim.state.hearts[0];
    const node = s.h.game.entities.create({ kind: 'node', nodeKind: 'heart', name: 'Blight Heart', x: heart.x, y: heart.y });
    return { s, node, heartId: heart.id };
  }

  it('interacting with an active heart summons the Blight Lord and starts the boss fight', () => {
    const { s, node, heartId } = heartScene();
    const { h, ctx, mon } = s;
    const heart = h.game.sim.state.hearts[0];
    const { p, conn } = h.join('Slayer', nearestWalkable(h.game.grid, node.x + 1, node.y, 4)!);
    powerUp(ctx, p, 36, 60);
    h.tick(2);
    h.say(p, { t: 'interact', id: node.id });
    h.tick(3);
    const boss = monstersOf(s).find((e) => MONSTER.get(e)?.heartId === heartId)!;
    expect(boss).toBeDefined();
    expect(boss.name).toBe(MONSTERS.lord.name);
    expect(boss.elite).toBe(2);
    expect(boss.lv).toBe(30 + Math.floor(heart.strength / 5));
    expect(p.combatId).not.toBeNull();
    expect(boss.combatId).toBe(p.combatId);
    expect(conn.of('note').some((n) => n.text.includes('Blight Lord'))).toBe(true);
    void mon;
  });

  it('refuses sealed hearts, and a defeated Lord damages the heart and rests for a while', () => {
    const { s, node, heartId } = heartScene();
    const { h, ctx, mon } = s;
    const heart = h.game.sim.state.hearts[0];
    const dmg = vi.spyOn(h.game.sim, 'damageHeart').mockReturnValue([]);
    const { p, conn } = h.join('Sealer', nearestWalkable(h.game.grid, node.x + 1, node.y, 4)!);
    powerUp(ctx, p, 36, 60);
    h.tick(2);

    heart.sealedUntil = h.game.sim.clock().totalHours + 100;
    h.say(p, { t: 'interact', id: node.id });
    h.tick(2);
    expect(conn.last('note')!.text).toContain('sealed');
    expect(p.combatId).toBeNull();
    heart.sealedUntil = 0;

    // A wounded Lord (as if the party had worn it down) dies in the fight.
    const lord = mon.spawn({ defId: 'lord', level: 30, x: p.entity.x + 1, y: p.entity.y, heartId })!;
    lord.hp = 1;
    const killed: MonsterKilledEvent[] = [];
    ctx.events.on('monsterKilled', (ev) => void killed.push(ev));
    h.tick(2);
    h.say(p, { t: 'interact', id: lord.id });
    expect(tickUntil(h, () => conn.last('cend') !== undefined, 400)).toBeLessThan(400);
    expect(conn.last('cend')!.result).toBe('win');
    expect(dmg).toHaveBeenCalledWith(heartId, 60, 'Sealer');
    expect(killed[0]).toMatchObject({ heartId, defId: 'lord', elite: 2 });

    // The heart needs time to regrow its guardian.
    h.say(p, { t: 'interact', id: node.id });
    h.tick(2);
    expect(conn.last('note')!.text).toContain('Return later');
    h.clock.advance(MONSTER_TUNING.heartBossCooldownMs + 1000);
    h.say(p, { t: 'interact', id: node.id });
    h.tick(2);
    expect(monstersOf(s).some((e) => MONSTER.get(e)?.heartId === heartId && e.state !== 'dead')).toBe(true);
  });
});

describe('bounty targets (monsters service)', () => {
  it('spawns a personal elite 15-30 tiles from the settlement and removes it on request or expiry', () => {
    const s = scene();
    const { h, ctx, mon } = s;
    const svc = getServices(ctx).monsters!;
    const { p } = h.join('Bounty');
    const town = h.world.settlements[0];
    const e = svc.spawnBounty(p, 'chief', 8, 1, 0)!;
    expect(e).toBeTruthy();
    const st = MONSTER.get(e)!;
    expect(st.bountyFor).toBe(p.charId);
    expect(st.level).toBe(8);
    expect(e.elite).toBe(1);
    const d = dist(e.x, e.y, town.x, town.y);
    expect(d).toBeGreaterThanOrEqual(14);
    expect(d).toBeLessThanOrEqual(31);
    expect(mon.isSafeZone(e.x, e.y)).toBe(false);

    // A new bounty for the same owner replaces the old one.
    const e2 = svc.spawnBounty(p, 'thug', 5, 2, 0)!;
    expect(h.game.entities.has(e.id)).toBe(false);
    expect(e2.elite).toBe(2);
    expect(e2.maxHp!).toBeGreaterThan(monsterHp('thug', 5));
    svc.removeBounty(p.charId);
    expect(h.game.entities.has(e2.id)).toBe(false);

    // Unknown definitions and settlements are refused.
    expect(svc.spawnBounty(p, 'nope', 5, 1, 0)).toBeNull();
    expect(svc.spawnBounty(p, 'thug', 5, 1, 99)).toBeNull();

    // Expires after 30 minutes.
    const e3 = svc.spawnBounty(p, 'chief', 8, 1, 0)!;
    h.clock.advance(MONSTER_TUNING.bountyLifeMs + 1000);
    h.tick(60);
    expect(h.game.entities.has(e3.id)).toBe(false);
  });

  it('only its owner is hunted by, and can fight, the target; the kill reports bountyFor', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const owner = h.join('Owner', nearSpot(s, 14, 0));
    const rival = h.join('Rival', nearSpot(s, -3, 3));
    powerUp(ctx, owner.p, 40, 60);
    powerUp(ctx, rival.p, 40, 60);
    const target = mon.spawn({ defId: 'chief', level: 5, x: spot.x + 2, y: spot.y, bountyFor: owner.p.charId, elite: 1 })!;
    h.tick(2);
    // The rival stands right next to it: not hunted, and refused when they try to engage.
    h.say(rival.p, { t: 'interact', id: target.id });
    h.tick(40);
    expect(rival.p.combatId).toBeNull();
    expect(rival.conn.of('combat')).toHaveLength(0);
    expect(rival.conn.last('note')!.text).toContain('hunted');
    // The owner walks up and takes it on.
    const killed: MonsterKilledEvent[] = [];
    ctx.events.on('monsterKilled', (ev) => void killed.push(ev));
    h.say(owner.p, { t: 'interact', id: target.id });
    expect(tickUntil(h, () => owner.conn.last('cend') !== undefined, 2500)).toBeLessThan(2500);
    expect(owner.conn.last('cend')!.result).toBe('win');
    expect(killed).toHaveLength(1);
    expect(killed[0].bountyFor).toBe(owner.p.charId);
    expect(killed[0].elite).toBe(1);
    expect(killed[0].killers).toEqual([owner.p]);
  });
});

function monsterHp(def: string, level: number): number {
  return Math.round(MONSTERS[def].hp * 3.2 * (1 + 0.18 * (level - 1)));
}

describe('bounded work', () => {
  it('only thinks about monsters near players and caps path-finding per think', () => {
    const s = scene();
    const { h, ctx, mon } = s;
    const sp: SpawnPointDef = h.world.spawnPoints[0];
    const far = { x: 8, y: 8 };
    for (let i = 0; i < 1500; i++) mon.spawn({ defId: 'boar', level: 1, x: far.x + (i % 30), y: far.y + Math.floor(i / 30) });
    expect(mon.population()).toBe(1500);
    const { p } = h.join('Watcher', nearestWalkable(h.game.grid, sp.x, sp.y, 6)!);
    h.tick(2);
    const here = nearSpot(s, 0, 0);
    for (let i = 0; i < 60; i++) mon.spawn({ defId: 'boar', level: 1, x: here.x + 8 + (i % 8), y: here.y + 8 + Math.floor(i / 8), wanderRadius: 3 });
    mon.think();
    expect(mon.lastThinkCount()).toBeLessThanOrEqual(61);
    expect(mon.lastThinkCount()).toBeGreaterThan(0);
    expect(mon.lastThinkCount()).toBeLessThan(200);

    // Even if every monster wanted to wander, only a handful start walking per think.
    vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    const before = monstersOf(s).filter((e) => e.move).length;
    mon.think();
    const started = monstersOf(s).filter((e) => e.move).length - before;
    expect(started).toBeLessThanOrEqual(MONSTER_TUNING.maxWandersPerThink);
    void p;
    void getCombatApi;
  });
});
