/**
 * Minimal deterministic stand-in for the living-world simulation (`SIM_STUB=1`, tests, or when
 * `sim/index.ts` is missing). It satisfies `sim/api.ts` with a few static NPCs per settlement, a
 * trivial clock and a little scripted activity per world hour (chronicle line, blight flicker,
 * weather flip) so the runtime's event fan-out can be exercised.
 */
import {
  HOURS_PER_DAY,
  DAYS_PER_SEASON,
  Rng,
  nearestWalkable,
  personName,
  randomLook,
  worldPathGrid,
  type ChronicleEntry,
  type MissionOffer,
  type NpcRole,
  type NpcState,
  type SettlementState,
  type SettlementView,
  type SimEvent,
  type SimState,
  type TimeView,
  type WeatherKind,
  type WorldData,
  type WorldInfo,
} from '@murim/shared';
import type { CreateSim, SerializedSim, ShopListing, Sim, SimOptions } from './api';

const START_HOUR = 6;
const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
const CHRONICLE_CAP = 300;
const BLIGHT_TILES_PER_HOUR = 3;

const ROSTER: { role: NpcRole; title: string; shop: string; level: number }[] = [
  { role: 'elder', title: 'Village Elder', shop: 'none', level: 6 },
  { role: 'merchant', title: 'Merchant', shop: 'general', level: 4 },
  { role: 'guard', title: 'Guard', shop: 'none', level: 8 },
  { role: 'guard', title: 'Guard', shop: 'none', level: 8 },
  { role: 'villager', title: '', shop: 'none', level: 2 },
];

interface StubSave {
  state: Omit<SimState, 'blight'>;
  anchor: number;
}

function b64(a: Uint8Array): string {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}

function fromB64(s: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(Buffer.from(s, 'base64').subarray(0, size));
  return out;
}

function initialState(world: WorldData, seed: number): SimState {
  const rng = new Rng(seed ^ 0x57ab);
  const grid = worldPathGrid(world);
  const used = new Set<number>();
  const npcs: NpcState[] = [];
  let nextNpcId = 1;
  for (const s of world.settlements) {
    if (s.kind === 'ruin') continue;
    ROSTER.forEach((r, i) => {
      const want = { x: s.spawn.x + ((i % 3) - 1) * 2, y: s.spawn.y + (Math.floor(i / 3) - 1) * 2 };
      let home = nearestWalkable(grid, want.x, want.y, 6) ?? { ...s.spawn };
      for (let tries = 0; used.has(home.y * world.w + home.x) && tries < 8; tries++) home = nearestWalkable(grid, home.x + 1, home.y, 6) ?? home;
      used.add(home.y * world.w + home.x);
      npcs.push({
        id: nextNpcId++,
        name: personName(rng),
        look: randomLook(rng),
        role: r.role,
        faction: null,
        settlementId: s.id,
        age: 25 + rng.int(0, 30),
        level: r.level,
        xp: 0,
        alive: true,
        legend: false,
        title: r.title,
        teaches: [],
        shop: r.shop,
        bornDay: -365 * 30,
        diedDay: null,
        homeX: home.x,
        homeY: home.y,
        traits: [],
        disciples: 0,
      });
    });
  }
  const settlements: SettlementState[] = world.settlements.map((s) => ({
    id: s.id,
    controller: null,
    status: s.kind === 'ruin' ? 'fallen' : 'stable',
    prosperity: 50,
    defense: 50,
    population: s.population,
    blight: 0,
    siegeUntil: 0,
    siegeStrength: 0,
    siegeBy: null,
    stock: {},
    prod: {},
    cons: {},
    flags: [],
    changedAt: 0,
  }));
  const hearts = world.nodes.filter((n) => n.kind === 'heart').map((n, i) => ({ id: i, x: n.x, y: n.y, strength: 50, sealedUntil: 0 }));
  return {
    version: 1,
    seed,
    clock: { totalHours: 0 },
    weather: [0, 1, 2].map((zone) => ({ zone, kind: 'clear' as WeatherKind, sinceHour: 0 })),
    blight: new Uint8Array(world.w * world.h),
    hearts,
    settlements,
    factions: [],
    npcs,
    chronicle: [],
    boards: {},
    rng: rng.state,
    nextNpcId,
    nextChronicleId: 1,
    nextOfferId: 1,
  };
}

export const createStubSim: CreateSim = (world: WorldData, opts: SimOptions): Sim => {
  let state = initialState(world, opts.seed);
  let anchor = opts.nowMs;
  if (opts.saved) {
    try {
      const saved = JSON.parse(opts.saved.json) as StubSave;
      if (saved.state && Array.isArray(saved.state.npcs) && Array.isArray(saved.state.settlements)) {
        state = { ...saved.state, blight: fromB64(opts.saved.blight, world.w * world.h) };
        anchor = typeof saved.anchor === 'number' ? saved.anchor : opts.nowMs;
      }
    } catch {
      /* unreadable stub snapshot: start fresh */
    }
  }
  const hourMs = opts.hourMs;
  const heart = state.hearts[0];

  const clock = () => {
    const h = state.clock.totalHours + START_HOUR;
    const day = Math.floor(h / HOURS_PER_DAY);
    return { totalHours: state.clock.totalHours, hour: h % HOURS_PER_DAY, day, season: Math.floor(day / DAYS_PER_SEASON) % 4, year: Math.floor(day / DAYS_PER_YEAR) };
  };

  const zoneOf = (y: number) => (y < world.h * 0.3 ? 0 : y > world.h * 0.68 ? 2 : 1);

  const record = (text: string, importance: 1 | 2 | 3, settlementId?: number, kind: ChronicleEntry['kind'] = 'player', t = anchor): ChronicleEntry => {
    const c = clock();
    const entry: ChronicleEntry = { id: state.nextChronicleId++, day: c.day, hour: c.hour, kind, text, importance, t };
    if (settlementId !== undefined) entry.settlementId = settlementId;
    state.chronicle.push(entry);
    if (state.chronicle.length > CHRONICLE_CAP) state.chronicle.splice(0, state.chronicle.length - CHRONICLE_CAP);
    return entry;
  };

  const timeView = (nowMs: number): TimeView => {
    const c = clock();
    const frac = Math.min(0.999, Math.max(0, (nowMs - anchor) / hourMs));
    return { hours: (c.hour + frac) % HOURS_PER_DAY, day: c.day, season: c.season, year: c.year, hourMs, t: nowMs, weather: state.weather.map((w) => w.kind) };
  };

  const settlementView = (id: number): SettlementView => {
    const s = state.settlements[id];
    if (!s) throw new Error(`stub sim: no settlement ${id}`);
    return { id: s.id, controller: s.controller, status: s.status, prosperity: s.prosperity, population: s.population, defense: s.defense, blight: s.blight, siege: s.siegeUntil > state.clock.totalHours, flags: [...s.flags] };
  };

  if (state.chronicle.length === 0) record('The stub world begins.', 2, undefined, 'season');

  const sim: Sim = {
    get state() {
      return state;
    },
    hourMs,

    advanceHours(n: number, nowMs: number): SimEvent[] {
      const events: SimEvent[] = [];
      for (let i = 0; i < n; i++) {
        state.clock.totalHours++;
        anchor = nowMs;
        const c = clock();
        if (c.hour === 0) events.push({ k: 'newDay', day: c.day });
        if (c.hour % 6 === 0) events.push({ k: 'chron', entry: record(`Day ${c.day}, hour ${c.hour}: the stub world turns.`, 1, undefined, 'weather', nowMs) });
        if (c.hour === 12) {
          const w = state.weather[1];
          w.kind = w.kind === 'clear' ? 'rain' : 'clear';
          w.sinceHour = state.clock.totalHours;
          events.push({ k: 'weather', zone: 1, kind: w.kind });
        }
        if (heart) {
          const idx: number[] = [];
          for (let k = 0; k < BLIGHT_TILES_PER_HOUR; k++) {
            const i2 = Math.min(world.w * world.h - 1, (heart.y + k) * world.w + heart.x);
            state.blight[i2] = (state.blight[i2] + 1) & 255;
            idx.push(i2);
          }
          events.push({ k: 'blight', idx });
        }
      }
      return events;
    },
    timeView,
    clock,

    settlementView,
    settlementViews: () => state.settlements.map((s) => settlementView(s.id)),
    worldInfo(online: number, nowMs: number): WorldInfo {
      return {
        settlements: sim.settlementViews(),
        factions: [],
        chronicle: state.chronicle.slice(-40),
        hearts: state.hearts.map((h) => ({ id: h.id, x: h.x, y: h.y, strength: h.strength })),
        time: timeView(nowMs),
        online,
      };
    },

    weatherAt: (_x: number, y: number): WeatherKind => state.weather[zoneOf(y)].kind,
    blightAt: (x: number, y: number): number => (x >= 0 && y >= 0 && x < world.w && y < world.h ? state.blight[y * world.w + x] : 0),
    blightBase64: () => b64(state.blight),

    priceMult: () => 1,

    board: (): MissionOffer[] => [],
    takeOffer: (): MissionOffer | null => null,
    returnOffer: (): void => {},

    npcs: (settlementId?: number) => (settlementId === undefined ? state.npcs : state.npcs.filter((n) => n.settlementId === settlementId)),
    npc: (id: number) => state.npcs.find((n) => n.id === id),
    greeting: (npc: NpcState, playerName: string) => `Greetings, ${playerName}. I am ${npc.name}.`,
    shopFor: (npc: NpcState): ShopListing | null => (npc.shop === 'general' ? { items: ['grain', 'pill_heal_s', 'cloth'], sellMult: 0.4 } : null),

    recordKill: () => [],
    recordTrade: () => {},
    recordMissionDone: () => [],
    damageHeart: () => [],
    purify: () => [],
    record: (text, importance, settlementId, kind) => record(text, importance, settlementId, kind),

    serialize(): SerializedSim {
      const { blight, ...rest } = state;
      const save: StubSave = { state: rest, anchor };
      return { json: JSON.stringify(save), blight: b64(blight) };
    },
  };
  return sim;
};

/** Same export name as the real sim module, so callers can treat both alike. */
export const createSim: CreateSim = createStubSim;
