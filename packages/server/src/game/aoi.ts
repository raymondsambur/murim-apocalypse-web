/**
 * Interest management. Each tick:
 *  1. `collect` diffs every touched entity against the view last broadcast for it (once per
 *     entity, shared by all clients). Every `fullDiffEvery` ticks all known entities are diffed
 *     as a safety net for code that changed a field but forgot `touch`.
 *  2. `sync` walks each viewer's surroundings and emits one `ents` message with
 *     `add` (full view, also used to replace an entity when an optional field was cleared),
 *     `upd` (only changed fields) and `del`.
 *
 * Patch conventions for clients:
 *  - A moving entity's patch carries x, y, nx, ny, step (remaining ms), face and state.
 *  - When it stops, the patch carries x, y, nx = x, ny = y and step = 0.
 *  - An `add` for an id the client already knows replaces that entity entirely.
 */
import { AOI_RADIUS, sameGearLook, type EntityPatch, type EntityView, type GearLook, type Look, type S2C } from '@murim/shared';
import type { Entity } from '../ctx';
import { EXTRA_KEYS, viewOf, type EntityImpl, type EntityStoreImpl } from './entities';

export interface AoiViewer {
  /** Entity the view is centred on (always visible to itself). */
  readonly entity: Entity;
  /** Entity ids this client currently knows. Owned by the viewer; cleared on disconnect. */
  readonly known: Set<number>;
  send(msg: S2C): void;
}

type Diff = EntityPatch | 'replace' | null;

const COMPARED = ['name', 'face', 'state', ...EXTRA_KEYS] as const;

function sameLook(a: Look, b: Look): boolean {
  return (
    a.gender === b.gender &&
    a.skin === b.skin &&
    a.hairStyle === b.hairStyle &&
    a.hairColor === b.hairColor &&
    a.outfit === b.outfit &&
    a.outfitColor === b.outfitColor &&
    a.sashColor === b.sashColor &&
    a.accessory === b.accessory
  );
}

/**
 * Patch from `prev` to `next`. `stepChanged` is true when a new step started (or movement
 * stopped/started) so movement fields must be resent even if nx/ny happen to match.
 */
export function diffViews(prev: EntityView, next: EntityView, stepChanged: boolean): Diff {
  const patch: EntityPatch = { id: next.id };
  const out = patch as Record<string, unknown>;
  let n = 0;
  for (const k of COMPARED) {
    const a = prev[k];
    const b = next[k];
    if (a === b) continue;
    if (k === 'look' && a !== undefined && b !== undefined && sameLook(a as Look, b as Look)) continue;
    if (k === 'gear' && sameGearLook(a as GearLook | undefined, b as GearLook | undefined)) continue;
    if (b === undefined) return 'replace';
    out[k] = b;
    n++;
  }
  const moved = prev.x !== next.x || prev.y !== next.y;
  if (stepChanged || moved || prev.nx !== next.nx || prev.ny !== next.ny) {
    patch.x = next.x;
    patch.y = next.y;
    patch.face = next.face;
    patch.state = next.state;
    if (next.nx !== undefined && next.ny !== undefined) {
      patch.nx = next.nx;
      patch.ny = next.ny;
      patch.step = next.step;
    } else {
      patch.nx = next.x;
      patch.ny = next.y;
      patch.step = 0;
    }
    n++;
  }
  return n > 0 ? patch : null;
}

interface Sent {
  view: EntityView;
  seq: number;
}

export class Aoi {
  private readonly sent = new Map<number, Sent>();
  private tickNo = 0;
  private patches = new Map<number, EntityPatch>();
  private replaced = new Set<number>();

  constructor(
    private readonly entities: EntityStoreImpl,
    readonly radius = AOI_RADIUS,
    /** Extra tiles before a known entity is dropped (prevents add/del flicker at the edge). */
    readonly hysteresis = 3,
    readonly fullDiffEvery = 10,
  ) {
    entities.onRemove((e) => this.sent.delete(e.id));
  }

  /** Step 1: compute this tick's patches. */
  collect(now: number): void {
    this.tickNo++;
    this.patches = new Map();
    this.replaced = new Set();
    const full = this.tickNo % this.fullDiffEvery === 0;
    const changed = this.entities.changed;
    if (full) for (const e of this.entities.allImpl()) if (this.sent.has(e.id)) changed.add(e);
    for (const e of changed) this.diffOne(e, now);
    changed.clear();
  }

  private diffOne(e: EntityImpl, now: number): void {
    const view = viewOf(e, now);
    const seq = e.move ? e.move.seq : -1;
    const prev = this.sent.get(e.id);
    this.sent.set(e.id, { view, seq });
    if (!prev) return;
    const d = diffViews(prev.view, view, prev.seq !== seq);
    if (d === 'replace') this.replaced.add(e.id);
    else if (d) this.patches.set(e.id, d);
  }

  /** Step 2: build and send one `ents` message per viewer. */
  syncViewer(v: AoiViewer, now: number): void {
    const self = v.entity;
    const r2 = this.radius * this.radius;
    const add: EntityView[] = [];
    const upd: EntityPatch[] = [];
    const del: number[] = [];
    const inRange = new Set<number>();
    const visit = (e: EntityImpl, d2: number) => {
      if (e.hidden && e.id !== self.id) return;
      if (!v.known.has(e.id)) {
        if (d2 > r2 && e.id !== self.id) return;
        v.known.add(e.id);
        inRange.add(e.id);
        add.push(viewOf(e, now));
        return;
      }
      inRange.add(e.id);
      if (this.replaced.has(e.id)) add.push(viewOf(e, now));
      else {
        const p = this.patches.get(e.id);
        if (p) upd.push(p);
      }
    };
    this.entities.forEachNear(self.x, self.y, this.radius + this.hysteresis, visit);
    // Players always see themselves, even if hidden or somehow out of the scan.
    if (!inRange.has(self.id)) {
      const me = this.entities.getImpl(self.id);
      if (me) visit(me, 0);
    }
    for (const id of v.known) {
      if (!inRange.has(id)) {
        v.known.delete(id);
        del.push(id);
      }
    }
    if (add.length || upd.length || del.length) {
      const msg: Extract<S2C, { t: 'ents' }> = { t: 'ents' };
      if (add.length) msg.add = add;
      if (upd.length) msg.upd = upd;
      if (del.length) msg.del = del;
      v.send(msg);
    }
  }

  sync(viewers: Iterable<AoiViewer>, now: number): void {
    this.collect(now);
    for (const v of viewers) this.syncViewer(v, now);
  }
}
