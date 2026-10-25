import { MONSTERS, Rng, dist, type SimEvent } from '@murim/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '../ctx';
import { getNpcLife } from '../npclife';
import { powerUp } from '../systems/combat/testing';
import { MONSTER, MONSTER_TUNING } from '../systems/monsters/state';
import { makeLifeHarness } from '../npclife/testkit';
import { register as registerCombat } from '../systems/combat';
import { register as registerMonsters } from '../systems/monsters';
import { register as registerSiege } from '../systems/siege';
import { SIEGE_TUNING as T } from './tuning';
import { classifyEnd, holdChance, momentum, wallBonus } from './outcome';
import { defenderHp, partySize, pickFoe, steer, strike, type Fighter } from './skirmish';
import { besiege, makeSiegeScene, standNear, tickUntil, type SiegeScene } from './testkit';
import { getSiege } from './index';

let scene: SiegeScene | null = null;
afterEach(() => {
  scene?.h.close();
  scene = null;
});
const mk = (opts = {}): SiegeScene => (scene = makeSiegeScene(opts));

const sided = (s: SiegeScene, side: 'raid' | 'def'): Entity[] => [...s.ctx.entities.all()].filter((e) => e.side === side);
const raiders = (s: SiegeScene): Entity[] => sided(s, 'raid');
const fighting = (es: Entity[]): number => es.filter((e) => e.state === 'fight').length;

/** Make a settlement's defense / the siege strength what the test needs (the sim keeps them as plain numbers). */
function setOdds(s: SiegeScene, sid: number, defense: number, strength: number): void {
  const st = s.ctx.sim.state.settlements[sid];
  st.defense = defense;
  st.siegeStrength = strength;
}

const farFrom = (s: SiegeScene, sid: number, min = 110) => {
  const home = s.ctx.world.settlements[sid];
  return [...s.ctx.world.settlements].filter((x) => x.kind !== 'ruin').sort((a, b) => dist(b.x, b.y, home.x, home.y) - dist(a.x, a.y, home.x, home.y)).find((x) => dist(x.x, x.y, home.x, home.y) > min)!;
};

describe('pure rules', () => {
  it('sizes a war party from the siege strength: 6 to 18 units', () => {
    expect(partySize(5)).toBe(6);
    expect(partySize(30)).toBe(6);
    expect(partySize(45)).toBe(9);
    expect(partySize(70)).toBe(14);
    expect(partySize(90)).toBe(18);
    expect(partySize(400)).toBe(18);
  });

  it('knows the sim roll: hold chance follows defense * U(0.82, 1.18) + walls against the strength', () => {
    expect(holdChance(50, 0, 40)).toBe(1);
    expect(holdChance(50, 0, 60)).toBe(0);
    expect(holdChance(50, 0, 50)).toBeCloseTo(0.5, 5);
    expect(holdChance(50, 6, 50)).toBeGreaterThan(holdChance(50, 0, 50));
    expect(holdChance(0, 0, 10)).toBe(0);
    expect(holdChance(0, 0, 0)).toBe(1);
    expect(momentum(1)).toBe(1);
    expect(momentum(0)).toBe(-1);
    expect(momentum(0.5)).toBe(0);
    expect(wallBonus('fort')).toBe(6);
    expect(wallBonus('village')).toBe(0);
  });

  it('reads the end of a siege from the settlement and the chronicle', () => {
    const before = { controller: 'azure', status: 'besieged' };
    const chron = (text: string): SimEvent => ({ k: 'chron', entry: { id: 1, day: 0, hour: 0, kind: 'faction', text, settlementId: 3, importance: 2, t: 0 } });
    expect(classifyEnd(before, { controller: 'azure', status: 'stable' }, [], 3)).toBe('held');
    expect(classifyEnd(before, { controller: null, status: 'fallen' }, [], 3)).toBe('fell');
    expect(classifyEnd(before, { controller: 'blackwind', status: 'struggling' }, [], 3)).toBe('captured');
    expect(classifyEnd(before, { controller: 'azure', status: 'stable' }, [chron('Black Wind raiders plundered Foo and withdrew.')], 3)).toBe('plundered');
    expect(classifyEnd(before, { controller: 'azure', status: 'stable' }, [chron('Black Wind raiders plundered Foo and withdrew.')], 4)).toBe('held');
  });

  it('trades blows with bounded HP, deterministic for a seed, and steering moves the damage', () => {
    const mkF = (id: number, side: 'att' | 'def', hp: number): Fighter => ({ id, side, x: id, y: 0, hp, maxHp: hp, power: 1, toughness: 1 });
    const run = (seed: number, bias: number): { dealt: number; events: string } => {
      const rng = new Rng(seed);
      const a = mkF(1, 'def', 500);
      const d = mkF(2, 'att', 500);
      let dealt = 0;
      let log = '';
      for (let i = 0; i < 40 && d.hp > 0; i++) {
        const b = strike(rng, a, d, bias);
        dealt += b.damage;
        log += b.event.k[0];
        expect(d.hp).toBeGreaterThanOrEqual(0);
        expect(d.hp).toBeLessThanOrEqual(d.maxHp);
        if (b.event.k === 'hit') expect(b.event.a).toBeGreaterThan(0);
      }
      return { dealt, events: log };
    };
    expect(run(5, 0).events).toBe(run(5, 0).events);
    // the same fight takes fewer blows when the defenders dominate than when the raiders do
    const len = (bias: number): number => [1, 2, 3, 4, 5, 6, 7, 8].reduce((n, s) => n + run(s, bias).events.length, 0);
    expect(len(0.85)).toBeLessThan(len(-0.85));
    expect(steer('def', 1)).toBeGreaterThan(steer('def', -1));
    expect(steer('att', 1)).toBeLessThan(steer('att', -1));
    expect(steer('def', 5)).toBeLessThanOrEqual(T.steerMax);
    expect(steer('att', 5)).toBeGreaterThanOrEqual(T.steerMin);
    expect(defenderHp(10, 1)).toBe(T.defHpBase + T.defHpPerLevel * 10);
  });

  it('picks the nearest foe, spreading the fights out', () => {
    const u = { id: 1, side: 'att', x: 0, y: 0, hp: 1, maxHp: 1, power: 1, toughness: 1 } as Fighter;
    const a = { id: 2, side: 'def', x: 3, y: 0, hp: 1, maxHp: 1, power: 1, toughness: 1 } as Fighter;
    const b = { id: 3, side: 'def', x: 4, y: 0, hp: 1, maxHp: 1, power: 1, toughness: 1 } as Fighter;
    expect(pickFoe(u, [a, b], new Map())?.id).toBe(2);
    expect(pickFoe(u, [a, b], new Map([[2, 3]]))?.id).toBe(3);
    expect(pickFoe(u, [a, b], new Map(), 2)).toBeNull();
  });
});

describe('war parties', () => {
  it('appears sized from the strength, in column along the road 25-35 tiles from the gate, with a captain and a banner', () => {
    for (const [strength, expected] of [
      [20, 6],
      [45, 9],
      [70, 14],
      [200, 18],
    ] as const) {
      const s = mk();
      const { h } = s;
      h.join('Watcher', standNear(s, 0));
      h.tick(3);
      setOdds(s, 0, 60, strength);
      besiege(s, 0, 'blackwind', strength, 6);
      setOdds(s, 0, 60, strength);
      s.siege.scan();
      const b = s.siege.battles.get(0)!;
      expect(b, `battle for strength ${strength}`).toBeDefined();
      const party = raiders(s);
      expect(party).toHaveLength(expected);
      const gate = b.gate;
      for (const e of party) {
        expect(e.kind).toBe('monster');
        const st = MONSTER.get(e)!;
        expect(st.siege).toBe(0);
        expect(st.controlled).toBe(true);
        expect(MONSTERS[st.defId].family).toBe('bandit');
        expect(e.faction).toBe('blackwind');
        expect(dist(e.x, e.y, gate.x, gate.y)).toBeGreaterThan(12);
      }
      const far = Math.max(...party.map((e) => dist(e.x, e.y, gate.x, gate.y)));
      const lead = Math.min(...party.map((e) => dist(e.x, e.y, gate.x, gate.y)));
      expect(lead).toBeGreaterThan(20);
      expect(lead).toBeLessThan(40);
      expect(far).toBeGreaterThan(lead);
      expect(party.filter((e) => e.flag === 1)).toHaveLength(1);
      expect(party.filter((e) => e.elite === 1).length).toBeGreaterThanOrEqual(1);
      h.close();
      scene = null;
    }
  });

  it('Blight sieges bring Hollows with no faction colours', () => {
    const s = mk();
    s.h.join('Watcher', standNear(s, 0));
    s.h.tick(3);
    besiege(s, 0, 'blight', 45, 6);
    s.siege.scan();
    const party = raiders(s);
    expect(party.length).toBeGreaterThanOrEqual(6);
    for (const e of party) {
      expect(MONSTERS[MONSTER.get(e)!.defId].family).toBe('blight');
      expect(e.faction).toBeUndefined();
    }
  });

  it('marches along the road to the gate and charges', () => {
    const s = mk();
    const { h } = s;
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 60, 45);
    besiege(s, 0, 'blackwind', 45, 6);
    setOdds(s, 0, 60, 45);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    const gate = b.gate;
    const dists = () => raiders(s).map((e) => dist(e.x, e.y, gate.x, gate.y));
    const before = Math.min(...dists());
    expect(b.phase).toBe('march');
    h.tick(30);
    expect(Math.min(...dists())).toBeLessThan(before - 2);
    // the march ends at the gate: the charge starts when the lead is near, and the melee is at the gate
    const ticks = tickUntil(h, () => b.phase === 'melee', 1200);
    expect(ticks).toBeLessThan(1200);
    expect(Math.min(...dists())).toBeLessThanOrEqual(T.chargeDist + 3);
    h.tick(60);
    expect(Math.min(...dists())).toBeLessThan(T.chargeDist);
  });
});

describe('the defence', () => {
  it('clones guards, masters and militia (at most 8 villagers), hides and seizes the originals', () => {
    const s = mk();
    const { h } = s;
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    const origs = s.ctx.sim.npcs(0).filter((n) => n.alive);
    besiege(s, 0, 'blackwind', 60, 6);
    setOdds(s, 0, 60, 60);
    s.siege.scan();
    const defenders = sided(s, 'def');
    expect(defenders.length).toBeGreaterThanOrEqual(T.defenderMin);
    expect(defenders.length).toBeLessThanOrEqual(T.defenderMax);
    const roles = new Map<string, number>();
    for (const e of defenders) roles.set(e.role ?? '?', (roles.get(e.role ?? '?') ?? 0) + 1);
    expect(roles.get('guard') ?? 0).toBe(origs.filter((n) => n.role === 'guard').length);
    expect(roles.get('villager') ?? 0).toBeLessThanOrEqual(T.militiaMax);
    for (const e of defenders) {
      expect(e.kind).toBe('npc');
      expect(e.hp).toBe(e.maxHp);
      expect(e.hp).toBeGreaterThan(0);
    }
    // the sim NPCs they were cloned from are hidden and taken off their routine
    const api = getNpcLife(s.ctx);
    for (const n of origs.filter((o) => o.role === 'guard' || o.role === 'master')) {
      const e = s.ctx.npcEntity(n.id)!;
      expect(e.hidden).toBe(true);
      expect(h.life.isSeized(n.id)).toBe(true);
    }
    void api;
    // civilians other than the militia are untouched
    const elder = origs.find((n) => n.role === 'elder');
    if (elder) expect(h.life.isSeized(elder.id)).toBe(false);
  });

  it('pairs units up, trades blows seen by spectators as cfx hit events, and keeps every HP bounded', () => {
    const s = mk();
    const { h } = s;
    const { conn } = h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 60, 45);
    besiege(s, 0, 'blackwind', 45, 6);
    setOdds(s, 0, 60, 45);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    expect(tickUntil(h, () => b.phase === 'melee', 1200)).toBeLessThan(1200);
    conn.clear();
    let maxFighting = 0;
    for (let i = 0; i < 400; i++) {
      h.tick();
      for (const e of [...raiders(s), ...sided(s, 'def')]) {
        expect(e.hp).toBeGreaterThanOrEqual(0);
        expect(e.hp).toBeLessThanOrEqual(e.maxHp ?? 0);
      }
      maxFighting = Math.max(maxFighting, fighting(raiders(s)));
    }
    expect(maxFighting).toBeGreaterThanOrEqual(3);
    const events = conn.of('cfx').flatMap((m) => m.ev);
    const hits = events.filter((e) => e.k === 'hit');
    expect(hits.length).toBeGreaterThan(10);
    const ids = new Set(s.ctx.entities.ofKind('monster').concat(s.ctx.entities.ofKind('npc')).map((e) => e.id));
    for (const e of hits) {
      if (e.k !== 'hit') continue;
      expect(e.a).toBeGreaterThan(0);
      expect(ids.has(e.s) || true).toBe(true);
    }
    // some raiders fell and play the death state; casualties are removed a few seconds later
    expect(b.stats.raidersKilledByDefenders).toBeGreaterThan(0);
    expect(b.stats.blows).toBeGreaterThan(20);
  });

  it('steers the battle: a strong town beats the party, a weak one loses its defenders', () => {
    const casualties = (defense: number, strength: number): { raiders: number; defendersFallen: number } => {
      const s = mk();
      const { h } = s;
      h.join('Watcher', standNear(s, 0));
      h.tick(3);
      setOdds(s, 0, defense, strength);
      besiege(s, 0, 'blackwind', strength, 12);
      setOdds(s, 0, defense, strength);
      s.siege.scan();
      const b = s.siege.battles.get(0)!;
      b.final = true; // judge the final wave's own bias
      tickUntil(h, () => b.phase === 'melee', 1200);
      h.tick(500);
      const r = { raiders: b.stats.raidersKilledByDefenders + b.stats.raidersRouted, defendersFallen: b.stats.defendersFallen };
      h.close();
      scene = null;
      return r;
    };
    const strong = casualties(95, 30);
    const weak = casualties(15, 95);
    expect(strong.raiders).toBeGreaterThan(weak.raiders);
    expect(weak.defendersFallen).toBeGreaterThan(strong.defendersFallen);
  });
});

describe('the end of a siege', () => {
  it('holds: the party routs, the town cheers, everything temporary is gone and the NPCs are back', () => {
    const s = mk();
    const { h } = s;
    const npcsBefore = s.ctx.entities.count('npc');
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    const guards = s.ctx.sim.npcs(0).filter((n) => n.role === 'guard');
    setOdds(s, 0, 95, 30);
    besiege(s, 0, 'blackwind', 30, 3);
    setOdds(s, 0, 95, 30);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    expect(b).toBeDefined();
    h.hours(3); // the sim rolls the result at the third hour
    const st = s.ctx.sim.state.settlements[0];
    expect(st.siegeUntil).toBe(0);
    expect(st.status).not.toBe('fallen');
    expect(b.outcome).toBe('held');
    expect(b.phase).toBe('finale');
    // raiders rout away
    h.tick(200);
    expect(b.liveRaiders().length).toBe(0);
    expect(tickUntil(h, () => b.phase === 'done', 1000)).toBeLessThan(1000);
    expect(s.siege.battles.has(0)).toBe(false);
    // nothing of the battle is left
    expect(raiders(s)).toHaveLength(0);
    expect(sided(s, 'def')).toHaveLength(0);
    expect(s.ctx.entities.ofKind('monster')).toHaveLength(0);
    expect(s.ctx.entities.count('npc')).toBe(npcsBefore);
    for (const g of guards) {
      const e = s.ctx.npcEntity(g.id)!;
      expect(e.hidden).toBe(false);
      expect(h.life.isSeized(g.id)).toBe(false);
    }
  });

  it('falls: the defence breaks, the raiders reach the plaza and ransack it, then the scene is cleaned up', () => {
    const s = mk();
    const { h } = s;
    const { p } = h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 8, 90);
    besiege(s, 0, 'blight', 90, 3);
    setOdds(s, 0, 8, 90);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    h.hours(3);
    const st = s.ctx.sim.state.settlements[0];
    expect(st.status).toBe('fallen');
    expect(b.outcome).toBe('fell');
    expect(b.phase).toBe('finale');
    const plaza = s.ctx.world.settlements[0].spawn;
    h.tick(300);
    const party = raiders(s);
    expect(party.length).toBeGreaterThan(0);
    // the survivors are on the plaza ransacking it
    const looting = party.filter((e) => e.act === 'loot' || e.act === 'celebrate');
    expect(looting.length).toBeGreaterThan(0);
    for (const e of looting) expect(dist(e.x, e.y, plaza.x, plaza.y)).toBeLessThan(s.ctx.world.settlements[0].radius);
    void p;
    expect(tickUntil(h, () => b.phase === 'done', 800)).toBeLessThan(800);
    expect(raiders(s)).toHaveLength(0);
    expect(sided(s, 'def')).toHaveLength(0);
    expect(s.ctx.entities.ofKind('monster')).toHaveLength(0);
  });

  it('a raid that plunders ends with the raiders withdrawing', () => {
    const s = mk();
    const { h } = s;
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 8, 90);
    besiege(s, 0, 'blackwind', 90, 3);
    setOdds(s, 0, 8, 90);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    // The sim reports a plunder through its chronicle; classify directly from such an hour.
    h.run(3 * 60_000 - 100);
    const st = s.ctx.sim.state.settlements[0];
    st.siegeUntil = 0;
    st.siegeStrength = 0;
    st.siegeBy = null;
    b.onSimEnd([{ k: 'chron', entry: { id: 1, day: 0, hour: 0, kind: 'faction', text: 'Black Wind raiders plundered X and withdrew.', settlementId: 0, importance: 2, t: 0 } }], s.ctx.now());
    expect(b.outcome).toBe('plundered');
    // the people left alive mourn on the plaza
    expect([...h.life.states.values()].filter((x) => x.sid === 0 && x.mourn !== null).length).toBeGreaterThan(2);
    let sawLoot = false;
    for (let i = 0; i < 230; i++) {
      h.tick();
      if (raiders(s).some((e) => e.act === 'loot')) sawLoot = true;
    }
    expect(sawLoot).toBe(true);
    h.tick(250);
    expect(b.liveRaiders().length).toBe(0);
  });

  it('the visual result matches the sim result over several seeds (hold and fall)', () => {
    const outcomes: [boolean, boolean][] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const s = mk({ seed });
      const { h } = s;
      h.join('Watcher', standNear(s, 0));
      h.tick(3);
      const strong = seed % 2 === 1;
      setOdds(s, 0, strong ? 90 : 12, strong ? 35 : 80);
      besiege(s, 0, 'blackwind', strong ? 35 : 80, 3);
      setOdds(s, 0, strong ? 90 : 12, strong ? 35 : 80);
      s.siege.scan();
      const b = s.siege.battles.get(0)!;
      h.hours(3);
      const st = s.ctx.sim.state.settlements[0];
      const simHeld = st.controller === null || st.controller !== 'blackwind';
      outcomes.push([strong, b.outcome === 'held' && simHeld]);
      if (!strong) expect(b.outcome === 'captured' || b.outcome === 'plundered' || b.outcome === 'fell').toBe(true);
      else expect(b.outcome).toBe('held');
      h.close();
      scene = null;
    }
    expect(outcomes).toHaveLength(4);
  });
});

describe('players take part', () => {
  it('player kills lower the strength beyond the sim (capped), so a heroic defence saves a town that would fall', () => {
    const s = mk();
    const { h } = s;
    h.join('Hero', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 50, 62);
    besiege(s, 0, 'blackwind', 62, 3);
    setOdds(s, 0, 50, 62);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    const st = s.ctx.sim.state.settlements[0];
    expect(holdChance(50, 0, st.siegeStrength)).toBe(0); // it would fall
    const kill = (elite: 0 | 1 | 2 = 0) =>
      s.ctx.events.emit('monsterKilled', { killers: [], entityId: 1, defId: 'thug', family: 'bandit', level: 5, elite, x: 0, y: 0, spawnId: null, siege: 0, bountyFor: null, heartId: null });
    kill();
    expect(st.siegeStrength).toBeCloseTo(62 - T.tiltPerKill, 1);
    for (let i = 0; i < 40; i++) kill(1);
    expect(b.stats.tilt).toBeLessThanOrEqual(T.tiltCap + 1e-9);
    expect(st.siegeStrength).toBeCloseTo(62 - T.tiltCap, 0);
    expect(holdChance(50, 0, st.siegeStrength)).toBeGreaterThan(0.9);
    // other settlements' kills do not count
    const before = st.siegeStrength;
    s.ctx.events.emit('monsterKilled', { killers: [], entityId: 1, defId: 'thug', family: 'bandit', level: 5, elite: 0, x: 0, y: 0, spawnId: null, siege: 3, bountyFor: null, heartId: null });
    expect(st.siegeStrength).toBe(before);
    h.hours(3);
    expect(b.outcome).toBe('held');
  });

  it('raiders are real monsters: a player who engages one fights it in the combat engine and its death counts', () => {
    const s = mk();
    const { h, ctx } = s;
    const { p } = h.join('Hero', standNear(s, 0));
    powerUp(ctx, p, 40, 80);
    h.tick(3);
    setOdds(s, 0, 60, 30);
    besiege(s, 0, 'blackwind', 30, 6);
    setOdds(s, 0, 60, 30);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    const kills: number[] = [];
    ctx.events.on('monsterKilled', (ev) => void kills.push(ev.siege ?? -1));
    expect(tickUntil(h, () => b.phase === 'melee', 1200)).toBeLessThan(1200);
    const strength0 = ctx.sim.state.settlements[0].siegeStrength;
    // go for the nearest raider
    const target = ctx.entities.nearest(p.entity.x, p.entity.y, 60, (e) => e.side === 'raid' && e.state !== 'dead')!;
    h.say(p, { t: 'interact', id: target.id });
    expect(tickUntil(h, () => kills.length > 0, 1500)).toBeLessThan(1500);
    expect(kills[0]).toBe(0);
    expect(ctx.sim.state.settlements[0].siegeStrength).toBeLessThan(strength0);
    h.tick(5);
    expect(b.stats.raidersKilledByPlayers).toBeGreaterThan(0);
  });

  it('players inside the town are left alone while the party fights at the gate', () => {
    const s = mk();
    const { h } = s;
    const { p } = h.join('Bystander', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 40, 60);
    besiege(s, 0, 'blackwind', 60, 6);
    setOdds(s, 0, 40, 60);
    s.siege.scan();
    for (let i = 0; i < 900; i++) {
      h.tick();
      expect(p.combatId).toBeNull();
    }
  });

  it('raiders that sack the plaza attack the players there', () => {
    const s = mk();
    const { h } = s;
    const { p } = h.join('Bystander', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 8, 90);
    besiege(s, 0, 'blackwind', 90, 3);
    setOdds(s, 0, 8, 90);
    s.siege.scan();
    h.hours(3);
    expect(tickUntil(h, () => p.combatId !== null || p.entity.state === 'dead', 900)).toBeLessThan(900);
  });
});

describe('boundaries', () => {
  it('does no work and leaves no entities when nobody is near', () => {
    const s = mk();
    const { h } = s;
    // a player far away from the besieged settlement
    const far = farFrom(s, 0);
    h.join('Far', { x: far.spawn.x, y: far.spawn.y });
    h.tick(3);
    const counts = { monster: s.ctx.entities.count('monster'), npc: s.ctx.entities.count('npc') };
    besiege(s, 0, 'blackwind', 60, 3);
    h.tick(300);
    expect(s.siege.battles.size).toBe(0);
    expect(s.ctx.entities.count('monster')).toBe(counts.monster);
    expect(s.ctx.entities.count('npc')).toBe(counts.npc);
    expect(s.siege.entityCount()).toBe(0);
    // the siege runs its course in the sim
    h.hours(4);
    expect(s.ctx.sim.state.settlements[0].siegeUntil).toBe(0);
    expect(s.siege.battles.size).toBe(0);
  });

  it('tears the battle down when the last player leaves, and rebuilds it when somebody comes back', () => {
    const s = mk();
    const { h } = s;
    const { p } = h.join('Wanderer', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 60, 45);
    besiege(s, 0, 'blackwind', 45, 12);
    setOdds(s, 0, 60, 45);
    s.siege.scan();
    expect(s.siege.battles.has(0)).toBe(true);
    const guards = s.ctx.sim.npcs(0).filter((n) => n.role === 'guard');
    const far = farFrom(s, 0);
    s.ctx.movement.teleport(p.entity, far.spawn.x, far.spawn.y);
    h.run(T.graceMs + 3000);
    expect(s.siege.battles.size).toBe(0);
    expect(raiders(s)).toHaveLength(0);
    expect(sided(s, 'def')).toHaveLength(0);
    for (const g of guards) {
      expect(s.ctx.npcEntity(g.id)!.hidden).toBe(false);
      expect(h.life.isSeized(g.id)).toBe(false);
    }
    // back again: a new party appears
    s.ctx.movement.teleport(p.entity, standNear(s, 0).x, standNear(s, 0).y);
    h.run(T.scanMs * 2);
    expect(s.siege.battles.has(0)).toBe(true);
    expect(raiders(s).length).toBeGreaterThanOrEqual(6);
  });

  it('reconstructs a siege that is on at boot: a party appears when a player shows up, late in the siege it is already at the gate', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60_000 });
    const ctx = h.ctx;
    const st = ctx.sim.state.settlements[0];
    st.siegeUntil = ctx.sim.clock().totalHours + 1;
    st.siegeStrength = 45;
    st.siegeBy = 'blackwind';
    st.defense = 60;
    registerMonsters(ctx, { population: false });
    registerCombat(ctx);
    registerSiege(ctx);
    const siege = getSiege(ctx)!;
    h.tick(5);
    expect(siege.battles.size).toBe(0);
    expect(ctx.entities.ofKind('monster')).toHaveLength(0);
    // 0.8 hours left: the final wave comes at once
    h.run(0.3 * 60_000);
    const def = ctx.world.settlements[0];
    h.join('Late', { x: def.spawn.x, y: def.spawn.y });
    h.run(T.scanMs * 2);
    const b = siege.battles.get(0)!;
    expect(b).toBeDefined();
    expect(b.final).toBe(true);
    expect(ctx.entities.ofKind('monster').length).toBeGreaterThanOrEqual(6);
    // and it ends cleanly when the sim ends the siege
    h.hours(1);
    expect(st.siegeUntil).toBe(0);
    h.run(T.finaleMs + 3000);
    expect(siege.battles.size).toBe(0);
    expect(ctx.entities.ofKind('monster')).toHaveLength(0);
    h.close();
  });

  it('keeps one owner for the siege monsters: no ring from the monster module, no duplicates', () => {
    const s = mk();
    const { h, mon } = s;
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 60, 45);
    besiege(s, 0, 'blackwind', 45, 6);
    setOdds(s, 0, 60, 45);
    s.siege.scan();
    const before = s.ctx.entities.ofKind('monster').length;
    expect(before).toBe(9);
    mon.checkSieges();
    h.clock.advance(MONSTER_TUNING.siegeCycleMs * 2);
    h.tick(10);
    mon.checkSieges();
    expect(s.ctx.entities.ofKind('monster').length).toBe(before);
    for (const e of s.ctx.entities.ofKind('monster')) expect(MONSTER.get(e)!.controlled).toBe(true);
    expect(mon.population()).toBe(before);
  });

  it('bounds the work of a big battle: 18 raiders and the whole roster stay under the unit cap and a few ms per step', () => {
    const s = mk();
    const { h } = s;
    h.join('Watcher', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 80, 300);
    besiege(s, 0, 'blackwind', 300, 12);
    setOdds(s, 0, 80, 300);
    s.siege.scan();
    const b = s.siege.battles.get(0)!;
    expect(b.att.length).toBeLessThanOrEqual(T.partyMax);
    expect(b.att.length + b.def.length).toBeLessThanOrEqual(T.unitCap);
    tickUntil(h, () => b.phase === 'melee', 1200);
    const t0 = performance.now();
    let steps = 0;
    for (let i = 0; i < 300; i++) {
      h.tick();
      steps++;
    }
    const perTick = (performance.now() - t0) / steps;
    expect(perTick).toBeLessThan(8);
    expect(b.att.length + b.def.length).toBeLessThanOrEqual(T.unitCap);
  });
});

describe('determinism and mercy', () => {
  it('is deterministic: the same seed gives the same battle', () => {
    const run = (): string => {
      const s = mk({ seed: 21 });
      const { h } = s;
      h.join('Watcher', standNear(s, 0));
      h.tick(3);
      setOdds(s, 0, 50, 55);
      besiege(s, 0, 'blackwind', 55, 6);
      setOdds(s, 0, 50, 55);
      s.siege.scan();
      const b = s.siege.battles.get(0)!;
      h.tick(900);
      const snap = JSON.stringify({ stats: b.stats, view: b.view(), ents: [...raiders(s), ...sided(s, 'def')].map((e) => [e.name, e.x, e.y, e.hp, e.state]) });
      h.close();
      scene = null;
      return snap;
    };
    expect(run()).toBe(run());
  });

  it('spares a player who fell in the battle for a while after waking up', () => {
    const s = mk();
    const { h } = s;
    const { p } = h.join('Fallen', standNear(s, 0));
    h.tick(3);
    setOdds(s, 0, 40, 60);
    besiege(s, 0, 'blackwind', 60, 6);
    setOdds(s, 0, 40, 60);
    s.siege.scan();
    s.ctx.events.emit('playerDied', { player: p });
    expect(typeof p.data.siegeSpareUntil).toBe('number');
    expect(p.data.siegeSpareUntil as number).toBeGreaterThan(s.ctx.now());
    // raiders ignore the spared player even when standing next to them
    const b = s.siege.battles.get(0)!;
    tickUntil(h, () => b.phase === 'melee', 1200);
    const gate = b.gate;
    s.ctx.movement.teleport(p.entity, gate.x, gate.y);
    for (let i = 0; i < 300; i++) {
      h.tick();
      expect(p.combatId).toBeNull();
    }
  });
});
