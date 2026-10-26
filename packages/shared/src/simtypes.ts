/**
 * Data model of the living-world simulation. The simulation itself runs on the server
 * (packages/server/src/sim) but these shapes are shared because parts of them are
 * sent to clients and persisted in snapshots.
 */
import type { Look } from './types';
import type { MissionOffer } from './types';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export type SettlementStatus = 'thriving' | 'stable' | 'struggling' | 'besieged' | 'fallen';

/** Tradable goods tracked by the economy (all are item ids). */
export const GOODS = ['grain', 'meat', 'herb', 'ore_iron', 'hide', 'cloth', 'wine', 'pill_heal_s'] as const;
export type GoodId = (typeof GOODS)[number];

export type NpcRole = 'villager' | 'guard' | 'merchant' | 'smith' | 'alchemist' | 'innkeeper' | 'master' | 'elder' | 'physician' | 'legend' | 'wanderer' | 'disciple';

export type ChronicleKind = 'blight' | 'faction' | 'settlement' | 'npc' | 'weather' | 'economy' | 'player' | 'legend' | 'season';

export interface ChronicleEntry {
  id: number;
  /** Absolute world day (0-based) and hour. */
  day: number;
  hour: number;
  kind: ChronicleKind;
  text: string;
  settlementId?: number;
  /** 1 minor, 2 notable, 3 world-shaking. */
  importance: 1 | 2 | 3;
  t: number;
}

export interface WorldClock {
  /** Total world hours elapsed since the world began. */
  totalHours: number;
}

export interface WeatherState {
  /** Climate band: 0 north, 1 central, 2 south. */
  zone: number;
  kind: WeatherKind;
  sinceHour: number;
}

export interface BlightHeart {
  id: number;
  x: number;
  y: number;
  /** 0..100. Hearts at 0 are dormant. */
  strength: number;
  /** World hour until which the heart is sealed. */
  sealedUntil: number;
}

export interface SettlementState {
  id: number;
  controller: string | null;
  status: SettlementStatus;
  /** 0..100. */
  prosperity: number;
  /** 0..100 combined walls, guards and faction support. */
  defense: number;
  population: number;
  /** Average Blight near the settlement, 0..255. */
  blight: number;
  /** World hour when a siege ends; 0 when none. */
  siegeUntil: number;
  siegeStrength: number;
  /** Who is besieging while `siegeUntil` is set: 'blight' (Hollows) or the attacking faction id (spawn bandits/raiders). */
  siegeBy?: string | null;
  stock: Record<string, number>;
  /** Daily production/consumption targets per good (units/day). */
  prod: Record<string, number>;
  cons: Record<string, number>;
  /** Daily event flags such as 'famine' or 'festival'. */
  flags: string[];
  /** Hour of the last status change, for chronicle pacing. */
  changedAt: number;
}

export interface FactionState {
  id: string;
  power: number;
  wealth: number;
  influence: number;
  relations: Record<string, number>;
  atWarWith: string[];
  alliedWith: string[];
  capital: number;
  /** What the faction is currently trying to do. */
  goal: string;
  /** Hour of last major action. */
  lastActionHour: number;
}

export interface NpcState {
  id: number;
  name: string;
  look: Look;
  role: NpcRole;
  faction: string | null;
  settlementId: number;
  /** Age in years. */
  age: number;
  /** Murim level 1..72. */
  level: number;
  xp: number;
  alive: boolean;
  legend: boolean;
  title: string;
  /** Skill ids this NPC teaches (masters). */
  teaches: string[];
  /** 'general' | 'weapons' | 'medicine' | 'food' | 'none' */
  shop: string;
  bornDay: number;
  diedDay: number | null;
  causeOfDeath?: string;
  /** Home tile where the NPC stands/wanders. */
  homeX: number;
  homeY: number;
  traits: string[];
  /** Disciples count for masters: the resident disciples (`role: 'disciple'`) who train under them. */
  disciples: number;
  /** Disciples: id of the master they train under (null when the master has died and none has taken them yet). */
  mentor?: number | null;
}

export interface SimState {
  version: number;
  seed: number;
  clock: WorldClock;
  weather: WeatherState[];
  /** w*h bytes, Blight intensity per tile. */
  blight: Uint8Array;
  hearts: BlightHeart[];
  settlements: SettlementState[];
  factions: FactionState[];
  npcs: NpcState[];
  chronicle: ChronicleEntry[];
  /** Offers currently posted on each settlement board. */
  boards: Record<number, MissionOffer[]>;
  rng: number;
  nextNpcId: number;
  nextChronicleId: number;
  nextOfferId: number;
}

export type SimEvent =
  | { k: 'chron'; entry: ChronicleEntry }
  | { k: 'settle'; id: number }
  | { k: 'blight'; idx: number[] }
  | { k: 'npcDied'; id: number }
  | { k: 'npcBorn'; id: number }
  | { k: 'npcMoved'; id: number }
  | { k: 'siege'; settlementId: number; start: boolean }
  | { k: 'weather'; zone: number; kind: WeatherKind }
  | { k: 'board'; settlementId: number }
  | { k: 'heart'; id: number; active: boolean }
  | { k: 'newDay'; day: number }
  | { k: 'newSeason'; season: number };
