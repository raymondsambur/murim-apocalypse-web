import { Rng } from './rng';
import { fbm, smoothstep } from './noise';
import { WORLD_H, WORLD_W } from './constants';
import {
  O,
  T,
  TERRAIN_INFO,
  objectBlocks,
  type BuildingDef,
  type BuildingKind,
  type MonsterFamily,
  type NodeKind,
  type ResourceNodeDef,
  type SettlementDef,
  type SettlementKind,
  type SpawnPointDef,
  type WorkSiteDef,
  type WorldData,
} from './terrain';
import { findPath, type PathGrid } from './pathfinding';
import { dist, isPassable, reachableFrom } from './worldgrid';
import { settlementName } from './data/names';

/** Tuning knobs for terrain shape. */
const SEA_DEEP = 0.3;
const SEA_SHALLOW = 0.38;
const MOUNTAIN = 0.9;
const HILL = 0.76;
const CONTRAST = 1.9;
const BASE_LIFT = 0.2;
const FALL_START = 0.66;
const FALL_STRENGTH = 0.55;

interface Ctx {
  w: number;
  h: number;
  seed: number;
  rng: Rng;
  height: Float32Array;
  terrain: Uint8Array;
  objects: Uint8Array;
  buildings: BuildingDef[];
  settlements: SettlementDef[];
  nodes: ResourceNodeDef[];
  nextNodeId: number;
}

const ix = (c: { w: number }, x: number, y: number) => y * c.w + x;
const inB = (c: { w: number; h: number }, x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h;
const isWaterT = (t: number) => t === T.DeepWater || t === T.Water;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function makeHeight(c: Ctx): void {
  const { w, h, seed } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (fbm(x / 34, y / 34, seed, 5) - 0.5) * CONTRAST + 0.5;
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = ((y + 0.5) / h) * 2 - 1;
      const d = Math.sqrt(nx * nx * 0.85 + ny * ny * 1.05);
      const fall = smoothstep(FALL_START, 1.02, d);
      c.height[ix(c, x, y)] = n + BASE_LIFT - fall * FALL_STRENGTH;
    }
  }
}

function makeTerrain(c: Ctx): void {
  const { w, h, seed } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ix(c, x, y);
      const hh = c.height[i];
      const moist = fbm(x / 28 + 100, y / 28 + 100, seed + 77, 4);
      const north = y < h * 0.2;
      let t: number;
      if (hh < SEA_DEEP) t = T.DeepWater;
      else if (hh < SEA_SHALLOW) t = T.Water;
      else if (hh > MOUNTAIN) t = T.Rock;
      else if (hh > HILL) t = north ? T.Snow : T.Hill;
      else if (north && moist < 0.5) t = T.Snow;
      else if (moist > 0.53) t = T.Forest;
      else if (moist > 0.42) t = T.Grass;
      else t = T.Plains;
      c.terrain[i] = t;
    }
  }
}

function carveRivers(c: Ctx): void {
  const { w, h, rng } = c;
  const sources: { x: number; y: number }[] = [];
  for (let tries = 0; tries < 1200 && sources.length < 6; tries++) {
    const x = rng.int(8, w - 9);
    const y = rng.int(8, h - 9);
    const t = c.terrain[ix(c, x, y)];
    if ((t === T.Rock || t === T.Hill) && sources.every((s) => dist(s.x, s.y, x, y) > 40)) sources.push({ x, y });
  }
  for (const s of sources) {
    let x = s.x;
    let y = s.y;
    const visited = new Set<number>();
    let uphill = 0;
    for (let step = 0; step < 320; step++) {
      const i = ix(c, x, y);
      visited.add(i);
      if (isWaterT(c.terrain[i]) && step > 0) break;
      if (c.terrain[i] !== T.Rock) c.terrain[i] = T.Water;
      let best = -1;
      let bestScore = Infinity;
      const here = c.height[i];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inB(c, nx, ny) || visited.has(ix(c, nx, ny))) continue;
        const score = c.height[ix(c, nx, ny)] + rng.next() * 0.03;
        if (score < bestScore) {
          bestScore = score;
          best = ix(c, nx, ny);
        }
      }
      if (best < 0) break;
      if (c.height[best] > here) uphill++;
      else uphill = 0;
      if (uphill > 10) break;
      x = best % w;
      y = (best / w) | 0;
    }
  }
}

function makeShores(c: Ctx): void {
  const { w, h } = c;
  const copy = c.terrain.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = copy[ix(c, x, y)];
      if (t !== T.Grass && t !== T.Plains && t !== T.Forest) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isWaterT(copy[ix(c, x + dx, y + dy)])) near = true;
      if (near && c.height[ix(c, x, y)] < SEA_SHALLOW + 0.05) c.terrain[ix(c, x, y)] = T.Sand;
    }
  }
}

function scatterObjects(c: Ctx): void {
  const { w, h, seed, rng } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ix(c, x, y);
      const t = c.terrain[i];
      const r = rng.next();
      let o: number = O.None;
      if (t === T.Forest) {
        const dens = fbm(x / 9, y / 9, seed + 5, 3);
        const bamboo = fbm(x / 20 + 40, y / 20 + 40, seed + 9, 3) > 0.62;
        if (r < 0.2 + dens * 0.42) o = bamboo ? O.Bamboo : y < h * 0.3 || c.height[i] > 0.66 ? O.Pine : r < 0.12 ? O.Oak : O.Oak;
        else if (r < 0.5) o = O.Bush;
      } else if (t === T.Grass) {
        if (r < 0.025) o = O.Oak;
        else if (r < 0.1) o = O.Bush;
        else if (r < 0.14) o = O.Flowers;
      } else if (t === T.Plains) {
        if (r < 0.02) o = O.Boulder;
        else if (r < 0.06) o = O.Bush;
      } else if (t === T.Hill) {
        if (r < 0.09) o = O.Boulder;
        else if (r < 0.14) o = O.Pine;
      } else if (t === T.Snow) {
        if (r < 0.07) o = O.Pine;
        else if (r < 0.1) o = O.Boulder;
      } else if (t === T.Sand) {
        if (r < 0.15) o = O.Reeds;
      }
      c.objects[i] = o;
    }
  }
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

interface Cand {
  x: number;
  y: number;
  score: number;
}

function findCandidates(c: Ctx, loose: boolean): Cand[] {
  const R = 10;
  const out: Cand[] = [];
  // Settlements flatten their own ground, so only water/mountain coverage and extreme relief matter.
  const maxBad = loose ? 80 : 36;
  const maxRange = loose ? 0.6 : 0.4;
  for (let y = R + 3; y < c.h - R - 3; y += 3) {
    for (let x = R + 3; x < c.w - R - 3; x += 3) {
      const t = c.terrain[ix(c, x, y)];
      if (t !== T.Grass && t !== T.Plains && t !== T.Forest) continue;
      let bad = 0;
      let lo = 9;
      let hi = -9;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const i = ix(c, x + dx, y + dy);
          if (!TERRAIN_INFO[c.terrain[i]].passable) bad++;
          const hh = c.height[i];
          if (hh < lo) lo = hh;
          if (hh > hi) hi = hh;
        }
      }
      if (bad > maxBad || hi - lo > maxRange) continue;
      out.push({ x, y, score: -bad - (hi - lo) * 30 + c.rng.float(0, 4) });
    }
  }
  return out;
}

function pickSites(c: Ctx, cands: Cand[], count: number): Cand[] {
  const tx = c.w * 0.5;
  const ty = c.h * 0.74;
  let start = cands[0];
  let bestD = Infinity;
  for (const k of cands) {
    const d = dist(k.x, k.y, tx, ty) - k.score * 0.4;
    if (d < bestD) {
      bestD = d;
      start = k;
    }
  }
  const chosen = [start];
  // Minimum distance between settlements (tiles); relaxed in steps only if the map cannot hold them all.
  let sep = 60;
  while (chosen.length < count && sep >= 30) {
    const scored = cands
      .map((k) => ({ k, d: Math.min(...chosen.map((s) => dist(s.x, s.y, k.x, k.y))) }))
      .filter((e) => e.d >= sep)
      .sort((a, b) => b.d - a.d);
    if (scored.length === 0) {
      sep -= 3;
      continue;
    }
    chosen.push(c.rng.pick(scored.slice(0, Math.min(5, scored.length))).k);
  }
  return chosen;
}

const KINDS_FULL: SettlementKind[] = ['village', 'hamlet', 'town', 'village', 'fort', 'sectHall', 'town', 'ruin'];

function kindsFor(count: number): SettlementKind[] {
  if (count >= KINDS_FULL.length) return KINDS_FULL.concat(Array(count - KINDS_FULL.length).fill('hamlet') as SettlementKind[]).slice(0, count);
  const base: SettlementKind[] = ['village', 'town', 'sectHall', 'fort', 'hamlet', 'village', 'town'];
  const kinds = base.slice(0, Math.max(0, count - 1));
  kinds.push('ruin');
  return kinds;
}

interface Layout {
  radius: number;
  houses: number;
  extra: BuildingKind[];
  farms: number;
  population: number;
}

const LAYOUTS: Record<SettlementKind, Layout> = {
  village: { radius: 11, houses: 7, extra: ['inn', 'smithy', 'alchemy', 'market', 'shrine', 'herbHut'], farms: 2, population: 220 },
  hamlet: { radius: 8, houses: 4, extra: ['farmhouse', 'herbHut', 'shrine'], farms: 1, population: 90 },
  town: { radius: 14, houses: 12, extra: ['inn', 'inn', 'smithy', 'alchemy', 'market', 'market', 'teahouse', 'shrine', 'warehouse', 'dojo', 'herbHut'], farms: 2, population: 600 },
  fort: { radius: 13, houses: 3, extra: ['barracks', 'barracks', 'barracks', 'smithy', 'market', 'inn', 'alchemy'], farms: 0, population: 320 },
  sectHall: { radius: 13, houses: 5, extra: ['pagoda', 'hall', 'hall', 'dojo', 'dojo', 'alchemy', 'shrine', 'teahouse'], farms: 0, population: 260 },
  ruin: { radius: 13, houses: 0, extra: [], farms: 0, population: 0 },
};

const FOOTPRINT: Record<BuildingKind, [number, number]> = {
  house: [3, 3],
  inn: [4, 4],
  smithy: [3, 3],
  alchemy: [3, 3],
  market: [4, 3],
  shrine: [2, 2],
  pagoda: [5, 5],
  hall: [4, 5],
  dojo: [4, 4],
  farmhouse: [3, 3],
  herbHut: [2, 2],
  mineEntrance: [2, 2],
  tower: [2, 2],
  gate: [3, 2],
  barracks: [4, 3],
  ruinedHouse: [3, 3],
  warehouse: [4, 3],
  teahouse: [3, 3],
};

function setLand(c: Ctx, x: number, y: number, t: number): void {
  if (!inB(c, x, y)) return;
  c.terrain[ix(c, x, y)] = t;
}

function rectFree(c: Ctx, placed: BuildingDef[], x: number, y: number, w: number, d: number, margin: number): boolean {
  for (let yy = y - margin; yy < y + d + margin; yy++) {
    for (let xx = x - margin; xx < x + w + margin; xx++) {
      if (!inB(c, xx, yy)) return false;
      const i = ix(c, xx, yy);
      const inside = xx >= x && xx < x + w && yy >= y && yy < y + d;
      if (inside) {
        if (!TERRAIN_INFO[c.terrain[i]].passable || c.terrain[i] === T.Road || c.terrain[i] === T.Plaza || c.terrain[i] === T.Farm) return false;
        if (c.objects[i] === O.Building || c.objects[i] === O.Wall) return false;
      } else if (c.objects[i] === O.Building || c.objects[i] === O.Wall) return false;
    }
  }
  for (const b of placed) {
    if (x - margin < b.x + b.w && x + w + margin > b.x && y - margin < b.y + b.d && y + d + margin > b.y) return false;
  }
  return true;
}

function localGrid(c: Ctx): PathGrid {
  return {
    w: c.w,
    h: c.h,
    cost(x, y) {
      const i = ix(c, x, y);
      if (!TERRAIN_INFO[c.terrain[i]].passable) return Infinity;
      if (c.objects[i] === O.Building || c.objects[i] === O.Wall) return Infinity;
      const t = c.terrain[i];
      return t === T.Road || t === T.Plaza || t === T.Dirt ? 0.5 : 1;
    },
  };
}

function buildSettlement(c: Ctx, id: number, site: Cand, kind: SettlementKind, name: string): SettlementDef {
  const L = LAYOUTS[kind];
  const R = L.radius;
  const cx = site.x;
  const cy = site.y;
  const rng = c.rng.fork(1000 + id);
  const def: SettlementDef = {
    id,
    name,
    kind,
    x: cx,
    y: cy,
    radius: R,
    climate: cy < c.h * 0.3 ? 0 : cy > c.h * 0.68 ? 2 : 1,
    spawn: { x: cx, y: cy + 3 },
    buildingIds: [],
    sites: [],
    population: L.population,
  };

  // Clear the ground.
  for (let dy = -R - 2; dy <= R + 2; dy++) {
    for (let dx = -R - 2; dx <= R + 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inB(c, x, y) || dx * dx + dy * dy > (R + 2) * (R + 2)) continue;
      const i = ix(c, x, y);
      if (!TERRAIN_INFO[c.terrain[i]].passable && c.terrain[i] !== T.Water) {
        if (c.terrain[i] === T.Rock || isWaterT(c.terrain[i])) continue;
      }
      if (c.terrain[i] === T.Water || c.terrain[i] === T.DeepWater || c.terrain[i] === T.Rock) continue;
      c.terrain[i] = kind === 'ruin' && rng.chance(0.35) ? T.Ruin : T.Grass;
      c.objects[i] = kind === 'ruin' && rng.chance(0.05) ? O.DeadTree : rng.chance(0.03) ? O.Flowers : O.None;
    }
  }

  // Fort walls.
  if (kind === 'fort') {
    const wr = R - 1;
    for (let d = -wr; d <= wr; d++) {
      for (const [x, y] of [
        [cx + d, cy - wr],
        [cx + d, cy + wr],
        [cx - wr, cy + d],
        [cx + wr, cy + d],
      ] as const) {
        if (!inB(c, x, y)) continue;
        const gate = Math.abs(x - cx) <= 1 && (y === cy - wr || y === cy + wr);
        const gate2 = Math.abs(y - cy) <= 1 && (x === cx - wr || x === cx + wr);
        if (gate || gate2) {
          c.terrain[ix(c, x, y)] = T.Road;
          c.objects[ix(c, x, y)] = O.None;
        } else {
          c.objects[ix(c, x, y)] = O.Wall;
          if (c.terrain[ix(c, x, y)] === T.Water) c.terrain[ix(c, x, y)] = T.Grass;
        }
      }
    }
  }

  // Cross roads and plaza.
  const road = kind === 'ruin' ? T.Dirt : T.Road;
  for (let d = -R - 1; d <= R + 1; d++) {
    for (const [x, y] of [
      [cx + d, cy],
      [cx, cy + d],
    ] as const) {
      if (!inB(c, x, y)) continue;
      const t = c.terrain[ix(c, x, y)];
      if (t === T.Water || t === T.DeepWater || t === T.Rock) continue;
      c.terrain[ix(c, x, y)] = road;
      if (c.objects[ix(c, x, y)] !== O.Wall) c.objects[ix(c, x, y)] = O.None;
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (kind !== 'ruin') setLand(c, cx + dx, cy + dy, T.Plaza);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) c.objects[ix(c, cx + dx, cy + dy)] = O.None;

  // Buildings.
  const placed: BuildingDef[] = [];
  const queue: BuildingKind[] = [];
  if (kind === 'ruin') for (let k = 0; k < 13; k++) queue.push('ruinedHouse');
  else {
    for (const e of L.extra) queue.push(e);
    for (let k = 0; k < L.houses; k++) queue.push('house');
  }
  queue.sort((a, b) => FOOTPRINT[b][0] * FOOTPRINT[b][1] - FOOTPRINT[a][0] * FOOTPRINT[a][1]);
  const inner = kind === 'fort' ? R - 3 : R - 1;
  for (const bk of queue) {
    const [bw, bd] = FOOTPRINT[bk];
    let ok = false;
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rad = 4 + rng.next() * (inner - 3);
      const bx = Math.round(cx + Math.cos(ang) * rad - bw / 2);
      const by = Math.round(cy + Math.sin(ang) * rad - bd / 2);
      // Keep the cross roads and plaza clear.
      if (Math.abs(bx + bw / 2 - cx) < bw / 2 + 1.6 || Math.abs(by + bd / 2 - cy) < bd / 2 + 1.6) continue;
      if (Math.max(Math.abs(bx - cx), Math.abs(by - cy), Math.abs(bx + bw - cx), Math.abs(by + bd - cy)) > inner) continue;
      if (!rectFree(c, placed, bx, by, bw, bd, 1)) continue;
      const door = { x: bx + (bw >> 1), y: by + bd };
      if (!inB(c, door.x, door.y) || !TERRAIN_INFO[c.terrain[ix(c, door.x, door.y)]].passable) continue;
      const b: BuildingDef = { id: c.buildings.length, kind: bk, x: bx, y: by, w: bw, d: bd, settlementId: id, door };
      c.buildings.push(b);
      placed.push(b);
      def.buildingIds.push(b.id);
      for (let yy = by; yy < by + bd; yy++) for (let xx = bx; xx < bx + bw; xx++) c.objects[ix(c, xx, yy)] = O.Building;
      ok = true;
    }
  }

  // Towers on fort corners.
  if (kind === 'fort') {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const bx = cx + sx * (R - 1) - (sx > 0 ? 1 : 0);
      const by = cy + sy * (R - 1) - (sy > 0 ? 1 : 0);
      const b: BuildingDef = { id: c.buildings.length, kind: 'tower', x: bx, y: by, w: 2, d: 2, settlementId: id, door: { x: bx + 1, y: by + 2 } };
      c.buildings.push(b);
      def.buildingIds.push(b.id);
      for (let yy = by; yy < by + 2; yy++) for (let xx = bx; xx < bx + 2; xx++) if (inB(c, xx, yy)) c.objects[ix(c, xx, yy)] = O.Building;
    }
  }

  // Footpaths from every door to the town centre.
  const grid = localGrid(c);
  for (const b of placed) {
    const p = findPath(grid, b.door.x, b.door.y, cx, cy + 1, 4000);
    if (!p) continue;
    for (const s of [{ x: b.door.x, y: b.door.y }, ...p]) {
      const i = ix(c, s.x, s.y);
      const t = c.terrain[i];
      if (t === T.Road || t === T.Plaza) break;
      if (t === T.Grass || t === T.Plains || t === T.Forest || t === T.Sand || t === T.Snow || t === T.Ruin) c.terrain[i] = T.Dirt;
    }
  }

  // Farm patches on the outskirts.
  for (let f = 0; f < L.farms; f++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rad = R + 3 + rng.next() * 3;
      const fx = Math.round(cx + Math.cos(ang) * rad) - 2;
      const fy = Math.round(cy + Math.sin(ang) * rad) - 2;
      let good = true;
      for (let yy = fy; yy < fy + 5 && good; yy++) {
        for (let xx = fx; xx < fx + 5; xx++) {
          if (!inB(c, xx, yy)) { good = false; break; }
          const t = c.terrain[ix(c, xx, yy)];
          if (t !== T.Grass && t !== T.Plains && t !== T.Forest) { good = false; break; }
        }
      }
      if (!good) continue;
      for (let yy = fy; yy < fy + 5; yy++) for (let xx = fx; xx < fx + 5; xx++) { c.terrain[ix(c, xx, yy)] = T.Farm; c.objects[ix(c, xx, yy)] = O.None; }
      def.sites.push({ id: `${id}:farm:${f}`, kind: 'farm', x: fx + 2, y: fy + 2, settlementId: id });
      break;
    }
  }

  // Work sites tied to buildings.
  const siteMap: Partial<Record<BuildingKind, WorkSiteDef['kind']>> = { herbHut: 'herbHut', smithy: 'smithy', alchemy: 'alchemyLab', dojo: 'dojo' };
  let n = 0;
  for (const b of placed) {
    const sk = siteMap[b.kind];
    if (!sk) continue;
    def.sites.push({ id: `${id}:${sk}:${n++}`, kind: sk, x: b.door.x, y: b.door.y, settlementId: id });
  }

  def.spawn = { x: cx, y: cy + 3 };
  return def;
}

function addMines(c: Ctx): void {
  for (const s of c.settlements) {
    if (s.kind === 'ruin' || s.kind === 'sectHall') continue;
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -18; dy <= 18; dy++) {
      for (let dx = -18; dx <= 18; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (!inB(c, x, y)) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 18 || d < s.radius + 3) continue;
        const t = c.terrain[ix(c, x, y)];
        if (t !== T.Hill && t !== T.Grass && t !== T.Plains && t !== T.Snow) continue;
        if (c.objects[ix(c, x, y)] === O.Building) continue;
        let rockNear = false;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
          if (inB(c, x + ox, y + oy) && c.terrain[ix(c, x + ox, y + oy)] === T.Rock) rockNear = true;
        }
        if (!rockNear) continue;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) {
      c.objects[ix(c, best.x, best.y)] = O.None;
      // The entrance is a decoration on a walkable tile (it does not block movement).
      const b: BuildingDef = { id: c.buildings.length, kind: 'mineEntrance', x: best.x, y: best.y, w: 1, d: 1, settlementId: s.id, door: { x: best.x, y: best.y + 1 } };
      c.buildings.push(b);
      s.buildingIds.push(b.id);
      s.sites.push({ id: `${s.id}:mine:0`, kind: 'mine', x: best.x, y: best.y, settlementId: s.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

function roadGrid(c: Ctx, allowRock: boolean): PathGrid {
  return {
    w: c.w,
    h: c.h,
    cost(x, y) {
      const i = ix(c, x, y);
      const o = c.objects[i];
      if (o === O.Building || o === O.Wall) return Infinity;
      const t = c.terrain[i];
      let base: number;
      switch (t) {
        case T.DeepWater: return Infinity;
        case T.Water: base = 7; break;
        case T.Rock: if (!allowRock) return Infinity; base = 30; break;
        case T.Hill: base = 2.6; break;
        case T.Forest: base = 1.8; break;
        case T.Snow: base = 1.7; break;
        case T.Sand: base = 1.1; break;
        case T.Farm: base = 3; break;
        case T.Dirt: case T.Road: case T.Plaza: case T.Bridge: base = 0.35; break;
        case T.Ruin: base = 1.2; break;
        default: base = 1;
      }
      return base + (objectBlocks(o) ? 1.5 : 0);
    },
  };
}

function connect(c: Ctx, a: SettlementDef, b: SettlementDef): boolean {
  const ends = (s: SettlementDef) =>
    [
      { x: s.x + s.radius + 1, y: s.y },
      { x: s.x - s.radius - 1, y: s.y },
      { x: s.x, y: s.y + s.radius + 1 },
      { x: s.x, y: s.y - s.radius - 1 },
    ]
      .filter((p) => inB(c, p.x, p.y))
      .sort((p, q) => dist(p.x, p.y, b === s ? a.x : b.x, b === s ? a.y : b.y) - dist(q.x, q.y, b === s ? a.x : b.x, b === s ? a.y : b.y));
  for (const allowRock of [false, true]) {
    const grid = roadGrid(c, allowRock);
    for (const from of ends(a)) {
      for (const to of ends(b)) {
        const path = findPath(grid, from.x, from.y, to.x, to.y, 90000);
        if (!path) continue;
        for (const p of [from, ...path]) {
          const i = ix(c, p.x, p.y);
          const t = c.terrain[i];
          if (t === T.Water) c.terrain[i] = T.Bridge;
          else if (t === T.Rock) c.terrain[i] = T.Hill;
          else if (t !== T.Road && t !== T.Plaza && t !== T.Bridge) c.terrain[i] = T.Dirt;
          if (c.objects[i] !== O.Wall) c.objects[i] = O.None;
        }
        return true;
      }
    }
  }
  return false;
}

function buildRoads(c: Ctx): [number, number][] {
  const S = c.settlements;
  const edges: [number, number][] = [];
  const has = (a: number, b: number) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  // Prim MST.
  const inTree = new Set<number>([0]);
  while (inTree.size < S.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of inTree) {
      for (const s of S) {
        if (inTree.has(s.id)) continue;
        const d = dist(S[a].x, S[a].y, s.x, s.y);
        if (d < bestD) { bestD = d; best = [a, s.id]; }
      }
    }
    if (!best) break;
    edges.push(best);
    inTree.add(best[1]);
  }
  // A few extra links so the road network has loops.
  for (const s of S) {
    const near = S.filter((o) => o.id !== s.id && !has(s.id, o.id)).sort((p, q) => dist(s.x, s.y, p.x, p.y) - dist(s.x, s.y, q.x, q.y));
    if (near[0] && dist(s.x, s.y, near[0].x, near[0].y) < 70 && c.rng.chance(0.55)) edges.push([s.id, near[0].id]);
  }
  const done: [number, number][] = [];
  for (const [a, b] of edges) if (connect(c, S[a], S[b])) done.push([a, b]);
  return done;
}

/** Carve a straight causeway between two points; used only when A* roads could not join a settlement. */
function carveLine(c: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 2000; guard++) {
    for (const [ox, oy] of [[0, 0], [1, 0]] as const) {
      const px = x + ox;
      const py = y + oy;
      if (!inB(c, px, py)) continue;
      const i = ix(c, px, py);
      const t = c.terrain[i];
      if (t === T.Water || t === T.DeepWater) c.terrain[i] = T.Bridge;
      else if (t === T.Rock) c.terrain[i] = T.Hill;
      else if (t !== T.Road && t !== T.Plaza && t !== T.Bridge) c.terrain[i] = T.Dirt;
      c.objects[i] = O.None;
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function ensureConnected(c: Ctx, world: WorldData): void {
  const start = c.settlements[0];
  for (let pass = 0; pass < 12; pass++) {
    const reach = reachableFrom(world, start.spawn.x, start.spawn.y);
    const isReached = (s: SettlementDef) => isPassable(world, s.spawn.x, s.spawn.y) && reach[ix(c, s.spawn.x, s.spawn.y)] === 1;
    const lost = c.settlements.find((s) => !isReached(s));
    if (!lost) return;
    const anchors = c.settlements.filter(isReached);
    anchors.sort((a, b) => dist(a.x, a.y, lost.x, lost.y) - dist(b.x, b.y, lost.x, lost.y));
    const to = anchors[0] ?? start;
    // The spawn tile itself may be blocked on odd seeds.
    c.terrain[ix(c, lost.spawn.x, lost.spawn.y)] = T.Road;
    c.objects[ix(c, lost.spawn.x, lost.spawn.y)] = O.None;
    carveLine(c, lost.spawn.x, lost.spawn.y, to.spawn.x, to.spawn.y);
  }
}

// ---------------------------------------------------------------------------
// Spawns and resources
// ---------------------------------------------------------------------------

function placeSpawnsAndNodes(c: Ctx, world: WorldData): { spawns: SpawnPointDef[]; nodes: ResourceNodeDef[] } {
  const rng = c.rng.fork(9090);
  const start = c.settlements[0];
  const ruin = c.settlements.find((s) => s.kind === 'ruin');
  const spawns: SpawnPointDef[] = [];
  const reach = reachableFrom(world, start.spawn.x, start.spawn.y);
  const okTile = (x: number, y: number) => inB(c, x, y) && reach[ix(c, x, y)] === 1 && c.objects[ix(c, x, y)] === O.None;

  const farFromSettlements = (x: number, y: number, margin: number) => c.settlements.every((s) => dist(x, y, s.x, s.y) > s.radius + margin);
  const nearRoad = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!inB(c, x + dx, y + dy)) continue;
      const t = c.terrain[ix(c, x + dx, y + dy)];
      if (t === T.Dirt || t === T.Bridge) return true;
    }
    return false;
  };

  // Pack count scales with area (the original 192x128 world used 56).
  const maxSpawns = Math.round((56 * c.w * c.h) / (192 * 128));
  for (let tries = 0; tries < 16000 && spawns.length < maxSpawns; tries++) {
    const x = rng.int(4, c.w - 5);
    const y = rng.int(4, c.h - 5);
    const t = c.terrain[ix(c, x, y)];
    if (t !== T.Grass && t !== T.Plains && t !== T.Forest && t !== T.Hill && t !== T.Snow && t !== T.Sand) continue;
    if (!okTile(x, y)) continue;
    if (!farFromSettlements(x, y, 6)) continue;
    if (spawns.some((s) => dist(s.x, s.y, x, y) < 11)) continue;
    const dStart = dist(x, y, start.x, start.y);
    if (dStart < 16) continue;
    const dRuin = ruin ? dist(x, y, ruin.x, ruin.y) : 999;
    let family: MonsterFamily = 'beast';
    if (dRuin < 56 && rng.chance(0.6)) family = 'blight';
    else if (dStart > 34 && nearRoad(x, y, 8) && rng.chance(0.7)) family = 'bandit';
    // Danger grows with distance from the starting village (about +1 per 13 tiles on the larger map).
    const danger = 1 + Math.floor(dStart / 13) + (family === 'blight' ? 2 : 0);
    spawns.push({ id: spawns.length, x, y, family, radius: 4, danger, packSize: Math.min(4, 1 + Math.floor(danger / 4) + rng.int(0, 1)) });
  }

  // Guarantee bandit country: convert the beast packs closest to roads (far enough from the start) if too few formed.
  const wantBandits = Math.round((10 * c.w * c.h) / (192 * 128));
  let banditCount = spawns.filter((s) => s.family === 'bandit').length;
  if (banditCount < wantBandits) {
    const roadDist = (x: number, y: number) => {
      let best = 99;
      for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
        if (!inB(c, x + dx, y + dy)) continue;
        const t = c.terrain[ix(c, x + dx, y + dy)];
        if (t === T.Dirt || t === T.Bridge) best = Math.min(best, Math.hypot(dx, dy));
      }
      return best;
    };
    const candidates = spawns
      .filter((s) => s.family === 'beast' && dist(s.x, s.y, start.x, start.y) > 24)
      .map((s) => ({ s, d: roadDist(s.x, s.y) }))
      .sort((a, b) => a.d - b.d);
    for (const { s } of candidates) {
      if (banditCount >= wantBandits) break;
      s.family = 'bandit';
      banditCount++;
    }
  }

  const nodes: ResourceNodeDef[] = [];
  const addNode =(kind: NodeKind, x: number, y: number) => nodes.push({ id: c.nextNodeId++, kind, x, y });
  const spread = (kind: NodeKind, count: number, accept: (x: number, y: number, t: number) => boolean) => {
    for (let tries = 0, got = 0; tries < 20000 && got < count; tries++) {
      const x = rng.int(3, c.w - 4);
      const y = rng.int(3, c.h - 4);
      if (!okTile(x, y)) continue;
      if (!farFromSettlements(x, y, 5)) continue;
      if (!accept(x, y, c.terrain[ix(c, x, y)])) continue;
      if (nodes.some((n) => dist(n.x, n.y, x, y) < 4)) continue;
      addNode(kind, x, y);
      got++;
    }
  };
  const areaK = (c.w * c.h) / (192 * 128);
  spread('herb', Math.round(70 * areaK), (_x, _y, t) => t === T.Grass || t === T.Forest || t === T.Plains);
  spread('rareHerb', Math.round(16 * areaK), (x, y, t) => (t === T.Forest || t === T.Hill) && dist(x, y, start.x, start.y) > 45);
  spread('ore', Math.round(40 * areaK), (x, y, t) => {
    if (t !== T.Hill && t !== T.Grass && t !== T.Plains && t !== T.Snow) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inB(c, x + dx, y + dy) && c.terrain[ix(c, x + dx, y + dy)] === T.Rock) return true;
    return false;
  });
  // Purification shrines just outside settlements.
  for (const s of c.settlements) {
    if (s.kind === 'ruin' || s.kind === 'hamlet') continue;
    for (let tries = 0; tries < 60; tries++) {
      const ang = rng.next() * Math.PI * 2;
      const x = Math.round(s.x + Math.cos(ang) * (s.radius + 3));
      const y = Math.round(s.y + Math.sin(ang) * (s.radius + 3));
      if (okTile(x, y) && c.terrain[ix(c, x, y)] !== T.Farm) { addNode('shrine', x, y); break; }
    }
  }
  // Blight hearts around the fallen capital.
  if (ruin) {
    let placedHearts = 0;
    for (let tries = 0; tries < 400 && placedHearts < 3; tries++) {
      const ang = rng.next() * Math.PI * 2;
      const rad = 5 + rng.next() * 7;
      const x = Math.round(ruin.x + Math.cos(ang) * rad);
      const y = Math.round(ruin.y + Math.sin(ang) * rad);
      if (!inB(c, x, y) || c.objects[ix(c, x, y)] !== O.None || !TERRAIN_INFO[c.terrain[ix(c, x, y)]].passable) continue;
      if (nodes.some((n) => n.kind === 'heart' && dist(n.x, n.y, x, y) < 6)) continue;
      addNode('heart', x, y);
      placedHearts++;
    }
  }
  return { spawns, nodes };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateWorld(seed: number, w = WORLD_W, h = WORLD_H): WorldData {
  const c: Ctx = {
    w,
    h,
    seed,
    rng: new Rng(seed ^ 0x5eed5eed),
    height: new Float32Array(w * h),
    terrain: new Uint8Array(w * h),
    objects: new Uint8Array(w * h),
    buildings: [],
    settlements: [],
    nodes: [],
    nextNodeId: 1,
  };
  makeHeight(c);
  makeTerrain(c);
  carveRivers(c);
  makeShores(c);
  scatterObjects(c);

  let cands = findCandidates(c, false);
  let sites = cands.length >= 4 ? pickSites(c, cands, 8) : [];
  if (sites.length < 8) {
    const loose = findCandidates(c, true);
    if (loose.length >= 4) {
      const alt = pickSites(c, loose, 8);
      if (alt.length > sites.length) {
        cands = loose;
        sites = alt;
      }
    }
  }
  if (sites.length < 4) throw new Error(`worldgen: seed ${seed} produced too few settlement sites (${sites.length})`);
  const sx = sites[0].x;
  const sy = sites[0].y;
  const ordered = [...sites].sort((a, b) => dist(a.x, a.y, sx, sy) - dist(b.x, b.y, sx, sy));
  // The fallen capital is the last settlement (the Blight's source). With widely spaced towns the farthest
  // site can be completely isolated, so pick, among the three farthest, the one closest to a living town:
  // the Blight then has a real frontier to press against instead of spreading into empty country.
  if (ordered.length >= 5) {
    const far = ordered.slice(-3);
    const nearestOther = (s: Cand) => Math.min(...ordered.filter((o) => o !== s).map((o) => dist(o.x, o.y, s.x, s.y)));
    const isolated = far.reduce((best, s) => (nearestOther(s) < nearestOther(best) ? s : best), far[far.length - 1]);
    // The 7 living towns; the isolated site is dropped and replaced by a ruin site much closer to one of them:
    // the Blight only spreads about 40 tiles, so a ruin 60+ tiles from everyone would never threaten anything.
    // Aim for 26-34 tiles from the nearest living town (the other towns stay 50+ tiles away from it and from each
    // other): the frontier town is genuinely threatened while the rest of the map stays spacious.
    const living = ordered.filter((o) => o !== isolated);
    const frontier = living.reduce((best, s) => (dist(s.x, s.y, isolated.x, isolated.y) < dist(best.x, best.y, isolated.x, isolated.y) ? s : best), living[0]);
    let ruinSite: Cand = isolated;
    const tryRanges: [number, number, number][] = [
      [26, 34, 50],
      [24, 40, 42],
    ];
    for (const [lo, hi, minOther] of tryRanges) {
      const options = cands.filter((k) => {
        const dF = dist(k.x, k.y, frontier.x, frontier.y);
        if (dF < lo || dF > hi) return false;
        if (dist(k.x, k.y, sx, sy) < 80) return false;
        return living.every((o) => o === frontier || dist(k.x, k.y, o.x, o.y) >= minOther);
      });
      if (options.length) {
        ruinSite = options.reduce((best, k) => (dist(k.x, k.y, sx, sy) > dist(best.x, best.y, sx, sy) ? k : best), options[0]);
        break;
      }
    }
    ordered.length = 0;
    ordered.push(...living, ruinSite);
  }
  const kinds = kindsFor(ordered.length);
  const used = new Set<string>();
  const nameRng = c.rng.fork(777);
  ordered.forEach((site, id) => {
    const kind = kinds[id];
    c.settlements.push(buildSettlement(c, id, site, kind, settlementName(nameRng, kind, used)));
  });
  addMines(c);
  const roads = buildRoads(c);

  const world: WorldData = {
    seed,
    w,
    h,
    terrain: c.terrain,
    objects: c.objects,
    settlements: c.settlements,
    buildings: c.buildings,
    spawnPoints: [],
    nodes: [],
    roads,
  };
  ensureConnected(c, world);
  const { spawns, nodes } = placeSpawnsAndNodes(c, world);
  world.spawnPoints = spawns;
  world.nodes = nodes;
  return world;
}

/** Every settlement spawn tile is walkable from the starting village. */
export function settlementsConnected(world: WorldData): boolean {
  const start = world.settlements[0];
  const reach = reachableFrom(world, start.spawn.x, start.spawn.y);
  return world.settlements.every((s) => isPassable(world, s.spawn.x, s.spawn.y) && reach[s.spawn.y * world.w + s.spawn.x] === 1);
}
