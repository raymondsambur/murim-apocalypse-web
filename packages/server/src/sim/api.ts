/**
 * Interface between the game server and the world simulation.
 * The simulation (sim/*.ts) is deterministic given its saved state and calls to advanceHours;
 * it never touches sockets, timers or the database.
 */
import type {
  ChronicleEntry,
  MissionOffer,
  MonsterFamily,
  NpcState,
  SettlementView,
  SimEvent,
  SimState,
  TimeView,
  WeatherKind,
  WorldData,
  WorldInfo,
} from '@murim/shared';

export interface SerializedSim {
  /** JSON of the SimState without the blight array. */
  json: string;
  /** Base64 of the blight Uint8Array. */
  blight: string;
}

export interface ShopListing {
  /** Item ids this NPC sells. */
  items: string[];
  /** Fraction of item value paid when a player sells to this NPC. */
  sellMult: number;
}

export interface SimOptions {
  seed: number;
  /** Real milliseconds per world hour. */
  hourMs: number;
  /** Wall-clock time (ms) at which the clock reading in `saved` (or hour 0) applies. */
  nowMs: number;
  saved?: SerializedSim | null;
}

export interface Sim {
  readonly state: SimState;
  readonly hourMs: number;

  /** Advance the world by `n` whole hours. `nowMs` anchors the fractional clock for timeView. */
  advanceHours(n: number, nowMs: number): SimEvent[];
  timeView(nowMs: number): TimeView;
  /** Current absolute day / hour / season, for game logic. */
  clock(): { totalHours: number; hour: number; day: number; season: number; year: number };

  settlementView(id: number): SettlementView;
  settlementViews(): SettlementView[];
  worldInfo(online: number, nowMs: number): WorldInfo;

  weatherAt(x: number, y: number): WeatherKind;
  blightAt(x: number, y: number): number;
  blightBase64(): string;

  /** Multiplier applied to an item's base value when buying/selling in this settlement (1 = normal). */
  priceMult(settlementId: number, itemId: string): number;

  /** Missions currently posted on a settlement's board. */
  board(settlementId: number): MissionOffer[];
  /** Take an offer off the board when a player accepts it (returns the offer or null). */
  takeOffer(settlementId: number, offerId: string): MissionOffer | null;
  /** Put an offer back (player abandoned it), if it has not expired. */
  returnOffer(offer: MissionOffer): void;

  npcs(settlementId?: number): NpcState[];
  npc(id: number): NpcState | undefined;
  greeting(npc: NpcState, playerName: string): string;
  shopFor(npc: NpcState): ShopListing | null;

  // ---- Reactions to what players do -----------------------------------
  recordKill(x: number, y: number, family: MonsterFamily, level: number, elite: 0 | 1 | 2): SimEvent[];
  recordTrade(settlementId: number, itemId: string, qty: number, dir: 'buy' | 'sell'): void;
  recordMissionDone(offer: MissionOffer, playerName: string): SimEvent[];
  /** Player damages/seals a Blight heart. Returns events (chronicle, heart state). */
  damageHeart(heartId: number, amount: number, playerName: string): SimEvent[];
  /** Cleanse Blight in a radius (shrine purification missions). */
  purify(x: number, y: number, radius: number, amount: number): SimEvent[];
  /** Add a player-driven entry to the chronicle (level ups of note, sect founding...). */
  record(text: string, importance: 1 | 2 | 3, settlementId?: number, kind?: ChronicleEntry['kind']): ChronicleEntry;

  serialize(): SerializedSim;
}

/** Implemented in sim/index.ts by the simulation module. */
export type CreateSim = (world: WorldData, opts: SimOptions) => Sim;
