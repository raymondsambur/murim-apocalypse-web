/**
 * The places NPCs live and work at, derived once per world from `world.buildings` / settlement sites /
 * terrain. Nothing here is persisted: it is a pure function of the (seed-generated) world.
 *
 * A Place has a `door` (the tile in front of the entrance, where NPCs appear / disappear when they go
 * indoors) and `spots` (walkable tiles around it where NPCs stand while doing something outside).
 * Every tile kept is reachable from the settlement spawn, so a place is never an unreachable island.
 */
import { T, isPassable, nearestWalkable, type BuildingDef, type BuildingKind, type PathGrid, type Point, type SettlementDef, type WorldData } from '@murim/shared';
import { NPCLIFE_TUNING } from './tuning';

export type PlaceKind =
  | 'house'
  | 'farmhouse'
  | 'inn'
  | 'teahouse'
  | 'smithy'
  | 'alchemy'
  | 'market'
  | 'shrine'
  | 'pagoda'
  | 'hall'
  | 'dojo'
  | 'barracks'
  | 'warehouse'
  | 'tower'
  | 'gate'
  | 'post'
  | 'herb'
  | 'farm'
  | 'plaza';

export interface Place {
  readonly id: string;
  readonly kind: PlaceKind;
  readonly settlementId: number;
  readonly buildingId: number | null;
  /** Tile in front of the entrance (or the centre tile for open-air places). */
  readonly door: Point;
  /** Walkable tiles to stand on, nearest the door first. Never empty. */
  readonly spots: readonly Point[];
  /** True for real buildings an NPC can step into (hidden while inside). */
  readonly enter: boolean;
  /** A tile to face while standing at the place (the building centre, the stall...). */
  readonly look: Point;
}

export interface SettlementPlaces {
  readonly settlementId: number;
  readonly all: readonly Place[];
  /** Sleeping places for civilians (houses, farmhouses). */
  readonly dwellings: readonly Place[];
  readonly plaza: Place;
  /** Guard patrol posts, in a loop order. */
  readonly posts: readonly Place[];
  /** Where the roads leave the settlement (siege muster points). */
  readonly gates: readonly Place[];
  readonly farms: readonly Place[];
  byKind(kind: PlaceKind): readonly Place[];
}

export interface WorldPlaces {
  readonly settlements: ReadonlyMap<number, SettlementPlaces>;
  /** Connected-component label per tile (0 = not labelled), for reachability checks. */
  readonly comp: Uint16Array;
  /** Component label of a settlement's spawn. */
  compOf(settlementId: number): number;
}

const BUILDING_PLACE: Partial<Record<BuildingKind, PlaceKind>> = {
  house: 'house',
  farmhouse: 'farmhouse',
  inn: 'inn',
  teahouse: 'teahouse',
  smithy: 'smithy',
  alchemy: 'alchemy',
  market: 'market',
  shrine: 'shrine',
  pagoda: 'pagoda',
  hall: 'hall',
  dojo: 'dojo',
  barracks: 'barracks',
  warehouse: 'warehouse',
  tower: 'tower',
  gate: 'gate',
  herbHut: 'herb',
};

/** Kinds that are not entered (open-air posts or towers guards stand beside). */
const NO_ENTER: ReadonlySet<PlaceKind> = new Set(['tower', 'gate', 'herb']);

const cache = new WeakMap<WorldData, WorldPlaces>();

export function worldPlaces(world: WorldData, grid: PathGrid): WorldPlaces {
  let wp = cache.get(world);
  if (!wp) {
    wp = buildWorldPlaces(world, grid);
    cache.set(world, wp);
  }
  return wp;
}

/** Label connected walkable components that contain a settlement spawn (4-neighbour flood fill). */
function labelComponents(world: WorldData, grid: PathGrid): { comp: Uint16Array; spawnComp: Map<number, number> } {
  const comp = new Uint16Array(world.w * world.h);
  const spawnComp = new Map<number, number>();
  let next = 1;
  const stack: number[] = [];
  for (const s of world.settlements) {
    const sp = isPassable(world, s.spawn.x, s.spawn.y) ? s.spawn : nearestWalkable(grid, s.spawn.x, s.spawn.y, 8);
    if (!sp) continue;
    const start = sp.y * world.w + sp.x;
    if (comp[start]) {
      spawnComp.set(s.id, comp[start]);
      continue;
    }
    const label = next++;
    spawnComp.set(s.id, label);
    comp[start] = label;
    stack.push(start);
    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % world.w;
      const cy = (cur / world.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!isPassable(world, nx, ny)) continue;
        const ni = ny * world.w + nx;
        if (comp[ni]) continue;
        comp[ni] = label;
        stack.push(ni);
      }
    }
  }
  return { comp, spawnComp };
}

function buildWorldPlaces(world: WorldData, grid: PathGrid): WorldPlaces {
  const { comp, spawnComp } = labelComponents(world, grid);
  const settlements = new Map<number, SettlementPlaces>();
  for (const s of world.settlements) {
    if (s.kind === 'ruin') continue;
    const label = spawnComp.get(s.id);
    if (!label) continue;
    settlements.set(s.id, buildSettlement(world, grid, comp, label, s));
  }
  return { settlements, comp, compOf: (id) => spawnComp.get(id) ?? 0 };
}

/** Walkable, reachable tiles in square rings min..max around (cx, cy), nearest rings first. */
function spotsNear(world: WorldData, comp: Uint16Array, label: number, cx: number, cy: number, minR: number, maxR: number, limit: number, skip?: Point): Point[] {
  const out: Point[] = [];
  for (let r = minR; r <= maxR && out.length < limit; r++) {
    for (let dy = -r; dy <= r && out.length < limit; dy++) {
      for (let dx = -r; dx <= r && out.length < limit; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (skip && skip.x === x && skip.y === y) continue;
        if (!isPassable(world, x, y) || comp[y * world.w + x] !== label) continue;
        out.push({ x, y });
      }
    }
  }
  return out;
}

function reachableTile(world: WorldData, grid: PathGrid, comp: Uint16Array, label: number, x: number, y: number, radius = 5): Point | null {
  x = Math.round(x);
  y = Math.round(y);
  if (isPassable(world, x, y) && comp[y * world.w + x] === label) return { x, y };
  const near = spotsNear(world, comp, label, x, y, 1, radius, 1);
  if (near.length) return near[0];
  const w = nearestWalkable(grid, x, y, radius);
  return w && comp[w.y * world.w + w.x] === label ? w : null;
}

function buildingPlace(world: WorldData, grid: PathGrid, comp: Uint16Array, label: number, b: BuildingDef, kind: PlaceKind): Place | null {
  const door = reachableTile(world, grid, comp, label, b.door.x, b.door.y, 3);
  if (!door) return null;
  let spots = spotsNear(world, comp, label, door.x, door.y, 1, 3, NPCLIFE_TUNING.spotsPerPlace, door);
  if (spots.length === 0) spots = [door];
  return { id: `b${b.id}`, kind, settlementId: b.settlementId, buildingId: b.id, door, spots, enter: !NO_ENTER.has(kind), look: { x: b.x + b.w / 2, y: b.y + b.d / 2 } };
}

function openPlace(id: string, kind: PlaceKind, sid: number, centre: Point, spots: Point[], look: Point = centre): Place {
  return { id, kind, settlementId: sid, buildingId: null, door: spots[0] ?? centre, spots: spots.length ? spots : [centre], enter: false, look };
}

function buildSettlement(world: WorldData, grid: PathGrid, comp: Uint16Array, label: number, s: SettlementDef): SettlementPlaces {
  const all: Place[] = [];
  const kinds = new Map<PlaceKind, Place[]>();
  const add = (p: Place) => {
    all.push(p);
    const list = kinds.get(p.kind);
    if (list) list.push(p);
    else kinds.set(p.kind, [p]);
  };

  for (const b of world.buildings) {
    if (b.settlementId !== s.id) continue;
    const kind = BUILDING_PLACE[b.kind];
    if (!kind) continue;
    const p = buildingPlace(world, grid, comp, label, b, kind);
    if (p) add(p);
  }

  // Plaza: the Plaza terrain around the spawn, thinned out so a crowd spreads.
  const sp = reachableTile(world, grid, comp, label, s.spawn.x, s.spawn.y, 8) ?? s.spawn;
  const plazaTiles: Point[] = [];
  const pr = Math.min(s.radius + 2, 16);
  for (let dy = -pr; dy <= pr; dy++) {
    for (let dx = -pr; dx <= pr; dx++) {
      const x = sp.x + dx;
      const y = sp.y + dy;
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      if (world.terrain[y * world.w + x] !== T.Plaza || !isPassable(world, x, y) || comp[y * world.w + x] !== label) continue;
      plazaTiles.push({ x, y });
    }
  }
  plazaTiles.sort((a, b) => (a.x - sp.x) ** 2 + (a.y - sp.y) ** 2 - ((b.x - sp.x) ** 2 + (b.y - sp.y) ** 2) || a.y - b.y || a.x - b.x);
  let plazaSpots = plazaTiles.filter((_, i) => i % 2 === 0).slice(0, 30);
  if (plazaSpots.length < 6) plazaSpots = [sp, ...spotsNear(world, comp, label, sp.x, sp.y, 1, 5, 20)];
  const plaza = openPlace(`plaza${s.id}`, 'plaza', s.id, sp, plazaSpots);
  add(plaza);

  // Farm patches and herb huts from the settlement's work sites.
  const farms: Place[] = [];
  s.sites.forEach((site, i) => {
    if (site.kind !== 'farm') return;
    const spots = spotsNear(world, comp, label, site.x, site.y, 0, 3, NPCLIFE_TUNING.spotsPerPlace);
    if (spots.length === 0) return;
    const p = openPlace(`farm${s.id}_${i}`, 'farm', s.id, { x: site.x, y: site.y }, spots, { x: site.x, y: site.y });
    farms.push(p);
    add(p);
  });

  // Gates: where each road leaves the settlement (or the four compass points if it has none).
  const gates: Place[] = [];
  const gateTiles: Point[] = [];
  const addGate = (angle: number, frac: number): void => {
    const px = s.x + Math.cos(angle) * s.radius * frac;
    const py = s.y + Math.sin(angle) * s.radius * frac;
    const t = reachableTile(world, grid, comp, label, px, py, 4);
    if (!t || gateTiles.some((g) => Math.abs(g.x - t.x) + Math.abs(g.y - t.y) < 4)) return;
    gateTiles.push(t);
    const spots = spotsNear(world, comp, label, t.x, t.y, 0, 2, 6);
    const p = openPlace(`gate${s.id}_${gates.length}`, 'gate', s.id, t, spots, { x: s.x + Math.cos(angle) * (s.radius + 6), y: s.y + Math.sin(angle) * (s.radius + 6) });
    gates.push(p);
    add(p);
  };
  for (const [a, b] of world.roads) {
    const other = a === s.id ? b : b === s.id ? a : -1;
    if (other < 0) continue;
    const o = world.settlements[other];
    if (o) addGate(Math.atan2(o.y - s.y, o.x - s.x), 0.85);
  }
  for (let k = 0; gates.length < 2 && k < 4; k++) addGate((k * Math.PI) / 2 + Math.PI / 4, 0.85);

  // Patrol posts: gates, tower / barracks yards, the plaza and a few inner-ring points; sorted by angle for a loop.
  const posts: Place[] = [...gates, plaza];
  for (const t of kinds.get('tower') ?? []) posts.push(t);
  for (const b of kinds.get('barracks') ?? []) posts.push(b);
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2;
    const t = reachableTile(world, grid, comp, label, s.x + Math.cos(angle) * s.radius * 0.5, s.y + Math.sin(angle) * s.radius * 0.5, 3);
    if (!t) continue;
    const spots = spotsNear(world, comp, label, t.x, t.y, 0, 2, 5);
    const p = openPlace(`post${s.id}_${k}`, 'post', s.id, t, spots);
    posts.push(p);
    add(p);
  }
  const angleOf = (p: Place) => Math.atan2(p.door.y - s.y, p.door.x - s.x);
  posts.sort((a, b) => (a === plaza ? -9 : angleOf(a)) - (b === plaza ? -9 : angleOf(b)));

  const dwellings = [...(kinds.get('house') ?? []), ...(kinds.get('farmhouse') ?? [])];
  return { settlementId: s.id, all, dwellings, plaza, posts, gates, farms, byKind: (k) => kinds.get(k) ?? [] };
}
