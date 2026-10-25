/** Internal types of the simulation (not part of the shared contract). */
import type { BuildingDef, NpcRole, NpcState, Rng, SettlementDef, SimEvent, SimState, SpawnPointDef, WorldData } from '@murim/shared';

/** A queued replacement: a dead NPC's successor, or a missing service role to refill. */
export interface SuccessionTask {
  /** Dead npc id the successor inherits from; -1 for a plain roster refill. */
  npc: number;
  /** World hour at which the replacement arrives. */
  at: number;
  sid: number;
  role: NpcRole;
}

/** Extra persisted state the shared `SimState` has no slot for. Plain JSON only. */
export interface SimExt {
  /** Hour until which a settlement cannot be besieged again. */
  siegeCooldown: Record<string, number>;
  /** Matching kills credited against the current siege. */
  siegeKills: Record<string, number>;
  /** Hour the settlement fell (fallen settlements only). */
  fallenAt: Record<string, number>;
  /** Consecutive days of low Blight while fallen. */
  lowDays: Record<string, number>;
  /** `${settlementId}:${flag}` -> hour the flag expires (timed flags like plague, festival). */
  flagUntil: Record<string, number>;
  /** Faction id -> hour of its next major action. */
  nextAct: Record<string, number>;
  /** 'a|b' -> hour a war started / a truce ends. */
  warSince: Record<string, number>;
  truceUntil: Record<string, number>;
  /** Jade caravans boost trade capacity until this hour. */
  caravanUntil: number;
  /** Per world.roads index: 1 when the road is closed to caravans. */
  roadBlocked: number[];
  /** Heart id -> hour its flare ends. */
  heartFlare: Record<string, number>;
  /** Settlement id -> Blight frontier level last announced (0 clear, 1 outskirts, 2 walls). */
  frontier: Record<string, number>;
  /** Chronicle pacing. */
  chronKeys: Record<string, number>;
  chronDay: number;
  chronCount: number[];
  /** Per-day cap on the faction effect of bandit kills. */
  killDay: number;
  killCredit: number;
  /** Settlement id -> desired board size. */
  boardSize: Record<string, number>;
  /** Settlement ids whose board must be topped up on the next hour. */
  boardDirty: number[];
  /** Pending replacements for dead masters / shopkeepers and missing services. */
  succession: SuccessionTask[];
  /** Hour of the last settlement fall (feeds the global Blight threat). */
  lastFallHour: number;
  /** Settlement id -> faction that lost it by force, and the hour it was lost (uprising memory). */
  formerOwner: Record<string, string>;
  lostAt: Record<string, number>;
  /** Settlement id -> hour until which annexation / revolt cannot flip it again. */
  lockUntil: Record<string, number>;
  /** Counters for soak summaries. */
  stats: Record<string, number>;
}

export interface SimStateX extends SimState {
  ext: SimExt;
}

/** Index list + weight per cell for stamping a field around a point. */
export interface Stamp {
  idx: Int32Array;
  wt: Float32Array;
}

/** Static data derived from the world once (never serialized). */
export interface StaticData {
  w: number;
  h: number;
  n: number;
  /** 1 where terrain is passable land (Blight can live there). */
  land: Uint8Array;
  landCount: number;
  /** Climate band (0 north, 1 central, 2 south) per row. */
  rowBand: Uint8Array;
  startId: number;
  ruinId: number;
  defs: SettlementDef[];
  /** Weighted discs: suppression (radius + suppressExtra) and average (radius + avgExtra). */
  suppress: Stamp[];
  avg: Stamp[];
  /** Disc used for fallen-settlement growth. */
  fallen: Stamp[];
  /** Road tile indices (outside both endpoint settlements), per world.roads entry. */
  roadTiles: Int32Array[];
  /** Settlement id -> [neighbour id, road index][] */
  adj: [number, number][][];
  /** Danger level per settlement (as for spawn points: 1 + floor(distance to start / 9)). */
  danger: number[];
  buildings: BuildingDef[][];
  /** Spawn points sorted by distance, within 48 tiles of each settlement. */
  spawnsNear: SpawnPointDef[][];
  /** Scratch buffers for the Blight pass. */
  prev: Uint8Array;
  src: Float32Array;
}

export interface Ctx {
  world: WorldData;
  st: SimStateX;
  rng: Rng;
  S: StaticData;
  /** Events produced by the current call. */
  events: SimEvent[];
  hourMs: number;
  /** Wall-clock estimate for the step being simulated (chronicle `t`). */
  wallMs: number;
  /** NPC id -> record (alive and not yet pruned). Rebuilt on restore. */
  npcById: Map<number, NpcState>;
}
