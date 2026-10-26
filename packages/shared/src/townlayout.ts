/**
 * Settlement layout: streets first, then lots along the streets (doors facing the street), grouped into quarters, plus
 * enclosures, wells, lanterns and gardens. Pure and deterministic (a seeded `Rng` and a `field` that says which tiles may be
 * built on); `worldgen.ts` paints the result onto the world.
 *
 * Coordinates are relative to the settlement centre. The camera sees only the south (+y) and east (+x) faces of a building,
 * so a door can only face south or east: a lot lies on the north side of an east-west street (door south) or on the west
 * side of a north-south street (door east). Every settlement keeps the four axis avenues out to the edge, because the
 * roads between settlements and `landmarks.ts gateDirs` assume them.
 */
import type { Rng } from './rng';
import type { BuildingKind, SettlementKind } from './terrain';

export type Archetype = 'cross' | 'mainStreet' | 'grid' | 'ring' | 'walled' | 'terraced' | 'river';
export const ARCHETYPES: readonly Archetype[] = ['cross', 'mainStreet', 'grid', 'ring', 'walled', 'terraced', 'river'];

export type Enclosure = 'none' | 'fence' | 'palisade' | 'wall';
export type Face = 'S' | 'E';
export type Zone = 'market' | 'craft' | 'homes' | 'temple' | 'guard';

export interface Tile {
  x: number;
  y: number;
}

/** Footprint (w along x, d along y) by building kind. */
export const FOOTPRINT: Record<BuildingKind, [number, number]> = {
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
  hermitage: [3, 3],
};

/** Kinds whose sprite draws its door on the south face whatever the building's orientation. */
const SOUTH_ONLY: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['smithy', 'market', 'shrine']);

export const ZONE_OF: Partial<Record<BuildingKind, Zone>> = {
  shrine: 'temple',
  pagoda: 'temple',
  hall: 'temple',
  dojo: 'temple',
  inn: 'market',
  market: 'market',
  teahouse: 'market',
  warehouse: 'market',
  smithy: 'craft',
  alchemy: 'craft',
  herbHut: 'craft',
  barracks: 'guard',
  house: 'homes',
  farmhouse: 'homes',
};

export interface SettlementSpec {
  /** Settlement radius: the ring that counts as "inside" for safe zones, gates and the clear ground. */
  radius: number;
  /** Buildings to place, most important first (the plan places as many as fit). */
  program: BuildingKind[];
  /** Archetype weights. */
  archetypes: readonly (readonly [Archetype, number])[];
  /** Number of farm patches outside the ring. */
  farms: number;
  population: number;
}

const times = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

export const SPECS: Record<SettlementKind, SettlementSpec> = {
  hamlet: {
    radius: 11,
    program: ['shrine', 'herbHut', ...times(2, 'farmhouse' as BuildingKind), ...times(4, 'house' as BuildingKind)],
    archetypes: [['cross', 3], ['mainStreet', 3], ['ring', 2]],
    farms: 1,
    population: 90,
  },
  village: {
    radius: 16,
    program: ['shrine', 'dojo', 'inn', 'market', 'teahouse', 'smithy', 'alchemy', 'herbHut', 'farmhouse', 'farmhouse', ...times(9, 'house' as BuildingKind)],
    archetypes: [['mainStreet', 3], ['grid', 2], ['ring', 2], ['terraced', 1], ['river', 2]],
    farms: 2,
    population: 220,
  },
  town: {
    radius: 20,
    program: [
      'shrine',
      'dojo',
      'inn',
      'inn',
      'market',
      'market',
      'teahouse',
      'teahouse',
      'warehouse',
      'smithy',
      'alchemy',
      'herbHut',
      'barracks',
      'barracks',
      ...times(18, 'house' as BuildingKind),
    ],
    archetypes: [['grid', 2], ['ring', 2], ['walled', 3], ['terraced', 1], ['river', 2], ['mainStreet', 1]],
    farms: 2,
    population: 600,
  },
  fort: {
    radius: 17,
    program: ['shrine', 'dojo', 'inn', 'market', 'smithy', 'alchemy', 'barracks', 'barracks', 'barracks', 'warehouse', ...times(4, 'house' as BuildingKind)],
    archetypes: [['walled', 1]],
    farms: 0,
    population: 320,
  },
  sectHall: {
    radius: 18,
    program: ['pagoda', 'hall', 'hall', 'dojo', 'dojo', 'shrine', 'alchemy', 'teahouse', ...times(6, 'house' as BuildingKind)],
    archetypes: [['ring', 3], ['terraced', 2]],
    farms: 0,
    population: 260,
  },
  ruin: { radius: 13, program: [], archetypes: [['cross', 1]], farms: 0, population: 0 },
};

/** Which enclosure a settlement of this kind and archetype gets. */
export function enclosureFor(kind: SettlementKind, archetype: Archetype): Enclosure {
  if (kind === 'ruin') return 'none';
  if (kind === 'fort') return 'wall';
  if (kind === 'sectHall') return 'wall';
  if (archetype === 'walled') return 'palisade';
  return kind === 'hamlet' || kind === 'village' ? 'fence' : 'none';
}

export interface PlacedLot {
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  d: number;
  face: Face;
  /** The tile in front of the entrance. */
  door: Tile;
  zone: Zone;
  /** The door is not on a street: worldgen cuts a footpath to the nearest road. */
  needsPath?: boolean;
}

export interface TownPlan {
  archetype: Archetype;
  enclosure: Enclosure;
  radius: number;
  roads: Tile[];
  dirt: Tile[];
  plaza: Tile[];
  water: Tile[];
  bridges: Tile[];
  lots: PlacedLot[];
  /** Tiles of the enclosure (walls, palisade or fence), openings at the four axes left out. */
  enclosureTiles: Tile[];
  wells: Tile[];
  lanterns: Tile[];
  gardens: Tile[];
  /** Trees and bushes left standing between the blocks. */
  trees: Tile[];
  /** Programme entries that did not fit. */
  missing: BuildingKind[];
}

export interface PlanInput {
  kind: SettlementKind;
  spec: SettlementSpec;
  archetype: Archetype;
  /** May this tile (relative to the centre) be built on or paved? */
  field: (dx: number, dy: number) => boolean;
  rng: Rng;
  /** Axis the trade road leaves along: the main street of a `mainStreet` town runs this way. */
  mainAxis?: 'x' | 'y';
}

// cell kinds of the working canvas
const FREE = 0;
const ROAD = 1;
const PLAZA = 2;
const DIRT = 3;
const WATER = 4;
const BRIDGE = 5;
const LOT = 6;
const ENCL = 7;
const PROP = 8;

const DIAGONALS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

/** Ideal distance from the centre (share of the interior radius) and how strongly a zone hugs its quarter. */
const ZONE_IDEAL: Record<Zone, { r: number; ang: number }> = {
  market: { r: 0.3, ang: 0.8 },
  temple: { r: 0.45, ang: 2.2 },
  craft: { r: 0.5, ang: 2.2 },
  guard: { r: 0.72, ang: 2.2 },
  homes: { r: 0.62, ang: 0 },
};

const angDiff = (a: number, b: number): number => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

export function planTown(input: PlanInput): TownPlan {
  const { kind, spec, archetype, field, rng } = input;
  const R = spec.radius;
  const enclosure = enclosureFor(kind, archetype);
  const enclosed = enclosure !== 'none';
  const E = R - 1;
  /** Interior limit for buildings. */
  const I = enclosed ? R - 3 : R - 1;
  const N = 2 * (R + 3) + 1;
  const O = R + 3;
  const cells = new Uint8Array(N * N);
  /** Tiles of the principal streets (lots prefer to front them). */
  const primary = new Uint8Array(N * N);
  const idx = (x: number, y: number) => (y + O) * N + (x + O);
  const inCanvas = (x: number, y: number) => x >= -O && y >= -O && x <= O && y <= O;
  const get = (x: number, y: number) => (inCanvas(x, y) ? cells[idx(x, y)] : 255);
  const put = (x: number, y: number, v: number) => {
    if (inCanvas(x, y)) cells[idx(x, y)] = v;
  };
  const inside = (x: number, y: number) => (enclosed ? Math.max(Math.abs(x), Math.abs(y)) <= I : Math.max(Math.abs(x), Math.abs(y)) <= I && Math.abs(x) + Math.abs(y) <= Math.floor(I * 1.55));
  const buildable = (x: number, y: number) => inCanvas(x, y) && field(x, y);

  // ---- streets ----------------------------------------------------------------------------------------------------------
  const pave = (x: number, y: number, v: number = ROAD): void => {
    if (!inCanvas(x, y)) return;
    const c = get(x, y);
    if (c === WATER) {
      put(x, y, BRIDGE);
      return;
    }
    if (c !== FREE && c !== ROAD && c !== DIRT) return;
    if (!buildable(x, y)) return;
    put(x, y, v);
  };
  const hline = (y: number, x0: number, x1: number, v: number = ROAD): void => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) pave(x, y, v);
  };
  const vline = (x: number, y0: number, y1: number, v: number = ROAD): void => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) pave(x, y, v);
  };
  /** A line clipped to the inside of the settlement. */
  const hclip = (y: number, x0: number, x1: number, v: number = ROAD): void => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (inside(x, y)) pave(x, y, v);
  };
  const vclip = (x: number, y0: number, y1: number, v: number = ROAD): void => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (inside(x, y)) pave(x, y, v);
  };
  const avenues = (): void => {
    hline(0, -(R + 1), R + 1);
    vline(0, -(R + 1), R + 1);
  };
  /** Mark the tiles of a straight run as principal. */
  const mark = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (inCanvas(x, y)) primary[idx(x, y)] = 1;
  };

  const phase = rng.next() * Math.PI * 2;
  const mainAxis = input.mainAxis ?? (rng.chance(0.5) ? 'x' : 'y');
  const S = 6;
  /**
   * Cross streets every five to seven tiles on both sides, each running out from the avenue for a random length
   * (so some end in a cul-de-sac) and mostly of dirt. `regular` makes them straight, even and paved (a fort or a walled town).
   */
  const gridLines = (regular = false): void => {
    for (const horizontal of [true, false]) {
      for (const sg of [-1, 1]) {
        let k = 0;
        for (;;) {
          k += regular ? S : 5 + rng.int(0, 2);
          if (k > I - 1) break;
          const lenA = regular ? I : Math.round(I * (0.55 + rng.next() * 0.45));
          const lenB = regular ? I : Math.round(I * (0.55 + rng.next() * 0.45));
          const v = regular || rng.chance(0.4) ? ROAD : DIRT;
          if (horizontal) hclip(sg * k, -lenA, lenB, v);
          else vclip(sg * k, -lenA, lenB, v);
        }
      }
    }
  };
  let plazaHalf = kind === 'hamlet' ? 2 : 3;
  let riverSide = 1;

  if (archetype !== 'mainStreet' && archetype !== 'ring') {
    mark(-I, 0, I, 0);
    mark(0, -I, 0, I);
  }

  switch (archetype) {
    case 'cross': {
      avenues();
      // two short cross lanes either side of the plaza
      const L = Math.floor(I * 0.7);
      for (const sg of [-1, 1]) {
        hclip(sg * S, -L, L);
        vclip(sg * S, -L, L);
      }
      break;
    }
    case 'mainStreet': {
      avenues();
      // swap coordinates for a north-south main street
      const h = (v: number, a: number, b: number, t: number = ROAD) => (mainAxis === 'x' ? hclip(v, a, b, t) : vclip(v, a, b, t));
      const vv = (u: number, a: number, b: number, t: number = ROAD) => (mainAxis === 'x' ? vclip(u, a, b, t) : hclip(u, a, b, t));
      h(1, -I, I); // the street is two tiles wide
      if (mainAxis === 'x') mark(-I, 0, I, 1);
      else mark(0, -I, 1, I);
      // side lanes every eight tiles, shorter towards the ends
      for (let u = 8; u <= I; u += 8) {
        for (const sg of [-1, 1]) {
          const len = Math.max(5, Math.round(I * (0.75 - (u / I) * 0.3)));
          vv(sg * u, -len, len);
        }
      }
      // back lanes on both sides
      const back = Math.min(8, Math.floor(I * 0.5));
      const reach = Math.floor(I * 0.8);
      h(-back, -reach, reach);
      h(back + 1, -reach, reach);
      plazaHalf = kind === 'hamlet' ? 2 : 3;
      break;
    }
    case 'grid': {
      avenues();
      gridLines();
      break;
    }
    case 'walled': {
      avenues();
      gridLines(true);
      break;
    }
    case 'ring': {
      avenues();
      const r1 = Math.max(4, Math.round(I * 0.3));
      mark(-r1, -r1, r1, -r1);
      mark(-r1, r1, r1, r1);
      mark(-r1, -r1, -r1, r1);
      mark(r1, -r1, r1, r1);
      for (let r = r1; r <= I - 1; r += 6) {
        for (let t = -r; t <= r; t++) {
          if (inside(t, -r)) pave(t, -r);
          if (inside(t, r)) pave(t, r);
          if (inside(-r, t)) pave(-r, t);
          if (inside(r, t)) pave(r, t);
        }
      }
      plazaHalf = 2;
      break;
    }
    case 'terraced': {
      avenues();
      // switchback terraces: rows alternately reach the east and the west end, joined by stairs at the ends
      let k = 0;
      const ends: [number, number][] = [];
      for (let y = -Math.floor(I / S) * S; y <= I; y += S, k++) {
        if (y === 0) continue;
        const west = k % 2 === 0;
        const x0 = west ? -I : -Math.floor(I * 0.35);
        const x1 = west ? Math.floor(I * 0.35) : I;
        hclip(y, x0, x1, k % 2 === 0 ? ROAD : DIRT);
        ends.push([y, west ? -I + 2 : I - 2]);
      }
      // stairs joining each terrace to the next one
      for (let i = 0; i + 1 < ends.length; i++) {
        const [ya, xa] = ends[i];
        const [yb] = ends[i + 1];
        if ((ya < 0) !== (yb < 0)) continue;
        vclip(xa, ya, yb, DIRT);
      }
      break;
    }
    case 'river': {
      riverSide = rng.chance(0.5) ? 1 : -1;
      const base = 5 + rng.int(0, 2);
      for (let y = -(R + 1); y <= R + 1; y++) {
        const wob = Math.round(Math.sin(y * 0.33 + phase) * 1.2);
        for (const w of [0, 1]) {
          const x = riverSide * (base + w) + wob;
          if (buildable(x, y) && get(x, y) === FREE) put(x, y, WATER);
        }
      }
      avenues();
      gridLines();
      break;
    }
  }

  // plaza at the centre (over the streets)
  for (let y = -plazaHalf; y <= plazaHalf; y++) for (let x = -plazaHalf; x <= plazaHalf; x++) if (buildable(x, y) && get(x, y) !== WATER && get(x, y) !== BRIDGE) put(x, y, PLAZA);

  // ---- enclosure --------------------------------------------------------------------------------------------------------
  const lots: PlacedLot[] = [];
  if (enclosed) {
    const hash = (x: number, y: number) => ((Math.imul(x * 73856093 ^ y * 19349663, 0x45d9f3b) >>> 0) % 1000) / 1000;
    for (let t = -E; t <= E; t++) {
      for (const [x, y] of [
        [t, -E],
        [t, E],
        [-E, t],
        [E, t],
      ] as const) {
        const onAxis = (Math.abs(x) <= 1 && Math.abs(y) === E) || (Math.abs(y) <= 1 && Math.abs(x) === E);
        if (onAxis) {
          pave(x, y);
          continue;
        }
        if (!buildable(x, y) && get(x, y) !== FREE) continue;
        if (get(x, y) === ROAD || get(x, y) === PLAZA || get(x, y) === DIRT || get(x, y) === BRIDGE) continue;
        if (get(x, y) === WATER) continue;
        // a rail fence has gaps; stone and palisade are continuous
        if (enclosure === 'fence' && hash(x, y) < 0.14) continue;
        if (field(x, y)) put(x, y, ENCL);
      }
    }
    // the axis avenues run through the openings out to the edge
    avenues();
    if (kind === 'fort' || kind === 'sectHall') {
      // corner towers just inside the walls, doors facing the yard (never on the wall line)
      for (const [bx, by] of [
        [-E + 1, -E + 1],
        [E - 2, -E + 1],
        [-E + 1, E - 3],
        [E - 2, E - 3],
      ] as const) {
        let ok = true;
        for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) if (!field(x, y) || get(x, y) !== FREE) ok = false;
        if (!field(bx + 1, by + 2) || get(bx + 1, by + 2) === ENCL) ok = false;
        if (!ok) continue;
        for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) put(x, y, LOT);
        lots.push({ kind: 'tower', x: bx, y: by, w: 2, d: 2, face: 'S', door: { x: bx + 1, y: by + 2 }, zone: 'guard', needsPath: true });
      }
    }
  }

  // streets cut off from the centre (by water or rock) are no use: drop them so no lot fronts an island
  {
    const walk = (v: number) => v === ROAD || v === DIRT || v === PLAZA || v === BRIDGE;
    const seen = new Uint8Array(N * N);
    const stack: number[] = [];
    // seed from the street tile nearest the centre (the centre itself may be water on a coast)
    let start = -1;
    let bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (!walk(cells[i])) continue;
      const x = (i % N) - O;
      const y = Math.floor(i / N) - O;
      const d = x * x + y * y;
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
    if (start >= 0) {
      stack.push(start);
      seen[start] = 1;
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = (i % N) - O;
      const y = Math.floor(i / N) - O;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inCanvas(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!seen[j] && walk(cells[j])) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    for (let i = 0; i < cells.length; i++) if (walk(cells[i]) && !seen[i]) cells[i] = FREE;
  }

  // ---- lots -------------------------------------------------------------------------------------------------------------
  const angles = [...DIAGONALS];
  rng.shuffle(angles);
  const zoneAngle: Record<Zone, number> = { temple: angles[0], craft: angles[1], guard: angles[2], market: angles[3], homes: 0 };
  const ring1 = Math.max(4, Math.round(I * 0.3));

  const doorOk = (x: number, y: number) => {
    const c = get(x, y);
    return c === ROAD || c === PLAZA || c === DIRT || c === BRIDGE;
  };
  const fits = (bx: number, by: number, w: number, d: number, margin: number, slack: number): boolean => {
    for (let y = by - margin; y < by + d + margin; y++) {
      for (let x = bx - margin; x < bx + w + margin; x++) {
        const within = x >= bx && x < bx + w && y >= by && y < by + d;
        const c = get(x, y);
        if (within) {
          if (c !== FREE || !field(x, y) || !(inside(x, y) || (slack > 0 && Math.max(Math.abs(x), Math.abs(y)) <= I + slack))) return false;
        } else if (c === LOT || c === ENCL || c === PROP) return false;
      }
    }
    return true;
  };

  const primaryBonus = archetype === 'mainStreet' || archetype === 'ring' ? 4 : archetype === 'river' ? 2.5 : 1.5;
  const scoreOf = (zone: Zone, cx: number, cy: number, onMain: boolean, onPrimary: boolean): number => {
    const ideal = ZONE_IDEAL[zone];
    let r = ideal.r * I;
    if (archetype === 'ring' && zone === 'temple') r = ring1 * 0.55;
    const dist = Math.hypot(cx, cy);
    let s = -Math.abs(dist - r) * 0.6;
    if (ideal.ang > 0) s -= angDiff(Math.atan2(cy, cx), zoneAngle[zone]) * ideal.ang;
    if (archetype === 'mainStreet' && zone === 'market' && onMain) s += 2.5;
    if (onPrimary) s += primaryBonus;
    return s + rng.next() * 2;
  };

  let roadTiles: Tile[] = [];
  const scanRoads = (): void => {
    roadTiles = [];
    for (let y = -O; y <= O; y++) for (let x = -O; x <= O; x++) if (doorOk(x, y)) roadTiles.push({ x, y });
  };
  scanRoads();

  const place = (kindB: BuildingKind, margin: number, slack = 0): PlacedLot | null => {
    const [w, d] = FOOTPRINT[kindB];
    const zone = ZONE_OF[kindB] ?? 'homes';
    let best: { lot: PlacedLot; score: number } | null = null;
    for (const t of roadTiles) {
      if (get(t.x, t.y) === BRIDGE) continue;
      const opts: [Face, number, number][] = [['S', t.x - (w >> 1), t.y - d]];
      if (!SOUTH_ONLY.has(kindB)) opts.push(['E', t.x - w, t.y - (d >> 1)]);
      for (const [face, bx, by] of opts) {
        if (!fits(bx, by, w, d, margin, slack)) continue;
        const onMain = mainAxis === 'x' ? t.y <= 1 && t.y >= 0 : t.x <= 1 && t.x >= 0;
        const score = scoreOf(zone, bx + w / 2, by + d / 2, onMain, primary[idx(t.x, t.y)] === 1);
        if (!best || score > best.score) best = { lot: { kind: kindB, x: bx, y: by, w, d, face, door: { x: t.x, y: t.y }, zone }, score };
      }
    }
    if (!best) return null;
    const l = best.lot;
    for (let y = l.y; y < l.y + l.d; y++) for (let x = l.x; x < l.x + l.w; x++) put(x, y, LOT);
    return l;
  };

  let missing: BuildingKind[] = [];
  const placeAny = (kb: BuildingKind): PlacedLot | null => place(kb, 1) ?? place(kb, 0) ?? place(kb, 0, 2);
  for (const kb of spec.program) {
    const l = placeAny(kb);
    if (l) lots.push(l);
    else missing.push(kb);
  }

  /**
   * Ground the streets never reached (a ridge or a lake cut an avenue short) is left empty by the layout above. When the
   * programme did not fit, run a dirt spur from the nearest street out to the middle of such a pocket and try again.
   */
  const spur = (): boolean => {
    const dist = new Int16Array(N * N).fill(-1);
    const from = new Int32Array(N * N).fill(-1);
    const queue: number[] = [];
    for (let y = -O; y <= O; y++) {
      for (let x = -O; x <= O; x++) {
        const c = get(x, y);
        if (c === ROAD || c === PLAZA || c === DIRT || c === BRIDGE) {
          dist[idx(x, y)] = 0;
          queue.push(idx(x, y));
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = (i % N) - O;
      const y = Math.floor(i / N) - O;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inCanvas(nx, ny) || !inside(nx, ny) || get(nx, ny) !== FREE || !field(nx, ny)) continue;
        const j = idx(nx, ny);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        from[j] = i;
        queue.push(j);
      }
    }
    // the roomiest cell about seven tiles from any street
    let best = -1;
    let bestRoom = 0;
    for (const i of queue) {
      if (dist[i] !== 7) continue;
      const x = (i % N) - O;
      const y = Math.floor(i / N) - O;
      let room = 0;
      for (let yy = y - 4; yy <= y + 4; yy++) for (let xx = x - 4; xx <= x + 4; xx++) if (get(xx, yy) === FREE && field(xx, yy)) room++;
      if (room > bestRoom + (rng.chance(0.2) ? 2 : 0)) {
        best = i;
        bestRoom = room;
      }
    }
    if (best < 0 || bestRoom < 30) return false;
    for (let i = best; i >= 0 && dist[i] > 0; i = from[i]) put((i % N) - O, Math.floor(i / N) - O, DIRT);
    return true;
  };
  for (let round = 0; round < 6 && missing.length > 0; round++) {
    if (!spur()) break;
    scanRoads();
    const still: BuildingKind[] = [];
    for (const kb of missing) {
      const l = placeAny(kb);
      if (l) lots.push(l);
      else still.push(kb);
    }
    missing = still;
  }

  // ---- props ------------------------------------------------------------------------------------------------------------
  const free = (x: number, y: number) => get(x, y) === FREE && field(x, y) && inside(x, y);
  const doorTiles = new Set(lots.map((l) => `${l.door.x},${l.door.y}`));
  const wells: Tile[] = [];
  const lanterns: Tile[] = [];
  const gardens: Tile[] = [];
  // a well at the plaza corner, lanterns at the other corners
  const pc: [number, number][] = [
    [plazaHalf, -plazaHalf],
    [-plazaHalf, plazaHalf],
    [plazaHalf, plazaHalf],
    [-plazaHalf, -plazaHalf],
  ];
  pc.forEach(([x, y], i) => {
    if (get(x, y) !== PLAZA || doorTiles.has(`${x},${y}`)) return;
    put(x, y, PROP);
    (i === 0 && kind !== 'hamlet' ? wells : lanterns).push({ x, y });
  });
  if (kind === 'hamlet' && wells.length === 0 && get(-plazaHalf, plazaHalf) === PROP) wells.push(lanterns.splice(lanterns.findIndex((l) => l.x === -plazaHalf && l.y === plazaHalf), 1)[0]);
  // lanterns every few tiles along the avenues, on the south / east side
  for (let t = 4; t <= I; t += 5) {
    for (const sg of [-1, 1]) {
      const cand: Tile[] = [
        { x: sg * t, y: 1 },
        { x: 1, y: sg * t },
      ];
      for (const c of cand) {
        if (free(c.x, c.y) && !doorTiles.has(`${c.x},${c.y}`)) {
          put(c.x, c.y, PROP);
          lanterns.push(c);
        }
      }
    }
  }
  // gardens behind about half the houses
  for (const l of lots) {
    if (l.kind !== 'house' && l.kind !== 'farmhouse') continue;
    if (!rng.chance(0.6)) continue;
    const g: Tile = l.face === 'S' ? { x: l.x + 1, y: l.y - 1 } : { x: l.x - 1, y: l.y + 1 };
    if (free(g.x, g.y)) {
      put(g.x, g.y, PROP);
      gardens.push(g);
    }
  }

  // trees and bushes in the blocks, away from the streets
  const trees: Tile[] = [];
  const nearStreet = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
    const c = get(x + dx, y + dy);
    return c === ROAD || c === PLAZA || c === DIRT || c === BRIDGE;
  });
  for (let y = -I; y <= I; y++) {
    for (let x = -I; x <= I; x++) {
      if (!free(x, y) || nearStreet(x, y)) continue;
      if (rng.next() < 0.07) {
        put(x, y, PROP);
        trees.push({ x, y });
      }
    }
  }

  // ---- collect ----------------------------------------------------------------------------------------------------------
  const collect = (v: number): Tile[] => {
    const out: Tile[] = [];
    for (let y = -O; y <= O; y++) for (let x = -O; x <= O; x++) if (cells[idx(x, y)] === v) out.push({ x, y });
    return out;
  };
  const plazaTiles = collect(PLAZA);
  void riverSide;
  return {
    archetype,
    enclosure,
    radius: R,
    roads: collect(ROAD),
    dirt: collect(DIRT),
    plaza: plazaTiles,
    water: collect(WATER),
    bridges: collect(BRIDGE),
    lots,
    enclosureTiles: collect(ENCL),
    wells,
    lanterns,
    gardens,
    trees,
    missing,
  };
}

/** Pick an archetype by weight. */
export function pickArchetype(kind: SettlementKind, rng: Rng): Archetype {
  const list = SPECS[kind].archetypes;
  const total = list.reduce((n, [, w]) => n + w, 0);
  let r = rng.next() * total;
  for (const [a, w] of list) {
    r -= w;
    if (r <= 0) return a;
  }
  return list[0][0];
}
