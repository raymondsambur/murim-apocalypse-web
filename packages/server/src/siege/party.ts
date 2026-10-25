/**
 * Who fights: the war party of the attackers (species, levels, captain, banner bearer) and the defenders of the
 * town (guards, masters, legends and a handful of militia from the villagers).
 */
import { MONSTERS, dist, levelForDanger, pickSpecies, type GearLook, type MonsterFamily, type NpcRole, type NpcState, type WeaponType } from '@murim/shared';
import type { Entity, GameContext } from '../ctx';
import { partySize } from './skirmish';
import { SIEGE_TUNING as T } from './tuning';

export type RaiderKind = 'grunt' | 'captain' | 'bearer';
export type DefenderKind = 'guard' | 'master' | 'legend' | 'militia';

export interface RaiderPlan {
  defId: string;
  level: number;
  elite: 0 | 1 | 2;
  kind: RaiderKind;
  power: number;
  toughness: number;
}

export interface DefenderPlan {
  npc: NpcState;
  orig: Entity;
  kind: DefenderKind;
  hpMult: number;
  power: number;
  toughness: number;
  weapon?: WeaponType;
  gear?: GearLook;
  role: NpcRole;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const familyOf = (by: string): MonsterFamily => (by === 'blight' ? 'blight' : 'bandit');

const dangerCache = new WeakMap<GameContext, Map<number, number>>();

/** Mean danger of the three spawn points nearest to a settlement (the same rule the monster module used). */
export function settlementDanger(ctx: GameContext, sid: number): number {
  let m = dangerCache.get(ctx);
  if (!m) dangerCache.set(ctx, (m = new Map()));
  let d = m.get(sid);
  if (d === undefined) {
    const s = ctx.world.settlements[sid];
    const near = [...ctx.world.spawnPoints].sort((a, b) => dist(a.x, a.y, s.x, s.y) - dist(b.x, b.y, s.x, s.y)).slice(0, 3);
    d = near.length ? near.reduce((a, p) => a + p.danger, 0) / near.length : 4;
    m.set(sid, d);
  }
  return d;
}

/** Plan a war party of `n` units (`n` defaults to the size the siege strength asks for). */
export function planParty(ctx: GameContext, sid: number, by: string, strength: number, n = partySize(strength)): RaiderPlan[] {
  const family = familyOf(by);
  const blight = family === 'blight' ? ctx.sim.state.settlements[sid]?.blight ?? 0 : 0;
  const base = clamp(levelForDanger(settlementDanger(ctx, sid), ctx.rng) + Math.floor(blight / 40), 1, 60);
  const out: RaiderPlan[] = [];
  const captains = clamp(Math.floor(n / T.unitsPerCaptain), 1, 3);
  for (let i = 0; i < n; i++) {
    const level = clamp(base + ctx.rng.int(-1, 1) + (i < captains ? 2 : 0), 1, 60);
    if (i < captains) {
      const def = captainSpecies(ctx, family, level);
      out.push({ defId: def.id, level: clamp(level, def.minLevel, def.maxLevel), elite: 1, kind: 'captain', power: 1.7 + level / 70, toughness: 1.4 });
    } else if (i === captains) {
      // the banner is carried by a person (a Hollow villager, a bandit thug), never by a hound
      const def = family === 'blight' ? MONSTERS.hollow : MONSTERS.thug;
      out.push({ defId: def.id, level: clamp(level, def.minLevel, def.maxLevel), elite: 0, kind: 'bearer', power: 0.7, toughness: 0.9 });
    } else {
      const def = pickSpecies(ctx.rng, family, level, false);
      out.push({ defId: def.id, level, elite: def.elite ? 1 : 0, kind: 'grunt', power: 1 + level / 90, toughness: 1 });
    }
  }
  return out;
}

/** The strongest species of the family that suits the level (an elite where one fits). */
function captainSpecies(ctx: GameContext, family: MonsterFamily, level: number) {
  const all = Object.values(MONSTERS).filter((m) => m.family === family && !m.boss);
  const fit = all.filter((m) => level >= m.minLevel - 4 && level <= m.maxLevel);
  const elites = fit.filter((m) => m.elite);
  const pool = elites.length ? elites : fit.length ? fit : all;
  return [...pool].sort((a, b) => b.hp * b.atk - a.hp * a.atk)[0] ?? pickSpecies(ctx.rng, family, level, true);
}

const KIND_MULT: Record<DefenderKind, { hp: number; power: number; tough: number }> = {
  guard: { hp: 1.3, power: 1, tough: 1 },
  master: { hp: 1.7, power: 1.8, tough: 1.4 },
  legend: { hp: 2.4, power: 3, tough: 2 },
  militia: { hp: 0.8, power: 0.6, tough: 0.8 },
};

/**
 * The defenders of a settlement: every living guard, master and legend that has an entity, plus up to `militiaMax`
 * of the strongest villagers (armed with a staff), capped by what the party size and the town's strength call for.
 */
export function planDefenders(ctx: GameContext, sid: number, units: number, defense: number, strength: number): DefenderPlan[] {
  const npcs = ctx.sim.npcs(sid).filter((n) => n.alive);
  const core: DefenderPlan[] = [];
  const villagers: NpcState[] = [];
  for (const n of npcs) {
    const orig = ctx.npcEntity(n.id);
    if (!orig) continue;
    if (n.role === 'guard' || n.role === 'master' || n.role === 'legend') {
      const kind: DefenderKind = n.role;
      const k = KIND_MULT[kind];
      core.push({ npc: n, orig, kind, hpMult: k.hp, power: k.power * (1 + n.level / 80), toughness: k.tough, role: n.role, weapon: n.role === 'guard' ? 'spear' : n.role === 'legend' ? 'sword' : (['sword', 'blade', 'staff', 'fist'] as const)[n.id % 4] });
    } else if (n.role === 'villager') villagers.push(n);
  }
  core.sort((a, b) => b.npc.level - a.npc.level);
  const want = clamp(Math.round(units * Math.sqrt(Math.max(5, defense) / Math.max(5, strength)) * T.defenderShare), T.defenderMin, T.defenderMax);
  const out = core.slice(0, T.defenderMax);
  villagers.sort((a, b) => b.level - a.level || a.id - b.id);
  const slots = Math.min(T.militiaMax, Math.max(0, want - out.length), Math.max(0, T.defenderMax - out.length));
  const k = KIND_MULT.militia;
  for (const n of villagers.slice(0, slots)) {
    const orig = ctx.npcEntity(n.id);
    if (!orig) continue;
    out.push({
      npc: n,
      orig,
      kind: 'militia',
      hpMult: k.hp,
      power: k.power * (1 + n.level / 80),
      toughness: k.tough,
      role: 'villager',
      weapon: 'staff',
      gear: { o: { t: 1, r: 0 }, w: { t: 1, r: 0 } },
    });
  }
  return out;
}
