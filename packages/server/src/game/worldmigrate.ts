import type { CharacterSave, WorldData } from '@murim/shared';
import type { Db } from '../db';
import type { Logger } from './log';

/** 32-bit FNV-1a hash of a string, as hex. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Identifies the generated world layout: seed, size, where the towns are and what stands in them (the kind and
 * position of every building). A town redesign that keeps the town centres in place still changes the signature,
 * so the saved world (NPC homes, rosters) is not carried over to a layout it was not made for.
 */
export function worldSignature(world: WorldData): string {
  const towns = world.settlements.map((s) => `${s.x},${s.y}`).join(';');
  const buildings = fnv(world.buildings.map((b) => `${b.kind}:${b.x},${b.y}`).join(';'));
  return `${world.seed}:${world.w}x${world.h}:${towns}:b${world.buildings.length}-${buildings}`;
}

/** How far past a town's radius a saved NPC home may lie before it counts as "not in this town". */
const HOME_MARGIN = 14;

/**
 * False when a saved simulation was made for a different map layout: most of its living NPCs have a home far
 * outside the town they belong to (the town moved, the NPC's saved home did not). Such a snapshot would send
 * innkeepers and guards walking across the wilderness to where their old town used to be. Used for snapshots
 * that predate the stored layout signature; later ones are compared by signature.
 */
export function simFitsWorld(world: WorldData, saved: { json: string }): boolean {
  let npcs: { alive?: boolean; settlementId?: number; homeX?: number; homeY?: number }[];
  try {
    npcs = (JSON.parse(saved.json) as { npcs?: typeof npcs }).npcs ?? [];
  } catch {
    return true; // unreadable: restoreState reports it properly
  }
  let total = 0;
  let outside = 0;
  for (const n of npcs) {
    if (!n.alive || typeof n.homeX !== 'number' || typeof n.homeY !== 'number') continue;
    const s = world.settlements[n.settlementId ?? -1];
    if (!s) continue;
    total++;
    if (Math.hypot(n.homeX - s.x, n.homeY - s.y) > s.radius + HOME_MARGIN) outside++;
  }
  return total < 8 || outside * 2 <= total;
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
