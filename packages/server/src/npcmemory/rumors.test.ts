import { Rng, type ChronicleEntry } from '@murim/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { MEMORY_MIGRATIONS } from './memory';
import { buildNameIndex, parseChronicle } from './parse';
import { RumorMill, distortFacts, gossipiness, type RoadState, type RumorFacts, type SpreadEnv } from './rumors';
import { RUMOR } from './tuning';

// ---------------------------------------------------------------------------
// A small fake world: 0 - 1 - 2 - 3 - 5 along a line, 4 hangs off 1.
// ---------------------------------------------------------------------------

const POS: [number, number][] = [
  [0, 0],
  [36, 0],
  [72, 0],
  [144, 0],
  [36, 60],
  [300, 0],
];
const ROADS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [1, 4],
  [3, 5],
];
const NAMES = ['Stonebridge', 'Reed Ford', 'Black Market', 'Iron Gate', 'Tea Hill', 'Far Peak'];

interface FakeOpts {
  roads?: [number, number][];
  pos?: [number, number][];
  road?: (a: number, b: number) => RoadState;
  alive?: (id: number) => boolean;
  traits?: (sid: number, idx: number) => string[];
  npcsPer?: number;
}

function fakeEnv(o: FakeOpts = {}): SpreadEnv {
  const pos = o.pos ?? POS;
  const roads = o.roads ?? ROADS;
  const adj = new Map<number, number[]>();
  pos.forEach((_, i) => adj.set(i, []));
  for (const [a, b] of roads) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const per = o.npcsPer ?? 6;
  const roster = (sid: number) => Array.from({ length: per }, (_, i) => ({ id: sid * 100 + i, traits: o.traits?.(sid, i) ?? ['kind'], role: i === 0 ? 'innkeeper' : i === 1 ? 'guard' : 'villager' }));
  return {
    neighbors: (id) => adj.get(id) ?? [],
    distance: (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]),
    road: (a, b) => o.road?.(a, b) ?? 'open',
    alive: (id) => o.alive?.(id) ?? true,
    gossip: () => 0.8,
    npcs: roster,
    factionIds: () => ['azure', 'tiger', 'jade', 'crimson', 'blackwind'],
    settlementIds: () => pos.map((_, i) => i),
  };
}

const fell = (place = 0, over: Partial<RumorFacts> = {}): RumorFacts => ({ kind: 'fell', place, sev: 0, ...over });

const saved = { ...RUMOR, lifespanHours: { ...RUMOR.lifespanHours }, maxHops: { ...RUMOR.maxHops } };
afterEach(() => {
  Object.assign(RUMOR, saved);
  RUMOR.lifespanHours = { ...saved.lifespanHours };
  RUMOR.maxHops = { ...saved.maxHops };
});

function entry(text: string, kind: ChronicleEntry['kind'], importance: 1 | 2 | 3, settlementId?: number): ChronicleEntry {
  return { id: 1, day: 3, hour: 5, kind, text, importance, settlementId, t: 0 };
}

describe('chronicle -> rumor facts', () => {
  const idx = buildNameIndex(NAMES.map((name, id) => ({ id, name })));
  it('recognises the sim\'s own phrasing', () => {
    const cases: [string, ChronicleEntry['kind'], 1 | 2 | 3, number | undefined, string, Partial<RumorFacts>][] = [
      ['Black Market has fallen to the Blight! Few escaped.', 'blight', 3, 2, 'fell', { place: 2 }],
      ['The Black Wind Bandits lay siege to Iron Gate held by the Azure Cloud Sect.', 'faction', 2, 3, 'siege', { place: 3, faction: 'blackwind' }],
      ['Hollows pour out of the Blight and besiege Reed Ford!', 'blight', 3, 1, 'hollowSiege', { place: 1 }],
      ['Reed Ford has withstood the Hollow siege.', 'settlement', 2, 1, 'held', { place: 1 }],
      ['The Mount Tiger Fist Clan seized Iron Gate from the Jade Merchant Guild.', 'faction', 2, 3, 'captured', { place: 3, faction: 'tiger', faction2: 'jade' }],
      ['Famine grips Tea Hill.', 'economy', 2, 4, 'famine', { place: 4 }],
      ['The Azure Cloud Sect has declared war on the Crimson Lotus Cult.', 'faction', 3, undefined, 'war', { faction: 'azure', faction2: 'crimson' }],
      ['The road between Stonebridge and Reed Ford is choked by the Blight; caravans have stopped.', 'economy', 2, undefined, 'roadBlocked', { place: 0, place2: 1 }],
      ['The Blight heart near Far Peak was sealed by Hero!', 'blight', 3, undefined, 'heartSealed', { who: 'Hero', place: 5 }],
      ['Hero cleansed the Blight near Tea Hill.', 'blight', 1, undefined, 'playerDeed', { who: 'Hero', deed: 'purified', place: 4 }],
      ['Master Han Ju of Mount Tiger Fist Clan fell in the fighting.', 'npc', 2, 0, 'npcDeath', { who: 'Han Ju' }],
      ['Han Ju, the Iron Fist, is now counted among the legends of the martial world.', 'legend', 3, 0, 'legendRise', { who: 'Han Ju' }],
    ];
    for (const [text, kind, imp, sid, want, facts] of cases) {
      const p = parseChronicle(entry(text, kind, imp, sid), idx);
      expect(p, text).not.toBeNull();
      expect(p!.kind, text).toBe(want);
      expect(p!.facts, text).toMatchObject(facts);
    }
  });

  it('ignores weather, seasons and unknown lines', () => {
    expect(parseChronicle(entry('A violent storm lashes the northlands.', 'weather', 1), idx)).toBeNull();
    expect(parseChronicle(entry('Spring returns to the land.', 'season', 2), idx)).toBeNull();
    expect(parseChronicle(entry('Something nobody wrote a rule for happened.', 'settlement', 3), idx)).toBeNull();
  });
});

describe('rumor spread', () => {
  it('is born known to a few NPCs of the origin only', () => {
    const mill = new RumorMill(null, new Rng(1));
    const env = fakeEnv();
    const r = mill.add({ topic: 'chronicle', facts: fell(2), importance: 3, origin: 2, hour: 100 }, env)!;
    expect(Object.keys(r.known)).toEqual(['2']);
    expect(r.known[2].npcs.length).toBeGreaterThanOrEqual(2);
    expect(r.known[2].npcs.every((n) => Math.floor(n / 100) === 2)).toBe(true);
    expect(r.spread).toBe(1);
    expect(r.truth).toBeGreaterThan(0.9);
    // Duplicates inside the dedupe window are refused.
    expect(mill.add({ topic: 'chronicle', facts: fell(2), importance: 3, origin: 2, hour: 101 }, env)).toBeNull();
  });

  it('travels with a delay proportional to distance', () => {
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    const arrival = (target: number, seed: number): number => {
      const mill = new RumorMill(null, new Rng(seed));
      const env = fakeEnv();
      const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
      for (let h = 1; h < 600; h++) {
        mill.stepHour(env, h);
        if (r.known[target]) return h;
      }
      return Infinity;
    };
    const a1 = [1, 2, 3, 4, 5, 6].map((s) => arrival(1, s));
    const a2 = [1, 2, 3, 4, 5, 6].map((s) => arrival(2, s));
    const a5 = [1, 2, 3, 4, 5, 6].map((s) => arrival(5, s));
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    // 0->1 is 36 tiles: between 0.8x and 1.35x of 36/1.8 = 20h (+1 hour of stepping).
    for (const h of a1) {
      expect(h).toBeGreaterThanOrEqual(16);
      expect(h).toBeLessThanOrEqual(30);
    }
    expect(mean(a2)).toBeGreaterThan(mean(a1) + 10);
    expect(mean(a5)).toBeGreaterThan(mean(a2) + 60);
  });

  it('is blocked by Blight roads and fallen settlements', () => {
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    const mill = new RumorMill(null, new Rng(3));
    const env = fakeEnv({ road: (a, b) => (Math.min(a, b) === 1 && Math.max(a, b) === 2 ? 'blocked' : 'open') });
    const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
    for (let h = 1; h < 400; h++) mill.stepHour(env, h);
    expect(r.known[1]).toBeTruthy();
    expect(r.known[4]).toBeTruthy(); // the branch is open
    expect(r.known[2]).toBeUndefined();
    expect(r.known[3]).toBeUndefined();
    expect(r.known[5]).toBeUndefined();

    const mill2 = new RumorMill(null, new Rng(3));
    const env2 = fakeEnv({ alive: (id) => id !== 2 });
    const r2 = mill2.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env2)!;
    for (let h = 1; h < 400; h++) mill2.stepHour(env2, h);
    expect(r2.known[2]).toBeUndefined();
    expect(r2.known[3]).toBeUndefined();
  });

  it('a road that closes while the messenger walks holds it up, then drops it', () => {
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    let blockedFrom = Infinity;
    let now = 0;
    const env = fakeEnv({ road: (a, b) => (now >= blockedFrom && Math.min(a, b) === 0 ? 'blocked' : 'open') });
    const mill = new RumorMill(null, new Rng(9));
    const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
    mill.stepHour(env, 1);
    expect(r.flights.length).toBeGreaterThan(0);
    blockedFrom = 2;
    for (now = 2; now < 200; now++) mill.stepHour(env, now);
    expect(r.known[1]).toBeUndefined();
    expect(r.flights.filter((f) => f.from === 0)).toHaveLength(0);
  });

  it('a besieged road is slow and rarely used', () => {
    RUMOR.holdHours = 0;
    const firstArrival = (state: RoadState, seed: number): number => {
      const mill = new RumorMill(null, new Rng(seed));
      const env = fakeEnv({ road: () => state });
      const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
      for (let h = 1; h < 800; h++) {
        mill.stepHour(env, h);
        if (r.known[1]) return h;
      }
      return 800;
    };
    const seeds = Array.from({ length: 25 }, (_, i) => i + 1);
    const open = seeds.reduce((s, x) => s + firstArrival('open', x), 0) / seeds.length;
    const perilous = seeds.reduce((s, x) => s + firstArrival('perilous', x), 0) / seeds.length;
    expect(perilous).toBeGreaterThan(open * 1.8);
  });

  it('minor news stays near home, world-shaking news goes everywhere', () => {
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    const run = (importance: 1 | 2 | 3): number => {
      const mill = new RumorMill(null, new Rng(11));
      const env = fakeEnv();
      RUMOR.lifespanHours = { 1: 2000, 2: 2000, 3: 2000 };
      const r = mill.add({ topic: 'chronicle', facts: fell(0), importance, origin: 0, hour: 0 }, env)!;
      for (let h = 1; h < 1500; h++) mill.stepHour(env, h);
      return Object.keys(r.known).length;
    };
    expect(run(1)).toBe(2); // origin + one hop
    expect(run(2)).toBe(5); // up to three hops: 0, 1, 2, 4, 3 (Far Peak is four hops away)
    expect(run(3)).toBe(6);
  });

  it('truth drops with every hop', () => {
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    const mill = new RumorMill(null, new Rng(21));
    const env = fakeEnv({ traits: () => ['boastful', 'cheerful'] });
    RUMOR.lifespanHours = { 1: 2000, 2: 2000, 3: 2000 };
    const r = mill.add({ topic: 'chronicle', facts: { kind: 'hollowSiege', place: 0, n: 20, sev: 0 }, importance: 3, origin: 0, hour: 0 }, env)!;
    for (let h = 1; h < 900; h++) mill.stepHour(env, h);
    expect(r.known[5]).toBeTruthy();
    const t0 = r.known[0].truth;
    const t1 = r.known[1].truth;
    const t2 = r.known[2].truth;
    const t3 = r.known[3].truth;
    expect(t1).toBeLessThan(t0);
    expect(t2).toBeLessThan(t1);
    expect(t3).toBeLessThan(t2);
    expect(r.known[3].hops).toBe(3);
    // The origin keeps the facts exactly as they were.
    expect(r.known[0].facts.n).toBe(20);
  });

  it('expires and fades', () => {
    const mill = new RumorMill(null, new Rng(2));
    const env = fakeEnv();
    const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 1, origin: 0, hour: 0 }, env)!;
    expect(mill.rumors.has(r.id)).toBe(true);
    for (let h = 1; h <= r.expiresHour + 1; h++) mill.stepHour(env, h);
    expect(mill.rumors.has(r.id)).toBe(false);
    expect(mill.size()).toBe(0);
    // Importance 3 outlives importance 1.
    const a = mill.add({ topic: 'chronicle', facts: fell(1), importance: 1, origin: 1, hour: 0 }, env)!;
    const b = mill.add({ topic: 'chronicle', facts: fell(2), importance: 3, origin: 2, hour: 0 }, env)!;
    expect(b.expiresHour).toBeGreaterThan(a.expiresHour * 3);
  });

  it('caps the number of rumors, dropping the least interesting', () => {
    const mill = new RumorMill(null, new Rng(4));
    const env = fakeEnv();
    for (let i = 0; i < RUMOR.maxRumors + 40; i++) {
      mill.add({ topic: 'local', facts: { kind: 'festival', place: i % 6, who: `x${i}`, sev: 0 }, importance: 1, origin: i % 6, hour: 10 }, env);
    }
    const big = mill.add({ topic: 'chronicle', facts: fell(3), importance: 3, origin: 3, hour: 11 }, env)!;
    expect(mill.size()).toBeLessThanOrEqual(RUMOR.maxRumors);
    expect(mill.rumors.has(big.id)).toBe(true);
  });

  it('news from a fallen settlement leaves with the survivors', () => {
    const mill = new RumorMill(null, new Rng(5));
    const env = fakeEnv({ alive: (id) => id !== 3 });
    const r = mill.add({ topic: 'chronicle', facts: fell(3), importance: 3, origin: 3, hour: 0 }, env)!;
    expect(r.known[3].npcs).toEqual([]);
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0].to).toBe(2); // nearest living neighbour
    for (let h = 1; h < 200; h++) mill.stepHour(env, h);
    expect(r.known[2]).toBeTruthy();
  });
});

describe('gossip inside a settlement', () => {
  it('more NPCs hear the news over time, gossips first', () => {
    const mill = new RumorMill(null, new Rng(6));
    const env = fakeEnv({ npcsPer: 12 });
    const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
    const before = r.known[0].npcs.length;
    for (let h = 1; h < 60; h++) mill.stepHour(env, h);
    expect(r.known[0].npcs.length).toBeGreaterThan(before + 3);
    expect(r.known[0].npcs.length).toBeLessThanOrEqual(12);
    expect(new Set(r.known[0].npcs).size).toBe(r.known[0].npcs.length);
  });

  it('gossipy traits and roles gossip more', () => {
    expect(gossipiness(['cheerful', 'boastful'], 'innkeeper')).toBeGreaterThan(gossipiness([], 'villager'));
    expect(gossipiness(['gruff', 'stern'], 'guard')).toBeLessThan(gossipiness([], 'villager'));
    expect(gossipiness(['gruff', 'stern'], 'legend')).toBeGreaterThanOrEqual(0.05);
    expect(gossipiness(['cheerful', 'boastful', 'cunning'], 'innkeeper')).toBeLessThanOrEqual(1.4);
  });

  it('a chat between two NPCs can pass a rumor from one to the other', () => {
    const mill = new RumorMill(null, new Rng(8));
    const env = fakeEnv({ npcsPer: 8 });
    const r = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
    const knower = r.known[0].npcs[0];
    const stranger = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i).find((i) => !r.known[0].npcs.includes(i))!;
    let shared = 0;
    for (let i = 0; i < 40; i++) shared += mill.chat(knower, stranger, 0, 1);
    expect(shared).toBe(1);
    expect(r.known[0].npcs).toContain(stranger);
    // Chat between two NPCs who both know, or neither, changes nothing; neither does a chat elsewhere.
    expect(mill.chat(knower, stranger, 0, 1)).toBe(0);
    expect(mill.chat(900, 901, 0, 1)).toBe(0);
    expect(mill.chat(knower, 9999, 4, 1)).toBe(0);
  });

  it('tellable lists only what that NPC knows, best first, and never an expired rumor', () => {
    const mill = new RumorMill(null, new Rng(10));
    const env = fakeEnv();
    const big = mill.add({ topic: 'chronicle', facts: fell(0), importance: 3, origin: 0, hour: 0 }, env)!;
    const small = mill.add({ topic: 'local', facts: { kind: 'festival', place: 0, sev: 0 }, importance: 1, origin: 0, hour: 0 }, env)!;
    const both = big.known[0].npcs.filter((n) => small.known[0].npcs.includes(n));
    if (both.length === 0) small.known[0].npcs.push(big.known[0].npcs[0]);
    const npc = big.known[0].npcs[0];
    const list = mill.tellable(0, npc, 1);
    expect(list.map((t) => t.rumor.id)).toEqual([big.id, small.id]);
    expect(mill.tellable(0, 4242, 1)).toEqual([]);
    expect(mill.tellable(1, npc, 1)).toEqual([]);
    expect(mill.tellable(0, npc, small.expiresHour + 1).map((t) => t.rumor.id)).not.toContain(small.id);
  });
});

describe('distortion', () => {
  const trial = (traits: string[], facts: RumorFacts, n = 600) => {
    const rng = new Rng(77);
    let changed = 0;
    let sumN = 0;
    let sumLoss = 0;
    for (let i = 0; i < n; i++) {
      const d = distortFacts(facts, traits, rng, ['azure', 'tiger', 'jade']);
      if (d.changed) changed++;
      sumN += d.facts.n ?? 0;
      sumLoss += d.truthLoss;
    }
    return { changed: changed / n, meanN: sumN / n, meanLoss: sumLoss / n };
  };
  const base: RumorFacts = { kind: 'hollowSiege', place: 1, n: 20, who: 'Mu Jinran', faction: 'azure', sev: 0 };

  it('exaggerators inflate numbers, softeners shrink them', () => {
    expect(trial(['boastful', 'cheerful'], base).meanN).toBeGreaterThan(20.5);
    expect(trial(['weary', 'stern'], base).meanN).toBeLessThan(19.5);
  });

  it('honest and scholarly tellers distort far less and lose less truth', () => {
    const wild = trial(['boastful', 'cheerful'], base);
    const careful = trial(['honest', 'scholarly'], base);
    expect(careful.changed).toBeLessThan(wild.changed * 0.6);
    expect(careful.meanLoss).toBeLessThan(wild.meanLoss);
    expect(careful.meanLoss).toBeGreaterThanOrEqual(RUMOR.hopTruthLoss);
  });

  it('every retelling costs truth, even when nothing visible changes', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) expect(distortFacts(base, ['honest'], rng).truthLoss).toBeGreaterThanOrEqual(RUMOR.hopTruthLoss);
  });

  it('never mutates its input and can flip outcomes when blown up or played down', () => {
    const frozen: RumorFacts = Object.freeze({ kind: 'siege', place: 1, faction: 'azure', sev: 1 });
    const rng = new Rng(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) kinds.add(distortFacts(frozen, ['boastful', 'cheerful', 'superstitious'], rng, ['azure', 'tiger']).facts.kind);
    expect(kinds.has('captured')).toBe(true);
    expect(frozen.kind).toBe('siege');
    const soft = new Set<string>();
    const r2 = new Rng(6);
    for (let i = 0; i < 300; i++) soft.add(distortFacts({ kind: 'fell', place: 1, sev: -1 }, ['weary', 'stern', 'kind'], r2).facts.kind);
    expect(soft.has('hollowSiege')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const rng = new Rng(99);
      return Array.from({ length: 30 }, () => JSON.stringify(distortFacts(base, ['cunning'], rng, ['azure', 'tiger', 'jade']))).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('determinism, persistence and cost', () => {
  const snapshot = (mill: RumorMill): string => JSON.stringify([...mill.rumors.values()]);

  it('same seed, same history', () => {
    const run = (): string => {
      const mill = new RumorMill(null, new Rng(123));
      const env = fakeEnv({ traits: (s, i) => (i % 2 ? ['boastful'] : ['honest']) });
      RUMOR.holdHours = 1;
      for (let h = 0; h < 120; h++) {
        if (h % 15 === 0) mill.add({ topic: 'chronicle', facts: { kind: 'fell', place: (h / 15) % 6, n: 10 + h, sev: 0 }, importance: 2, origin: (h / 15) % 6, hour: h }, env);
        mill.stepHour(env, h);
      }
      return snapshot(mill);
    };
    expect(run()).toBe(run());
  });

  it('round-trips through the database, including in-flight messengers and the id counter', () => {
    const db = openDb(':memory:');
    db.migrateModule('npcmemory', MEMORY_MIGRATIONS);
    const a = new RumorMill(db, new Rng(1));
    const env = fakeEnv();
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 5;
    for (let i = 0; i < 4; i++) a.add({ topic: 'chronicle', facts: fell(i), importance: 3, origin: i, hour: i }, env);
    for (let h = 5; h < 40; h++) a.stepHour(env, h);
    expect([...a.rumors.values()].some((r) => r.flights.length > 0)).toBe(true);
    a.flush();
    const b = new RumorMill(db, new Rng(1));
    b.load();
    expect(snapshot(b)).toBe(snapshot(a));
    const next = b.add({ topic: 'chronicle', facts: fell(4), importance: 3, origin: 4, hour: 50 }, env)!;
    expect(next.id).toBe(5);
    // Expired rumors are deleted from the table.
    for (let h = 50; h < 5000; h += 50) b.stepHour(env, h);
    b.flush();
    const c = new RumorMill(db, new Rng(1));
    c.load();
    expect(c.size()).toBe(0);
    db.close();
  });

  it('one world hour stays cheap with a full rumor table across a big map', () => {
    // 25 settlements in a 5x5 grid, 96 rumors known nearly everywhere.
    const pos: [number, number][] = [];
    const roads: [number, number][] = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        pos.push([x * 60, y * 60]);
        const i = y * 5 + x;
        if (x > 0) roads.push([i - 1, i]);
        if (y > 0) roads.push([i - 5, i]);
      }
    }
    const env = fakeEnv({ pos, roads, npcsPer: 10 });
    const mill = new RumorMill(null, new Rng(2));
    RUMOR.holdHours = 0;
    RUMOR.travelRate = 1;
    for (let i = 0; i < RUMOR.maxRumors; i++) mill.add({ topic: 'chronicle', facts: { kind: 'famine', place: i % 25, who: `n${i}`, sev: 0 }, importance: 3, origin: i % 25, hour: 0 }, env);
    const t0 = performance.now();
    const HOURS = 200;
    for (let h = 1; h <= HOURS; h++) mill.stepHour(env, h);
    const per = (performance.now() - t0) / HOURS;
    expect(mill.size()).toBeGreaterThan(50);
    expect(per).toBeLessThan(5); // ms per world hour (the world hour budget is 60,000 ms)
  });
});
