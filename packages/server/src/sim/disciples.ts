/**
 * Disciples: the young people who live and train in a compound (a sect hall, or a town that keeps a master and a drill
 * yard). Named NPCs of role `disciple`, outer or inner, each under a master.
 *
 * They are a view of the masters' `disciples` count: the abstract number that random-walks 0..6 per master (see
 * `npcsDaily`) says how many students the compound can keep, and this module makes that many real. A compound holds
 * between its floor and its ceiling (`COMPOUNDS`) whatever the masters' numbers sum to.
 *
 * They never touch the sim's random stream: every roll here is a hash of the world seed, the hour and the NPC, and the
 * Rng used to build a disciple is a derived one, so the roster the sim had before disciples existed is unchanged.
 */
import { FACTIONS, Rng, hash32, type NpcState, type SettlementKind } from '@murim/shared';
import { dayOf } from './clock';
import { createNpc } from './npcs';
import type { Ctx } from './types';
import { emit } from './util';

/** Head-count a compound keeps: [floor, ceiling]. */
export const COMPOUNDS: Partial<Record<SettlementKind, readonly [number, number]>> = {
  sectHall: [6, 10],
  town: [4, 6],
};

/** Level at which an outer disciple is raised to inner disciple, and the level a graduate leaves at. */
export const INNER_LEVEL = 9;
export const GRADUATE_LEVEL = 15;

export const OUTER_TITLE = 'Outer Disciple';
export const INNER_TITLE = 'Inner Disciple';

/** A float in [0, 1) from the world seed, the current hour, an id and a salt: the module's only source of chance. */
export function hash01(ctx: Ctx, id: number, salt: number): number {
  return hash32(ctx.st.seed, ctx.st.clock.totalHours, id, 0xd15c0 + salt) / 4294967296;
}

export function hashChance(ctx: Ctx, id: number, p: number, salt = 0): boolean {
  return hash01(ctx, id, salt) < p;
}

/** The (floor, ceiling) of a settlement, or null when it keeps no compound. */
export function compoundOf(ctx: Ctx, sid: number): readonly [number, number] | null {
  const kind = ctx.S.defs[sid].kind;
  const range = COMPOUNDS[kind];
  if (!range) return null;
  const blds = ctx.S.buildings[sid];
  if (kind === 'sectHall') return blds.some((b) => b.kind === 'dormitory') || blds.some((b) => b.kind === 'dojo') ? range : null;
  // a town keeps a small compound only where a master teaches and a yard stands
  return blds.some((b) => b.kind === 'yard') && blds.some((b) => b.kind === 'dojo') ? range : null;
}

function mastersAt(ctx: Ctx, sid: number): NpcState[] {
  return ctx.st.npcs.filter((n) => n.alive && n.role === 'master' && n.settlementId === sid);
}

function disciplesAt(ctx: Ctx, sid: number): NpcState[] {
  return ctx.st.npcs.filter((n) => n.alive && n.role === 'disciple' && n.settlementId === sid);
}

/** How many disciples the compound should hold now. */
export function discipleTarget(ctx: Ctx, sid: number): number {
  const range = compoundOf(ctx, sid);
  if (!range) return 0;
  const masters = mastersAt(ctx, sid);
  if (masters.length === 0) return 0;
  const want = masters.reduce((a, m) => a + m.disciples, 0);
  return Math.max(range[0], Math.min(range[1], want));
}

/** Run `fn` with the sim's Rng swapped for one derived from the world: nothing in it advances the real stream. */
function withDerivedRng<T>(ctx: Ctx, a: number, b: number, fn: () => T): T {
  const prev = ctx.rng;
  ctx.rng = new Rng(hash32(ctx.st.seed, a, b, 0xd15c1));
  try {
    return fn();
  } finally {
    ctx.rng = prev;
  }
}

/** The master with the fewest students, ties by id. */
function leastBusyMaster(ctx: Ctx, sid: number): NpcState | null {
  const masters = mastersAt(ctx, sid);
  if (masters.length === 0) return null;
  const load = (m: NpcState) => ctx.st.npcs.filter((n) => n.alive && n.role === 'disciple' && n.mentor === m.id).length;
  return masters.reduce((best, m) => (load(m) < load(best) || (load(m) === load(best) && m.id < best.id) ? m : best));
}

/** A uniform for the compound: robes in the colour of the faction, a plain sash. */
function dressAsDisciple(ctx: Ctx, npc: NpcState): void {
  const f = FACTIONS.findIndex((x) => x.id === npc.faction);
  const k = f >= 0 ? f : npc.id;
  npc.look = { ...npc.look, outfit: 1, outfitColor: k % 10, sashColor: (k * 3 + 1) % 8, accessory: 0 };
}

export function spawnDisciple(ctx: Ctx, sid: number, mentor: NpcState, inner: boolean): NpcState {
  const day = dayOf(ctx.st.clock.totalHours);
  return withDerivedRng(ctx, sid * 100003 + day, ctx.st.nextNpcId, () => {
    const rng = ctx.rng;
    const level = inner ? rng.int(INNER_LEVEL, GRADUATE_LEVEL - 2) : rng.int(3, INNER_LEVEL - 1);
    const npc = createNpc(ctx, { role: 'disciple', sid, level, age: rng.int(15, 30), faction: mentor.faction, title: inner ? INNER_TITLE : OUTER_TITLE });
    npc.mentor = mentor.id;
    dressAsDisciple(ctx, npc);
    return npc;
  });
}

/** The starting roster: every compound is filled to its target, a third of the students already inner disciples. */
export function initDisciples(ctx: Ctx): void {
  for (const s of ctx.st.settlements) {
    if (s.status === 'fallen') continue;
    const target = discipleTarget(ctx, s.id);
    for (let i = 0; i < target; i++) {
      const mentor = leastBusyMaster(ctx, s.id);
      if (!mentor) break;
      spawnDisciple(ctx, s.id, mentor, i % 3 === 2);
    }
  }
}

const DISCIPLE_HAZARD = { plague: 0.003, siege: 0.004, blight: 0.0015 };

/** Once a day: ageing, training, promotion, losses, new mentors, and arrivals and departures towards the target. */
export function disciplesDaily(ctx: Ctx): void {
  const st = ctx.st;
  const roster = st.npcs.filter((n) => n.alive && n.role === 'disciple');
  for (const n of roster) {
    const s = st.settlements[n.settlementId];
    n.age = Math.round((n.age + 1 / 120) * 1000) / 1000;
    // slow training: an outer disciple reaches the inner ranks in about a season and a half
    n.xp += 1;
    if (n.level < GRADUATE_LEVEL && n.xp >= 18 + n.level * 2) {
      n.xp = 0;
      n.level++;
      if (n.title === OUTER_TITLE && n.level >= INNER_LEVEL) {
        n.title = INNER_TITLE;
        emit(ctx, { k: 'npcMoved', id: n.id });
      }
    }
    if (!s || s.status === 'fallen') continue;
    const hazard = s.siegeUntil > st.clock.totalHours ? DISCIPLE_HAZARD.siege : s.flags.includes('plague') ? DISCIPLE_HAZARD.plague : s.blight > 70 ? DISCIPLE_HAZARD.blight : 0;
    if (hazard > 0 && hashChance(ctx, n.id, hazard, 2)) {
      n.alive = false;
      n.diedDay = dayOf(st.clock.totalHours);
      n.causeOfDeath = s.siegeUntil > st.clock.totalHours ? 'fighting' : s.flags.includes('plague') ? 'plague' : 'blight';
      emit(ctx, { k: 'npcDied', id: n.id });
      st.ext.stats.npcDeaths = (st.ext.stats.npcDeaths ?? 0) + 1;
    }
  }
  // a master who died leaves students without a teacher: the least busy master of the compound takes them on
  for (const n of st.npcs) {
    if (!n.alive || n.role !== 'disciple') continue;
    const m = n.mentor != null ? ctx.npcById.get(n.mentor) : undefined;
    if (m && m.alive && m.settlementId === n.settlementId) continue;
    const next = leastBusyMaster(ctx, n.settlementId);
    n.mentor = next ? next.id : null;
  }
  // arrivals and departures towards each compound's target, one a day at most
  for (const s of st.settlements) {
    if (s.status === 'fallen') continue;
    const range = compoundOf(ctx, s.id);
    if (!range) continue;
    const here = disciplesAt(ctx, s.id);
    const target = discipleTarget(ctx, s.id);
    if (here.length < target) {
      const mentor = leastBusyMaster(ctx, s.id);
      if (mentor && hashChance(ctx, s.id, 0.6, 3)) spawnDisciple(ctx, s.id, mentor, false);
    } else if (here.length > target) {
      // the most advanced inner disciple has learned all there is here: they go out to seek the road
      const grads = here.filter((n) => n.title === INNER_TITLE && n.level >= GRADUATE_LEVEL - 1);
      const pool = grads.length ? grads : here;
      const leave = pool.reduce((best, n) => (n.level > best.level || (n.level === best.level && n.id < best.id) ? n : best));
      if (hashChance(ctx, s.id, grads.length ? 0.5 : 0.2, 4)) {
        leave.alive = false;
        leave.diedDay = dayOf(st.clock.totalHours);
        leave.causeOfDeath = 'left the sect';
        emit(ctx, { k: 'npcDied', id: leave.id });
      }
    }
  }
}
