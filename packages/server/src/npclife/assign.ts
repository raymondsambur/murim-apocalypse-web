/**
 * Home and workplace assignment. Pure functions of the NPC record and the current occupancy, so the same
 * roster always gets the same homes (nothing is persisted).
 */
import type { NpcState } from '@murim/shared';
import { NPCLIFE_TUNING } from './tuning';
import type { Place, PlaceKind, SettlementPlaces } from './places';

export function hash32(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Deterministic float in [0, 1) from two ints. */
export function hash01(a: number, b = 0): number {
  return hash32(a, b) / 4294967296;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function surname(npc: NpcState): string {
  return npc.name.split(' ')[0] ?? npc.name;
}

/** Who sleeps where: placeId -> npc ids. */
export type HomeBook = Map<string, Set<number>>;

function capacity(p: Place): number {
  return p.kind === 'barracks' ? NPCLIFE_TUNING.barracksCapacity : p.kind === 'inn' ? 6 : NPCLIFE_TUNING.houseCapacity;
}

function load(book: HomeBook, p: Place): number {
  return book.get(p.id)?.size ?? 0;
}

/** Pick a home. `peers` are the other living NPCs of the settlement (for family / surname grouping). */
export function chooseHome(sp: SettlementPlaces, npc: NpcState, book: HomeBook, peers: readonly NpcState[]): Place {
  const inns = sp.byKind('inn');
  if ((npc.role === 'innkeeper' || npc.role === 'legend' || npc.role === 'wanderer') && inns.length) {
    return inns.reduce((best, p) => (load(book, p) < load(book, best) ? p : best));
  }
  if (npc.role === 'guard') {
    const barracks = sp.byKind('barracks').filter((p) => load(book, p) < capacity(p));
    if (barracks.length) return barracks.reduce((best, p) => (load(book, p) < load(book, best) ? p : best));
  }
  const pool = sp.dwellings.length ? sp.dwellings : [...sp.byKind('teahouse'), ...sp.byKind('hall'), ...sp.byKind('inn'), ...sp.byKind('barracks')];
  if (pool.length === 0) return sp.plaza;
  // Family first: a house that already holds the same surname (and has room).
  const sn = surname(npc);
  const byId = new Map(peers.map((n) => [n.id, n]));
  for (const p of pool) {
    const occ = book.get(p.id);
    if (!occ || occ.size === 0 || occ.size >= capacity(p)) continue;
    for (const id of occ) {
      const o = byId.get(id);
      if (o && o.id !== npc.id && surname(o) === sn) return p;
    }
  }
  // Otherwise the emptiest house with room (first in world order breaks ties).
  let best = pool[0];
  for (const p of pool) if (load(book, p) < load(book, best)) best = p;
  if (load(book, best) < capacity(best)) return best;
  // Every dwelling is full: bunk in a hall, tea house or the like; only then double up.
  const spare = (['teahouse', 'hall', 'dojo', 'pagoda', 'barracks', 'inn', 'warehouse'] as const).flatMap((k) => sp.byKind(k)).filter((p) => load(book, p) < capacity(p));
  if (spare.length) return spare.reduce((b, p) => (load(book, p) < load(book, b) ? p : b));
  return best;
}

export interface WorkPlan {
  work: Place | null;
  /** Patrol loop for guards. */
  posts: readonly Place[];
}

/**
 * Workplace by role. `rank` is the NPC's index among same-role peers of the settlement (by id), used to
 * spread villagers over the farm patches and to alternate where several masters share dojos.
 */
export function chooseWork(sp: SettlementPlaces, npc: NpcState, rank: number): WorkPlan {
  const first = (...kinds: PlaceKind[]): Place | null => {
    for (const k of kinds) {
      const list = sp.byKind(k);
      if (list.length) return list[rank % list.length];
    }
    return null;
  };
  switch (npc.role) {
    case 'smith':
      return { work: first('smithy', 'market') ?? sp.plaza, posts: [] };
    case 'alchemist':
    case 'physician':
      return { work: first('alchemy', 'herb', 'market') ?? sp.plaza, posts: [] };
    case 'merchant':
      return { work: first('market', 'warehouse') ?? sp.plaza, posts: [] };
    case 'innkeeper':
      return { work: first('inn', 'teahouse') ?? sp.plaza, posts: [] };
    case 'guard':
      return { work: sp.posts[rank % Math.max(1, sp.posts.length)] ?? sp.plaza, posts: sp.posts };
    case 'master':
      return { work: first('dojo', 'hall', 'pagoda') ?? sp.plaza, posts: [] };
    case 'elder':
      return { work: first('hall', 'pagoda', 'teahouse') ?? sp.plaza, posts: [] };
    case 'legend':
    case 'wanderer':
      return { work: sp.plaza, posts: [] };
    default: {
      // Villagers: whole families farm (by surname), some gather herbs or mine; the rest keep house (no workplace).
      const herb = sp.byKind('herb');
      const mines = sp.byKind('mine');
      const sn = strHash(surname(npc));
      if (sp.farms.length && (hash01(sn, 41) < 0.6 || rank === 0)) return { work: sp.farms[sn % sp.farms.length], posts: [] };
      if (herb.length && hash01(npc.id, 42) < 0.5) return { work: herb[rank % herb.length], posts: [] };
      if (mines.length && hash01(npc.id, 43) < 0.25) return { work: mines[rank % mines.length], posts: [] };
      return { work: null, posts: [] };
    }
  }
}
