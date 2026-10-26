/**
 * Occlusion decision for name plates, HP bars and bubbles. Plates are drawn in a device-resolution overlay on top of the whole
 * scene, so an entity standing behind a building or a tall tree would show a plate floating on the roof. During the sorted pass
 * the scene records every tall drawable (buildings, wall tiles, big vegetation, rocks) as an `Occluder`: its screen rectangle,
 * its painter's depth key and, when available, the opaque extent of every sprite row, so the transparent corners of a roof do not
 * count. An entity is covered where an occluder with a larger depth key (drawn after it) overlaps its body box. Cheap: a few
 * sample points per entity against the per-frame list, no pixel readbacks. Pure (unit tested).
 */

/** Opaque extent per sprite row (`min` > `max` marks an empty row). */
export interface RowSpans {
  min: Int16Array;
  max: Int16Array;
}

export interface Occluder {
  /** Scene-px position of the sprite's top-left corner and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Painter's depth key: drawn after every entity whose key is smaller. */
  depth: number;
  spans: RowSpans | null;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Row spans of a pixel buffer's alpha (opaque = alpha above 20). */
export function rowSpans(px: ArrayLike<number>, w: number, h: number): RowSpans {
  const min = new Int16Array(h).fill(32767);
  const max = new Int16Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++)
      if (px[o + x] >>> 24 > 20) {
        if (x < min[y]) min[y] = x;
        max[y] = x;
      }
  }
  return { min, max };
}

/** Is the scene-px point (x, y) covered by an occluder drawn after `key`? */
export function pointCovered(x: number, y: number, key: number, occ: readonly Occluder[], n: number = occ.length): boolean {
  for (let i = 0; i < n; i++) {
    const o = occ[i];
    if (o.depth <= key) continue;
    const lx = x - o.x;
    const ly = y - o.y;
    if (lx < 0 || ly < 0 || lx >= o.w || ly >= o.h) continue;
    if (o.spans) {
      const r = ly | 0;
      if (lx < o.spans.min[r] || lx > o.spans.max[r]) continue;
    }
    return true;
  }
  return false;
}

export interface Coverage {
  /** Fraction (0..1) of the sample points of the body box that are covered. */
  frac: number;
  /** The head point is covered. */
  head: boolean;
}

export const SAMPLE_COLS = 3;
export const SAMPLE_ROWS = 5;

const scratch: Occluder[] = [];

/** Coverage of an entity body box (scene px, `key` = its depth key) by the occluders drawn after it. */
export function coverage(box: Box, key: number, occ: readonly Occluder[], n: number = occ.length, out: Coverage = { frac: 0, head: false }): Coverage {
  // keep only the occluders that can touch the box (one cheap pass), then sample against those
  let m = 0;
  for (let i = 0; i < n; i++) {
    const o = occ[i];
    if (o.depth > key && o.x < box.x1 && o.x + o.w > box.x0 && o.y < box.y1 && o.y + o.h > box.y0) scratch[m++] = o;
  }
  out.frac = 0;
  out.head = false;
  if (m === 0) return out;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  let hit = 0;
  for (let r = 0; r < SAMPLE_ROWS; r++) {
    const y = box.y0 + ((r + 0.5) / SAMPLE_ROWS) * h;
    for (let c = 0; c < SAMPLE_COLS; c++) {
      const x = box.x0 + ((c + 0.5) / SAMPLE_COLS) * w;
      if (pointCovered(x, y, key, scratch, m)) hit++;
    }
  }
  out.frac = hit / (SAMPLE_COLS * SAMPLE_ROWS);
  out.head = pointCovered((box.x0 + box.x1) / 2, box.y0 + Math.min(3, h * 0.2), key, scratch, m);
  return out;
}

/** Plates are hidden when the head is covered or more than 60% of the body is. */
export function isHidden(c: Coverage): boolean {
  return c.head || c.frac > 0.6;
}

/** Alpha of a plate whose occlusion level (smoothed 0..1) is `occ`; `floor` is the faintest allowed (targets, combat). */
export function plateAlpha(occ: number, floor = 0.12): number {
  return 1 - occ * (1 - floor);
}

/** Move a smoothed occlusion level toward its target (about 140 ms for a full fade, so it does not flicker). */
export function stepOcc(cur: number, hidden: boolean, dtMs: number): number {
  const step = Math.max(0, dtMs) / 140;
  return hidden ? Math.min(1, cur + step) : Math.max(0, cur - step);
}

// ---------------------------------------------------------------------------------------------------------------------
// See-through silhouettes: an entity covered by taller scenery is outlined on top of it
// ---------------------------------------------------------------------------------------------------------------------

/** A silhouette is drawn as soon as any real part of the body (a tenth, or the head) is covered. */
export function isVeiled(c: Coverage): boolean {
  return c.head || c.frac >= 0.1;
}

/** At most this many silhouettes are drawn per frame (the most important, then the nearest). */
export const MAX_GHOSTS = 24;

export interface GhostCand {
  priority: number;
  /** Distance to the player's character (tiles); ties on priority go to the nearer one. */
  dist: number;
}

/** Lower is more important: yourself, the selected target, other players, then fighters and notables, then the crowd. */
export function ghostPriority(o: { self: boolean; selected: boolean; kind: string; role?: string; fighting?: boolean }): number {
  if (o.self) return 0;
  if (o.selected) return 1;
  if (o.kind === 'player') return 2;
  if (o.kind === 'monster') return o.fighting ? 3 : 4;
  if (o.role === 'legend' || o.role === 'master') return 4;
  return 5;
}

/** Keep the `cap` most important candidates (stable: input order breaks full ties). */
export function pickGhosts<T extends GhostCand>(cands: T[], cap: number = MAX_GHOSTS): T[] {
  if (cands.length <= cap) return cands;
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority || a.c.dist - b.c.dist || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.c);
}

/** Tint of a silhouette (CSS colour): readable on roofs, walls and foliage alike, and telling friend from foe. */
export function ghostTint(o: { self: boolean; kind: string; role?: string; hostile?: boolean }): string {
  if (o.self) return '#9fe6ff';
  if (o.kind === 'monster') return '#ff8a7a';
  if (o.kind === 'player') return '#b8f0c8';
  if (o.role === 'legend') return '#ff9ad2';
  if (o.role === 'master') return '#ffd98a';
  if (o.role === 'guard') return '#a8c4ff';
  return '#f2e6c0';
}
