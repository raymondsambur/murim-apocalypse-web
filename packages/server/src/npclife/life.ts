/**
 * NPC life controller: places, needs + schedule utility AI, walking, indoor hiding, activity cues,
 * conversations and reactions (weather, siege, famine, festival, death). Pure systemic code, no AI model.
 *
 * Per-NPC state machine (one `LifeState` each, see `visit`):
 *   idle -> (decide) -> depart (random pause) -> travel (ctx.movement.moveTo) -> doing (act cue / hidden indoors) -> idle ...
 *
 * LOD: when no online player is within AOI range of the NPC's settlement, the NPC is "far": it never walks,
 * it is simply placed where its schedule says (teleported while nobody can see it), so a player who walks up
 * finds the town already in the right state. NPCs are visited about once a second in a rotating slice, so the
 * per-tick cost is O(roster / 10) plus at most `maxDecisionsPerTick` decisions.
 */
import { AOI_RADIUS, type Dir, type NpcState, type Point, type SimEvent } from '@murim/shared';
import { NPC_DATA, type Entity, type GameContext } from '../ctx';
import {
  ACTIVITIES,
  advanceNeeds,
  freshNeeds,
  isCivilianRole,
  isOldNpc,
  scheduleKey,
  scoreAll,
  wakeHour,
  type ActivityId,
  type Mood,
  type Needs,
  type ScheduleKey,
} from './activities';
import { chooseHome, chooseWork, hash01, hash32, surname, type HomeBook } from './assign';
import { worldPlaces, type Place, type PlaceKind, type SettlementPlaces, type WorldPlaces } from './places';
import { NPCLIFE_TUNING as TUNE } from './tuning';

export type Phase = 'idle' | 'depart' | 'travel' | 'doing';

interface Plan {
  act: ActivityId;
  place: Place | null;
  spot: Point;
  inside: boolean;
  hours: number;
  partnerId: number | null;
  hurry: boolean;
}

export interface LifeState {
  npcId: number;
  sid: number;
  entityId: number;
  role: NpcState['role'];
  home: Place | null;
  work: Place | null;
  posts: readonly Place[];
  postIdx: number;
  shift: 0 | 1;
  traits: Set<string>;
  /** Personal schedule offset, hours. */
  phase: number;
  hardy: number;
  roll: number;
  old: boolean;
  needs: Needs;
  needsAt: number;
  act: ActivityId | null;
  lastAct: ActivityId | null;
  ph: Phase;
  place: Place | null;
  spot: Point;
  inside: boolean;
  partnerId: number | null;
  hours: number;
  hurry: boolean;
  startedAt: number;
  until: number;
  departAt: number;
  interruptAt: number;
  token: number;
  retries: number;
  chatWith: number | null;
  waiting: boolean;
  mourn: { placeId: string; expires: number } | null;
  suppressed: boolean;
  nextLookAt: number;
  avoid: Map<string, number>;
}

export interface LifeStats {
  ticks: number;
  visits: number;
  decisions: number;
  snaps: number;
  travels: number;
  pairs: number;
  maxVisitsInTick: number;
  maxDecisionsInTick: number;
}

/** Local copy of the movement module's facing rule (isometric: 0 SE, 1 SW, 2 NW, 3 NE). */
function faceFor(dx: number, dy: number, prev: Dir): Dir {
  const sx = Math.sign(dx - dy);
  const sy = Math.sign(dx + dy);
  if (sx === 0 && sy === 0) return prev;
  const prevRight = prev === 0 || prev === 3;
  const prevDown = prev === 0 || prev === 1;
  const right = sx === 0 ? prevRight : sx > 0;
  const down = sy === 0 ? prevDown : sy > 0;
  if (down) return right ? 0 : 1;
  return right ? 3 : 2;
}

const ROUTINE: ReadonlySet<ActivityId> = new Set(['sleep', 'work', 'patrol', 'trade', 'hide', 'muster', 'mourn', 'celebrate', 'mope']);
const SHELTER_KINDS: readonly PlaceKind[] = ['inn', 'teahouse', 'market', 'shrine', 'hall', 'pagoda', 'house', 'farmhouse', 'alchemy', 'smithy', 'barracks', 'dojo'];

export class NpcLife {
  readonly states = new Map<number, LifeState>();
  readonly stats: LifeStats = { ticks: 0, visits: 0, decisions: 0, snaps: 0, travels: 0, pairs: 0, maxVisitsInTick: 0, maxDecisionsInTick: 0 };
  readonly wp: WorldPlaces;
  private order: LifeState[] = [];
  private cursor = 0;
  private readonly book: HomeBook = new Map();
  private readonly moods = new Map<number, { at: number; mood: Mood }>();
  private readonly nearCache = new Map<number, { at: number; near: boolean }>();
  private readonly waiters = new Map<number, Set<number>>();
  private readonly sigs = new Map<number, string>();
  private festivalDay = -1;
  private started = false;
  private firstTick = true;
  private decisionsLeft = 0;

  constructor(readonly ctx: GameContext) {
    this.wp = worldPlaces(ctx.world, ctx.grid);
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.ctx.onTick((_dt, now) => this.tick(now));
    this.ctx.onHour((events) => this.onHour(events));
    this.syncRoster();
    const now = this.ctx.now();
    for (const sid of new Set([...this.states.values()].map((s) => s.sid))) this.sigs.set(sid, this.moodSig(this.moodOf(sid, now, true)));
  }

  get hourMs(): number {
    return this.ctx.sim.hourMs;
  }

  private hourNow(now: number): number {
    return this.ctx.sim.timeView(now).hours;
  }

  // ---- roster ------------------------------------------------------------------------------------

  /** Reconcile the tracked NPCs with the sim roster (boot, every world hour, births / moves). */
  syncRoster(): void {
    const alive = new Map<number, NpcState>();
    for (const n of this.ctx.sim.npcs()) if (n.alive) alive.set(n.id, n);
    for (const id of [...this.states.keys()]) if (!alive.has(id)) this.drop(id);
    const dirty = new Set<number>();
    for (const npc of alive.values()) {
      const st = this.states.get(npc.id);
      if (!st) {
        if (this.adopt(npc)) dirty.add(npc.settlementId);
      } else if (st.sid !== npc.settlementId || st.role !== npc.role) {
        this.reassign(st, npc);
        dirty.add(npc.settlementId);
      }
    }
    for (const sid of dirty) this.rebalanceShifts(sid);
    this.order = [...this.states.values()].sort((a, b) => a.npcId - b.npcId);
    if (this.cursor >= this.order.length) this.cursor = 0;
    // Newly adopted NPCs in far settlements are placed straight away (nobody can see it).
    const now = this.ctx.now();
    for (const st of this.order) if (!st.act && st.ph === 'idle' && !this.isNear(st.sid, now)) this.stepNow(st, now);
  }

  private newState(npc: NpcState): LifeState {
    const h = hash32(npc.id, 77);
    const traits = new Set(npc.traits);
    return {
      npcId: npc.id,
      sid: npc.settlementId,
      entityId: -1,
      role: npc.role,
      home: null,
      work: null,
      posts: [],
      postIdx: 0,
      shift: 0,
      traits,
      phase: (hash01(npc.id, 11) * 2 - 1) * TUNE.phaseSpread + (traits.has('weary') ? -0.3 : 0),
      hardy: Math.min(1, Math.max(0, hash01(npc.id, 12) * 0.7 + (traits.has('gruff') || traits.has('stern') ? 0.25 : 0) - (traits.has('weary') ? 0.15 : 0))),
      roll: (h % 10000) / 10000,
      old: isOldNpc(npc),
      needs: { ...freshNeeds(), hunger: 0.2 + hash01(npc.id, 13) * 0.5, rest: 0.1 + hash01(npc.id, 14) * 0.4, company: hash01(npc.id, 15) * 0.6, devotion: hash01(npc.id, 16) * 0.5 },
      needsAt: this.ctx.now(),
      act: null,
      lastAct: null,
      ph: 'idle',
      place: null,
      spot: { x: 0, y: 0 },
      inside: false,
      partnerId: null,
      hours: 0,
      hurry: false,
      startedAt: 0,
      until: 0,
      departAt: 0,
      interruptAt: 0,
      token: 0,
      retries: 0,
      chatWith: null,
      waiting: false,
      mourn: null,
      suppressed: false,
      nextLookAt: 0,
      avoid: new Map(),
    };
  }

  private adopt(npc: NpcState): LifeState | null {
    if (!this.wp.settlements.has(npc.settlementId)) return null;
    const st = this.newState(npc);
    this.states.set(npc.id, st);
    this.assignPlaces(st, npc);
    return st;
  }

  private reassign(st: LifeState, npc: NpcState): void {
    const e = this.ctx.npcEntity(st.npcId);
    if (e) this.endDoing(st, e, this.ctx.now(), true);
    this.releaseHome(st);
    st.sid = npc.settlementId;
    st.role = npc.role;
    st.old = isOldNpc(npc);
    st.traits = new Set(npc.traits);
    st.ph = 'idle';
    st.act = null;
    st.token++;
    if (!this.wp.settlements.has(npc.settlementId)) {
      this.drop(st.npcId);
      return;
    }
    this.assignPlaces(st, npc);
  }

  private releaseHome(st: LifeState): void {
    if (st.home) this.book.get(st.home.id)?.delete(st.npcId);
  }

  private assignPlaces(st: LifeState, npc: NpcState): void {
    const sp = this.wp.settlements.get(npc.settlementId)!;
    const peers = this.ctx.sim.npcs(npc.settlementId).filter((n) => n.alive);
    this.releaseHome(st);
    st.home = chooseHome(sp, npc, this.book, peers);
    let occ = this.book.get(st.home.id);
    if (!occ) this.book.set(st.home.id, (occ = new Set()));
    occ.add(npc.id);
    const same = peers.filter((n) => n.role === npc.role).sort((a, b) => a.id - b.id);
    const rank = Math.max(0, same.findIndex((n) => n.id === npc.id));
    const plan = chooseWork(sp, npc, rank);
    st.work = plan.work;
    st.posts = plan.posts;
    st.postIdx = hash32(npc.id, 3) % Math.max(1, plan.posts.length);
  }

  /** Guards alternate day / night shifts by their order in the settlement. */
  private rebalanceShifts(sid: number): void {
    const guards = [...this.states.values()].filter((s) => s.sid === sid && s.role === 'guard').sort((a, b) => a.npcId - b.npcId);
    guards.forEach((g, i) => (g.shift = (i % 2) as 0 | 1));
  }

  private drop(id: number): void {
    const st = this.states.get(id);
    if (!st) return;
    this.releaseHome(st);
    this.removeWaiter(st);
    if (st.chatWith !== null) {
      const o = this.states.get(st.chatWith);
      if (o) {
        o.chatWith = null;
        o.until = 0;
      }
    }
    st.token++;
    this.states.delete(id);
    this.order = this.order.filter((s) => s !== st);
    if (this.cursor >= this.order.length) this.cursor = 0;
    this.rebalanceShifts(st.sid);
  }

  private entityOf(st: LifeState): Entity | undefined {
    const e = this.ctx.npcEntity(st.npcId);
    if (!e) return undefined;
    if (e.id !== st.entityId) {
      // First sight of this entity (boot, re-created by the core): take it over.
      st.entityId = e.id;
      const nd = NPC_DATA.get(e);
      if (nd) nd.driven = true;
      st.ph = 'idle';
      st.act = null;
      st.inside = false;
      this.removeWaiter(st);
      st.chatWith = null;
      st.token++;
      if (e.hidden || e.act !== undefined) {
        e.hidden = false;
        e.act = undefined;
        this.ctx.entities.touch(e);
      }
    }
    return e;
  }

  // ---- LOD / mood caches -------------------------------------------------------------------------

  isNear(sid: number, now: number): boolean {
    const c = this.nearCache.get(sid);
    if (c && now - c.at < TUNE.nearTtlMs && now >= c.at) return c.near;
    const s = this.ctx.world.settlements[sid];
    const near = !!s && this.ctx.players.near(s.x, s.y, s.radius + AOI_RADIUS + TUNE.nearMargin, true).length > 0;
    this.nearCache.set(sid, { at: now, near });
    return near;
  }

  moodOf(sid: number, now: number, force = false): Mood {
    const c = this.moods.get(sid);
    if (!force && c && now - c.at < TUNE.moodTtlMs && now >= c.at) return c.mood;
    const sim = this.ctx.sim;
    const s = this.ctx.world.settlements[sid];
    let mood: Mood = { siege: false, blightAlarm: false, famine: false, festival: false, rain: 0 };
    if (s) {
      try {
        const v = sim.settlementView(sid);
        const clock = sim.clock();
        const flags = v.flags;
        const festivalHours = clock.hour >= TUNE.festivalFrom && clock.hour < TUNE.festivalTo;
        mood = {
          siege: v.siege || v.status === 'besieged',
          blightAlarm: v.blight >= TUNE.blightAlarm,
          famine: flags.includes('famine'),
          festival: (flags.includes('festival') || this.festivalDay === clock.day) && festivalHours,
          rain: TUNE.weather[sim.weatherAt(s.x, s.y)] ?? 0,
        };
      } catch {
        /* unknown settlement: calm */
      }
    }
    this.moods.set(sid, { at: now, mood });
    return mood;
  }

  private moodSig(m: Mood): string {
    return `${+m.siege}${+m.blightAlarm}${+m.famine}${+m.festival}${Math.round(m.rain * 10)}`;
  }

  // ---- per-tick ----------------------------------------------------------------------------------

  tick(now: number): void {
    this.stats.ticks++;
    const n = this.order.length;
    if (n === 0) return;
    if (this.firstTick) {
      // Systems register before the core spawns the NPC entities: place the far ones now that they exist.
      this.firstTick = false;
      for (const st of this.order) if (!st.act && st.ph === 'idle' && !this.isNear(st.sid, now)) this.stepNow(st, now);
    }
    this.decisionsLeft = TUNE.maxDecisionsPerTick;
    const budget = Math.min(TUNE.maxVisitsPerTick, Math.ceil(n / TUNE.sweepTicks));
    const decisionsBefore = this.stats.decisions;
    for (let i = 0; i < budget; i++) {
      if (this.cursor >= this.order.length) this.cursor = 0;
      const st = this.order[this.cursor++];
      if (st) this.visit(st, now);
    }
    this.stats.visits += budget;
    this.stats.maxVisitsInTick = Math.max(this.stats.maxVisitsInTick, budget);
    this.stats.maxDecisionsInTick = Math.max(this.stats.maxDecisionsInTick, this.stats.decisions - decisionsBefore);
  }

  /** Visit one NPC right now, outside the budget (new arrivals in far settlements, tests). */
  stepNow(st: LifeState, now: number): void {
    const keep = this.decisionsLeft;
    this.decisionsLeft = 1;
    this.visit(st, now);
    this.decisionsLeft = keep;
  }

  private visit(st: LifeState, now: number): void {
    const e = this.entityOf(st);
    if (!e) return;
    const nd = NPC_DATA.get(e);
    if (nd && now < nd.holdUntil) {
      this.hold(st, e, nd.holdUntil);
      return;
    }
    if (st.suppressed) this.unhold(st, e);
    const near = this.isNear(st.sid, now);
    switch (st.ph) {
      case 'idle':
        this.decideAndGo(st, e, now, near);
        return;
      case 'depart':
        if (st.interruptAt && now >= st.interruptAt) {
          st.interruptAt = 0;
          st.ph = 'idle';
          return;
        }
        if (!near || now >= st.departAt) this.startTravel(st, e, now, near);
        return;
      case 'travel':
        if (!near) this.snap(st, e, now);
        else if (st.interruptAt && now >= st.interruptAt) {
          st.interruptAt = 0;
          st.token++;
          st.ph = 'idle';
          this.decideAndGo(st, e, now, near);
        }
        return;
      case 'doing':
        if (st.interruptAt && now >= st.interruptAt) {
          st.interruptAt = 0;
          this.endDoing(st, e, now);
          this.decideAndGo(st, e, now, near);
        } else if (now >= st.until) {
          this.endDoing(st, e, now);
          this.decideAndGo(st, e, now, near);
        } else if (near) this.idleLook(st, e, now);
        return;
    }
  }

  // ---- a player is talking to the NPC ------------------------------------------------------------

  private hold(st: LifeState, e: Entity, holdUntil: number): void {
    if (st.ph === 'doing') st.until = Math.max(st.until, holdUntil + 1500);
    if (!st.suppressed && e.act !== undefined) {
      st.suppressed = true;
      e.act = undefined;
      if (!e.move && e.state !== 'idle') e.state = 'idle';
      this.ctx.entities.touch(e);
    }
  }

  private unhold(st: LifeState, e: Entity): void {
    st.suppressed = false;
    if (st.ph !== 'doing' || st.inside || !st.act) return;
    const def = ACTIVITIES[st.act];
    const cue = this.cueFor(st, def.cue);
    if (cue !== e.act) {
      e.act = cue;
      e.state = def.state;
      this.ctx.entities.touch(e);
    }
  }

  private cueFor(st: LifeState, cue: Entity['act']): Entity['act'] {
    if (st.act === 'sleep') return 'rest';
    if (st.act === 'socialise') return st.chatWith !== null ? 'chat' : undefined;
    return cue;
  }

  private idleLook(st: LifeState, e: Entity, now: number): void {
    if (!st.waiting && st.act !== 'wander') return;
    if (now < st.nextLookAt) return;
    st.nextLookAt = now + this.ctx.rng.int(3000, 9000);
    e.face = this.ctx.rng.int(0, 3) as Dir;
    this.ctx.entities.touch(e);
  }

  // ---- deciding ----------------------------------------------------------------------------------

  private decideAndGo(st: LifeState, e: Entity, now: number, near: boolean): void {
    if (this.decisionsLeft <= 0) return;
    this.decisionsLeft--;
    this.stats.decisions++;
    const plan = this.decide(st, e, now);
    this.commit(st, e, plan, now, near);
  }

  /** Score every activity and take the best one that has a usable place. */
  decide(st: LifeState, e: Entity, now: number): Plan {
    const sp = this.wp.settlements.get(st.sid);
    const mood = this.moodOf(st.sid, now);
    const hour = this.hourNow(now);
    const hp = hour + st.phase;
    st.needs.safety = mood.siege ? 1 : mood.blightAlarm ? 0.7 : 0;
    if (st.mourn && now >= st.mourn.expires) st.mourn = null;
    const mournPending = !!st.mourn && hour >= 6.5 && hour < 20.5;
    const key = scheduleKey(st.role, st.shift);
    const rng = this.ctx.rng;
    const scores = scoreAll(
      { role: st.role, key, traits: st.traits, needs: st.needs, hour: hp, mood, hardy: st.hardy, old: st.old, roll: st.roll, mournPending },
      () => rng.float(0, TUNE.scoreNoise),
    );
    if (st.lastAct && !ROUTINE.has(st.lastAct)) scores[st.lastAct] -= TUNE.repeatPenalty;
    const ranked = (Object.keys(scores) as ActivityId[]).sort((a, b) => scores[b] - scores[a]);
    if (sp) {
      for (const act of ranked) {
        if (scores[act] < -1) break;
        const plan = this.resolve(act, st, e, sp, mood, hp, now);
        if (plan) return plan;
      }
    }
    return { act: 'wander', place: null, spot: { x: e.x, y: e.y }, inside: false, hours: rng.float(0.2, 0.4), partnerId: null, hurry: false };
  }

  private avoided(st: LifeState, p: Place | null | undefined, now: number): boolean {
    return !p || (st.avoid.get(p.id) ?? 0) > now;
  }

  private spotOf(place: Place, st: LifeState, stable: boolean): Point {
    const n = place.spots.length;
    const i = stable ? hash32(st.npcId, place.id.length) % n : this.ctx.rng.int(0, n - 1);
    return place.spots[i];
  }

  private hoursFor(act: ActivityId, st: LifeState): number {
    const [lo, hi] = ACTIVITIES[act].hours;
    let h = this.ctx.rng.float(lo, hi);
    if (act === 'work' || act === 'trade') h *= st.traits.has('greedy') ? 1.25 : 1;
    if (act === 'rest') h *= st.traits.has('weary') ? 1.3 : 1;
    return h;
  }

  private mk(act: ActivityId, place: Place, st: LifeState, opts: { inside?: boolean; stable?: boolean; hours?: number; hurry?: boolean; partnerId?: number | null; spot?: Point } = {}): Plan {
    const inside = !!opts.inside && place.enter;
    return {
      act,
      place,
      spot: opts.spot ?? (inside ? place.door : this.spotOf(place, st, !!opts.stable)),
      inside,
      hours: opts.hours ?? this.hoursFor(act, st),
      partnerId: opts.partnerId ?? null,
      hurry: !!opts.hurry,
    };
  }

  /** Nearest enterable building to the NPC (for sheltering / hiding away from home). */
  private nearestShelter(sp: SettlementPlaces, e: Entity, st: LifeState, now: number): Place | null {
    let best: Place | null = null;
    let bestD = 24 * 24;
    const cand: Place[] = st.home ? [st.home] : [];
    for (const k of SHELTER_KINDS) cand.push(...sp.byKind(k));
    for (const p of cand) {
      if (!p.enter || this.avoided(st, p, now)) continue;
      const d = (p.door.x - e.x) ** 2 + (p.door.y - e.y) ** 2 - (p === st.home ? 60 : 0);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private resolve(act: ActivityId, st: LifeState, e: Entity, sp: SettlementPlaces, mood: Mood, hp: number, now: number): Plan | null {
    const rng = this.ctx.rng;
    const home = st.home && !this.avoided(st, st.home, now) ? st.home : null;
    const work = st.work && !this.avoided(st, st.work, now) ? st.work : null;
    switch (act) {
      case 'sleep': {
        if (!home) return null;
        const key = scheduleKey(st.role, st.shift);
        const wake = wakeHour(key, st.traits, st.old, 0);
        const d = (((wake - hp) % 24) + 24) % 24;
        // Past this NPC's wake-up time: only an exhausted one dozes off for a short nap.
        if (d > 11) return st.needs.rest >= 0.75 ? this.mk('sleep', home, st, { inside: true, stable: true, hours: rng.float(0.8, 1.3) }) : null;
        return this.mk('sleep', home, st, { inside: true, stable: true, hours: Math.min(10, Math.max(1, d)) });
      }
      case 'eat': {
        const inns = sp.byKind('inn').filter((p) => !this.avoided(st, p, now));
        const t = st.traits;
        let p = TUNE.innMealShare + (t.has('cheerful') ? 0.2 : 0) + (t.has('cunning') ? 0.1 : 0) + (t.has('boastful') ? 0.1 : 0);
        if (st.role === 'guard') p += 0.35;
        if (st.role === 'legend' || st.role === 'wanderer') p = 0.9;
        if (st.role === 'innkeeper' || mood.siege) p = 0;
        if (inns.length && rng.chance(p)) return this.mk('eat', inns[st.npcId % inns.length], st, { stable: false });
        if (home) return this.mk('eat', home, st, { inside: true });
        return inns.length ? this.mk('eat', inns[0], st) : null;
      }
      case 'work':
        return work ? this.mk('work', work, st, { stable: true }) : null;
      case 'trade':
        return work ? this.mk('trade', work, st, { stable: true }) : null;
      case 'patrol': {
        const posts = st.posts.length ? st.posts : [sp.plaza];
        for (let k = 0; k < posts.length; k++) {
          const p = posts[st.postIdx++ % posts.length];
          if (!this.avoided(st, p, now)) return this.mk('patrol', p, st, { hours: rng.float(0.3, 0.8) });
        }
        return null;
      }
      case 'muster': {
        const gates = sp.gates.length ? sp.gates : sp.posts;
        if (gates.length === 0) return null;
        const g = gates[hash32(st.npcId, 9) % gates.length];
        return this.avoided(st, g, now) ? null : this.mk('muster', g, st, { hurry: true });
      }
      case 'train': {
        const kinds: PlaceKind[] = st.role === 'master' ? ['dojo', 'hall', 'pagoda'] : ['dojo', 'barracks', 'hall'];
        const list = kinds.flatMap((k) => sp.byKind(k)).filter((p) => !this.avoided(st, p, now));
        const p = work && (work.kind === 'dojo' || work.kind === 'hall' || work.kind === 'pagoda') ? work : list.length ? list[st.npcId % list.length] : sp.plaza;
        return this.mk('train', p, st, { stable: true });
      }
      case 'pray': {
        const list = (['shrine', 'pagoda', 'hall'] as const).flatMap((k) => sp.byKind(k)).filter((p) => !this.avoided(st, p, now));
        return list.length ? this.mk('pray', list[st.npcId % list.length], st) : null;
      }
      case 'sweep': {
        const service = st.work && ['smithy', 'alchemy', 'market', 'inn'].includes(st.work.kind);
        const p = service ? work : home;
        return p ? this.mk('sweep', p, st) : null;
      }
      case 'wander': {
        const useHome = home && rng.chance(0.4);
        return this.mk('wander', useHome ? home : sp.plaza, st);
      }
      case 'rest':
        return home ? this.mk('rest', home, st) : this.mk('rest', sp.plaza, st);
      case 'socialise': {
        const mine = this.findWaiter(st, e, TUNE.chatSeekRadius);
        if (mine) {
          const me = this.ctx.npcEntity(mine.npcId)!;
          return { act: 'socialise', place: mine.place, spot: { x: me.x, y: me.y }, inside: false, hours: rng.float(TUNE.chatHours[0], TUNE.chatHours[1]), partnerId: mine.npcId, hurry: false };
        }
        const inns = sp.byKind('inn');
        const w = rng.next() + (st.traits.has('cheerful') && inns.length ? 0.25 : 0);
        let p: Place = sp.plaza;
        if (w > 0.82 && inns.length && hp >= 11) p = inns[st.npcId % inns.length];
        else if (w > 0.7 && sp.byKind('market').length) p = sp.byKind('market')[0];
        else if (w > 0.6 && home) p = home;
        return this.mk('socialise', this.avoided(st, p, now) ? sp.plaza : p, st, { hours: rng.float(TUNE.chatHours[0], TUNE.chatHours[1]) * 1.8 });
      }
      case 'shelter':
      case 'hide': {
        const p = act === 'hide' && home ? home : this.nearestShelter(sp, e, st, now);
        if (!p) return null;
        const inside = act === 'hide' || mood.rain >= 0.95 || hash01(st.npcId, Math.floor(now / 60000)) < TUNE.shelterInsideShare;
        return this.mk(act, p, st, { inside, hurry: true });
      }
      case 'mourn': {
        if (!st.mourn) return null;
        const place = sp.all.find((p) => p.id === st.mourn!.placeId) ?? home;
        if (!place) return null;
        const plan = this.mk('mourn', place, st, { hours: rng.float(TUNE.mournHours[0], TUNE.mournHours[1]) });
        st.mourn = null;
        return plan;
      }
      case 'celebrate':
        return this.mk('celebrate', sp.plaza, st);
      case 'mope': {
        const market = sp.byKind('market').filter((p) => !this.avoided(st, p, now));
        return this.mk('mope', market.length ? market[st.npcId % market.length] : sp.plaza, st);
      }
    }
  }

  // ---- committing a plan: depart / snap / arrive -------------------------------------------------

  private commit(st: LifeState, e: Entity, plan: Plan, now: number, near: boolean): void {
    this.tickNeeds(st, null, now);
    st.act = plan.act;
    st.place = plan.place;
    st.spot = plan.spot;
    st.inside = plan.inside;
    st.partnerId = plan.partnerId;
    st.hours = plan.hours;
    st.hurry = plan.hurry;
    st.retries = 0;
    if (!near) {
      this.snap(st, e, now);
      return;
    }
    if (!e.move && e.x === plan.spot.x && e.y === plan.spot.y && plan.partnerId === null) {
      this.arrive(st, e, now);
      return;
    }
    st.ph = 'depart';
    const [lo, hi] = TUNE.departJitterMs;
    st.departAt = now + (plan.hurry ? this.ctx.rng.int(200, 1500) : this.ctx.rng.int(lo, hi));
  }

  private startTravel(st: LifeState, e: Entity, now: number, near: boolean): void {
    if (!near) {
      this.snap(st, e, now);
      return;
    }
    const token = ++st.token;
    st.ph = 'travel';
    this.stats.travels++;
    const opts = {
      snap: 0,
      maxSteps: TUNE.travelMaxSteps,
      maxNodes: TUNE.travelMaxNodes,
      speed: st.hurry ? e.speed * TUNE.hurrySpeed : undefined,
      onArrive: (_ent: Entity, res: 'arrived' | 'cancelled' | 'removed') => this.onArrive(st, token, res),
    };
    let ok: boolean;
    if (st.partnerId !== null) {
      const pe = this.ctx.npcEntity(st.partnerId);
      ok = !!pe && this.ctx.movement.approach(e, pe, { ...opts, range: 1.6 }).ok;
    } else {
      ok = this.ctx.movement.moveTo(e, st.spot.x, st.spot.y, opts).ok;
    }
    if (!ok && st.token === token && st.ph === 'travel') this.travelFailed(st, e, now);
  }

  private travelFailed(st: LifeState, e: Entity, now: number): void {
    if (st.place) st.avoid.set(st.place.id, now + TUNE.avoidPlaceMs);
    st.token++;
    st.partnerId = null;
    if (st.place && !this.isNear(st.sid, now)) {
      this.snap(st, e, now);
      return;
    }
    st.act = null;
    st.ph = 'idle';
  }

  private onArrive(st: LifeState, token: number, res: 'arrived' | 'cancelled' | 'removed'): void {
    if (token !== st.token || st.ph !== 'travel') return;
    const e = this.ctx.npcEntity(st.npcId);
    if (!e || e.id !== st.entityId) return;
    const now = this.ctx.now();
    if (res === 'arrived') this.arrive(st, e, now);
    else if (res === 'cancelled') {
      // A player stopping the NPC to talk is not a failure: wait it out.
      const held = (NPC_DATA.get(e)?.holdUntil ?? 0) > now;
      if (held || st.retries++ < TUNE.travelRetries) {
        st.ph = 'depart';
        st.departAt = now + 1500;
      } else this.travelFailed(st, e, now);
    }
  }

  /** Far NPCs (and failed walks of unseen NPCs) jump to where their schedule says. */
  private snap(st: LifeState, e: Entity, now: number): void {
    st.token++;
    this.stats.snaps++;
    if (st.partnerId !== null) {
      const pe = this.ctx.npcEntity(st.partnerId);
      if (pe) st.spot = { x: pe.x, y: pe.y };
      st.partnerId = null;
    }
    if (e.x !== st.spot.x || e.y !== st.spot.y || e.move) this.ctx.movement.teleport(e, st.spot.x, st.spot.y);
    this.arrive(st, e, now);
  }

  private arrive(st: LifeState, e: Entity, now: number): void {
    st.partnerId = null;
    if (st.act === 'socialise' && st.chatWith === null && this.isNear(st.sid, now)) {
      const other = this.findWaiter(st, e, TUNE.chatRadius);
      if (other) {
        const oe = this.ctx.npcEntity(other.npcId);
        if (oe && Math.hypot(oe.x - e.x, oe.y - e.y) <= 2.1) {
          this.pair(st, other, now);
          return;
        }
        st.partnerId = other.npcId;
        this.startTravel(st, e, now, true);
        return;
      }
      st.waiting = true;
      let set = this.waiters.get(st.sid);
      if (!set) this.waiters.set(st.sid, (set = new Set()));
      set.add(st.npcId);
    }
    this.beginDoing(st, e, now);
  }

  private beginDoing(st: LifeState, e: Entity, now: number): void {
    const act = st.act ?? 'wander';
    const def = ACTIVITIES[act];
    this.tickNeeds(st, null, now);
    st.ph = 'doing';
    st.startedAt = now;
    st.until = now + st.hours * this.hourMs;
    st.nextLookAt = now + this.ctx.rng.int(2000, 6000);
    if (st.inside && st.place?.enter) {
      e.hidden = true;
      e.act = undefined;
      e.state = 'idle';
    } else {
      st.inside = false;
      if (st.place && (e.x !== st.place.look.x || e.y !== st.place.look.y) && act !== 'celebrate' && act !== 'wander') {
        e.face = faceFor(st.place.look.x - e.x, st.place.look.y - e.y, e.face);
      }
      e.act = this.cueFor(st, def.cue);
      e.state = def.state;
    }
    this.ctx.entities.touch(e);
  }

  private endDoing(st: LifeState, e: Entity, now: number, keepAct = false): void {
    if (st.ph === 'doing') this.tickNeeds(st, st.act, now);
    if (st.chatWith !== null) {
      const o = this.states.get(st.chatWith);
      if (o) {
        o.chatWith = null;
        o.until = Math.min(o.until, now);
        if (o.ph === 'doing' && o.act === 'socialise') o.interruptAt = 0;
      }
      st.chatWith = null;
    }
    this.removeWaiter(st);
    if (e.act !== undefined || e.hidden || (e.state !== 'idle' && !e.move)) {
      e.act = undefined;
      e.hidden = false;
      if (!e.move) e.state = 'idle';
      this.ctx.entities.touch(e);
    }
    st.inside = false;
    st.suppressed = false;
    if (!keepAct) st.lastAct = st.act;
    st.act = null;
    st.ph = 'idle';
  }

  private tickNeeds(st: LifeState, act: ActivityId | null, now: number): void {
    const dt = (now - st.needsAt) / this.hourMs;
    st.needsAt = now;
    advanceNeeds(st.needs, act, dt, st.traits);
  }

  // ---- conversations -----------------------------------------------------------------------------

  private removeWaiter(st: LifeState): void {
    st.waiting = false;
    this.waiters.get(st.sid)?.delete(st.npcId);
  }

  /** Nearest NPC of the settlement that is standing around waiting for company. */
  private findWaiter(st: LifeState, e: Entity, radius: number): LifeState | null {
    const set = this.waiters.get(st.sid);
    if (!set || set.size === 0) return null;
    let best: LifeState | null = null;
    let bestD = radius * radius;
    for (const id of set) {
      if (id === st.npcId) continue;
      const o = this.states.get(id);
      if (!o || o.ph !== 'doing' || !o.waiting || o.chatWith !== null) continue;
      const oe = this.ctx.npcEntity(id);
      if (!oe || oe.hidden) continue;
      const d = (oe.x - e.x) ** 2 + (oe.y - e.y) ** 2;
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private pair(a: LifeState, b: LifeState, now: number): void {
    const ea = this.ctx.npcEntity(a.npcId);
    const eb = this.ctx.npcEntity(b.npcId);
    if (!ea || !eb) return;
    this.removeWaiter(a);
    this.removeWaiter(b);
    a.chatWith = b.npcId;
    b.chatWith = a.npcId;
    const dur = this.ctx.rng.float(TUNE.chatHours[0], TUNE.chatHours[1]) * this.hourMs;
    for (const [s, me, other] of [
      [a, ea, eb],
      [b, eb, ea],
    ] as const) {
      s.ph = 'doing';
      s.act = 'socialise';
      s.inside = false;
      s.startedAt = now;
      s.until = now + dur;
      me.face = faceFor(other.x - me.x, other.y - me.y, me.face);
      me.act = 'chat';
      me.state = 'idle';
      this.ctx.entities.touch(me);
    }
    this.stats.pairs++;
    this.ctx.events.emit('npcChat', { a: a.npcId, b: b.npcId, settlementId: a.sid });
  }

  // ---- reactions ---------------------------------------------------------------------------------

  /** Make the settlement's NPCs re-decide soon (staggered). Sleepers stay asleep unless `wake` says otherwise. */
  interruptSettlement(sid: number, now: number, wake: (st: LifeState) => boolean = () => false): void {
    const [lo, hi] = TUNE.interruptDelayMs;
    for (const st of this.states.values()) {
      if (st.sid !== sid) continue;
      if (st.ph === 'doing' && st.act === 'sleep' && !wake(st)) continue;
      const at = now + this.ctx.rng.int(lo, hi);
      st.interruptAt = st.interruptAt ? Math.min(st.interruptAt, at) : at;
    }
  }

  private onHour(events: SimEvent[]): void {
    const now = this.ctx.now();
    for (const ev of events) {
      if (ev.k === 'npcDied') this.onDeath(ev.id, now);
      else if (ev.k === 'newSeason') this.festivalDay = this.ctx.sim.clock().day;
    }
    this.syncRoster();
    // Weather, siege, famine, festival...: any change of a settlement's mood stirs its people.
    const sids = new Set<number>();
    for (const st of this.states.values()) sids.add(st.sid);
    for (const sid of sids) {
      const mood = this.moodOf(sid, now, true);
      const sig = this.moodSig(mood);
      const prev = this.sigs.get(sid);
      this.sigs.set(sid, sig);
      if (prev === undefined || prev === sig) continue;
      const alarm = mood.siege || mood.blightAlarm;
      const wasAlarm = prev[0] === '1' || prev[1] === '1';
      this.interruptSettlement(sid, now, (st) => alarm !== wasAlarm && (st.role === 'guard' || st.role === 'master' || st.role === 'legend'));
    }
  }

  private onDeath(id: number, now: number): void {
    const dead = this.ctx.sim.npc(id);
    const st = this.states.get(id);
    const homePlace = st?.home ?? null;
    this.drop(id);
    if (!dead) return;
    const sp = this.wp.settlements.get(dead.settlementId);
    if (!sp) return;
    const place = homePlace ?? sp.plaza;
    const sn = surname(dead);
    const cands = [...this.states.values()].filter((s) => s.sid === dead.settlementId && s.role !== 'legend' && s.role !== 'wanderer');
    const rank = (s: LifeState): number => {
      const n = this.ctx.sim.npc(s.npcId);
      return (s.home === homePlace && homePlace ? 0 : 2) + (n && surname(n) === sn ? 0 : 1) + hash01(s.npcId, id);
    };
    cands.sort((a, b) => rank(a) - rank(b));
    const [lo, hi] = TUNE.interruptDelayMs;
    for (const s of cands.slice(0, TUNE.mourners)) {
      s.mourn = { placeId: place.id, expires: now + TUNE.mournCallHours * this.hourMs };
      if (s.ph === 'doing' && s.act === 'sleep') continue;
      s.interruptAt = now + this.ctx.rng.int(lo, hi);
    }
  }
}
