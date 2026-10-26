/**
 * Named NPCs: the initial roster (guards, shopkeepers, masters, legends...), their daily lives
 * (aging, training, death, feuds, wandering), succession so services never vanish, and the
 * read-side helpers (greetings, shop listings).
 */
import {
  FACTION_BY_ID,
  ITEMS,
  SKILL_LIST,
  guardHeadcount,
  hash32,
  isPassable,
  legendTitle,
  personName,
  randomLook,
  rankName,
  rankOf,
  strHash,
  xpToNext,
  type BuildingKind,
  type NpcRole,
  type NpcState,
  type SettlementKind,
  type SettlementState,
  type SkillSchool,
} from '@murim/shared';
import type { ShopListing } from './api';
import { NPC } from './constants';
import { chron } from './chronicle';
import { dayOf } from './clock';
import { factionName } from './factions';
import type { Ctx, SuccessionTask } from './types';
import { besieged, clamp, emit, hasFlag, settlementName } from './util';

const TRAITS = ['stern', 'kind', 'greedy', 'boastful', 'weary', 'devout', 'cunning', 'honest', 'gruff', 'cheerful', 'superstitious', 'scholarly'];
const ALL_SCHOOLS: SkillSchool[] = ['sword', 'blade', 'spear', 'staff', 'fist', 'internal', 'movement', 'medicine', 'poison'];

const HOME_KINDS: Record<string, BuildingKind[]> = {
  guard: ['gate', 'tower', 'barracks'],
  elder: ['hall', 'shrine', 'pagoda', 'house'],
  merchant: ['market', 'warehouse', 'inn'],
  smith: ['smithy'],
  alchemist: ['alchemy'],
  innkeeper: ['inn'],
  master: ['dojo', 'hall', 'pagoda'],
  legend: ['hermitage', 'shrine', 'pagoda', 'hall', 'dojo'],
  villager: ['house', 'farmhouse', 'herbHut', 'teahouse'],
  wanderer: ['market', 'inn', 'teahouse'],
  physician: ['alchemy'],
};

const SHOP_BY_ROLE: Partial<Record<NpcRole, string>> = { merchant: 'general', smith: 'weapons', alchemist: 'medicine', innkeeper: 'food', physician: 'medicine' };

/** Roles whose replacement is queued when the holder dies (service roles). */
const SERVICE_ROLES: NpcRole[] = ['master', 'merchant', 'smith', 'alchemist', 'innkeeper', 'elder'];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function buildNpcIndex(ctx: Ctx): void {
  ctx.npcById.clear();
  for (const n of ctx.st.npcs) ctx.npcById.set(n.id, n);
}

function aliveAt(ctx: Ctx, sid: number): NpcState[] {
  const out: NpcState[] = [];
  for (const n of ctx.st.npcs) if (n.alive && n.settlementId === sid) out.push(n);
  return out;
}

function livingSettlements(ctx: Ctx): SettlementState[] {
  return ctx.st.settlements.filter((s) => s.status !== 'fallen');
}

// ---------------------------------------------------------------------------
// Homes
// ---------------------------------------------------------------------------

function usedHomes(ctx: Ctx, sid: number): Set<number> {
  const used = new Set<number>();
  for (const n of ctx.st.npcs) if (n.alive && n.settlementId === sid) used.add(n.homeY * ctx.S.w + n.homeX);
  return used;
}

/** A free passable tile near a door of one of the preferred building kinds (or the plaza). */
function pickHome(ctx: Ctx, sid: number, role: string, used: Set<number>, minRing = 1): { x: number; y: number } {
  const def = ctx.S.defs[sid];
  const w = ctx.S.w;
  const kinds = HOME_KINDS[role] ?? [];
  // A legend's hermitage stands outside the ring.
  const reachOut = role === 'legend' ? 14 : 3;
  let cx = def.spawn.x;
  let cy = def.spawn.y;
  for (const kind of kinds) {
    const blds = ctx.S.buildings[sid].filter((b) => b.kind === kind);
    if (blds.length) {
      const b = ctx.rng.pick(blds);
      cx = b.door.x;
      cy = b.door.y;
      break;
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let r = attempt === 0 ? minRing : 0; r <= 7; r++) {
      const cand: { x: number; y: number }[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!isPassable(ctx.world, x, y)) continue;
          if (used.has(y * w + x)) continue;
          if (Math.hypot(x - def.x, y - def.y) > def.radius + reachOut) continue;
          cand.push({ x, y });
        }
      }
      if (cand.length) {
        const c = ctx.rng.pick(cand);
        used.add(c.y * w + c.x);
        return c;
      }
    }
    // Nothing near the building: fall back to the plaza.
    cx = def.spawn.x;
    cy = def.spawn.y;
  }
  return { x: def.spawn.x, y: def.spawn.y };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

interface NpcSpec {
  role: NpcRole;
  sid: number;
  level: number;
  age: number;
  faction?: string | null;
  legend?: boolean;
  title?: string;
  teaches?: string[];
  used?: Set<number>;
}

function newName(ctx: Ctx): string {
  for (let i = 0; i < 8; i++) {
    const name = personName(ctx.rng);
    let clash = false;
    for (const n of ctx.st.npcs) {
      if (n.alive && n.name === name) {
        clash = true;
        break;
      }
    }
    if (!clash) return name;
  }
  return personName(ctx.rng);
}

function pickTraits(ctx: Ctx): string[] {
  const a = ctx.rng.pick(TRAITS);
  let b = ctx.rng.pick(TRAITS);
  if (b === a) b = ctx.rng.pick(TRAITS);
  return ctx.rng.chance(0.7) && a !== b ? [a, b] : [a];
}

function createNpc(ctx: Ctx, spec: NpcSpec): NpcState {
  const st = ctx.st;
  const day = dayOf(st.clock.totalHours);
  const used = spec.used ?? usedHomes(ctx, spec.sid);
  const home = pickHome(ctx, spec.sid, spec.legend ? 'legend' : spec.role, used);
  const level = Math.max(1, Math.round(spec.level));
  const npc: NpcState = {
    id: st.nextNpcId++,
    name: newName(ctx),
    look: randomLook(ctx.rng),
    role: spec.role,
    faction: spec.faction ?? null,
    settlementId: spec.sid,
    age: Math.round(spec.age * 1000) / 1000,
    level,
    xp: ctx.rng.int(0, Math.floor(xpToNext(level) * 0.7)),
    alive: true,
    legend: !!spec.legend,
    title: spec.title ?? '',
    teaches: spec.teaches ? [...spec.teaches] : [],
    shop: SHOP_BY_ROLE[spec.role] ?? 'none',
    bornDay: day - Math.round(spec.age * 120),
    diedDay: null,
    homeX: home.x,
    homeY: home.y,
    traits: pickTraits(ctx),
    disciples: spec.role === 'master' ? ctx.rng.int(0, 4) : 0,
  };
  st.npcs.push(npc);
  ctx.npcById.set(npc.id, npc);
  return npc;
}

function schoolsOf(factions: (string | null)[]): SkillSchool[] {
  const set = new Set<SkillSchool>();
  for (const f of factions) {
    if (f && FACTION_BY_ID[f]) for (const s of FACTION_BY_ID[f].schools) set.add(s);
  }
  return set.size ? [...set] : ALL_SCHOOLS;
}

/** Choose `count` skills of the given schools that a master of this level may teach. */
function pickTeaches(ctx: Ctx, schools: SkillSchool[], level: number, count: number, minTier = 1): string[] {
  const rank = rankOf(level);
  let pool = SKILL_LIST.filter((s) => schools.includes(s.school) && s.req.rank <= rank && s.tier >= minTier);
  if (pool.length === 0) pool = SKILL_LIST.filter((s) => schools.includes(s.school) && s.req.rank <= rank);
  if (pool.length === 0) pool = SKILL_LIST.filter((s) => s.req.rank <= rank);
  const picked: string[] = [];
  const items = pool.map((s) => [s, 1 + s.tier * s.tier * 0.7] as const);
  while (picked.length < count && items.length) {
    const s = ctx.rng.weighted(items);
    if (!picked.includes(s.id)) picked.push(s.id);
    const i = items.findIndex((e) => e[0] === s);
    if (i >= 0) items.splice(i, 1);
  }
  // A master should always offer a first lesson to beginners.
  if (rank <= 2 && !picked.some((id) => (SKILL_LIST.find((s) => s.id === id)?.tier ?? 9) <= 1)) {
    const cheap = pool.filter((s) => s.tier <= 1);
    if (cheap.length && picked.length) picked[picked.length - 1] = ctx.rng.pick(cheap).id;
  }
  return picked;
}

function minLevelFor(teaches: string[]): number {
  let need = 1;
  for (const id of teaches) {
    const s = SKILL_LIST.find((x) => x.id === id);
    if (s) need = Math.max(need, (s.req.rank - 1) * 9 + 1);
  }
  return need;
}

/** Faction(s) a master in this settlement belongs to: the controller, or the nearest powers. */
function masterFactions(ctx: Ctx, sid: number, count: number): (string | null)[] {
  const s = ctx.st.settlements[sid];
  if (s.controller) return Array(count).fill(s.controller) as string[];
  const d = ctx.S.defs[sid];
  const ranked = ctx.st.factions
    .map((f) => {
      let near = Infinity;
      for (const o of ctx.st.settlements) {
        if (o.controller !== f.id || o.status === 'fallen') continue;
        near = Math.min(near, Math.hypot(ctx.S.defs[o.id].x - d.x, ctx.S.defs[o.id].y - d.y));
      }
      return { id: f.id, near: Number.isFinite(near) ? near : 999 };
    })
    .sort((a, b) => a.near - b.near || (a.id < b.id ? -1 : 1));
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ranked[i % ranked.length].id);
  return out;
}

// ---------------------------------------------------------------------------
// Role parameters
// ---------------------------------------------------------------------------

function masterLevelRange(kind: SettlementKind): [number, number] {
  if (kind === 'sectHall' || kind === 'fort') return [20, 40];
  if (kind === 'town') return [14, 30];
  return [8, 18];
}

function roleLevel(ctx: Ctx, role: NpcRole, sid: number): number {
  const rng = ctx.rng;
  const d = ctx.S.danger[sid];
  const kind = ctx.S.defs[sid].kind;
  switch (role) {
    case 'guard':
      return clamp(Math.round(2 + d * 1.5) + rng.int(-1, 2) + (kind === 'fort' ? 3 : 0), 2, 40);
    case 'elder':
      return rng.int(5, 11) + Math.floor(d / 2);
    case 'merchant':
    case 'smith':
    case 'alchemist':
    case 'innkeeper':
    case 'physician':
      return rng.int(3, 9) + Math.floor(d / 3);
    case 'villager':
      return rng.int(1, 4);
    case 'wanderer':
      return rng.int(5, 22);
    case 'master': {
      const [lo, hi] = masterLevelRange(kind);
      return rng.bell(lo, hi);
    }
    default:
      return rng.int(36, 60);
  }
}

function roleAge(ctx: Ctx, role: NpcRole): number {
  const rng = ctx.rng;
  switch (role) {
    case 'guard':
      return rng.int(20, 46);
    case 'elder':
      return rng.int(60, 80);
    case 'master':
      return rng.int(38, 74);
    case 'legend':
      return rng.int(52, 88);
    case 'villager':
      return rng.int(14, 66);
    case 'wanderer':
      return rng.int(22, 58);
    default:
      return rng.int(26, 60);
  }
}

function hasBuilding(ctx: Ctx, sid: number, kind: BuildingKind): boolean {
  return ctx.S.buildings[sid].some((b) => b.kind === kind);
}

/** Minimum head-count per role for a living settlement (what succession refills toward). */
function requiredCount(ctx: Ctx, sid: number, role: NpcRole): number {
  const kind = ctx.S.defs[sid].kind;
  switch (role) {
    case 'guard':
      return guardHeadcount(kind);
    case 'elder':
    case 'merchant':
      return 1;
    case 'smith':
      return kind === 'village' || kind === 'town' || kind === 'fort' ? 1 : 0;
    case 'alchemist':
      return kind === 'village' || kind === 'town' || kind === 'sectHall' ? 1 : 0;
    case 'innkeeper':
      return hasBuilding(ctx, sid, 'inn') ? 1 : 0;
    case 'master':
      return kind === 'sectHall' ? 3 : kind === 'fort' ? 2 : kind === 'town' ? 1 : kind === 'village' ? (sid === ctx.S.startId ? 2 : 1) : 0;
    case 'villager':
      return 3;
    default:
      return 0;
  }
}

const REFILL_ROLES: NpcRole[] = ['elder', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'guard', 'villager'];

// ---------------------------------------------------------------------------
// Initial roster
// ---------------------------------------------------------------------------

function makeMaster(ctx: Ctx, sid: number, faction: string | null, schools: SkillSchool[], used: Set<number>, level?: number, teaches?: string[]): NpcState {
  const kind = ctx.S.defs[sid].kind;
  let lv = level ?? roleLevel(ctx, 'master', sid);
  let t = teaches;
  if (!t || t.length === 0) {
    t = pickTeaches(ctx, schools, lv, ctx.rng.int(2, 4));
  }
  lv = Math.max(lv, minLevelFor(t));
  void kind;
  return createNpc(ctx, { role: 'master', sid, level: lv, age: roleAge(ctx, 'master'), faction, teaches: t, used });
}

function seedSettlement(ctx: Ctx, sid: number): void {
  const rng = ctx.rng;
  const s = ctx.st.settlements[sid];
  const kind = ctx.S.defs[sid].kind;
  const used = usedHomes(ctx, sid);
  const ctl = s.controller;
  // The headcount is no longer random. The roll is still taken: the long-run sim tests were tuned on seeded histories
  // and the few that read thresholds off one history break when the random stream shifts.
  if (kind !== 'fort') rng.int(2, 3);
  const guards = guardHeadcount(kind);
  for (let i = 0; i < guards; i++) createNpc(ctx, { role: 'guard', sid, level: roleLevel(ctx, 'guard', sid), age: roleAge(ctx, 'guard'), faction: ctl, used });
  createNpc(ctx, { role: 'elder', sid, level: roleLevel(ctx, 'elder', sid), age: roleAge(ctx, 'elder'), faction: ctl, used });
  createNpc(ctx, { role: 'merchant', sid, level: roleLevel(ctx, 'merchant', sid), age: roleAge(ctx, 'merchant'), faction: ctl, used });
  for (const role of ['smith', 'alchemist', 'innkeeper'] as NpcRole[]) {
    if (requiredCount(ctx, sid, role) > 0) createNpc(ctx, { role, sid, level: roleLevel(ctx, role, sid), age: roleAge(ctx, role), faction: ctl, used });
  }
  const villagers = kind === 'hamlet' ? rng.int(3, 4) : kind === 'town' ? rng.int(4, 6) : rng.int(3, 5);
  for (let i = 0; i < villagers; i++) createNpc(ctx, { role: 'villager', sid, level: roleLevel(ctx, 'villager', sid), age: roleAge(ctx, 'villager'), faction: ctl, used });
  if (rng.chance(0.3)) createNpc(ctx, { role: 'wanderer', sid, level: roleLevel(ctx, 'wanderer', sid), age: roleAge(ctx, 'wanderer'), faction: null, used });

  // Masters.
  let masters = 0;
  if (kind === 'sectHall') masters = rng.int(3, 4);
  else if (kind === 'fort') masters = rng.int(2, 3);
  else if (kind === 'town') masters = rng.int(1, 2);
  else if (kind === 'village') masters = sid === ctx.S.startId ? 2 : 1;
  if (masters > 0) {
    const facs = ctl ? Array(masters).fill(ctl) : masterFactions(ctx, sid, masters);
    // An independent place hosts masters of different schools.
    for (let i = 0; i < masters; i++) {
      const f = facs[i] as string | null;
      makeMaster(ctx, sid, f, schoolsOf([f]), used);
    }
  }
}

export function initNpcs(ctx: Ctx): void {
  const rng = ctx.rng;
  const living = ctx.st.settlements.filter((s) => s.status !== 'fallen');
  for (const s of living) seedSettlement(ctx, s.id);
  // Legends: about one per two settlements, away from the starting village.
  const cand = living.filter((s) => s.id !== ctx.S.startId).map((s) => s.id);
  rng.shuffle(cand);
  const n = Math.min(cand.length, Math.ceil(living.length / 2));
  for (let i = 0; i < n; i++) spawnLegend(ctx, cand[i], false);
}

function spawnLegend(ctx: Ctx, sid: number, announce: boolean): NpcState {
  const s = ctx.st.settlements[sid];
  const fac = s.controller ?? masterFactions(ctx, sid, 1)[0];
  const dark = !!fac && (FACTION_BY_ID[fac]?.ideology === 'heterodox' || FACTION_BY_ID[fac]?.ideology === 'outlaw');
  const level = roleLevel(ctx, 'legend', sid);
  const teaches = pickTeaches(ctx, schoolsOf([fac]), level, 2, 3);
  const npc = createNpc(ctx, {
    role: 'legend',
    sid,
    level,
    age: roleAge(ctx, 'legend'),
    faction: s.controller,
    legend: true,
    title: freshTitle(ctx, dark || ctx.rng.chance(0.12)),
    teaches,
  });
  if (announce) {
    emit(ctx, { k: 'npcBorn', id: npc.id });
    chron(ctx, 'legend', `The legend ${npc.name}, ${npc.title}, has come to ${settlementName(ctx, sid)}.`, 2, { sid, key: `legend-arrive:${npc.id}` });
  }
  return npc;
}

// ---------------------------------------------------------------------------
// Death and succession
// ---------------------------------------------------------------------------

const CAUSE_TEXT: Record<string, string> = {
  'old age': 'has died of old age',
  plague: 'has succumbed to the plague',
  blight: 'was slain by the Hollows',
  fighting: 'fell in the fighting',
};

export function killNpc(ctx: Ctx, npc: NpcState, cause: string, text?: string, quiet = false): void {
  if (!npc.alive) return;
  const st = ctx.st;
  npc.alive = false;
  npc.diedDay = dayOf(st.clock.totalHours);
  npc.causeOfDeath = cause;
  npc.disciples = 0;
  emit(ctx, { k: 'npcDied', id: npc.id });
  st.ext.stats.npcDeaths = (st.ext.stats.npcDeaths ?? 0) + 1;
  const place = settlementName(ctx, npc.settlementId);
  const fac = npc.faction ? `the ${factionName(npc.faction)}` : place;
  const what = text ?? CAUSE_TEXT[cause] ?? `has died (${cause})`;
  if (!quiet) {
    if (npc.legend || npc.role === 'legend') {
      chron(ctx, 'legend', `The legend ${npc.name}, ${npc.title || 'a wandering master'}, ${what}.`, 3, { sid: npc.settlementId, force: true });
    } else if (npc.role === 'master') {
      chron(ctx, 'npc', `Master ${npc.name} of ${fac} ${what}.`, 2, { sid: npc.settlementId, force: true });
    } else if (npc.role === 'elder') {
      chron(ctx, 'npc', `Elder ${npc.name} of ${place} ${what}.`, 1, { sid: npc.settlementId, key: `elder-die:${npc.id}` });
    }
  }
  if (SERVICE_ROLES.includes(npc.role) && !npc.legend && st.settlements[npc.settlementId].status !== 'fallen') {
    queueSuccession(ctx, npc.id, npc.settlementId, npc.role, ctx.rng.int(npc.role === 'master' ? 36 : 24, npc.role === 'master' ? 96 : 72));
  }
}

function queueSuccession(ctx: Ctx, npcId: number, sid: number, role: NpcRole, delayHours: number): void {
  const t: SuccessionTask = { npc: npcId, at: ctx.st.clock.totalHours + delayHours, sid, role };
  ctx.st.ext.succession.push(t);
}

const HEIRS = ['a senior disciple', 'a wandering swordsman', 'a promoted guard captain', 'the eldest student', 'a returning pupil'];

function succeed(ctx: Ctx, task: SuccessionTask): void {
  const st = ctx.st;
  const s = st.settlements[task.sid];
  if (!s || s.status === 'fallen') return;
  const dead = task.npc >= 0 ? ctx.npcById.get(task.npc) : undefined;
  const role = task.role;
  const rng = ctx.rng;
  const place = settlementName(ctx, task.sid);
  const used = usedHomes(ctx, task.sid);
  if (role === 'master') {
    const fac = s.controller ?? dead?.faction ?? masterFactions(ctx, task.sid, 1)[0];
    const kind = ctx.S.defs[task.sid].kind;
    const [lo, hi] = masterLevelRange(kind);
    const sameSchool = !!dead && dead.faction === fac && dead.teaches.length > 0;
    let level = dead ? clamp(dead.level - rng.int(1, 5), lo, hi + 4) : rng.bell(lo, hi);
    const teaches = sameSchool ? dead!.teaches : pickTeaches(ctx, schoolsOf([fac]), level, rng.int(2, 4));
    level = Math.max(level, minLevelFor(teaches));
    const npc = createNpc(ctx, { role: 'master', sid: task.sid, level, age: rng.int(30, 52), faction: fac, teaches, used });
    emit(ctx, { k: 'npcBorn', id: npc.id });
    if (dead) {
      chron(ctx, 'npc', `${npc.name}, ${rng.pick(HEIRS)}, takes the mantle of Master ${dead.name}${s.controller ? ` of the ${factionName(s.controller)}` : ''}.`, 2, { sid: task.sid, key: `mantle:${task.npc}:${task.sid}`, cooldown: 24 * 3 });
    } else {
      chron(ctx, 'npc', `${npc.name} has come to teach at ${place}${fac ? ` in the name of the ${factionName(fac)}` : ''}.`, 1, { sid: task.sid, key: `new-master:${task.sid}`, cooldown: 24 * 4 });
    }
    st.ext.stats.successions = (st.ext.stats.successions ?? 0) + 1;
    return;
  }
  const npc = createNpc(ctx, { role, sid: task.sid, level: roleLevel(ctx, role, task.sid), age: roleAge(ctx, role), faction: s.controller, used });
  emit(ctx, { k: 'npcBorn', id: npc.id });
  st.ext.stats.successions = (st.ext.stats.successions ?? 0) + 1;
  const label: Partial<Record<NpcRole, string>> = { merchant: 'merchant', smith: 'smith', alchemist: 'alchemist', innkeeper: 'innkeeper', elder: 'elder' };
  const l = label[role];
  if (l) chron(ctx, 'npc', `${npc.name} has become the new ${l} of ${place}.`, 1, { sid: task.sid, key: `new-${role}:${task.sid}`, cooldown: 24 * 4 });
}

/** Hourly: successors whose time has come arrive. */
export function npcsHourly(ctx: Ctx): void {
  const q = ctx.st.ext.succession;
  if (q.length === 0) return;
  const now = ctx.st.clock.totalHours;
  const due = q.filter((t) => t.at <= now);
  if (due.length === 0) return;
  ctx.st.ext.succession = q.filter((t) => t.at > now);
  for (const t of due) succeed(ctx, t);
}

function pendingCount(ctx: Ctx, sid: number, role: NpcRole): number {
  let n = 0;
  for (const t of ctx.st.ext.succession) if (t.sid === sid && t.role === role) n++;
  return n;
}

/** Keep every living settlement's services staffed: queue arrivals for missing roles. */
function ensureRoster(ctx: Ctx, sid: number, fast = false): void {
  const s = ctx.st.settlements[sid];
  if (s.status === 'fallen') return;
  const here = aliveAt(ctx, sid);
  for (const role of REFILL_ROLES) {
    const need = requiredCount(ctx, sid, role);
    if (need === 0) continue;
    let have = 0;
    for (const n of here) if (n.role === role) have++;
    const missing = need - have - pendingCount(ctx, sid, role);
    for (let i = 0; i < missing; i++) {
      const delay = fast ? 0 : ctx.rng.int(24, 72);
      if (fast) succeed(ctx, { npc: -1, at: 0, sid, role });
      else queueSuccession(ctx, -1, sid, role, delay);
    }
  }
}

// ---------------------------------------------------------------------------
// Settlement-level events
// ---------------------------------------------------------------------------

function nearestLiving(ctx: Ctx, sid: number): number {
  const d = ctx.S.defs[sid];
  let best = -1;
  let bd = Infinity;
  for (const s of ctx.st.settlements) {
    if (s.status === 'fallen' || s.id === sid) continue;
    const dd = Math.hypot(ctx.S.defs[s.id].x - d.x, ctx.S.defs[s.id].y - d.y);
    if (dd < bd) {
      bd = dd;
      best = s.id;
    }
  }
  return best;
}

function relocate(ctx: Ctx, npc: NpcState, dest: number): void {
  const used = usedHomes(ctx, dest);
  const home = pickHome(ctx, dest, npc.role, used);
  npc.settlementId = dest;
  npc.homeX = home.x;
  npc.homeY = home.y;
  emit(ctx, { k: 'npcMoved', id: npc.id });
}

const FALL_DEATH: Partial<Record<NpcRole, number>> = { villager: 0.7, guard: 0.85, merchant: 0.55, smith: 0.5, alchemist: 0.5, innkeeper: 0.55, elder: 0.5, master: 0.4, legend: 0.15, wanderer: 0.2, physician: 0.5 };

export function onNpcSettlementFallen(ctx: Ctx, sid: number): void {
  const name = settlementName(ctx, sid);
  const dest = nearestLiving(ctx, sid);
  let fled = 0;
  let died = 0;
  for (const n of aliveAt(ctx, sid)) {
    if (ctx.rng.chance(FALL_DEATH[n.role] ?? 0.6) || dest < 0) {
      killNpc(ctx, n, 'blight', n.role === 'master' || n.role === 'legend' ? `perished in the fall of ${name}` : undefined, n.role !== 'master' && n.role !== 'legend');
      died++;
    } else {
      relocate(ctx, n, dest);
      fled++;
    }
  }
  ctx.st.ext.succession = ctx.st.ext.succession.filter((t) => t.sid !== sid);
  if (fled + died > 0 && dest >= 0) chron(ctx, 'settlement', `Refugees from ${name} stream toward ${settlementName(ctx, dest)}.`, 1, { sid: dest, key: `refugees:${sid}`, cooldown: 24 * 5 });
}

export function onNpcSettlementRetaken(ctx: Ctx, sid: number): void {
  ensureRoster(ctx, sid, true);
}

/** Ownership changed: servants adopt the new colours; old masters may fall in the fighting. */
export function onNpcControllerChanged(ctx: Ctx, sid: number, prev: string | null): void {
  const s = ctx.st.settlements[sid];
  for (const n of aliveAt(ctx, sid)) {
    if (n.role === 'master') {
      if (prev && n.faction === prev && s.controller !== prev && ctx.rng.chance(0.3)) killNpc(ctx, n, 'fighting', `fell defending ${settlementName(ctx, sid)}`);
      continue;
    }
    if (n.role === 'legend' || n.role === 'wanderer') continue;
    if (n.faction !== s.controller) {
      n.faction = s.controller;
      emit(ctx, { k: 'npcMoved', id: n.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Daily lives
// ---------------------------------------------------------------------------

function deathChance(npc: NpcState): number {
  const eff = npc.age - npc.level * NPC.levelLongevity;
  const hazard = NPC.ageHazardBase * Math.exp((eff - 65) / NPC.ageHazardScale);
  return Math.min(0.12, hazard / 120);
}

/** A legend title not already worn by a living NPC (falls back to a repeat after a few tries). */
function freshTitle(ctx: Ctx, dark: boolean): string {
  let t = legendTitle(ctx.rng, dark);
  for (let i = 0; i < 10 && ctx.st.npcs.some((x) => x.alive && x.title === t); i++) t = legendTitle(ctx.rng, dark);
  return t;
}

function legendCount(ctx: Ctx): number {
  let n = 0;
  for (const x of ctx.st.npcs) if (x.alive && x.legend) n++;
  return n;
}

function trainDaily(ctx: Ctx, npc: NpcState): void {
  let days: number;
  if (npc.role === 'master') days = 80 + npc.level * 5;
  else if (npc.role === 'legend') days = 260 + npc.level * 3;
  else if (npc.role === 'guard') days = 220 + npc.level * 12;
  else return;
  const need = xpToNext(npc.level);
  let gain = need / days;
  if (npc.role === 'master' && ctx.rng.chance(0.004)) gain += need * 0.35; // a flash of insight
  npc.xp += gain;
  if (npc.xp < need) return;
  npc.xp -= need;
  npc.level++;
  if (npc.role === 'master' || npc.role === 'legend') emit(ctx, { k: 'npcMoved', id: npc.id });
  if (npc.role === 'master' && rankOf(npc.level) > rankOf(npc.level - 1)) {
    chron(ctx, 'npc', `Master ${npc.name} of ${settlementName(ctx, npc.settlementId)} breaks through to the ${rankName(npc.level)} realm.`, 1, { sid: npc.settlementId, key: `rank:${npc.id}`, cooldown: 24 * 20 });
  }
  if (npc.role !== 'master') return;
  const rank = rankOf(npc.level);
  const faction = npc.faction ? FACTION_BY_ID[npc.faction] : undefined;
  const dark = !!faction && (faction.ideology === 'heterodox' || faction.ideology === 'outlaw');
  if (rank >= 4 && !npc.title) {
    npc.title = freshTitle(ctx, dark);
    chron(ctx, 'npc', `Master ${npc.name} has earned the name "${npc.title}".`, 2, { sid: npc.settlementId, force: true });
  }
  if (npc.level >= 37 && !npc.legend && legendCount(ctx) < Math.ceil(livingSettlements(ctx).length * 0.7)) {
    npc.role = 'legend';
    npc.legend = true;
    npc.shop = 'none';
    if (!npc.title) npc.title = freshTitle(ctx, dark);
    ctx.st.ext.stats.legendsRisen = (ctx.st.ext.stats.legendsRisen ?? 0) + 1;
    chron(ctx, 'legend', `${npc.name}, ${npc.title}, is now counted among the legends of the martial world.`, 3, { sid: npc.settlementId, force: true });
  }
}

function feuds(ctx: Ctx): void {
  const fs = ctx.st.factions;
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      if (!fs[i].atWarWith.includes(fs[j].id)) continue;
      if (!ctx.rng.chance(NPC.feudChance)) continue;
      const fighters = (fid: string) => ctx.st.npcs.filter((n) => n.alive && (n.role === 'master' || n.role === 'legend') && n.faction === fid);
      const A = fighters(fs[i].id);
      const B = fighters(fs[j].id);
      if (!A.length || !B.length) continue;
      const a = ctx.rng.pick(A);
      const b = ctx.rng.pick(B);
      const sa = a.level + ctx.rng.float(-6, 6);
      const sb = b.level + ctx.rng.float(-6, 6);
      const [win, lose] = sa >= sb ? [a, b] : [b, a];
      win.xp += xpToNext(win.level) * 0.1;
      ctx.st.ext.stats.feuds = (ctx.st.ext.stats.feuds ?? 0) + 1;
      killNpc(ctx, lose, 'duel', `was slain in a duel by ${win.legend ? win.name : `Master ${win.name}`} of the ${factionName(win.faction ?? '')}`);
    }
  }
}

function wanderDaily(ctx: Ctx, npc: NpcState): void {
  const p = npc.legend ? NPC.legendWanderChance : npc.role === 'wanderer' ? 0.07 : 0;
  if (p <= 0 || !ctx.rng.chance(p)) return;
  const nbs = ctx.S.adj[npc.settlementId].map(([o]) => o).filter((o) => ctx.st.settlements[o].status !== 'fallen');
  if (nbs.length === 0) return;
  const dest = ctx.rng.pick(nbs);
  relocate(ctx, npc, dest);
  if (npc.legend && ctx.rng.chance(0.4)) chron(ctx, 'legend', `The legend ${npc.name}, ${npc.title}, has been seen in ${settlementName(ctx, dest)}.`, 1, { sid: dest, key: `seen:${npc.id}`, cooldown: 24 * 6 });
}

export function npcsDaily(ctx: Ctx): void {
  const st = ctx.st;
  const rng = ctx.rng;
  const roster = st.npcs.filter((n) => n.alive);
  for (const npc of roster) {
    if (!npc.alive) continue;
    const s = st.settlements[npc.settlementId];
    npc.age = Math.round((npc.age + 1 / 120) * 1000) / 1000;
    trainDaily(ctx, npc);
    if (rng.chance(deathChance(npc))) {
      killNpc(ctx, npc, 'old age');
      continue;
    }
    if (s.status === 'fallen') continue;
    // Plague.
    if (hasFlag(s, 'plague')) {
      const p = (npc.legend ? 0.001 : 0.004) + (npc.age > 55 ? 0.006 : 0);
      if (rng.chance(p)) {
        killNpc(ctx, npc, 'plague');
        continue;
      }
    }
    // Sieges and Blight pressure.
    if (besieged(ctx, s)) {
      const fight = npc.role === 'guard' ? 0.02 : npc.role === 'master' || npc.legend ? 0.003 : 0.005;
      if (rng.chance(fight)) {
        killNpc(ctx, npc, 'blight', s.siegeBy === 'blight' ? undefined : `fell in the fighting at ${settlementName(ctx, s.id)}`);
        continue;
      }
    } else if (s.blight > 70 && rng.chance(0.002)) {
      killNpc(ctx, npc, 'blight');
      continue;
    }
    if (npc.role === 'master' && rng.chance(0.012) && npc.disciples < 6) {
      npc.disciples++;
      chron(ctx, 'npc', `Master ${npc.name} accepts a new disciple at ${settlementName(ctx, s.id)}.`, 1, { sid: s.id, key: `disc:${npc.id}`, cooldown: 24 * 12 });
    }
    else if (npc.role === 'master' && rng.chance(0.004) && npc.disciples > 0) npc.disciples--;
    wanderDaily(ctx, npc);
  }
  feuds(ctx);
  // A new wandering legend appears when the world is short of them.
  const living = livingSettlements(ctx);
  if (legendCount(ctx) < Math.ceil(living.length / 2) - 1 && rng.chance(NPC.legendArriveChance)) {
    const cand = living.filter((s) => s.id !== ctx.S.startId);
    if (cand.length) spawnLegend(ctx, rng.pick(cand).id, true);
  }
  for (const s of living) ensureRoster(ctx, s.id);
  // Prune old graves.
  const day = dayOf(st.clock.totalHours);
  if (st.npcs.some((n) => !n.alive && n.diedDay !== null && day - n.diedDay > NPC.pruneDays)) {
    st.npcs = st.npcs.filter((n) => n.alive || n.diedDay === null || day - n.diedDay <= NPC.pruneDays);
    buildNpcIndex(ctx);
  }
}

// ---------------------------------------------------------------------------
// Greetings and shops (read side; must not consume the sim Rng)
// ---------------------------------------------------------------------------

const ROLE_LINES: Record<string, string[]> = {
  guard: ['Keep the peace within these walls, {p}, and we will get along.', 'The roads are not what they were. Stay near the lanterns after dark, {p}.', 'State your business, {p}. Travellers are welcome; trouble is not.', 'I have walked this wall since before the Blight. I will walk it after, too.'],
  elder: ['Sit, {p}. The young ones never stop to listen, but you look like you might.', 'Our fields, our wells, our children: all of it hangs by a thread, {p}. Any help is welcome.', 'Welcome, {p}. May the heavens spare us another hard winter.', 'I remember when the sky was clear to the horizon. Perhaps you will see it so again, {p}.'],
  merchant: ['Welcome, {p}! Fair prices, honest weights, and the best gossip on the road.', 'Browse freely, {p}. Silver spoken for is silver saved.', 'Supplies run short these days, {p}. Buy what you need while the shelves last.', 'A traveller with a full purse is a friend of mine, {p}.'],
  smith: ['Steel does not lie, {p}. Tell me what you need hammered.', 'Mind the sparks, {p}. A good blade takes patience and a better arm.', 'Every sect in the realm buys from me, {p}. Not all of them pay.', 'Bring me ore and I will bring you an edge, {p}.'],
  alchemist: ['Pills for the body, tonics for the spirit, {p}. Do not ask what is in the green one.', 'The Blight sours every herb, {p}. Good medicine grows dear.', 'Breathe slowly, {p}. Most ailments are only a matter of qi gone astray.', 'Welcome, {p}. Fever, poison, rot: I have a remedy for most, and an honest warning for the rest.'],
  innkeeper: ['Warm bed, warm wine, {p}. The stew is better than it smells.', 'Rest your bones, {p}. The road will still be there in the morning.', 'Travellers bring stories, {p}. Tell me one and the first cup is on the house.', 'Keep your sword sheathed under my roof, {p}, and we shall be friends.'],
  master: ['Your stance is crooked, {p}. Come, let us begin there.', 'Strength is borrowed; discipline is owned. Are you ready to learn, {p}?', 'The martial path is long, {p}. Do not rush it, and do not abandon it.', 'I teach those who will carry the lesson further than I can, {p}.'],
  legend: ['So you are the one the whispers speak of, {p}. Walk with care.', 'Few seek me out these days, {p}. Fewer leave unchanged.', 'I have seen empires fall, {p}. Tell me you bring something better.', 'Do not mistake my stillness for age, {p}.'],
  villager: ['Oh, hello, {p}. The harvest was thin, but we get by.', 'Have you come far, {p}? The roads frighten us lately.', 'Good day to you, {p}. Mind the mud by the well.', 'They say a stranger with a sword is worth ten guards, {p}. Is it true?'],
  wanderer: ['The road has been long, {p}. I have seen things best not described near the fire.', 'I go where the wind sends me, {p}. Today it sent me here.', 'Rumours travel faster than caravans, {p}. Want to hear one?'],
};

export function greetingFor(ctx: Ctx, npc: NpcState, playerName: string): string {
  const s = ctx.st.settlements[npc.settlementId];
  const day = dayOf(ctx.st.clock.totalHours);
  const h = hash32(npc.id, day, strHash(playerName));
  const p = playerName || 'traveller';
  const situ: string[] = [];
  if (s) {
    if (besieged(ctx, s)) situ.push(`The gates are barely holding, ${p}. Keep your blade ready.`, `We are surrounded, ${p}. Every sword counts today.`);
    if (hasFlag(s, 'famine')) situ.push(`Grain is scarce in ${settlementName(ctx, s.id)}, ${p}. Bring food and you will be remembered.`);
    if (hasFlag(s, 'plague')) situ.push(`Cover your mouth, ${p}. The fever is in the streets.`);
    if (hasFlag(s, 'festival')) situ.push(`Lanterns and drums, ${p}! Even in these times we celebrate.`);
    if (s.blight >= 50) situ.push(`The Blight is at our door, ${p}. Do you feel the air turning?`);
  }
  if (npc.traits.includes('gruff') && (h & 3) === 0) return `What do you want, ${p}? Make it quick.`;
  if (situ.length && (h % 100) < 55) return situ[(h >>> 8) % situ.length];
  const lines = ROLE_LINES[npc.legend ? 'legend' : npc.role] ?? ROLE_LINES.villager;
  const line = lines[(h >>> 4) % lines.length].replace('{p}', p);
  if (npc.legend && npc.title && (h & 1) === 0) return `${line} (${npc.title})`;
  return line;
}

const WEAPON_TYPES_LIST = ['sword', 'blade', 'spear', 'staff', 'fist'] as const;

function inStock(s: SettlementState, id: string): boolean {
  return (s.stock[id] ?? 1) >= 1 || s.status === 'fallen';
}

export function shopForNpc(ctx: Ctx, npc: NpcState): ShopListing | null {
  if (!npc.alive || npc.shop === 'none') return null;
  const s = ctx.st.settlements[npc.settlementId];
  if (!s) return null;
  const kind = ctx.S.defs[npc.settlementId].kind;
  const sell = Math.round((0.4 + 0.1 * clamp(s.prosperity / 100, 0, 1)) * 100) / 100;
  let items: string[] = [];
  switch (npc.shop) {
    case 'general':
      items = ['cooked_meat', 'pill_heal_s', 'pill_qi_s', 'grain', 'meat', 'herb', 'cloth', 'wine', 'o_1', ...WEAPON_TYPES_LIST.map((w) => `w_${w}_1`), 'a_vitality_1'];
      break;
    case 'weapons': {
      const cap = s.prosperity < 30 ? 1 : s.prosperity < 55 ? 2 : 3;
      for (let t = 1; t <= cap; t++) {
        for (const w of WEAPON_TYPES_LIST) items.push(`w_${w}_${t}`);
        items.push(`o_${t}`);
      }
      break;
    }
    case 'medicine':
      items = ['pill_heal_s', 'pill_heal_m', 'pill_qi_s', 'pill_qi_m', 'antidote', 'pill_break_1'];
      if (s.prosperity >= 60 && (kind === 'town' || kind === 'sectHall')) items.push('pill_heal_l');
      if (s.prosperity >= 55 && (kind === 'town' || kind === 'sectHall' || kind === 'fort')) items.push('pill_break_2');
      break;
    case 'food':
      items = ['cooked_meat', 'wine', 'grain'];
      break;
    default:
      return null;
  }
  items = items.filter((id) => !!ITEMS[id] && inStock(s, id));
  return { items, sellMult: clamp(Math.round((sell + (npc.shop === 'general' ? 0 : 0.03)) * 100) / 100, 0.4, 0.5) };
}
