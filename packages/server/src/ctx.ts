/**
 * The server extension API. Gameplay systems (packages/server/src/systems/*) are written
 * against `GameContext` only; they never import from game/ or net/ directly.
 *
 *   export function register(ctx: GameContext): void {
 *     ctx.command('flee', (p) => { ... });
 *     ctx.onInteract('monster', (p, e) => { startFight(p, e); return true; });
 *   }
 *
 * Threading model: everything runs on the single game loop. Commands are queued per player and
 * executed at the start of each 100 ms tick; queries are answered as they arrive. Handlers may
 * throw `GameError` to reject a request with a message for the player.
 */
import type {
  C2S,
  CharacterSave,
  ChatMsg,
  Dir,
  EntityKind,
  EntityState,
  EntityView,
  Look,
  MeView,
  NodeKind,
  NoteLevel,
  NpcRole,
  PathGrid,
  Point,
  Queries,
  QueryName,
  Rng,
  S2C,
  SimEvent,
  WeaponType,
  WorldData,
} from '@murim/shared';
import type { Config } from './config';
import type { Db } from './db';
import type { Logger } from './game/log';
import type { Sim } from './sim/api';

export type { Config } from './config';
export type { Db } from './db';
export type { Logger } from './game/log';
export type { Sim } from './sim/api';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Throw from a command or query handler to refuse the request.
 * Commands reply `{t:'err', code, text}`; queries reply `{t:'res', ok:false, err: code, data: {text}}`.
 */
export class GameError extends Error {
  constructor(
    readonly code: string,
    text: string,
  ) {
    super(text);
    this.name = 'GameError';
  }
}

// ---------------------------------------------------------------------------
// Extension bags
// ---------------------------------------------------------------------------

/**
 * Typed slot in an `entity.data` / `player.data` bag, so modules can attach state without
 * editing core types:
 *
 *   const MONSTER = new DataKey<MonsterState>('monster');
 *   MONSTER.set(e, { def: 'wolf', spawnId: 3 });
 *   const st = MONSTER.get(e); // MonsterState | undefined
 */
export class DataKey<T> {
  constructor(readonly name: string) {}
  get(holder: { data: Record<string, unknown> }): T | undefined {
    return holder.data[this.name] as T | undefined;
  }
  /** Get, creating with `init` when missing. */
  ensure(holder: { data: Record<string, unknown> }, init: () => T): T {
    if (!(this.name in holder.data)) holder.data[this.name] = init();
    return holder.data[this.name] as T;
  }
  set(holder: { data: Record<string, unknown> }, value: T): void {
    holder.data[this.name] = value;
  }
  delete(holder: { data: Record<string, unknown> }): void {
    delete holder.data[this.name];
  }
}

/** State the core attaches to every `npc` entity (read-only for systems). */
export interface NpcEntityData {
  /** Id of the NpcState in the sim (`ctx.sim.npc(npcId)`). */
  npcId: number;
  settlementId: number;
  homeX: number;
  homeY: number;
  /** Wandering is paused until this time (set when a player talks to the NPC). */
  holdUntil: number;
  nextWanderAt: number;
}

/** `NPC_DATA.get(entity)?.npcId` maps an npc entity to its sim NPC. */
export const NPC_DATA = new DataKey<NpcEntityData>('npc');

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type ArriveResult = 'arrived' | 'cancelled' | 'removed';
/** Called exactly once when a move ends. */
export type ArriveCallback = (e: Entity, result: ArriveResult) => void;

/** Movement in progress. Read-only for gameplay code; change it through `ctx.movement`. */
export interface MoveState {
  /** Tile being stepped onto right now. */
  readonly nx: number;
  readonly ny: number;
  /** Wall-clock start (ms) and duration of the current step. */
  readonly stepStart: number;
  readonly stepMs: number;
  /** Remaining tiles after (nx, ny). */
  readonly path: readonly Point[];
  /** Final destination. */
  readonly tx: number;
  readonly ty: number;
  /** Increments with every new step. */
  readonly seq: number;
}

/** Visible, optional entity fields (mirrors `EntityView`). Change them, then `ctx.entities.touch(e)`. */
export interface EntityExtras {
  look?: Look;
  /** Sprite key for monsters and nodes. */
  sprite?: string;
  lv?: number;
  hp?: number;
  maxHp?: number;
  /** Title / sect tag shown with the name. */
  tag?: string;
  faction?: string;
  role?: NpcRole;
  elite?: 0 | 1 | 2;
  nodeKind?: NodeKind;
  combatId?: number;
  /** Players: false when the character is an offline worker. */
  online?: boolean;
  weapon?: WeaponType;
  rank?: number;
}

export interface Entity extends EntityExtras {
  readonly id: number;
  readonly kind: EntityKind;
  name: string;
  /** Current tile. Use `ctx.movement` (walk/teleport) to change it; never assign directly. */
  readonly x: number;
  readonly y: number;
  face: Dir;
  state: EntityState;
  /** Movement speed multiplier (1 = STEP_MS per tile on speed-1 terrain). */
  speed: number;
  /** Hidden entities are not sent to clients (e.g. a dead monster waiting to respawn). */
  hidden: boolean;
  /** Server-side walk state; null when standing still. */
  readonly move: MoveState | null;
  /** Bumped by `touch`; the AOI layer sends patches for entities whose version changed. */
  readonly ver: number;
  /** Free-form per-module state; namespace keys by module (see `DataKey`). Never sent to clients. */
  data: Record<string, unknown>;
}

export interface EntityInit extends EntityExtras {
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  face?: Dir;
  state?: EntityState;
  speed?: number;
  hidden?: boolean;
  data?: Record<string, unknown>;
}

export interface EntityStore {
  /** Create an entity (ids are never reused while the process runs). */
  create(init: EntityInit): Entity;
  get(id: number): Entity | undefined;
  has(id: number): boolean;
  /** Remove an entity; its move callback gets 'removed' and `onRemove` listeners run. */
  remove(e: Entity | number): void;
  /** Mark visible fields as changed so nearby clients get a patch this tick. */
  touch(e: Entity): void;
  /** Entities within Euclidean radius `r` (tiles) of (x, y). */
  near(x: number, y: number, r: number, filter?: (e: Entity) => boolean): Entity[];
  /** Closest matching entity within `r`, or undefined. */
  nearest(x: number, y: number, r: number, filter?: (e: Entity) => boolean): Entity | undefined;
  all(): IterableIterator<Entity>;
  ofKind(kind: EntityKind): Entity[];
  count(kind?: EntityKind): number;
  /** The view a client would receive right now. */
  toView(e: Entity): EntityView;
  /** Called after an entity is removed. Returns an unsubscribe function. */
  onRemove(h: (e: Entity) => void): () => void;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface Player {
  /** Character id (also used as the player's id in profiles, friends, sects...). */
  readonly charId: number;
  readonly userId: number;
  /** Account login name (not shown to other players). */
  readonly username: string;
  /** Character name (same as `save.name`). */
  readonly name: string;
  /** The `player` entity on the map. */
  readonly entity: Entity;
  /** Live character sheet. Mutate it, then `ctx.markDirty(p)` (and `ctx.markMe(p)` to refresh the client). */
  save: CharacterSave;
  /** True while a socket is attached. Offline workers stay in the store with online = false. */
  readonly online: boolean;
  /** Combat id while fighting (owned by the combat system). Blocks movement while set. */
  combatId: number | null;
  readonly isAdmin: boolean;
  /** Chat mute expiry, ms epoch (0 = not muted). */
  mutedUntil: number;
  /** When the current session started (ms epoch). */
  readonly loginAt: number;
  /** Per-module runtime state (not persisted; persist in `save` or your own tables). */
  data: Record<string, unknown>;
}

export interface PlayerStore {
  byCharId(id: number): Player | undefined;
  byUserId(id: number): Player | undefined;
  byEntityId(id: number): Player | undefined;
  /** Case-insensitive exact character name (includes offline workers; check `online`). */
  byName(name: string): Player | undefined;
  /** Connected players. */
  online(): Player[];
  onlineCount(): number;
  /** Connected players and offline workers. */
  all(): Player[];
  /** Players whose entity is within `r` tiles of (x, y). */
  near(x: number, y: number, r: number, onlineOnly?: boolean): Player[];
  /** The `me` view for a player (runs `onBuildMe` decorators). */
  buildMeView(p: Player): MeView;
  /** Write the save to the database now. */
  saveNow(p: Player): void;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export interface MoveOptions {
  /** Called once when the move ends ('arrived', 'cancelled' when replaced or stopped, 'removed'). */
  onArrive?: ArriveCallback;
  /** A* node budget (default 8000). */
  maxNodes?: number;
  /** Maximum path length in steps (default 160). */
  maxSteps?: number;
  /** Snap a blocked target to the nearest walkable tile within this radius (default 4, 0 = no snap). */
  snap?: number;
  /** Speed multiplier for this move (default `entity.speed`). */
  speed?: number;
}

export interface ApproachOptions extends MoveOptions {
  /** Stop once within this Euclidean distance (tiles) of the target (default 1.5: adjacent, diagonals included). */
  range?: number;
  /** Re-chase attempts when the target moved away while we walked (default 3). */
  retries?: number;
}

export type MoveFailure = 'blocked' | 'unreachable' | 'too_far';
export type MoveResult = { ok: true; tx: number; ty: number; steps: number } | { ok: false; reason: MoveFailure };

/** Returns a reason string when the player may not move right now, else null. */
export type MoveGuard = (p: Player) => string | null;

export interface MovementApi {
  /** Path-find and walk to (x, y). Mid-step entities finish their current step first. */
  moveTo(e: Entity, x: number, y: number, opts?: MoveOptions): MoveResult;
  /**
   * Walk next to `target` (stopping as soon as it is within `range`) and chase it if it moves.
   * `onArrive('arrived')` fires only once the entity is in range; otherwise 'cancelled' / 'removed'.
   * If already in range the callback runs immediately and the result has `steps: 0`.
   */
  approach(e: Entity, target: Entity, opts?: ApproachOptions): MoveResult;
  /** Walk an explicit, pre-validated list of adjacent tiles. */
  followPath(e: Entity, path: readonly Point[], opts?: MoveOptions): boolean;
  /** Stop: after the current step (smooth, default) or right now. */
  stop(e: Entity, immediate?: boolean): void;
  /** Jump to a tile without walking (cancels any move). */
  teleport(e: Entity, x: number, y: number): void;
  isMoving(e: Entity): boolean;
  /** Runs `guards`; returns the first refusal reason or null. */
  canMove(p: Player): string | null;
  /**
   * Movement guards for player-issued moves. Defaults: in combat (`combatId`) and while an
   * activity runs (`save.activity`). Push your own, or splice a default out to replace it.
   */
  readonly guards: MoveGuard[];
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatApi {
  /** A system line to one player, or to everyone when `to` is omitted. */
  system(text: string, to?: Player): void;
  /** Deliver a message to every online member of a sect. */
  toSect(sectId: number, msg: ChatMsg): void;
  /** Replace how sect members are found (default: online players with `save.sectId === sectId`). */
  setSectResolver(fn: (sectId: number) => Player[]): void;
  /** Sanitise user text like chat does: control chars, whitespace, profanity mask, length cap. */
  clean(text: string, maxLen?: number): string;
}

// ---------------------------------------------------------------------------
// Events between systems
// ---------------------------------------------------------------------------

/**
 * Cross-system event map. Extend it from your module with declaration merging:
 *
 *   declare module '../ctx' {
 *     interface GameEvents { monsterKilled: { player: Player; monster: Entity } }
 *   }
 */
export interface GameEvents {
  /** A player attached and received `hello` (after onLogin handlers). */
  login: { player: Player };
  /** A player detached (before the save is written). */
  logout: { player: Player };
  entityRemoved: { entity: Entity };
  /** Sim events for one world hour (after onHour handlers). */
  hour: { events: SimEvent[] };
}

export interface EventBus {
  on<K extends keyof GameEvents>(type: K, h: (ev: GameEvents[K]) => void): () => void;
  emit<K extends keyof GameEvents>(type: K, ev: GameEvents[K]): void;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type CommandType = C2S['t'];
export type CommandMsg<T extends CommandType> = Extract<C2S, { t: T }>;
export type CommandHandler<T extends CommandType> = (p: Player, m: CommandMsg<T>) => void | Promise<void>;
export type QueryHandler<N extends QueryName> = (p: Player, args: Queries[N]['args']) => Queries[N]['res'] | Promise<Queries[N]['res']>;
/** Return true when handled; the first handler returning true wins. */
export type InteractHandler = (p: Player, e: Entity) => boolean;

export interface RegisterOptions {
  /** Replace an existing handler instead of throwing. */
  override?: boolean;
}

/** Unsubscribe function returned by every `on*` registration. */
export type Off = () => void;

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

export interface GameContext {
  /** Static world generated from the seed (terrain, objects, settlements, nodes...). */
  readonly world: WorldData;
  /** Shared path grid over the static world (`worldPathGrid(world)`). */
  readonly grid: PathGrid;
  /** Living-world simulation (clock, weather, blight, settlements, NPC lives, boards). */
  readonly sim: Sim;
  readonly config: Config;
  readonly db: Db;
  /** Server-side gameplay randomness (seeded at boot). Not for secrets. */
  readonly rng: Rng;
  readonly log: Logger;
  /** Current time, ms epoch (injectable for tests). */
  now(): number;

  readonly entities: EntityStore;
  readonly players: PlayerStore;
  readonly movement: MovementApi;
  readonly chat: ChatApi;
  readonly events: EventBus;
  /** The map entity of a sim NPC, if it is spawned. */
  npcEntity(npcId: number): Entity | undefined;
  /**
   * Pass `SimEvent[]` returned by `sim.recordKill / recordMissionDone / damageHeart / purify` through the same fan-out
   * as the hourly events (chronicle, settlement, blight and NPC mirror updates; `onHour` handlers and the `hour` event
   * run only when the batch carries siege / heart / board / npc / calendar events). The `time` message is not re-sent.
   */
  fanOut(events: readonly SimEvent[]): void;

  // ---- sending -----------------------------------------------------------------
  /** Send to one player (no-op when offline). */
  send(p: Player, msg: S2C): void;
  /** Send to online players whose entity is within `radius` tiles of (x, y). */
  sendNear(x: number, y: number, radius: number, msg: S2C, except?: Player): void;
  /** Send to every online player (serialised once). */
  broadcast(msg: S2C, except?: Player): void;
  /** Toast notification (`{t:'note'}`). */
  notify(p: Player, level: NoteLevel, text: string): void;
  /** Schedule a `me` refresh (coalesced to <= 4/s) and re-sync the player's entity fields. */
  markMe(p: Player): void;
  /** Schedule a save (autosave every 30 s, logout, shutdown). */
  markDirty(p: Player): void;

  // ---- extension points --------------------------------------------------------
  /** Handle a client command. One handler per type (pass `{override: true}` to replace). */
  command<T extends CommandType>(t: T, h: CommandHandler<T>, opts?: RegisterOptions): void;
  /** Answer a client query. Unregistered queries reply `{ok:false, err:'not_implemented'}`. */
  query<N extends QueryName>(name: N, h: QueryHandler<N>, opts?: RegisterOptions): void;
  /** Every 100 ms tick, after commands and movement, before AOI sync. */
  onTick(h: (dtMs: number, now: number) => void): Off;
  /** After each world hour, with that hour's sim events (already broadcast to clients). */
  onHour(h: (events: SimEvent[]) => void): Off;
  /** After a player attaches and has received `hello`. */
  onLogin(h: (p: Player) => void): Off;
  /** When a player detaches, before the save is written (abort fights, etc.). */
  onLogout(h: (p: Player) => void): Off;
  /** When a player reaches an entity they `interact`ed with. Return true when handled. */
  onInteract(kind: EntityKind, h: InteractHandler): Off;
  /** Decorate every `me` view (sect, master, disciples...). */
  onBuildMe(h: (p: Player, me: MeView) => void): Off;
  /** Decorate the player's entity when it is re-synced from the save (tag, weapon, hp...). */
  onPlayerSync(h: (p: Player, e: Entity) => void): Off;
  /** Just before a player's save is written (logout, autosave, shutdown): flush module state into `p.save` / your tables. */
  onSave(h: (p: Player) => void): Off;
  /** Once at graceful shutdown, before players are saved and kicked: persist global module state. */
  onShutdown(h: () => void): Off;
  /** Run `h` every `ms` on the game loop (granularity: one tick). */
  every(ms: number, h: (now: number) => void): Off;
  /** Run `h` once after `ms` on the game loop. */
  after(ms: number, h: (now: number) => void): Off;
}

/** Signature of a gameplay system module (listed in systems/index.ts). */
export type SystemModule = (ctx: GameContext) => void;
