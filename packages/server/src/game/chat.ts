/**
 * Chat channels (local, world, whisper, sect, system), text sanitising, mutes and a few admin
 * slash commands. Clients derive speech bubbles from `chat` messages that carry `fromId`
 * (the speaker's entity id).
 */
import { CLOSE_BANNED, LOCAL_CHAT_RADIUS, MAX_CHAT_LENGTH, type ChatChannel, type ChatMsg, type S2C } from '@murim/shared';
import type { ChatApi, Player } from '../ctx';
import type { Db } from '../db';
import { TokenBucket } from '../net/ratelimit';
import type { Logger } from './log';
import type { PlayerImpl, PlayerStoreImpl } from './players';

export const WORLD_CHAT_INTERVAL_MS = 3000;
const MAX_MUTE_MINUTES = 7 * 24 * 60;

const INVISIBLE = /[\u00ad\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const CONTROL = /\p{Cc}/gu;
const PROFANITY = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'asshole', 'retard', 'motherfucker'];
const PROFANITY_RE = new RegExp(`\\b(?:${PROFANITY.join('|')})[a-z]*`, 'gi');

/** Replace listed words (and their inflections) with asterisks. */
export function maskProfanity(text: string): string {
  return text.replace(PROFANITY_RE, (w) => '*'.repeat(w.length));
}

/** Control chars and invisible formatting removed, whitespace collapsed, trimmed, capped (code points), masked. */
export function sanitizeText(text: string, maxLen = MAX_CHAT_LENGTH): string {
  let s = text.normalize('NFC').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/gu, ' ').trim();
  const chars = Array.from(s);
  if (chars.length > maxLen) s = chars.slice(0, maxLen).join('').trimEnd();
  return maskProfanity(s);
}

export interface ChatDeps {
  players: PlayerStoreImpl;
  db: Db;
  log: Logger;
  now: () => number;
  send(p: Player, msg: S2C): void;
  sendNear(x: number, y: number, radius: number, msg: S2C): void;
  broadcast(msg: S2C): void;
  notify(p: Player, level: 'info' | 'good' | 'warn' | 'bad', text: string): void;
}

export class Chat implements ChatApi {
  private sectResolver: (sectId: number) => Player[] = (sectId) => this.d.players.online().filter((p) => p.save.sectId === sectId);
  private readonly buckets = new WeakMap<Player, TokenBucket>();

  constructor(private readonly d: ChatDeps) {}

  clean(text: string, maxLen = MAX_CHAT_LENGTH): string {
    return sanitizeText(text, maxLen);
  }

  system(text: string, to?: Player): void {
    const msg: S2C = { t: 'chat', msg: { ch: 'system', from: 'System', text, t: this.d.now() } };
    if (to) this.d.send(to, msg);
    else this.d.broadcast(msg);
  }

  toSect(sectId: number, msg: ChatMsg): void {
    const out: S2C = { t: 'chat', msg };
    for (const p of this.sectResolver(sectId)) if (p.online) this.d.send(p, out);
  }

  setSectResolver(fn: (sectId: number) => Player[]): void {
    this.sectResolver = fn;
  }

  /** The `chat` command. */
  handle(p: PlayerImpl, ch: Exclude<ChatChannel, 'system'>, rawText: string, to?: string): void {
    const now = this.d.now();
    const text = sanitizeText(rawText);
    if (!text) return;
    if (text.startsWith('/')) {
      this.slash(p, text);
      return;
    }
    if (p.mutedUntil > now) {
      this.d.notify(p, 'warn', `You are muted for ${Math.ceil((p.mutedUntil - now) / 60000)} more minute(s).`);
      return;
    }
    let bucket = this.buckets.get(p);
    if (!bucket) {
      bucket = new TokenBucket(1, 5, now);
      this.buckets.set(p, bucket);
    }
    if (!bucket.take(now)) {
      this.d.notify(p, 'warn', 'You are sending messages too quickly.');
      return;
    }
    const msg: ChatMsg = { ch, from: p.name, fromId: p.entity.id, text, t: now };
    if (p.entity.tag) msg.tag = p.entity.tag;
    switch (ch) {
      case 'local':
        this.d.sendNear(p.entity.x, p.entity.y, LOCAL_CHAT_RADIUS, { t: 'chat', msg });
        return;
      case 'world':
        if (now - p.lastWorldChat < WORLD_CHAT_INTERVAL_MS) {
          this.d.notify(p, 'warn', 'World chat: one message every 3 seconds.');
          return;
        }
        p.lastWorldChat = now;
        this.d.broadcast({ t: 'chat', msg });
        return;
      case 'whisper': {
        const target = to ? this.d.players.byName(to) : undefined;
        if (!target || !target.online) {
          this.d.notify(p, 'warn', `${to ? `"${sanitizeText(to, 24)}"` : 'That player'} is not online.`);
          return;
        }
        if (target === p) {
          this.d.notify(p, 'info', 'You mutter to yourself.');
          return;
        }
        msg.to = target.name;
        this.d.send(target, { t: 'chat', msg });
        this.d.send(p, { t: 'chat', msg });
        return;
      }
      case 'sect':
        if (p.save.sectId === null || p.save.sectId === undefined) {
          this.d.notify(p, 'warn', 'You are not in a sect.');
          return;
        }
        this.toSect(p.save.sectId, msg);
        return;
    }
  }

  /** Admin slash commands: /mute name [minutes], /unmute name, /kick name, /ban name, /announce text. */
  private slash(p: PlayerImpl, text: string): void {
    const [cmd, ...rest] = text.slice(1).split(' ');
    if (!p.isAdmin) {
      this.d.notify(p, 'info', 'Unknown command.');
      return;
    }
    const name = rest[0] ?? '';
    const now = this.d.now();
    switch (cmd.toLowerCase()) {
      case 'announce':
        if (rest.length) this.system(rest.join(' '));
        return;
      case 'mute':
      case 'unmute': {
        const minutes = cmd.toLowerCase() === 'unmute' ? 0 : Math.min(MAX_MUTE_MINUTES, Math.max(1, Number(rest[1]) || 10));
        const until = minutes ? now + minutes * 60000 : 0;
        const userId = this.userIdFor(name);
        if (userId === null) break;
        this.d.db.setUserMutedUntil(userId, until);
        const target = this.d.players.byUserId(userId);
        if (target) {
          target.mutedUntil = until;
          if (target.online) this.d.notify(target, 'warn', minutes ? `You have been muted for ${minutes} minute(s).` : 'You are no longer muted.');
        }
        this.d.notify(p, 'good', minutes ? `${name} muted for ${minutes} minute(s).` : `${name} unmuted.`);
        this.d.log.info(`admin ${p.username} ${cmd} ${name} ${minutes}`);
        return;
      }
      case 'kick':
      case 'ban': {
        const userId = this.userIdFor(name);
        if (userId === null) break;
        const ban = cmd.toLowerCase() === 'ban';
        if (ban) {
          this.d.db.setUserBanned(userId, true);
          this.d.db.deleteUserSessions(userId);
        }
        const target = this.d.players.byUserId(userId);
        if (target?.conn) {
          target.conn.send({ t: 'kick', reason: ban ? 'You have been banned.' : 'You have been kicked.' });
          target.conn.close(ban ? CLOSE_BANNED : 1000, ban ? 'banned' : 'kicked');
        }
        this.d.notify(p, 'good', `${name} ${ban ? 'banned' : 'kicked'}.`);
        this.d.log.info(`admin ${p.username} ${cmd} ${name}`);
        return;
      }
      default:
        this.d.notify(p, 'info', 'Unknown command.');
        return;
    }
    this.d.notify(p, 'warn', `No character named "${name}".`);
  }

  private userIdFor(charName: string): number | null {
    if (!charName) return null;
    const online = this.d.players.byName(charName);
    if (online) return online.userId;
    return this.d.db.getCharacterByName(charName)?.userId ?? null;
  }
}

/**
 * Deliver a sect chat line to every online member. Sects themselves live in a later system; that
 * system can call this (or `ctx.chat.setSectResolver`) so the `chat` command's 'sect' channel works.
 */
export function chatToSect(chat: ChatApi, sectId: number, msg: ChatMsg): void {
  chat.toSect(sectId, msg);
}
