import { findPath, type NpcRole, type SimEvent } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { NPC_DATA } from '../ctx';
import { faceFor } from '../game/movement';
import { systems } from '../systems';
import { register } from '../systems/npclife';
import { ACTIVITY_IDS, SCHEDULE, freshNeeds, scheduleKey, scoreAll, schedWeight, type ActivityId, type Needs, type ScoreInput } from './activities';
import { getNpcLife, NPCLIFE_TUNING } from './index';
import type { LifeState } from './life';
import { makeLifeHarness, type LifeHarness } from './testkit';

// ---- helpers -------------------------------------------------------------------------------------

const calm = { siege: false, blightAlarm: false, famine: false, festival: false, rain: 0 };

function input(role: NpcRole, hour: number, extra: Partial<Omit<ScoreInput, 'needs'>> & { needs?: Partial<Needs>; shift?: 0 | 1 } = {}): ScoreInput {
  const { needs, shift, ...rest } = extra;
  return { role, key: scheduleKey(role, shift ?? 0), traits: new Set<string>(), needs: { ...freshNeeds(), hunger: 0.2, rest: 0.3, company: 0.2, devotion: 0.2, ...needs }, hour, mood: calm, hardy: 0.5, old: false, roll: 0.5, mournPending: false, ...rest };
}

function best(i: ScoreInput): ActivityId {
  const s = scoreAll(i, () => 0);
  return ACTIVITY_IDS.reduce((a, b) => (s[b] > s[a] ? b : a));
}

const states = (h: LifeHarness, sid: number): LifeState[] => [...h.life.states.values()].filter((s) => s.sid === sid);
const civilians = (h: LifeHarness, sid: number): LifeState[] => states(h, sid).filter((s) => s.role !== 'guard' && s.role !== 'master' && s.role !== 'legend' && s.role !== 'wanderer');
const ent = (h: LifeHarness, st: LifeState) => h.ctx.npcEntity(st.npcId)!;
const share = (list: LifeState[], pred: (s: LifeState) => boolean): number => (list.length ? list.filter(pred).length / list.length : 0);

function setupAt(h: LifeHarness, sid: number, hour: number): void {
  const s = h.ctx.world.settlements[sid];
  h.join('Hero', { x: s.spawn.x, y: s.spawn.y });
  h.setHour(hour);
  h.life.syncRoster();
}

// ---- places --------------------------------------------------------------------------------------

describe('places and assignment', () => {
  it('gives every living NPC a reachable home and workplace with valid tiles', () => {
    const h = makeLifeHarness({ real: true });
    const { wp } = h.life;
    expect(h.life.states.size).toBeGreaterThan(80);
    const homes = new Map<string, number>();
    for (const st of h.life.states.values()) {
      expect(st.home, `npc ${st.npcId} home`).not.toBeNull();
      expect(st.work, `npc ${st.npcId} work`).not.toBeNull();
      const label = wp.compOf(st.sid);
      for (const place of [st.home!, st.work!]) {
        for (const t of [place.door, ...place.spots]) {
          expect(wp.comp[t.y * h.ctx.world.w + t.x]).toBe(label);
        }
        const s = h.ctx.world.settlements[st.sid];
        const path = findPath(h.ctx.grid, s.spawn.x, s.spawn.y, place.door.x, place.door.y, 9000);
        expect(path, `path to ${place.kind} for npc ${st.npcId}`).not.toBeNull();
      }
      homes.set(st.home!.id, (homes.get(st.home!.id) ?? 0) + 1);
      if (st.role === 'guard') expect(st.posts.length).toBeGreaterThan(1);
    }
    // Houses hold 1-4 people.
    const kinds = new Map([...h.life.states.values()].map((s) => [s.home!.id, s.home!.kind]));
    for (const [id, n] of homes) {
      const kind = kinds.get(id);
      if (kind === 'house' || kind === 'farmhouse') expect(n).toBeLessThanOrEqual(NPCLIFE_TUNING.houseCapacity);
    }
    h.close();
  });

  it('puts roles at their workplaces', () => {
    const h = makeLifeHarness({ real: true });
    const want: Partial<Record<NpcRole, string[]>> = { smith: ['smithy', 'market', 'plaza'], alchemist: ['alchemy', 'herb', 'market', 'plaza'], merchant: ['market', 'warehouse', 'plaza'], innkeeper: ['inn', 'teahouse', 'plaza'] };
    for (const st of h.life.states.values()) {
      const kinds = want[st.role];
      if (kinds) expect(kinds).toContain(st.work!.kind);
      if (st.role === 'innkeeper') expect(st.home!.kind).toBe('inn');
    }
    // Silent Ford has a smithy, a market and an inn: those roles use them.
    const ford = states(h, 0);
    expect(ford.find((s) => s.role === 'smith')!.work!.kind).toBe('smithy');
    expect(ford.find((s) => s.role === 'merchant')!.work!.kind).toBe('market');
    expect(ford.find((s) => s.role === 'innkeeper')!.work!.kind).toBe('inn');
    h.close();
  });

  it('assigns a newborn NPC a place when the sim announces it', () => {
    const h = makeLifeHarness();
    const sim = h.ctx.sim;
    const before = h.life.states.size;
    const base = sim.npcs(0)[4];
    const id = 9000;
    sim.state.npcs.push({ ...base, id, name: 'Han Newborn', role: 'villager' });
    h.ctx.fanOut([{ k: 'npcBorn', id }]);
    expect(h.life.states.size).toBe(before + 1);
    expect(h.api.placesOf(id)?.home).not.toBeNull();
    // ... and it is released again when it dies.
    sim.state.npcs.find((n) => n.id === id)!.alive = false;
    h.ctx.fanOut([{ k: 'npcDied', id }]);
    expect(h.life.states.has(id)).toBe(false);
    h.close();
  });
});

// ---- schedule and needs --------------------------------------------------------------------------

describe('schedule by hour and role', () => {
  it('has a complete day for every role table', () => {
    for (const [key, segs] of Object.entries(SCHEDULE)) {
      let at = 0;
      for (const [from, to] of segs) {
        expect(from, key).toBe(at);
        expect(to).toBeGreaterThan(from);
        at = to;
      }
      expect(at, key).toBe(24);
    }
  });

  it('villagers work by day, eat at noon and sleep at night', () => {
    expect(best(input('villager', 10))).toBe('work');
    expect(best(input('villager', 12.6, { needs: { hunger: 0.6 } }))).toBe('eat');
    expect(best(input('villager', 23))).toBe('sleep');
    expect(best(input('villager', 3))).toBe('sleep');
  });

  it('guards split into day and night shifts', () => {
    expect(best(input('guard', 10, { shift: 0 }))).toBe('patrol');
    expect(best(input('guard', 2, { shift: 0 }))).toBe('sleep');
    expect(best(input('guard', 2, { shift: 1 }))).toBe('patrol');
    expect(best(input('guard', 11, { shift: 1 }))).toBe('sleep');
  });

  it('the innkeeper stays open late and sleeps in the small hours', () => {
    expect(best(input('innkeeper', 23))).toBe('work');
    expect(schedWeight('innkeeper', 23.5, 'work')).toBeGreaterThan(schedWeight('innkeeper', 23.5, 'sleep'));
    expect(best(input('innkeeper', 3))).toBe('sleep');
  });

  it('service roles do their job by day', () => {
    expect(best(input('merchant', 10))).toBe('trade');
    expect(best(input('smith', 10))).toBe('work');
    expect(best(input('master', 9))).toBe('train');
  });
});

describe('needs and traits', () => {
  it('a hungry NPC eats before working', () => {
    expect(best(input('villager', 10, { needs: { hunger: 0.95 } }))).toBe('eat');
  });

  it('devout NPCs pray more, cheerful ones chat more, gruff ones less', () => {
    const at = 17.5;
    const pray = (traits: string[]) => scoreAll(input('villager', at, { traits: new Set(traits) }), () => 0).pray;
    expect(pray(['devout'])).toBeGreaterThan(pray([]) + 0.3);
    const chat = (traits: string[]) => scoreAll(input('villager', 20, { traits: new Set(traits) }), () => 0).socialise;
    expect(chat(['cheerful'])).toBeGreaterThan(chat([]));
    expect(chat(['gruff'])).toBeLessThan(chat([]));
  });

  it('weary NPCs turn in earlier', () => {
    const tired = { needs: { rest: 0.7 } };
    const sleepy = scoreAll(input('villager', 20.2, { ...tired, traits: new Set(['weary']) }), () => 0);
    const plain = scoreAll(input('villager', 20.2, { ...tired }), () => 0);
    expect(sleepy.sleep).toBeGreaterThan(plain.sleep + 0.15);
    expect(best(input('villager', 20.2, { ...tired }))).toBe('socialise');
    expect(['sleep', 'rest']).toContain(best(input('villager', 20.2, { ...tired, traits: new Set(['weary']), old: true })));
  });

  it('greedy workers work longer', () => {
    const h = makeLifeHarness();
    const st = [...h.life.states.values()].find((s) => s.role === 'villager')!;
    const mean = (traits: string[]) => {
      st.traits = new Set(traits);
      let sum = 0;
      for (let i = 0; i < 200; i++) sum += (h.life as unknown as { hoursFor(a: ActivityId, s: LifeState): number }).hoursFor('work', st);
      return sum / 200;
    };
    expect(mean(['greedy'])).toBeGreaterThan(mean([]) * 1.1);
    h.close();
  });
});

// ---- behaviour in the world ----------------------------------------------------------------------

describe('weather', () => {
  it('sends people indoors or under the eaves in a storm, and back to work after', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 10);
    h.run(40_000);
    const folk = civilians(h, 0);
    expect(share(folk, (s) => s.act === 'shelter')).toBe(0);
    for (const w of h.ctx.sim.state.weather) w.kind = 'storm';
    h.ctx.fanOut([{ k: 'weather', zone: 1, kind: 'storm' }]);
    h.run(100_000);
    const sheltering = folk.filter((s) => s.act === 'shelter' || s.act === 'hide' || s.act === 'sleep' || ent(h, s).hidden);
    expect(sheltering.length / folk.length).toBeGreaterThanOrEqual(0.6);
    const sh = folk.filter((s) => s.act === 'shelter' && s.ph === 'doing');
    expect(sh.length).toBeGreaterThan(0);
    // Indoors (hidden) or standing at a building with the shelter cue.
    for (const s of sh) {
      const e = ent(h, s);
      expect(e.hidden || e.act === 'shelter').toBe(true);
      if (!e.hidden) expect(e.act).toBe('shelter');
    }
    for (const w of h.ctx.sim.state.weather) w.kind = 'clear';
    h.ctx.fanOut([{ k: 'weather', zone: 1, kind: 'clear' }]);
    h.run(150_000);
    expect(share(folk, (s) => s.act === 'shelter')).toBeLessThan(0.2);
    expect(share(folk, (s) => s.act === 'work' || s.act === 'trade')).toBeGreaterThan(0.3);
    h.close();
  });
});

describe('day and night', () => {
  it('everyone goes indoors at night (entity hidden) and comes out in the morning', () => {
    const h = makeLifeHarness({ real: true, hourMs: 30000 });
    setupAt(h, 0, 20);
    h.hours(6); // 02:00
    const folk = civilians(h, 0);
    expect(h.ctx.sim.clock().hour).toBe(2);
    const asleep = folk.filter((s) => s.act === 'sleep' && ent(h, s).hidden);
    expect(asleep.length / folk.length).toBeGreaterThan(0.8);
    for (const s of asleep) {
      expect(ent(h, s).act).toBeUndefined();
      expect(s.place?.kind).toBe(s.home!.kind);
    }
    // Some guard is on the walls and the innkeeper is in bed by now.
    const guards = states(h, 0).filter((s) => s.role === 'guard');
    expect(guards.some((g) => g.act === 'patrol' || g.act === 'eat' || g.act === 'rest')).toBe(true);
    h.hours(7); // 09:00
    expect(h.ctx.sim.clock().hour).toBe(9);
    const visible = share(folk, (s) => !ent(h, s).hidden);
    expect(visible).toBeGreaterThan(0.7);
    expect(share(folk, (s) => s.act === 'work' || s.act === 'trade')).toBeGreaterThan(0.4);
    h.close();
  });

  it('never teleports an NPC in view', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 5);
    const last = new Map<number, { x: number; y: number; hidden: boolean }>();
    let jumps = 0;
    let doors = 0;
    for (let t = 0; t < 6000; t++) {
      h.tick(1);
      if (t % 100 === 99) h.game.advanceHour(h.clock.t);
      for (const st of states(h, 0)) {
        const e = ent(h, st);
        const prev = last.get(e.id);
        if (prev && !prev.hidden && Math.max(Math.abs(prev.x - e.x), Math.abs(prev.y - e.y)) > 1) jumps++;
        if (prev && prev.hidden !== e.hidden) doors++;
        last.set(e.id, { x: e.x, y: e.y, hidden: e.hidden });
      }
    }
    expect(jumps).toBe(0);
    expect(doors).toBeGreaterThan(2);
    h.close();
  });
});

describe('reactions of the settlement', () => {
  it('mobilises on a siege: guards rally to the gates, civilians stay indoors; stands down after', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 10);
    h.run(30_000);
    const sim = h.ctx.sim;
    const st0 = sim.state.settlements[0];
    st0.siegeUntil = sim.state.clock.totalHours + 30;
    st0.siegeStrength = 40;
    st0.siegeBy = 'blight';
    expect(sim.settlementView(0).siege).toBe(true);
    h.ctx.fanOut([{ k: 'siege', settlementId: 0, start: true }]);
    h.run(120_000);
    const guards = states(h, 0).filter((s) => s.role === 'guard');
    expect(guards.length).toBeGreaterThan(1);
    for (const g of guards) {
      expect(g.act, `guard ${g.npcId}`).toBe('muster');
      expect(g.place?.kind).toBe('gate');
      expect(ent(h, g).act).toBe('patrol');
      expect(ent(h, g).hidden).toBe(false);
    }
    const folk = civilians(h, 0);
    expect(share(folk, (s) => s.act === 'hide' || s.act === 'sleep')).toBeGreaterThan(0.85);
    expect(share(folk, (s) => ent(h, s).hidden)).toBeGreaterThan(0.85);
    // The siege ends: back to normal life.
    st0.siegeUntil = 0;
    h.ctx.fanOut([{ k: 'siege', settlementId: 0, start: false }]);
    h.run(180_000);
    expect(states(h, 0).filter((s) => s.act === 'muster' || s.act === 'hide').length).toBe(0);
    h.close();
  });

  it('gathers the crowd on the plaza for a festival', () => {
    const h = makeLifeHarness();
    setupAt(h, 0, 12);
    h.run(20_000);
    h.ctx.sim.state.settlements[0].flags.push('festival');
    h.game.advanceHour(h.clock.t);
    h.run(90_000);
    const folk = civilians(h, 0);
    const party = folk.filter((s) => s.act === 'celebrate');
    expect(party.length / folk.length).toBeGreaterThan(0.6);
    for (const s of party.filter((p) => p.ph === 'doing')) {
      expect(s.place?.kind).toBe('plaza');
      expect(ent(h, s).act).toBe('celebrate');
    }
    h.close();
  });

  it('a famine draws people to the market to mope', () => {
    const h = makeLifeHarness({ hourMs: 60000 });
    setupAt(h, 0, 10);
    h.run(20_000);
    h.ctx.sim.state.settlements[0].flags.push('famine');
    h.game.advanceHour(h.clock.t);
    h.run(90_000);
    const moping = states(h, 0).filter((s) => s.act === 'mope' && s.ph === 'doing');
    expect(moping.length).toBeGreaterThan(0);
    for (const s of moping) {
      expect(['market', 'plaza']).toContain(s.place!.kind);
      expect(ent(h, s).act).toBe('rest');
    }
    h.close();
  });

  it('neighbours gather and mourn near the home of an NPC who died', () => {
    const h = makeLifeHarness({ hourMs: 60000 });
    setupAt(h, 0, 11);
    h.run(10_000);
    const sim = h.ctx.sim;
    const victim = sim.npcs(0).find((n) => n.role === 'villager')!;
    const home = h.api.placesOf(victim.id)!.home!;
    sim.state.npcs.find((n) => n.id === victim.id)!.alive = false;
    h.ctx.fanOut([{ k: 'npcDied', id: victim.id }]);
    expect(h.life.states.has(victim.id)).toBe(false);
    h.run(70_000);
    const mourners = states(h, 0).filter((s) => s.act === 'mourn');
    expect(mourners.length).toBeGreaterThanOrEqual(2);
    for (const m of mourners.filter((s) => s.ph === 'doing')) {
      const e = ent(h, m);
      expect(e.act).toBe('mourn');
      expect(Math.max(Math.abs(e.x - home.x), Math.abs(e.y - home.y))).toBeLessThanOrEqual(5);
    }
    h.close();
  });
});

describe('conversations', () => {
  it('pairs stand close, face each other and emit npcChat', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 12);
    const chats: { a: number; b: number; settlementId: number }[] = [];
    const checks: { dist: number; faceA: number; faceB: number; wantA: number; wantB: number; actA: unknown; actB: unknown }[] = [];
    h.ctx.events.on('npcChat', (ev) => {
      chats.push(ev);
      const a = h.ctx.npcEntity(ev.a)!;
      const b = h.ctx.npcEntity(ev.b)!;
      checks.push({ dist: Math.hypot(a.x - b.x, a.y - b.y), faceA: a.face, faceB: b.face, wantA: faceFor(b.x - a.x, b.y - a.y, a.face), wantB: faceFor(a.x - b.x, a.y - b.y, b.face), actA: a.act, actB: b.act });
    });
    for (let hr = 0; hr < 10 && chats.length < 2; hr++) {
      h.run(60_000);
      h.game.advanceHour(h.clock.t);
    }
    expect(chats.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.dist).toBeLessThanOrEqual(2.2);
      expect(c.faceA).toBe(c.wantA);
      expect(c.faceB).toBe(c.wantB);
      expect(c.actA).toBe('chat');
      expect(c.actB).toBe('chat');
    }
    const c0 = chats[0];
    expect(h.api.activityOf(c0.a)?.chatWith).toBe(c0.b);
    expect(h.api.activityOf(c0.b)?.chatWith).toBe(c0.a);
    expect(c0.settlementId).toBe(0);
    h.close();
  });
});

describe('level of detail', () => {
  it('far NPCs never walk but sit where the schedule says; they are in place when a player arrives', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    h.setHour(9);
    h.life.syncRoster();
    h.run(200_000);
    expect(h.game.movement.movingCount).toBe(0);
    expect(h.life.stats.travels).toBe(0);
    expect(h.life.stats.snaps).toBeGreaterThan(50);
    const workers = states(h, 0).filter((s) => s.act === 'work' || s.act === 'trade');
    expect(workers.length).toBeGreaterThan(3);
    for (const s of workers) {
      const e = ent(h, s);
      expect([e.x, e.y]).toEqual([s.spot.x, s.spot.y]);
      expect(e.act).toBe(s.act === 'trade' ? 'trade' : 'work');
      expect(e.state).toBe('work');
    }
    const before = new Map(workers.map((s) => [s.npcId, [ent(h, s).x, ent(h, s).y]]));
    const sp = h.ctx.world.settlements[0].spawn;
    h.join('Hero', { x: sp.x, y: sp.y });
    h.run(2_000);
    for (const s of workers) {
      if (s.act !== 'work' && s.act !== 'trade') continue;
      expect([ent(h, s).x, ent(h, s).y]).toEqual(before.get(s.npcId));
    }
    h.close();
  });

  it('near NPCs actually walk', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 5);
    h.run(300_000);
    expect(h.life.stats.travels).toBeGreaterThan(5);
    h.close();
  });
});

describe('cost', () => {
  it('visits and decisions per tick are bounded however large the roster is', () => {
    const h = makeLifeHarness();
    const sim = h.ctx.sim;
    const proto = sim.npcs(0);
    let id = 5000;
    const events: SimEvent[] = [];
    for (let i = 0; i < 700; i++) {
      const base = proto[i % proto.length];
      sim.state.npcs.push({ ...base, id: ++id, name: `Lee Clone${id}`, settlementId: base.settlementId });
      events.push({ k: 'npcBorn', id });
    }
    h.ctx.fanOut(events);
    expect(h.life.states.size).toBeGreaterThan(700);
    h.join('Hero');
    h.setHour(8);
    const before = { ...h.life.stats };
    h.tick(300);
    const s = h.life.stats;
    const ticks = s.ticks - before.ticks;
    expect(s.maxVisitsInTick).toBeLessThanOrEqual(NPCLIFE_TUNING.maxVisitsPerTick);
    expect(s.maxDecisionsInTick).toBeLessThanOrEqual(NPCLIFE_TUNING.maxDecisionsPerTick);
    // Each NPC is looked at about once per second.
    expect((s.visits - before.visits) / ticks).toBeLessThanOrEqual(NPCLIFE_TUNING.maxVisitsPerTick);
    const t0 = performance.now();
    h.tick(100);
    const perTickMs = (performance.now() - t0) / 100;
    expect(perTickMs).toBeLessThan(25);
    h.close();
  });
});

describe('determinism', () => {
  const run = (): string => {
    const h = makeLifeHarness({ real: true, hourMs: 60000, seed: 7 });
    setupAt(h, 0, 6);
    for (let i = 0; i < 3; i++) {
      h.run(60_000);
      h.game.advanceHour(h.clock.t);
    }
    const sig = [...h.life.states.values()].map((s) => `${s.npcId}:${s.act}:${s.ph}:${ent(h, s).x},${ent(h, s).y}:${ent(h, s).hidden ? 1 : 0}:${ent(h, s).act ?? ''}`).join('|');
    h.close();
    return sig;
  };
  it('same seed gives the same lives', () => {
    expect(run()).toBe(run());
  });
});

describe('integration with the core', () => {
  it('registers as a system and drives the NPC entities', () => {
    expect(systems).toContain(register);
    const h = makeLifeHarness();
    for (const st of h.life.states.values()) expect(NPC_DATA.get(ent(h, st))!.driven).toBe(true);
    h.close();
  });

  it('also works when the system registers before the core spawns the NPCs (production order)', () => {
    const h = makeLifeHarness({ real: true, registerFirst: true });
    expect(h.life.states.size).toBeGreaterThan(80);
    h.tick(2);
    const placed = [...h.life.states.values()].filter((s) => s.act !== null);
    expect(placed.length).toBe(h.life.states.size);
    for (const st of placed) expect(NPC_DATA.get(ent(h, st))!.driven).toBe(true);
    h.close();
  });

  it('exposes activityOf / placesOf / npcsAt / nearbyNpcs', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 9);
    h.run(120_000);
    const api = getNpcLife(h.ctx);
    const smith = states(h, 0).find((s) => s.role === 'smith')!;
    const a = api.activityOf(smith.npcId)!;
    expect(a.activity).not.toBeNull();
    expect(api.placesOf(smith.npcId)!.work!.kind).toBe('smithy');
    const working = states(h, 0).filter((s) => s.act === 'work' && s.work?.kind === 'smithy' && s.ph === 'doing');
    if (working.length) expect(api.npcsAt('smithy', 0)).toContain(working[0].npcId);
    const e = ent(h, smith);
    const near = api.nearbyNpcs(smith.npcId, 30);
    for (const id of near) expect(Math.hypot(h.ctx.npcEntity(id)!.x - e.x, h.ctx.npcEntity(id)!.y - e.y)).toBeLessThanOrEqual(30);
    expect(api.activityOf(999999)).toBeUndefined();
    h.close();
  });

  it('an NPC a player talks to stops what it is doing, then carries on', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 9);
    h.run(120_000);
    const p = h.ctx.players.online()[0];
    const worker = states(h, 0).find((s) => s.act === 'work' && s.ph === 'doing' && ent(h, s).act === 'work')!;
    expect(worker).toBeDefined();
    const e = ent(h, worker);
    h.game.npcs.attend(e, p);
    h.run(3_000);
    expect(e.act).toBeUndefined();
    expect(e.state).toBe('idle');
    h.run(12_000);
    expect(worker.act === 'work' ? e.act : 'work').toBe('work');
    h.close();
  });
});

describe('smoke boot with the real sim', () => {
  it('shows a living town (summary logged)', () => {
    const h = makeLifeHarness({ real: true, hourMs: 60000 });
    setupAt(h, 0, 6);
    const lines: string[] = [];
    for (let hr = 0; hr < 24; hr++) {
      h.run(60_000);
      h.game.advanceHour(h.clock.t);
      if (hr % 4 !== 3) continue;
      const c: Record<string, number> = {};
      let hidden = 0;
      let walking = 0;
      for (const s of states(h, 0)) {
        c[s.act ?? 'none'] = (c[s.act ?? 'none'] ?? 0) + 1;
        if (ent(h, s).hidden) hidden++;
        if (ent(h, s).move) walking++;
      }
      lines.push(`${String(h.ctx.sim.clock().hour).padStart(2, '0')}h Silent Ford: ${JSON.stringify(c)} hidden=${hidden} walking=${walking}`);
    }
    // eslint-disable-next-line no-console
    console.log(`npclife smoke\n${lines.join('\n')}\nstats ${JSON.stringify(h.life.stats)}`);
    expect(h.life.stats.travels).toBeGreaterThan(0);
    expect(h.life.stats.pairs + h.life.stats.snaps).toBeGreaterThan(0);
    h.close();
  });
});
