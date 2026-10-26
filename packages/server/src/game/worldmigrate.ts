import type { CharacterSave, WorldData } from '@murim/shared';
import type { Db } from '../db';
import type { Logger } from './log';

/** Identifies the generated world layout: seed, size and where the towns are. */
export function worldSignature(world: WorldData): string {
  return `${world.seed}:${world.w}x${world.h}:${world.settlements.map((s) => `${s.x},${s.y}`).join(';')}`;
}

/**
 * If the world layout changed since the server last ran (new size, new seed, regenerated map), every saved
 * position is meaningless: the same coordinates may now be deep wilderness, or inside a Blight zone. Move all
 * characters to the spawn point of their last town, once, and remember the layout. Does nothing when the
 * layout is unchanged, so normal restarts keep everyone exactly where they were.
 * Returns how many characters were moved.
 */
export function relocateCharactersIfWorldChanged(db: Db, world: WorldData, log: Logger, now: number): number {
  const sig = worldSignature(world);
  if (db.kvGet('world_sig') === sig) return 0;
  let moved = 0;
  const rows = db.all<{ id: number; json: string }>('SELECT id, json FROM characters');
  for (const row of rows) {
    let save: CharacterSave;
    try {
      save = JSON.parse(row.json) as CharacterSave;
    } catch {
      continue;
    }
    const town = world.settlements[save.lastTown] ?? world.settlements[0];
    save.x = town.spawn.x;
    save.y = town.spawn.y;
    db.saveCharacter(save, now);
    moved++;
  }
  db.kvSet('world_sig', sig);
  if (moved > 0) log.info(`world layout changed: moved ${moved} character(s) to the spawn point of their last town`);
  return moved;
}
