import { describe, expect, it } from 'vitest';
import { LOOK_RANGES, O, T, TILE_H, TILE_W } from '@murim/shared';
import { Camera } from './camera';
import { WorldClock } from './clock';
import { GestureTracker, LONG_PRESS_MS, type GestureEvent } from './input';
import { ART, clampZoom, cssToTile, makeFrameXf, snapZoom, tileToCss, tileToWorld, worldToTile } from './iso';
import { applyMove, faceFromDelta, isMoving, makeMotion, motionPos, SNAP_DIST } from './interp';
import { ambientAt } from './lighting';
import { LRU } from './lru';
import { mapRect, mapToTile } from './minimap';
import { computeRockDist, WorldModel, W_NE, W_SE } from './world';
import { lookSwatches } from '../art/palette';

describe('projection', () => {
  it('matches the 64x32 isometric tile', () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
    expect(tileToWorld(3, 1)).toEqual({ sx: 64, sy: 64 });
    expect(tileToWorld(0, 2)).toEqual({ sx: -64, sy: 32 });
  });
  it('round trips tile <-> world', () => {
    for (const [x, y] of [
      [0, 0],
      [12.5, 7.25],
      [191, 127],
      [-3, 40],
    ]) {
      const w = tileToWorld(x, y);
      const t = worldToTile(w.sx, w.sy);
      expect(t.x).toBeCloseTo(x, 9);
      expect(t.y).toBeCloseTo(y, 9);
    }
  });
  it('round trips tile <-> css pixels (picking math) at several zooms and dpr', () => {
    for (const [zoom, dpr] of [
      [1, 1],
      [1.5, 2],
      [0.5, 1],
      [2.5, 3],
    ]) {
      const cam = tileToWorld(50, 40);
      const xf = makeFrameXf(cam.sx, cam.sy, zoom, dpr, Math.round(1200 * dpr), Math.round(700 * dpr));
      const c = tileToCss(xf, 53, 44);
      const t = cssToTile(xf, c.cx, c.cy);
      expect(Math.abs(t.x - 53)).toBeLessThan(0.02);
      expect(Math.abs(t.y - 44)).toBeLessThan(0.02);
    }
  });
  it('keeps the scene buffer aligned to whole art pixels', () => {
    const xf = makeFrameXf(1234.7, 555.2, 2, 1, 1000, 600);
    expect(xf.ox % xf.P).toBe(0);
    expect(xf.oy % xf.P).toBe(0);
    expect(Number.isInteger(xf.camAX)).toBe(true);
    expect(xf.bw * xf.P).toBeGreaterThanOrEqual(1000);
  });
  it('snaps zoom to crisp levels and clamps', () => {
    expect(snapZoom(1.2, 1)).toBeCloseTo(1, 6);
    expect(snapZoom(1.3, 1)).toBeCloseTo(1.5, 6);
    expect(snapZoom(0.1, 1)).toBeGreaterThanOrEqual(0.5);
    expect(snapZoom(9, 2)).toBeLessThanOrEqual(2.5);
    expect(clampZoom(10)).toBe(2.5);
    expect(clampZoom(0)).toBe(0.5);
    expect(ART).toBe(2);
  });
});

describe('LRU', () => {
  it('evicts the least recently used entry', () => {
    const evicted: number[] = [];
    const c = new LRU<number, string>(2, (k) => evicted.push(k));
    c.set(1, 'a');
    c.set(2, 'b');
    c.get(1);
    c.set(3, 'c');
    expect(c.has(2)).toBe(false);
    expect(c.has(1)).toBe(true);
    expect(evicted).toEqual([2]);
    expect(c.size).toBe(2);
    expect(c.getOrCreate(9, () => 'z')).toBe('z');
    expect(c.size).toBe(2);
  });
});

describe('movement interpolation', () => {
  it('glides to the next tile over the step time', () => {
    const m = makeMotion(10, 10, 0);
    applyMove(m, 0, 10, 10, 11, 10, 400);
    const p = { x: 0, y: 0 };
    motionPos(m, 0, p);
    expect(p.x).toBeCloseTo(10, 6);
    expect(isMoving(m, 100)).toBe(true);
    motionPos(m, 1000, p);
    expect(p.x).toBeCloseTo(11, 6);
    expect(isMoving(m, 1000)).toBe(false);
  });
  it('snaps on teleports and chains steps without stalls', () => {
    const m = makeMotion(10, 10, 0);
    applyMove(m, 0, 40, 40, undefined, undefined, undefined);
    const p = { x: 0, y: 0 };
    motionPos(m, 0, p);
    expect(Math.hypot(p.x - 40, p.y - 40)).toBeLessThan(1e-6);
    expect(SNAP_DIST).toBeGreaterThan(1);
    applyMove(m, 0, 40, 40, 41, 40, 400);
    applyMove(m, 200, 41, 40, 42, 40, 400);
    motionPos(m, 200, p);
    expect(p.x).toBeGreaterThan(40.3);
    expect(p.x).toBeLessThan(41.2);
  });
  it('derives facing from a tile delta', () => {
    expect(faceFromDelta(1, 0)).toBe(0);
    expect(faceFromDelta(0, 1)).toBe(1);
    expect(faceFromDelta(-1, 0)).toBe(2);
    expect(faceFromDelta(0, -1)).toBe(3);
    expect(faceFromDelta(0, 0)).toBeNull();
  });
});

describe('camera', () => {
  it('follows smoothly and detaches on pan', () => {
    const cam = new Camera();
    cam.update(16, { x: 100, y: 50 });
    expect(cam.x).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) cam.update(16, { x: 100, y: 50 });
    expect(cam.x).toBeCloseTo(100, 1);
    cam.panBy(30, 0);
    expect(cam.detached).toBe(true);
    const x = cam.x;
    cam.update(16, { x: 0, y: 0 });
    expect(cam.x).toBe(x);
    cam.attach();
    cam.update(16, { x: 0, y: 0 });
    expect(cam.x).toBeLessThan(x);
  });
  it('eases zoom within bounds', () => {
    const cam = new Camera();
    cam.setZoomTarget(9);
    for (let i = 0; i < 100; i++) cam.update(16, null);
    expect(cam.zoom).toBeCloseTo(2.5, 2);
  });
});

describe('gestures', () => {
  const collect = (): { ev: GestureEvent[]; g: GestureTracker } => {
    const ev: GestureEvent[] = [];
    return { ev, g: new GestureTracker((e) => ev.push(e)) };
  };
  it('tap, drag-pan (no tap) and context', () => {
    const { ev, g } = collect();
    g.down(1, 10, 10, 'mouse', 0, 0);
    g.up(1, 10, 10, 50);
    expect(ev[0]).toMatchObject({ k: 'tap', button: 0 });
    ev.length = 0;
    g.down(1, 10, 10, 'mouse', 0, 100);
    g.move(1, 40, 10, 120);
    g.up(1, 40, 10, 140);
    expect(ev.some((e) => e.k === 'pan')).toBe(true);
    expect(ev.some((e) => e.k === 'tap')).toBe(false);
    ev.length = 0;
    g.down(1, 5, 5, 'mouse', 2, 200);
    g.up(1, 5, 5, 220);
    expect(ev[0].k).toBe('context');
  });
  it('long press on touch is a context gesture', () => {
    const { ev, g } = collect();
    g.down(1, 20, 20, 'touch', 0, 0);
    g.tick(LONG_PRESS_MS + 10);
    expect(ev[0].k).toBe('context');
    g.up(1, 20, 20, LONG_PRESS_MS + 20);
    expect(ev.filter((e) => e.k === 'tap').length).toBe(0);
  });
  it('two fingers pinch', () => {
    const { ev, g } = collect();
    g.down(1, 0, 0, 'touch', 0, 0);
    g.down(2, 100, 0, 'touch', 0, 5);
    g.move(2, 200, 0, 20);
    const p = ev.find((e) => e.k === 'pinch');
    expect(p && p.k === 'pinch' && p.scale).toBeGreaterThan(1.5);
  });
});

describe('clock and lighting', () => {
  it('extrapolates the world hour', () => {
    const c = new WorldClock();
    c.set({ hours: 23, day: 0, season: 2, year: 1, hourMs: 1000, t: 0, weather: ['rain', 'clear', 'snow'] }, 0);
    expect(c.hours(500)).toBeCloseTo(23.5, 6);
    expect(c.hours(2000)).toBeCloseTo(1, 6);
    expect(c.season).toBe(2);
    expect(c.weather[0]).toBe('rain');
  });
  it('grades dawn warm, noon neutral, night dark and blue', () => {
    const noon = ambientAt(12);
    expect(noon.r).toBe(255);
    expect(noon.night).toBe(0);
    const night = ambientAt(1);
    expect(night.b).toBeGreaterThan(night.r);
    expect(night.night).toBe(1);
    const dusk = ambientAt(18.5);
    expect(dusk.r).toBeGreaterThan(dusk.b);
    expect(ambientAt(24).r).toBeCloseTo(ambientAt(0).r, 6);
  });
});

describe('palette tables', () => {
  it('swatch lengths mirror LOOK_RANGES', () => {
    expect(lookSwatches.skin.length).toBe(LOOK_RANGES.skin);
    expect(lookSwatches.hair.length).toBe(LOOK_RANGES.hairColor);
    expect(lookSwatches.outfit.length).toBe(LOOK_RANGES.outfitColor);
    expect(lookSwatches.sash.length).toBe(LOOK_RANGES.sashColor);
    for (const list of Object.values(lookSwatches)) for (const c of list) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('minimap mapping', () => {
  it('maps canvas pixels to tiles and back', () => {
    const r = mapRect(240, 160, 192, 128);
    expect(r.scale).toBeCloseTo(1.25, 6);
    const t = mapToTile(r, r.x0 + 100.5 * r.scale, r.y0 + 50.5 * r.scale, 192, 128);
    expect(t).toEqual({ x: 100, y: 50 });
    expect(mapToTile(r, -50, -50, 192, 128)).toEqual({ x: 0, y: 0 });
    expect(mapToTile(r, 999, 999, 192, 128)).toEqual({ x: 191, y: 127 });
  });
});

describe('world model', () => {
  it('computes rock distance and wall connections', () => {
    const w = 10;
    const h = 10;
    const terrain = new Uint8Array(w * h).fill(T.Grass);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) terrain[y * w + x] = T.Rock;
    const d = computeRockDist(terrain, w, h);
    expect(d[2 * w + 2]).toBe(1);
    expect(d[5 * w + 5]).toBeGreaterThanOrEqual(3);
    expect(d[0]).toBe(0);
    const objects = new Uint8Array(w * h);
    objects[5 * w + 5] = O.Wall;
    objects[5 * w + 6] = O.Wall;
    objects[4 * w + 5] = O.Wall;
    const wm = new WorldModel({ payload: { seed: 1, w, h, terrain: '', objects: '', settlements: [], buildings: [], nodes: [], roads: [] }, terrain, objects });
    expect(wm.wallMask(5, 5)).toBe(W_SE | W_NE);
    expect(wm.climateAt(0)).toBe(0);
    expect(wm.climateAt(h - 1)).toBe(2);
  });
});
