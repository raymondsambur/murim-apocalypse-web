/**
 * Small service registry so gameplay modules can call each other without importing each other.
 * Each service is optional: its provider module registers it in `register(ctx)`; callers must
 * handle `undefined` (module disabled, or not registered yet in a test harness).
 * Stored per GameContext, so tests with several harnesses don't leak into each other.
 */
import type { Entity, GameContext, Player } from '../ctx';

export interface MonsterService {
  /**
   * Spawn a personal bounty target for `owner` (15-30 tiles from settlement `nearSettlement`, on passable land).
   * The entity is flagged `bountyFor = owner.charId`, despawns after 30 minutes, when the owner abandons,
   * or when killed (which emits `monsterKilled` with `bountyFor` set). Returns null if no spot was found.
   */
  spawnBounty(owner: Player, defId: string, level: number, elite: 1 | 2, nearSettlement: number): Entity | null;
  /** Remove any bounty target belonging to this character. */
  removeBounty(charId: number): void;
}

export interface CombatService {
  /** Start a friendly duel between two players. Returns false (and tells the players why) if impossible. */
  startDuel(a: Player, b: Player, stake: number): boolean;
  /** True while the player is inside a combat. */
  inCombat(p: Player): boolean;
}

export interface Services {
  combat?: CombatService;
  monsters?: MonsterService;
  /** Multipliers applied to XP gained by a player (sect bonus, disciple bonus...). Social registers these. */
  xpModifiers: Array<(p: Player) => number>;
}

const registry = new WeakMap<GameContext, Services>();

export function getServices(ctx: GameContext): Services {
  let s = registry.get(ctx);
  if (!s) {
    s = { xpModifiers: [] };
    registry.set(ctx, s);
  }
  return s;
}
