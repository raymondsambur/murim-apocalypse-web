/**
 * Entity movement interpolation. The server sends the tile an entity stands on (x, y), the next tile
 * (nx, ny) and the step duration in ms. We glide from where the entity is currently drawn toward the
 * next tile so late or early packets never cause a visible snap. Pure (unit tested).
 */

export interface Motion {
  /** Segment start (continuous tile coords). */
  fx: number;
  fy: number;
  /** Segment end. */
  tx: number;
  ty: number;
  /** Start time and duration (ms). */
  t0: number;
  dur: number;
}

/** Beyond this distance (tiles) we snap instead of gliding (teleports, respawns). */
export const SNAP_DIST = 2.5;
/** Glide time used to settle onto a tile when a stop arrives. */
export const SETTLE_MS = 140;

export function makeMotion(x: number, y: number, now: number): Motion {
  return { fx: x, fy: y, tx: x, ty: y, t0: now, dur: 0 };
}

export function motionProgress(m: Motion, now: number): number {
  if (m.dur <= 0) return 1;
  const t = (now - m.t0) / m.dur;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

export function motionPos(m: Motion, now: number, out: { x: number; y: number }): { x: number; y: number } {
  const t = motionProgress(m, now);
  out.x = m.fx + (m.tx - m.fx) * t;
  out.y = m.fy + (m.ty - m.fy) * t;
  return out;
}

export function isMoving(m: Motion, now: number): boolean {
  return m.dur > 0 && now < m.t0 + m.dur && (m.tx !== m.fx || m.ty !== m.fy);
}

const tmp = { x: 0, y: 0 };

/**
 * Apply a server movement update.
 * - With a next tile: glide from the current drawn position to (nx, ny) over `step` ms
 *   (slightly stretched so consecutive steps chain without stalls).
 * - Without: settle onto (x, y).
 */
export function applyMove(m: Motion, now: number, x: number, y: number, nx?: number, ny?: number, step?: number): void {
  motionPos(m, now, tmp);
  const far = Math.abs(tmp.x - x) > SNAP_DIST || Math.abs(tmp.y - y) > SNAP_DIST;
  const sx = far ? x : tmp.x;
  const sy = far ? y : tmp.y;
  if (nx !== undefined && ny !== undefined && step !== undefined && step > 0 && (nx !== x || ny !== y)) {
    // Remaining distance relative to one full step: if we're lagging behind (still before x,y) we
    // take proportionally longer, if we're already partway we take less, keeping speed constant.
    const full = Math.hypot(nx - x, ny - y) || 1;
    const rem = Math.hypot(nx - sx, ny - sy);
    const dur = Math.min(step * 2.2, Math.max(step * 0.35, (step * rem) / full)) * 1.04;
    m.fx = sx;
    m.fy = sy;
    m.tx = nx;
    m.ty = ny;
    m.t0 = now;
    m.dur = dur;
  } else {
    m.fx = sx;
    m.fy = sy;
    m.tx = x;
    m.ty = y;
    m.t0 = now;
    m.dur = far || (sx === x && sy === y) ? 0 : SETTLE_MS;
    if (far) {
      m.fx = x;
      m.fy = y;
    }
  }
}

/** Facing (0 SE, 1 SW, 2 NW, 3 NE) from a tile delta; null when no movement. */
export function faceFromDelta(dx: number, dy: number): 0 | 1 | 2 | 3 | null {
  if (dx === 0 && dy === 0) return null;
  const sx = dx - dy; // screen x direction
  const sy = dx + dy; // screen y direction
  if (sy >= 0) return sx >= 0 ? 0 : 1;
  return sx >= 0 ? 3 : 2;
}
