/**
 * Test helpers for the siege battles (not a test file): a harness with the real (or stub) sim, the NPC life, monster,
 * combat and siege systems registered, and helpers to start sieges and run the clock.
 */
import { nearestWalkable } from '@murim/shared';
import type { GameContext } from '../ctx';
import { makeLifeHarness, type LifeHarness, type LifeHarnessOptions } from '../npclife/testkit';
import { register as registerCombat } from '../systems/combat';
import { getCombatApi, type CombatApi } from '../systems/combat/api';
import { register as registerMonsters, getMonsterApi } from '../systems/monsters';
import type { MonsterApi } from '../systems/monsters/state';
import { register as registerProgression } from '../systems/progression';
import { register as registerSiege } from '../systems/siege';
import { getSiege, type SiegeApi } from './index';

export interface SiegeScene {
  h: LifeHarness;
  ctx: GameContext;
  mon: MonsterApi;
  combat: CombatApi;
  siege: SiegeApi;
}

export function makeSiegeScene(opts: LifeHarnessOptions = {}): SiegeScene {
  const h = makeLifeHarness({ real: true, hourMs: 60_000, ...opts });
  const ctx = h.ctx;
  registerMonsters(ctx, { population: false });
  registerCombat(ctx);
  registerProgression(ctx);
  registerSiege(ctx);
  return { h, ctx, mon: getMonsterApi(ctx)!, combat: getCombatApi(ctx)!, siege: getSiege(ctx)! };
}

/** Put the settlement under siege through the siege API (sim state + the events the sim would emit). */
export function besiege(s: SiegeScene, sid: number, by: string, strength: number, hours = 6): void {
  if (!s.siege.forceSiege(sid, by, strength, hours)) throw new Error('could not start the siege');
}

/** A walkable tile near a settlement's centre where a player can stand. */
export function standNear(s: SiegeScene, sid: number): { x: number; y: number } {
  const def = s.ctx.world.settlements[sid];
  return nearestWalkable(s.ctx.grid, def.spawn.x, def.spawn.y, 6)!;
}

/** Tick (100 ms each) until `cond()` holds; returns the ticks used (max when it never held). */
export function tickUntil(h: LifeHarness, cond: () => boolean, max = 1200): number {
  for (let i = 0; i < max; i++) {
    if (cond()) return i;
    h.tick();
  }
  return max;
}
