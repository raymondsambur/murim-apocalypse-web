/**
 * Renderer-side model of the static world plus the dynamic layers (Blight, settlements).
 * Pure data and lookups (unit tested); the renderer reads from it every frame.
 */
import { O, T, type BuildingDef, type SettlementDef, type SettlementView } from '@murim/shared';
import type { DecodedWorld } from './api';

/** Wall connection bits (tile-axis neighbours): NE = y-1, SE = x+1, SW = y+1, NW = x-1. */
export const W_NE = 1;
export const W_SE = 2;
export const W_SW = 4;
export const W_NW = 8;

export interface BuildingInfo {
  def: BuildingDef;
  /** Depth key used for painter sorting (front-most tile + bias). */
  depth: number;
  /** Settlement id or -1. */
  sid: number;
}

export class WorldModel {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  readonly objects: Uint8Array;
  readonly blight: Uint8Array;
  readonly buildings: BuildingInfo[] = [];
  /** Building id + 1 per footprint tile, 0 where none. */
  readonly footprint: Int16Array;
  readonly settlements: SettlementDef[];
  readonly settlementById = new Map<number, SettlementDef>();
  /** Latest dynamic state per settlement id. */
  readonly status = new Map<number, SettlementView>();
  /** Distance to the nearest non-rock tile for Rock tiles (0 elsewhere), capped. */
  readonly rockDist: Uint8Array;
  readonly seed: number;
  /** Hearts / strongest blight (for minimap). */
  readonly payload: DecodedWorld['payload'];

  constructor(world: DecodedWorld) {
    this.payload = world.payload;
    this.w = world.payload.w;
    this.h = world.payload.h;
    this.seed = world.payload.seed;
    this.terrain = world.terrain;
    this.objects = world.objects;
    this.blight = new Uint8Array(this.w * this.h);
    this.footprint = new Int16Array(this.w * this.h);
    this.settlements = world.payload.settlements;
    for (const s of this.settlements) this.settlementById.set(s.id, s);
    for (const b of world.payload.buildings) {
      this.buildings.push({ def: b, depth: b.x + b.w - 1 + (b.y + b.d - 1) + 0.9, sid: b.settlementId });
      for (let yy = b.y; yy < b.y + b.d; yy++)
        for (let xx = b.x; xx < b.x + b.w; xx++) if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.footprint[yy * this.w + xx] = b.id + 1;
    }
    this.buildings.sort((a, b) => a.depth - b.depth);
    this.rockDist = computeRockDist(this.terrain, this.w, this.h);
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  terrainAt(x: number, y: number): number {
    return this.inb(x, y) ? this.terrain[y * this.w + x] : T.DeepWater;
  }

  objectAt(x: number, y: number): number {
    return this.inb(x, y) ? this.objects[y * this.w + x] : 0;
  }

  blightAt(x: number, y: number): number {
    return this.inb(x, y) ? this.blight[y * this.w + x] : 0;
  }

  /** Wall neighbours mask for the wall tile at (x, y). Towers/gates (building tiles) also connect. */
  wallMask(x: number, y: number): number {
    let m = 0;
    if (this.connects(x, y - 1)) m |= W_NE;
    if (this.connects(x + 1, y)) m |= W_SE;
    if (this.connects(x, y + 1)) m |= W_SW;
    if (this.connects(x - 1, y)) m |= W_NW;
    return m;
  }

  /** Neighbour mask for a palisade or fence tile: it connects to its own kind (a wall opening or building ends the run). */
  linkMask(x: number, y: number, code: number): number {
    let m = 0;
    if (this.objectAt(x, y - 1) === code) m |= W_NE;
    if (this.objectAt(x + 1, y) === code) m |= W_SE;
    if (this.objectAt(x, y + 1) === code) m |= W_SW;
    if (this.objectAt(x - 1, y) === code) m |= W_NW;
    return m;
  }

  private connects(x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const o = this.objects[y * this.w + x];
    return o === O.Wall || (o === O.Building && this.isWallBuilding(x, y));
  }

  private isWallBuilding(x: number, y: number): boolean {
    const id = this.footprint[y * this.w + x] - 1;
    if (id < 0) return false;
    const b = this.buildings.find((bi) => bi.def.id === id);
    return !!b && (b.def.kind === 'tower' || b.def.kind === 'gate');
  }

  /** Blight values for the settlement area (0..255), from the sim view when present. */
  settlementStatus(id: number): SettlementView | undefined {
    return this.status.get(id);
  }

  /** Climate band (0 north, 1 central, 2 south) of a tile row; mirrors worldgen. */
  climateAt(y: number): number {
    return y < this.h * 0.3 ? 0 : y > this.h * 0.68 ? 2 : 1;
  }
}

/** Manhattan-ish distance (8-connected chamfer) from every Rock tile to the nearest non-rock tile, capped at 15. */
export function computeRockDist(terrain: Uint8Array, w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h);
  const INF = 255;
  for (let i = 0; i < w * h; i++) d[i] = terrain[i] === T.Rock ? INF : 0;
  // two-pass chamfer (cost 1 for all 8 neighbours = Chebyshev distance)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      for (let oy = -1; oy <= 0; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox >= 0) break;
          const nx = x + ox;
          const ny = y + oy;
          const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : d[ny * w + nx];
          if (v + 1 < m) m = v + 1;
        }
      d[i] = m;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      for (let oy = 0; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox <= 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : d[ny * w + nx];
          if (v + 1 < m) m = v + 1;
        }
      d[i] = m > 15 ? 15 : m;
    }
  return d;
}
