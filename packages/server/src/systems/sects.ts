/**
 * Player sects: founding, roles, invitations, treasury, sect level + XP bonus, sect chat, `[TAG]` over names.
 * Owner: gameplay-social. Rules: docs/GAMEPLAY_SPEC.md section 9; formats: docs/notes/gameplay-social.md.
 *
 * Source of truth is the database (`sects`, `sect_members`); an in-memory mirror serves the hot paths
 * (`me` views, entity tags, XP multiplier). `save.sectId` is kept in sync, and re-synced on every save and
 * login (self-healing) because offline members are updated through their database row.
 */
import {
  rankOf,
  type LeaderEntry,
  type PublicProfile,
  type SectMember,
  type SectRole,
  type SectView,
} from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { getServices } from './services';
import { Limiter, findCharacter, findCharacterByName, mutateCharacter, setupMail, tellLater, throttle, INVITE_TTL_MS } from './social';
import './events';

export const SECT_CREATE_GOLD = 500;
export const SECT_CREATE_RANK = 2;
export const SECT_MAX_MEMBERS = 50;
export const SECT_XP_PER_LEVEL = 0.02;
export const SECT_MAX_LEVEL = 10;
export const SECT_MAX_REQUESTS = 20;
const MOTTO_MAX = 120;
const LEVEL_TTL_MS = 30_000;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u;
const TAG_RE = /^[A-Za-z]{2,4}$/;
const ROLE_ORDER: Record<SectRole, number> = { leader: 3, elder: 2, disciple: 1, outer: 0 };
const ROLES: readonly SectRole[] = ['leader', 'elder', 'disciple', 'outer'];

/** Sect level from the sum of member levels. */
export function sectLevelFor(totalMemberLevels: number): number {
  return Math.min(SECT_MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, totalMemberLevels)) / 2));
}

interface SectRow {
  id: number;
  name: string;
  tag: string;
  motto: string;
  treasury: number;
  founded: number;
}

interface Pending {
  sectId: number;
  charId: number;
  kind: 'invite' | 'request';
  by: number;
  expires: number;
}

/** Read-only view of the sect state for other modules and tests. */
export interface SectsApi {
  roleOf(charId: number): SectRole | null;
  sectIdOf(charId: number): number | null;
  levelOf(sectId: number): number;
  xpBonus(p: Player): number;
}

const apis = new WeakMap<GameContext, SectsApi>();
export function getSectsApi(ctx: GameContext): SectsApi | undefined {
  return apis.get(ctx);
}

export function register(ctx: GameContext): void {
  setupMail(ctx);
  ctx.db.migrateModule('sects', [
    `CREATE TABLE sects (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL UNIQUE COLLATE NOCASE,
       tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
       motto TEXT NOT NULL DEFAULT '',
       treasury INTEGER NOT NULL DEFAULT 0,
       founded INTEGER NOT NULL
     );
     CREATE TABLE sect_members (
       char_id INTEGER PRIMARY KEY,
       sect_id INTEGER NOT NULL REFERENCES sects(id) ON DELETE CASCADE,
       role TEXT NOT NULL,
       joined INTEGER NOT NULL
     );
     CREATE INDEX sect_members_sect ON sect_members(sect_id);`,
  ]);

  const sects = new Map<number, SectRow>();
  const members = new Map<number, { sectId: number; role: SectRole }>();
  const pending = new Map<string, Pending>();
  const levelCache = new Map<number, { level: number; at: number }>();

  const load = (): void => {
    sects.clear();
    members.clear();
    for (const r of ctx.db.all<{ id: number; name: string; tag: string; motto: string; treasury: number; founded: number }>('SELECT * FROM sects')) {
      sects.set(Number(r.id), { id: Number(r.id), name: r.name, tag: r.tag, motto: r.motto, treasury: Number(r.treasury), founded: Number(r.founded) });
    }
    for (const r of ctx.db.all<{ char_id: number; sect_id: number; role: string }>('SELECT char_id, sect_id, role FROM sect_members')) {
      if (!sects.has(Number(r.sect_id)) || !ROLES.includes(r.role as SectRole)) continue;
      members.set(Number(r.char_id), { sectId: Number(r.sect_id), role: r.role as SectRole });
    }
  };
  load();

  const pkey = (sectId: number, charId: number): string => `${sectId}:${charId}`;
  const livePending = (key: string): Pending | undefined => {
    const e = pending.get(key);
    if (!e) return undefined;
    if (e.expires <= ctx.now()) {
      pending.delete(key);
      return undefined;
    }
    return e;
  };
  const pendingFor = (sectId: number): Pending[] => {
    const out: Pending[] = [];
    for (const [k, e] of pending) {
      if (e.sectId !== sectId) continue;
      if (livePending(k)) out.push(e);
    }
    return out;
  };

  const memberIds = (sectId: number): number[] => {
    const out: number[] = [];
    for (const [id, m] of members) if (m.sectId === sectId) out.push(id);
    return out;
  };
  const onlineMembers = (sectId: number): Player[] => ctx.players.online().filter((p) => members.get(p.charId)?.sectId === sectId);

  const levelOfChar = (id: number): number => {
    const live = ctx.players.byCharId(id);
    if (live) return live.save.level;
    return Number(ctx.db.get<{ level: number }>('SELECT level FROM characters WHERE id = ?', id)?.level ?? 1);
  };

  const levelOf = (sectId: number): number => {
    const now = ctx.now();
    const c = levelCache.get(sectId);
    if (c && now - c.at < LEVEL_TTL_MS) return c.level;
    let total = 0;
    for (const id of memberIds(sectId)) total += levelOfChar(id);
    const level = sectLevelFor(total);
    levelCache.set(sectId, { level, at: now });
    return level;
  };
  const dirtyLevel = (sectId: number): void => void levelCache.delete(sectId);

  const roleOf = (charId: number): SectRole | null => members.get(charId)?.role ?? null;

  const tell = (sectId: number, level: 'info' | 'good' | 'warn' | 'bad', text: string, except?: number): void => {
    for (const p of onlineMembers(sectId)) if (p.charId !== except) ctx.notify(p, level, text);
  };

  const refresh = (charId: number): void => {
    const live = ctx.players.byCharId(charId);
    if (live) ctx.markMe(live);
  };

  /** Point a character's `save.sectId` at the sect table (live or offline). */
  const syncSave = (charId: number): void => {
    const want = members.get(charId)?.sectId ?? null;
    mutateCharacter(ctx, charId, (s) => {
      s.sectId = want;
    });
  };

  const cleanText = (raw: string, max: number): string => ctx.chat.clean(raw, max);

  const mine = (p: Player): { sect: SectRow; role: SectRole } => {
    const m = members.get(p.charId);
    const sect = m ? sects.get(m.sectId) : undefined;
    if (!m || !sect) throw new GameError('no_sect', 'You are not in a sect.');
    return { sect, role: m.role };
  };

  const invLimit = new Limiter(ctx, 10, 60_000);
  const targetLimit = new Limiter(ctx, 3, 60_000);
  const requestLimit = new Limiter(ctx, 5, 60_000);

  // ---- membership changes -------------------------------------------------------

  const admit = (sect: SectRow, charId: number, role: SectRole): void => {
    if (memberIds(sect.id).length >= SECT_MAX_MEMBERS) throw new GameError('sect_full', `${sect.name} is full (${SECT_MAX_MEMBERS} members).`);
    ctx.db.transaction(() => {
      ctx.db.run('INSERT INTO sect_members (char_id, sect_id, role, joined) VALUES (?, ?, ?, ?)', charId, sect.id, role, ctx.now());
    });
    members.set(charId, { sectId: sect.id, role });
    for (const k of [...pending.keys()]) if (pending.get(k)?.charId === charId) pending.delete(k);
    dirtyLevel(sect.id);
    syncSave(charId);
  };

  const drop = (charId: number): void => {
    const m = members.get(charId);
    ctx.db.transaction(() => {
      ctx.db.run('DELETE FROM sect_members WHERE char_id = ?', charId);
    });
    members.delete(charId);
    if (m) dirtyLevel(m.sectId);
    syncSave(charId);
  };

  const setRole = (charId: number, role: SectRole): void => {
    ctx.db.run('UPDATE sect_members SET role = ? WHERE char_id = ?', role, charId);
    const m = members.get(charId);
    if (m) m.role = role;
  };

  // ---- views --------------------------------------------------------------------

  const memberList = (sectId: number): SectMember[] => {
    const rows = ctx.db.all<{ id: number; name: string; level: number; role: string }>(
      'SELECT sm.char_id AS id, c.name AS name, c.level AS level, sm.role AS role FROM sect_members sm JOIN characters c ON c.id = sm.char_id WHERE sm.sect_id = ?',
      sectId,
    );
    const out: SectMember[] = rows.map((r) => {
      const live = ctx.players.byCharId(Number(r.id));
      return { id: Number(r.id), name: r.name, level: live ? live.save.level : Number(r.level), role: r.role as SectRole, online: !!live?.online };
    });
    out.sort((a, b) => ROLE_ORDER[b.role] - ROLE_ORDER[a.role] || b.level - a.level || a.name.localeCompare(b.name));
    return out;
  };

  const sectView = (sect: SectRow, asMember: boolean): SectView => ({
    id: sect.id,
    name: sect.name,
    tag: sect.tag,
    motto: sect.motto,
    level: levelOf(sect.id),
    treasury: asMember ? sect.treasury : 0,
    founded: sect.founded,
    members: memberList(sect.id),
    invites: asMember ? pendingFor(sect.id).length : 0,
  });

  // ---- commands -----------------------------------------------------------------

  const validateName = (raw: string): string => {
    const name = raw.trim().replace(/\s+/g, ' ');
    const len = Array.from(name).length;
    if (len < 3 || len > 20) throw new GameError('bad_name', 'A sect name must be 3 to 20 characters.');
    if (!NAME_RE.test(name) || cleanText(name, 20) !== name) throw new GameError('bad_name', 'That sect name contains characters that are not allowed.');
    for (const s of sects.values()) if (s.name.toLowerCase() === name.toLowerCase()) throw new GameError('name_taken', 'A sect with that name already exists.');
    return name;
  };
  const validateTag = (raw: string): string => {
    const tag = raw.trim();
    if (!TAG_RE.test(tag)) throw new GameError('bad_tag', 'A sect tag is 2 to 4 letters.');
    const up = tag.toUpperCase();
    for (const s of sects.values()) if (s.tag.toUpperCase() === up) throw new GameError('tag_taken', 'A sect with that tag already exists.');
    return up;
  };

  const create = (p: Player, rawName: string, rawTag: string, rawMotto?: string): void => {
    if (members.has(p.charId)) throw new GameError('in_sect', 'You already belong to a sect. Leave it first.');
    if (rankOf(p.save.level) < SECT_CREATE_RANK) throw new GameError('rank_low', 'Only Second-Rate fighters or better may found a sect.');
    const name = validateName(rawName);
    const tag = validateTag(rawTag);
    const motto = rawMotto ? cleanText(rawMotto, MOTTO_MAX) : '';
    if (p.save.gold < SECT_CREATE_GOLD) throw new GameError('no_gold', `Founding a sect costs ${SECT_CREATE_GOLD} gold.`);
    const now = ctx.now();
    let id = 0;
    try {
      id = ctx.db.transaction(() => {
        const r = ctx.db.run('INSERT INTO sects (name, tag, motto, treasury, founded) VALUES (?, ?, ?, 0, ?)', name, tag, motto, now);
        ctx.db.run('INSERT INTO sect_members (char_id, sect_id, role, joined) VALUES (?, ?, ?, ?)', p.charId, r.lastInsertRowid, 'leader', now);
        return r.lastInsertRowid;
      });
    } catch (err) {
      if (/UNIQUE/i.test(String((err as Error).message))) throw new GameError('name_taken', 'That sect name or tag is already taken.');
      throw err;
    }
    p.save.gold -= SECT_CREATE_GOLD;
    sects.set(id, { id, name, tag, motto, treasury: 0, founded: now });
    members.set(p.charId, { sectId: id, role: 'leader' });
    p.save.sectId = id;
    ctx.markDirty(p);
    ctx.markMe(p);
    ctx.notify(p, 'good', `You have founded the ${name} sect [${tag}].`);
    const entry = ctx.sim.record(`${p.name} founded the ${name} sect.`, 2, p.save.lastTown, 'player');
    ctx.broadcast({ t: 'chron', entries: [entry] });
  };

  const joinRequest = (p: Player, sectId: number): void => {
    if (members.has(p.charId)) throw new GameError('in_sect', 'You already belong to a sect.');
    const sect = sects.get(sectId);
    if (!sect) throw new GameError('not_found', 'That sect does not exist.');
    // An open invitation from that sect turns the request into an acceptance.
    if (livePending(pkey(sectId, p.charId))?.kind === 'invite') {
      accept(p, sectId);
      return;
    }
    if (livePending(pkey(sectId, p.charId))) throw new GameError('already_requested', 'You have already asked to join that sect.');
    if (memberIds(sectId).length >= SECT_MAX_MEMBERS) throw new GameError('sect_full', 'That sect is full.');
    throttle(requestLimit, `r${p.charId}`, 'You are sending too many requests.');
    if (pendingFor(sectId).filter((e) => e.kind === 'request').length >= SECT_MAX_REQUESTS) throw new GameError('too_many_requests', 'That sect has too many open requests.');
    pending.set(pkey(sectId, p.charId), { sectId, charId: p.charId, kind: 'request', by: p.charId, expires: ctx.now() + INVITE_TTL_MS });
    for (const m of onlineMembers(sectId)) {
      const r = roleOf(m.charId);
      if (r === 'leader' || r === 'elder') ctx.notify(m, 'info', `${p.name} (level ${p.save.level}) asks to join ${sect.name}. Invite them by name to accept.`);
    }
    ctx.notify(p, 'info', `Your request to join ${sect.name} was sent. It expires in 5 minutes.`);
  };

  const invite = (p: Player, rawName: string): void => {
    const { sect, role } = mine(p);
    if (role !== 'leader' && role !== 'elder') throw new GameError('no_permission', 'Only the leader and elders can invite.');
    const target = findCharacterByName(ctx, rawName);
    if (!target) throw new GameError('not_found', 'No such character.');
    if (target.id === p.charId) throw new GameError('bad_target', 'You cannot invite yourself.');
    if (members.has(target.id)) throw new GameError('target_in_sect', `${target.name} already belongs to a sect.`);
    if (memberIds(sect.id).length >= SECT_MAX_MEMBERS) throw new GameError('sect_full', 'Your sect is full.');
    const key = pkey(sect.id, target.id);
    const existing = livePending(key);
    // The target asked to join earlier: the invitation approves the request.
    if (existing?.kind === 'request') {
      admit(sect, target.id, 'outer');
      tellLater(ctx, target.id, 'good', `${sect.name} has accepted you as an outer member.`);
      tell(sect.id, 'info', `${target.name} has joined the sect.`);
      refresh(target.id);
      return;
    }
    if (!target.online) throw new GameError('offline', `${target.name} is not online.`);
    if (existing) throw new GameError('already_invited', `${target.name} has already been invited.`);
    throttle(invLimit, `s${p.charId}`, 'You are sending too many invitations.');
    throttle(targetLimit, `t${target.id}`, `${target.name} has received too many invitations; try later.`);
    pending.set(key, { sectId: sect.id, charId: target.id, kind: 'invite', by: p.charId, expires: ctx.now() + INVITE_TTL_MS });
    ctx.send(target.live!, { t: 'invite', kind: 'sect', fromId: p.charId, from: p.name, data: { sect: sect.id, name: sect.name, tag: sect.tag } });
    ctx.notify(p, 'info', `You invited ${target.name} to ${sect.name}.`);
  };

  const accept = (p: Player, sectId: number): void => {
    if (members.has(p.charId)) throw new GameError('in_sect', 'You already belong to a sect.');
    const key = pkey(sectId, p.charId);
    const inv = livePending(key);
    const sect = sects.get(sectId);
    if (!inv || inv.kind !== 'invite' || !sect) throw new GameError('no_invite', 'That invitation has expired.');
    admit(sect, p.charId, 'outer');
    ctx.notify(p, 'good', `You joined ${sect.name} as an outer member.`);
    tell(sect.id, 'good', `${p.name} has joined the sect.`, p.charId);
    refresh(p.charId);
  };

  const decline = (p: Player, sectId: number): void => {
    const key = pkey(sectId, p.charId);
    const inv = livePending(key);
    if (!inv || inv.kind !== 'invite') throw new GameError('no_invite', 'That invitation has expired.');
    pending.delete(key);
    const sect = sects.get(sectId);
    const inviter = ctx.players.byCharId(inv.by);
    if (inviter?.online) ctx.notify(inviter, 'info', `${p.name} declined to join ${sect?.name ?? 'your sect'}.`);
  };

  const leave = (p: Player): void => {
    const { sect, role } = mine(p);
    if (role === 'leader') throw new GameError('leader_cannot_leave', 'Promote a successor to leader first, or disband the sect.');
    drop(p.charId);
    ctx.notify(p, 'info', `You left ${sect.name}.`);
    tell(sect.id, 'info', `${p.name} has left the sect.`);
    refresh(p.charId);
  };

  const kick = (p: Player, id: number): void => {
    const { sect, role } = mine(p);
    if (role !== 'leader' && role !== 'elder') throw new GameError('no_permission', 'Only the leader and elders can remove members.');
    if (id === p.charId) throw new GameError('bad_target', 'Use leave to leave the sect.');
    const t = members.get(id);
    if (!t || t.sectId !== sect.id) throw new GameError('not_member', 'That character is not in your sect.');
    if (role === 'elder' && ROLE_ORDER[t.role] >= ROLE_ORDER.elder) throw new GameError('no_permission', 'Elders can only remove disciples and outer members.');
    const name = findCharacter(ctx, id)?.name ?? 'The member';
    drop(id);
    tellLater(ctx, id, 'bad', `You were removed from ${sect.name}.`);
    tell(sect.id, 'warn', `${name} was removed from the sect.`);
    refresh(id);
  };

  const promote = (p: Player, id: number, newRole: SectRole): void => {
    const { sect, role } = mine(p);
    if (role !== 'leader') throw new GameError('no_permission', 'Only the leader can change ranks.');
    if (!ROLES.includes(newRole)) throw new GameError('bad_role', 'Unknown role.');
    if (id === p.charId) throw new GameError('bad_target', 'You cannot change your own rank; hand leadership to someone else instead.');
    const t = members.get(id);
    if (!t || t.sectId !== sect.id) throw new GameError('not_member', 'That character is not in your sect.');
    if (t.role === newRole) throw new GameError('no_change', 'They already hold that rank.');
    const name = findCharacter(ctx, id)?.name ?? 'The member';
    ctx.db.transaction(() => {
      setRole(id, newRole);
      if (newRole === 'leader') setRole(p.charId, 'elder');
    });
    if (newRole === 'leader') {
      tell(sect.id, 'good', `${name} is the new leader of ${sect.name}.`);
    } else {
      tell(sect.id, 'info', `${name} is now ${newRole === 'outer' ? 'an outer member' : `a${newRole === 'elder' ? 'n' : ''} ${newRole}`}.`);
    }
    tellLater(ctx, id, 'info', `You are now ${newRole === 'leader' ? 'the leader' : `a${newRole === 'elder' ? 'n' : ''} ${newRole}`} of ${sect.name}.`);
    refresh(id);
    refresh(p.charId);
  };

  const deposit = (p: Player, gold: number): void => {
    const { sect } = mine(p);
    if (!Number.isInteger(gold) || gold < 1) throw new GameError('bad_amount', 'Deposit a whole number of gold.');
    if (p.save.gold < gold) throw new GameError('no_gold', 'You do not have that much gold.');
    ctx.db.run('UPDATE sects SET treasury = treasury + ? WHERE id = ?', gold, sect.id);
    sect.treasury += gold;
    p.save.gold -= gold;
    ctx.markDirty(p);
    ctx.markMe(p);
    ctx.notify(p, 'good', `You deposited ${gold} gold into the ${sect.name} treasury.`);
    tell(sect.id, 'info', `${p.name} deposited ${gold} gold.`, p.charId);
  };

  const setMotto = (p: Player, raw: string): void => {
    const { sect, role } = mine(p);
    if (role !== 'leader') throw new GameError('no_permission', 'Only the leader can change the motto.');
    const motto = cleanText(raw, MOTTO_MAX);
    ctx.db.run('UPDATE sects SET motto = ? WHERE id = ?', motto, sect.id);
    sect.motto = motto;
    ctx.notify(p, 'good', 'The sect motto has been updated.');
  };

  const disband = (p: Player): void => {
    const { sect, role } = mine(p);
    if (role !== 'leader') throw new GameError('no_permission', 'Only the leader can disband the sect.');
    const ids = memberIds(sect.id);
    ctx.db.transaction(() => {
      ctx.db.run('DELETE FROM sect_members WHERE sect_id = ?', sect.id);
      ctx.db.run('DELETE FROM sects WHERE id = ?', sect.id);
    });
    for (const id of ids) members.delete(id);
    sects.delete(sect.id);
    levelCache.delete(sect.id);
    for (const [k, e] of pending) if (e.sectId === sect.id) pending.delete(k);
    for (const id of ids) {
      syncSave(id);
      if (id !== p.charId) tellLater(ctx, id, 'bad', `${sect.name} has been disbanded.`);
      refresh(id);
    }
    ctx.notify(p, 'info', `You disbanded ${sect.name}.`);
  };

  ctx.command('sect', (p, m) => {
    switch (m.op) {
      case 'create':
        return create(p, m.name, m.tag, m.motto);
      case 'join':
        return joinRequest(p, m.sect);
      case 'invite':
        return invite(p, m.name);
      case 'accept':
        return accept(p, m.sect);
      case 'decline':
        return decline(p, m.sect);
      case 'leave':
        return leave(p);
      case 'kick':
        return kick(p, m.id);
      case 'promote':
        return promote(p, m.id, m.role);
      case 'deposit':
        return deposit(p, m.gold);
      case 'motto':
        return setMotto(p, m.motto);
      case 'disband':
        return disband(p);
    }
  });

  // ---- queries ------------------------------------------------------------------

  ctx.query('sect', (p, args) => {
    const own = members.get(p.charId);
    const id = args.id ?? own?.sectId;
    const sect = id === undefined ? undefined : sects.get(id);
    return sect ? sectView(sect, own?.sectId === sect.id) : null;
  });

  ctx.query('sects', () => {
    const counts = new Map<number, number>();
    for (const m of members.values()) counts.set(m.sectId, (counts.get(m.sectId) ?? 0) + 1);
    return [...sects.values()]
      .map((s) => ({ id: s.id, name: s.name, tag: s.tag, level: levelOf(s.id), members: counts.get(s.id) ?? 0, motto: s.motto }))
      .sort((a, b) => b.level - a.level || b.members - a.members || a.name.localeCompare(b.name))
      .slice(0, 100);
  });

  // ---- decorations ----------------------------------------------------------------

  ctx.onBuildMe((p, me) => {
    const m = members.get(p.charId);
    const sect = m ? sects.get(m.sectId) : undefined;
    me.sect = m && sect ? { id: sect.id, name: sect.name, tag: sect.tag, role: m.role } : null;
  });

  ctx.onPlayerSync((p, e) => {
    const m = members.get(p.charId);
    const sect = m ? sects.get(m.sectId) : undefined;
    if (!sect) return;
    const tag = `[${sect.tag}]`;
    e.tag = p.save.title ? `${tag} ${p.save.title}` : tag;
  });

  ctx.onSave((p) => {
    p.save.sectId = members.get(p.charId)?.sectId ?? null;
  });

  ctx.onLogin((p) => {
    const had = p.save.sectId;
    const want = members.get(p.charId)?.sectId ?? null;
    if (had !== want) {
      p.save.sectId = want;
      ctx.markDirty(p);
      ctx.markMe(p);
      if (had && !want) ctx.notify(p, 'warn', 'You are no longer a member of a sect.');
    }
    const m = members.get(p.charId);
    if (m && sects.has(m.sectId)) {
      const sect = sects.get(m.sectId)!;
      if (sect.motto) ctx.notify(p, 'info', `${sect.name}: ${sect.motto}`);
    }
  });

  ctx.chat.setSectResolver((sectId) => onlineMembers(sectId));

  getServices(ctx).xpModifiers.push((p) => {
    const m = members.get(p.charId);
    return m ? 1 + Math.min(SECT_MAX_LEVEL * SECT_XP_PER_LEVEL, levelOf(m.sectId) * SECT_XP_PER_LEVEL) : 1;
  });

  ctx.events.on('playerLevelUp', ({ player }) => {
    const m = members.get(player.charId);
    if (m) dirtyLevel(m.sectId);
  });

  ctx.every(30_000, () => {
    const now = ctx.now();
    for (const [k, e] of pending) if (e.expires <= now) pending.delete(k);
  });

  // ---- core query overrides: fill in sect names -------------------------------------

  const sectName = (charId: number): string | null => {
    const m = members.get(charId);
    return (m && sects.get(m.sectId)?.name) || null;
  };
  const profileOf = (save: Player['save']): PublicProfile => ({
    id: save.id,
    name: save.name,
    level: save.level,
    look: save.look,
    title: save.title,
    sect: sectName(save.id),
    kills: save.kills,
    deaths: save.deaths,
    equipment: save.equipment,
    stats: save.stats,
    rank: rankOf(save.level),
  });

  ctx.query(
    'player',
    (_p, args) => {
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
    },
    { override: true },
  );

  let board: { at: number; list: LeaderEntry[] } | null = null;
  ctx.query(
    'leaderboard',
    () => {
      const now = ctx.now();
      if (!board || now - board.at > 30_000) {
        const list = ctx.db.topCharacters(50).map((r) => ctx.players.byCharId(r.id)?.save ?? r.save);
        board = { at: now, list: list.map((s) => ({ id: s.id, name: s.name, level: s.level, kills: s.kills, sect: sectName(s.id) })) };
      }
      return board.list;
    },
    { override: true },
  );

  apis.set(ctx, { roleOf, sectIdOf: (id) => members.get(id)?.sectId ?? null, levelOf, xpBonus: (p) => { const m = members.get(p.charId); return m ? Math.min(SECT_MAX_LEVEL * SECT_XP_PER_LEVEL, levelOf(m.sectId) * SECT_XP_PER_LEVEL) : 0; } });
}
