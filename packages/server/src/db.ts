/**
 * Persistence layer. Everything outside this file talks to the `Db` interface only, so the
 * SQLite implementation (node:sqlite, synchronous) can be swapped for Postgres later.
 *
 * Schema changes: append a new SQL string to `migrations` (never edit an applied one).
 * Gameplay modules that need their own tables call `db.migrateModule('sects', [...])` from their
 * `register()`; each module's list is versioned independently in `schema_version`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { CharacterSave } from '@murim/shared';

export type SqlValue = null | number | bigint | string | Uint8Array;

/** Core schema. Index + 1 is the schema version. Append only. */
export const migrations: string[] = [
  // 1: accounts, sessions, characters, key/value store, pending creation rolls
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    banned INTEGER NOT NULL DEFAULT 0,
    last_login INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    level INTEGER NOT NULL DEFAULT 1,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE pending_rolls (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    rerolls_used INTEGER NOT NULL DEFAULT 0
  );
  `,
  // 2: chat mutes, denormalised columns for leaderboards and offline-worker restore
  `
  ALTER TABLE users ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN kills INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN has_activity INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX characters_rank ON characters(level DESC, xp DESC);
  CREATE INDEX characters_activity ON characters(has_activity) WHERE has_activity = 1;
  `,
];

export interface UserRow {
  id: number;
  username: string;
  passHash: string;
  salt: string;
  createdAt: number;
  banned: boolean;
  lastLogin: number;
  mutedUntil: number;
}

export interface SessionRow {
  tokenHash: string;
  userId: number;
  expiresAt: number;
}

export interface CharacterRecord {
  id: number;
  userId: number;
  name: string;
  level: number;
  save: CharacterSave;
  createdAt: number;
  updatedAt: number;
  lastSeen: number;
}

export interface PendingRollRow {
  userId: number;
  json: string;
  rerollsUsed: number;
}

export type CreateCharacterResult = { ok: true; save: CharacterSave } | { ok: false; conflict: 'name' | 'user' };

export interface Db {
  // ---- users ----------------------------------------------------------------
  /** Returns null when the username is taken (case-insensitive). */
  createUser(username: string, passHash: string, salt: string, now: number): UserRow | null;
  getUserById(id: number): UserRow | undefined;
  getUserByName(username: string): UserRow | undefined;
  setUserLastLogin(id: number, now: number): void;
  setUserBanned(id: number, banned: boolean): void;
  setUserMutedUntil(id: number, until: number): void;

  // ---- sessions (only SHA-256 of the token is stored) -------------------------
  createSession(tokenHash: string, userId: number, expiresAt: number): void;
  getSession(tokenHash: string): SessionRow | undefined;
  extendSession(tokenHash: string, expiresAt: number): void;
  deleteSession(tokenHash: string): void;
  deleteUserSessions(userId: number): void;
  purgeExpiredSessions(now: number): number;

  // ---- characters --------------------------------------------------------------
  getCharacterByUser(userId: number): CharacterRecord | undefined;
  getCharacterById(id: number): CharacterRecord | undefined;
  getCharacterByName(name: string): CharacterRecord | undefined;
  isNameTaken(name: string): boolean;
  /** Inserts a row, then calls `build(id)` to produce the save (inside one transaction). */
  createCharacter(userId: number, name: string, build: (id: number) => CharacterSave, now: number): CreateCharacterResult;
  saveCharacter(save: CharacterSave, now: number): void;
  /** Saves many characters in one transaction. */
  saveCharacters(saves: readonly CharacterSave[], now: number): void;
  /** Characters with a running activity (offline workers), most recently seen first. */
  listCharactersWithActivity(limit: number): CharacterRecord[];
  /** Leaderboard order: level, then xp. */
  topCharacters(limit: number): CharacterRecord[];

  // ---- character creation rolls -----------------------------------------------------
  getPendingRoll(userId: number): PendingRollRow | undefined;
  setPendingRoll(userId: number, json: string, rerollsUsed: number): void;
  deletePendingRoll(userId: number): void;

  // ---- key/value (world snapshots, misc server state) -----------------------------
  kvGet(key: string): string | undefined;
  kvSet(key: string, value: string): void;
  kvDelete(key: string): void;

  // ---- escape hatch for gameplay modules -------------------------------------------
  /** Apply a module's own append-only migration list (tracked as `name` in schema_version). */
  migrateModule(name: string, moduleMigrations: readonly string[]): void;
  /** Run a statement. Prefer writing small typed repository functions around these. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number };
  /** First row or undefined. `T` is not checked at runtime: map columns yourself if unsure. */
  get<T extends object>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T extends object>(sql: string, ...params: SqlValue[]): T[];
  /** Run `fn` in a transaction (nested calls join the outer one). */
  transaction<T>(fn: () => T): T;
  /** Current core schema version. */
  schemaVersion(name?: string): number;
  close(): void;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));

function isUniqueViolation(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { errcode?: number }).errcode;
  return code === 2067 || code === 1555 || /UNIQUE constraint failed/i.test(err.message);
}

function mapUser(r: Row): UserRow {
  return {
    id: num(r.id),
    username: str(r.username),
    passHash: str(r.pass_hash),
    salt: str(r.salt),
    createdAt: num(r.created_at),
    banned: num(r.banned) !== 0,
    lastLogin: num(r.last_login),
    mutedUntil: num(r.muted_until),
  };
}

function mapCharacter(r: Row): CharacterRecord {
  const save = JSON.parse(str(r.json)) as CharacterSave;
  save.id = num(r.id);
  save.name = str(r.name);
  return {
    id: num(r.id),
    userId: num(r.user_id),
    name: str(r.name),
    level: num(r.level),
    save,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    lastSeen: num(r.last_seen),
  };
}

export class SqliteDb implements Db {
  private readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (name TEXT PRIMARY KEY, version INTEGER NOT NULL);');
    this.applyMigrations('core', migrations);
  }

  // ---- internals ----------------------------------------------------------------

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private row(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.stmt(sql).get(...params) as Row | undefined;
  }

  private rows(sql: string, ...params: SqlValue[]): Row[] {
    return this.stmt(sql).all(...params) as Row[];
  }

  private applyMigrations(name: string, list: readonly string[]): void {
    const current = this.schemaVersion(name);
    for (let v = current; v < list.length; v++) {
      this.transaction(() => {
        this.db.exec(list[v]);
        this.stmt('INSERT INTO schema_version (name, version) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version').run(name, v + 1);
      });
    }
  }

  // ---- generic -------------------------------------------------------------------

  schemaVersion(name = 'core'): number {
    const r = this.row('SELECT version FROM schema_version WHERE name = ?', name);
    return r ? num(r.version) : 0;
  }

  migrateModule(name: string, moduleMigrations: readonly string[]): void {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(name) || name === 'core') throw new Error(`db: invalid migration module name "${name}"`);
    this.applyMigrations(name, moduleMigrations);
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: num(r.changes), lastInsertRowid: num(r.lastInsertRowid) };
  }

  get<T extends object>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.row(sql, ...params) as T | undefined;
  }

  all<T extends object>(sql: string, ...params: SqlValue[]): T[] {
    return this.rows(sql, ...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  close(): void {
    this.stmts.clear();
    if (this.db.isOpen) this.db.close();
  }

  // ---- users ------------------------------------------------------------------------

  createUser(username: string, passHash: string, salt: string, now: number): UserRow | null {
    try {
      const r = this.run('INSERT INTO users (username, pass_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)', username, passHash, salt, now, now);
      return this.getUserById(r.lastInsertRowid) ?? null;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  getUserById(id: number): UserRow | undefined {
    const r = this.row('SELECT * FROM users WHERE id = ?', id);
    return r ? mapUser(r) : undefined;
  }

  getUserByName(username: string): UserRow | undefined {
    const r = this.row('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
    return r ? mapUser(r) : undefined;
  }

  setUserLastLogin(id: number, now: number): void {
    this.run('UPDATE users SET last_login = ? WHERE id = ?', now, id);
  }

  setUserBanned(id: number, banned: boolean): void {
    this.run('UPDATE users SET banned = ? WHERE id = ?', banned ? 1 : 0, id);
  }

  setUserMutedUntil(id: number, until: number): void {
    this.run('UPDATE users SET muted_until = ? WHERE id = ?', until, id);
  }

  // ---- sessions ------------------------------------------------------------------------

  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash, userId, expiresAt);
  }

  getSession(tokenHash: string): SessionRow | undefined {
    const r = this.row('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
    return r ? { tokenHash: str(r.token_hash), userId: num(r.user_id), expiresAt: num(r.expires_at) } : undefined;
  }

  extendSession(tokenHash: string, expiresAt: number): void {
    this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteUserSessions(userId: number): void {
    this.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  purgeExpiredSessions(now: number): number {
    return this.run('DELETE FROM sessions WHERE expires_at <= ?', now).changes;
  }

  // ---- characters ----------------------------------------------------------------------

  getCharacterByUser(userId: number): CharacterRecord | undefined {
    const r = this.row('SELECT * FROM characters WHERE user_id = ?', userId);
    return r ? mapCharacter(r) : undefined;
  }

  getCharacterById(id: number): CharacterRecord | undefined {
    const r = this.row('SELECT * FROM characters WHERE id = ?', id);
    return r ? mapCharacter(r) : undefined;
  }

  getCharacterByName(name: string): CharacterRecord | undefined {
    const r = this.row('SELECT * FROM characters WHERE name = ? COLLATE NOCASE', name);
    return r ? mapCharacter(r) : undefined;
  }

  isNameTaken(name: string): boolean {
    return !!this.row('SELECT 1 AS x FROM characters WHERE name = ? COLLATE NOCASE', name);
  }

  createCharacter(userId: number, name: string, build: (id: number) => CharacterSave, now: number): CreateCharacterResult {
    try {
      return this.transaction(() => {
        const r = this.run('INSERT INTO characters (user_id, name, level, json, created_at, updated_at, last_seen) VALUES (?, ?, 1, ?, ?, ?, ?)', userId, name, '{}', now, now, now);
        const save = build(r.lastInsertRowid);
        save.id = r.lastInsertRowid;
        save.name = name;
        this.saveCharacter(save, now);
        return { ok: true as const, save };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, conflict: /user_id/.test(err.message) ? 'user' : 'name' };
      throw err;
    }
  }

  saveCharacter(save: CharacterSave, now: number): void {
    this.run(
      'UPDATE characters SET level = ?, xp = ?, kills = ?, has_activity = ?, json = ?, updated_at = ?, last_seen = ? WHERE id = ?',
      save.level,
      Math.floor(save.xp),
      save.kills,
      save.activity ? 1 : 0,
      JSON.stringify(save),
      now,
      save.lastSeen,
      save.id,
    );
  }

  saveCharacters(saves: readonly CharacterSave[], now: number): void {
    if (saves.length === 0) return;
    this.transaction(() => {
      for (const s of saves) this.saveCharacter(s, now);
    });
  }

  listCharactersWithActivity(limit: number): CharacterRecord[] {
    return this.rows('SELECT * FROM characters WHERE has_activity = 1 ORDER BY last_seen DESC LIMIT ?', limit).map(mapCharacter);
  }

  topCharacters(limit: number): CharacterRecord[] {
    return this.rows('SELECT * FROM characters ORDER BY level DESC, xp DESC, id ASC LIMIT ?', limit).map(mapCharacter);
  }

  // ---- pending rolls -----------------------------------------------------------------------

  getPendingRoll(userId: number): PendingRollRow | undefined {
    const r = this.row('SELECT * FROM pending_rolls WHERE user_id = ?', userId);
    return r ? { userId: num(r.user_id), json: str(r.json), rerollsUsed: num(r.rerolls_used) } : undefined;
  }

  setPendingRoll(userId: number, json: string, rerollsUsed: number): void {
    this.run(
      'INSERT INTO pending_rolls (user_id, json, rerolls_used) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, rerolls_used = excluded.rerolls_used',
      userId,
      json,
      rerollsUsed,
    );
  }

  deletePendingRoll(userId: number): void {
    this.run('DELETE FROM pending_rolls WHERE user_id = ?', userId);
  }

  // ---- kv --------------------------------------------------------------------------------------

  kvGet(key: string): string | undefined {
    const r = this.row('SELECT value FROM kv WHERE key = ?', key);
    return r ? str(r.value) : undefined;
  }

  kvSet(key: string, value: string): void {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  kvDelete(key: string): void {
    this.run('DELETE FROM kv WHERE key = ?', key);
  }
}

export function openDb(file: string): Db {
  return new SqliteDb(file);
}
