/**
 * Persistence scheduling (character autosave, world snapshots) and the core read-only queries:
 * world, chronicle, player, leaderboard, nearbyPlayers.
 */
import { AOI_RADIUS, rankOf, type ChronicleEntry, type LeaderEntry, type PublicProfile } from '@murim/shared';
import type { GameContext, Player } from '../ctx';
import type { Db } from '../db';
import type { SerializedSim, Sim } from '../sim/api';
import type { Logger } from './log';
import type { PlayerManager } from './players';

export const SIM_SNAPSHOT_KEY = 'sim.snapshot';
export const SIM_STUB_SNAPSHOT_KEY = 'sim.stub.snapshot';

interface StoredSim {
  seed: number;
  savedAt: number;
  sim: SerializedSim;
}

export interface LoadedSnapshot {
  saved: SerializedSim;
  savedAt: number;
}

/** Read a stored sim snapshot; null when missing, corrupt, or made for a different seed. */
export function loadSimSnapshot(db: Db, key: string, seed: number, log: Logger): LoadedSnapshot | null {
  const raw = db.kvGet(key);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StoredSim>;
    if (s.seed !== seed) {
      log.warn(`stored world snapshot is for seed ${String(s.seed)}, not ${seed}: starting a fresh world`);
      return null;
    }
    if (!s.sim || typeof s.sim.json !== 'string' || typeof s.sim.blight !== 'string' || typeof s.savedAt !== 'number') throw new Error('malformed snapshot');
    return { saved: s.sim, savedAt: s.savedAt };
  } catch (err) {
    log.error('world snapshot is unreadable; backing it up and starting fresh', err);
    db.kvSet(`${key}.corrupt.${Date.now()}`, raw);
    db.kvDelete(key);
    return null;
  }
}

export function saveSimSnapshot(db: Db, key: string, sim: Sim, seed: number, now: number): void {
  const stored: StoredSim = { seed, savedAt: now, sim: sim.serialize() };
  db.kvSet(key, JSON.stringify(stored));
}

export interface PersistDeps {
  db: Db;
  sim: Sim;
  players: PlayerManager;
  log: Logger;
  seed: number;
  snapshotKey: string;
  autosaveMs: number;
  worldSaveMs: number;
}

/** Called from the tick loop; decides when to write. */
export class Persistence {
  private nextAutosave: number;
  private nextWorldSave: number;

  constructor(
    private readonly d: PersistDeps,
    now: number,
  ) {
    this.nextAutosave = now + d.autosaveMs;
    this.nextWorldSave = now + d.worldSaveMs;
  }

  tick(now: number): void {
    if (now >= this.nextAutosave) {
      this.nextAutosave = now + this.d.autosaveMs;
      const n = this.d.players.saveDirty();
      if (n) this.d.log.debug(`autosaved ${n} character(s)`);
    }
    if (now >= this.nextWorldSave) {
      this.nextWorldSave = now + this.d.worldSaveMs;
      this.saveWorld(now);
    }
  }

  saveWorld(now: number): void {
    try {
      const t0 = performance.now();
      saveSimSnapshot(this.d.db, this.d.snapshotKey, this.d.sim, this.d.seed, now);
      this.d.log.debug(`world snapshot saved in ${(performance.now() - t0).toFixed(1)} ms`);
    } catch (err) {
      this.d.log.error('world snapshot failed', err);
    }
  }

  /** Shutdown: every character and the world. */
  saveAll(now: number): void {
    const n = this.d.players.saveDirty(true);
    this.d.log.info(`saved ${n} character(s)`);
    this.saveWorld(now);
  }
}

// ---------------------------------------------------------------------------
// Core queries
// ---------------------------------------------------------------------------

const LEADERBOARD_SIZE = 50;
const LEADERBOARD_TTL_MS = 30000;
const CHRONICLE_PAGE_MAX = 100;

function profileOf(save: Player['save']): PublicProfile {
  return {
    id: save.id,
    name: save.name,
    level: save.level,
    look: save.look,
    title: save.title,
    sect: null,
    kills: save.kills,
    deaths: save.deaths,
    equipment: save.equipment,
    stats: save.stats,
    rank: rankOf(save.level),
  };
}

/** Page through the chronicle: entries with id < before (newest last), at most `limit`. */
export function chroniclePage(all: readonly ChronicleEntry[], before?: number, limit = 40): ChronicleEntry[] {
  const asked = Math.floor(limit);
  const n = Number.isFinite(asked) && asked >= 1 ? Math.min(CHRONICLE_PAGE_MAX, asked) : 40;
  let end = all.length;
  if (before !== undefined) {
    // Entries are appended in id order; binary search the cut.
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].id < before) lo = mid + 1;
      else hi = mid;
    }
    end = lo;
  }
  return all.slice(Math.max(0, end - n), end);
}

export function registerCoreQueries(ctx: GameContext): void {
  let board: { at: number; list: LeaderEntry[] } | null = null;

  ctx.query('world', () => ctx.sim.worldInfo(ctx.players.onlineCount(), ctx.now()));

  ctx.query('chronicle', (_p, args) => chroniclePage(ctx.sim.state.chronicle, args.before, args.limit));

  ctx.query('player', (_p, args) => {
    if (args.id !== undefined) {
      const live = ctx.players.byCharId(args.id);
      if (live) return profileOf(live.save);
      const rec = ctx.db.getCharacterById(args.id);
      return rec ? profileOf(rec.save) : null;
    }
    if (args.name !== undefined) {
      const live = ctx.players.byName(args.name);
      if (live) return profileOf(live.save);
      const rec = ctx.db.getCharacterByName(args.name.trim());
      return rec ? profileOf(rec.save) : null;
    }
    return null;
  });

  ctx.query('leaderboard', () => {
    const now = ctx.now();
    if (!board || now - board.at > LEADERBOARD_TTL_MS) {
      // Fold in live data so online players are never shown stale.
      const list = ctx.db.topCharacters(LEADERBOARD_SIZE).map((r) => ctx.players.byCharId(r.id)?.save ?? r.save);
      board = { at: now, list: list.map((s) => ({ id: s.id, name: s.name, level: s.level, kills: s.kills, sect: null })) };
    }
    return board.list;
  });

  ctx.query('nearbyPlayers', (p) => {
    const { x, y } = p.entity;
    return ctx.players
      .near(x, y, AOI_RADIUS)
      .filter((o) => o !== p)
      .map((o) => ({ o, d: (o.entity.x - x) ** 2 + (o.entity.y - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 50)
      .map(({ o }) => ({ id: o.charId, name: o.name, level: o.save.level, entity: o.entity.id }));
  });
}
