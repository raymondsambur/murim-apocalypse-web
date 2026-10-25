/**
 * Entity tracking: merges server views/patches, glides positions between server steps and holds per-entity
 * animation and effect timers. No drawing here (see scene.ts / overlay.ts).
 */
import type { Dir, EntityPatch, EntityView, Look } from '@murim/shared';
import type { CharState, ToolKind } from '../art/anim';
import type { FlashSprite } from './sprites';
import { applyMove, isMoving, makeMotion, motionPos, type Motion } from './interp';

export interface Ent {
  id: number;
  v: EntityView;
  motion: Motion;
  /** Current drawn tile position (continuous). */
  x: number;
  y: number;
  /** Random animation phase offset (ms). */
  t0: number;
  /** Time of the latest attack swing started by this entity / hit landed on it (ms). */
  attackAt: number;
  hitAt: number;
  crit: boolean;
  /** Speech bubble. */
  bubble: string | null;
  bubbleUntil: number;
  bubbleAt: number;
  /** Local facing derived from movement (server face takes priority when standing). */
  face: Dir;
  /** Last frame's draw info (scene px) for overlays and picking. */
  drawn: boolean;
  sx: number;
  sy: number;
  topPx: number;
  halfW: number;
  /** Depth key of the last draw (painter order). */
  depth: number;
  /** Plate cache key and canvas. */
  plateKey: string;
  plate: HTMLCanvasElement | null;
  /** Time the entity was added (for spawn fade-in). */
  born: number;
  deadAt: number;
  /** The entity was already dead when first seen (no collapse animation). */
  bornDead: boolean;
  /** Animation events (ms, performance clock): attacks made so far, dodge / block, emotes. */
  attackIdx: number;
  dodgeAt: number;
  blockAt: number;
  cheerAt: number;
  lootAt: number;
  healAt: number;
  /** Fight stance started / ended (for the draw-weapon and victory poses). */
  fightSince: number;
  fightEnd: number;
  /** Direction of the last blow in screen space (unit-ish) for the knock-back. */
  hitDx: number;
  hitDy: number;
  /** Footfall bookkeeping (dust, splashes, prints). */
  lastFrame: number;
  /** Cached work tool and the time it was chosen. */
  tool: string | null;
  toolAt: number;
  /** Chat partner (nearest neighbour) cache. */
  partner: number;
  partnerAt: number;
  /** Seeded variation for crowds (0..1). */
  seed: number;
  /** Last time a particle effect was spawned by this entity. */
  fxAt: number;
  fx2At: number;
  /** Last sprite drawn (stale fallback while a new frame is generated). */
  lastSpr: FlashSprite | null;
  /** Sandbox: force an animation state. */
  force: { state: CharState; variant: number; tool: ToolKind | null; t0: number } | null;
}

const tmp = { x: 0, y: 0 };

/** Deterministic 0..1 value per entity id (and salt). */
export function seedOf(id: number, salt = 0): number {
  let h = (Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function lookFromId(id: number): Look {
  let h = (id * 2654435761) >>> 0;
  const next = (n: number): number => {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    return h % n;
  };
  return { gender: next(2) as 0 | 1, skin: next(6), hairStyle: next(7), hairColor: next(8), outfit: next(4), outfitColor: next(10), sashColor: next(8), accessory: next(5) };
}

export class EntityStore {
  readonly map = new Map<number, Ent>();

  add(v: EntityView, now: number): Ent {
    const prev = this.map.get(v.id);
    if (prev) {
      this.patch({ ...v } as EntityPatch, now);
      return prev;
    }
    const e: Ent = {
      id: v.id,
      v: { ...v },
      motion: makeMotion(v.x, v.y, now),
      x: v.x,
      y: v.y,
      t0: (v.id * 977) % 1000,
      attackAt: -1e9,
      hitAt: -1e9,
      crit: false,
      bubble: null,
      bubbleUntil: 0,
      bubbleAt: 0,
      face: v.face,
      drawn: false,
      sx: 0,
      sy: 0,
      topPx: 30,
      halfW: 8,
      depth: 0,
      plateKey: '',
      plate: null,
      born: now,
      deadAt: v.state === 'dead' ? now : -1,
      bornDead: v.state === 'dead',
      attackIdx: 0,
      dodgeAt: -1e9,
      blockAt: -1e9,
      cheerAt: -1e9,
      lootAt: -1e9,
      healAt: -1e9,
      fightSince: v.state === 'fight' ? now - 5000 : -1e9,
      fightEnd: -1e9,
      hitDx: 1,
      hitDy: 0.5,
      lastFrame: -1,
      tool: null,
      toolAt: -1e9,
      partner: -1,
      partnerAt: -1e9,
      seed: seedOf(v.id),
      fxAt: 0,
      fx2At: 0,
      force: null,
      lastSpr: null,
    };
    if (v.nx !== undefined && v.ny !== undefined && v.step) applyMove(e.motion, now, v.x, v.y, v.nx, v.ny, v.step);
    this.map.set(v.id, e);
    return e;
  }

  patch(p: EntityPatch, now: number): void {
    const e = this.map.get(p.id);
    if (!e) return;
    const v = e.v;
    const movedKeys = 'x' in p || 'y' in p || 'nx' in p || 'ny' in p || 'step' in p;
    const wasDead = v.state === 'dead';
    const wasFight = v.state === 'fight';
    for (const k of Object.keys(p) as (keyof EntityPatch)[]) {
      if (k === 'id') continue;
      (v as unknown as Record<string, unknown>)[k] = p[k];
    }
    if (('x' in p || 'y' in p) && !('nx' in p)) {
      // A position update without a next tile means the entity stopped.
      v.nx = undefined;
      v.ny = undefined;
      v.step = undefined;
    }
    if (movedKeys) {
      const dxm = (v.nx ?? v.x) - v.x;
      const dym = (v.ny ?? v.y) - v.y;
      applyMove(e.motion, now, v.x, v.y, v.nx, v.ny, v.step);
      if (dxm !== 0 || dym !== 0) {
        const s = dxm - dym;
        const t = dxm + dym;
        e.face = (t >= 0 ? (s >= 0 ? 0 : 1) : s >= 0 ? 3 : 2) as Dir;
      }
    }
    if (p.face !== undefined && !isMoving(e.motion, now)) e.face = p.face;
    if (!wasFight && v.state === 'fight') e.fightSince = now;
    if (wasFight && v.state !== 'fight') e.fightEnd = now;
    if (!wasDead && v.state === 'dead') e.deadAt = now;
    if (wasDead && v.state !== 'dead') {
      e.deadAt = -1;
      e.bornDead = false;
    }
  }

  remove(id: number): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }

  /** Advance drawn positions. */
  update(now: number): void {
    for (const e of this.map.values()) {
      motionPos(e.motion, now, tmp);
      e.x = tmp.x;
      e.y = tmp.y;
    }
  }

  isMoving(e: Ent, now: number): boolean {
    return isMoving(e.motion, now);
  }
}
