/**
 * Gameplay systems registered into the runtime at boot, in order.
 *
 * Each module exports `register(ctx: GameContext): void` and hooks into the context
 * (`ctx.command`, `ctx.query`, `ctx.onTick`, `ctx.onHour`, `ctx.onInteract`, ...). See docs/notes/server-core.md.
 * Cross-module helpers: `lib.ts` (inventory, XP), `events.ts` (typed events), `services.ts` (combat/monster services).
 * Systems are registered once, before the world starts. A system that throws while registering aborts the boot.
 *
 * Ownership (one agent per row; edit only your own files):
 *   gameplay-combat     monsters, combat, progression
 *   gameplay-economy    inventory, shops, npcmenu, nodes, missions
 *   gameplay-activities activities
 *   gameplay-social     sects, masters, friends, duels
 */
import type { SystemModule } from '../ctx';
import { register as registerNodes } from './nodes';
import { register as registerMonsters } from './monsters';
import { register as registerCombat } from './combat';
import { register as registerProgression } from './progression';
import { register as registerInventory } from './inventory';
import { register as registerShops } from './shops';
import { register as registerNpcMenu } from './npcmenu';
import { register as registerMissions } from './missions';
import { register as registerActivities } from './activities';
import { register as registerSects } from './sects';
import { register as registerMasters } from './masters';
import { register as registerFriends } from './friends';
import { register as registerDuels } from './duels';
import { register as registerNpcMemory } from './npcmemory';
import { register as registerNpcLife } from './npclife';

export const systems: SystemModule[] = [
  registerNodes,
  registerMonsters,
  registerCombat,
  registerProgression,
  registerInventory,
  registerShops,
  registerNpcMenu,
  registerMissions,
  registerActivities,
  registerSects,
  registerMasters,
  registerFriends,
  registerDuels,
  registerNpcLife,
  registerNpcMemory,
];
