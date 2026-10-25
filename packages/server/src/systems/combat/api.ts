/**
 * Internal API of the combat manager, used by the monster module (aggro) and tests.
 * Owner: gameplay-combat.
 */
import type { CombatView } from '@murim/shared';
import type { Entity, GameContext, Player } from '../../ctx';

export interface CombatApi {
  /** Start (or join) a fight between `players` (side 0) and `monster` plus its free pack mates. */
  startFight(players: Player[], monster: Entity): boolean;
  /** Number of running combats. */
  activeCount(): number;
  /** Current view of a combat, if it is running. */
  view(id: number): CombatView | undefined;
  /** Run one combat beat for every combat right now (tests; normally driven by a 1000 ms timer). */
  beat(): void;
  /** True while the player is dead and waiting to respawn. */
  isDead(p: Player): boolean;
  /** Respawn a dead player right now (tests, logout). */
  respawnNow(p: Player): void;
}

const apis = new WeakMap<GameContext, CombatApi>();

export function setCombatApi(ctx: GameContext, api: CombatApi): void {
  apis.set(ctx, api);
}

export function getCombatApi(ctx: GameContext): CombatApi | undefined {
  return apis.get(ctx);
}
