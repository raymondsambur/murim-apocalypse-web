/** Static data derived once per world (terrain masks, stamps, road paths). Never serialized. */
import { T, TERRAIN_INFO, findPath, isRoadLike, type PathGrid, type WorldData } from '@murim/shared';
import { BLIGHT } from './constants';
import type { StaticData } from './types';
import { makeStamp } from './util';

const cache = new WeakMap<WorldData, StaticData>();

export function staticFor(world: WorldData): StaticData {
  let s = cache.get(world);
  if (!s) {
    s = build(world);
    cache.set(world, s);
  }
  return s;
}

function build(world: WorldData): StaticData {
  const { w, h } = world;
  const n = w * h;
  const land = new Uint8Array(n);
  let landCount = 0;
  for (let i = 0; i < n; i++) {
    if (TERRAIN_INFO[world.terrain[i]].passable) {
      land[i] = 1;
      landCount++;
    }
  }
  const rowBand = new Uint8Array(h);
  for (let y = 0; y < h; y++) rowBand[y] = y < h * 0.3 ? 0 : y > h * 0.68 ? 2 : 1;

  const defs = world.settlements;
  const start = defs[0];
  const ruin = defs.find((d) => d.kind === 'ruin');
  const isLand = (i: number) => land[i] === 1;
  const suppress = defs.map((d) => makeStamp(w, h, d.x, d.y, d.radius + BLIGHT.suppressExtra, 1.5, isLand));
  const avg = defs.map((d) => makeStamp(w, h, d.x, d.y, d.radius + BLIGHT.avgExtra, BLIGHT.avgPow, isLand));
  const fallen = defs.map((d) => makeStamp(w, h, d.x, d.y, d.radius + 2, 0.7, isLand));

  // Road paths: A* that strongly prefers the carved road tiles.
  const grid: PathGrid = {
    w,
    h,
    cost(x, y) {
      const t = world.terrain[y * w + x];
      if (isRoadLike(t)) return 0.3;
      if (t === T.Water) return 9;
      if (!TERRAIN_INFO[t].passable) return Infinity;
      return t === T.Hill ? 1.2 : 2.5;
    },
  };
  const roadTiles: Int32Array[] = [];
  const adj: [number, number][][] = defs.map(() => []);
  world.roads.forEach(([a, b], ri) => {
    const A = defs[a];
    const B = defs[b];
    const path = findPath(grid, A.x, A.y, B.x, B.y, 120000) ?? straightLine(A.x, A.y, B.x, B.y);
    const tiles: number[] = [];
    for (const p of path) {
      if (Math.hypot(p.x - A.x, p.y - A.y) <= A.radius || Math.hypot(p.x - B.x, p.y - B.y) <= B.radius) continue;
      const i = p.y * w + p.x;
      if (land[i]) tiles.push(i);
    }
    roadTiles.push(Int32Array.from(tiles));
    adj[a].push([b, ri]);
    adj[b].push([a, ri]);
  });

  const danger = defs.map((d) => 1 + Math.floor(Math.hypot(d.x - start.x, d.y - start.y) / 9));
  const buildings = defs.map((d) => d.buildingIds.map((id) => world.buildings[id]).filter((b) => !!b));
  const spawnsNear = defs.map((d) =>
    world.spawnPoints
      .map((sp) => ({ sp, dd: Math.hypot(sp.x - d.x, sp.y - d.y) }))
      .filter((e) => e.dd <= 48)
      .sort((p, q) => p.dd - q.dd || p.sp.id - q.sp.id)
      .map((e) => e.sp),
  );

  return {
    w,
    h,
    n,
    land,
    landCount,
    rowBand,
    startId: start.id,
    ruinId: ruin ? ruin.id : -1,
    defs,
    suppress,
    avg,
    fallen,
    roadTiles,
    adj,
    danger,
    buildings,
    spawnsNear,
    prev: new Uint8Array(n),
    src: new Float32Array(n),
  };
}

function straightLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= steps; k++) {
    const t = steps === 0 ? 0 : k / steps;
    out.push({ x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t) });
  }
  return out;
}
