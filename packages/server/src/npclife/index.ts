/**
 * NPC life: public, read-only API for other systems (gossip / memory, tests) plus the `npcChat` event.
 *
 *   const life = getNpcLife(ctx);
 *   life.activityOf(npcId)           -> what the NPC is doing / where
 *   life.placesOf(npcId)             -> its home and workplace
 *   life.npcsAt('inn', settlementId) -> NPCs currently at an inn of that settlement
 *   life.nearbyNpcs(npcId)           -> NPCs within a few tiles (visible ones only)
 *   ctx.events.on('npcChat', ...)    -> two NPCs started a conversation
 */
import { NPC_DATA, type GameContext } from '../ctx';
import type { ActivityId, Needs } from './activities';
import { NpcLife, type Phase } from './life';
import type { Place, PlaceKind } from './places';
import { NPCLIFE_TUNING } from './tuning';

export { NPCLIFE_TUNING } from './tuning';
export { ACTIVITIES, SCHEDULE, type ActivityId, type Needs } from './activities';
export type { Place, PlaceKind } from './places';
export type { Phase } from './life';

declare module '../ctx' {
  interface GameEvents {
    /** Two NPCs stood face to face and started talking (once per conversation). */
    npcChat: { a: number; b: number; settlementId: number };
  }
}

export interface PlaceView {
  id: string;
  kind: PlaceKind;
  settlementId: number;
  buildingId: number | null;
  /** Door / centre tile. */
  x: number;
  y: number;
}

export interface ActivityView {
  /** What the NPC is doing (or heading to do). null before its first decision. */
  activity: ActivityId | null;
  /** Where in its routine it is: walking there, doing it, waiting to leave. */
  phase: Phase;
  /** The `NpcAct` cue currently shown to clients (undefined while walking or hidden). */
  cue: string | undefined;
  /** True while the NPC is indoors (entity hidden). */
  indoors: boolean;
  place: PlaceView | null;
  /** The NPC it is talking to, if any. */
  chatWith: number | null;
  /** Real ms epoch when the current activity ends. */
  until: number;
}

export interface NpcPlacesView {
  home: PlaceView | null;
  work: PlaceView | null;
}

export interface NpcLifeApi {
  activityOf(npcId: number): ActivityView | undefined;
  placesOf(npcId: number): NpcPlacesView | undefined;
  /** NPCs that are at a place of this kind in the settlement right now (arrived, doing something there; includes those indoors). */
  npcsAt(placeKind: PlaceKind, settlementId: number): number[];
  /** NPC ids within `radius` tiles (default 6) of the NPC, excluding itself and anyone indoors. */
  nearbyNpcs(npcId: number, radius?: number): number[];
  needsOf(npcId: number): Readonly<Needs> | undefined;
  /** Cost counters (visits / decisions per tick, snaps, pairs). */
  stats(): Readonly<NpcLife['stats']>;
  /** Siege battles: take an NPC off its routine (guards and militia are cloned into the fight) / give it back. */
  seize(npcId: number): boolean;
  release(npcId: number, at?: { x: number; y: number }): void;
  /** Siege battles: the settlement's people celebrate for `ms` real ms. */
  celebrate(settlementId: number, ms: number): void;
  /** Siege battles: after a defeat the survivors gather on the plaza to mourn. */
  grieve(settlementId: number): void;
}

const controllers = new WeakMap<GameContext, NpcLife>();

/** The controller (internal; tests and the system module use it). Created on first use. */
export function npcLifeController(ctx: GameContext): NpcLife {
  let life = controllers.get(ctx);
  if (!life) {
    life = new NpcLife(ctx);
    controllers.set(ctx, life);
  }
  return life;
}

function view(p: Place | null): PlaceView | null {
  return p ? { id: p.id, kind: p.kind, settlementId: p.settlementId, buildingId: p.buildingId, x: p.door.x, y: p.door.y } : null;
}

const apis = new WeakMap<GameContext, NpcLifeApi>();

/** Read-only view of the NPC life system for other modules. Safe to call before the system registered. */
export function getNpcLife(ctx: GameContext): NpcLifeApi {
  let api = apis.get(ctx);
  if (api) return api;
  const life = npcLifeController(ctx);
  api = {
    activityOf(npcId) {
      const st = life.states.get(npcId);
      if (!st) return undefined;
      const e = ctx.npcEntity(npcId);
      return { activity: st.act, phase: st.ph, cue: e?.act, indoors: !!e?.hidden && st.inside, place: view(st.place), chatWith: st.chatWith, until: st.until };
    },
    placesOf(npcId) {
      const st = life.states.get(npcId);
      return st ? { home: view(st.home), work: view(st.work) } : undefined;
    },
    npcsAt(kind, settlementId) {
      const out: number[] = [];
      for (const st of life.states.values()) if (st.sid === settlementId && st.ph === 'doing' && st.place?.kind === kind) out.push(st.npcId);
      return out.sort((a, b) => a - b);
    },
    nearbyNpcs(npcId, radius = NPCLIFE_TUNING.nearbyRadius) {
      const e = ctx.npcEntity(npcId);
      if (!e) return [];
      const out: number[] = [];
      for (const o of ctx.entities.near(e.x, e.y, radius, (x) => x.kind === 'npc' && x !== e && !x.hidden)) {
        const id = NPC_DATA.get(o)?.npcId;
        if (id !== undefined) out.push(id);
      }
      return out.sort((a, b) => a - b);
    },
    needsOf(npcId) {
      return life.states.get(npcId)?.needs;
    },
    stats() {
      return life.stats;
    },
    seize: (npcId) => life.seize(npcId),
    release: (npcId, at) => life.release(npcId, at),
    celebrate: (sid, ms) => life.celebrate(sid, ms),
    grieve: (sid) => life.grieve(sid),
  };
  apis.set(ctx, api);
  return api;
}
