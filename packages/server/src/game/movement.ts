/**
 * Server-authoritative movement: A* over the static world, one tile per step.
 *
 * Step time = STEP_MS / tileSpeed(destination) / entity speed (x sqrt 2 on diagonals).
 * An entity's (x, y) is the tile it is leaving until the step completes; the client receives
 * (x, y) -> (nx, ny) plus the remaining `step` ms and interpolates.
 *
 * Facing (Dir) uses the isometric projection sx = x - y, sy = x + y:
 *   (+1, 0) -> 0 SE (screen down-right)   (0, +1) -> 1 SW (screen down-left)
 *   (-1, 0) -> 2 NW (screen up-left)      (0, -1) -> 3 NE (screen up-right)
 * Tile diagonals move along one screen axis only (e.g. (+1,+1) is straight down). The sign on that
 * axis picks the screen half; the other half is kept from the previous facing, so walking straight
 * down while facing SW stays SW, and while facing NE turns to SE.
 */
import { STEP_MS, dist, findPath, isPassable, nearestWalkable, tileSpeed, type Dir, type PathGrid, type Point, type WorldData } from '@murim/shared';
import type { ApproachOptions, ArriveResult, Entity, MoveGuard, MoveOptions, MoveResult, MovementApi, Player } from '../ctx';
import type { EntityImpl, EntityStoreImpl, MoveStateImpl } from './entities';

export const DEFAULT_MAX_NODES = 8000;
export const DEFAULT_MAX_STEPS = 160;
export const DEFAULT_SNAP = 4;
export const DEFAULT_APPROACH_RANGE = 1.5;
const MIN_SPEED = 0.2;
const MAX_SPEED = 5;

/** Facing for a step (dx, dy), keeping `prev` where the step is ambiguous. */
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

/** Duration of one step onto (nx, ny). */
export function stepDuration(world: WorldData, fromX: number, fromY: number, nx: number, ny: number, speed: number): number {
  const ts = tileSpeed(world, nx, ny) || 1;
  const diag = fromX !== nx && fromY !== ny;
  const s = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed || 1));
  return (STEP_MS / ts / s) * (diag ? Math.SQRT2 : 1);
}

export class Movement implements MovementApi {
  readonly guards: MoveGuard[] = [];
  private readonly moving = new Set<EntityImpl>();

  constructor(
    private readonly world: WorldData,
    private readonly grid: PathGrid,
    private readonly entities: EntityStoreImpl,
    private readonly now: () => number,
  ) {
    entities.onRemove((e) => {
      const impl = e as EntityImpl;
      if (impl.move) this.finish(impl, 'removed');
    });
  }

  get movingCount(): number {
    return this.moving.size;
  }

  canMove(p: Player): string | null {
    for (const g of this.guards) {
      const reason = g(p);
      if (reason) return reason;
    }
    return null;
  }

  isMoving(e: Entity): boolean {
    return e.move !== null;
  }

  moveTo(target: Entity, x: number, y: number, opts: MoveOptions = {}): MoveResult {
    const e = this.entities.getImpl(target.id);
    if (!e || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'blocked' };
    x = Math.round(x);
    y = Math.round(y);
    const m = e.move;
    const sx = m ? m.nx : e.x;
    const sy = m ? m.ny : e.y;
    const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    const snap = opts.snap ?? DEFAULT_SNAP;
    let tx = x;
    let ty = y;
    if (!isPassable(this.world, tx, ty)) {
      const p = snap > 0 ? nearestWalkable(this.grid, tx, ty, snap) : null;
      if (!p) return { ok: false, reason: 'blocked' };
      tx = p.x;
      ty = p.y;
    }
    if (Math.max(Math.abs(tx - sx), Math.abs(ty - sy)) > maxSteps) return { ok: false, reason: 'too_far' };
    const path = tx === sx && ty === sy ? [] : findPath(this.grid, sx, sy, tx, ty, opts.maxNodes ?? DEFAULT_MAX_NODES);
    if (!path) return { ok: false, reason: 'unreachable' };
    if (path.length > maxSteps) return { ok: false, reason: 'too_far' };
    if (!m && path.length === 0) {
      opts.onArrive?.(e, 'arrived');
      return { ok: true, tx, ty, steps: 0 };
    }
    this.start(e, path, tx, ty, opts);
    return { ok: true, tx, ty, steps: path.length + (m ? 1 : 0) };
  }

  approach(entity: Entity, goal: Entity, opts: ApproachOptions = {}): MoveResult {
    const e = this.entities.getImpl(entity.id);
    if (!e || !this.entities.has(goal.id)) return { ok: false, reason: 'blocked' };
    const range = Math.max(0.5, opts.range ?? DEFAULT_APPROACH_RANGE);
    const snap = opts.snap ?? DEFAULT_SNAP;
    const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    const done = opts.onArrive;
    let retries = opts.retries ?? 3;
    // Where the goal stood when the current leg was planned (to tell "it moved" from "unreachable tile").
    let plannedGx = goal.x;
    let plannedGy = goal.y;

    const arrive = (ent: Entity, result: ArriveResult): void => {
      if (result !== 'arrived') {
        done?.(ent, result);
        return;
      }
      const g = this.entities.get(goal.id);
      if (!g) {
        done?.(ent, 'cancelled');
        return;
      }
      if (dist(ent.x, ent.y, g.x, g.y) <= range + 1e-6 || (g.x === plannedGx && g.y === plannedGy)) {
        done?.(ent, 'arrived');
        return;
      }
      if (retries-- > 0 && leg().ok) return;
      done?.(ent, 'cancelled');
    };

    const leg = (): MoveResult => {
      const g = this.entities.get(goal.id);
      if (!g) return { ok: false, reason: 'blocked' };
      const m = e.move;
      const sx = m ? m.nx : e.x;
      const sy = m ? m.ny : e.y;
      plannedGx = g.x;
      plannedGy = g.y;
      if (!m && dist(sx, sy, g.x, g.y) <= range) {
        done?.(e, 'arrived');
        return { ok: true, tx: sx, ty: sy, steps: 0 };
      }
      let tx = g.x;
      let ty = g.y;
      if (!isPassable(this.world, tx, ty)) {
        const p = snap > 0 ? nearestWalkable(this.grid, tx, ty, snap) : null;
        if (!p) return { ok: false, reason: 'blocked' };
        tx = p.x;
        ty = p.y;
      }
      if (Math.max(Math.abs(tx - sx), Math.abs(ty - sy)) > maxSteps) return { ok: false, reason: 'too_far' };
      let path: Point[] | null = tx === sx && ty === sy ? [] : findPath(this.grid, sx, sy, tx, ty, opts.maxNodes ?? DEFAULT_MAX_NODES);
      if (!path) return { ok: false, reason: 'unreachable' };
      // Stop at the first tile that is close enough instead of standing on the goal.
      const cut = path.findIndex((p) => dist(p.x, p.y, g.x, g.y) <= range);
      if (cut >= 0) path = path.slice(0, cut + 1);
      if (path.length > maxSteps) return { ok: false, reason: 'too_far' };
      const endX = path.length ? path[path.length - 1].x : sx;
      const endY = path.length ? path[path.length - 1].y : sy;
      if (path.length === 0 && !m) {
        done?.(e, 'arrived');
        return { ok: true, tx: endX, ty: endY, steps: 0 };
      }
      this.start(e, path, endX, endY, { ...opts, onArrive: arrive });
      return { ok: true, tx: endX, ty: endY, steps: path.length + (m ? 1 : 0) };
    };
    return leg();
  }

  followPath(target: Entity, path: readonly Point[], opts: MoveOptions = {}): boolean {
    const e = this.entities.getImpl(target.id);
    if (!e || path.length === 0) return false;
    // Validate adjacency and passability so callers cannot teleport through walls.
    let px = e.move ? e.move.nx : e.x;
    let py = e.move ? e.move.ny : e.y;
    for (const p of path) {
      if (Math.abs(p.x - px) > 1 || Math.abs(p.y - py) > 1 || !isPassable(this.world, p.x, p.y)) return false;
      px = p.x;
      py = p.y;
    }
    const last = path[path.length - 1];
    this.start(e, path.map((p) => ({ x: p.x, y: p.y })), last.x, last.y, opts);
    return true;
  }

  private start(e: EntityImpl, path: Point[], tx: number, ty: number, opts: MoveOptions): void {
    const speed = opts.speed ?? e.speed;
    const m = e.move;
    if (m) {
      // Keep the step in progress; replace what comes after it.
      const old = m.onArrive;
      m.onArrive = opts.onArrive;
      m.path = path;
      m.tx = tx;
      m.ty = ty;
      m.speed = speed;
      m.stopAfterStep = false;
      old?.(e, 'cancelled');
      return;
    }
    const first = path.shift()!;
    const move: MoveStateImpl = { nx: e.x, ny: e.y, stepStart: 0, stepMs: 0, path, tx, ty, seq: 0, speed, stopAfterStep: false, onArrive: opts.onArrive };
    e.move = move;
    this.moving.add(e);
    this.beginStep(e, first.x, first.y, this.now());
  }

  private beginStep(e: EntityImpl, nx: number, ny: number, start: number): void {
    const m = e.move!;
    m.stepMs = stepDuration(this.world, e.x, e.y, nx, ny, m.speed);
    m.stepStart = start;
    e.face = faceFor(nx - e.x, ny - e.y, e.face);
    m.nx = nx;
    m.ny = ny;
    m.seq++;
    if (e.state === 'idle') e.state = 'walk';
    this.entities.touch(e);
  }

  private finish(e: EntityImpl, result: ArriveResult): void {
    const m = e.move;
    if (!m) return;
    e.move = null;
    this.moving.delete(e);
    if (e.state === 'walk') e.state = 'idle';
    this.entities.touch(e);
    m.onArrive?.(e, result);
  }

  stop(target: Entity, immediate = false): void {
    const e = this.entities.getImpl(target.id);
    if (!e?.move) return;
    if (immediate) this.finish(e, 'cancelled');
    else {
      e.move.path = [];
      e.move.stopAfterStep = true;
    }
  }

  teleport(target: Entity, x: number, y: number): void {
    const e = this.entities.getImpl(target.id);
    if (!e) return;
    if (e.move) this.finish(e, 'cancelled');
    this.entities.setPos(e, x, y);
    this.entities.touch(e);
  }

  /** Advance every moving entity to `now`. Bounded: at most a few steps per entity per tick. */
  update(now: number): void {
    for (const e of this.moving) {
      let guard = 0;
      while (e.move && guard++ < 6) {
        const m = e.move;
        const end = m.stepStart + m.stepMs;
        if (now < end) break;
        this.entities.setPos(e, m.nx, m.ny);
        if (m.stopAfterStep || m.path.length === 0) {
          this.finish(e, m.stopAfterStep ? 'cancelled' : 'arrived');
          break;
        }
        const next = m.path.shift()!;
        // Carry the remainder over so speed is exact, but never fast-forward after a stall.
        this.beginStep(e, next.x, next.y, now - end > m.stepMs ? now : end);
      }
    }
  }
}
