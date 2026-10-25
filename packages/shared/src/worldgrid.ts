import { O, T, TERRAIN_INFO, objectBlocks, type WorldData } from './terrain';
import type { PathGrid } from './pathfinding';

export function tileIndex(world: { w: number }, x: number, y: number): number {
  return y * world.w + x;
}

export function inWorld(world: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h;
}

export function isPassable(world: WorldData, x: number, y: number): boolean {
  if (!inWorld(world, x, y)) return false;
  const i = y * world.w + x;
  return TERRAIN_INFO[world.terrain[i]].passable && !objectBlocks(world.objects[i]);
}

/** Movement speed multiplier of a tile (0 if blocked). */
export function tileSpeed(world: WorldData, x: number, y: number): number {
  if (!isPassable(world, x, y)) return 0;
  return TERRAIN_INFO[world.terrain[y * world.w + x]].speed;
}

export function worldPathGrid(world: WorldData): PathGrid {
  return {
    w: world.w,
    h: world.h,
    cost(x, y) {
      const s = tileSpeed(world, x, y);
      return s > 0 ? 1 / s : Infinity;
    },
  };
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function nearestSettlement(world: WorldData, x: number, y: number): { id: number; d: number } {
  let best = 0;
  let bestD = Infinity;
  for (const s of world.settlements) {
    const d = dist(x, y, s.x, s.y);
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return { id: best, d: bestD };
}

/** Flood fill over passable tiles, returns reached tile count and whether every target was reached. */
export function reachableFrom(world: WorldData, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(world.w * world.h);
  if (!isPassable(world, sx, sy)) return seen;
  const stack = [sy * world.w + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % world.w;
    const cy = (cur / world.w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isPassable(world, nx, ny)) continue;
      const ni = ny * world.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

export function isRoadLike(t: number): boolean {
  return t === T.Dirt || t === T.Road || t === T.Plaza || t === T.Bridge;
}

export const NO_OBJECT = O.None;
