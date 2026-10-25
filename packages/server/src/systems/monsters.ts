/**
 * Monsters: pack population from world spawn points, respawns, AI (idle / aggro / chase / return home), siege
 * waves, Blight heart bosses and personal bounty targets. See docs/GAMEPLAY_SPEC.md section 1 and
 * docs/notes/gameplay-combat.md. Owner: gameplay-combat.
 *
 * Fighting itself lives in combat.ts; the two talk through `MonsterApi` (monsters/state.ts) and `CombatApi`.
 */
import {
  MONSTERS,
  dist,
  isPassable,
  levelForDanger,
  nearestWalkable,
  pickSpecies,
  reachableFrom,
  type Dir,
  type MonsterDef,
  type SpawnPointDef,
} from '@murim/shared';
import type { Entity, GameContext, Player } from '../ctx';
import './events';
import { getCombatApi } from './combat/api';
import { publishSimEvents } from './combat/simfx';
import { getServices } from './services';
import {
  MONSTER,
  MONSTER_TUNING as T,
  defElite,
  familyOfSiege,
  isNight,
  isSafeZone,
  monsterCombatant,
  setMonsterApi,
  type MonsterApi,
  type MonsterState,
  type SpawnSpec,
} from './monsters/state';

export { MONSTER, MONSTER_TUNING, getMonsterApi } from './monsters/state';
export type { MonsterApi, MonsterState, SpawnSpec } from './monsters/state';

export interface MonsterOptions {
  /** Populate the world from `world.spawnPoints` (default true; tests switch it off to control the scene). */
  population?: boolean;
}

interface Pack {
  id: number;
  sp: SpawnPointDef;
  members: Entity[];
  active: boolean;
  spawned: boolean;
  respawnAt: number;
}

interface Siege {
  id: number;
  ents: Entity[];
  fresh: boolean;
}

interface HeartRec {
  entityId: number | null;
  cooldownUntil: number;
}

interface Budget {
  paths: number;
  wanders: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function register(ctx: GameContext, opts: MonsterOptions = {}): void {
  const monsters = new Set<Entity>();
  /** Monsters that must be processed even when no player is near (chasing / walking home). */
  const busy = new Set<Entity>();
  const packs = new Map<number, Pack>();
  const sieges = new Map<number, Siege>();
  const hearts = new Map<number, HeartRec>();
  const bounties = new Map<number, number>();
  const dangerCache = new Map<number, number>();
  let lastThink = 0;

  ctx.entities.onRemove((e) => {
    monsters.delete(e);
    busy.delete(e);
  });

  const isAlive = (e: Entity): boolean => ctx.entities.has(e.id) && MONSTER.get(e)?.mode !== 'dead';

  // ------------------------------------------------------------------ spawning

  function spawn(spec: SpawnSpec): Entity | null {
    const def = MONSTERS[spec.defId];
    if (!def) return null;
    const level = clamp(Math.round(spec.level), 1, 99);
    const elite = spec.elite ?? defElite(def);
    const c = monsterCombatant(def, level, elite, 0);
    const e = ctx.entities.create({
      kind: 'monster',
      name: def.name,
      x: spec.x,
      y: spec.y,
      sprite: def.sprite,
      lv: level,
      hp: c.maxHp,
      maxHp: c.maxHp,
      elite,
      speed: clamp((T.speedFactor * def.speed) / 100, 0.5, 1.5),
      face: ctx.rng.int(0, 3) as Dir,
    });
    const now = ctx.now();
    MONSTER.set(e, {
      defId: def.id,
      level,
      elite,
      spawnId: spec.spawnId ?? null,
      siege: spec.siege ?? null,
      bountyFor: spec.bountyFor ?? null,
      heartId: spec.heartId ?? null,
      homeX: e.x,
      homeY: e.y,
      wanderRadius: spec.wanderRadius ?? T.wanderRadius,
      mode: 'idle',
      targetChar: null,
      chaseStart: 0,
      lastProgress: 0,
      bestDist: Infinity,
      ignoreUntil: 0,
      expiresAt: spec.expiresAt ?? 0,
      ephemeral: spec.ephemeral ?? true,
      despawnWhenFree: false,
      lastSeen: now,
      returnTries: 0,
      controlled: spec.controlled,
    });
    monsters.add(e);
    return e;
  }

  function remove(e: Entity): void {
    if (ctx.entities.has(e.id)) ctx.entities.remove(e);
  }

  /** Remove now, or as soon as the monster's fight ends. */
  function despawn(e: Entity): void {
    const st = MONSTER.get(e);
    if (!st) return;
    if (st.mode === 'fight') st.despawnWhenFree = true;
    else remove(e);
  }

  // ------------------------------------------------------------------ packs

  function packSpot(sp: SpawnPointDef): { x: number; y: number } | null {
    for (let i = 0; i < 12; i++) {
      const x = sp.x + ctx.rng.int(-T.packRadius, T.packRadius);
      const y = sp.y + ctx.rng.int(-T.packRadius, T.packRadius);
      if (isPassable(ctx.world, x, y) && !isSafeZone(ctx, x, y)) return { x, y };
    }
    const p = nearestWalkable(ctx.grid, sp.x, sp.y, 4);
    return p && !isSafeZone(ctx, p.x, p.y) ? p : null;
  }

  function spawnPack(pack: Pack): void {
    const sp = pack.sp;
    const bonus = sp.family === 'blight' ? Math.floor(ctx.sim.blightAt(sp.x, sp.y) / T.blightLevelDiv) : 0;
    const eliteSlot = sp.danger >= T.eliteMinDanger && ctx.rng.chance(T.eliteChance) ? ctx.rng.int(0, sp.packSize - 1) : -1;
    let leader: MonsterDef | null = null;
    pack.members = [];
    for (let i = 0; i < sp.packSize; i++) {
      const spot = packSpot(sp);
      if (!spot) continue;
      const level = clamp(levelForDanger(sp.danger, ctx.rng) + bonus, 1, 60);
      const def: MonsterDef = leader?.packy && ctx.rng.chance(0.6) ? leader : pickSpecies(ctx.rng, sp.family, level, i === eliteSlot);
      leader ??= def;
      const e = spawn({ defId: def.id, level, x: spot.x, y: spot.y, spawnId: sp.id, ephemeral: false });
      if (e) pack.members.push(e);
    }
    pack.spawned = true;
    pack.active = true;
    pack.respawnAt = 0;
  }

  function respawnDelay(sp: SpawnPointDef): number {
    return Math.min(T.respawnCapS, T.respawnBaseS + sp.danger * T.respawnPerDangerS) * 1000;
  }

  function deactivate(pack: Pack): void {
    for (const m of pack.members) {
      const st = MONSTER.get(m);
      if (st?.mode === 'fight') st.despawnWhenFree = true;
      else remove(m);
    }
    pack.members = [];
    pack.active = false;
    pack.spawned = false;
    pack.respawnAt = 0;
  }

  function checkPacks(): void {
    const now = ctx.now();
    for (const pack of packs.values()) {
      const sp = pack.sp;
      const want = (sp.family !== 'blight' || ctx.sim.blightAt(sp.x, sp.y) >= T.blightActive) && !isSafeZone(ctx, sp.x, sp.y);
      if (!want) {
        if (pack.active) deactivate(pack);
        continue;
      }
      const living = pack.members.filter(isAlive).length;
      if (living > 0) continue;
      if (pack.spawned && pack.respawnAt === 0) pack.respawnAt = now + respawnDelay(sp);
      if (now < pack.respawnAt) continue;
      if (ctx.players.near(sp.x, sp.y, T.respawnPlayerFree).length > 0) continue;
      for (const m of pack.members) remove(m);
      spawnPack(pack);
    }
  }

  // ------------------------------------------------------------------ AI

  function eligible(p: Player, st: MonsterState): boolean {
    if (!p.online || p.entity.state === 'dead' || p.combatId !== null || p.save.activity) return false;
    if (st.bountyFor !== null && st.bountyFor !== p.charId) return false;
    if (typeof p.data.fleeImmuneUntil === 'number' && p.data.fleeImmuneUntil > ctx.now()) return false;
    return !isSafeZone(ctx, p.entity.x, p.entity.y);
  }

  function findTarget(e: Entity, st: MonsterState, night: boolean): Player | undefined {
    const def = MONSTERS[st.defId];
    let r = def.aggro;
    if (ctx.sim.weatherAt(e.x, e.y) === 'fog') r *= T.fogAggroMult;
    if (night && def.family === 'beast') r *= T.nightAggroMult;
    let best: Player | undefined;
    let bestD = Infinity;
    for (const ent of ctx.entities.near(e.x, e.y, r, (x) => x.kind === 'player')) {
      const p = ctx.players.byEntityId(ent.id);
      if (!p || !eligible(p, st)) continue;
      const d = dist(e.x, e.y, ent.x, ent.y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  function arriveHome(e: Entity, st: MonsterState): void {
    st.mode = 'idle';
    st.targetChar = null;
    busy.delete(e);
    if (e.hp !== e.maxHp) {
      e.hp = e.maxHp;
      ctx.entities.touch(e);
    }
  }

  function walkHome(e: Entity, st: MonsterState): void {
    if (!e.move && dist(e.x, e.y, st.homeX, st.homeY) <= 1.2) {
      arriveHome(e, st);
      return;
    }
    const r = ctx.movement.moveTo(e, st.homeX, st.homeY, {
      maxSteps: 80,
      speed: e.speed * 1.3,
      onArrive: (_ent, res) => {
        if (res === 'arrived' && MONSTER.get(e)?.mode === 'return' && ctx.entities.has(e.id)) arriveHome(e, st);
      },
    });
    if (!r.ok) {
      ctx.movement.teleport(e, st.homeX, st.homeY);
      arriveHome(e, st);
    }
  }

  function startReturn(e: Entity, st: MonsterState): void {
    st.mode = 'return';
    st.targetChar = null;
    st.returnTries = 0;
    busy.add(e);
    walkHome(e, st);
  }

  function chaseTo(e: Entity, st: MonsterState, p: Player): boolean {
    const r = ctx.movement.approach(e, p.entity, {
      range: 1.5,
      maxSteps: 40,
      onArrive: (_ent, res) => {
        if (res === 'arrived') engageTarget(e);
      },
    });
    return r.ok;
  }

  function startChase(e: Entity, st: MonsterState, p: Player, now: number): void {
    st.mode = 'chase';
    st.targetChar = p.charId;
    st.chaseStart = now;
    st.lastProgress = now;
    st.bestDist = dist(e.x, e.y, p.entity.x, p.entity.y);
    busy.add(e);
    if (!chaseTo(e, st, p) && MONSTER.get(e)?.mode === 'chase') {
      st.mode = 'idle';
      st.targetChar = null;
      st.ignoreUntil = now + T.ignoreMs;
      busy.delete(e);
    }
  }

  function engageTarget(e: Entity): void {
    const st = MONSTER.get(e);
    if (!st || st.mode !== 'chase' || !ctx.entities.has(e.id)) return;
    const now = ctx.now();
    const p = st.targetChar !== null ? ctx.players.byCharId(st.targetChar) : undefined;
    if (!p || !eligible(p, st)) {
      startReturn(e, st);
      return;
    }
    if (dist(e.x, e.y, p.entity.x, p.entity.y) > 2.2) return; // the target moved; the next think re-approaches
    const combat = getCombatApi(ctx);
    if (!combat || !combat.startFight([p], e)) {
      st.ignoreUntil = now + T.ignoreMs;
      startReturn(e, st);
    }
  }

  function thinkChase(e: Entity, st: MonsterState, now: number, budget: Budget): void {
    const p = st.targetChar !== null ? ctx.players.byCharId(st.targetChar) : undefined;
    if (!p || !eligible(p, st)) {
      startReturn(e, st);
      return;
    }
    const d = dist(e.x, e.y, p.entity.x, p.entity.y);
    if (d < st.bestDist - 0.5) {
      st.bestDist = d;
      st.lastProgress = now;
    }
    if (now - st.lastProgress > T.chaseNoProgressMs || dist(e.x, e.y, st.homeX, st.homeY) > T.leashTiles) {
      st.ignoreUntil = now + T.ignoreMs;
      startReturn(e, st);
      return;
    }
    const m = e.move;
    if (!m) {
      if (d <= 1.6) engageTarget(e);
      else if (budget.paths > 0) {
        budget.paths--;
        if (!chaseTo(e, st, p) && MONSTER.get(e)?.mode === 'chase') startReturn(e, st);
      }
    } else if (budget.paths > 0 && dist(m.tx, m.ty, p.entity.x, p.entity.y) > 3) {
      budget.paths--;
      chaseTo(e, st, p);
    }
  }

  function thinkReturn(e: Entity, st: MonsterState, budget: Budget): void {
    if (e.move) return;
    if (dist(e.x, e.y, st.homeX, st.homeY) <= 1.2) {
      arriveHome(e, st);
      return;
    }
    if (++st.returnTries > 3) {
      ctx.movement.teleport(e, st.homeX, st.homeY);
      arriveHome(e, st);
      return;
    }
    if (budget.paths > 0) {
      budget.paths--;
      walkHome(e, st);
    }
  }

  function thinkIdle(e: Entity, st: MonsterState, now: number, night: boolean, budget: Budget): void {
    if (st.expiresAt && now >= st.expiresAt) {
      remove(e);
      return;
    }
    if (now >= st.ignoreUntil && budget.paths > 0) {
      const target = findTarget(e, st, night);
      if (target) {
        budget.paths--;
        startChase(e, st, target, now);
        return;
      }
    }
    if ((e.hp ?? 0) < (e.maxHp ?? 0)) {
      e.hp = Math.min(e.maxHp ?? 0, Math.ceil((e.hp ?? 0) + (e.maxHp ?? 0) * T.idleRegen));
      ctx.entities.touch(e);
    }
    if (e.move || budget.paths <= 0) return;
    if (dist(e.x, e.y, st.homeX, st.homeY) > st.wanderRadius + 1.5) {
      budget.paths--;
      startReturn(e, st);
      return;
    }
    if (budget.wanders > 0 && ctx.rng.chance(T.wanderChance)) {
      const R = st.wanderRadius;
      const x = st.homeX + ctx.rng.int(-R, R);
      const y = st.homeY + ctx.rng.int(-R, R);
      if (!isPassable(ctx.world, x, y) || isSafeZone(ctx, x, y)) return;
      budget.paths--;
      budget.wanders--;
      ctx.movement.moveTo(e, x, y, { snap: 0, maxSteps: 10, maxNodes: 300, speed: e.speed * 0.6 });
    }
  }

  function think(): void {
    const now = ctx.now();
    const night = isNight(ctx.sim.clock().hour);
    const active = new Set<Entity>(busy);
    for (const p of ctx.players.online()) {
      for (const e of ctx.entities.near(p.entity.x, p.entity.y, T.activeRadius, (x) => x.kind === 'monster')) if (monsters.has(e)) active.add(e);
    }
    lastThink = active.size;
    const budget: Budget = { paths: T.maxPathsPerThink, wanders: T.maxWandersPerThink };
    for (const e of active) {
      const st = MONSTER.get(e);
      if (!st || e.hidden || !ctx.entities.has(e.id)) continue;
      st.lastSeen = now;
      if (st.controlled) continue; // war party of the siege module: it decides what the unit does
      try {
        if (st.mode === 'idle') thinkIdle(e, st, now, night, budget);
        else if (st.mode === 'chase') thinkChase(e, st, now, budget);
        else if (st.mode === 'return') thinkReturn(e, st, budget);
      } catch (err) {
        ctx.log.error(`monster ai failed for ${e.name} #${e.id}`, err);
      }
    }
  }

  // ------------------------------------------------------------------ combat hooks

  function available(e: Entity): boolean {
    const st = MONSTER.get(e);
    return !!st && monsters.has(e) && !e.hidden && st.mode !== 'dead' && st.mode !== 'fight' && e.combatId === undefined && !st.despawnWhenFree;
  }

  function groupKey(st: MonsterState): string | null {
    return st.spawnId !== null ? `p${st.spawnId}` : st.siege !== null ? `s${st.siege}` : null;
  }

  function mates(e: Entity, radius: number, max: number): Entity[] {
    const st = MONSTER.get(e);
    const key = st ? groupKey(st) : null;
    if (!st || key === null) return [];
    return ctx.entities
      .near(e.x, e.y, radius, (m) => {
        if (m === e || !available(m)) return false;
        const ms = MONSTER.get(m)!;
        return (ms.mode === 'idle' || ms.mode === 'chase') && groupKey(ms) === key;
      })
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))
      .slice(0, max);
  }

  function engage(e: Entity, combatId: number): void {
    const st = MONSTER.get(e);
    if (!st) return;
    ctx.movement.stop(e, true);
    st.mode = 'fight';
    st.targetChar = null;
    busy.delete(e);
    e.combatId = combatId;
    e.state = 'fight';
    ctx.entities.touch(e);
  }

  function release(e: Entity): void {
    const st = MONSTER.get(e);
    if (!st || st.mode === 'dead' || !ctx.entities.has(e.id)) return;
    e.combatId = undefined;
    if (e.state === 'fight') e.state = 'idle';
    ctx.entities.touch(e);
    if (st.despawnWhenFree || (st.expiresAt && ctx.now() >= st.expiresAt)) {
      remove(e);
      return;
    }
    st.mode = 'idle';
    if (st.controlled) return; // handed back to its war party
    startReturn(e, st);
  }

  function kill(e: Entity, killers: Player[]): void {
    const st = MONSTER.get(e);
    if (!st || st.mode === 'dead') return;
    ctx.movement.stop(e, true);
    st.mode = 'dead';
    st.targetChar = null;
    busy.delete(e);
    e.combatId = undefined;
    e.state = 'dead';
    e.hp = 0;
    ctx.entities.touch(e);
    if (st.heartId !== null) heartDefeated(st, killers);
    if (st.bountyFor !== null && bounties.get(st.bountyFor) === e.id) bounties.delete(st.bountyFor);
    ctx.after(T.corpseMs, () => {
      if (!ctx.entities.has(e.id)) return;
      if (st.ephemeral) remove(e);
      else {
        e.hidden = true;
        ctx.entities.touch(e);
      }
    });
    if (st.spawnId !== null) {
      const pack = packs.get(st.spawnId);
      if (pack && pack.members.every((m) => !isAlive(m))) pack.respawnAt = ctx.now() + respawnDelay(pack.sp);
    }
  }

  // ------------------------------------------------------------------ sieges

  function settlementDanger(id: number): number {
    let d = dangerCache.get(id);
    if (d === undefined) {
      const s = ctx.world.settlements[id];
      const near = [...ctx.world.spawnPoints].sort((a, b) => dist(a.x, a.y, s.x, s.y) - dist(b.x, b.y, s.x, s.y)).slice(0, 3);
      d = near.length ? near.reduce((a, p) => a + p.danger, 0) / near.length : 4;
      dangerCache.set(id, d);
    }
    return d;
  }

  function ringSpot(id: number): { x: number; y: number } | null {
    const s = ctx.world.settlements[id];
    for (let i = 0; i < 24; i++) {
      const a = ctx.rng.float(0, Math.PI * 2);
      const d = s.radius + ctx.rng.int(T.siegeRingMin, T.siegeRingMax);
      const x = Math.round(s.x + Math.cos(a) * d);
      const y = Math.round(s.y + Math.sin(a) * d);
      if (isPassable(ctx.world, x, y) && !isSafeZone(ctx, x, y)) return { x, y };
    }
    return null;
  }

  function topUp(siege: Siege): void {
    const s = ctx.sim.state.settlements.find((x) => x.id === siege.id);
    if (!s) return;
    siege.ents = siege.ents.filter(isAlive);
    const want = clamp(Math.round(s.siegeStrength / T.siegeStrengthPerMonster), T.siegeMin, T.siegeMax);
    const family = familyOfSiege(s.siegeBy);
    const bonus = family === 'blight' ? Math.floor(s.blight / T.blightLevelDiv) : 0;
    let budget = siege.fresh ? want : T.siegeTopUpPerCycle;
    siege.fresh = false;
    while (siege.ents.length < want && budget-- > 0) {
      const spot = ringSpot(siege.id);
      if (!spot) return;
      const level = clamp(levelForDanger(settlementDanger(siege.id), ctx.rng) + bonus, 1, 60);
      const def = pickSpecies(ctx.rng, family, level, ctx.rng.chance(0.08));
      const e = spawn({ defId: def.id, level, x: spot.x, y: spot.y, siege: siege.id, wanderRadius: 4 });
      if (e) siege.ents.push(e);
    }
  }

  function endSiege(siege: Siege): void {
    for (const e of siege.ents) despawn(e);
    sieges.delete(siege.id);
  }

  let siegesDelegated = false;

  /** Another module (siege battles) owns the siege waves from now on: dismantle ours. */
  function delegateSieges(): void {
    siegesDelegated = true;
    for (const siege of [...sieges.values()]) endSiege(siege);
  }

  function checkSieges(): void {
    if (siegesDelegated) return;
    const total = ctx.sim.clock().totalHours;
    for (const s of ctx.sim.state.settlements) {
      const on = s.siegeUntil > total;
      let siege = sieges.get(s.id);
      if (on) {
        if (!siege) {
          siege = { id: s.id, ents: [], fresh: true };
          sieges.set(s.id, siege);
        }
        topUp(siege);
      } else if (siege) endSiege(siege);
    }
  }

  // ------------------------------------------------------------------ Blight hearts

  const heartAt = (x: number, y: number) => ctx.sim.state.hearts.find((h) => h.x === x && h.y === y);
  const heartActive = (h: { strength: number; sealedUntil: number }): boolean => h.strength > 0 && h.sealedUntil <= ctx.sim.clock().totalHours;
  const heartRec = (id: number): HeartRec => {
    let r = hearts.get(id);
    if (!r) {
      r = { entityId: null, cooldownUntil: 0 };
      hearts.set(id, r);
    }
    return r;
  };

  function heartDefeated(st: MonsterState, killers: Player[]): void {
    const id = st.heartId!;
    const rec = heartRec(id);
    rec.entityId = null;
    rec.cooldownUntil = ctx.now() + T.heartBossCooldownMs;
    publishSimEvents(ctx, ctx.sim.damageHeart(id, T.heartDamage, killers[0]?.name ?? 'a wandering hero'));
  }

  ctx.onInteract('node', (p, node) => {
    if (node.nodeKind !== 'heart') return false;
    const heart = heartAt(node.x, node.y);
    if (!heart) {
      ctx.notify(p, 'info', 'The heart pulses silently.');
      return true;
    }
    if (!heartActive(heart)) {
      ctx.notify(p, 'info', 'The Blight heart lies sealed and still.');
      return true;
    }
    if (p.entity.state === 'dead' || p.combatId !== null) {
      ctx.notify(p, 'warn', p.combatId !== null ? 'You are already fighting.' : 'You are dead.');
      return true;
    }
    const rec = heartRec(heart.id);
    let boss = rec.entityId !== null ? ctx.entities.get(rec.entityId) : undefined;
    if (boss && !isAlive(boss)) boss = undefined;
    if (!boss) {
      if (ctx.now() < rec.cooldownUntil) {
        ctx.notify(p, 'warn', 'Its guardian has fallen, but the Blight is slow to regrow. Return later.');
        return true;
      }
      const def = MONSTERS.lord;
      const level = clamp(T.heartBossBaseLevel + Math.floor(heart.strength / 5), def.minLevel, def.maxLevel);
      const spot = nearestWalkable(ctx.grid, p.entity.x, p.entity.y, 2) ?? { x: node.x, y: node.y };
      boss = spawn({ defId: def.id, level, x: spot.x, y: spot.y, heartId: heart.id, wanderRadius: 2 }) ?? undefined;
      if (!boss) return true;
      rec.entityId = boss.id;
      ctx.notify(p, 'warn', 'The Blight Lord rises to guard its heart!');
    }
    const combat = getCombatApi(ctx);
    if (!combat || !combat.startFight([p], boss)) ctx.notify(p, 'warn', 'You cannot fight it right now.');
    return true;
  });

  // ------------------------------------------------------------------ bounty targets

  function removeBounty(charId: number): void {
    const id = bounties.get(charId);
    bounties.delete(charId);
    const e = id !== undefined ? ctx.entities.get(id) : undefined;
    if (e) despawn(e);
  }

  function spawnBounty(owner: Player, defId: string, level: number, elite: 1 | 2, nearSettlement: number): Entity | null {
    const s = ctx.world.settlements[nearSettlement];
    if (!s || !MONSTERS[defId]) return null;
    removeBounty(owner.charId);
    const reach = reachableFrom(ctx.world, s.spawn.x, s.spawn.y);
    for (let i = 0; i < 120; i++) {
      const a = ctx.rng.float(0, Math.PI * 2);
      const d = ctx.rng.int(T.bountyDistMin, T.bountyDistMax);
      const x = Math.round(s.x + Math.cos(a) * d);
      const y = Math.round(s.y + Math.sin(a) * d);
      if (!isPassable(ctx.world, x, y) || reach[y * ctx.world.w + x] !== 1 || isSafeZone(ctx, x, y)) continue;
      const e = spawn({ defId, level, x, y, elite, bountyFor: owner.charId, expiresAt: ctx.now() + T.bountyLifeMs, wanderRadius: 2 });
      if (e) bounties.set(owner.charId, e.id);
      return e;
    }
    return null;
  }

  getServices(ctx).monsters = { spawnBounty, removeBounty };

  // ------------------------------------------------------------------ upkeep

  function upkeep(): void {
    const now = ctx.now();
    for (const e of [...monsters]) {
      const st = MONSTER.get(e);
      if (!st || st.mode === 'dead' || st.mode === 'fight') continue;
      if (st.bountyFor !== null && st.expiresAt && now >= st.expiresAt) remove(e);
      else if (st.heartId !== null) {
        const heart = ctx.sim.state.hearts.find((h) => h.id === st.heartId);
        if (!heart || !heartActive(heart) || now - st.lastSeen > T.heartBossIdleMs) {
          const rec = hearts.get(st.heartId);
          if (rec) rec.entityId = null;
          remove(e);
        }
      }
    }
  }

  // ------------------------------------------------------------------ wiring

  setMonsterApi(ctx, {
    spawn,
    stateOf: (e) => MONSTER.get(e),
    available,
    mates,
    engage,
    kill,
    release,
    despawn,
    isSafeZone: (x, y) => isSafeZone(ctx, x, y),
    lastThinkCount: () => lastThink,
    population: () => monsters.size,
    think,
    checkPacks,
    checkSieges,
    delegateSieges,
  } satisfies MonsterApi);

  if (opts.population !== false) {
    for (const sp of ctx.world.spawnPoints) packs.set(sp.id, { id: sp.id, sp, members: [], active: false, spawned: false, respawnAt: 0 });
    checkPacks();
  }
  checkSieges();

  ctx.every(T.aiIntervalMs, think);
  ctx.every(T.packCheckMs, checkPacks);
  ctx.every(T.siegeCycleMs, checkSieges);
  ctx.every(T.upkeepMs, upkeep);
  ctx.onHour((events) => {
    if (events.some((ev) => ev.k === 'siege')) checkSieges();
    if (events.some((ev) => ev.k === 'heart')) upkeep();
  });
}
