/**
 * Combat manager: PvE fights (start on interact / aggro, assist, flee, per-beat processing, rewards, death and
 * respawn), friendly duels (`combat` service) and out-of-combat regeneration.
 * See docs/GAMEPLAY_SPEC.md section 2 and docs/notes/gameplay-combat.md. Owner: gameplay-combat.
 *
 * Damage math is the shared engine (`stepBeat`); this file only orchestrates it.
 */
import {
  AOI_RADIUS,
  COMBAT_BEAT_MS,
  MONSTERS,
  TALENTS,
  applySkillXp,
  buildPlayerCombatant,
  deriveForCharacter,
  dist,
  getSkill,
  isOver,
  isPassable,
  nearestSettlement,
  nearestWalkable,
  stepBeat,
  winner,
  type CombatEvent,
  type CombatReward,
  type CombatState,
  type CombatView,
  type Combatant,
  type Dir,
  type FighterView,
  type ItemStack,
  type TacticRule,
} from '@murim/shared';
import { GameError, type Entity, type GameContext, type Player } from '../ctx';
import './events';
import { setCombatApi, type CombatApi } from './combat/api';
import { COMBAT_TUNING as K } from './combat/constants';
import { killXp, rollKillDrop } from './combat/rewards';
import { publishSimEvents } from './combat/simfx';
import { addGold, addItem, addReputation, countItem, grantXp, removeItem } from './lib';
import { getMonsterApi } from './monsters';
import { MONSTER, monsterCombatant } from './monsters/state';
import { getServices } from './services';

export { getCombatApi } from './combat/api';
export type { CombatApi } from './combat/api';
export { COMBAT_TUNING } from './combat/constants';

interface Fighter {
  c: Combatant;
  entity: Entity;
  player: Player | null;
  baseTactics: TacticRule[];
  fleeReq: number;
  /** Left the fight (fled, died, logged out). Done fighters get no more updates. */
  done: boolean;
  itemsSeen: Record<string, number>;
  usesSeen: Record<string, number>;
  learnRate: number;
  fastSchools: string[];
}

interface Combat {
  id: number;
  x: number;
  y: number;
  duel: boolean;
  stake: number;
  state: CombatState;
  fighters: Fighter[];
  byId: Map<number, Fighter>;
  /** monster combatant id -> player combatant id -> damage dealt by hits. */
  dmg: Map<number, Map<number, number>>;
  ended: boolean;
}

const FLEE_RULE: TacticRule = { cond: { k: 'always' }, act: { k: 'flee' } };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Facing toward (tx, ty) using the isometric mapping of game/movement.ts. */
function faceToward(e: Entity, tx: number, ty: number): void {
  const dx = Math.sign(tx - e.x);
  const dy = Math.sign(ty - e.y);
  const sx = Math.sign(dx - dy);
  const sy = Math.sign(dx + dy);
  if (sx === 0 && sy === 0) return;
  const prevRight = e.face === 0 || e.face === 3;
  const prevDown = e.face === 0 || e.face === 1;
  const right = sx === 0 ? prevRight : sx > 0;
  const down = sy === 0 ? prevDown : sy > 0;
  e.face = (down ? (right ? 0 : 1) : right ? 3 : 2) as Dir;
}

export function register(ctx: GameContext): void {
  const combats = new Map<number, Combat>();
  let nextId = 1;
  let regenTick = 0;

  const combatOf = (p: Player): Combat | undefined => (p.combatId !== null ? combats.get(p.combatId) : undefined);
  const isDead = (p: Player): boolean => p.entity.state === 'dead';

  // ------------------------------------------------------------------ construction

  function playerFighter(p: Player, side: 0 | 1, duel: boolean): Fighter {
    const now = ctx.now();
    const c = buildPlayerCombatant(p.save, p.entity.id, side, now);
    if (duel) {
      c.hp = c.maxHp;
      c.qi = c.maxQi;
      c.items = {};
    }
    const fastSchools = p.save.talents.flatMap((t) => TALENTS[t]?.fastSchools ?? []);
    return {
      c,
      entity: p.entity,
      player: p,
      baseTactics: c.tactics,
      fleeReq: 0,
      done: false,
      itemsSeen: {},
      usesSeen: {},
      learnRate: deriveForCharacter(p.save, now).learnRate,
      fastSchools,
    };
  }

  function monsterFighter(e: Entity): Fighter | null {
    const st = MONSTER.get(e);
    const def = st ? MONSTERS[st.defId] : undefined;
    if (!st || !def) return null;
    const c = monsterCombatant(def, st.level, st.elite, e.id);
    c.hp = clamp(Math.round(e.hp ?? c.maxHp), 1, c.maxHp);
    return { c, entity: e, player: null, baseTactics: [], fleeReq: 0, done: false, itemsSeen: {}, usesSeen: {}, learnRate: 1, fastSchools: [] };
  }

  function newCombat(x: number, y: number, duel: boolean, stake = 0): Combat {
    return { id: nextId++, x, y, duel, stake, state: { combatants: [], beat: 0 }, fighters: [], byId: new Map(), dmg: new Map(), ended: false };
  }

  function addFighter(cb: Combat, f: Fighter): void {
    cb.fighters.push(f);
    cb.byId.set(f.c.id, f);
    cb.state.combatants.push(f.c);
  }

  function lockPlayer(cb: Combat, p: Player, toward: Entity): void {
    ctx.movement.stop(p.entity, true);
    p.combatId = cb.id;
    p.entity.state = 'fight';
    p.entity.combatId = cb.id;
    faceToward(p.entity, toward.x, toward.y);
    ctx.entities.touch(p.entity);
    ctx.markMe(p);
  }

  function unlockPlayer(p: Player): void {
    p.combatId = null;
    p.entity.combatId = undefined;
    if (p.entity.state === 'fight') p.entity.state = 'idle';
    ctx.entities.touch(p.entity);
  }

  /** Why this player cannot start / join a PvE fight right now, or null. */
  function cannotFight(p: Player): string | null {
    if (!p.online) return 'offline';
    if (isDead(p)) return 'You are dead.';
    if (p.combatId !== null) return 'You are already fighting.';
    if (p.save.activity) return 'Stop what you are doing first.';
    if (p.save.hp <= 0) return 'You are too wounded to fight.';
    return null;
  }

  // ------------------------------------------------------------------ views

  function viewOf(cb: Combat): CombatView {
    return {
      id: cb.id,
      beat: cb.state.beat,
      x: cb.x,
      y: cb.y,
      duel: cb.duel,
      fighters: cb.fighters.map(
        (f): FighterView => ({
          id: f.c.id,
          name: f.c.name,
          side: f.c.side,
          lv: f.c.level,
          hp: Math.max(0, Math.round(f.c.hp)),
          maxHp: Math.round(f.c.maxHp),
          qi: Math.max(0, Math.round(f.c.qi)),
          maxQi: Math.round(f.c.maxQi),
          status: f.c.status.map((s) => s.kind),
          player: f.player !== null,
          alive: f.c.alive,
          fled: f.c.fled,
        }),
      ),
    };
  }

  function sendView(cb: Combat, ev: CombatEvent[]): void {
    const c = viewOf(cb);
    const inside = new Set<number>();
    for (const f of cb.fighters) {
      if (!f.player) continue;
      inside.add(f.player.charId);
      if (!f.done) ctx.send(f.player, { t: 'combat', c, ev });
    }
    if (ev.length) {
      for (const sp of ctx.players.near(cb.x, cb.y, AOI_RADIUS)) if (!inside.has(sp.charId)) ctx.send(sp, { t: 'cfx', ev });
    }
  }

  // ------------------------------------------------------------------ starting / joining

  function joinCombat(cb: Combat, p: Player): boolean {
    if (cb.ended || cb.duel) return false;
    const why = cannotFight(p);
    if (why) {
      if (why !== 'offline') ctx.notify(p, 'warn', why);
      return false;
    }
    if (cb.fighters.filter((f) => f.player && !f.done).length >= K.maxPlayers) {
      ctx.notify(p, 'warn', 'That fight is full.');
      return false;
    }
    if (dist(p.entity.x, p.entity.y, cb.x, cb.y) > K.assistRadius) {
      ctx.notify(p, 'warn', 'You are too far from the fight.');
      return false;
    }
    const f = playerFighter(p, 0, false);
    addFighter(cb, f);
    const foe = cb.fighters.find((x) => x.c.side === 1 && x.c.alive)?.entity;
    lockPlayer(cb, p, foe ?? p.entity);
    ctx.notify(p, 'info', 'You join the fight!');
    sendView(cb, []);
    return true;
  }

  function startFight(players: Player[], monster: Entity): boolean {
    const mon = getMonsterApi(ctx);
    const st = mon?.stateOf(monster);
    if (!mon || !st) return false;
    if (monster.combatId !== undefined) {
      const cb = combats.get(monster.combatId);
      if (!cb) return false;
      let joined = false;
      for (const p of players) joined = joinCombat(cb, p) || joined;
      return joined;
    }
    if (!mon.available(monster)) return false;
    const ps = players.filter((p) => cannotFight(p) === null).slice(0, K.maxPlayers);
    if (!ps.length) return false;
    const mobs = [monster, ...mon.mates(monster, K.mateRadius, K.maxMonsters - 1)];
    const cb = newCombat(monster.x, monster.y, false);
    for (const p of ps) addFighter(cb, playerFighter(p, 0, false));
    for (const m of mobs) {
      const f = monsterFighter(m);
      if (f) addFighter(cb, f);
    }
    if (!cb.fighters.some((f) => f.c.side === 1)) return false;
    combats.set(cb.id, cb);
    for (const p of ps) lockPlayer(cb, p, monster);
    for (const f of cb.fighters) {
      if (f.player) continue;
      mon.engage(f.entity, cb.id);
      faceToward(f.entity, ps[0].entity.x, ps[0].entity.y);
    }
    sendView(cb, []);
    return true;
  }

  function startDuel(a: Player, b: Player, stakeIn: number): boolean {
    if (a === b || !a.online || !b.online) return false;
    for (const p of [a, b]) {
      const why = cannotFight(p);
      if (why) {
        ctx.notify(a, 'warn', p === a ? why : `${p.name} cannot duel right now.`);
        if (p !== a) ctx.notify(p, 'warn', why);
        return false;
      }
    }
    const stake = Math.max(0, Math.floor(Number.isFinite(stakeIn) ? stakeIn : 0));
    if (stake > 0 && (a.save.gold < stake || b.save.gold < stake)) {
      ctx.notify(a, 'warn', 'Both duellists must be able to cover the stake.');
      ctx.notify(b, 'warn', 'Both duellists must be able to cover the stake.');
      return false;
    }
    const cb = newCombat(Math.round((a.entity.x + b.entity.x) / 2), Math.round((a.entity.y + b.entity.y) / 2), true, stake);
    addFighter(cb, playerFighter(a, 0, true));
    addFighter(cb, playerFighter(b, 1, true));
    combats.set(cb.id, cb);
    lockPlayer(cb, a, b.entity);
    lockPlayer(cb, b, a.entity);
    ctx.notify(a, 'info', `Duel with ${b.name} begins!`);
    ctx.notify(b, 'info', `Duel with ${a.name} begins!`);
    sendView(cb, []);
    return true;
  }

  // ------------------------------------------------------------------ per beat

  function tally(cb: Combat, src: number, dst: number, amount: number): void {
    const s = cb.byId.get(src);
    const d = cb.byId.get(dst);
    if (!s || !d || s.c.side !== 0 || d.c.side !== 1 || !s.player) return;
    let m = cb.dmg.get(dst);
    if (!m) {
      m = new Map();
      cb.dmg.set(dst, m);
    }
    m.set(src, (m.get(src) ?? 0) + amount);
  }

  function syncPlayer(cb: Combat, f: Fighter): void {
    const p = f.player!;
    if (cb.duel) {
      p.entity.hp = Math.max(0, Math.round(f.c.hp));
      p.entity.maxHp = Math.round(f.c.maxHp);
      ctx.entities.touch(p.entity);
      return;
    }
    p.save.hp = Math.max(0, Math.round(f.c.hp));
    p.save.qi = Math.max(0, Math.round(f.c.qi));
    for (const [id, used] of Object.entries(f.c.itemsUsed)) {
      const delta = used - (f.itemsSeen[id] ?? 0);
      if (delta <= 0) continue;
      f.itemsSeen[id] = used;
      removeItem(p.save, id, Math.min(delta, countItem(p.save, id)));
    }
    for (const [id, uses] of Object.entries(f.c.skillUses)) {
      const delta = uses - (f.usesSeen[id] ?? 0);
      if (delta <= 0) continue;
      f.usesSeen[id] = uses;
      const school = getSkill(id)?.school;
      const mult = school && f.fastSchools.includes(school) ? K.fastSchoolMult : 1;
      const gained = applySkillXp(p.save, id, Math.round(f.learnRate * delta * mult * 100) / 100);
      if (gained > 0) ctx.notify(p, 'good', `${getSkill(id)?.name ?? id} reaches level ${p.save.skills[id].lv}.`);
    }
    p.entity.hp = p.save.hp;
    ctx.entities.touch(p.entity);
    ctx.markDirty(p);
    ctx.markMe(p);
  }

  function runBeat(cb: Combat): void {
    for (const f of cb.fighters) if (f.player && f.fleeReq > 0 && f.c.alive && !f.c.fled) f.c.tactics = [FLEE_RULE, ...f.baseTactics];
    const ev = stepBeat(cb.state, ctx.rng);
    for (const f of cb.fighters) if (f.player) f.c.tactics = f.baseTactics;
    for (const e of ev) {
      if (e.k === 'flee') {
        const f = cb.byId.get(e.s);
        if (f) f.fleeReq = 0;
      } else if (e.k === 'hit') tally(cb, e.s, e.d, e.a);
    }
    for (const f of cb.fighters) if (f.fleeReq > 0) f.fleeReq--;

    for (const f of cb.fighters) {
      if (f.done) continue;
      if (f.player) syncPlayer(cb, f);
      else if (ctx.entities.has(f.entity.id)) {
        f.entity.hp = Math.max(0, Math.round(f.c.hp));
        ctx.entities.touch(f.entity);
      } else {
        f.c.alive = false;
        f.c.hp = 0;
      }
    }
    sendView(cb, ev);

    for (const f of cb.fighters) {
      if (!f.player || f.done) continue;
      if (f.c.fled) leaveFled(cb, f, true);
      else if (!f.c.alive && !cb.duel) playerDied(cb, f);
    }

    if (cb.ended) return;
    if (cb.duel) {
      const [a, b] = cb.fighters;
      const ra = a.c.hp / a.c.maxHp;
      const rb = b.c.hp / b.c.maxHp;
      if (ra <= K.duelEndFraction || rb <= K.duelEndFraction || !a.c.alive || !b.c.alive) endDuel(cb, ra === rb ? null : ra < rb ? a : b);
      return;
    }
    if (isOver(cb.state)) {
      const w = winner(cb.state);
      finishPve(cb, w === 0 ? 'win' : w === 1 ? 'lose' : 'draw');
    } else if (cb.state.beat >= K.maxBeats) finishPve(cb, 'draw');
  }

  function beatAll(): void {
    for (const cb of [...combats.values()]) {
      try {
        runBeat(cb);
      } catch (err) {
        ctx.log.error(`combat ${cb.id} failed; ending it`, err);
        abort(cb);
      }
    }
  }

  /** Emergency exit: free everybody, release monsters. */
  function abort(cb: Combat): void {
    if (cb.ended) return;
    cb.ended = true;
    combats.delete(cb.id);
    const mon = getMonsterApi(ctx);
    for (const f of cb.fighters) {
      if (f.player && !f.done) {
        unlockPlayer(f.player);
        ctx.markMe(f.player);
        ctx.send(f.player, { t: 'cend', id: cb.id, result: 'draw', text: 'The fight is broken off.' });
      } else if (!f.player) {
        if (f.c.alive) mon?.release(f.entity);
        else mon?.kill(f.entity, []);
      }
    }
  }

  // ------------------------------------------------------------------ leaving

  function leaveFled(cb: Combat, f: Fighter, notify: boolean): void {
    const p = f.player!;
    f.done = true;
    unlockPlayer(p);
    p.data.fleeLockUntil = ctx.now() + K.fleeLockMs;
    if (notify) p.data.fleeImmuneUntil = ctx.now() + K.fleeImmuneMs;
    ctx.markDirty(p);
    ctx.markMe(p);
    if (notify) ctx.send(p, { t: 'cend', id: cb.id, result: 'fled', text: 'You break away from the fight.' });
  }

  function playerDied(cb: Combat, f: Fighter): void {
    const p = f.player!;
    f.done = true;
    unlockPlayer(p);
    const s = p.save;
    const now = ctx.now();
    const lost = Math.floor(s.gold * K.goldLossFraction);
    s.gold -= lost;
    s.deaths++;
    const current = s.injuryUntil > now ? s.injuryStacks : 0;
    s.injuryStacks = Math.min(K.injuryMaxStacks, current + 1);
    s.injuryUntil = now + K.injuryMs;
    s.hp = 0;
    s.qi = 0;
    p.entity.state = 'dead';
    p.entity.hp = 0;
    ctx.entities.touch(p.entity);
    ctx.movement.stop(p.entity, true);
    p.data.respawnOff = ctx.after(K.respawnMs, () => respawn(p));
    ctx.sendNear(p.entity.x, p.entity.y, AOI_RADIUS, { t: 'fx', kind: 'death', entity: p.entity.id });
    ctx.send(p, { t: 'cend', id: cb.id, result: 'lose', text: lost > 0 ? `You have fallen and lost ${lost} gold.` : 'You have fallen.' });
    ctx.notify(p, 'bad', `You have fallen. You will awaken in ${Math.round(K.respawnMs / 1000)} seconds, wounded.`);
    ctx.markDirty(p);
    ctx.markMe(p);
    ctx.after(Math.round(K.injuryMs) + 200, () => {
      if (ctx.players.byCharId(p.charId) === p) ctx.markMe(p);
    });
    ctx.events.emit('playerDied', { player: p });
  }

  function respawn(p: Player): void {
    const off = p.data.respawnOff as (() => void) | undefined;
    off?.();
    delete p.data.respawnOff;
    if (!isDead(p) || ctx.players.byCharId(p.charId) !== p) return;
    const town = ctx.world.settlements[p.save.lastTown] ?? ctx.world.settlements[0];
    const spot = isPassable(ctx.world, town.spawn.x, town.spawn.y) ? town.spawn : (nearestWalkable(ctx.grid, town.spawn.x, town.spawn.y, 6) ?? town.spawn);
    ctx.movement.teleport(p.entity, spot.x, spot.y);
    const d = deriveForCharacter(p.save, ctx.now());
    p.save.hp = Math.max(1, Math.round(d.maxHp * K.respawnHpFraction));
    p.save.qi = Math.round(d.maxQi * K.respawnHpFraction);
    p.entity.state = 'idle';
    ctx.entities.touch(p.entity);
    ctx.markDirty(p);
    ctx.markMe(p);
    ctx.notify(p, 'info', `You awaken in ${town.name}, weak but alive.`);
  }

  /** A player drops out of whatever fight they are in (logout). */
  function leaveCombat(p: Player): void {
    const cb = combatOf(p);
    if (!cb) {
      if (p.combatId !== null) unlockPlayer(p);
      return;
    }
    const f = cb.byId.get(p.entity.id);
    if (!f || f.done) {
      unlockPlayer(p);
      return;
    }
    if (cb.duel) {
      endDuel(cb, f);
      return;
    }
    f.c.fled = true;
    syncPlayer(cb, f);
    leaveFled(cb, f, false);
    if (isOver(cb.state)) finishPve(cb, 'lose');
  }

  // ------------------------------------------------------------------ endings

  function finishPve(cb: Combat, outcome: 'win' | 'lose' | 'draw'): void {
    if (cb.ended) return;
    cb.ended = true;
    combats.delete(cb.id);
    const mon = getMonsterApi(ctx);
    const survivors = cb.fighters.filter((f) => f.player && !f.done && f.c.alive);
    const mobs = cb.fighters.filter((f) => !f.player);
    const now = ctx.now();
    const gains = new Map<Player, { xp: number; gold: number; items: ItemStack[]; kills: number }>();

    if (outcome === 'win') {
      for (const mf of mobs.filter((m) => !m.c.alive)) {
        const st = MONSTER.get(mf.entity);
        const def = st ? MONSTERS[st.defId] : undefined;
        if (!st || !def) continue;
        const tallies = cb.dmg.get(mf.c.id);
        let total = 0;
        for (const v of tallies?.values() ?? []) total += v;
        const share = (f: Fighter): number => (total > 0 ? (tallies?.get(f.c.id) ?? 0) / total : 1 / survivors.length);
        const credited = survivors.filter((f) => share(f) >= K.minShare).sort((a, b) => share(b) - share(a));
        for (const f of credited) {
          const p = f.player!;
          const fortune = deriveForCharacter(p.save, now).total.fortune;
          const drop = rollKillDrop(ctx.rng, p.save, def, st.level, st.elite, fortune);
          let g = gains.get(p);
          if (!g) {
            g = { xp: 0, gold: 0, items: [], kills: 0 };
            gains.set(p, g);
          }
          g.xp += killXp(def, st.level, st.elite, p.save.level);
          g.gold += drop.gold;
          g.items.push(...drop.items);
          g.kills++;
          if (def.family === 'bandit') banditReputation(p, mf.entity);
        }
        ctx.events.emit('monsterKilled', {
          killers: credited.map((f) => f.player!),
          entityId: mf.entity.id,
          defId: st.defId,
          family: def.family,
          level: st.level,
          elite: st.elite,
          x: mf.entity.x,
          y: mf.entity.y,
          spawnId: st.spawnId,
          siege: st.siege,
          bountyFor: st.bountyFor,
          heartId: st.heartId,
        });
        publishSimEvents(ctx, ctx.sim.recordKill(mf.entity.x, mf.entity.y, def.family, st.level, st.elite));
        mon?.kill(
          mf.entity,
          credited.map((f) => f.player!),
        );
      }
    }

    for (const mf of mobs) {
      if (!ctx.entities.has(mf.entity.id)) continue;
      if (!mf.c.alive) {
        if (MONSTER.get(mf.entity)?.mode !== 'dead') mon?.kill(mf.entity, []);
      } else mon?.release(mf.entity);
    }

    for (const f of survivors) {
      const p = f.player!;
      unlockPlayer(p);
      const g = gains.get(p);
      const reward: CombatReward = { xp: 0, gold: 0, items: [] };
      if (outcome === 'win' && g) {
        addGold(p.save, g.gold);
        reward.gold = g.gold;
        let lostItems = 0;
        for (const stack of g.items) {
          const added = addItem(p.save, stack);
          if (added > 0) reward.items.push({ ...stack, qty: added });
          lostItems += stack.qty - added;
        }
        if (lostItems > 0) ctx.notify(p, 'warn', 'Your pack is full; some loot was lost.');
        if (reward.items.length) ctx.send(p, { t: 'fx', kind: 'loot', entity: p.entity.id });
        p.save.kills += g.kills;
        reward.xp = grantXp(ctx, p, g.xp).gained;
      }
      const text =
        outcome === 'win'
          ? reward.xp || reward.gold
            ? `Victory! +${reward.xp} XP, +${reward.gold} gold${reward.items.length ? `, ${reward.items.length} item(s)` : ''}.`
            : 'Victory!'
          : 'You disengage from the stalemate.';
      ctx.send(p, { t: 'cend', id: cb.id, result: outcome === 'win' ? 'win' : 'draw', reward: outcome === 'win' ? reward : undefined, text });
      ctx.markDirty(p);
      ctx.markMe(p);
    }
  }

  function banditReputation(p: Player, monster: Entity): void {
    const near = nearestSettlement(ctx.world, monster.x, monster.y).id;
    const ctrl = ctx.sim.state.settlements[near]?.controller;
    if (ctrl && ctrl !== 'blackwind') addReputation(p.save, ctrl, 1);
    addReputation(p.save, 'blackwind', -1);
  }

  /** `loser` null = draw. */
  function endDuel(cb: Combat, loser: Fighter | null): void {
    if (cb.ended) return;
    cb.ended = true;
    combats.delete(cb.id);
    const winnerF = loser ? cb.fighters.find((f) => f !== loser)! : null;
    let paid = 0;
    if (loser && winnerF && cb.stake > 0) {
      paid = Math.min(cb.stake, loser.player!.save.gold);
      loser.player!.save.gold -= paid;
      addGold(winnerF.player!.save, paid);
    }
    for (const f of cb.fighters) {
      const p = f.player!;
      if (!f.done) {
        f.done = true;
        unlockPlayer(p);
        const result = !loser ? 'draw' : f === loser ? 'lose' : 'win';
        const text =
          result === 'draw'
            ? 'The duel ends in a draw.'
            : result === 'win'
              ? `You win the duel against ${cb.fighters.find((o) => o !== f)!.c.name}${paid ? ` and take ${paid} gold` : ''}.`
              : `You yield to ${cb.fighters.find((o) => o !== f)!.c.name}${paid ? ` and pay ${paid} gold` : ''}.`;
        ctx.send(p, { t: 'cend', id: cb.id, result, reward: result === 'win' ? { xp: 0, gold: paid, items: [] } : undefined, text });
      }
      ctx.markDirty(p);
      ctx.markMe(p);
    }
  }

  // ------------------------------------------------------------------ death / regeneration

  function regen(): void {
    regenTick++;
    const now = ctx.now();
    for (const p of ctx.players.online()) {
      if (p.combatId !== null || isDead(p) || (regenTick + p.charId) % K.regenEveryS !== 0) continue;
      const d = deriveForCharacter(p.save, now);
      if (p.save.hp >= d.maxHp && p.save.qi >= d.maxQi) continue;
      let mult = 1;
      if (!p.entity.move) {
        for (const s of ctx.world.settlements) {
          if (dist(p.entity.x, p.entity.y, s.x, s.y) <= s.radius) {
            mult = K.regenSettlementMult;
            break;
          }
        }
      }
      const hp0 = p.save.hp;
      p.save.hp = Math.min(d.maxHp, p.save.hp + Math.max(1, Math.round(d.maxHp * K.regenHp * mult)));
      p.save.qi = Math.min(d.maxQi, p.save.qi + Math.max(1, Math.round(d.maxQi * K.regenQi * mult)));
      p.entity.hp = p.save.hp;
      ctx.entities.touch(p.entity);
      ctx.markDirty(p);
      const marked = typeof p.data.regenMarkedHp === 'number' ? p.data.regenMarkedHp : hp0;
      if (p.save.hp >= d.maxHp || Math.abs(p.save.hp - marked) >= d.maxHp * 0.05) {
        p.data.regenMarkedHp = p.save.hp;
        ctx.markMe(p);
      }
    }
  }

  // ------------------------------------------------------------------ wiring

  ctx.movement.guards.push(
    (p) => (isDead(p) ? 'You are dead. You will awaken shortly.' : null),
    (p) => (typeof p.data.fleeLockUntil === 'number' && p.data.fleeLockUntil > ctx.now() ? 'You are catching your breath.' : null),
  );

  ctx.onInteract('monster', (p, e) => {
    const st = MONSTER.get(e);
    if (!st) return false;
    const mon = getMonsterApi(ctx);
    if (!mon || e.hidden || st.mode === 'dead') {
      ctx.notify(p, 'info', 'It is already dead.');
      return true;
    }
    if (st.bountyFor !== null && st.bountyFor !== p.charId && e.combatId === undefined) {
      ctx.notify(p, 'warn', 'This quarry is hunted by someone else.');
      return true;
    }
    if (e.combatId === undefined) {
      const why = cannotFight(p);
      if (why) {
        ctx.notify(p, 'warn', why);
        return true;
      }
    }
    if (!startFight([p], e)) ctx.notify(p, 'warn', 'You cannot fight that right now.');
    return true;
  });

  // Dead or fighting players cannot talk to NPCs (this handler runs before the NPC menu's).
  ctx.onInteract('npc', (p) => {
    if (isDead(p)) ctx.notify(p, 'warn', 'You are dead.');
    else if (p.combatId !== null) ctx.notify(p, 'warn', 'You cannot do that while fighting.');
    else return false;
    return true;
  });

  ctx.command('assist', (p, m) => {
    if (isDead(p)) throw new GameError('dead', 'You are dead.');
    const cb = combats.get(m.combat);
    if (!cb || cb.ended) throw new GameError('not_found', 'That fight is over.');
    if (cb.duel) throw new GameError('duel', 'You cannot join a duel.');
    if (p.combatId !== null) throw new GameError('in_combat', 'You are already fighting.');
    if (!joinCombat(cb, p)) throw new GameError('cannot_assist', 'You cannot join that fight.');
  });

  ctx.command('flee', (p) => {
    if (isDead(p)) throw new GameError('dead', 'You are dead.');
    const cb = combatOf(p);
    const f = cb?.byId.get(p.entity.id);
    if (!cb || !f || f.done) throw new GameError('not_in_combat', 'You are not fighting.');
    if (cb.duel) {
      endDuel(cb, f);
      return;
    }
    if (f.fleeReq === 0) {
      f.fleeReq = K.fleeRequestBeats;
      ctx.notify(p, 'info', 'You try to break away...');
    }
  });

  ctx.onLogout((p) => {
    leaveCombat(p);
    if (isDead(p)) respawn(p);
  });

  ctx.onLogin((p) => {
    if (p.save.hp <= 0 && !isDead(p)) {
      p.save.hp = Math.max(1, Math.round(deriveForCharacter(p.save, ctx.now()).maxHp * K.respawnHpFraction));
      ctx.markMe(p);
    }
  });

  ctx.every(COMBAT_BEAT_MS, beatAll);
  ctx.every(1000, regen);

  const api: CombatApi = {
    startFight,
    activeCount: () => combats.size,
    view: (id) => {
      const cb = combats.get(id);
      return cb ? viewOf(cb) : undefined;
    },
    beat: beatAll,
    isDead,
    respawnNow: respawn,
  };
  setCombatApi(ctx, api);
  getServices(ctx).combat = {
    startDuel,
    inCombat: (p) => p.combatId !== null,
  };
}
