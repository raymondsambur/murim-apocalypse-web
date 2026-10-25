/**
 * Shared monster types, tuning knobs and the internal `MonsterApi` that the combat manager (and tests)
 * use to talk to the monster module. Owner: gameplay-combat.
 */
import { buildMonsterCombatant, dist, type Combatant, type MonsterDef, type MonsterFamily } from '@murim/shared';
import { DataKey, type Entity, type GameContext, type Player } from '../../ctx';

/** Tuning knobs for the monster module (all times in ms unless noted). */
export const MONSTER_TUNING = {
  /** AI think interval for monsters near players. */
  aiIntervalMs: 500,
  /** Monsters within this many tiles of an online player are "active" (AOI radius + a little). */
  activeRadius: 30,
  /** Safe zone: no spawning / aggro within `settlement.radius + SAFE_MARGIN`. */
  safeMargin: 2,
  /** Pack members spawn within this radius of the spawn point. */
  packRadius: 3,
  /** Blight packs only exist while the blight at their spawn point is at least this high. */
  blightActive: 25,
  /** Extra monster levels per N blight points (blight packs and blight sieges). */
  blightLevelDiv: 40,
  /** Chance that a pack (danger >= eliteMinDanger) contains one elite. */
  eliteChance: 0.12,
  eliteMinDanger: 5,
  /** Respawn delay of a wiped pack: min(cap, base + danger * perDanger) seconds. */
  respawnBaseS: 60,
  respawnPerDangerS: 8,
  respawnCapS: 300,
  /** A pack only respawns when no player is within this many tiles of its spawn point. */
  respawnPlayerFree: 12,
  /** How often pack activation / respawn is evaluated. */
  packCheckMs: 2000,
  /** Dead monsters keep their corpse visible for this long before being hidden / removed. */
  corpseMs: 3000,
  /** Monster speed relative to a speed-1.0 player is `speedFactor * def.speed / 100`. */
  speedFactor: 0.9,
  /** Aggro modifiers. */
  fogAggroMult: 0.5,
  nightAggroMult: 1.2,
  nightFrom: 20,
  nightTo: 5,
  /** Chasing: give up beyond this distance from home, or after this long without getting closer. */
  leashTiles: 14,
  chaseNoProgressMs: 12_000,
  /** Idle wandering. */
  wanderChance: 0.07,
  wanderRadius: 3,
  maxWandersPerThink: 8,
  maxPathsPerThink: 14,
  /** Idle regeneration (fraction of max HP per think) for hurt monsters standing at home. */
  idleRegen: 0.1,
  /** After a failed engage / path, ignore players for this long. */
  ignoreMs: 4000,
  /** Siege waves. */
  siegeCycleMs: 10_000,
  siegeMin: 3,
  siegeMax: 14,
  siegeStrengthPerMonster: 5,
  siegeRingMin: 8,
  siegeRingMax: 14,
  siegeTopUpPerCycle: 3,
  /** Blight heart bosses. */
  heartBossBaseLevel: 30,
  heartBossCooldownMs: 30 * 60_000,
  heartBossIdleMs: 10 * 60_000,
  heartDamage: 60,
  /** Bounty targets. */
  bountyDistMin: 15,
  bountyDistMax: 30,
  bountyLifeMs: 30 * 60_000,
  /** Dynamic monster upkeep (bounty expiry, boss idle) sweep interval. */
  upkeepMs: 5000,
} as const;

export type MonsterMode = 'idle' | 'chase' | 'return' | 'fight' | 'dead';

export interface MonsterState {
  defId: string;
  level: number;
  elite: 0 | 1 | 2;
  /** World spawn point id (pack monsters), else null. */
  spawnId: number | null;
  siege: number | null;
  bountyFor: number | null;
  heartId: number | null;
  homeX: number;
  homeY: number;
  wanderRadius: number;
  mode: MonsterMode;
  /** Character id being chased. */
  targetChar: number | null;
  chaseStart: number;
  lastProgress: number;
  bestDist: number;
  ignoreUntil: number;
  /** Bounty targets expire at this time (0 = never). */
  expiresAt: number;
  /** Remove (instead of hide) the corpse; also set for monsters that must vanish after their fight. */
  ephemeral: boolean;
  /** Despawn as soon as the monster is free (siege ended, pack went dormant, bounty abandoned). */
  despawnWhenFree: boolean;
  /** Last time a player was seen nearby (heart bosses despawn when abandoned). */
  lastSeen: number;
  returnTries: number;
  /**
   * Driven by another module (the siege module's war parties): the AI think skips it, and a fight that ends
   * without its death hands it back (mode 'idle', no walk home) instead of sending it to its home tile.
   */
  controlled?: boolean;
}

export const MONSTER = new DataKey<MonsterState>('monster');

export interface SpawnSpec {
  defId: string;
  level: number;
  x: number;
  y: number;
  /** Defaults to what the definition implies (boss 2, elite 1, else 0). */
  elite?: 0 | 1 | 2;
  spawnId?: number | null;
  siege?: number | null;
  bountyFor?: number | null;
  heartId?: number | null;
  expiresAt?: number;
  wanderRadius?: number;
  /** Corpse is removed instead of hidden (siege, bounty, boss and test spawns). Default true. */
  ephemeral?: boolean;
  /** See MonsterState.controlled. */
  controlled?: boolean;
}

/** Internal API of the monster module (used by the combat manager, other modules may use it too). */
export interface MonsterApi {
  /** Create a monster entity (no safe-zone / pack rules applied: callers decide where). */
  spawn(spec: SpawnSpec): Entity | null;
  stateOf(e: Entity): MonsterState | undefined;
  /** Alive, visible and not in a fight. */
  available(e: Entity): boolean;
  /** Free pack / siege mates of `e` within `radius` tiles (nearest first, at most `max`). */
  mates(e: Entity, radius: number, max: number): Entity[];
  /** A fight started: lock the monster. */
  engage(e: Entity, combatId: number): void;
  /** The monster was killed by `killers` (hide / remove later, pack bookkeeping, heart damage). */
  kill(e: Entity, killers: Player[]): void;
  /** The fight ended without the monster dying: walk home and heal (or vanish when it should). */
  release(e: Entity): void;
  /** Remove the entity now (deferred to the end of its fight when it is fighting). */
  despawn(e: Entity): void;
  isSafeZone(x: number, y: number): boolean;
  /** Number of monsters processed by the last AI think (for tests / diagnostics). */
  lastThinkCount(): number;
  /** Number of live monster entities managed by this module. */
  population(): number;
  /** Run one AI think immediately (tests). */
  think(): void;
  /** Evaluate pack activation / respawns immediately (tests). */
  checkPacks(): void;
  /** Evaluate sieges immediately (tests). */
  checkSieges(): void;
  /**
   * Hand the ownership of siege waves to another module (the siege module): the built-in ring of siege monsters is
   * dismantled and never spawned again. Without a delegate this module keeps spawning its own wave.
   */
  delegateSieges(): void;
}

const apis = new WeakMap<GameContext, MonsterApi>();

export function setMonsterApi(ctx: GameContext, api: MonsterApi): void {
  apis.set(ctx, api);
}

export function getMonsterApi(ctx: GameContext): MonsterApi | undefined {
  return apis.get(ctx);
}

export function defElite(def: MonsterDef): 0 | 1 | 2 {
  return def.boss ? 2 : def.elite ? 1 : 0;
}

const HP_MULT = [1, 1.6, 2.5] as const;
const ATK_MULT = [1, 1.15, 1.3] as const;
const DEF_MULT = [1, 1.1, 1.2] as const;
/** Matches `monsterStats`: elite defs pay x2.2 XP, boss defs x8. */
const XP_MULT = [1, 2.2, 8] as const;

export interface EliteBoost {
  hp: number;
  atk: number;
  def: number;
  xp: number;
}

/** Extra multipliers when a monster is "more elite" than its definition implies (bounty targets). */
export function eliteBoost(def: MonsterDef, elite: 0 | 1 | 2): EliteBoost {
  const base = defElite(def);
  if (elite <= base) return { hp: 1, atk: 1, def: 1, xp: 1 };
  return { hp: HP_MULT[elite] / HP_MULT[base], atk: ATK_MULT[elite] / ATK_MULT[base], def: DEF_MULT[elite] / DEF_MULT[base], xp: XP_MULT[elite] / XP_MULT[base] };
}

/** Combat stats of a monster entity (shared engine stats plus the elite boost). */
export function monsterCombatant(def: MonsterDef, level: number, elite: 0 | 1 | 2, id: number): Combatant {
  const c = buildMonsterCombatant(def, level, id, 1);
  const b = eliteBoost(def, elite);
  if (b.hp !== 1) {
    c.maxHp = Math.round(c.maxHp * b.hp);
    c.hp = c.maxHp;
    c.atk *= b.atk;
    c.def *= b.def;
  }
  return c;
}

/** True inside the safe zone of any settlement that has not fallen. */
export function isSafeZone(ctx: GameContext, x: number, y: number): boolean {
  const states = ctx.sim.state.settlements;
  for (const s of ctx.world.settlements) {
    const st = states[s.id]?.id === s.id ? states[s.id] : states.find((x) => x.id === s.id);
    if (st?.status === 'fallen') continue;
    if (dist(x, y, s.x, s.y) <= s.radius + MONSTER_TUNING.safeMargin) return true;
  }
  return false;
}

export function isNight(hour: number): boolean {
  return hour >= MONSTER_TUNING.nightFrom || hour < MONSTER_TUNING.nightTo;
}

export function familyOfSiege(siegeBy: string | null | undefined): MonsterFamily {
  return !siegeBy || siegeBy === 'blight' ? 'blight' : 'bandit';
}
