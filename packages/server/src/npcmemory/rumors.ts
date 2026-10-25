/**
 * Rumors and gossip. A rumor is a structured fact about the world (never free text) that settlements learn, retell and
 * distort. Everything here is abstract: knowledge lives per settlement (with the list of NPCs there who know it), messengers
 * travel along roads with a delay proportional to distance, every hop may garble the story, and rumors fade.
 *
 * Pure: depends only on a `SpreadEnv` (roads, gossip levels, NPC lists) and a seeded `Rng`, so it is fully testable.
 */
import type { DlgDeed, DlgRumorKind } from '@murim/shared';
import { Rng } from '@murim/shared';
import type { Db } from '../db';
import { RUMOR, type Importance } from './tuning';

export interface RumorFacts {
  kind: DlgRumorKind;
  /** Settlement ids. */
  place?: number;
  place2?: number;
  who?: string;
  /** Faction ids. */
  faction?: string;
  faction2?: string;
  n?: number;
  deed?: DlgDeed;
  /** -2 (played down) .. +2 (blown up). */
  sev: number;
}

export interface Knowledge {
  /** World hour this settlement learned its version. */
  since: number;
  /** How reliable this version is, 0..1. */
  truth: number;
  facts: RumorFacts;
  hops: number;
  /** NPCs of this settlement who know it. */
  npcs: number[];
  from?: number;
}

export interface Flight {
  to: number;
  from: number;
  arrive: number;
  facts: RumorFacts;
  truth: number;
  hops: number;
  retries: number;
}

export type RumorTopic = 'chronicle' | 'player' | 'local';

export interface Rumor {
  id: number;
  topic: RumorTopic;
  kind: DlgRumorKind;
  importance: Importance;
  /** Character ids (player deeds) or NPC ids the story is about. */
  subjectIds: number[];
  originSettlement: number;
  bornHour: number;
  expiresHour: number;
  /** Truth of the story as first told. */
  truth: number;
  /** Number of settlements that know a version. */
  spread: number;
  facts: RumorFacts;
  known: Record<number, Knowledge>;
  flights: Flight[];
  /** Dedupe key. */
  key: string;
}

export type RoadState = 'open' | 'perilous' | 'blocked';

export interface SpreadEnv {
  neighbors(id: number): number[];
  distance(a: number, b: number): number;
  /** Open, perilous (an end is besieged: a few messengers slip through, slowly) or blocked (Blight road, or an end has fallen). */
  road(a: number, b: number): RoadState;
  /** Settlement can receive news (not fallen). */
  alive(id: number): boolean;
  /** Mean gossip level of the settlement's NPCs, about 0.1..1.4. */
  gossip(id: number): number;
  npcs(id: number): { id: number; traits: readonly string[]; role: string }[];
  factionIds(): readonly string[];
  settlementIds(): readonly number[];
}

// ---------------------------------------------------------------------------
// Gossip and distortion rules
// ---------------------------------------------------------------------------

const TRAIT_GOSSIP: Record<string, number> = { cheerful: 0.4, boastful: 0.3, cunning: 0.2, kind: 0.1, superstitious: 0.15, greedy: 0.05, honest: -0.05, weary: -0.1, scholarly: -0.05, devout: 0, stern: -0.25, gruff: -0.3 };
const ROLE_GOSSIP: Record<string, number> = { innkeeper: 0.4, wanderer: 0.35, merchant: 0.25, villager: 0.05, physician: 0.05, alchemist: 0, smith: 0, elder: -0.05, guard: -0.1, master: -0.2, legend: -0.3 };

/** How much an NPC gossips, 0.05..1.4 (0.5 is average). */
export function gossipiness(traits: readonly string[], role: string): number {
  let g = 0.5 + (ROLE_GOSSIP[role] ?? 0);
  for (const t of traits) g += TRAIT_GOSSIP[t] ?? 0;
  return Math.max(0.05, Math.min(1.4, g));
}

const EXAGGERATORS = new Set(['boastful', 'cheerful', 'superstitious']);
const SOFTENERS = new Set(['weary', 'stern', 'kind']);
const CAREFUL = new Set(['honest', 'scholarly']);
const VAGUE_WHO = ['someone of note', 'a stranger', 'a fighter nobody could name'];

/** Outcome flips when a story is blown up (+2) or played down (-2) twice. */
const ESCALATE: Partial<Record<DlgRumorKind, DlgRumorKind>> = { siege: 'captured', hollowSiege: 'fell', held: 'siege', hardTimes: 'famine', famine: 'fell', plague: 'fell' };
const SOFTEN: Partial<Record<DlgRumorKind, DlgRumorKind>> = { fell: 'hollowSiege', captured: 'siege', famine: 'hardTimes', plague: 'hardTimes', siege: 'held', hollowSiege: 'held' };

export interface Distorted {
  facts: RumorFacts;
  truthLoss: number;
  changed: boolean;
}

/**
 * Retell a story through a teller with these traits. Always costs a little truth; sometimes garbles the details: numbers
 * grow or shrink, the outcome is exaggerated or softened, names get vague, factions get mixed up.
 */
export function distortFacts(facts: RumorFacts, tellerTraits: readonly string[], rng: Rng, factionIds: readonly string[] = []): Distorted {
  const out: RumorFacts = { ...facts };
  let loss = RUMOR.hopTruthLoss;
  const exagg = tellerTraits.filter((t) => EXAGGERATORS.has(t)).length + (tellerTraits.includes('cunning') ? 0.5 : 0);
  const soft = tellerTraits.filter((t) => SOFTENERS.has(t)).length;
  const careful = tellerTraits.some((t) => CAREFUL.has(t));
  const p = RUMOR.distortChance * (1 + 0.5 * exagg + 0.25 * soft) * (careful ? 0.4 : 1);
  if (!rng.chance(Math.min(0.95, p))) return { facts: out, truthLoss: loss, changed: false };

  const up = exagg > soft ? true : soft > exagg ? false : rng.chance(0.5);
  const options: string[] = [];
  if (out.n !== undefined) options.push('n', 'n');
  options.push('sev');
  if (out.who) options.push('who');
  if (out.faction && factionIds.length > 1) options.push('faction');
  const pick = rng.pick(options);
  if (pick === 'n' && out.n !== undefined) {
    out.n = Math.max(1, Math.round(out.n * (up ? rng.float(1.3, 2.2) : rng.float(0.55, 0.85))));
  } else if (pick === 'sev') {
    out.sev = Math.max(-2, Math.min(2, out.sev + (up ? 1 : -1)));
    if (out.sev === 2 && ESCALATE[out.kind]) {
      out.kind = ESCALATE[out.kind]!;
      out.sev = 0;
      loss += 0.2;
    } else if (out.sev === -2 && SOFTEN[out.kind]) {
      out.kind = SOFTEN[out.kind]!;
      out.sev = 0;
      loss += 0.2;
    }
  } else if (pick === 'who') {
    out.who = rng.pick(VAGUE_WHO);
  } else if (pick === 'faction') {
    const others = factionIds.filter((f) => f !== out.faction && f !== out.faction2);
    if (others.length) out.faction = rng.pick(others);
  }
  loss += rng.float(RUMOR.distortTruthLoss[0], RUMOR.distortTruthLoss[1]);
  return { facts: out, truthLoss: loss, changed: true };
}

// ---------------------------------------------------------------------------
// Words for numbers and ages (used when filling rumor slots)
// ---------------------------------------------------------------------------

export function numberWord(n: number): string {
  if (n <= 1) return 'one';
  if (n <= 4) return ['two', 'three', 'four'][n - 2];
  if (n <= 7) return 'a handful of';
  if (n <= 14) return 'a dozen or so';
  if (n <= 29) return 'a score or more';
  if (n <= 59) return 'several dozen';
  if (n <= 120) return 'a hundred or so';
  return 'hundreds of';
}

export function ageWord(hours: number): string {
  if (hours < 4) return 'only a few hours ago';
  if (hours < 20) return 'earlier today';
  if (hours < 40) return 'yesterday';
  if (hours < 24 * 5) return `${Math.max(2, Math.round(hours / 24))} days ago`;
  if (hours < 24 * 12) return 'last week';
  return 'a while ago';
}

// ---------------------------------------------------------------------------
// The mill
// ---------------------------------------------------------------------------

type StoreDb = Pick<Db, 'run' | 'all' | 'get' | 'transaction'>;

export interface NewRumor {
  topic: RumorTopic;
  facts: RumorFacts;
  importance: Importance;
  subjectIds?: number[];
  origin: number;
  hour: number;
  truth?: number;
  /** Extra dedupe info; rumors with the same key born within `dedupeHours` are merged away. */
  key?: string;
}

export interface Tellable {
  rumor: Rumor;
  facts: RumorFacts;
  truth: number;
  since: number;
  score: number;
}

const DEDUPE_HOURS = 36;

export class RumorMill {
  readonly rumors = new Map<number, Rumor>();
  private nextId = 1;
  private readonly dirty = new Set<number>();
  private readonly gone = new Set<number>();

  constructor(
    private readonly db: StoreDb | null,
    readonly rng: Rng,
  ) {}

  load(): void {
    if (!this.db) return;
    for (const r of this.db.all<{ id: number; json: string }>('SELECT id, json FROM nm_rumor')) {
      try {
        const rumor = JSON.parse(r.json) as Rumor;
        this.rumors.set(rumor.id, rumor);
        this.nextId = Math.max(this.nextId, rumor.id + 1);
      } catch {
        this.db.run('DELETE FROM nm_rumor WHERE id = ?', r.id);
      }
    }
    const meta = this.db.get<{ value: string }>("SELECT value FROM nm_meta WHERE key = 'nextRumorId'");
    if (meta) this.nextId = Math.max(this.nextId, Number(meta.value) || 1);
  }

  flush(): void {
    if (!this.db) return;
    if (this.dirty.size === 0 && this.gone.size === 0) return;
    const db = this.db;
    db.transaction(() => {
      for (const id of this.dirty) {
        const r = this.rumors.get(id);
        if (r) db.run('INSERT OR REPLACE INTO nm_rumor (id, json) VALUES (?, ?)', id, JSON.stringify(r));
      }
      for (const id of this.gone) db.run('DELETE FROM nm_rumor WHERE id = ?', id);
      db.run("INSERT OR REPLACE INTO nm_meta (key, value) VALUES ('nextRumorId', ?)", String(this.nextId));
    });
    this.dirty.clear();
    this.gone.clear();
  }

  private weightedNpcs(env: SpreadEnv, settlement: number, exclude: readonly number[], count: number): number[] {
    const pool = env.npcs(settlement).filter((n) => !exclude.includes(n.id));
    const picked: number[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = this.pickIndex(pool.map((n) => gossipiness(n.traits, n.role)));
      picked.push(pool[idx].id);
      pool.splice(idx, 1);
    }
    return picked;
  }

  private pickIndex(weights: number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Create a rumor born at `origin`. Returns null when it duplicates a fresh one. */
  add(input: NewRumor, env: SpreadEnv): Rumor | null {
    const key = input.key ?? `${input.facts.kind}:${input.facts.place ?? '-'}:${input.facts.place2 ?? '-'}:${input.facts.faction ?? '-'}:${input.facts.who ?? '-'}`;
    for (const r of this.rumors.values()) if (r.key === key && input.hour - r.bornHour < DEDUPE_HOURS) return null;
    const life = RUMOR.lifespanHours[input.importance] ?? RUMOR.lifespanHours[1];
    const truth = input.truth ?? (input.importance >= 2 ? 0.95 : 0.85);
    const rumor: Rumor = {
      id: this.nextId++,
      topic: input.topic,
      kind: input.facts.kind,
      importance: input.importance,
      subjectIds: input.subjectIds ?? [],
      originSettlement: input.origin,
      bornHour: input.hour,
      expiresHour: input.hour + Math.round(life * this.rng.float(0.85, 1.2)),
      truth,
      spread: 0,
      facts: { ...input.facts },
      known: {},
      flights: [],
      key,
    };
    if (env.alive(input.origin)) {
      this.learn(rumor, input.origin, { since: input.hour, truth, facts: rumor.facts, hops: 0, npcs: this.weightedNpcs(env, input.origin, [], 2 + this.rng.int(0, 2)) });
    } else {
      // The place is gone (fallen): news leaves with the survivors, to the nearest living neighbour.
      const near = env
        .neighbors(input.origin)
        .filter((n) => env.alive(n))
        .sort((a, b) => env.distance(input.origin, a) - env.distance(input.origin, b))[0];
      rumor.known[input.origin] = { since: input.hour, truth, facts: rumor.facts, hops: 0, npcs: [] };
      rumor.spread = 1;
      if (near !== undefined) rumor.flights.push({ to: near, from: input.origin, arrive: input.hour + this.delay(env, input.origin, near, 'open'), facts: { ...rumor.facts }, truth: truth - RUMOR.hopTruthLoss, hops: 1, retries: 0 });
    }
    this.rumors.set(rumor.id, rumor);
    this.dirty.add(rumor.id);
    this.trim(input.hour);
    return rumor;
  }

  private learn(rumor: Rumor, settlement: number, k: Knowledge): void {
    if (!rumor.known[settlement]) rumor.spread++;
    rumor.known[settlement] = k;
    this.dirty.add(rumor.id);
  }

  private delay(env: SpreadEnv, a: number, b: number, state: RoadState): number {
    const base = env.distance(a, b) / RUMOR.tilesPerHour;
    const j = this.rng.float(RUMOR.delayJitter[0], RUMOR.delayJitter[1]);
    return Math.max(1, Math.ceil(base * j * (state === 'perilous' ? RUMOR.besiegedDelay : 1)));
  }

  /** Keep at most `maxRumors`: the least interesting (low importance, nearly expired) goes first. */
  private trim(hour: number): void {
    while (this.rumors.size > RUMOR.maxRumors) {
      let worst: Rumor | null = null;
      let worstScore = Infinity;
      for (const r of this.rumors.values()) {
        const left = Math.max(0, r.expiresHour - hour) / Math.max(1, r.expiresHour - r.bornHour);
        const score = r.importance * 2 + left * 2 + Math.min(3, r.spread) * 0.3;
        if (score < worstScore) {
          worstScore = score;
          worst = r;
        }
      }
      if (!worst) return;
      this.remove(worst.id);
    }
  }

  private remove(id: number): void {
    this.rumors.delete(id);
    this.dirty.delete(id);
    this.gone.add(id);
  }

  /** Advance one world hour: arrivals, in-town diffusion, new messengers, expiry. */
  stepHour(env: SpreadEnv, hour: number): { sent: number; arrived: number; expired: number } {
    let sent = 0;
    let arrived = 0;
    let expired = 0;
    for (const rumor of [...this.rumors.values()]) {
      if (hour >= rumor.expiresHour) {
        this.remove(rumor.id);
        expired++;
        continue;
      }
      let changed = false;
      // 1. messengers arriving
      if (rumor.flights.length) {
        const rest: Flight[] = [];
        for (const f of rumor.flights) {
          if (f.arrive > hour) {
            rest.push(f);
            continue;
          }
          if (rumor.known[f.to] || !env.alive(f.to)) {
            changed = true;
            continue;
          }
          if (env.road(f.from, f.to) === 'blocked') {
            if (f.retries < RUMOR.maxRetries) rest.push({ ...f, retries: f.retries + 1, arrive: hour + RUMOR.retryHours });
            changed = true;
            continue;
          }
          this.learn(rumor, f.to, { since: hour, truth: f.truth, facts: f.facts, hops: f.hops, npcs: this.weightedNpcs(env, f.to, [], 1 + this.rng.int(0, 1)), from: f.from });
          arrived++;
          changed = true;
        }
        rumor.flights = rest;
      }
      const maxHops = RUMOR.maxHops[rumor.importance] ?? 1;
      for (const sidStr of Object.keys(rumor.known)) {
        const sid = Number(sidStr);
        const k = rumor.known[sid];
        const gossip = env.gossip(sid);
        // 2. one more NPC in town hears it
        if (env.alive(sid) && k.npcs.length < RUMOR.maxKnowers && this.rng.chance(RUMOR.inTownRate * Math.min(1.2, gossip))) {
          const more = this.weightedNpcs(env, sid, k.npcs, 1);
          if (more.length) {
            k.npcs.push(more[0]);
            changed = true;
          }
        }
        // 3. a messenger leaves
        if (k.hops >= maxHops || hour - k.since < RUMOR.holdHours) continue;
        for (const n of env.neighbors(sid)) {
          if (rumor.known[n] || rumor.flights.some((f) => f.to === n) || !env.alive(n)) continue;
          const state = env.road(sid, n);
          if (state === 'blocked') continue;
          const p = RUMOR.travelRate * Math.min(1.4, gossip + 0.2) * (state === 'perilous' ? RUMOR.besiegedRate : 1);
          if (!this.rng.chance(p)) continue;
          const tellers = k.npcs.length ? env.npcs(sid).filter((x) => k.npcs.includes(x.id)) : env.npcs(sid);
          const teller = tellers.length ? tellers[this.pickIndex(tellers.map((x) => gossipiness(x.traits, x.role)))] : undefined;
          const d = distortFacts(k.facts, teller?.traits ?? [], this.rng, env.factionIds());
          const truth = k.truth - d.truthLoss;
          if (truth < RUMOR.minTruth) continue;
          rumor.flights.push({ to: n, from: sid, arrive: hour + this.delay(env, sid, n, state), facts: d.facts, truth, hops: k.hops + 1, retries: 0 });
          sent++;
          changed = true;
        }
      }
      if (changed) this.dirty.add(rumor.id);
    }
    return { sent, arrived, expired };
  }

  /** Two NPCs of a settlement chatted: each passes on what the other does not know yet. */
  chat(a: number, b: number, settlement: number, hour: number): number {
    let shared = 0;
    for (const rumor of this.rumors.values()) {
      const k = rumor.known[settlement];
      if (!k || hour >= rumor.expiresHour) continue;
      const aKnows = k.npcs.includes(a);
      const bKnows = k.npcs.includes(b);
      if (aKnows === bKnows) continue;
      if (!this.rng.chance(RUMOR.chatShare)) continue;
      if (k.npcs.length >= RUMOR.maxKnowers) continue;
      k.npcs.push(aKnows ? b : a);
      shared++;
      this.dirty.add(rumor.id);
    }
    return shared;
  }

  /** Rumors an NPC knows, best to tell first. */
  tellable(settlement: number, npcId: number, hour: number, subjectChar?: number): Tellable[] {
    const out: Tellable[] = [];
    for (const rumor of this.rumors.values()) {
      const k = rumor.known[settlement];
      if (!k || !k.npcs.includes(npcId) || hour >= rumor.expiresHour) continue;
      const left = (rumor.expiresHour - hour) / Math.max(1, rumor.expiresHour - rumor.bornHour);
      let score = rumor.importance * 3 + left * 2 + k.truth + (k.facts.place === settlement || k.facts.place2 === settlement ? 2.5 : 0) + Math.max(0, 2 - (hour - k.since) / 24);
      if (subjectChar !== undefined && rumor.subjectIds.includes(subjectChar)) score += 3;
      out.push({ rumor, facts: k.facts, truth: k.truth, since: k.since, score });
    }
    return out.sort((x, y) => y.score - x.score || x.rumor.id - y.rumor.id);
  }

  /** Does `settlement` know a version of any rumor about this player? */
  aboutPlayer(charId: number, settlement: number): Rumor[] {
    return [...this.rumors.values()].filter((r) => r.subjectIds.includes(charId) && r.known[settlement]);
  }

  size(): number {
    return this.rumors.size;
  }
}

export const RUMOR_MILL_VERSION = 1;
