/**
 * Chunk cache for the static ground. Each chunk is a 16x16-tile canvas (plus animated water frames and a vein
 * glow layer), painted by art/terrain.ts and redrawn only when the season or the Blight under it changes.
 */
import { CHUNK, CHUNK_PX_H, CHUNK_PX_W, WATER_FRAMES, chunkOrigin, paintChunk, type TerrainSource } from '../art/terrain';
import { pbToCanvas } from '../art/canvas';
import type { WorldModel } from './world';

export interface ChunkEntry {
  cx: number;
  cy: number;
  /** Ground frames: one canvas for dry chunks, WATER_FRAMES pre-composited canvases (ground + animated water) otherwise. */
  frames: (HTMLCanvasElement | ImageBitmap)[];
  veins: HTMLCanvasElement | null;
  maxBlight: number;
  season: number;
  /** Set when the chunk needs a repaint. */
  dirty: boolean;
  lastUsed: number;
}

const keyOf = (cx: number, cy: number): number => (cx + 64) * 256 + (cy + 64);

/** Smallest cache, and the most chunks ever kept (a chunk is 0.5-2 MB of pixels). */
const MIN_ENTRIES = 44;
const MAX_ENTRIES = 140;
/** Art px of ground beyond the screen edge that is built ahead of scrolling. */
const PREFETCH_MARGIN = 300;

export class ChunkManager {
  private cache = new Map<number, ChunkEntry>();
  private src: TerrainSource;
  readonly cw: number;
  readonly ch: number;
  season = 1;
  /** Number of chunk repaints, for diagnostics. */
  built = 0;
  /** Cache size; grows each frame to hold everything on screen plus the prefetch ring (see `draw`). */
  maxEntries = MIN_ENTRIES;
  private frame = 0;

  constructor(private world: WorldModel) {
    this.src = { w: world.w, h: world.h, terrain: world.terrain, blight: world.blight };
    this.cw = Math.ceil(world.w / CHUNK);
    this.ch = Math.ceil(world.h / CHUNK);
  }

  setSeason(season: number): void {
    if (season === this.season) return;
    this.season = season;
  }

  invalidateAll(): void {
    for (const e of this.cache.values()) e.dirty = true;
  }

  /** Mark chunks touched by a tile (and its neighbours across chunk borders). */
  invalidateTile(x: number, y: number): void {
    const cx0 = Math.floor((x - 2) / CHUNK);
    const cx1 = Math.floor((x + 2) / CHUNK);
    const cy0 = Math.floor((y - 2) / CHUNK);
    const cy1 = Math.floor((y + 2) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const e = this.cache.get(keyOf(cx, cy));
        if (e) e.dirty = true;
      }
  }

  beginFrame(): void {
    this.frame++;
  }

  private build(cx: number, cy: number): ChunkEntry {
    const r = paintChunk(this.src, cx, cy, this.season);
    this.built++;
    const entry: ChunkEntry = {
      cx,
      cy,
      frames: r.water ? r.water.map((w) => { const o = r.base.clone(); o.blit(w, 0, 0); return pbToCanvas(o); }) : [pbToCanvas(r.base)],
      veins: r.veins ? pbToCanvas(r.veins) : null,
      maxBlight: r.maxBlight,
      season: this.season,
      dirty: false,
      lastUsed: this.frame,
    };
    // Swap canvases for GPU-friendly bitmaps once they are ready (much cheaper to draw).
    if (typeof createImageBitmap === 'function')
      entry.frames.forEach((cv, i) => {
        createImageBitmap(cv as HTMLCanvasElement).then(
          (bm) => {
            if (this.cache.get(keyOf(cx, cy)) === entry) entry.frames[i] = bm;
            else bm.close();
          },
          () => undefined,
        );
      });
    this.cache.set(keyOf(cx, cy), entry);
    return entry;
  }

  /** True if a chunk is absent or stale. */
  needsBuild(cx: number, cy: number): boolean {
    const e = this.cache.get(keyOf(cx, cy));
    return !e || e.dirty || e.season !== this.season;
  }

  /** Fetch a chunk, building or rebuilding it when `allowBuild`. Returns the (possibly stale) entry. */
  get(cx: number, cy: number, allowBuild: boolean): ChunkEntry | undefined {
    const k = keyOf(cx, cy);
    let e = this.cache.get(k);
    if (e) {
      e.lastUsed = this.frame;
      if ((e.dirty || e.season !== this.season) && allowBuild) e = this.build(cx, cy);
      return e;
    }
    if (!allowBuild) return undefined;
    e = this.build(cx, cy);
    this.evict();
    return e;
  }

  /** Drop the least recently used chunks, never one that was used this frame or last (on screen or prefetched). */
  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      let oldKey = -1;
      let oldUsed = this.frame - 1;
      for (const [k, e] of this.cache)
        if (e.lastUsed < oldUsed) {
          oldUsed = e.lastUsed;
          oldKey = k;
        }
      if (oldKey < 0) return;
      const e = this.cache.get(oldKey)!;
      this.cache.delete(oldKey);
      for (const f of e.frames) if (typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap) f.close();
    }
  }

  clear(): void {
    this.cache.clear();
  }

  /** Visible chunk list for an art-space rectangle, nearest to (centerCx, centerCy) first. */
  visible(ax0: number, ay0: number, ax1: number, ay1: number, centerCx: number, centerCy: number): { cx: number; cy: number; ox: number; oy: number; d: number }[] {
    let minCx = 1e9;
    let maxCx = -1e9;
    let minCy = 1e9;
    let maxCy = -1e9;
    const xs = [ax0, ax1, ax0, ax1];
    const ys = [ay0, ay0, ay1, ay1];
    for (let i = 0; i < 4; i++) {
      const a = xs[i] / 16;
      const b = ys[i] / 8;
      const cx = Math.floor((a + b) / 2 / CHUNK);
      const cy = Math.floor((b - a) / 2 / CHUNK);
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;
    }
    minCx = Math.max(-1, minCx - 1);
    minCy = Math.max(-1, minCy - 1);
    maxCx = Math.min(this.cw, maxCx + 1);
    maxCy = Math.min(this.ch, maxCy + 1);
    const list: { cx: number; cy: number; ox: number; oy: number; d: number }[] = [];
    for (let cy = minCy; cy <= maxCy; cy++)
      for (let cx = minCx; cx <= maxCx; cx++) {
        const { ox, oy } = chunkOrigin(cx, cy);
        if (ox > ax1 || ox + CHUNK_PX_W < ax0 || oy > ay1 || oy + CHUNK_PX_H < ay0) continue;
        list.push({ cx, cy, ox, oy, d: Math.abs(cx - centerCx) + Math.abs(cy - centerCy) });
      }
    list.sort((a, b) => a.d - b.d);
    return list;
  }

  /**
   * Draw all chunks intersecting the visible art rectangle (ax0..ax1, ay0..ay1), where art (ax0, ay0) lands on
   * scene pixel (0, 0).  caps repaint time this frame (missing chunks first, stale ones with what is left).
   */
  draw(ctx: CanvasRenderingContext2D, ax0: number, ay0: number, ax1: number, ay1: number, waterFrame: number, veinPulse: number, buildMs: number, centerCx: number, centerCy: number): void {
    const list = this.visible(ax0, ay0, ax1, ay1, centerCx, centerCy);
    // Zoomed out, the screen plus the prefetch ring needs far more chunks than a fixed cache holds; a too-small
    // cache would evict and repaint chunks every frame.
    const ring = this.visible(ax0 - PREFETCH_MARGIN, ay0 - PREFETCH_MARGIN, ax1 + PREFETCH_MARGIN, ay1 + PREFETCH_MARGIN, centerCx, centerCy);
    this.maxEntries = Math.min(MAX_ENTRIES, Math.max(MIN_ENTRIES, ring.length + 10));
    const builtBefore = this.built;
    const t0 = performance.now();
    for (const c of list) {
      let e = this.cache.get(keyOf(c.cx, c.cy));
      if (e) e.lastUsed = this.frame;
      else if (performance.now() - t0 < buildMs) e = this.get(c.cx, c.cy, true);
      else continue;
      if (!e) continue;
      if ((e.dirty || e.season !== this.season) && performance.now() - t0 < buildMs * 0.7) e = this.get(c.cx, c.cy, true) ?? e;
      const dx = c.ox - ax0;
      const dy = c.oy - ay0;
      ctx.drawImage(e.frames[waterFrame % e.frames.length], dx, dy);
      if (e.veins && veinPulse > 0.02) {
        ctx.globalAlpha = veinPulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(e.veins, dx, dy);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
    // Keep the ring warm, and prefetch one missing ring chunk so scrolling rarely meets an unbuilt chunk. Only on a
    // frame that needed no repaint otherwise, and every other frame, so a prefetch never stacks on a repaint.
    let missing: { cx: number; cy: number } | null = null;
    for (const c of ring) {
      const e = this.cache.get(keyOf(c.cx, c.cy));
      if (e) e.lastUsed = this.frame;
      else if (!missing) missing = c;
    }
    if (missing && this.built === builtBefore && (this.frame & 1) === 0 && performance.now() - t0 < buildMs * 0.4) this.get(missing.cx, missing.cy, true);
  }
}
