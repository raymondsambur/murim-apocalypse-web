/**
 * Where a war party comes from and where everybody stands: the approach route (spawn point -> gate), the forming
 * line outside the gate, the defenders' line, plaza spots. Everything is derived from the static world and the sim
 * state, never stored.
 */
import { dist, findPath, isPassable, nearestWalkable, type Dir, type Point } from '@murim/shared';
import type { GameContext } from '../ctx';
import { worldPlaces, type Place, type SettlementPlaces } from '../npclife/places';
import { SIEGE_TUNING as T } from './tuning';

export interface Approach {
  /** The gate under attack. */
  gate: Place;
  /** Tiles from the far spawn point (index 0) to the gate door (last). */
  route: Point[];
  /** Route index where the leader of the column stands (about 26-34 tiles from the gate); the others line up behind it. */
  leadIdx: number;
  /** Where the party forms up before the charge (`lineDist` tiles from the gate). */
  line: Point;
  /** Unit vector from the line towards the gate. */
  dirIn: { x: number; y: number };
  /** 'road': the route follows a real path to where the raiders come from; 'direct': a straight approach was used. */
  kind: 'road' | 'direct';
}

export function placesOf(ctx: GameContext, sid: number): SettlementPlaces | undefined {
  return worldPlaces(ctx.world, ctx.grid).settlements.get(sid);
}

/** Facing for a step (isometric: 0 SE, 1 SW, 2 NW, 3 NE). */
export function faceFor(dx: number, dy: number, prev: Dir): Dir {
  const sx = Math.sign(dx - dy);
  const sy = Math.sign(dx + dy);
  if (sx === 0 && sy === 0) return prev;
  const prevRight = prev === 0 || prev === 3;
  const prevDown = prev === 0 || prev === 1;
  const right = sx === 0 ? prevRight : sx > 0;
  const down = sy === 0 ? prevDown : sy > 0;
  if (down) return right ? 0 : 1;
  return right ? 3 : 2;
}

/** Stable pseudo-random angle for (settlement, key). */
function hashAngle(sid: number, key: string): number {
  let h = 2166136261 ^ sid;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** The point the raiders come from: their nearest settlement, the nearest Blight heart or the thickest Blight. */
export function originPoint(ctx: GameContext, sid: number, by: string): Point {
  const s = ctx.world.settlements[sid];
  if (by !== 'blight') {
    const st = ctx.sim.state;
    let best: Point | null = null;
    let bestD = Infinity;
    for (const o of st.settlements) {
      if (o.id === sid || o.controller !== by || o.status === 'fallen') continue;
      const def = ctx.world.settlements[o.id];
      const d = dist(def.x, def.y, s.x, s.y);
      if (d < bestD) {
        best = { x: def.spawn.x, y: def.spawn.y };
        bestD = d;
      }
    }
    if (best) return best;
    const cap = st.factions.find((f) => f.id === by)?.capital;
    const c = cap !== undefined && cap !== sid ? ctx.world.settlements[cap] : undefined;
    if (c) return { x: c.spawn.x, y: c.spawn.y };
    const a = hashAngle(sid, by);
    return { x: Math.round(s.x + Math.cos(a) * 70), y: Math.round(s.y + Math.sin(a) * 70) };
  }
  let heart: Point | null = null;
  let hd = 150;
  for (const h of ctx.sim.state.hearts) {
    if (h.strength <= 0) continue;
    const d = dist(h.x, h.y, s.x, s.y);
    if (d < hd) {
      heart = { x: h.x, y: h.y };
      hd = d;
    }
  }
  if (heart) return heart;
  let bestA = hashAngle(sid, 'blight');
  let bestB = -1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = ctx.sim.blightAt(s.x + Math.cos(a) * (s.radius + 22), s.y + Math.sin(a) * (s.radius + 22));
    if (b > bestB) {
      bestB = b;
      bestA = a;
    }
  }
  return { x: Math.round(s.x + Math.cos(bestA) * 80), y: Math.round(s.y + Math.sin(bestA) * 80) };
}

function unit(dx: number, dy: number): { x: number; y: number } {
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** Plan the approach of a war party to settlement `sid`. Null when the settlement has no usable gate or plaza. */
export function planApproach(ctx: GameContext, sid: number, by: string, pick: (n: number) => number): Approach | null {
  const sp = placesOf(ctx, sid);
  const s = ctx.world.settlements[sid];
  if (!sp || !s) return null;
  const gates = sp.gates.length ? [...sp.gates] : [sp.plaza];
  const origin = originPoint(ctx, sid, by);
  const dirO = unit(origin.x - s.x, origin.y - s.y);
  gates.sort((a, b) => {
    const ua = unit(a.door.x - s.x, a.door.y - s.y);
    const ub = unit(b.door.x - s.x, b.door.y - s.y);
    return ub.x * dirO.x + ub.y * dirO.y - (ua.x * dirO.x + ua.y * dirO.y);
  });
  const want = T.marchTiles[0] + pick(T.marchTiles[1] - T.marchTiles[0] + 1);
  for (const gate of gates.slice(0, 3)) {
    const r = roadRoute(ctx, gate, origin, want) ?? directRoute(ctx, gate, dirO, want, s.radius);
    if (!r) continue;
    const line = lineOf(r.route, gate);
    return { gate, route: r.route, leadIdx: r.leadIdx, line, dirIn: unit(gate.door.x - line.x, gate.door.y - line.y), kind: r.kind };
  }
  return null;
}

/** Room behind the leader for the biggest column. */
const COLUMN_TILES = Math.ceil((T.partyMax - 1) * T.columnSpacing) + 2;

interface RouteResult {
  route: Point[];
  leadIdx: number;
  kind: 'road' | 'direct';
}

function roadRoute(ctx: GameContext, gate: Place, origin: Point, want: number): RouteResult | null {
  const path = findPath(ctx.grid, gate.door.x, gate.door.y, origin.x, origin.y, 30000);
  if (!path || path.length < 8) return null;
  // The path starts next to the gate; the leader stands where it is `want` tiles away (as the crow flies) from the gate.
  let leadI = path.length - 1;
  for (let i = 0; i < path.length; i++) {
    if (dist(path[i].x, path[i].y, gate.door.x, gate.door.y) >= want) {
      leadI = i;
      break;
    }
  }
  if (leadI < 6) return null;
  const endI = Math.min(path.length - 1, leadI + COLUMN_TILES);
  const route = [{ x: gate.door.x, y: gate.door.y }, ...path.slice(0, endI + 1)].reverse();
  return { route, leadIdx: endI - leadI, kind: 'road' };
}

function directRoute(ctx: GameContext, gate: Place, dir: { x: number; y: number }, want: number, radius: number): RouteResult | null {
  const far = want + COLUMN_TILES;
  for (let d = far; d >= 10; d -= 3) {
    const t = nearestWalkable(ctx.grid, Math.round(gate.door.x + dir.x * d), Math.round(gate.door.y + dir.y * d), 4);
    if (!t || dist(t.x, t.y, gate.door.x, gate.door.y) < Math.min(want * 0.6, radius)) continue;
    const path = findPath(ctx.grid, t.x, t.y, gate.door.x, gate.door.y, 12000);
    if (!path) continue;
    const route = [{ x: t.x, y: t.y }, ...path];
    let leadIdx = 0;
    for (let i = 0; i < route.length; i++) {
      if (dist(route[i].x, route[i].y, gate.door.x, gate.door.y) <= want) {
        leadIdx = i;
        break;
      }
    }
    return { route, leadIdx, kind: 'direct' };
  }
  return null;
}

/** The forming line: the last route tile at least `lineDist` from the gate. */
function lineOf(route: Point[], gate: Place): Point {
  for (let i = route.length - 1; i >= 0; i--) {
    if (dist(route[i].x, route[i].y, gate.door.x, gate.door.y) >= T.lineDist) return route[i];
  }
  return route[0];
}

const passable = (ctx: GameContext, p: Point): boolean => isPassable(ctx.world, p.x, p.y);

/**
 * Spawn tiles for a column of `n` units along the route: the unit at index 0 leads (furthest along the route), the
 * last one is at the very start. Alternate units are shifted a tile sideways where that is walkable.
 */
export function columnSpots(ctx: GameContext, route: Point[], leadIdx: number, n: number): Point[] {
  const out: Point[] = [];
  const last = route.length - 1;
  for (let k = 0; k < n; k++) {
    const i = Math.max(0, Math.min(last, Math.round(leadIdx - k * T.columnSpacing)));
    const base = route[i];
    let spot = base;
    if (k % 2 === 1) {
      const nxt = route[Math.min(last, i + 1)];
      const dx = nxt.x - base.x;
      const dy = nxt.y - base.y;
      const side = { x: base.x - Math.sign(dy), y: base.y + Math.sign(dx) };
      if (passable(ctx, side)) spot = side;
    }
    out.push({ x: spot.x, y: spot.y });
  }
  return out;
}

function walkableNear(ctx: GameContext, x: number, y: number, fallback: Point, r = 2): Point {
  const px = Math.round(x);
  const py = Math.round(y);
  if (isPassable(ctx.world, px, py)) return { x: px, y: py };
  return nearestWalkable(ctx.grid, px, py, r) ?? fallback;
}

/** `n` slots in rows behind `base`, facing along `dir` (rows extend backwards). */
export function blockSlots(ctx: GameContext, base: Point, dir: { x: number; y: number }, n: number, cols: number, gap = 1.7): Point[] {
  const perp = { x: -dir.y, y: dir.x };
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols);
    const col = k % cols;
    const off = (col - (cols - 1) / 2) * gap;
    out.push(walkableNear(ctx, base.x + perp.x * off - dir.x * row * gap, base.y + perp.y * off - dir.y * row * gap, base));
  }
  return out;
}

/**
 * The point the defenders hold: just inside the gate, on the cleared ground of the town (outside the gate the road runs
 * through forest, where tall trees would hide the fight from the people looking on).
 */
export function holdPoint(ctx: GameContext, ap: Approach): Point {
  return walkableNear(ctx, ap.gate.door.x + ap.dirIn.x * T.holdInside, ap.gate.door.y + ap.dirIn.y * T.holdInside, ap.gate.door);
}

/** Where the defenders stand, in rows behind the hold point, facing the gate. */
export function defenderSlots(ctx: GameContext, ap: Approach, n: number): Point[] {
  return blockSlots(ctx, holdPoint(ctx, ap), { x: -ap.dirIn.x, y: -ap.dirIn.y }, n, 5, 1.6);
}

/** Where the war party stands before it charges. */
export function lineSlots(ctx: GameContext, ap: Approach, n: number): Point[] {
  return blockSlots(ctx, ap.line, ap.dirIn, n, 5, 1.7);
}

/** A tile for sacking / looting on the plaza of the settlement. */
export function plazaSpots(sp: SettlementPlaces): Point[] {
  return [sp.plaza.door, ...sp.plaza.spots].map((p) => ({ x: p.x, y: p.y }));
}

/** Where fleeing defenders run: the gate (or post) furthest from the attacked one. */
export function refugeFor(sp: SettlementPlaces, gate: Place): Point {
  let best: Place = sp.plaza;
  let bestD = -1;
  for (const p of [...sp.gates, ...sp.posts]) {
    const d = dist(p.door.x, p.door.y, gate.door.x, gate.door.y);
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  return { x: best.door.x, y: best.door.y };
}
