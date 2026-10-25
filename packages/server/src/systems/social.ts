/**
 * Helpers shared by the social modules (sects, masters, friends, duels). Owner: gameplay-social.
 *
 * - `findCharacter` / `mutateCharacter`: act on a character whether it is online, an offline worker held in
 *   memory, or only a row in the database (the save in memory always wins, so autosave never undoes a change).
 * - `Limiter`: small sliding-window rate limiter keyed by string.
 * - A tiny mailbox (`tellLater`) so notes for offline players are delivered on their next login.
 */
import type { CharacterSave } from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';

/** Invitations (sect, master) expire after this long. */
export const INVITE_TTL_MS = 5 * 60 * 1000;

export interface CharInfo {
  id: number;
  name: string;
  level: number;
  online: boolean;
  /** The live player, when this character is held in memory (online or offline worker). */
  live: Player | null;
}

/** Look a character up by id: memory first, then the database. */
export function findCharacter(ctx: GameContext, id: number): CharInfo | null {
  const live = ctx.players.byCharId(id);
  if (live) return { id, name: live.name, level: live.save.level, online: live.online, live };
  const row = ctx.db.get<{ id: number; name: string; level: number }>('SELECT id, name, level FROM characters WHERE id = ?', id);
  return row ? { id: row.id, name: row.name, level: row.level, online: false, live: null } : null;
}

/** Look a character up by exact (case-insensitive) name. */
export function findCharacterByName(ctx: GameContext, name: string): CharInfo | null {
  const clean = name.trim();
  if (!clean) return null;
  const live = ctx.players.byName(clean);
  if (live) return { id: live.charId, name: live.name, level: live.save.level, online: live.online, live };
  const row = ctx.db.get<{ id: number; name: string; level: number }>('SELECT id, name, level FROM characters WHERE name = ? COLLATE NOCASE', clean);
  return row ? { id: row.id, name: row.name, level: row.level, online: false, live: null } : null;
}

/**
 * Change a character's save. Live players are mutated in place (then marked dirty + `me`), others are
 * loaded, changed and written back. Returns false when the character does not exist.
 */
export function mutateCharacter(ctx: GameContext, id: number, fn: (save: CharacterSave) => void): boolean {
  const live = ctx.players.byCharId(id);
  if (live) {
    fn(live.save);
    ctx.markDirty(live);
    ctx.markMe(live);
    return true;
  }
  const rec = ctx.db.getCharacterById(id);
  if (!rec) return false;
  fn(rec.save);
  ctx.db.saveCharacter(rec.save, ctx.now());
  return true;
}

/** Sliding-window limiter: `hit(key)` returns false once `max` hits fall inside `windowMs`. */
export class Limiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly ctx: GameContext,
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): boolean {
    const now = this.ctx.now();
    const list = this.hits.get(key) ?? [];
    while (list.length && now - list[0] >= this.windowMs) list.shift();
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 2000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [k, l] of this.hits) if (!l.length || now - l[l.length - 1] >= this.windowMs) this.hits.delete(k);
  }
}

/** Throw `slow_down` when the limiter refuses. */
export function throttle(l: Limiter, key: string, text = 'Slow down a little.'): void {
  if (!l.hit(key)) throw new GameError('slow_down', text);
}

// ---------------------------------------------------------------------------
// Mailbox for offline players
// ---------------------------------------------------------------------------

const mailReady = new WeakSet<GameContext>();

/** Create the mailbox table (idempotent) and deliver pending notes on login. Call from each social module. */
export function setupMail(ctx: GameContext): void {
  if (mailReady.has(ctx)) return;
  mailReady.add(ctx);
  ctx.db.migrateModule('socialmail', ['CREATE TABLE social_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, char_id INTEGER NOT NULL, level TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL); CREATE INDEX social_mail_char ON social_mail(char_id);']);
  ctx.onLogin((p) => {
    const rows = ctx.db.all<{ id: number; level: string; text: string }>('SELECT id, level, text FROM social_mail WHERE char_id = ? ORDER BY id LIMIT 20', p.charId);
    if (!rows.length) return;
    ctx.db.run('DELETE FROM social_mail WHERE char_id = ?', p.charId);
    for (const r of rows) ctx.notify(p, r.level === 'good' || r.level === 'warn' || r.level === 'bad' ? r.level : 'info', r.text);
  });
}

/** Tell a character something: a toast now when connected, a note on next login otherwise. */
export function tellLater(ctx: GameContext, charId: number, level: 'info' | 'good' | 'warn' | 'bad', text: string): void {
  const live = ctx.players.byCharId(charId);
  if (live?.online) {
    ctx.notify(live, level, text);
    return;
  }
  setupMail(ctx);
  ctx.db.run('INSERT INTO social_mail (char_id, level, text, at) VALUES (?, ?, ?, ?)', charId, level, text.slice(0, 300), ctx.now());
  // Keep the box small.
  ctx.db.run('DELETE FROM social_mail WHERE char_id = ? AND id NOT IN (SELECT id FROM social_mail WHERE char_id = ? ORDER BY id DESC LIMIT 20)', charId, charId);
}
