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
import { FOOTPRINT, SPECS, pickArchetype, planTown } from './townlayout';

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
  /** Ground set aside for a settlement that is built later (the fallen capital), as discs. */
  reserved: { x: number; y: number; r: number }[];
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

function findCandidates(c: Ctx, loose: boolean, small = false): Cand[] {
  // Towns are big now (radius up to 23 plus the cleared ring): look at a wider disc, keep clear of the map edge and
  // insist that the four road axes leave over dry land.
  // (`small` is for the fallen capital, which is just a few ruined houses: the old, lenient look.)
  const R = small ? 10 : 14;
  const EDGE = small ? 13 : 24;
  const AXIS = 17;
  const out: Cand[] = [];
  // Settlements flatten their own ground, so only water/mountain coverage and extreme relief matter.
  const maxBad = small ? (loose ? 80 : 36) : loose ? 170 : 90;
  const maxRange = loose ? 0.6 : 0.4;
  for (let y = EDGE; y < c.h - EDGE; y += 3) {
    for (let x = EDGE; x < c.w - EDGE; x += 3) {
      const t = c.terrain[ix(c, x, y)];
      if (t !== T.Grass && t !== T.Plains && t !== T.Forest) continue;
      let dry = 0;
      if (!small) for (const [ax, ay] of [[AXIS, 0], [-AXIS, 0], [0, AXIS], [0, -AXIS]] as const) {
        const at = c.terrain[ix(c, x + ax, y + ay)];
        if (TERRAIN_INFO[at].passable) dry++;
      }
      if (!small && dry < (loose ? 2 : 3)) continue;
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
  // Settlements are squares now (up to 44 tiles across with their cleared ring), so keep the sites far enough apart
  // that two of them never overlap: a Chebyshev separation of 66 tiles, relaxed in steps only if the map cannot hold
  // them all (down to 44, then, as a last resort, to the old Euclidean 30 that lets layouts squeeze past each other).
  const cheb = (a: Cand, b: Cand) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  let sep = 66;
  let euclid = false;
  while (chosen.length < count && (euclid ? sep >= 30 : sep >= 44)) {
    const dd = (k: Cand, s: Cand) => (euclid ? dist(s.x, s.y, k.x, k.y) : cheb(s, k));
    const scored = cands
      .map((k) => ({ k, d: Math.min(...chosen.map((s) => dd(k, s))) }))
      .filter((e) => e.d >= sep)
      .sort((a, b) => b.d - a.d);
    if (scored.length === 0) {
      sep -= 3;
      if (!euclid && sep < 44) {
        euclid = true;
        sep = 44;
      }
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

/** Settlement kinds with a hermitage for their legends, a few tiles beyond the ring. */
const HERMITAGE_KINDS: ReadonlySet<SettlementKind> = new Set(['town', 'sectHall', 'fort']);

/** Buildings people look for: their entrances stay free of trees and rocks. */
const KEY_KINDS: ReadonlySet<BuildingKind> = new Set(['inn', 'market', 'smithy', 'alchemy', 'shrine', 'dojo', 'hall', 'pagoda', 'hermitage', 'teahouse', 'barracks', 'gate']);

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

/** Where the trade road leaves a site: the axis towards the nearest other site. */
interface SiteHint {
  mainAxis: 'x' | 'y';
}

function buildSettlement(c: Ctx, id: number, site: Cand, kind: SettlementKind, name: string, hint: SiteHint): SettlementDef {
  const spec = SPECS[kind];
  const R = spec.radius;
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
    population: spec.population,
  };

  // Clear the ground.
  for (let dy = -R - 2; dy <= R + 2; dy++) {
    for (let dx = -R - 2; dx <= R + 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      // living settlements clear a square (their enclosure is square), a ruin a disc
      if (!inB(c, x, y) || (kind === 'ruin' && dx * dx + dy * dy > (R + 2) * (R + 2))) continue;
      // never wipe the ground of a settlement that is already there (a ruin may sit close to its frontier town)
      if (inSettlement(c, x, y, 2)) continue;
      // ... nor a hermitage or anything else already standing
      if (c.objects[ix(c, x, y)] === O.Building) continue;
      const i = ix(c, x, y);
      if (!TERRAIN_INFO[c.terrain[i]].passable && c.terrain[i] !== T.Water) {
        if (c.terrain[i] === T.Rock || isWaterT(c.terrain[i])) continue;
      }
      if (c.terrain[i] === T.Water || c.terrain[i] === T.DeepWater || c.terrain[i] === T.Rock) continue;
      c.terrain[i] = kind === 'ruin' && rng.chance(0.35) ? T.Ruin : T.Grass;
      c.objects[i] = kind === 'ruin' && rng.chance(0.05) ? O.DeadTree : rng.chance(0.03) ? O.Flowers : O.None;
    }
  }

  const placed = kind === 'ruin' ? layoutRuin(c, def, rng) : layoutTown(c, def, rng, hint);

  // Farm patches on the outskirts.
  for (let f = 0; f < spec.farms; f++) {
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
          const o = c.objects[ix(c, xx, yy)];
          // fields go on open ground: not over a building, a wall, a fence, a well or a street
          if (t !== T.Grass && t !== T.Plains && t !== T.Forest) { good = false; break; }
          if (o >= O.Building || o === O.Well || o === O.Lantern) { good = false; break; }
          if (kind !== 'ruin' && c.reserved.some((r) => (xx - r.x) ** 2 + (yy - r.y) ** 2 <= r.r * r.r)) { good = false; break; }
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

/** Cut a dirt footpath from a door to the nearest road or plaza (towards the centre). */
function cutFootpath(c: Ctx, grid: PathGrid, door: { x: number; y: number }, cx: number, cy: number): void {
  const p = findPath(grid, door.x, door.y, cx, cy + 1, 4000);
  if (!p) return;
  for (const s of [{ x: door.x, y: door.y }, ...p]) {
    const i = ix(c, s.x, s.y);
    const t = c.terrain[i];
    if (t === T.Road || t === T.Plaza) break;
    if (t === T.Grass || t === T.Plains || t === T.Forest || t === T.Sand || t === T.Snow || t === T.Ruin) c.terrain[i] = T.Dirt;
  }
}

/** Is (x, y) within `margin` tiles of the square a built settlement occupies? */
function inSettlement(c: Ctx, x: number, y: number, margin: number): boolean {
  return c.settlements.some((o) => Math.abs(x - o.x) <= o.radius + margin && Math.abs(y - o.y) <= o.radius + margin);
}

/** A fallen capital: dirt cross roads and a few ruined houses at random places. */
function layoutRuin(c: Ctx, def: SettlementDef, rng: Rng): BuildingDef[] {
  const { x: cx, y: cy, id } = def;
  const R = def.radius;
  for (let d = -R - 1; d <= R + 1; d++) {
    for (const [x, y] of [
      [cx + d, cy],
      [cx, cy + d],
    ] as const) {
      if (!inB(c, x, y)) continue;
      const t = c.terrain[ix(c, x, y)];
      if (t === T.Water || t === T.DeepWater || t === T.Rock) continue;
      if (inSettlement(c, x, y, 3)) continue;
      c.terrain[ix(c, x, y)] = T.Dirt;
      c.objects[ix(c, x, y)] = O.None;
    }
  }
  const placed: BuildingDef[] = [];
  const [bw, bd] = FOOTPRINT.ruinedHouse;
  for (let k = 0; k < 13; k++) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rad = 4 + rng.next() * (R - 4);
      const bx = Math.round(cx + Math.cos(ang) * rad - bw / 2);
      const by = Math.round(cy + Math.sin(ang) * rad - bd / 2);
      if (Math.abs(bx + bw / 2 - cx) < bw / 2 + 1.6 || Math.abs(by + bd / 2 - cy) < bd / 2 + 1.6) continue;
      if (Math.max(Math.abs(bx - cx), Math.abs(by - cy), Math.abs(bx + bw - cx), Math.abs(by + bd - cy)) > R - 1) continue;
      if (!rectFree(c, placed, bx, by, bw, bd, 1)) continue;
      if (inSettlement(c, bx, by, 4) || inSettlement(c, bx + bw, by + bd, 4)) continue;
      const door = { x: bx + (bw >> 1), y: by + bd };
      if (!inB(c, door.x, door.y) || !TERRAIN_INFO[c.terrain[ix(c, door.x, door.y)]].passable) continue;
      const b: BuildingDef = { id: c.buildings.length, kind: 'ruinedHouse', x: bx, y: by, w: bw, d: bd, settlementId: id, door };
      c.buildings.push(b);
      placed.push(b);
      def.buildingIds.push(b.id);
      for (let yy = by; yy < by + bd; yy++) for (let xx = bx; xx < bx + bw; xx++) c.objects[ix(c, xx, yy)] = O.Building;
      break;
    }
  }
  const grid = localGrid(c);
  for (const b of placed) cutFootpath(c, grid, b.door, cx, cy);
  return placed;
}

const WALKABLE_GROUND: ReadonlySet<number> = new Set([T.Grass, T.Plains, T.Forest, T.Sand, T.Snow, T.Hill, T.Dirt]);

/** A living settlement: plan the streets and lots (`townlayout.ts`) and paint them onto the world. */
function layoutTown(c: Ctx, def: SettlementDef, rng: Rng, hint: SiteHint): BuildingDef[] {
  const { x: cx, y: cy, id, kind } = def;
  const R = def.radius;
  const field = (dx: number, dy: number): boolean => {
    const x = cx + dx;
    const y = cy + dy;
    if (!inB(c, x, y) || Math.abs(dx) > R + 2 || Math.abs(dy) > R + 2) return false;
    if (c.reserved.some((r) => (x - r.x) ** 2 + (y - r.y) ** 2 <= r.r * r.r)) return false;
    return WALKABLE_GROUND.has(c.terrain[ix(c, x, y)]);
  };
  const spec = SPECS[kind];
  // The seeded pick comes first; if the ground (water, rock) leaves too much of the programme unplaced, try the other
  // layouts the kind allows and keep the one that places the most.
  const first = pickArchetype(kind, rng.fork(11));
  const order = [first, ...spec.archetypes.map(([a]) => a).filter((a) => a !== first)];
  let archetype = first;
  let plan = planTown({ kind, spec, archetype: first, rng: rng.fork(12), mainAxis: hint.mainAxis, field });
  for (const a of order.slice(1)) {
    if (plan.missing.length <= spec.program.length * 0.1) break;
    const alt = planTown({ kind, spec, archetype: a, rng: rng.fork(12), mainAxis: hint.mainAxis, field });
    if (alt.missing.length < plan.missing.length) {
      plan = alt;
      archetype = a;
    }
  }
  def.layout = archetype;
  const set = (t: { x: number; y: number }, terrain: number | null, obj: number | null): void => {
    const x = cx + t.x;
    const y = cy + t.y;
    if (!inB(c, x, y)) return;
    const i = ix(c, x, y);
    if (terrain !== null) c.terrain[i] = terrain;
    if (obj !== null) c.objects[i] = obj;
  };
  for (const t of plan.water) set(t, T.Water, O.None);
  for (const t of plan.roads) set(t, T.Road, O.None);
  for (const t of plan.dirt) set(t, T.Dirt, O.None);
  for (const t of plan.plaza) set(t, T.Plaza, O.None);
  for (const t of plan.bridges) set(t, T.Bridge, O.None);
  const wall = plan.enclosure === 'wall' ? O.Wall : plan.enclosure === 'palisade' ? O.Palisade : O.Fence;
  for (const t of plan.enclosureTiles) set(t, null, wall);
  for (const t of plan.wells) set(t, null, O.Well);
  for (const t of plan.lanterns) set(t, null, O.Lantern);
  for (const t of plan.gardens) set(t, null, rng.chance(0.5) ? O.Flowers : O.Bush);
  for (const t of plan.trees) set(t, null, rng.chance(0.45) ? O.Bush : def.climate === 0 ? O.Pine : O.Oak);

  const placed: BuildingDef[] = [];
  for (const l of plan.lots) {
    const bx = cx + l.x;
    const by = cy + l.y;
    const door = { x: cx + l.door.x, y: cy + l.door.y };
    const b: BuildingDef = { id: c.buildings.length, kind: l.kind, x: bx, y: by, w: l.w, d: l.d, settlementId: id, door };
    c.buildings.push(b);
    placed.push(b);
    def.buildingIds.push(b.id);
    for (let yy = by; yy < by + l.d; yy++) for (let xx = bx; xx < bx + l.w; xx++) c.objects[ix(c, xx, yy)] = O.Building;
  }
  const grid = localGrid(c);
  plan.lots.forEach((l, i) => {
    if (l.needsPath) cutFootpath(c, grid, placed[i].door, cx, cy);
  });
  return placed;
}

const CLEARABLE_OBJECTS: ReadonlySet<number> = new Set([O.Pine, O.Oak, O.Bamboo, O.Boulder, O.DeadTree]);
const HERMITAGE_GROUND: ReadonlySet<number> = new Set([T.Grass, T.Plains, T.Forest, T.Hill, T.Sand, T.Snow]);

/** Remove trees and rocks in a rectangle (buildings and walls stay). */
function clearBlockers(c: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inB(c, x, y)) continue;
      const i = ix(c, x, y);
      if (CLEARABLE_OBJECTS.has(c.objects[i])) c.objects[i] = O.None;
    }
  }
}

/** Walking cost for footpaths over wild ground: trees and rocks are avoided when possible, then felled. */
function footpathGrid(c: Ctx): PathGrid {
  return {
    w: c.w,
    h: c.h,
    cost(x, y) {
      const i = ix(c, x, y);
      const o = c.objects[i];
      if (o === O.Building || o === O.Wall) return Infinity;
      const t = c.terrain[i];
      if (!TERRAIN_INFO[t].passable) return Infinity;
      return (t === T.Road || t === T.Plaza || t === T.Dirt ? 0.5 : t === T.Farm ? 3 : 1) + (CLEARABLE_OBJECTS.has(o) ? 4 : 0);
    },
  };
}

/**
 * A hermit's hut a few tiles beyond the ring, on cleared open ground, joined to the nearest road (or the plaza)
 * by a dirt footpath. Tries a bounded number of spots; a settlement without a fitting site simply has none.
 */
function placeHermitage(c: Ctx, def: SettlementDef, placed: BuildingDef[], rng: Rng): void {
  const [bw, bd] = FOOTPRINT.hermitage;
  const R = def.radius;
  const grid = footpathGrid(c);
  for (let attempt = 0; attempt < 600; attempt++) {
    const ang = rng.next() * Math.PI * 2;
    // After a fair number of misses the search widens to a few more tiles out.
    const rad = R + 4 + rng.next() * (attempt < 300 ? 8 : 14);
    const bx = Math.round(def.x + Math.cos(ang) * rad - bw / 2);
    const by = Math.round(def.y + Math.sin(ang) * rad - bd / 2);
    const door = { x: bx + (bw >> 1), y: by + bd };
    let ok = true;
    for (let yy = by - 1; yy <= by + bd + 1 && ok; yy++) {
      for (let xx = bx - 1; xx <= bx + bw && ok; xx++) {
        if (!inB(c, xx, yy)) { ok = false; break; }
        const i = ix(c, xx, yy);
        const o = c.objects[i];
        const t = c.terrain[i];
        if (o === O.Building || o === O.Wall || o === O.Palisade || o === O.Fence || !HERMITAGE_GROUND.has(t)) ok = false;
        // outside the enclosure (a square), and off ground set aside for the fallen capital
        if (Math.max(Math.abs(xx - def.x), Math.abs(yy - def.y)) < R + 3) ok = false;
        if (c.reserved.some((r) => (xx - r.x) ** 2 + (yy - r.y) ** 2 <= r.r * r.r)) ok = false;
      }
    }
    if (!ok) continue;
    // Leave the other settlements, the road ends and the fields alone.
    if (c.settlements.some((o) => o !== def && Math.max(Math.abs(bx + 1 - o.x), Math.abs(by + 1 - o.y)) < o.radius + 5)) continue;
    if (placed.some((b) => bx - 2 < b.x + b.w && bx + bw + 2 > b.x && by - 2 < b.y + b.d && by + bd + 2 > b.y)) continue;
    const path = findPath(grid, door.x, door.y, def.x, def.y + 1, 9000);
    if (!path) continue;
    const b: BuildingDef = { id: c.buildings.length, kind: 'hermitage', x: bx, y: by, w: bw, d: bd, settlementId: def.id, door };
    // Open ground around the hut (room for a pine or two in the sprite) and a path to the road.
    clearBlockers(c, bx - 2, by - 2, bx + bw + 1, by + bd + 2);
    for (let yy = by - 1; yy <= by + bd + 1; yy++) for (let xx = bx - 1; xx <= bx + bw; xx++) if (c.terrain[ix(c, xx, yy)] === T.Forest) c.terrain[ix(c, xx, yy)] = T.Grass;
    for (let yy = by; yy < by + bd; yy++) for (let xx = bx; xx < bx + bw; xx++) c.objects[ix(c, xx, yy)] = O.Building;
    c.buildings.push(b);
    def.buildingIds.push(b.id);
    for (const st of [door, ...path]) {
      const i = ix(c, st.x, st.y);
      const t = c.terrain[i];
      if (t === T.Road || t === T.Plaza) break;
      if (CLEARABLE_OBJECTS.has(c.objects[i])) c.objects[i] = O.None;
      if (t === T.Grass || t === T.Plains || t === T.Forest || t === T.Sand || t === T.Snow || t === T.Hill) c.terrain[i] = T.Dirt;
    }
    return;
  }
}

/**
 * Keep trees and rocks off the entrances of settlements and off the ground in front of the buildings people
 * look for, so a landmark is never hidden behind a thicket. Runs after the roads exist.
 */
function clearSightlines(c: Ctx): void {
  for (const s of c.settlements) {
    if (s.kind === 'ruin') continue;
    const R = s.radius;
    for (const sgn of [-1, 1]) {
      const a = sgn * (R - 2);
      const b = sgn * (R + 5);
      clearBlockers(c, s.x + Math.min(a, b), s.y - 2, s.x + Math.max(a, b), s.y + 2);
      clearBlockers(c, s.x - 2, s.y + Math.min(a, b), s.x + 2, s.y + Math.max(a, b));
    }
  }
  for (const b of c.buildings) {
    if (!KEY_KINDS.has(b.kind)) continue;
    clearBlockers(c, b.door.x - 1, b.door.y, b.door.x + 1, b.door.y + 1);
  }
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
      if (c.objects[i] < O.Building && c.objects[i] !== O.Well) c.objects[i] = O.None;
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function ensureConnected(c: Ctx, world: WorldData): void {
  const start = c.settlements[0];
  /** The end of the settlement's axis avenue that lies nearest a point (where roads leave). */
  const avenueEnd = (s: SettlementDef, tx: number, ty: number): { x: number; y: number } => {
    const R = s.radius + 1;
    const ends = [
      { x: s.x + R, y: s.y },
      { x: s.x - R, y: s.y },
      { x: s.x, y: s.y + R },
      { x: s.x, y: s.y - R },
    ].filter((p) => inB(c, p.x, p.y));
    ends.sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty));
    return ends[0];
  };
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
    // Causeway from one avenue end to the other, so it never cuts through the streets and buildings of a settlement.
    const a = avenueEnd(lost, to.x, to.y);
    const b = avenueEnd(to, lost.x, lost.y);
    carveLine(c, a.x, a.y, b.x, b.y);
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
  // Purification shrines just outside settlements, never tucked against a wall or a hut.
  const nearWallOrHut = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!inB(c, x + dx, y + dy)) continue;
      const o = c.objects[ix(c, x + dx, y + dy)];
      if (o === O.Wall || o === O.Building || o === O.Palisade || o === O.Fence || o === O.Well) return true;
    }
    return false;
  };
  const shrineRng = rng.fork(5150);
  for (const s of c.settlements) {
    if (s.kind === 'ruin' || s.kind === 'hamlet') continue;
    for (let tries = 0; tries < 90; tries++) {
      // First on the sides facing the camera (south / east) so walls and huts do not hide the shrine, then anywhere.
      const ang = tries < 60 ? shrineRng.next() * Math.PI - Math.PI / 4 : shrineRng.next() * Math.PI * 2;
      const x = Math.round(s.x + Math.cos(ang) * (s.radius + 3));
      const y = Math.round(s.y + Math.sin(ang) * (s.radius + 3));
      if (okTile(x, y) && c.terrain[ix(c, x, y)] !== T.Farm && !nearWallOrHut(x, y)) {
        clearBlockers(c, x - 1, y - 1, x + 1, y + 2);
        addNode('shrine', x, y);
        break;
      }
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
    reserved: [],
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
    let ruinCands = findCandidates(c, false, true);
    if (ruinCands.length < 12) ruinCands = findCandidates(c, true, true);
    const tryRanges: [number, number, number][] = [
      [26, 34, 50],
      [24, 40, 42],
      [22, 46, 38],
      [20, 54, 32],
    ];
    for (const [lo, hi, minOther] of tryRanges) {
      // any living town but the start may be the frontier the Blight presses against
      let best: { k: Cand; fit: number } | null = null;
      for (const f of living) {
        if (f.x === sx && f.y === sy) continue;
        for (const k of ruinCands) {
          const dF = dist(k.x, k.y, f.x, f.y);
          if (dF < lo || dF > hi) continue;
          if (dist(k.x, k.y, sx, sy) < 80) continue;
          if (!living.every((o) => o === f || dist(k.x, k.y, o.x, o.y) >= minOther)) continue;
          // close to the ideal 30 tiles from the frontier town, on dry land, and far from the start if that leaves a choice
          const fit = -Math.abs(dF - 30) * 2 + dist(k.x, k.y, sx, sy) * 0.1 + k.score * 0.4;
          if (!best || fit > best.fit) best = { k, fit };
        }
      }
      if (best) {
        ruinSite = best.k;
        break;
      }
    }
    ordered.length = 0;
    ordered.push(...living, ruinSite);
  }
  // the ruin is built last, but the living settlements must leave its ground alone
  const ruinAt = ordered[ordered.length - 1];
  if (ruinAt) c.reserved.push({ x: ruinAt.x, y: ruinAt.y, r: SPECS.ruin.radius + 3 });
  const kinds = kindsFor(ordered.length);
  // The big kinds go to the roomiest sites: of the middle sites (everything but the start and the ruin) the one with the
  // most buildable ground gets the first of the town / sect hall / fort slots, the cramped ones get the hamlet and villages.
  if (ordered.length === KINDS_FULL.length) {
    const room = (site: Cand, kindR: number): number => {
      let n = 0;
      for (let dy = -kindR; dy <= kindR; dy++) {
        for (let dx = -kindR; dx <= kindR; dx++) {
          const x = site.x + dx;
          const y = site.y + dy;
          if (!inB(c, x, y)) continue;
          const t = c.terrain[ix(c, x, y)];
          if (TERRAIN_INFO[t].passable && t !== T.Hill) n++;
        }
      }
      return n;
    };
    const middle = ordered.slice(1, ordered.length - 1).map((site, i) => ({ site, i: i + 1, room: room(site, 20) }));
    const slots = middle.map((m) => m.i);
    const want: SettlementKind[] = ['town', 'town', 'sectHall', 'fort', 'village', 'hamlet'];
    const byRoom = [...middle].sort((a, b) => b.room - a.room || a.i - b.i);
    byRoom.forEach((m, rank) => {
      kinds[m.i] = want[rank];
    });
    void slots;
  }
  const used = new Set<string>();
  const nameRng = c.rng.fork(777);
  ordered.forEach((site, id) => {
    const kind = kinds[id];
    // the axis towards the nearest other site is where the trade road will leave
    let near = ordered.find((o) => o !== site) ?? site;
    for (const o of ordered) if (o !== site && dist(o.x, o.y, site.x, site.y) < dist(near.x, near.y, site.x, site.y)) near = o;
    const mainAxis = Math.abs(near.x - site.x) >= Math.abs(near.y - site.y) ? 'x' : 'y';
    c.settlements.push(buildSettlement(c, id, site, kind, settlementName(nameRng, kind, used), { mainAxis }));
  });
  // Hermitages go in last, once every neighbour's buildings stand, so a hut never lands under another town's lot.
  for (const def of c.settlements) if (HERMITAGE_KINDS.has(def.kind)) placeHermitage(c, def, c.buildings, c.rng.fork(3000 + def.id));
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
  clearSightlines(c);
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
