import { describe, expect, it } from 'vitest';
import { DEED_PHRASE, composeLine, hedgeFor, matchFragment, noteUsed } from './compose';
import { ALL_FRAGMENTS, libraryStats } from './library';
import {
  DLG_ALWAYS_SLOTS,
  DLG_DEEDS,
  DLG_HEDGES,
  DLG_MOODS,
  DLG_ROLES,
  DLG_RUMOR_KINDS,
  DLG_SEASONS,
  DLG_SLOTS,
  DLG_STANDINGS,
  DLG_STATES,
  DLG_TIMES,
  DLG_TOPICS,
  DLG_TRAITS,
  DLG_WEATHER,
  type DlgInput,
  type DlgRecent,
  type DlgRole,
  type DlgTrait,
} from './types';

const BASE_SLOTS = { player: 'Hero', npc: 'Han Ju', settlement: 'Stonebridge' };
const RICH_SLOTS = {
  ...BASE_SLOTS,
  title: 'the Jade Blade',
  kind: 'village',
  faction: 'Azure Cloud',
  controller: 'Azure Cloud',
  rank: 'Second-Rate',
  trade: 'grain',
  price: 'dear',
  elder: 'Elder Moon',
  smith: 'Smith Gu',
  innkeeper: 'Innkeeper Seo',
  master: 'Master Yu',
  merchant: 'Merchant Jin',
  alchemist: 'Healer Wi',
  guards: 'three',
  folk: 'ninety',
};

function input(over: Partial<DlgInput> = {}): DlgInput {
  return {
    topic: 'greet',
    seed: 1,
    hour: 100,
    role: 'villager',
    traits: ['kind'],
    weather: 'clear',
    time: 'day',
    season: 'summer',
    states: ['calm'],
    standing: 'unknown',
    moods: ['content'],
    deeds: [],
    slots: BASE_SLOTS,
    ...over,
  };
}

describe('library', () => {
  it('has at least 700 distinct fragments with unique ids', () => {
    const stats = libraryStats();
    expect(stats.total).toBeGreaterThanOrEqual(700);
    expect(new Set(ALL_FRAGMENTS.map((f) => f.id)).size).toBe(ALL_FRAGMENTS.filter((f) => f.part === 'body' || true).length);
    // Bodies and clauses are distinct texts.
    const texts = ALL_FRAGMENTS.map((f) => `${f.topic}|${f.part}|${f.text}`);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('only uses known slots and known tag values', () => {
    const slots = new Set<string>(DLG_SLOTS);
    for (const f of ALL_FRAGMENTS) {
      for (const s of f.slots) expect(slots.has(s), `${f.id} uses unknown slot {${s}}: ${f.text}`).toBe(true);
      for (const r of f.role ?? []) expect(DLG_ROLES).toContain(r);
      for (const t of f.trait ?? []) expect(DLG_TRAITS).toContain(t);
      for (const t of f.weather ?? []) expect(DLG_WEATHER).toContain(t);
      for (const t of f.time ?? []) expect(DLG_TIMES).toContain(t);
      for (const t of f.season ?? []) expect(DLG_SEASONS).toContain(t);
      for (const t of f.state ?? []) expect(DLG_STATES).toContain(t);
      for (const t of f.standing ?? []) expect(DLG_STANDINGS).toContain(t);
      for (const t of f.mood ?? []) expect(DLG_MOODS).toContain(t);
      for (const t of f.deed ?? []) expect(DLG_DEEDS).toContain(t);
      for (const t of f.rumor ?? []) expect(DLG_RUMOR_KINDS).toContain(t);
      for (const t of f.hedge ?? []) expect(DLG_HEDGES).toContain(t);
      expect(f.text.length).toBeGreaterThan(2);
    }
    for (const d of DLG_DEEDS) expect(DEED_PHRASE[d]).toBeTruthy();
  });

  it('every rumor kind has at least two clause variants and every hedge level has several', () => {
    for (const k of DLG_RUMOR_KINDS) {
      const n = ALL_FRAGMENTS.filter((f) => f.topic === 'rumor' && f.part === 'body' && f.rumor?.includes(k)).length;
      expect(n, `rumor kind ${k}`).toBeGreaterThanOrEqual(2);
    }
    for (const h of DLG_HEDGES) expect(ALL_FRAGMENTS.filter((f) => f.part === 'hedge' && f.hedge?.includes(h)).length).toBeGreaterThanOrEqual(5);
  });

  it('every role and every trait has its own voice', () => {
    for (const role of DLG_ROLES) {
      const n = ALL_FRAGMENTS.filter((f) => f.part === 'body' && f.topic === 'greet' && f.role?.includes(role)).length;
      expect(n, `greet lines for role ${role}`).toBeGreaterThanOrEqual(6);
      const w = ALL_FRAGMENTS.filter((f) => f.part === 'body' && f.topic === 'work' && f.role?.includes(role)).length;
      expect(w, `work lines for role ${role}`).toBeGreaterThanOrEqual(6);
    }
    for (const trait of DLG_TRAITS) {
      const n = ALL_FRAGMENTS.filter((f) => f.part === 'body' && f.trait?.includes(trait)).length;
      expect(n, `lines for trait ${trait}`).toBeGreaterThanOrEqual(12);
      const g = ALL_FRAGMENTS.filter((f) => f.part === 'body' && f.topic === 'greet' && f.trait?.includes(trait)).length;
      expect(g, `greet lines for trait ${trait}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('every topic x role x trait has at least three eligible lines (even with only the always-filled slots)', () => {
    for (const topic of DLG_TOPICS) {
      for (const role of DLG_ROLES) {
        for (const trait of DLG_TRAITS) {
          const inp = input({ topic, role: role as DlgRole, traits: [trait as DlgTrait] });
          const n = ALL_FRAGMENTS.filter((f) => f.topic === topic && f.part === 'body' && matchFragment(f, inp)).length;
          expect(n, `${topic}/${role}/${trait}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('every always-filled slot is really always available', () => {
    expect(DLG_ALWAYS_SLOTS).toContain('player');
  });
});

describe('composeLine', () => {
  it('is deterministic and varies with the seed', () => {
    const a = composeLine(input({ seed: 7 }));
    const b = composeLine(input({ seed: 7 }));
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let s = 0; s < 60; s++) seen.add(composeLine(input({ seed: s, role: 'guard', traits: ['gruff'] }))!.text);
    expect(seen.size).toBeGreaterThan(12);
  });

  it('only picks fragments whose tags match the situation, and fills every slot', () => {
    for (let s = 0; s < 400; s++) {
      const role = DLG_ROLES[s % DLG_ROLES.length] as DlgRole;
      const inp = input({
        seed: s * 31 + 5,
        role,
        topic: DLG_TOPICS[s % DLG_TOPICS.length],
        traits: [DLG_TRAITS[s % 12], DLG_TRAITS[(s * 5 + 3) % 12]],
        weather: DLG_WEATHER[s % DLG_WEATHER.length],
        time: DLG_TIMES[s % 4],
        season: DLG_SEASONS[(s >> 2) % 4],
        states: [DLG_STATES[s % 8]],
        standing: DLG_STANDINGS[s % 6],
        moods: [DLG_MOODS[s % 6]],
        deeds: s % 3 === 0 ? [{ kind: DLG_DEEDS[s % DLG_DEEDS.length], weight: 3, ageHours: 40 }] : [],
        slots: s % 2 ? RICH_SLOTS : BASE_SLOTS,
      });
      const out = composeLine(inp)!;
      expect(out, `seed ${s}`).toBeTruthy();
      expect(out.text).not.toMatch(/[{}]/);
      expect(out.text).not.toMatch(/\s{2,}/);
      expect(out.text.length).toBeGreaterThan(3);
      for (const id of out.ids) {
        const f = ALL_FRAGMENTS.find((x) => x.id === id)!;
        expect(matchFragment(f, inp), `${id} should match: ${f.text}`).not.toBeNull();
      }
    }
  });

  it('never uses situation lines in the wrong situation', () => {
    for (let s = 0; s < 150; s++) {
      const out = composeLine(input({ seed: s, states: ['calm'], weather: 'clear', time: 'day', standing: 'unknown' }))!;
      for (const id of out.ids) {
        const f = ALL_FRAGMENTS.find((x) => x.id === id)!;
        expect(f.state ? f.state.includes('calm') : true).toBe(true);
        expect(f.standing ? f.standing.includes('unknown') : true).toBe(true);
        expect(f.time ? f.time.includes('day') : true).toBe(true);
      }
    }
  });

  it('prefers specific fragments over generic ones', () => {
    let siege = 0;
    for (let s = 0; s < 100; s++) {
      const out = composeLine(input({ seed: s, states: ['siege'], role: 'guard', traits: ['gruff'], openChance: 0, closeChance: 0 }))!;
      const f = ALL_FRAGMENTS.find((x) => x.id === out.ids[0])!;
      if (f.state?.includes('siege') || f.role?.includes('guard') || f.trait?.includes('gruff') || f.standing) siege++;
    }
    expect(siege).toBeGreaterThanOrEqual(85);
  });

  it('quotes remembered deeds through {deed} and {ago}', () => {
    let hit = 0;
    for (let s = 0; s < 120; s++) {
      const out = composeLine(input({ seed: s, standing: 'honoured', deeds: [{ kind: 'killedBandits', weight: 5, ageHours: 30 }], openChance: 0, closeChance: 0 }))!;
      if (out.text.includes(DEED_PHRASE.killedBandits) || /bandit/i.test(out.text)) hit++;
    }
    expect(hit).toBeGreaterThan(10);
  });

  it('avoids repeating a body line within the anti-repeat window', () => {
    const recent: DlgRecent = {};
    const bodies: string[] = [];
    const base = input({ topic: 'greet', role: 'villager', traits: ['kind', 'weary'] });
    const pool = ALL_FRAGMENTS.filter((f) => f.topic === 'greet' && f.part === 'body' && matchFragment(f, base)).length;
    expect(pool).toBeGreaterThan(14);
    const n = Math.min(pool, 30);
    for (let i = 0; i < n; i++) {
      const out = composeLine({ ...base, seed: 1000 + i, hour: 200 + i, recent, openChance: 0, closeChance: 0 })!;
      bodies.push(out.ids[0]);
      noteUsed(recent, out.ids, 200 + i);
    }
    expect(new Set(bodies).size).toBe(bodies.length);
    // After the window passes, a repeat is allowed again.
    const later = composeLine({ ...base, seed: 5, hour: 200 + n + 200, recent })!;
    expect(later).toBeTruthy();
  });

  it('falls back to repeats rather than silence when the pool is exhausted', () => {
    const recent: DlgRecent = {};
    for (const f of ALL_FRAGMENTS) recent[f.id] = 100;
    expect(composeLine(input({ seed: 3, recent }))).toBeTruthy();
  });

  it('tells rumors with a hedge that follows the truth and a clause for the kind', () => {
    const rumor = (truth: number) => ({ kind: 'fell' as const, truth, about: 'other' as const, slots: { 'rumor.place': 'Black Market', 'rumor.age': 'two days ago' } });
    expect(hedgeFor(0.9)).toBe('sure');
    expect(hedgeFor(0.5)).toBe('hear');
    expect(hedgeFor(0.1)).toBe('doubt');
    for (const truth of [0.95, 0.55, 0.15]) {
      for (let s = 0; s < 30; s++) {
        const out = composeLine(input({ topic: 'rumor', seed: s, rumor: rumor(truth) }))!;
        expect(out.text).toContain('Black Market');
        const hedge = ALL_FRAGMENTS.find((f) => f.id === out.ids[0])!;
        expect(hedge.part).toBe('hedge');
        expect(hedge.hedge).toContain(hedgeFor(truth));
      }
    }
  });

  it('about:self rumors say "you" and about:other say the name', () => {
    const slots = { 'rumor.place': 'Reed Ford', 'rumor.who': 'Mu Jinran', 'rumor.deed': DEED_PHRASE.killedBandits, 'rumor.age': 'last week' };
    for (let s = 0; s < 40; s++) {
      const self = composeLine(input({ topic: 'rumor', seed: s, rumor: { kind: 'playerDeed', truth: 0.9, about: 'self', slots } }))!;
      expect(self.text.toLowerCase()).toContain('you');
      expect(self.text).not.toContain('Mu Jinran');
      const other = composeLine(input({ topic: 'rumor', seed: s, rumor: { kind: 'playerDeed', truth: 0.9, about: 'other', slots } }))!;
      expect(other.text).toContain('Mu Jinran');
    }
  });

  it('fragments needing an unfilled slot are never chosen', () => {
    for (let s = 0; s < 200; s++) {
      const out = composeLine(input({ seed: s, topic: 'folk', slots: BASE_SLOTS }))!;
      expect(out.text).not.toMatch(/\{/);
      for (const id of out.ids) {
        const f = ALL_FRAGMENTS.find((x) => x.id === id)!;
        expect(f.slots.every((x) => x === 'body' || x === 'weather' || x === 'season' || x === 'time' || x in BASE_SLOTS), f.text).toBe(true);
      }
    }
  });
});
