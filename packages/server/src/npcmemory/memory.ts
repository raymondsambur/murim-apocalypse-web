/**
 * Structured memory of players: what towns (collectively) and individual NPCs remember a player for.
 *
 * Facts, never free text: `{subject, kind, place, magnitude, atWorldHour, weight}`. Records are aggregated per
 * (place x player x kind) for towns and (npc x player x kind) for individuals; weights decay exponentially with world time
 * (half-life per kind) and are decayed lazily on read. Persisted in `nm_town` / `nm_personal`, bounded by pruning.
 */
import { DLG_DEEDS, type DlgDeed, type DlgDeedRef, type DlgStanding } from '@murim/shared';
import type { Db } from '../db';
import { NPCMEM } from './tuning';

export type MemoryKind = DlgDeed | 'talked';
export const MEMORY_KINDS: readonly MemoryKind[] = [...DLG_DEEDS, 'talked'];

export type Valence = 'good' | 'bad' | 'fear' | 'neutral';
export interface KindDef {
  valence: Valence;
  /** Weight added per unit of magnitude (sub-linear, see `weightFor`). */
  unit: number;
  /** Magnitude at which one record stops growing. */
  cap: number;
  halfLifeHours: number;
}

const D = 24;
export const KIND_DEFS: Record<MemoryKind, KindDef> = {
  killedBandits: { valence: 'good', unit: 0.9, cap: 12, halfLifeHours: D * 14 },
  killedHollows: { valence: 'good', unit: 1.0, cap: 12, halfLifeHours: D * 14 },
  savedTown: { valence: 'good', unit: 7, cap: 4, halfLifeHours: D * 45 },
  deliveredGoods: { valence: 'good', unit: 1.6, cap: 6, halfLifeHours: D * 20 },
  completedMission: { valence: 'good', unit: 1.3, cap: 8, halfLifeHours: D * 20 },
  failedMission: { valence: 'bad', unit: 1.2, cap: 5, halfLifeHours: D * 12 },
  duelWon: { valence: 'fear', unit: 1.2, cap: 6, halfLifeHours: D * 20 },
  duelLost: { valence: 'bad', unit: 0.3, cap: 4, halfLifeHours: D * 10 },
  sectFounded: { valence: 'good', unit: 2.5, cap: 1, halfLifeHours: D * 60 },
  rankUp: { valence: 'good', unit: 1.5, cap: 3, halfLifeHours: D * 40 },
  gift: { valence: 'good', unit: 1.8, cap: 5, halfLifeHours: D * 25 },
  insult: { valence: 'bad', unit: 2.5, cap: 4, halfLifeHours: D * 25 },
  purified: { valence: 'good', unit: 3, cap: 4, halfLifeHours: D * 40 },
  sealedHeart: { valence: 'good', unit: 14, cap: 2, halfLifeHours: D * 80 },
  diedNearby: { valence: 'neutral', unit: 0.4, cap: 3, halfLifeHours: D * 10 },
  talked: { valence: 'neutral', unit: 0.25, cap: 12, halfLifeHours: D * 30 },
};

export function isMemoryKind(k: string): k is MemoryKind {
  return k in KIND_DEFS;
}

/** Weight of one deed of `magnitude` units (sub-linear: ten kills are not ten times one kill). */
export function weightFor(kind: MemoryKind, magnitude = 1): number {
  const d = KIND_DEFS[kind];
  return d.unit * Math.pow(Math.max(0, Math.min(magnitude, d.cap)), 0.8);
}

export interface Row {
  /** Weight as of `hour`. */
  weight: number;
  /** World hour of the last update. */
  hour: number;
  /** Cumulative magnitude (never decays; used for milestones and "N times"). */
  count: number;
  /** Place of the deed for personal rows (town rows repeat their key). */
  place: number;
}

export function decayedWeight(row: Row, kind: MemoryKind, now: number): number {
  const age = Math.max(0, now - row.hour);
  return row.weight * Math.pow(0.5, age / (KIND_DEFS[kind].halfLifeHours || NPCMEM.halfLifeHours));
}

export interface Sums {
  good: number;
  bad: number;
  fear: number;
  neutral: number;
}

/** How a town regards a player given the weighted sums of what it remembers. */
export function standingOf(s: Sums): DlgStanding {
  const T = NPCMEM.standing;
  const presence = s.good + s.bad + s.fear + s.neutral;
  if (presence < T.noted) return 'unknown';
  if (s.fear >= T.feared && s.fear > s.good * 0.8 && s.fear >= s.bad) return 'feared';
  if (s.bad >= T.despised && s.bad > s.good * 1.1) return 'despised';
  const net = s.good - s.bad;
  if (net >= T.honoured) return 'honoured';
  if (net >= T.welcomed) return 'welcomed';
  return 'noted';
}

export interface RememberInput {
  subject: number;
  kind: MemoryKind;
  place: number;
  magnitude?: number;
  /** When set, also remembered personally by this NPC. */
  npcId?: number;
  atHour: number;
}

export interface Recall {
  /** Number of separate visits / conversations. */
  talks: number;
  lastHour: number | null;
  deeds: DlgDeedRef[];
  /** 0..1: how well this NPC knows the player. */
  familiarity: number;
}

type StoreDb = Pick<Db, 'run' | 'all' | 'transaction'>;

const tk = (place: number, subject: number, kind: string): string => `${place}|${subject}|${kind}`;

export class MemoryStore {
  readonly town = new Map<string, Row>();
  readonly personal = new Map<string, Row>();
  private readonly dirtyTown = new Set<string>();
  private readonly dirtyPersonal = new Set<string>();
  private readonly goneTown = new Set<string>();
  private readonly gonePersonal = new Set<string>();

  constructor(private readonly db: StoreDb | null) {}

  load(): void {
    if (!this.db) return;
    for (const r of this.db.all<{ place: number; subject: number; kind: string; weight: number; hour: number; count: number }>('SELECT place, subject, kind, weight, hour, count FROM nm_town')) {
      if (isMemoryKind(r.kind)) this.town.set(tk(r.place, r.subject, r.kind), { weight: r.weight, hour: r.hour, count: r.count, place: r.place });
    }
    for (const r of this.db.all<{ npc: number; subject: number; kind: string; weight: number; hour: number; count: number; place: number }>('SELECT npc, subject, kind, weight, hour, count, place FROM nm_personal')) {
      if (isMemoryKind(r.kind)) this.personal.set(tk(r.npc, r.subject, r.kind), { weight: r.weight, hour: r.hour, count: r.count, place: r.place });
    }
  }

  /** Write dirty rows. Cheap when nothing changed. */
  flush(): void {
    if (!this.db) return;
    if (this.dirtyTown.size + this.dirtyPersonal.size + this.goneTown.size + this.gonePersonal.size === 0) return;
    const db = this.db;
    db.transaction(() => {
      for (const k of this.dirtyTown) {
        const r = this.town.get(k);
        const [place, subject, kind] = k.split('|');
        if (r) db.run('INSERT OR REPLACE INTO nm_town (place, subject, kind, weight, hour, count) VALUES (?, ?, ?, ?, ?, ?)', Number(place), Number(subject), kind, r.weight, r.hour, r.count);
      }
      for (const k of this.goneTown) {
        const [place, subject, kind] = k.split('|');
        db.run('DELETE FROM nm_town WHERE place = ? AND subject = ? AND kind = ?', Number(place), Number(subject), kind);
      }
      for (const k of this.dirtyPersonal) {
        const r = this.personal.get(k);
        const [npc, subject, kind] = k.split('|');
        if (r) db.run('INSERT OR REPLACE INTO nm_personal (npc, subject, kind, weight, hour, count, place) VALUES (?, ?, ?, ?, ?, ?, ?)', Number(npc), Number(subject), kind, r.weight, r.hour, r.count, r.place);
      }
      for (const k of this.gonePersonal) {
        const [npc, subject, kind] = k.split('|');
        db.run('DELETE FROM nm_personal WHERE npc = ? AND subject = ? AND kind = ?', Number(npc), Number(subject), kind);
      }
    });
    this.dirtyTown.clear();
    this.dirtyPersonal.clear();
    this.goneTown.clear();
    this.gonePersonal.clear();
  }

  private bump(map: Map<string, Row>, dirty: Set<string>, key: string, kind: MemoryKind, place: number, magnitude: number, now: number): { total: number; before: number } {
    const def = KIND_DEFS[kind];
    const prev = map.get(key);
    const cur = prev ? decayedWeight(prev, kind, now) : 0;
    const before = prev?.count ?? 0;
    const maxWeight = def.unit * Math.pow(def.cap, 0.8) * 1.25;
    const row: Row = { weight: Math.min(maxWeight, cur + weightFor(kind, magnitude)), hour: now, count: before + magnitude, place };
    map.set(key, row);
    dirty.add(key);
    return { total: row.count, before };
  }

  /**
   * Record a deed. Returns `milestone: true` when the cumulative magnitude (place x player x kind) just crossed a threshold
   * worth a rumor.
   */
  remember(rec: RememberInput): { milestone: boolean; total: number } {
    const magnitude = Math.max(0.01, rec.magnitude ?? 1);
    let result = { total: 0, before: 0 };
    if (rec.kind !== 'talked') result = this.bump(this.town, this.dirtyTown, tk(rec.place, rec.subject, rec.kind), rec.kind, rec.place, magnitude, rec.atHour);
    if (rec.npcId !== undefined) {
      const r = this.bump(this.personal, this.dirtyPersonal, tk(rec.npcId, rec.subject, rec.kind), rec.kind, rec.place, magnitude, rec.atHour);
      if (rec.kind === 'talked') result = r;
    }
    const marks = NPCMEM.rumorMilestones[rec.kind] ?? NPCMEM.rumorMilestones.default;
    const milestone = rec.kind !== 'talked' && marks.some((m) => result.before < m && result.total >= m);
    return { milestone, total: result.total };
  }

  townSums(place: number, subject: number, now: number): Sums {
    const s: Sums = { good: 0, bad: 0, fear: 0, neutral: 0 };
    for (const kind of MEMORY_KINDS) {
      if (kind === 'talked') continue;
      const row = this.town.get(tk(place, subject, kind));
      if (!row) continue;
      s[KIND_DEFS[kind].valence] += decayedWeight(row, kind, now);
    }
    return s;
  }

  townStanding(place: number, subject: number, now: number): { standing: DlgStanding; renown: number; sums: Sums } {
    const sums = this.townSums(place, subject, now);
    return { standing: standingOf(sums), renown: Math.round((sums.good - sums.bad + sums.fear * 0.25) * 10) / 10, sums };
  }

  /** What this town remembers, strongest first (decayed weights above the prune line). */
  townDeeds(place: number, subject: number, now: number): DlgDeedRef[] {
    const out: DlgDeedRef[] = [];
    for (const kind of MEMORY_KINDS) {
      if (kind === 'talked') continue;
      const row = this.town.get(tk(place, subject, kind));
      if (!row) continue;
      const w = decayedWeight(row, kind, now);
      if (w >= NPCMEM.pruneBelow * 4) out.push({ kind, weight: w, ageHours: Math.max(0, now - row.hour) });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  recall(npcId: number, subject: number, now: number): Recall {
    const deeds: DlgDeedRef[] = [];
    let talks = 0;
    let last: number | null = null;
    for (const kind of MEMORY_KINDS) {
      const row = this.personal.get(tk(npcId, subject, kind));
      if (!row) continue;
      last = last === null ? row.hour : Math.max(last, row.hour);
      if (kind === 'talked') {
        talks = Math.round(row.count);
        continue;
      }
      const w = decayedWeight(row, kind, now);
      if (w >= NPCMEM.pruneBelow * 4) deeds.push({ kind, weight: w, ageHours: Math.max(0, now - row.hour) });
    }
    deeds.sort((a, b) => b.weight - a.weight);
    return { talks, lastHour: last, deeds, familiarity: Math.min(1, talks / 12 + deeds.length * 0.15) };
  }

  /** A conversation counts as one visit per `talkCooldownHours`. Returns the visit count. */
  noteTalk(npcId: number, subject: number, place: number, now: number): number {
    const key = tk(npcId, subject, 'talked');
    const row = this.personal.get(key);
    if (row && now - row.hour < NPCMEM.talkCooldownHours) return Math.round(row.count);
    this.remember({ subject, kind: 'talked', place, npcId, atHour: now });
    return Math.round(this.personal.get(key)?.count ?? 1);
  }

  /** Drop records that decayed away and enforce the row caps (lowest current weight first). */
  prune(now: number): number {
    let dropped = 0;
    const sweep = (map: Map<string, Row>, gone: Set<string>, dirty: Set<string>, cap: number): void => {
      const live: [string, number][] = [];
      for (const [k, row] of map) {
        const kind = k.slice(k.lastIndexOf('|') + 1) as MemoryKind;
        const w = decayedWeight(row, kind, now);
        if (w < NPCMEM.pruneBelow) {
          map.delete(k);
          gone.add(k);
          dirty.delete(k);
          dropped++;
        } else live.push([k, w]);
      }
      if (live.length > cap) {
        live.sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < live.length - cap; i++) {
          map.delete(live[i][0]);
          gone.add(live[i][0]);
          dirty.delete(live[i][0]);
          dropped++;
        }
      }
    };
    sweep(this.town, this.goneTown, this.dirtyTown, NPCMEM.maxTownRows);
    sweep(this.personal, this.gonePersonal, this.dirtyPersonal, NPCMEM.maxPersonalRows);
    return dropped;
  }

  size(): { town: number; personal: number } {
    return { town: this.town.size, personal: this.personal.size };
  }
}

export const MEMORY_MIGRATIONS: readonly string[] = [
  `CREATE TABLE nm_town (
     place INTEGER NOT NULL, subject INTEGER NOT NULL, kind TEXT NOT NULL,
     weight REAL NOT NULL, hour REAL NOT NULL, count REAL NOT NULL,
     PRIMARY KEY (place, subject, kind)
   );
   CREATE TABLE nm_personal (
     npc INTEGER NOT NULL, subject INTEGER NOT NULL, kind TEXT NOT NULL,
     weight REAL NOT NULL, hour REAL NOT NULL, count REAL NOT NULL, place INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (npc, subject, kind)
   );
   CREATE TABLE nm_rumor (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
   CREATE TABLE nm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];
