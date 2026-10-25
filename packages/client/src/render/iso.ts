/**
 * Isometric projection math. Pure (unit tested).
 *
 * Coordinate spaces:
 *  - tile: continuous (x, y); tile centres sit on integers.
 *  - world px: sx = (x - y) * 32, sy = (x + y) * 16 (zoom 1).
 *  - art px: world px / ART. All procedural art is drawn at art resolution and scaled up crisply.
 *  - device px: what the canvas backing store uses (css px * devicePixelRatio).
 */
import { TILE_H, TILE_W } from '@murim/shared';

/** World pixels per art pixel. */
export const ART = 2;
export const HW = TILE_W / 2; // 32
export const HH = TILE_H / 2; // 16
/** Half tile size in art px. */
export const AHW = HW / ART; // 16
export const AHH = HH / ART; // 8

export function tileToWorld(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * HW, sy: (x + y) * HH };
}

export function worldToTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HW;
  const b = sy / HH;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Integer tile containing a world-pixel point (diamond test via rounding in tile space). */
export function worldToTileIndex(sx: number, sy: number): { x: number; y: number } {
  const t = worldToTile(sx, sy);
  return { x: Math.round(t.x), y: Math.round(t.y) };
}

export function tileToArt(x: number, y: number): { ax: number; ay: number } {
  return { ax: (x - y) * AHW, ay: (x + y) * AHH };
}

/**
 * Per-frame view transform with the camera snapped to whole art pixels so the low-resolution scene
 * buffer stays on a stable pixel grid.
 */
export interface FrameXf {
  /** Device px per art px. */
  P: number;
  /** Camera centre in art px (integers). */
  camAX: number;
  camAY: number;
  /** Device px of the left/top edge of art pixel (camAX, camAY): always a multiple of P. */
  ox: number;
  oy: number;
  dpr: number;
  /** Scene buffer size in art px (covers the whole device canvas) and where the camera pixel sits in it. */
  bw: number;
  bh: number;
  cx: number;
  cy: number;
}

export function makeFrameXf(camWorldX: number, camWorldY: number, zoom: number, dpr: number, devW: number, devH: number): FrameXf {
  const P = ART * zoom * dpr;
  const cx = Math.floor(devW / 2 / P);
  const cy = Math.floor(devH / 2 / P);
  return {
    P,
    camAX: Math.round(camWorldX / ART),
    camAY: Math.round(camWorldY / ART),
    ox: cx * P,
    oy: cy * P,
    dpr,
    bw: Math.ceil(devW / P) + 1,
    bh: Math.ceil(devH / P) + 1,
    cx,
    cy,
  };
}

export function artToDevice(xf: FrameXf, ax: number, ay: number): { dx: number; dy: number } {
  return { dx: (ax - xf.camAX) * xf.P + xf.ox, dy: (ay - xf.camAY) * xf.P + xf.oy };
}

export function deviceToArt(xf: FrameXf, dx: number, dy: number): { ax: number; ay: number } {
  return { ax: (dx - xf.ox) / xf.P + xf.camAX, ay: (dy - xf.oy) / xf.P + xf.camAY };
}

/** CSS pixel (relative to the canvas) to continuous tile coordinates. */
export function cssToTile(xf: FrameXf, cx: number, cy: number): { x: number; y: number } {
  const { ax, ay } = deviceToArt(xf, cx * xf.dpr, cy * xf.dpr);
  return worldToTile(ax * ART, ay * ART);
}

/** Continuous tile coordinates to CSS pixels. */
export function tileToCss(xf: FrameXf, x: number, y: number): { cx: number; cy: number } {
  const { ax, ay } = tileToArt(x, y);
  const { dx, dy } = artToDevice(xf, ax, ay);
  return { cx: dx / xf.dpr, cy: dy / xf.dpr };
}

/** Zoom snapped so that one art pixel covers a whole number of device pixels (crisp scaling). */
export function snapZoom(z: number, dpr: number, min = 0.5, max = 2.5): number {
  const k = ART * dpr;
  let s = Math.round(z * k) / k;
  if (s < min - 1e-6) s = Math.ceil(min * k) / k;
  if (s > max + 1e-6) s = Math.floor(max * k) / k;
  if (s < min - 1e-6 || s > max + 1e-6) s = Math.min(max, Math.max(min, z));
  return s;
}

export function clampZoom(z: number): number {
  return Math.min(2.5, Math.max(0.5, z));
}
