/** Pure rules for the Social panel: sect permission matrix, founding validation, friend grouping, master flows. */
import { rankOf, type FriendView, type SectRole, type SectView, type SkillState } from '@murim/shared';

/** Server constants (systems/sects.ts, masters.ts): keep in sync. */
export const SECT_CREATE_GOLD = 500;
export const SECT_CREATE_RANK = 2;
export const SECT_MAX_MEMBERS = 50;
export const MOTTO_MAX = 120;
export const MASTER_MIN_RANK = 3;
export const DISCIPLE_MAX_RANK = 2;
export const MAX_DISCIPLES = 2;
export const NPC_MASTER_REP = 10;
export const TEACH_MIN_SKILL_LEVEL = 3;

export const ROLE_ORDER: Record<SectRole, number> = { leader: 3, elder: 2, disciple: 1, outer: 0 };
export const ROLES: SectRole[] = ['leader', 'elder', 'disciple', 'outer'];

export interface SectPerms {
  invite: boolean;
  motto: boolean;
  disband: boolean;
  leave: boolean;
  deposit: boolean;
}

export function sectPerms(role: SectRole | null): SectPerms {
  return {
    invite: role === 'leader' || role === 'elder',
    motto: role === 'leader',
    disband: role === 'leader',
    leave: role !== null && role !== 'leader',
    deposit: role !== null,
  };
}

export interface MemberActions {
  kick: boolean;
  /** Roles the actor may set on the target (never the current one). */
  promoteTo: SectRole[];
}

/** What `actor` may do to `target` (server: sects.ts kick / promote). `selfId` is the actor's character id. */
export function memberActions(actorRole: SectRole | null, actorId: number, target: { id: number; role: SectRole }): MemberActions {
  const none: MemberActions = { kick: false, promoteTo: [] };
  if (!actorRole || target.id === actorId) return none;
  if (actorRole === 'leader') return { kick: true, promoteTo: ROLES.filter((r) => r !== target.role) };
  if (actorRole === 'elder') return { kick: ROLE_ORDER[target.role] < ROLE_ORDER.elder, promoteTo: [] };
  return none;
}

// ---- founding -----------------------------------------------------------------------------------------

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u;
const TAG_RE = /^[A-Za-z]{2,4}$/;

export function normalizeSectName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function validateSectName(raw: string): string | null {
  const n = normalizeSectName(raw);
  if (!n) return 'soc.val.nameRequired';
  if (n.length < 3) return 'soc.val.nameShort';
  if (n.length > 20) return 'soc.val.nameLong';
  if (!NAME_RE.test(n)) return 'soc.val.nameChars';
  return null;
}

export function validateSectTag(raw: string): string | null {
  const tag = raw.trim();
  if (!tag) return 'soc.val.tagRequired';
  if (!TAG_RE.test(tag)) return 'soc.val.tagBad';
  return null;
}

export interface FoundGate {
  ok: boolean;
  /** i18n keys with params for each unmet requirement. */
  unmet: { key: string; params?: Record<string, number> }[];
}

export function foundGate(level: number, gold: number): FoundGate {
  const unmet: FoundGate['unmet'] = [];
  if (rankOf(level) < SECT_CREATE_RANK) unmet.push({ key: 'soc.found.needRank' });
  if (gold < SECT_CREATE_GOLD) unmet.push({ key: 'soc.found.needGold', params: { n: SECT_CREATE_GOLD, have: gold } });
  return { ok: unmet.length === 0, unmet };
}

export function sortMembers<T extends { role: SectRole; level: number; name: string; online: boolean }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => ROLE_ORDER[b.role] - ROLE_ORDER[a.role] || Number(b.online) - Number(a.online) || b.level - a.level || a.name.localeCompare(b.name));
}

/** XP bonus from sect level: +2% per level, max +20%. */
export function sectXpBonus(level: number): number {
  return Math.min(10, Math.max(0, level)) * 0.02;
}

export function memberCounts(v: SectView): { online: number; total: number } {
  return { online: v.members.filter((m) => m.online).length, total: v.members.length };
}

// ---- friends ------------------------------------------------------------------------------------------------

export interface FriendGroups {
  incoming: FriendView[];
  friends: FriendView[];
  outgoing: FriendView[];
}

export function groupFriends(list: readonly FriendView[]): FriendGroups {
  const byName = (a: FriendView, b: FriendView) => a.name.localeCompare(b.name);
  return {
    incoming: list.filter((f) => f.status === 'in').sort(byName),
    friends: list.filter((f) => f.status === 'friend').sort((a, b) => Number(b.online) - Number(a.online) || byName(a, b)),
    outgoing: list.filter((f) => f.status === 'out').sort(byName),
  };
}

export function validateFriendName(raw: string, selfName: string): string | null {
  const n = raw.trim();
  if (!n) return 'soc.val.friendRequired';
  if (n.toLowerCase() === selfName.toLowerCase()) return 'soc.val.friendSelf';
  return null;
}

// ---- masters --------------------------------------------------------------------------------------------------

export type MasterRole = 'none' | 'canBeDisciple' | 'canBeMaster' | 'neither';

/** What the player can be in the master system by rank: rank <= 2 may be a disciple, rank >= 3 may take disciples. */
export function masterEligibility(level: number): MasterRole {
  const r = rankOf(level);
  if (r <= DISCIPLE_MAX_RANK) return 'canBeDisciple';
  if (r >= MASTER_MIN_RANK) return 'canBeMaster';
  return 'neither';
}

/** Skills a master may teach: known at level >= 3. */
export function teachableSkills(skills: Record<string, SkillState>): { id: string; lv: number }[] {
  return Object.entries(skills)
    .filter(([, s]) => s.lv >= TEACH_MIN_SKILL_LEVEL)
    .map(([id, s]) => ({ id, lv: s.lv }))
    .sort((a, b) => b.lv - a.lv || a.id.localeCompare(b.id));
}

// ---- nearby / duel -----------------------------------------------------------------------------------------------

/** Distance in tiles under which the server accepts a duel challenge. */
export const DUEL_RANGE = 12;

export function maxDuelStake(myGold: number, theirGold: number | null): number {
  const poorer = theirGold === null ? myGold : Math.min(myGold, theirGold);
  return Math.floor(poorer * 0.2);
}
