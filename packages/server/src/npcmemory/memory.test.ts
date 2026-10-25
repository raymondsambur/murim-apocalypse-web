import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { KIND_DEFS, MEMORY_MIGRATIONS, MemoryStore, decayedWeight, standingOf, weightFor } from './memory';
import { NPCMEM } from './tuning';

const HOUR = 1000;
const DAY = 24;

function store(): MemoryStore {
  return new MemoryStore(null);
}

describe('memory decay', () => {
  it('halves every half-life and never goes negative', () => {
    const row = { weight: 8, hour: HOUR, count: 1, place: 0 };
    const hl = KIND_DEFS.killedBandits.halfLifeHours;
    expect(decayedWeight(row, 'killedBandits', HOUR)).toBeCloseTo(8, 6);
    expect(decayedWeight(row, 'killedBandits', HOUR + hl)).toBeCloseTo(4, 6);
    expect(decayedWeight(row, 'killedBandits', HOUR + 3 * hl)).toBeCloseTo(1, 6);
    expect(decayedWeight(row, 'killedBandits', HOUR - 50)).toBeCloseTo(8, 6); // clock going backwards is harmless
  });

  it('weights grow sub-linearly with magnitude and stop at the cap', () => {
    expect(weightFor('killedBandits', 10)).toBeLessThan(10 * weightFor('killedBandits', 1));
    expect(weightFor('killedBandits', 500)).toBeCloseTo(weightFor('killedBandits', KIND_DEFS.killedBandits.cap), 6);
  });

  it('a big deed outlasts a small one', () => {
    const s = store();
    s.remember({ subject: 1, kind: 'killedBandits', place: 0, atHour: HOUR });
    s.remember({ subject: 1, kind: 'savedTown', place: 0, atHour: HOUR });
    const later = HOUR + DAY * 40;
    const deeds = s.townDeeds(0, 1, later);
    expect(deeds.map((d) => d.kind)).toEqual(['savedTown']); // bandits faded below the line
    expect(deeds[0].ageHours).toBe(DAY * 40);
  });
});

describe('town standing', () => {
  const add = (s: MemoryStore, kind: Parameters<MemoryStore['remember']>[0]['kind'], times: number, subject = 1, place = 0, at = HOUR) => {
    for (let i = 0; i < times; i++) s.remember({ subject, kind, place, atHour: at });
  };

  it('starts unknown, then moves through noted, welcomed and honoured with good deeds', () => {
    const s = store();
    expect(s.townStanding(0, 1, HOUR).standing).toBe('unknown');
    add(s, 'completedMission', 1);
    expect(s.townStanding(0, 1, HOUR).standing).toBe('noted');
    add(s, 'killedBandits', 6);
    add(s, 'deliveredGoods', 2);
    expect(['welcomed', 'honoured']).toContain(s.townStanding(0, 1, HOUR).standing);
    add(s, 'savedTown', 1);
    expect(s.townStanding(0, 1, HOUR).standing).toBe('honoured');
    expect(s.townStanding(0, 1, HOUR).renown).toBeGreaterThan(10);
  });

  it('is per town and per player', () => {
    const s = store();
    add(s, 'sealedHeart', 1, 1, 0);
    expect(s.townStanding(0, 1, HOUR).standing).toBe('honoured');
    expect(s.townStanding(1, 1, HOUR).standing).toBe('unknown');
    expect(s.townStanding(0, 2, HOUR).standing).toBe('unknown');
  });

  it('insults and failures make a player despised; duels make them feared', () => {
    const a = store();
    add(a, 'insult', 3);
    add(a, 'failedMission', 2);
    expect(a.townStanding(0, 1, HOUR).standing).toBe('despised');
    const b = store();
    add(b, 'duelWon', 6);
    expect(b.townStanding(0, 1, HOUR).standing).toBe('feared');
    // Enough good deeds outweigh the fear.
    add(b, 'savedTown', 2);
    add(b, 'purified', 2);
    expect(b.townStanding(0, 1, HOUR).standing).not.toBe('feared');
  });

  it('forgives over time: standing decays back toward unknown', () => {
    const s = store();
    add(s, 'killedBandits', 5);
    expect(s.townStanding(0, 1, HOUR).standing).not.toBe('unknown');
    expect(s.townStanding(0, 1, HOUR + DAY * 120).standing).toBe('unknown');
  });

  it('standingOf is monotone in net good', () => {
    const order = ['unknown', 'noted', 'welcomed', 'honoured'];
    let last = 0;
    for (let g = 0; g < 30; g += 0.5) {
      const idx = order.indexOf(standingOf({ good: g, bad: 0, fear: 0, neutral: 0 }));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe('personal memory', () => {
  it('counts conversations at most once per cooldown and recalls deeds', () => {
    const s = store();
    expect(s.noteTalk(7, 1, 0, HOUR)).toBe(1);
    expect(s.noteTalk(7, 1, 0, HOUR + 1)).toBe(1); // inside the cooldown
    expect(s.noteTalk(7, 1, 0, HOUR + NPCMEM.talkCooldownHours + 1)).toBe(2);
    s.remember({ subject: 1, kind: 'completedMission', place: 0, npcId: 7, atHour: HOUR });
    const r = s.recall(7, 1, HOUR + 5);
    expect(r.talks).toBe(2);
    expect(r.deeds.map((d) => d.kind)).toEqual(['completedMission']);
    expect(r.familiarity).toBeGreaterThan(0);
    // Another NPC remembers nothing.
    expect(s.recall(8, 1, HOUR).talks).toBe(0);
    expect(s.recall(8, 1, HOUR).lastHour).toBeNull();
  });

  it('talking does not change the town standing', () => {
    const s = store();
    for (let i = 0; i < 20; i++) s.noteTalk(7, 1, 0, HOUR + i * 10);
    expect(s.townStanding(0, 1, HOUR + 300).standing).toBe('unknown');
  });
});

describe('rumor milestones', () => {
  it('flags the crossing of a cumulative threshold exactly once', () => {
    const s = store();
    const marks: boolean[] = [];
    for (let i = 0; i < 10; i++) marks.push(s.remember({ subject: 1, kind: 'killedBandits', place: 0, atHour: HOUR }).milestone);
    expect(marks.filter(Boolean)).toHaveLength(1);
    expect(marks.indexOf(true)).toBe(7); // the eighth kill crosses 8
    expect(s.remember({ subject: 1, kind: 'savedTown', place: 0, atHour: HOUR }).milestone).toBe(true);
    expect(s.remember({ subject: 1, kind: 'savedTown', place: 0, atHour: HOUR }).milestone).toBe(false);
  });
});

describe('pruning and bounds', () => {
  it('drops decayed rows and keeps the table under its cap', () => {
    const s = store();
    for (let i = 0; i < 50; i++) s.remember({ subject: i, kind: 'killedBandits', place: 0, atHour: HOUR });
    expect(s.size().town).toBe(50);
    expect(s.prune(HOUR)).toBe(0);
    expect(s.prune(HOUR + DAY * 200)).toBe(50);
    expect(s.size().town).toBe(0);

    const big = store();
    for (let i = 0; i < NPCMEM.maxTownRows + 500; i++) big.remember({ subject: i, kind: 'gift', place: i % 7, atHour: HOUR });
    big.prune(HOUR);
    expect(big.size().town).toBe(NPCMEM.maxTownRows);
  });

  it('keeps the strongest rows when over the cap', () => {
    const s = store();
    for (let i = 0; i < NPCMEM.maxTownRows + 10; i++) s.remember({ subject: i, kind: 'gift', place: 0, atHour: HOUR });
    s.remember({ subject: 99999, kind: 'sealedHeart', place: 0, atHour: HOUR });
    s.prune(HOUR);
    expect(s.townStanding(0, 99999, HOUR).standing).toBe('honoured');
  });
});

describe('persistence', () => {
  it('round-trips through the database', () => {
    const db = openDb(':memory:');
    db.migrateModule('npcmemory', MEMORY_MIGRATIONS);
    const a = new MemoryStore(db);
    a.remember({ subject: 5, kind: 'savedTown', place: 2, npcId: 11, atHour: HOUR });
    a.noteTalk(11, 5, 2, HOUR);
    a.remember({ subject: 6, kind: 'insult', place: 2, atHour: HOUR });
    a.flush();
    const b = new MemoryStore(db);
    b.load();
    expect(b.townStanding(2, 5, HOUR + 10).standing).toBe(a.townStanding(2, 5, HOUR + 10).standing);
    expect(b.townDeeds(2, 5, HOUR)[0]).toMatchObject({ kind: 'savedTown' });
    expect(b.recall(11, 5, HOUR).talks).toBe(1);
    expect(b.size()).toEqual(a.size());
    // Deletions persist too.
    b.prune(HOUR + DAY * 1000);
    b.flush();
    const c = new MemoryStore(db);
    c.load();
    expect(c.size()).toEqual({ town: 0, personal: 0 });
    db.close();
  });
});
