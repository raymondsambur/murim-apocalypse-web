/**
 * The living-world simulation. `createSim(world, opts)` returns a deterministic `Sim`:
 * the same seed, the same sequence of calls and the same `nowMs` values give byte-identical
 * snapshots. No sockets, timers, database or wall-clock reads: the server passes `nowMs`.
 */
import { Rng, hash32, residentsOf, type ChronicleEntry, type MissionOffer, type MonsterFamily, type NpcState, type SettlementView, type SimEvent, type SimState, type TimeView, type WeatherKind, type WorldData, type WorldInfo } from '@murim/shared';
import type { CreateSim, SerializedSim, ShopListing, Sim, SimOptions } from './api';
import { initBlight, initHearts, blightHour, damageHeartImpl, emitBlight, heartsDaily, heartsHourly, purifyArea } from './blight';
import { BLIGHT, BOARD_HOUR, DAYS_PER_SEASON, SIM_VERSION } from './constants';
import { chron, pruneChronKeys } from './chronicle';
import { clockOf, dayOf, hourOfDay, seasonOf } from './clock';
import { economyDaily, priceMultImpl, recordTradeImpl } from './economy';
import { happeningsDaily } from './happenings';
import { factionBriefs, factionsDaily, getFaction, initFactions } from './factions';
import { boardView, initBoards, refreshBoards, returnOfferImpl, recordMissionDoneImpl, takeOfferImpl, topUpBoards } from './missions';
import { buildNpcIndex, greetingFor, initNpcs, npcsDaily, npcsHourly, shopForNpc } from './npcs';
import { newExt, restoreState, serializeState } from './serialize';
import { finishSettlementInit, initSettlements, initialControllers, settlementsDaily, settlementsHourly, siegeKill } from './settlements';
import { staticFor } from './static';
import type { Ctx, SimStateX } from './types';
import { besieged, clamp, emit, toBase64 } from './util';
import { initWeather, weatherDaily, weatherHourly } from './weather';

const SEASON_LINES = ['Spring has come; the thaw begins.', 'Summer has come; the heat rises.', 'Autumn has come; the harvest begins.', 'Winter has come.'];

// ---------------------------------------------------------------------------
// Fresh world
// ---------------------------------------------------------------------------

function freshState(ctx: Ctx, seed: number): void {
  const { S, world } = ctx;
  const st: SimStateX = {
    version: SIM_VERSION,
    seed,
    clock: { totalHours: 0 },
    weather: [],
    blight: new Uint8Array(S.n),
    hearts: [],
    settlements: [],
    factions: [],
    npcs: [],
    chronicle: [],
    boards: {},
    rng: 0,
    nextNpcId: 1,
    nextChronicleId: 1,
    nextOfferId: 1,
    ext: newExt(),
  };
  ctx.st = st;
  st.ext.roadBlocked = world.roads.map(() => 0);
  st.weather = initWeather(ctx);
  st.hearts = initHearts(ctx);
  initBlight(ctx);
  const owners = initialControllers(ctx);
  st.settlements = initSettlements(ctx, owners);
  st.factions = initFactions(ctx, owners);
  finishSettlementInit(ctx);
  initNpcs(ctx);
  initBoards(ctx);
  const ruin = S.ruinId >= 0 ? S.defs[S.ruinId].name : null;
  if (ruin) chron(ctx, 'blight', `The Blight festers around ${ruin}, where ${st.hearts.length} dark hearts pulse beneath the ash.`, 2, { force: true });
  chron(ctx, 'season', SEASON_LINES[0], 1, { force: true });
  st.rng = ctx.rng.state >>> 0;
}

// ---------------------------------------------------------------------------
// One world hour
// ---------------------------------------------------------------------------

function stepHour(ctx: Ctx): void {
  const st = ctx.st;
  st.clock.totalHours += 1;
  const now = st.clock.totalHours;
  const hod = hourOfDay(now);
  const day = dayOf(now);
  if (hod === 0) {
    emit(ctx, { k: 'newDay', day });
    if (day % DAYS_PER_SEASON === 0) {
      const season = seasonOf(day);
      emit(ctx, { k: 'newSeason', season });
      chron(ctx, 'season', SEASON_LINES[season], 2, { force: true });
    }
    weatherDaily(ctx);
  }
  weatherHourly(ctx, hod);
  blightHour(ctx);
  heartsHourly(ctx);
  settlementsHourly(ctx);
  npcsHourly(ctx);
  if (hod === 0) {
    heartsDaily(ctx);
    const open = economyDaily(ctx);
    settlementsDaily(ctx, open);
    factionsDaily(ctx);
    npcsDaily(ctx);
    happeningsDaily(ctx);
    pruneChronKeys(ctx);
  }
  if (hod === BOARD_HOUR) refreshBoards(ctx);
  topUpBoards(ctx);
}

// ---------------------------------------------------------------------------
// Sim implementation
// ---------------------------------------------------------------------------

class SimImpl implements Sim {
  readonly hourMs: number;
  private readonly ctx: Ctx;
  private anchorMs: number;

  constructor(world: WorldData, opts: SimOptions) {
    this.hourMs = opts.hourMs > 0 ? opts.hourMs : 60000;
    this.anchorMs = opts.nowMs;
    const S = staticFor(world);
    const rng = new Rng(hash32(opts.seed, 0x51ed, 0x7e11));
    const ctx: Ctx = {
      world,
      // Replaced below, before anything reads it.
      st: undefined as unknown as SimStateX,
      rng,
      S,
      events: [],
      hourMs: this.hourMs,
      wallMs: opts.nowMs,
      npcById: new Map(),
    };
    this.ctx = ctx;
    if (opts.saved) {
      ctx.st = restoreState(opts.saved, { seed: opts.seed, tiles: S.n, settlements: world.settlements.length, hearts: world.nodes.filter((n) => n.kind === 'heart').length });
      rng.state = ctx.st.rng;
      buildNpcIndex(ctx);
    } else {
      // World generation seeds the starting layout; opts.seed seeds the simulation's own Rng.
      freshState(ctx, opts.seed);
    }
    ctx.events = [];
  }

  get state(): SimState {
    return this.ctx.st;
  }

  private collect(fn: () => void): SimEvent[] {
    const saved = this.ctx.events;
    const mine: SimEvent[] = [];
    this.ctx.events = mine;
    try {
      fn();
    } finally {
      this.ctx.events = saved;
      this.ctx.st.rng = this.ctx.rng.state >>> 0;
    }
    return mine;
  }

  // ---- Clock -----------------------------------------------------------------

  advanceHours(n: number, nowMs: number): SimEvent[] {
    const hours = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
    const ctx = this.ctx;
    const out: SimEvent[] = [];
    if (hours === 0) return out;
    const saved = ctx.events;
    ctx.events = out;
    try {
      for (let k = 1; k <= hours; k++) {
        ctx.wallMs = nowMs - (hours - k) * this.hourMs;
        stepHour(ctx);
      }
    } finally {
      ctx.events = saved;
    }
    ctx.wallMs = nowMs;
    this.anchorMs = nowMs;
    ctx.st.rng = ctx.rng.state >>> 0;
    return out;
  }

  timeView(nowMs: number): TimeView {
    const st = this.ctx.st;
    const total = st.clock.totalHours;
    const frac = clamp((nowMs - this.anchorMs) / this.hourMs, 0, 0.999);
    const c = clockOf(total);
    return {
      hours: c.hour + frac,
      day: c.day,
      season: c.season,
      year: c.year,
      hourMs: this.hourMs,
      t: nowMs,
      weather: st.weather.map((w) => w.kind),
    };
  }

  clock(): { totalHours: number; hour: number; day: number; season: number; year: number } {
    return clockOf(this.ctx.st.clock.totalHours);
  }

  // ---- Settlements and world ---------------------------------------------------

  settlementView(id: number): SettlementView {
    const s = this.ctx.st.settlements[id];
    if (!s) throw new RangeError(`unknown settlement ${id}`);
    const def = this.ctx.S.defs[id];
    let named = 0;
    for (const n of this.ctx.st.npcs) if (n.alive && n.settlementId === id) named++;
    return {
      id: s.id,
      controller: s.controller,
      status: s.status,
      prosperity: Math.round(s.prosperity),
      // the people who live there, named and nameless: what you can count in the streets at midday (see shared/crowd.ts)
      population: residentsOf(def.kind, s.population, def.population, named),
      defense: Math.round(s.defense),
      blight: Math.round(s.blight),
      siege: besieged(this.ctx, s),
      flags: [...s.flags],
    };
  }

  settlementViews(): SettlementView[] {
    return this.ctx.st.settlements.map((s) => this.settlementView(s.id));
  }

  worldInfo(online: number, nowMs: number): WorldInfo {
    const st = this.ctx.st;
    return {
      settlements: this.settlementViews(),
      factions: factionBriefs(this.ctx),
      chronicle: st.chronicle.slice(-80),
      hearts: st.hearts.map((h) => ({ id: h.id, x: h.x, y: h.y, strength: Math.round(h.strength) })),
      time: this.timeView(nowMs),
      online,
    };
  }

  weatherAt(x: number, y: number): WeatherKind {
    const yy = clamp(Math.floor(y), 0, this.ctx.S.h - 1);
    return this.ctx.st.weather[this.ctx.S.rowBand[yy]].kind;
  }

  blightAt(x: number, y: number): number {
    const { w, h } = this.ctx.S;
    const xx = Math.floor(x);
    const yy = Math.floor(y);
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) return 0;
    return this.ctx.st.blight[yy * w + xx];
  }

  blightBase64(): string {
    return toBase64(this.ctx.st.blight);
  }

  priceMult(settlementId: number, itemId: string): number {
    return priceMultImpl(this.ctx, settlementId, itemId);
  }

  // ---- Missions ------------------------------------------------------------------

  board(settlementId: number): MissionOffer[] {
    return [...boardView(this.ctx, settlementId)];
  }

  takeOffer(settlementId: number, offerId: string): MissionOffer | null {
    return takeOfferImpl(this.ctx, settlementId, offerId);
  }

  returnOffer(offer: MissionOffer): void {
    returnOfferImpl(this.ctx, offer);
  }

  // ---- NPCs ------------------------------------------------------------------------

  npcs(settlementId?: number): NpcState[] {
    const out: NpcState[] = [];
    for (const n of this.ctx.st.npcs) {
      if (!n.alive) continue;
      if (settlementId !== undefined && n.settlementId !== settlementId) continue;
      out.push(n);
    }
    return out;
  }

  npc(id: number): NpcState | undefined {
    return this.ctx.npcById.get(id);
  }

  greeting(npc: NpcState, playerName: string): string {
    return greetingFor(this.ctx, npc, playerName);
  }

  shopFor(npc: NpcState): ShopListing | null {
    return shopForNpc(this.ctx, npc);
  }

  // ---- Reactions to players ---------------------------------------------------------

  recordKill(x: number, y: number, family: MonsterFamily, level: number, elite: 0 | 1 | 2): SimEvent[] {
    return this.collect(() => {
      const ctx = this.ctx;
      if (family === 'blight') {
        const amount = BLIGHT.killBase + Math.max(0, level) * BLIGHT.killPerLevel + BLIGHT.killElite[elite];
        emitBlight(ctx, purifyArea(ctx, x, y, BLIGHT.killRadius, amount));
      } else if (family === 'bandit') {
        const ext = ctx.st.ext;
        const day = dayOf(ctx.st.clock.totalHours);
        if (ext.killDay !== day) {
          ext.killDay = day;
          ext.killCredit = 0;
        }
        if (ext.killCredit < 6) {
          ext.killCredit++;
          const bw = getFaction(ctx, 'blackwind');
          if (bw) bw.power = Math.round(Math.max(5, bw.power - 0.12 * (1 + elite)) * 10) / 10;
        }
      }
      siegeKill(ctx, x, y, family, level, elite);
    });
  }

  recordTrade(settlementId: number, itemId: string, qty: number, dir: 'buy' | 'sell'): void {
    recordTradeImpl(this.ctx, settlementId, itemId, qty, dir);
  }

  recordMissionDone(offer: MissionOffer, playerName: string): SimEvent[] {
    return this.collect(() => recordMissionDoneImpl(this.ctx, offer, playerName));
  }

  damageHeart(heartId: number, amount: number, playerName: string): SimEvent[] {
    return this.collect(() => damageHeartImpl(this.ctx, heartId, amount, playerName));
  }

  purify(x: number, y: number, radius: number, amount: number): SimEvent[] {
    return this.collect(() => emitBlight(this.ctx, purifyArea(this.ctx, x, y, radius, amount)));
  }

  record(text: string, importance: 1 | 2 | 3, settlementId?: number, kind: ChronicleEntry['kind'] = 'player'): ChronicleEntry {
    const ctx = this.ctx;
    let entry: ChronicleEntry | null = null;
    // The caller broadcasts the returned entry itself, so keep it out of the next hour's events.
    const saved = ctx.events;
    ctx.events = [];
    try {
      entry = chron(ctx, kind, text, importance, { sid: settlementId, force: true });
    } finally {
      ctx.events = saved;
    }
    ctx.st.rng = ctx.rng.state >>> 0;
    return entry as ChronicleEntry;
  }

  serialize(): SerializedSim {
    this.ctx.st.rng = this.ctx.rng.state >>> 0;
    return serializeState(this.ctx.st);
  }
}

export const createSim: CreateSim = (world, opts) => new SimImpl(world, opts);

export type { Sim, SimOptions, SerializedSim, ShopListing, CreateSim } from './api';
