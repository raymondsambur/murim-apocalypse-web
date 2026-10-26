/**
 * Assembles the GameContext: stores, movement, AOI, NPC mirror, chat, registries and the
 * per-tick pipeline. The gateway talks to `Game` (connect / receive / disconnect); the runtime
 * calls `tick` and `advanceHour`.
 */
import {
  Rng,
  worldPathGrid,
  type C2S,
  type ChronicleEntry,
  type NoteLevel,
  type PathGrid,
  type Queries,
  type QueryName,
  type S2C,
  type SimEvent,
  type WorldData,
} from '@murim/shared';
import type { Config } from '../config';
import { GameError, type GameContext, type Player } from '../ctx';
import type { Db, UserRow } from '../db';
import type { Sim } from '../sim/api';
import { Aoi } from './aoi';
import { Chat } from './chat';
import { registerCoreCommands } from './commands';
import { EntityStoreImpl } from './entities';
import type { Logger } from './log';
import { Movement } from './movement';
import { AmbientManager } from './ambient';
import { NpcManager } from './npcs';
import { registerCoreQueries } from './persist';
import { MAX_QUEUED_COMMANDS, PlayerManager, PlayerStoreImpl, type ClientConn, type PlayerImpl } from './players';
import { Registry, SimpleEventBus } from './registry';

/** Commands executed per player per tick (the rest wait for the next tick). */
export const COMMANDS_PER_TICK = 8;
/** Sim events that gameplay `onHour` handlers care about (the rest is delivered to clients by the fan-out itself). */
const HANDLER_EVENTS: ReadonlySet<SimEvent['k']> = new Set(['siege', 'heart', 'board', 'npcDied', 'npcBorn', 'npcMoved', 'weather', 'newDay', 'newSeason']);
/** Blight patches larger than this are sent as a full map. */
const BLIGHT_FULL_THRESHOLD = 4000;

export interface GameDeps {
  world: WorldData;
  sim: Sim;
  config: Config;
  db: Db;
  log: Logger;
  now?: () => number;
  rng?: Rng;
}

export class Game {
  readonly world: WorldData;
  readonly sim: Sim;
  readonly config: Config;
  readonly db: Db;
  readonly log: Logger;
  readonly now: () => number;
  readonly rng: Rng;
  readonly grid: PathGrid;
  readonly registry: Registry;
  readonly events: SimpleEventBus;
  readonly entities: EntityStoreImpl;
  readonly players: PlayerStoreImpl;
  readonly movement: Movement;
  readonly aoi: Aoi;
  readonly npcs: NpcManager;
  readonly ambient: AmbientManager;
  readonly chat: Chat;
  readonly playerMgr: PlayerManager;
  readonly ctx: GameContext;

  constructor(deps: GameDeps) {
    this.world = deps.world;
    this.sim = deps.sim;
    this.config = deps.config;
    this.db = deps.db;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.rng = deps.rng ?? new Rng((deps.config.worldSeed ^ Date.now()) >>> 0);
    this.grid = worldPathGrid(this.world);
    this.registry = new Registry(this.log.child('systems'), this.now);
    this.events = new SimpleEventBus(this.registry);
    this.entities = new EntityStoreImpl(this.world.w, this.world.h, this.now);
    this.entities.onRemove((entity) => this.events.emit('entityRemoved', { entity }));
    this.players = new PlayerStoreImpl(this.entities);
    this.movement = new Movement(this.world, this.grid, this.entities, this.now);
    this.movement.guards.push(
      (p) => (p.combatId !== null ? 'You cannot move while fighting.' : null),
      (p) => (p.save.activity ? 'You are busy. Stop what you are doing first.' : null),
    );
    this.aoi = new Aoi(this.entities);
    this.npcs = new NpcManager({ world: this.world, grid: this.grid, sim: this.sim, entities: this.entities, movement: this.movement, rng: this.rng, log: this.log.child('npcs'), now: this.now });
    this.ambient = new AmbientManager({ world: this.world, grid: this.grid, sim: this.sim, entities: this.entities, movement: this.movement, players: this.players, rng: this.rng.fork(0xa3b1), log: this.log.child('ambient'), now: this.now });
    this.playerMgr = new PlayerManager({
      world: this.world,
      grid: this.grid,
      sim: this.sim,
      db: this.db,
      config: this.config,
      entities: this.entities,
      movement: this.movement,
      players: this.players,
      registry: this.registry,
      events: this.events,
      log: this.log.child('players'),
      now: this.now,
    });
    this.chat = new Chat({
      players: this.players,
      db: this.db,
      log: this.log.child('chat'),
      now: this.now,
      send: (p, m) => this.send(p, m),
      sendNear: (x, y, r, m) => this.sendNear(x, y, r, m),
      broadcast: (m) => this.broadcast(m),
      notify: (p, l, t) => this.notify(p, l, t),
    });
    this.ctx = this.buildContext();
    registerCoreCommands(this.ctx, { chat: this.chat, npcs: this.npcs, registry: this.registry });
    registerCoreQueries(this.ctx);
  }

  private buildContext(): GameContext {
    const r = this.registry;
    return {
      world: this.world,
      grid: this.grid,
      sim: this.sim,
      config: this.config,
      db: this.db,
      rng: this.rng,
      log: this.log.child('systems'),
      now: this.now,
      entities: this.entities,
      players: this.players,
      movement: this.movement,
      chat: this.chat,
      events: this.events,
      npcEntity: (id) => this.npcs.entityFor(id),
      fanOut: (events) => this.fanOutExtra(events),
      send: (p, m) => this.send(p, m),
      sendNear: (x, y, rad, m, except) => this.sendNear(x, y, rad, m, except),
      broadcast: (m, except) => this.broadcast(m, except),
      notify: (p, l, t) => this.notify(p, l, t),
      markMe: (p) => this.playerMgr.markMe(p as PlayerImpl),
      markDirty: (p) => {
        (p as PlayerImpl).dirty = true;
      },
      command: (t, h, o) => r.command(t, h, o),
      query: (n, h, o) => r.query(n, h, o),
      onTick: (h) => r.onTick(h),
      onHour: (h) => r.onHour(h),
      onLogin: (h) => r.onLogin(h),
      onLogout: (h) => r.onLogout(h),
      onInteract: (k, h) => r.onInteract(k, h),
      onBuildMe: (h) => r.onBuildMe(h),
      onPlayerSync: (h) => r.onPlayerSync(h),
      onSave: (h) => r.onSave(h),
      onShutdown: (h) => r.onShutdown(h),
      every: (ms, h) => r.every(ms, h),
      after: (ms, h) => r.after(ms, h),
    };
  }

  // ---- sending -----------------------------------------------------------------

  send(p: Player, msg: S2C): void {
    (p as PlayerImpl).conn?.send(msg);
  }

  sendNear(x: number, y: number, radius: number, msg: S2C, except?: Player): void {
    let json: string | null = null;
    for (const p of this.players.near(x, y, radius)) {
      if (p === except || !p.conn) continue;
      json ??= JSON.stringify(msg);
      p.conn.sendRaw(json);
    }
  }

  broadcast(msg: S2C, except?: Player): void {
    let json: string | null = null;
    for (const p of this.players.onlineIter()) {
      if (p === except || !p.conn) continue;
      json ??= JSON.stringify(msg);
      p.conn.sendRaw(json);
    }
  }

  notify(p: Player, level: NoteLevel, text: string): void {
    this.send(p, { t: 'note', level, text });
  }

  // ---- gateway-facing ----------------------------------------------------------

  /** Attach a socket. Returns null when the account has no character yet. */
  connect(conn: ClientConn, user: UserRow): PlayerImpl | null {
    return this.playerMgr.attach(conn, user);
  }

  disconnect(conn: ClientConn): void {
    this.playerMgr.detach(conn);
  }

  /** A validated message from a client. Pings and queries are answered now; commands are queued. */
  receive(p: PlayerImpl, msg: C2S): void {
    if (msg.t === 'ping') {
      this.send(p, { t: 'pong', t0: msg.t0, now: this.now() });
      return;
    }
    if (msg.t === 'q') {
      this.runQuery(p, msg.id, msg.name, msg.args);
      return;
    }
    if (p.queue.length >= MAX_QUEUED_COMMANDS) {
      this.send(p, { t: 'err', code: 'busy', text: 'Too many pending actions.' });
      return;
    }
    p.queue.push(msg);
  }

  private runQuery(p: PlayerImpl, id: number, name: QueryName, args: Queries[QueryName]['args']): void {
    const h = this.registry.queries.get(name);
    if (!h) {
      this.send(p, { t: 'res', id, ok: false, err: 'not_implemented' });
      return;
    }
    const fail = (err: unknown) => {
      if (err instanceof GameError) this.send(p, { t: 'res', id, ok: false, err: err.code, data: { text: err.message } });
      else {
        this.registry.reportError(`query:${name}`, err);
        this.send(p, { t: 'res', id, ok: false, err: 'internal' });
      }
    };
    try {
      const out = h(p, args);
      if (out instanceof Promise) out.then((data) => this.send(p, { t: 'res', id, ok: true, data }), fail);
      else this.send(p, { t: 'res', id, ok: true, data: out });
    } catch (err) {
      fail(err);
    }
  }

  private runCommand(p: PlayerImpl, msg: C2S): void {
    const h = this.registry.commands.get(msg.t);
    if (!h) {
      this.send(p, { t: 'err', code: 'not_implemented', text: `'${msg.t}' is not available yet.` });
      return;
    }
    const fail = (err: unknown) => {
      if (err instanceof GameError) this.send(p, { t: 'err', code: err.code, text: err.message });
      else {
        this.registry.reportError(`command:${msg.t}`, err);
        this.send(p, { t: 'err', code: 'internal', text: 'Something went wrong.' });
      }
    };
    try {
      const out = h(p, msg);
      if (out instanceof Promise) out.catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  private drainCommands(): void {
    for (const p of this.players.onlineIter()) {
      if (p.queue.length === 0) continue;
      const batch = p.queue.splice(0, COMMANDS_PER_TICK);
      for (const m of batch) {
        if (!p.online) break;
        this.runCommand(p, m);
      }
    }
  }

  // ---- runtime-facing ----------------------------------------------------------

  /** Boot: spawn NPCs and restore offline workers. */
  start(): void {
    this.npcs.spawnAll();
    const workers = this.playerMgr.restoreOfflineWorkers();
    this.log.info(`spawned ${this.npcs.count} NPC(s), restored ${workers} offline worker(s)`);
  }

  tick(now: number, dtMs: number): void {
    this.drainCommands();
    this.movement.update(now);
    this.npcs.tick(now);
    this.ambient.tick(now);
    this.registry.runTimers(now);
    this.registry.each('onTick', this.registry.tick, dtMs, now);
    this.playerMgr.flushMe(now);
    this.aoi.sync(this.players.onlineIter(), now);
  }

  /** Advance the sim one world hour and fan the events out to clients and systems. */
  advanceHour(now: number): SimEvent[] {
    const events = this.sim.advanceHours(1, now);
    this.fanOut(events, now);
    return events;
  }

  /** Events produced by player-driven sim calls (kills, missions, hearts, purify): same fan-out, minus the clock. */
  fanOutExtra(events: readonly SimEvent[]): void {
    if (events.length === 0) return;
    this.fanOut(events, this.now(), false);
  }

  fanOut(events: readonly SimEvent[], now: number, hourly = true): void {
    const chron: ChronicleEntry[] = [];
    const settle = new Set<number>();
    const blight = new Set<number>();
    for (const ev of events) {
      if (ev.k === 'chron') chron.push(ev.entry);
      else if (ev.k === 'settle') settle.add(ev.id);
      else if (ev.k === 'siege') settle.add(ev.settlementId);
      else if (ev.k === 'blight') for (const i of ev.idx) blight.add(i);
    }
    if (chron.length) this.broadcast({ t: 'chron', entries: chron });
    if (settle.size) {
      const list = [...settle].flatMap((id) => {
        try {
          return [this.sim.settlementView(id)];
        } catch {
          return [];
        }
      });
      if (list.length) this.broadcast({ t: 'settle', list });
    }
    if (blight.size > BLIGHT_FULL_THRESHOLD) this.broadcast({ t: 'blight', full: this.sim.blightBase64() });
    else if (blight.size) {
      const idx = [...blight].sort((a, b) => a - b);
      const map = this.sim.state.blight;
      this.broadcast({ t: 'blight', idx, val: idx.map((i) => map[i] ?? 0) });
    }
    if (hourly) this.broadcast({ t: 'time', time: this.sim.timeView(now) });
    this.npcs.onSimEvents(events);
    this.npcs.syncAll();
    // Ad-hoc batches (hourly = false) only reach the hour handlers when they carry something they react to.
    if (hourly || events.some((ev) => HANDLER_EVENTS.has(ev.k))) {
      this.registry.each('onHour', this.registry.hour, events as SimEvent[]);
      this.events.emit('hour', { events: events as SimEvent[] });
    }
  }

  /** Kick everyone (shutdown). Saves happen through each detach. */
  disconnectAll(reason: string): void {
    this.registry.each('onShutdown', this.registry.shutdown);
    for (const p of this.players.online()) {
      const conn = p.conn;
      if (!conn) continue;
      conn.send({ t: 'kick', reason });
      this.playerMgr.detach(conn);
      conn.close(1001, 'server shutting down');
    }
  }
}
