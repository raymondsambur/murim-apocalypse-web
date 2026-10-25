/**
 * Network contract between browser client and game server.
 *
 * - HTTP (JSON) for accounts, character creation and the static world payload.
 * - One WebSocket at /ws (cookie-authenticated) for everything real-time.
 *   Client -> server messages are `C2S`, server -> client messages are `S2C`.
 *   Request/response style lookups use `{t:'q'}` / `{t:'res'}` (see `Queries`).
 *
 * The server is authoritative. Clients send intents; the server validates everything.
 * Keep this file additive: add fields/messages, avoid renaming.
 */
import type { CombatEvent, StatusKind } from './combat';
import type { DerivedStats, Roll } from './stats';
import type { BuildingDef, NodeKind, ResourceNodeDef, SettlementDef } from './terrain';
import type {
  ActiveMission,
  CharacterSave,
  EquipSlot,
  ItemStack,
  JobId,
  Loadout,
  Look,
  MissionOffer,
  Stance,
  StatKey,
  Stats,
  TacticRule,
  WeaponType,
} from './types';
import type { ChronicleEntry, NpcRole, SettlementStatus, WeatherKind } from './simtypes';

export const WS_PATH = '/ws';
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

/** POST /api/register, POST /api/login */
export interface AuthRequest {
  username: string;
  password: string;
}

/** Shared envelope for HTTP errors: status 4xx with this body. */
export interface ApiError {
  error: string;
}

export interface CharacterBrief {
  id: number;
  name: string;
  level: number;
  look: Look;
}

/** GET /api/me (401 when logged out), also returned by login/register. */
export interface MeResponse {
  user: { id: number; username: string };
  character: CharacterBrief | null;
  /** Rolls remaining before the player must keep the current roll. */
  rerollsLeft: number;
}

export interface RollPreview {
  roll: Roll;
  talents: { id: string; name: string; desc: string; positive: boolean }[];
  origin: { id: string; name: string; desc: string; gold: number; items: string[]; skills: string[] };
  /** Suggested random appearance (client may change it). */
  look: Look;
  rerollsLeft: number;
}

/** POST /api/character/roll -> RollPreview (consumes a reroll after the first). */
/** POST /api/character/create */
export interface CreateCharacterRequest {
  name: string;
  look: Look;
}

/** GET /api/world: static terrain, sent once per session (large). Arrays are base64. */
export interface WorldPayload {
  seed: number;
  w: number;
  h: number;
  terrain: string;
  objects: string;
  settlements: SettlementDef[];
  buildings: BuildingDef[];
  nodes: ResourceNodeDef[];
  roads: [number, number][];
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind = 'player' | 'npc' | 'monster' | 'node';
export type EntityState = 'idle' | 'walk' | 'fight' | 'work' | 'meditate' | 'craft' | 'dead';
/** 0 = facing south-east (screen down-right), 1 = south-west, 2 = north-west, 3 = north-east. */
export type Dir = 0 | 1 | 2 | 3;

export interface EntityView {
  id: number;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  /** Next tile and duration (ms) of the step in progress; omitted when standing still. */
  nx?: number;
  ny?: number;
  step?: number;
  face: Dir;
  state: EntityState;
  look?: Look;
  /** Sprite key for monsters and nodes, e.g. 'wolf', 'bandit', 'hollow', 'herb', 'ore'. */
  sprite?: string;
  lv?: number;
  hp?: number;
  maxHp?: number;
  /** Title / sect tag shown with the name. */
  tag?: string;
  faction?: string;
  role?: NpcRole;
  /** 0 normal, 1 elite, 2 boss. */
  elite?: 0 | 1 | 2;
  nodeKind?: NodeKind;
  combatId?: number;
  /** For players: false when the character is an offline worker/trainer. */
  online?: boolean;
  weapon?: WeaponType;
  /** Rank 1..8, shown as a name colour. */
  rank?: number;
}

export type EntityPatch = Partial<Omit<EntityView, 'id' | 'kind'>> & { id: number };

// ---------------------------------------------------------------------------
// Views sent to the client
// ---------------------------------------------------------------------------

export type SectRole = 'leader' | 'elder' | 'disciple' | 'outer';

export interface MeView {
  c: CharacterSave;
  d: DerivedStats;
  xpNext: number;
  entityId: number;
  combatId: number | null;
  sect: { id: number; name: string; tag: string; role: SectRole } | null;
  master: { id: number; name: string; npc: boolean } | null;
  disciples: { id: number; name: string; level: number; online: boolean }[];
  now: number;
}

export interface SettlementView {
  id: number;
  controller: string | null;
  status: SettlementStatus;
  prosperity: number;
  population: number;
  defense: number;
  /** Average Blight nearby, 0..255. */
  blight: number;
  siege: boolean;
  flags: string[];
}

export interface TimeView {
  /** World time of day (0..24) at server time `t`. */
  hours: number;
  /** Absolute day count since the world began. */
  day: number;
  /** 0 Spring, 1 Summer, 2 Autumn, 3 Winter. */
  season: number;
  year: number;
  /** Real milliseconds per world hour, so the client can extrapolate the clock. */
  hourMs: number;
  t: number;
  /** Weather for each climate band (north, central, south). */
  weather: WeatherKind[];
}

export type ChatChannel = 'local' | 'world' | 'sect' | 'whisper' | 'system';

export interface ChatMsg {
  ch: ChatChannel;
  from: string;
  fromId?: number;
  text: string;
  t: number;
  to?: string;
  tag?: string;
}

export interface FighterView {
  id: number;
  name: string;
  side: 0 | 1;
  lv: number;
  hp: number;
  maxHp: number;
  qi: number;
  maxQi: number;
  status: StatusKind[];
  player: boolean;
  alive: boolean;
  fled: boolean;
}

export interface CombatView {
  id: number;
  beat: number;
  fighters: FighterView[];
  x: number;
  y: number;
  duel: boolean;
}

export interface CombatReward {
  xp: number;
  gold: number;
  items: ItemStack[];
}

export interface ShopEntry {
  id: string;
  price: number;
  /** null = unlimited. */
  stock: number | null;
}

export interface TeachEntry {
  skill: string;
  gold: number;
  learned: boolean;
  ok: boolean;
  reason?: string;
}

export interface NpcMenu {
  id: number;
  name: string;
  role: NpcRole;
  title: string;
  faction: string | null;
  settlementId: number;
  look: Look;
  level: number;
  greeting: string;
  shop?: {
    entries: ShopEntry[];
    sellMult: number;
    /** Shop type ('general' | 'weapons' | 'medicine' | 'food'). */
    kind?: string;
    /** Gold per unit this shop pays for each inventory slot of the requesting player (same indexes as `me.c.inventory`); 0 = the shop refuses that item. */
    sellPrices?: number[];
  };
  teaches?: TeachEntry[];
  /** Active mission ids that this NPC can complete. */
  turnIns: string[];
  /** Price in gold if the NPC runs an inn (rest to full health). */
  restPrice?: number;
  /** For masters: can this player be accepted as a disciple? */
  disciple?: { ok: boolean; reason?: string; already: boolean };
}

export interface SectMember {
  id: number;
  name: string;
  level: number;
  role: SectRole;
  online: boolean;
}

export interface SectView {
  id: number;
  name: string;
  tag: string;
  motto: string;
  level: number;
  treasury: number;
  founded: number;
  members: SectMember[];
  invites: number;
}

export interface FriendView {
  id: number;
  name: string;
  level: number;
  online: boolean;
  /** 'friend' accepted, 'in' request received, 'out' request sent. */
  status: 'friend' | 'in' | 'out';
}

export interface FactionBrief {
  id: string;
  power: number;
  wealth: number;
  influence: number;
  atWarWith: string[];
  alliedWith: string[];
  settlements: number[];
  goal: string;
}

export interface WorldInfo {
  settlements: SettlementView[];
  factions: FactionBrief[];
  chronicle: ChronicleEntry[];
  hearts: { id: number; x: number; y: number; strength: number }[];
  time: TimeView;
  online: number;
}

export interface PublicProfile {
  id: number;
  name: string;
  level: number;
  look: Look;
  title: string;
  sect: string | null;
  kills: number;
  deaths: number;
  equipment: CharacterSave['equipment'];
  stats: Stats;
  rank: number;
}

export interface SiteView {
  id: string;
  kind: string;
  x: number;
  y: number;
  settlementId: number;
  /** Job that can be worked here, if any. */
  job?: JobId;
  trainBonus?: number;
}

export interface RecipeView {
  id: string;
  name: string;
  job: JobId;
  level: number;
  inputs: [string, number][];
  output: [string, number];
  seconds: number;
  canCraft: boolean;
  reason?: string;
}

export interface LeaderEntry {
  id: number;
  name: string;
  level: number;
  kills: number;
  sect: string | null;
}

// ---------------------------------------------------------------------------
// Queries (request/response over the socket)
// ---------------------------------------------------------------------------

export interface Queries {
  npc: { args: { id: number }; res: NpcMenu };
  board: { args: { settlement: number }; res: { offers: MissionOffer[]; settlement: SettlementView } };
  world: { args: Record<string, never>; res: WorldInfo };
  chronicle: { args: { before?: number; limit?: number }; res: ChronicleEntry[] };
  sites: { args: { settlement: number }; res: SiteView[] };
  recipes: { args: { site: string }; res: RecipeView[] };
  friends: { args: Record<string, never>; res: FriendView[] };
  sect: { args: { id?: number }; res: SectView | null };
  sects: { args: Record<string, never>; res: { id: number; name: string; tag: string; level: number; members: number; motto: string }[] };
  player: { args: { id?: number; name?: string }; res: PublicProfile | null };
  leaderboard: { args: Record<string, never>; res: LeaderEntry[] };
  /** `id` is the character id; `entity` is the map entity id (use it for duel challenges and interact). */
  nearbyPlayers: { args: Record<string, never>; res: { id: number; name: string; level: number; entity?: number }[] };
}
export type QueryName = keyof Queries;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type SectOp =
  | { op: 'create'; name: string; tag: string; motto?: string }
  | { op: 'join'; sect: number }
  | { op: 'invite'; name: string }
  | { op: 'accept'; sect: number }
  | { op: 'decline'; sect: number }
  | { op: 'leave' }
  | { op: 'kick'; id: number }
  | { op: 'promote'; id: number; role: SectRole }
  | { op: 'deposit'; gold: number }
  | { op: 'motto'; motto: string }
  | { op: 'disband' };

export type MasterOp =
  | { op: 'request'; npc?: number; id?: number }
  | { op: 'accept'; id: number }
  | { op: 'decline'; id: number }
  | { op: 'dismiss'; id?: number }
  | { op: 'teach'; id: number; skill: string };

/*
 * ID RULES for social ops (decided by the lead; keep consistent client <-> server):
 *  - Anything the client only sees in the world (duel challenge target, interact, assist) uses ENTITY ids.
 *  - Relationship records (friend accept/decline/remove, sect kick/promote, master accept/dismiss/teach) use
 *    CHARACTER ids, as found in FriendView.id, SectMember.id, MeView.disciples[].id, PublicProfile.id.
 *  - Invites by name (friend add, sect invite) use the exact character name.
 *  - `S2C invite.fromId` and `ChatMsg.fromId` are CHARACTER ids. For `duel` invites `data.entity` carries the challenger's entity id.
 *  - `duel accept/decline` carry the challenger's CHARACTER id (= invite.fromId).
 *  - `master request` uses `npc` (NPC id from NpcMenu.id) for NPC masters or `id` (character id) for player masters.
 */
export type FriendOp = { op: 'add'; name: string } | { op: 'accept'; id: number } | { op: 'decline'; id: number } | { op: 'remove'; id: number };
export type DuelOp = { op: 'challenge'; id: number; stake?: number } | { op: 'accept'; id: number } | { op: 'decline'; id: number };

/** POST /api/logout -> 204, clears the session cookie. */
export const LOGOUT_PATH = '/api/logout';
/**
 * Failed queries arrive as `{t:'res', ok:false, err: <code>, data: {text: <player-visible sentence>}}`.
 * `RollPreview.origin.items` / `.skills` are human-readable strings (e.g. "Grain x5"), not ids.
 * Entity stop convention in `ents.upd`: `nx = x, ny = y, step = 0`.
 */

export type ActivityStart =
  | { kind: 'train'; site: string }
  | { kind: 'shift'; site: string; job: JobId }
  | { kind: 'craft'; site: string; recipe: string; qty: number };

export type C2S =
  | { t: 'ping'; t0: number }
  | { t: 'q'; id: number; name: QueryName; args: Queries[QueryName]['args'] }
  | { t: 'move'; x: number; y: number }
  | { t: 'stop' }
  /** Walk to and interact with an entity (talk to NPC, fight monster, gather node). */
  | { t: 'interact'; id: number }
  /** Join an ongoing fight (combat id). */
  | { t: 'assist'; combat: number }
  | { t: 'flee' }
  | { t: 'alloc'; stat: StatKey; n: number }
  | { t: 'equip'; idx: number; id: string }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'use'; idx: number; id: string }
  | { t: 'drop'; idx: number; id: string; qty: number }
  | { t: 'build'; loadout: Loadout; stance: Stance; tactics: TacticRule[] }
  | { t: 'breakthrough' }
  | { t: 'buy'; npc: number; item: string; qty: number }
  | { t: 'sell'; npc: number; idx: number; id: string; qty: number }
  | { t: 'learn'; npc: number; skill: string }
  | { t: 'rest'; npc: number }
  | { t: 'maccept'; offer: string; settlement: number }
  | { t: 'mabandon'; id: string }
  | { t: 'mturnin'; id: string; npc?: number }
  | ({ t: 'astart' } & ActivityStart)
  | { t: 'astop' }
  | { t: 'chat'; ch: Exclude<ChatChannel, 'system'>; text: string; to?: string }
  | ({ t: 'friend' } & FriendOp)
  | ({ t: 'sect' } & SectOp)
  | ({ t: 'master' } & MasterOp)
  | ({ t: 'duel' } & DuelOp)
  | { t: 'title'; title: string };

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type NoteLevel = 'info' | 'good' | 'warn' | 'bad';

export type InviteKind = 'friend' | 'sect' | 'master' | 'duel';

export type FxKind = 'levelup' | 'breakthrough' | 'death' | 'loot' | 'heal' | 'learn' | 'gather' | 'purify';

export type S2C =
  | {
      t: 'hello';
      you: MeView;
      time: TimeView;
      settlements: SettlementView[];
      chronicle: ChronicleEntry[];
      /** Base64 blight map (w*h bytes). */
      blight: string;
      serverNow: number;
      protocol: number;
    }
  | { t: 'me'; me: MeView }
  | { t: 'ents'; add?: EntityView[]; upd?: EntityPatch[]; del?: number[] }
  | { t: 'time'; time: TimeView }
  /** Blight: either a full replacement (base64) or changed tiles. */
  | { t: 'blight'; full?: string; idx?: number[]; val?: number[] }
  | { t: 'settle'; list: SettlementView[] }
  | { t: 'chron'; entries: ChronicleEntry[] }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'note'; level: NoteLevel; text: string }
  /** Sent each beat to fighters. */
  | { t: 'combat'; c: CombatView; ev: CombatEvent[] }
  | { t: 'cend'; id: number; result: 'win' | 'lose' | 'fled' | 'draw'; reward?: CombatReward; text: string }
  /** Floating combat text for nearby spectators. */
  | { t: 'cfx'; ev: CombatEvent[] }
  | { t: 'npc'; menu: NpcMenu }
  | { t: 'res'; id: number; ok: boolean; data?: unknown; err?: string }
  | { t: 'err'; code: string; text: string }
  | { t: 'pong'; t0: number; now: number }
  | { t: 'invite'; kind: InviteKind; fromId: number; from: string; data?: Record<string, unknown> }
  | { t: 'fx'; kind: FxKind; entity?: number; text?: string }
  | { t: 'mission'; update: ActiveMission }
  | { t: 'kick'; reason: string };

/** Close codes used by the server. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_BAD_AUTH = 4002;
export const CLOSE_BANNED = 4003;
export const CLOSE_RATE = 4004;
