/**
 * Test helpers for the gameplay-combat modules (not a test file). Owner: gameplay-combat.
 */
import { deriveForCharacter, nearestWalkable, type CharacterSave } from '@murim/shared';
import type { GameContext, Player } from '../../ctx';
import { makeHarness, type Harness } from '../../testkit';
import { register as registerCombat } from '../combat';
import { register as registerMonsters, getMonsterApi, type MonsterOptions } from '../monsters';
import { register as registerProgression } from '../progression';
import { getCombatApi } from './api';

export interface Scene {
  h: Harness;
  ctx: GameContext;
  /** A walkable tile far away from every settlement. */
  spot: { x: number; y: number };
  mon: NonNullable<ReturnType<typeof getMonsterApi>>;
  combat: NonNullable<ReturnType<typeof getCombatApi>>;
}

export function makeScene(opts: MonsterOptions = { population: false }): Scene {
  const h = makeHarness();
  const ctx = h.game.ctx;
  registerMonsters(ctx, opts);
  registerCombat(ctx);
  registerProgression(ctx);
  const sp = h.world.spawnPoints[0];
  const spot = nearestWalkable(h.game.grid, sp.x, sp.y, 6)!;
  return { h, ctx, spot, mon: getMonsterApi(ctx)!, combat: getCombatApi(ctx)! };
}

/** Nearest walkable tile to the scene spot offset by (dx, dy). */
export function nearSpot(s: Scene, dx: number, dy: number): { x: number; y: number } {
  return nearestWalkable(s.h.game.grid, s.spot.x + dx, s.spot.y + dy, 6)!;
}

/** Make a character strong enough to win fights against low-level monsters, with full vitals. */
export function powerUp(ctx: GameContext, p: Player, level = 20, stat = 40): void {
  const s: CharacterSave = p.save;
  s.level = level;
  s.xp = 0;
  for (const k of Object.keys(s.stats) as (keyof typeof s.stats)[]) s.stats[k] = stat;
  const d = deriveForCharacter(s, ctx.now());
  s.hp = d.maxHp;
  s.qi = d.maxQi;
  ctx.markMe(p);
}

/** Tick until `cond()` holds (max `max` ticks). Returns the number of ticks used. */
export function tickUntil(h: Harness, cond: () => boolean, max = 600): number {
  for (let i = 0; i < max; i++) {
    if (cond()) return i;
    h.tick();
  }
  return max;
}
