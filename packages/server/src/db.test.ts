import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Rng, newCharacterSave, randomLook, rollCharacter } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { migrations, openDb } from './db';

function save(id: number, name: string) {
  const rng = new Rng(id);
  return newCharacterSave({ id, name, look: randomLook(rng), roll: rollCharacter(rng), homeSettlement: 0, spawn: { x: 5, y: 5 }, now: 1000, rerolls: 0 });
}

describe('migrations', () => {
  it('applies all core migrations once and tracks the version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murim-db-'));
    const file = path.join(dir, 'nested', 'test.db');
    const a = openDb(file);
    expect(a.schemaVersion()).toBe(migrations.length);
    a.kvSet('k', 'v');
    a.close();
    const b = openDb(file);
    expect(b.schemaVersion()).toBe(migrations.length);
    expect(b.kvGet('k')).toBe('v');
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the documented tables with WAL and foreign keys', () => {
    const db = openDb(':memory:');
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of ['users', 'sessions', 'characters', 'kv', 'pending_rolls', 'schema_version']) expect(tables).toContain(t);
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    db.close();
  });

  it('lets modules append their own versioned migrations', () => {
    const db = openDb(':memory:');
    db.migrateModule('sects', ['CREATE TABLE sects (id INTEGER PRIMARY KEY, name TEXT)']);
    expect(db.schemaVersion('sects')).toBe(1);
    db.migrateModule('sects', ['CREATE TABLE sects (id INTEGER PRIMARY KEY, name TEXT)', 'ALTER TABLE sects ADD COLUMN tag TEXT']);
    expect(db.schemaVersion('sects')).toBe(2);
    db.run('INSERT INTO sects (name, tag) VALUES (?, ?)', 'Azure', 'AZ');
    expect(db.get<{ tag: string }>('SELECT tag FROM sects')?.tag).toBe('AZ');
    expect(() => db.migrateModule('core', [])).toThrow();
    expect(() => db.migrateModule('Bad Name!', [])).toThrow();
    db.close();
  });

  it('rolls back a failing migration step', () => {
    const db = openDb(':memory:');
    expect(() => db.migrateModule('broken', ['CREATE TABLE ok1 (a INTEGER); CREATE TABLE ok1 (a INTEGER);'])).toThrow();
    expect(db.schemaVersion('broken')).toBe(0);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'ok1'")).toBeUndefined();
    db.close();
  });
});

describe('repositories', () => {
  it('users are unique case-insensitively', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Alice', 'h', 's', 5)!;
    expect(u.username).toBe('Alice');
    expect(db.createUser('ALICE', 'h', 's', 5)).toBeNull();
    expect(db.getUserByName('aLiCe')?.id).toBe(u.id);
    db.setUserBanned(u.id, true);
    db.setUserMutedUntil(u.id, 99);
    expect(db.getUserById(u.id)).toMatchObject({ banned: true, mutedUntil: 99 });
    db.close();
  });

  it('sessions expire and are purged', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Bob', 'h', 's', 5)!;
    db.createSession('aaa', u.id, 100);
    db.createSession('bbb', u.id, 300);
    expect(db.purgeExpiredSessions(200)).toBe(1);
    expect(db.getSession('aaa')).toBeUndefined();
    db.extendSession('bbb', 900);
    expect(db.getSession('bbb')?.expiresAt).toBe(900);
    db.deleteUserSessions(u.id);
    expect(db.getSession('bbb')).toBeUndefined();
    db.close();
  });

  it('characters: one per user, unique names, round-trip, leaderboard order', () => {
    const db = openDb(':memory:');
    const u1 = db.createUser('One', 'h', 's', 5)!;
    const u2 = db.createUser('Two', 'h', 's', 5)!;
    const r1 = db.createCharacter(u1.id, 'Han', (id) => save(id, 'Han'), 10);
    expect(r1.ok).toBe(true);
    expect(db.createCharacter(u1.id, 'Other', (id) => save(id, 'Other'), 10)).toEqual({ ok: false, conflict: 'user' });
    expect(db.createCharacter(u2.id, 'hAN', (id) => save(id, 'hAN'), 10)).toEqual({ ok: false, conflict: 'name' });
    // A failed create must not leave a half-built row behind.
    expect(db.getCharacterByUser(u2.id)).toBeUndefined();
    expect(db.isNameTaken('HAN')).toBe(true);

    const rec = db.getCharacterByUser(u1.id)!;
    expect(rec.save.name).toBe('Han');
    expect(rec.save.id).toBe(rec.id);
    rec.save.level = 7;
    rec.save.xp = 123;
    rec.save.activity = { kind: 'train', since: 1, settled: 1, site: 's' };
    db.saveCharacter(rec.save, 50);
    const again = db.getCharacterById(rec.id)!;
    expect(again.level).toBe(7);
    expect(again.save.activity?.kind).toBe('train');
    expect(db.listCharactersWithActivity(10).map((c) => c.id)).toEqual([rec.id]);

    const r2 = db.createCharacter(u2.id, 'Lee', (id) => save(id, 'Lee'), 10);
    expect(r2.ok).toBe(true);
    expect(db.topCharacters(5).map((c) => c.name)).toEqual(['Han', 'Lee']);
    db.close();
  });

  it('pending rolls and kv upserts', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Roller', 'h', 's', 5)!;
    expect(db.getPendingRoll(u.id)).toBeUndefined();
    db.setPendingRoll(u.id, '{"a":1}', 0);
    db.setPendingRoll(u.id, '{"a":2}', 1);
    expect(db.getPendingRoll(u.id)).toEqual({ userId: u.id, json: '{"a":2}', rerollsUsed: 1 });
    db.deletePendingRoll(u.id);
    expect(db.getPendingRoll(u.id)).toBeUndefined();
    db.kvSet('a', '1');
    db.kvSet('a', '2');
    expect(db.kvGet('a')).toBe('2');
    db.kvDelete('a');
    expect(db.kvGet('a')).toBeUndefined();
    db.close();
  });

  it('deleting a user cascades to sessions, characters and rolls', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Gone', 'h', 's', 5)!;
    db.createSession('t', u.id, 999);
    db.setPendingRoll(u.id, '{}', 0);
    db.createCharacter(u.id, 'Gonehero', (id) => save(id, 'Gonehero'), 1);
    db.run('DELETE FROM users WHERE id = ?', u.id);
    expect(db.getSession('t')).toBeUndefined();
    expect(db.getPendingRoll(u.id)).toBeUndefined();
    expect(db.getCharacterByUser(u.id)).toBeUndefined();
    db.close();
  });

  it('nested transactions join the outer one and roll back together', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.transaction(() => {
        db.kvSet('x', '1');
        db.transaction(() => db.kvSet('y', '2'));
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(db.kvGet('x')).toBeUndefined();
    expect(db.kvGet('y')).toBeUndefined();
    db.transaction(() => db.kvSet('z', '3'));
    expect(db.kvGet('z')).toBe('3');
    db.close();
  });
});
