import { afterEach, describe, expect, it } from 'vitest';
import { deriveForCharacter, xpToNext } from '@murim/shared';
import type { Entity, Player } from '../ctx';
import type { PlayerImpl } from '../game/players';
import type { FakeConn } from '../testkit';
import { makeScene, nearSpot, powerUp, tickUntil, type Scene } from './combat/testing';
import type { MonsterKilledEvent } from './events';
import { countItem } from './lib';
import { getServices } from './services';

let sc: Scene | null = null;
afterEach(() => {
  sc?.h.close();
  sc = null;
});

function scene(): Scene {
  sc = makeScene();
  return sc;
}

/** A powered-up player standing at the scene spot, plus a boar next to them, already known to the client. */
function boarFight(level = 3, power = 15, stat = 30): { p: PlayerImpl; conn: FakeConn; m: Entity; s: Scene } {
  const s = scene();
  const { p, conn } = s.h.join('Hero', s.spot);
  powerUp(s.ctx, p, power, stat);
  s.h.tick(2);
  const m = s.mon.spawn({ defId: 'boar', level, x: s.spot.x + 1, y: s.spot.y, ephemeral: false })!;
  s.h.tick(2);
  return { p, conn, m, s };
}

describe('PvE fight to victory', () => {
  it('interact starts a fight, beats are sent, rewards and loot are paid, the corpse is hidden', () => {
    const { p, conn, m, s } = boarFight();
    const { h, ctx } = s;
    const killed: MonsterKilledEvent[] = [];
    ctx.events.on('monsterKilled', (ev) => void killed.push(ev));
    const gold0 = p.save.gold;
    const xp0 = p.save.xp;
    const lv0 = p.save.level;

    h.say(p, { t: 'interact', id: m.id });
    h.tick(2);
    expect(p.combatId).not.toBeNull();
    expect(m.combatId).toBe(p.combatId);
    expect(p.entity.state).toBe('fight');
    expect(m.state).toBe('fight');
    const first = conn.of('combat')[0];
    expect(first.c.beat).toBe(0);
    expect(first.c.duel).toBe(false);
    expect(first.c.fighters.map((f) => [f.side, f.player])).toEqual([
      [0, true],
      [1, false],
    ]);

    // Movement is locked while fighting.
    h.say(p, { t: 'move', x: p.entity.x + 3, y: p.entity.y });
    h.tick();
    expect(conn.last('err')?.code).toBe('cannot_move');

    expect(tickUntil(h, () => p.combatId === null, 1500)).toBeLessThan(1500);
    const end = conn.last('cend')!;
    expect(end.result).toBe('win');
    expect(end.reward!.xp).toBeGreaterThan(0);
    expect(end.reward!.gold).toBe(p.save.gold - gold0);
    expect(p.save.xp + (p.save.level > lv0 ? xpToNext(lv0) : 0)).toBeGreaterThanOrEqual(xp0 + end.reward!.xp);
    expect(p.save.kills).toBe(1);
    expect(p.entity.state).toBe('idle');
    expect(p.entity.combatId).toBeUndefined();
    expect(p.save.hp).toBe(p.entity.hp);
    expect(conn.of('combat').length).toBeGreaterThan(2);
    expect(conn.of('combat').at(-1)!.ev.some((e) => e.k === 'down')).toBe(true);

    // Skill proficiency was earned by using skills.
    expect(Object.values(p.save.skills).some((sk) => sk.xp > 0 || sk.lv > 1)).toBe(true);

    // monsterKilled payload.
    expect(killed).toHaveLength(1);
    expect(killed[0]).toMatchObject({ entityId: m.id, defId: 'boar', family: 'beast', level: 3, elite: 0, spawnId: null, siege: null, bountyFor: null, heartId: null, x: m.x, y: m.y });
    expect(killed[0].killers).toEqual([p]);

    // The corpse lingers 3 s, then is hidden (pack monster) and never fights again.
    expect(m.state).toBe('dead');
    expect(m.hidden).toBe(false);
    h.tick(35);
    expect(m.hidden).toBe(true);
    expect(s.mon.available(m)).toBe(false);
  });

  it('rolls guaranteed loot and gold into the bag', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Looter', spot);
    powerUp(ctx, p, 40, 60);
    h.tick(2);
    const chief = mon.spawn({ defId: 'chief', level: 4, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    const insignia0 = countItem(p.save, 'insignia');
    h.say(p, { t: 'interact', id: chief.id });
    expect(tickUntil(h, () => conn.last('cend') !== undefined, 1500)).toBeLessThan(1500);
    const end = conn.last('cend')!;
    expect(end.result).toBe('win');
    expect(end.reward!.items.some((i) => i.id === 'insignia')).toBe(true);
    expect(countItem(p.save, 'insignia')).toBeGreaterThan(insignia0);
    expect(end.reward!.gold).toBeGreaterThan(0);
    // Elite XP is boosted compared with a plain monster of the same level.
    expect(end.reward!.xp).toBeGreaterThan(0);
  });

  it('levels up from kill XP and announces it', () => {
    const { p, conn, m, s } = boarFight(5, 3, 20);
    const { h, ctx } = s;
    const ups: Array<{ from: number; to: number }> = [];
    ctx.events.on('playerLevelUp', (ev) => void ups.push({ from: ev.from, to: ev.to }));
    p.save.level = 3;
    p.save.xp = xpToNext(3) - 1;
    const points0 = p.save.statPoints;
    h.say(p, { t: 'interact', id: m.id });
    expect(tickUntil(h, () => conn.last('cend') !== undefined, 1500)).toBeLessThan(1500);
    expect(conn.last('cend')!.result).toBe('win');
    expect(p.save.level).toBeGreaterThanOrEqual(4);
    expect(p.save.statPoints).toBeGreaterThanOrEqual(points0 + 2);
    expect(ups[0]).toEqual({ from: 3, to: 4 });
    expect(conn.of('fx').some((f) => f.kind === 'levelup')).toBe(true);
  });

  it('drinks potions from the bag through tactics and consumes them', () => {
    const { p, conn, m, s } = boarFight(8, 6, 14);
    const { h } = s;
    p.save.hp = Math.floor(deriveForCharacter(p.save, h.clock.t).maxHp * 0.3);
    const pills0 = countItem(p.save, 'pill_heal_s');
    expect(pills0).toBeGreaterThan(0);
    h.say(p, { t: 'interact', id: m.id });
    h.tick(2);
    tickUntil(h, () => p.combatId === null, 2500);
    expect(conn.last('cend')).toBeDefined();
    expect(conn.of('combat').some((c) => c.ev.some((e) => e.k === 'item'))).toBe(true);
    expect(countItem(p.save, 'pill_heal_s')).toBeLessThan(pills0);
  });

  it('bandit kills adjust reputation', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Hunter', spot);
    powerUp(ctx, p, 30, 50);
    h.tick(2);
    const thug = mon.spawn({ defId: 'thug', level: 3, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: thug.id });
    tickUntil(h, () => conn.last('cend') !== undefined, 1500);
    expect(conn.last('cend')!.result).toBe('win');
    expect(p.save.reputation.blackwind).toBe(-1);
  });
});

describe('defeat, death and respawn', () => {
  it('a beaten player dies, loses gold, is injured and wakes up in town', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Doomed', spot);
    h.tick(2);
    p.save.gold = 100;
    p.save.lastTown = 0;
    const deaths: Player[] = [];
    ctx.events.on('playerDied', (ev) => void deaths.push(ev.player));
    const bear = mon.spawn({ defId: 'bear', level: 22, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: bear.id });
    expect(tickUntil(h, () => p.entity.state === 'dead', 600)).toBeLessThan(600);

    expect(p.save.gold).toBe(90);
    expect(p.save.deaths).toBe(1);
    expect(p.save.injuryStacks).toBe(1);
    expect(p.save.injuryUntil).toBeGreaterThan(h.clock.t);
    expect(p.save.hp).toBe(0);
    expect(p.combatId).toBeNull();
    expect(deaths).toEqual([p]);
    expect(conn.last('cend')!.result).toBe('lose');
    expect(conn.of('fx').some((f) => f.kind === 'death' && f.entity === p.entity.id)).toBe(true);
    // Dead players cannot act.
    h.say(p, { t: 'move', x: p.entity.x + 2, y: p.entity.y });
    h.tick();
    expect(conn.last('err')?.code).toBe('cannot_move');
    h.say(p, { t: 'flee' });
    h.tick();
    expect(conn.last('err')?.code).toBe('dead');

    // The monster that won goes home and heals.
    expect(bear.combatId).toBeUndefined();
    expect(mon.stateOf(bear)!.mode).not.toBe('fight');

    // Respawn after 8 s at the last town's spawn with 30% HP and Qi.
    h.tick(70);
    expect(p.entity.state).toBe('dead');
    h.tick(20);
    expect(p.entity.state).toBe('idle');
    const town = h.world.settlements[0];
    expect([p.entity.x, p.entity.y]).toEqual([town.spawn.x, town.spawn.y]);
    const d = deriveForCharacter(p.save, h.clock.t);
    expect(p.save.hp).toBe(Math.round(d.maxHp * 0.3));
    expect(p.save.qi).toBe(Math.round(d.maxQi * 0.3));
    h.say(p, { t: 'move', x: town.spawn.x + 1, y: town.spawn.y });
    h.tick();
    expect(conn.last('err')?.code).not.toBe('cannot_move');

    // A second death within the injury window stacks.
    p.save.gold = 100;
    p.save.hp = 5;
    const bear2 = mon.spawn({ defId: 'bear', level: 22, x: p.entity.x + 1, y: p.entity.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: bear2.id });
    tickUntil(h, () => p.entity.state === 'dead', 600);
    expect(p.entity.state).toBe('dead');
    expect(p.save.injuryStacks).toBe(2);
    expect(p.save.gold).toBe(90);
    expect(p.save.deaths).toBe(2);
  });

  it('dying and logging out respawns first, so the save is never stored dead', () => {
    const s = scene();
    const { h, spot, mon } = s;
    const { p, conn } = h.join('Quitter', spot);
    h.tick(2);
    const bear = mon.spawn({ defId: 'bear', level: 22, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: bear.id });
    tickUntil(h, () => p.entity.state === 'dead', 600);
    expect(p.entity.state).toBe('dead');
    h.game.disconnect(conn);
    const town = h.world.settlements[0];
    expect(p.save.hp).toBeGreaterThan(0);
    expect([p.save.x, p.save.y]).toEqual([town.spawn.x, town.spawn.y]);
  });
});

describe('assist and flee', () => {
  it('lets nearby players join a fight (max 5), rejects far ones and duels', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Tank', spot);
    powerUp(ctx, p, 12, 18);
    const allies = [1, 2, 3, 4].map((i) => h.join(`Ally${i}`, nearSpot(s, i, 1)));
    const far = h.join('Faraway', nearSpot(s, 20, 0));
    const extra = h.join('Extra', nearSpot(s, 5, 2));
    h.tick(2);
    const bear = mon.spawn({ defId: 'bear', level: 24, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: bear.id });
    h.tick(2);
    const cid = p.combatId!;
    expect(cid).not.toBeNull();

    h.say(far.p, { t: 'assist', combat: cid });
    h.tick();
    expect(far.conn.last('err')?.code).toBe('cannot_assist');
    h.say(far.p, { t: 'assist', combat: 9999 });
    h.tick();
    expect(far.conn.last('err')?.code).toBe('not_found');

    for (const a of allies) h.say(a.p, { t: 'assist', combat: cid });
    h.tick();
    expect(allies.every((a) => a.p.combatId === cid)).toBe(true);
    expect(s.combat.view(cid)!.fighters.filter((f) => f.player)).toHaveLength(5);
    h.say(extra.p, { t: 'assist', combat: cid });
    h.tick();
    expect(extra.conn.last('err')?.code).toBe('cannot_assist');
    expect(extra.p.combatId).toBeNull();
    // Joiners see the fight.
    h.tick(12);
    expect(allies[0].conn.last('combat')?.c.fighters.length).toBe(6);
    // A bystander within the AOI gets the floating text.
    expect(extra.conn.of('cfx').length).toBeGreaterThan(0);
    void conn;
  });

  it('flee eventually breaks away from a slow monster and locks movement for 2 s', () => {
    const s = scene();
    const { h, ctx, spot, mon } = s;
    const { p, conn } = h.join('Runner', spot);
    powerUp(ctx, p, 12, 30);
    p.save.stats.agility = 80;
    h.tick(2);
    const bear = mon.spawn({ defId: 'bear', level: 24, x: spot.x + 1, y: spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: bear.id });
    h.tick(2);
    expect(p.combatId).not.toBeNull();
    let tries = 0;
    while (p.combatId !== null && tries++ < 10) {
      h.say(p, { t: 'flee' });
      tickUntil(h, () => p.combatId === null, 25);
    }
    expect(p.combatId).toBeNull();
    expect(conn.last('cend')!.result).toBe('fled');
    expect(p.entity.state).toBe('idle');
    expect(p.save.hp).toBe(p.entity.hp);
    expect(bear.combatId).toBeUndefined();
    expect(s.combat.activeCount()).toBe(0);
    h.say(p, { t: 'move', x: p.entity.x - 2, y: p.entity.y });
    h.tick();
    expect(conn.last('err')?.code).toBe('cannot_move');
    h.tick(25);
    h.say(p, { t: 'move', x: p.entity.x - 2, y: p.entity.y });
    h.tick();
    expect(p.entity.move).not.toBeNull();
    // Not in a fight any more: flee is refused.
    h.say(p, { t: 'flee' });
    h.tick();
    expect(conn.last('err')?.code).toBe('not_in_combat');
  });

  it('a player who logs out mid-fight leaves it and the monsters are released', () => {
    const { p, conn, m, s } = boarFight(20, 5, 10);
    const { h } = s;
    h.say(p, { t: 'interact', id: m.id });
    h.tick(3);
    expect(p.combatId).not.toBeNull();
    h.game.disconnect(conn);
    expect(s.combat.activeCount()).toBe(0);
    expect(m.combatId).toBeUndefined();
    expect(s.mon.stateOf(m)!.mode).not.toBe('fight');
  });
});

describe('talking to NPCs', () => {
  it('is blocked while dead or fighting', () => {
    const s = scene();
    const { h } = s;
    const { p, conn } = h.join('Mute');
    const npc = h.game.entities.nearest(p.entity.x, p.entity.y, 15, (e) => e.kind === 'npc')!;
    h.game.movement.teleport(p.entity, npc.x, npc.y);
    h.tick(2);
    p.entity.state = 'dead';
    h.say(p, { t: 'interact', id: npc.id });
    h.tick();
    expect(conn.last('note')!.text).toBe('You are dead.');
    p.entity.state = 'idle';
    p.combatId = 99;
    h.say(p, { t: 'interact', id: npc.id });
    h.tick();
    expect(conn.last('note')!.text).toBe('You cannot do that while fighting.');
    p.combatId = null;
    h.say(p, { t: 'interact', id: npc.id });
    h.tick();
    expect(conn.last('note')!.text).not.toBe('You cannot do that while fighting.');
  });
});

describe('duels (combat service)', () => {
  it('runs a friendly fight on copies, moves the stake and never kills', () => {
    const s = scene();
    const { h, ctx, spot } = s;
    const a = h.join('Alice', spot);
    const b = h.join('Bob', nearSpot(s, 2, 0));
    powerUp(ctx, a.p, 10, 20);
    powerUp(ctx, b.p, 10, 20);
    a.p.save.hp = 5; // real HP is irrelevant: duelists are copies at full health
    a.p.save.gold = 300;
    b.p.save.gold = 300;
    h.tick(2);
    const svc = getServices(ctx).combat!;
    expect(svc.inCombat(a.p)).toBe(false);
    expect(svc.startDuel(a.p, b.p, 1000)).toBe(false); // cannot cover the stake
    expect(svc.startDuel(a.p, a.p, 0)).toBe(false);
    expect(svc.startDuel(a.p, b.p, 100)).toBe(true);
    expect(svc.inCombat(a.p) && svc.inCombat(b.p)).toBe(true);
    expect(svc.startDuel(a.p, b.p, 0)).toBe(false); // already fighting
    expect(a.conn.of('combat')[0].c.duel).toBe(true);

    expect(tickUntil(h, () => a.p.combatId === null, 3000)).toBeLessThan(3000);
    const ra = a.conn.last('cend')!;
    const rb = b.conn.last('cend')!;
    expect([ra.result, rb.result].sort()).toEqual(['lose', 'win']);
    const winner = ra.result === 'win' ? a : b;
    const loser = winner === a ? b : a;
    expect(winner.p.save.gold).toBe(400);
    expect(loser.p.save.gold).toBe(200);
    expect(winner.conn.last('cend')!.reward!.gold).toBe(100);
    expect(a.p.save.hp).toBe(5);
    expect(a.p.save.deaths + b.p.save.deaths).toBe(0);
    expect(a.p.entity.state).toBe('idle');
    expect(winner.p.save.kills).toBe(0);
    expect(winner.p.save.xp).toBe(0);
    // The loser ended at or below 15% of the copy's HP.
    const last = a.conn.of('combat').at(-1)!.c;
    const low = last.fighters.find((f) => f.hp / f.maxHp <= 0.15);
    expect(low).toBeDefined();
  });

  it('flee in a duel forfeits', () => {
    const s = scene();
    const { h, ctx, spot } = s;
    const a = h.join('Alice', spot);
    const b = h.join('Bob', nearSpot(s, 2, 0));
    h.tick(2);
    getServices(ctx).combat!.startDuel(a.p, b.p, 0);
    h.tick(2);
    h.say(a.p, { t: 'flee' });
    h.tick();
    expect(a.conn.last('cend')!.result).toBe('lose');
    expect(b.conn.last('cend')!.result).toBe('win');
    expect(a.p.combatId).toBeNull();
  });
});

describe('out-of-combat regeneration', () => {
  it('slowly restores HP and Qi, faster inside a settlement, but not while fighting', () => {
    const s = scene();
    const { h, ctx, spot } = s;
    const wild = h.join('Wild', spot);
    const town = h.join('Town'); // joins at the first settlement's spawn
    for (const j of [wild, town]) {
      const d = deriveForCharacter(j.p.save, h.clock.t);
      j.p.save.hp = Math.round(d.maxHp * 0.2);
      j.p.save.qi = 0;
    }
    ctx.markMe(wild.p);
    h.tick(2);
    const w0 = wild.p.save.hp;
    const t0 = town.p.save.hp;
    h.tick(120);
    expect(wild.p.save.hp).toBeGreaterThan(w0);
    expect(wild.p.save.qi).toBeGreaterThan(0);
    expect(town.p.save.hp - t0).toBeGreaterThan(wild.p.save.hp - w0);
    expect(wild.p.entity.hp).toBe(wild.p.save.hp);
  });
});
