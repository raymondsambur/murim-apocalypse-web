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
  | 'outskirts'
  | 'hermitage'
  | 'herb'
  | 'mine'
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
  /** Where the roads leave the settlement (siege muster points). Each carries flank spots for guards, two per side. */
  readonly gates: readonly Place[];
  /** Patrol points out in the fields: a few tiles up each road beyond the gates, and the edge of each farm. */
  readonly outskirts: readonly Place[];
  /** A squad's round: the inner posts, gates and outskirts (not the plaza) sorted by angle around the settlement. */
  readonly route: readonly Place[];
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
  mineEntrance: 'mine',
  hermitage: 'hermitage',
};

/** Kinds that are not entered (open-air posts or towers guards stand beside). */
const NO_ENTER: ReadonlySet<PlaceKind> = new Set(['tower', 'gate', 'herb', 'mine']);

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

/** Walkable, reachable Farm-terrain tiles within Chebyshev radius `r` of (cx, cy). */
function farmTiles(world: WorldData, comp: Uint16Array, label: number, cx: number, cy: number, r: number): Point[] {
  const out: Point[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const i = y * world.w + x;
      if (world.terrain[i] === T.Farm && isPassable(world, x, y) && comp[i] === label) out.push({ x, y });
    }
  }
  return out;
}

export function isFarmTile(world: WorldData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h && world.terrain[y * world.w + x] === T.Farm;
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

/**
 * Where guards stand at a gate: two flanking the road (slot 0 and 1), then further pairs inside the gate, then
 * any other reachable tile near it. `dir` is the unit axis vector pointing out of the settlement.
 */
function gateSpots(world: WorldData, comp: Uint16Array, label: number, t: Point, dir: Point): Point[] {
  const side: Point = { x: -dir.y, y: dir.x };
  const ok = (x: number, y: number) => isPassable(world, x, y) && comp[y * world.w + x] === label;
  const out: Point[] = [];
  const push = (p: Point) => {
    if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
  };
  for (const depth of [0, 2, 4]) {
    for (const sgn of [1, -1]) {
      for (const off of [2, 1]) {
        const x = t.x - dir.x * depth + side.x * sgn * off;
        const y = t.y - dir.y * depth + side.y * sgn * off;
        if (ok(x, y)) {
          push({ x, y });
          break;
        }
      }
    }
  }
  for (const p of spotsNear(world, comp, label, t.x, t.y, 0, 2, 8)) push(p);
  return out;
}

/** A reachable tile near (x, y), preferring road / dirt so a patrol stands on the track and not in a thicket. */
function roadTileNear(world: WorldData, comp: Uint16Array, label: number, x: number, y: number, radius: number): Point | null {
  x = Math.round(x);
  y = Math.round(y);
  let best: Point | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (!isPassable(world, px, py) || comp[py * world.w + px] !== label) continue;
      const t = world.terrain[py * world.w + px];
      const d = dx * dx + dy * dy + (t === T.Road || t === T.Dirt ? 0 : 20);
      if (d < bestD) {
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best;
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

  // Farm patches: only real Farm-terrain tiles count (a farm "site" on grass or dirt is not a field).
  const farms: Place[] = [];
  const usedField = new Set<number>();
  const addField = (id: string, cx: number, cy: number, radius: number): void => {
    const tiles = farmTiles(world, comp, label, cx, cy, radius).filter((t) => !usedField.has(t.y * world.w + t.x));
    if (tiles.length < 4) return;
    tiles.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || a.y - b.y || a.x - b.x);
    const spots = tiles.slice(0, 14);
    for (const t of spots) usedField.add(t.y * world.w + t.x);
    const p = openPlace(id, 'farm', s.id, spots[0], spots, { x: cx, y: cy });
    farms.push(p);
    add(p);
  };
  s.sites.forEach((site, i) => {
    if (site.kind === 'farm') addField(`farm${s.id}_${i}`, site.x, site.y, 7);
  });
  if (farms.length === 0) addField(`farm${s.id}_area`, s.x, s.y, s.radius + 10);

  // Gates: where each road leaves the settlement. Roads leave along the compass axes, so a gate is the axis point
  // nearest the direction of the neighbour (or the four compass points if there are no roads).
  const gates: Place[] = [];
  const gateTiles: Point[] = [];
  const gateDirs: Point[] = [];
  const addGate = (angle: number): void => {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const dir: Point = Math.abs(c) >= Math.abs(sn) ? { x: Math.sign(c) || 1, y: 0 } : { x: 0, y: Math.sign(sn) || 1 };
    const t = reachableTile(world, grid, comp, label, s.x + dir.x * s.radius * 0.9, s.y + dir.y * s.radius * 0.9, 4);
    if (!t || gateTiles.some((g) => Math.abs(g.x - t.x) + Math.abs(g.y - t.y) < 4)) return;
    gateTiles.push(t);
    gateDirs.push(dir);
    const spots = gateSpots(world, comp, label, t, dir);
    const p: Place = { ...openPlace(`gate${s.id}_${gates.length}`, 'gate', s.id, t, spots, { x: s.x + dir.x * (s.radius + 6), y: s.y + dir.y * (s.radius + 6) }), door: t };
    gates.push(p);
    add(p);
  };
  for (const [a, b] of world.roads) {
    const other = a === s.id ? b : b === s.id ? a : -1;
    if (other < 0) continue;
    const o = world.settlements[other];
    if (o) addGate(Math.atan2(o.y - s.y, o.x - s.x));
  }
  // A fort has four real openings in its wall, whether or not a road runs out of each.
  for (let k = 0; (gates.length < 2 || s.kind === 'fort') && k < 4; k++) addGate(Math.PI / 2 + (k * Math.PI) / 2);

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

  // Outskirts: a few tiles up each road beyond its gate, and the outermost tile of each farm.
  const outskirts: Place[] = [];
  gates.forEach((g, i) => {
    const dir = gateDirs[i];
    const t = roadTileNear(world, comp, label, g.door.x + dir.x * NPCLIFE_TUNING.outskirtsOffset, g.door.y + dir.y * NPCLIFE_TUNING.outskirtsOffset, 3);
    if (!t || outskirts.some((o) => Math.abs(o.door.x - t.x) + Math.abs(o.door.y - t.y) < 4)) return;
    const p = openPlace(`out${s.id}_g${i}`, 'outskirts', s.id, t, spotsNear(world, comp, label, t.x, t.y, 0, 2, 6), { x: t.x + dir.x * 4, y: t.y + dir.y * 4 });
    outskirts.push(p);
    add(p);
  });
  farms.forEach((f, i) => {
    let far = f.spots[0];
    for (const t of f.spots) if ((t.x - s.x) ** 2 + (t.y - s.y) ** 2 > (far.x - s.x) ** 2 + (far.y - s.y) ** 2) far = t;
    if (outskirts.some((o) => Math.abs(o.door.x - far.x) + Math.abs(o.door.y - far.y) < 4)) return;
    const p = openPlace(`out${s.id}_f${i}`, 'outskirts', s.id, far, spotsNear(world, comp, label, far.x, far.y, 0, 2, 6), f.look);
    outskirts.push(p);
    add(p);
  });
  const route = [...posts.filter((p) => p !== plaza), ...outskirts].sort((a, b) => angleOf(a) - angleOf(b) || a.id.localeCompare(b.id));

  const dwellings = [...(kinds.get('house') ?? []), ...(kinds.get('farmhouse') ?? [])];
  return { settlementId: s.id, all, dwellings, plaza, posts, gates, outskirts, route, farms, byKind: (k) => kinds.get(k) ?? [] };
}
