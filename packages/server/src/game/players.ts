/**
 * Players: in-memory store, login/logout, `hello`, `me` refreshes, autosave, offline workers.
 */
import {
  CLOSE_REPLACED,
  PROTOCOL_VERSION,
  deriveForCharacter,
  getItem,
  isPassable,
  nearestWalkable,
  rankOf,
  xpToNext,
  type C2S,
  type CharacterSave,
  type EntityState,
  type MeView,
  type PathGrid,
  type S2C,
  type WorldData,
} from '@murim/shared';
import type { Config } from '../config';
import type { Db, UserRow } from '../db';
import type { Entity, Player, PlayerStore } from '../ctx';
import type { Sim } from '../sim/api';
import type { EntityStoreImpl } from './entities';
import type { Logger } from './log';
import type { Movement } from './movement';
import type { Registry, SimpleEventBus } from './registry';

/** A live client socket as seen by the game layer (implemented by net/gateway.ts). */
export interface ClientConn {
  readonly id: number;
  readonly ip: string;
  readonly open: boolean;
  send(msg: S2C): void;
  /** Pre-serialised JSON (used by broadcasts). */
  sendRaw(json: string): void;
  close(code: number, reason: string): void;
}

/** Commands buffered per player between ticks. */
export const MAX_QUEUED_COMMANDS = 32;
/** Minimum spacing between `me` messages to one client. */
export const ME_INTERVAL_MS = 250;
/** Chronicle entries sent with `hello`. */
export const HELLO_CHRONICLE = 40;

export class PlayerImpl implements Player {
  readonly charId: number;
  readonly userId: number;
  readonly username: string;
  readonly entity: Entity;
  save: CharacterSave;
  online = false;
  combatId: number | null = null;
  isAdmin: boolean;
  mutedUntil = 0;
  loginAt = 0;
  data: Record<string, unknown> = {};

  // ---- internals (core only) ----
  conn: ClientConn | null = null;
  readonly known = new Set<number>();
  queue: C2S[] = [];
  dirty = false;
  meDirty = false;
  lastMeAt = 0;
  /** Last world-chat message time. */
  lastWorldChat = 0;
  /** Last persisted position, to detect movement for autosave. */
  savedX: number;
  savedY: number;

  constructor(save: CharacterSave, user: { id: number; username: string; isAdmin: boolean }, entity: Entity) {
    this.charId = save.id;
    this.userId = user.id;
    this.username = user.username;
    this.isAdmin = user.isAdmin;
    this.save = save;
    this.entity = entity;
    this.savedX = save.x;
    this.savedY = save.y;
  }

  get name(): string {
    return this.save.name;
  }

  /** Send to this player's socket (no-op when offline). Lets PlayerImpl act as an AOI viewer. */
  send(msg: S2C): void {
    this.conn?.send(msg);
  }
}

export class PlayerStoreImpl implements PlayerStore {
  private readonly byChar = new Map<number, PlayerImpl>();
  private readonly byUser = new Map<number, PlayerImpl>();
  private readonly byEntity = new Map<number, PlayerImpl>();
  private readonly byLowerName = new Map<string, PlayerImpl>();
  private readonly onlineSet = new Set<PlayerImpl>();
  meBuilder: (p: Player) => MeView = () => {
    throw new Error('players: meBuilder not wired');
  };
  saver: (p: Player) => void = () => {};

  constructor(private readonly entities: EntityStoreImpl) {}

  add(p: PlayerImpl): void {
    this.byChar.set(p.charId, p);
    this.byUser.set(p.userId, p);
    this.byEntity.set(p.entity.id, p);
    this.byLowerName.set(p.name.toLowerCase(), p);
    if (p.online) this.onlineSet.add(p);
  }

  remove(p: PlayerImpl): void {
    if (this.byChar.get(p.charId) === p) this.byChar.delete(p.charId);
    if (this.byUser.get(p.userId) === p) this.byUser.delete(p.userId);
    if (this.byEntity.get(p.entity.id) === p) this.byEntity.delete(p.entity.id);
    if (this.byLowerName.get(p.name.toLowerCase()) === p) this.byLowerName.delete(p.name.toLowerCase());
    this.onlineSet.delete(p);
  }

  setOnline(p: PlayerImpl, online: boolean): void {
    p.online = online;
    if (online) this.onlineSet.add(p);
    else this.onlineSet.delete(p);
  }

  byCharId(id: number): PlayerImpl | undefined {
    return this.byChar.get(id);
  }

  byUserId(id: number): PlayerImpl | undefined {
    return this.byUser.get(id);
  }

  byEntityId(id: number): PlayerImpl | undefined {
    return this.byEntity.get(id);
  }

  byName(name: string): PlayerImpl | undefined {
    return this.byLowerName.get(name.trim().toLowerCase());
  }

  online(): PlayerImpl[] {
    return [...this.onlineSet];
  }

  onlineIter(): IterableIterator<PlayerImpl> {
    return this.onlineSet.values();
  }

  onlineCount(): number {
    return this.onlineSet.size;
  }

  all(): PlayerImpl[] {
    return [...this.byChar.values()];
  }

  near(x: number, y: number, r: number, onlineOnly = true): PlayerImpl[] {
    const out: PlayerImpl[] = [];
    this.entities.forEachNear(x, y, r, (e) => {
      if (e.kind !== 'player') return;
      const p = this.byEntity.get(e.id);
      if (p && (!onlineOnly || p.online)) out.push(p);
    });
    return out;
  }

  buildMeView(p: Player): MeView {
    return this.meBuilder(p);
  }

  saveNow(p: Player): void {
    this.saver(p);
  }
}

const ACTIVITY_STATES = new Set<EntityState>(['work', 'meditate', 'craft']);

export function activityState(activity: CharacterSave['activity']): EntityState {
  if (!activity) return 'idle';
  return activity.kind === 'train' ? 'meditate' : activity.kind === 'craft' ? 'craft' : 'work';
}

/** Player movement speed factor from derived speed (~1.0-1.6 early on). */
export function playerSpeedFactor(derivedSpeed: number): number {
  return Math.min(2.5, Math.max(0.6, derivedSpeed / 100));
}

export interface PlayerManagerDeps {
  world: WorldData;
  grid: PathGrid;
  sim: Sim;
  db: Db;
  config: Config;
  entities: EntityStoreImpl;
  movement: Movement;
  players: PlayerStoreImpl;
  registry: Registry;
  events: SimpleEventBus;
  log: Logger;
  now: () => number;
}

export class PlayerManager {
  /** Players whose `me` view must be re-sent (rate limited per player). */
  private readonly meQueue = new Set<PlayerImpl>();
  /** Players whose entity must be re-synced from the save (done every tick, never delayed). */
  private readonly syncQueue = new Set<PlayerImpl>();

  constructor(private readonly d: PlayerManagerDeps) {
    d.players.meBuilder = (p) => this.buildMeView(p as PlayerImpl);
    d.players.saver = (p) => this.save(p as PlayerImpl);
  }

  /** Where a character should appear: its saved tile if walkable, else its last town's spawn. */
  spawnTile(save: CharacterSave): { x: number; y: number } {
    const { world, grid } = this.d;
    if (Number.isInteger(save.x) && Number.isInteger(save.y) && isPassable(world, save.x, save.y)) return { x: save.x, y: save.y };
    const town = world.settlements[save.lastTown] ?? world.settlements[0];
    if (isPassable(world, town.spawn.x, town.spawn.y)) return { ...town.spawn };
    return nearestWalkable(grid, town.spawn.x, town.spawn.y, 8) ?? { ...world.settlements[0].spawn };
  }

  private createPlayer(save: CharacterSave, user: { id: number; username: string }, online: boolean): PlayerImpl {
    const { x, y } = this.spawnTile(save);
    save.x = x;
    save.y = y;
    const entity = this.d.entities.create({ kind: 'player', name: save.name, x, y, state: activityState(save.activity), online, look: save.look });
    const p = new PlayerImpl(save, { ...user, isAdmin: this.d.config.adminUsers.includes(user.username.toLowerCase()) }, entity);
    p.online = online;
    this.syncEntity(p);
    this.d.players.add(p);
    return p;
  }

  /** Copy save-derived fields onto the entity, run `onPlayerSync` decorators, touch. */
  syncEntity(p: PlayerImpl): void {
    const e = p.entity;
    const s = p.save;
    const d = deriveForCharacter(s, this.d.now());
    e.name = s.name;
    e.look = s.look;
    e.lv = s.level;
    e.rank = rankOf(s.level);
    e.maxHp = d.maxHp;
    e.hp = Math.max(0, Math.min(d.maxHp, Math.round(s.hp)));
    e.tag = s.title ? s.title : undefined;
    e.online = p.online;
    e.weapon = s.equipment.weapon ? getItem(s.equipment.weapon.id)?.weaponType : undefined;
    e.combatId = p.combatId ?? undefined;
    e.speed = playerSpeedFactor(d.speed);
    // Activity states are owned here; walk/fight/dead belong to movement and combat.
    if (!e.move && p.combatId === null && e.state !== 'fight' && e.state !== 'dead') {
      const st = activityState(s.activity);
      if (st !== 'idle' || ACTIVITY_STATES.has(e.state)) e.state = st;
    }
    this.d.registry.each('onPlayerSync', this.d.registry.playerSync, p, e);
    this.d.entities.touch(e);
  }

  buildMeView(p: PlayerImpl): MeView {
    const now = this.d.now();
    const me: MeView = {
      c: p.save,
      d: deriveForCharacter(p.save, now),
      xpNext: xpToNext(p.save.level),
      entityId: p.entity.id,
      combatId: p.combatId,
      sect: null,
      master: null,
      disciples: [],
      now,
    };
    this.d.registry.each('onBuildMe', this.d.registry.buildMe, p, me);
    return me;
  }

  /**
   * Bind a socket to the user's character. Returns null when the account has no character.
   * A second connection for the same account replaces the first (CLOSE_REPLACED).
   */
  attach(conn: ClientConn, user: UserRow): PlayerImpl | null {
    const { players, db, sim, log } = this.d;
    const now = this.d.now();
    let p = players.byUserId(user.id);
    if (p?.conn) {
      const old = p.conn;
      p.conn = null;
      old.send({ t: 'kick', reason: 'Logged in from another window.' });
      old.close(CLOSE_REPLACED, 'replaced');
      log.info(`player ${p.name} reconnected (replaced connection ${old.id})`);
    }
    if (!p) {
      const rec = db.getCharacterByUser(user.id);
      if (!rec) return null;
      p = this.createPlayer(rec.save, user, true);
      log.info(`player ${p.name} logged in`, { charId: p.charId, conn: conn.id });
    }
    p.conn = conn;
    p.known.clear();
    p.queue = [];
    p.loginAt = now;
    p.mutedUntil = user.mutedUntil;
    players.setOnline(p, true);
    p.save.lastSeen = now;
    this.syncEntity(p);
    p.lastMeAt = now;
    conn.send({
      t: 'hello',
      you: this.buildMeView(p),
      time: sim.timeView(now),
      settlements: sim.settlementViews(),
      chronicle: sim.state.chronicle.slice(-HELLO_CHRONICLE),
      blight: sim.blightBase64(),
      serverNow: now,
      protocol: PROTOCOL_VERSION,
    });
    this.d.registry.each('onLogin', this.d.registry.login, p);
    this.d.events.emit('login', { player: p });
    return p;
  }

  /** Socket closed. Ignored when the connection was already replaced. */
  detach(conn: ClientConn): void {
    const p = this.findByConn(conn);
    if (!p) return;
    const { players, entities, movement, log } = this.d;
    this.d.registry.each('onLogout', this.d.registry.logout, p);
    this.d.events.emit('logout', { player: p });
    p.conn = null;
    p.known.clear();
    p.queue = [];
    this.meQueue.delete(p);
    this.syncQueue.delete(p);
    players.setOnline(p, false);
    movement.stop(p.entity, true);
    p.save.lastSeen = this.d.now();
    this.save(p);
    if (p.save.activity) {
      this.syncEntity(p);
      log.info(`player ${p.name} logged out (stays as offline worker)`);
    } else {
      players.remove(p);
      entities.remove(p.entity);
      log.info(`player ${p.name} logged out`);
    }
  }

  private findByConn(conn: ClientConn): PlayerImpl | undefined {
    for (const p of this.d.players.onlineIter()) if (p.conn === conn) return p;
    return undefined;
  }

  /** Write a player's save now (position synced from the entity). */
  save(p: PlayerImpl): void {
    const now = this.d.now();
    this.d.registry.each('onSave', this.d.registry.save, p);
    p.save.x = p.entity.x;
    p.save.y = p.entity.y;
    if (p.online) p.save.lastSeen = now;
    try {
      this.d.db.saveCharacter(p.save, now);
      p.dirty = false;
      p.savedX = p.save.x;
      p.savedY = p.save.y;
    } catch (err) {
      this.d.log.error(`failed to save character ${p.charId}`, err);
    }
  }

  /** Save every player that changed (or moved) since its last save. Returns how many were saved. */
  saveDirty(all = false): number {
    const now = this.d.now();
    const list: PlayerImpl[] = [];
    for (const p of this.d.players.all()) {
      if (all || p.dirty || p.entity.x !== p.savedX || p.entity.y !== p.savedY) {
        this.d.registry.each('onSave', this.d.registry.save, p);
        p.save.x = p.entity.x;
        p.save.y = p.entity.y;
        if (p.online) p.save.lastSeen = now;
        list.push(p);
      }
    }
    if (list.length === 0) return 0;
    try {
      this.d.db.saveCharacters(
        list.map((p) => p.save),
        now,
      );
      for (const p of list) {
        p.dirty = false;
        p.savedX = p.save.x;
        p.savedY = p.save.y;
      }
    } catch (err) {
      this.d.log.error(`autosave of ${list.length} characters failed`, err);
      return 0;
    }
    return list.length;
  }

  /** Queue a `me` refresh. For offline workers: re-sync, or drop the worker once its activity ended. */
  markMe(p: PlayerImpl): void {
    if (p.online) {
      this.meQueue.add(p);
      this.syncQueue.add(p);
    } else if (!p.save.activity) this.dropWorkerIfIdle(p);
    else this.syncEntity(p);
  }

  /** Re-sync touched entities, then send coalesced `me` views (max one per ME_INTERVAL_MS per player). */
  flushMe(now: number): void {
    for (const p of this.syncQueue) {
      this.syncQueue.delete(p);
      if (this.d.players.byCharId(p.charId) === p) this.syncEntity(p);
    }
    for (const p of this.meQueue) {
      if (!p.online || !p.conn) {
        this.meQueue.delete(p);
        continue;
      }
      if (now - p.lastMeAt < ME_INTERVAL_MS) continue;
      this.meQueue.delete(p);
      p.lastMeAt = now;
      p.conn.send({ t: 'me', me: this.buildMeView(p) });
    }
  }

  /** Re-create offline workers (characters with a running activity) after a restart. */
  restoreOfflineWorkers(limit = 2000): number {
    let n = 0;
    for (const rec of this.d.db.listCharactersWithActivity(limit)) {
      if (this.d.players.byCharId(rec.id)) continue;
      const user = this.d.db.getUserById(rec.userId);
      if (!user || user.banned) continue;
      try {
        this.createPlayer(rec.save, user, false);
        n++;
      } catch (err) {
        this.d.log.warn(`could not restore offline worker ${rec.id}`, err);
      }
    }
    return n;
  }

  /** Remove an offline worker whose activity ended (reached through ctx.markMe). */
  dropWorkerIfIdle(p: PlayerImpl): void {
    if (p.online || p.save.activity || this.d.players.byCharId(p.charId) !== p) return;
    this.save(p);
    this.d.players.remove(p);
    this.d.entities.remove(p.entity);
  }
}
