/**
 * Landmarks: the places people look for (inns, markets, smithies, shrines, training halls, hermitages, gates). Pure and
 * derived from the world data, so the renderer (beacons), the World panel (the list) and the NPC life places (gates) agree.
 */
import type { BuildingDef, BuildingKind, SettlementDef } from './terrain';

export type LandmarkKind = 'inn' | 'market' | 'smithy' | 'alchemy' | 'shrine' | 'dojo' | 'hall' | 'pagoda' | 'hermitage' | 'gate';

export const LANDMARK_LABEL: Record<LandmarkKind, string> = {
  inn: 'Inn',
  market: 'Market',
  smithy: 'Smithy',
  alchemy: 'Alchemist',
  shrine: 'Shrine',
  dojo: 'Dojo',
  hall: 'Hall',
  pagoda: 'Pagoda',
  hermitage: 'Hermitage',
  gate: 'Gate',
};

/** Which building kinds are landmarks (everything but plain houses, huts and mine mouths). */
const BUILDING_LANDMARK: Partial<Record<BuildingKind, LandmarkKind>> = {
  inn: 'inn',
  market: 'market',
  smithy: 'smithy',
  alchemy: 'alchemy',
  shrine: 'shrine',
  dojo: 'dojo',
  hall: 'hall',
  pagoda: 'pagoda',
  hermitage: 'hermitage',
  gate: 'gate',
};

export interface LandmarkDef {
  /** Stable id: `b<building id>` or `g<settlement>_<direction>` for a settlement gate. */
  id: string;
  kind: LandmarkKind;
  /** Kind label, numbered when the settlement has several of the kind ("Inn 2"). */
  label: string;
  sid: number;
  settlement: string;
  /** Tile coordinates of the middle of the place (the door tile for a building is `door`). */
  x: number;
  y: number;
  /** Building id, or -1 for a gate. */
  building: number;
}

export interface LandmarkWorld {
  settlements: readonly SettlementDef[];
  buildings: readonly BuildingDef[];
  roads: readonly (readonly [number, number])[];
}

interface Dir {
  x: number;
  y: number;
}

/** The compass axis (tile axes) nearest an angle. */
export function axisDir(angle: number): Dir {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Math.abs(c) >= Math.abs(s) ? { x: Math.sign(c) || 1, y: 0 } : { x: 0, y: Math.sign(s) || 1 };
}

/**
 * The directions (unit tile axes) in which roads leave a settlement: one per road towards a neighbour, at least two,
 * and all four for a fort (its wall has four openings). The cross roads of a settlement run along these axes.
 */
export function gateDirs(s: SettlementDef, roads: LandmarkWorld['roads'], settlements: readonly SettlementDef[]): Dir[] {
  const dirs: Dir[] = [];
  const add = (d: Dir) => {
    if (!dirs.some((o) => o.x === d.x && o.y === d.y)) dirs.push(d);
  };
  for (const [a, b] of roads) {
    const other = a === s.id ? b : b === s.id ? a : -1;
    const o = other >= 0 ? settlements[other] : undefined;
    if (o) add(axisDir(Math.atan2(o.y - s.y, o.x - s.x)));
  }
  for (let k = 0; (dirs.length < 2 || s.kind === 'fort') && k < 4; k++) add(axisDir(Math.PI / 2 + (k * Math.PI) / 2));
  return dirs;
}

/** Where a gate stands on its road: just inside the edge of the settlement. */
export function gateTile(s: SettlementDef, d: Dir): { x: number; y: number } {
  const r = Math.round(s.radius * 0.9);
  return { x: s.x + d.x * r, y: s.y + d.y * r };
}

/** Screen-side name of a gate direction (isometric view: +x runs down-right, +y down-left). */
export function gateSide(d: Dir): string {
  return d.x > 0 ? 'Southeast' : d.x < 0 ? 'Northwest' : d.y > 0 ? 'Southwest' : 'Northeast';
}

/** Every landmark of the world, grouped by settlement in id order. Ruins have none. */
export function landmarksOf(world: LandmarkWorld): LandmarkDef[] {
  const out: LandmarkDef[] = [];
  for (const s of world.settlements) {
    if (s.kind === 'ruin') continue;
    const mine: LandmarkDef[] = [];
    for (const b of world.buildings) {
      if (b.settlementId !== s.id) continue;
      const kind = BUILDING_LANDMARK[b.kind];
      if (!kind) continue;
      mine.push({ id: `b${b.id}`, kind, label: LANDMARK_LABEL[kind], sid: s.id, settlement: s.name, x: b.x + b.w / 2, y: b.y + b.d / 2, building: b.id });
    }
    if (!mine.some((m) => m.kind === 'gate')) {
      for (const d of gateDirs(s, world.roads, world.settlements)) {
        const t = gateTile(s, d);
        mine.push({ id: `g${s.id}_${d.x > 0 ? 'x+' : d.x < 0 ? 'x-' : d.y > 0 ? 'y+' : 'y-'}`, kind: 'gate', label: `${gateSide(d)} Gate`, sid: s.id, settlement: s.name, x: t.x, y: t.y, building: -1 });
      }
    }
    // number the repeated kinds ("Inn 1", "Inn 2")
    const total = new Map<LandmarkKind, number>();
    for (const m of mine) if (m.kind !== 'gate') total.set(m.kind, (total.get(m.kind) ?? 0) + 1);
    const seen = new Map<LandmarkKind, number>();
    for (const m of mine) {
      if ((total.get(m.kind) ?? 0) < 2 || m.kind === 'gate') continue;
      const n = (seen.get(m.kind) ?? 0) + 1;
      seen.set(m.kind, n);
      m.label = `${m.label} ${n}`;
    }
    out.push(...mine);
  }
  return out;
}

/** The living settlement nearest to a point (by distance from its edge), or null when there is none. */
export function nearestLivingSettlement(settlements: readonly SettlementDef[], x: number, y: number): SettlementDef | null {
  let best: SettlementDef | null = null;
  let bd = Infinity;
  for (const s of settlements) {
    if (s.kind === 'ruin') continue;
    const d = Math.hypot(s.x - x, s.y - y) - s.radius;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
