/**
 * In-memory entity store with a uniform-grid spatial hash (8x8-tile cells).
 */
import type { EntityKind, EntityView, Look, Point } from '@murim/shared';
import type { Entity, EntityExtras, EntityInit, EntityStore, MoveState } from '../ctx';

export const CELL_SIZE = 8;

/** Mutable move state owned by movement.ts. */
export interface MoveStateImpl extends MoveState {
  nx: number;
  ny: number;
  stepStart: number;
  stepMs: number;
  path: Point[];
  tx: number;
  ty: number;
  seq: number;
  speed: number;
  stopAfterStep: boolean;
  onArrive?: (e: Entity, result: 'arrived' | 'cancelled' | 'removed') => void;
}

/** Internal, writable view of an entity. Only core modules use this type. */
export type EntityImpl = { -readonly [K in keyof Entity]: Entity[K] } & { move: MoveStateImpl | null; cell: number };

const EXTRA_KEYS = ['look', 'sprite', 'lv', 'hp', 'maxHp', 'tag', 'faction', 'role', 'elite', 'nodeKind', 'combatId', 'online', 'weapon', 'rank'] as const satisfies readonly (keyof EntityExtras)[];

export class EntityStoreImpl implements EntityStore {
  private nextId = 1;
  private readonly byId = new Map<number, EntityImpl>();
  private readonly byKind: Record<EntityKind, Set<EntityImpl>> = { player: new Set(), npc: new Set(), monster: new Set(), node: new Set() };
  private readonly cells: Set<EntityImpl>[];
  private readonly cols: number;
  private readonly rows: number;
  private readonly removeHandlers = new Set<(e: Entity) => void>();
  /** Entities touched since the last AOI collection. */
  readonly changed = new Set<EntityImpl>();

  constructor(
    readonly w: number,
    readonly h: number,
    private readonly now: () => number = Date.now,
  ) {
    this.cols = Math.ceil(w / CELL_SIZE);
    this.rows = Math.ceil(h / CELL_SIZE);
    this.cells = Array.from({ length: this.cols * this.rows }, () => new Set<EntityImpl>());
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL_SIZE)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL_SIZE)));
    return cy * this.cols + cx;
  }

  private clampX(x: number): number {
    return Math.min(this.w - 1, Math.max(0, Math.round(x)));
  }

  private clampY(y: number): number {
    return Math.min(this.h - 1, Math.max(0, Math.round(y)));
  }

  create(init: EntityInit): Entity {
    if (!Number.isFinite(init.x) || !Number.isFinite(init.y)) throw new Error(`entities.create: bad position ${init.x},${init.y}`);
    const x = this.clampX(init.x);
    const y = this.clampY(init.y);
    const e: EntityImpl = {
      id: this.nextId++,
      kind: init.kind,
      name: init.name,
      x,
      y,
      face: init.face ?? 0,
      state: init.state ?? 'idle',
      speed: init.speed ?? 1,
      hidden: init.hidden ?? false,
      move: null,
      ver: 1,
      data: init.data ?? {},
      cell: this.cellOf(x, y),
    };
    for (const k of EXTRA_KEYS) if (init[k] !== undefined) (e as Record<string, unknown>)[k] = init[k];
    this.byId.set(e.id, e);
    this.byKind[e.kind].add(e);
    this.cells[e.cell].add(e);
    this.changed.add(e);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  /** Internal accessor with the writable type. */
  getImpl(id: number): EntityImpl | undefined {
    return this.byId.get(id);
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  remove(target: Entity | number): void {
    const e = this.byId.get(typeof target === 'number' ? target : target.id);
    if (!e) return;
    this.byId.delete(e.id);
    this.byKind[e.kind].delete(e);
    this.cells[e.cell].delete(e);
    this.changed.delete(e);
    for (const h of this.removeHandlers) h(e);
  }

  onRemove(h: (e: Entity) => void): () => void {
    this.removeHandlers.add(h);
    return () => this.removeHandlers.delete(h);
  }

  touch(target: Entity): void {
    const e = this.byId.get(target.id);
    if (!e) return;
    e.ver++;
    this.changed.add(e);
  }

  /** Move within the spatial hash (core only; gameplay goes through ctx.movement). */
  setPos(target: Entity, x: number, y: number): void {
    const e = this.byId.get(target.id);
    if (!e) return;
    const nx = this.clampX(x);
    const ny = this.clampY(y);
    if (nx === e.x && ny === e.y) return;
    e.x = nx;
    e.y = ny;
    const cell = this.cellOf(nx, ny);
    if (cell !== e.cell) {
      this.cells[e.cell].delete(e);
      this.cells[cell].add(e);
      e.cell = cell;
    }
    this.touch(e);
  }

  near(x: number, y: number, r: number, filter?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    this.forEachNear(x, y, r, (e) => {
      if (!filter || filter(e)) out.push(e);
    });
    return out;
  }

  nearest(x: number, y: number, r: number, filter?: (e: Entity) => boolean): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    this.forEachNear(x, y, r, (e, d2) => {
      if (d2 < bestD && (!filter || filter(e))) {
        best = e;
        bestD = d2;
      }
    });
    return best;
  }

  /** Allocation-free spatial scan; `fn` gets the squared distance. */
  forEachNear(x: number, y: number, r: number, fn: (e: EntityImpl, d2: number) => void): void {
    if (!(r >= 0)) return;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor((x - r) / CELL_SIZE));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / CELL_SIZE));
    const y0 = Math.max(0, Math.floor((y - r) / CELL_SIZE));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / CELL_SIZE));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const e of this.cells[cy * this.cols + cx]) {
          const dx = e.x - x;
          const dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(e, d2);
        }
      }
    }
  }

  all(): IterableIterator<Entity> {
    return this.byId.values();
  }

  allImpl(): IterableIterator<EntityImpl> {
    return this.byId.values();
  }

  ofKind(kind: EntityKind): Entity[] {
    return [...this.byKind[kind]];
  }

  count(kind?: EntityKind): number {
    return kind ? this.byKind[kind].size : this.byId.size;
  }

  toView(e: Entity): EntityView {
    return viewOf(e, this.now());
  }
}

function copyLook(l: Look): Look {
  return { gender: l.gender, skin: l.skin, hairStyle: l.hairStyle, hairColor: l.hairColor, outfit: l.outfit, outfitColor: l.outfitColor, sashColor: l.sashColor, accessory: l.accessory };
}

/** Client view of an entity at time `now` (step = remaining ms of the step in progress). */
export function viewOf(e: Entity, now: number): EntityView {
  const v: EntityView = { id: e.id, kind: e.kind, name: e.name, x: e.x, y: e.y, face: e.face, state: e.state };
  const m = e.move;
  if (m) {
    v.nx = m.nx;
    v.ny = m.ny;
    v.step = Math.max(1, Math.round(m.stepStart + m.stepMs - now));
  }
  for (const k of EXTRA_KEYS) {
    const val = e[k];
    if (val === undefined) continue;
    (v as unknown as Record<string, unknown>)[k] = k === 'look' ? copyLook(val as Look) : val;
  }
  return v;
}

export { EXTRA_KEYS };
