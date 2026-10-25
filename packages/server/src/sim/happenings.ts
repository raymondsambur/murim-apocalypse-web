/**
 * Daily local happenings: small, state-driven events (harvests, mine strikes, beast raids,
 * bandit ambushes, births among the named NPCs, pilgrims, rumours...). Most nudge stock,
 * prosperity or the mission boards a little, and each writes a short chronicle line so the
 * public history reads like a living world.
 */
import type { NpcRole, NpcState, SettlementState } from '@murim/shared';
import { HAPPEN } from './constants';
import { chron } from './chronicle';
import { dayOf, seasonOf } from './clock';
import { markBoard } from './missions';
import type { Ctx } from './types';
import { besieged, clamp, emit, round1, settlementName } from './util';

interface Happening {
  key: string;
  /** Days before the same event may repeat in the same settlement. */
  cooldown: number;
  weight: (ctx: Ctx, s: SettlementState, season: number, dayInSeason: number) => number;
  /** Apply the effect; return the chronicle line (or null to skip). */
  apply: (ctx: Ctx, s: SettlementState, name: string) => string | null;
}

function hasSite(ctx: Ctx, sid: number, kind: string): boolean {
  return ctx.S.defs[sid].sites.some((x) => x.kind === kind);
}
function hasBuilding(ctx: Ctx, sid: number, kind: string): boolean {
  return ctx.S.buildings[sid].some((b) => b.kind === kind);
}
function pickNpc(ctx: Ctx, sid: number, roles: NpcRole[]): NpcState | null {
  const cand = ctx.st.npcs.filter((n) => n.alive && n.settlementId === sid && roles.includes(n.role));
  return cand.length ? cand[ctx.rng.int(0, cand.length - 1)] : null;
}
function addStock(s: SettlementState, g: string, qty: number): void {
  s.stock[g] = round1(Math.max(0, (s.stock[g] ?? 0) + qty));
}
function neighbours(ctx: Ctx, sid: number): number[] {
  return ctx.S.adj[sid].map(([o]) => o).filter((o) => ctx.st.settlements[o].status !== 'fallen');
}

const HAPPENINGS: Happening[] = [
  {
    key: 'harvest',
    cooldown: 90,
    weight: (ctx, s, season, d) => (season === 2 && d < 24 && (s.prod.grain ?? 0) > 3 ? 5 : 0),
    apply: (ctx, s, name) => {
      if (s.blight > 14) {
        addStock(s, 'grain', -(s.cons.grain ?? 0) * 3);
        return `Blighted rot spoils part of the harvest in ${name}.`;
      }
      addStock(s, 'grain', (s.cons.grain ?? 0) * 7);
      s.prosperity = clamp(s.prosperity + 1.5, 0, 100);
      return `A bountiful autumn harvest fills the granaries of ${name}.`;
    },
  },
  {
    key: 'sowing',
    cooldown: 90,
    weight: (ctx, s, season, d) => (season === 0 && d < 20 && (s.prod.grain ?? 0) > 3 ? 4 : 0),
    apply: (ctx, s, name) => `Farmers of ${name} sow the spring fields under cautious skies.`,
  },
  {
    key: 'frost',
    cooldown: 40,
    weight: (ctx, s, season) => (season === 3 ? 2.5 : 0),
    apply: (ctx, s, name) => {
      addStock(s, 'herb', -(s.cons.herb ?? 0));
      return ctx.rng.pick([`Hard frost grips ${name}; woodsmoke rises from every chimney.`, `A bitter wind off the heights sends the people of ${name} indoors.`]);
    },
  },
  {
    key: 'beasts',
    cooldown: 18,
    weight: (ctx, s, season) => (s.status !== 'fallen' && ctx.S.spawnsNear[s.id].length > 0 ? 1.4 + (season === 3 ? 1.2 : 0) : 0),
    apply: (ctx, s, name) => {
      addStock(s, 'meat', -(s.stock.meat ?? 0) * 0.2);
      s.prosperity = clamp(s.prosperity - 0.5, 0, 100);
      markBoard(ctx, s.id);
      return ctx.rng.pick([`Wolves raid the herds on the edge of ${name}.`, `A bear has torn through the pens of ${name}; hunters are wanted.`]);
    },
  },
  {
    key: 'vein',
    cooldown: 40,
    weight: (ctx, s) => (hasSite(ctx, s.id, 'mine') ? 1.1 : 0),
    apply: (ctx, s, name) => {
      if (ctx.rng.chance(0.55)) {
        addStock(s, 'ore_iron', 10 + ctx.rng.int(0, 10));
        return `Miners of ${name} strike a rich vein of iron.`;
      }
      addStock(s, 'ore_iron', -(s.stock.ore_iron ?? 0) * 0.3);
      return `A tunnel collapses at the ${name} mine; the work halts for a spell.`;
    },
  },
  {
    key: 'ambush',
    cooldown: 14,
    weight: (ctx, s) => {
      const bw = ctx.st.factions.find((f) => f.id === 'blackwind');
      return s.status !== 'fallen' && ctx.S.adj[s.id].length > 0 && bw ? 0.6 + bw.power / 70 : 0;
    },
    apply: (ctx, s, name) => {
      addStock(s, 'cloth', -(s.stock.cloth ?? 0) * 0.15);
      addStock(s, 'wine', -(s.stock.wine ?? 0) * 0.15);
      markBoard(ctx, s.id);
      return ctx.rng.pick([`Bandits waylay a merchant caravan on the road to ${name}.`, `Carters arriving in ${name} tell of masked riders on the high road.`]);
    },
  },
  {
    key: 'brawl',
    cooldown: 25,
    weight: (ctx, s) => (hasBuilding(ctx, s.id, 'inn') ? 1.2 : 0),
    apply: (ctx, s, name) => {
      const inn = pickNpc(ctx, s.id, ['innkeeper']);
      return inn ? `A drunken swordsman wrecks the inn of ${name}; ${inn.name} demands damages.` : `A tavern brawl spills into the streets of ${name}.`;
    },
  },
  {
    key: 'birth',
    cooldown: 30,
    weight: () => 1.1,
    apply: (ctx, s, name) => {
      const n = pickNpc(ctx, s.id, ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper']);
      if (!n) return null;
      s.population = round1(s.population + 1);
      return `A child is born to ${n.name}, the ${n.role} of ${name}; the neighbours bring rice cakes.`;
    },
  },
  {
    key: 'wedding',
    cooldown: 30,
    weight: (ctx, s) => (s.status === 'thriving' || s.status === 'stable' ? 0.9 : 0),
    apply: (ctx, s, name) => {
      const n = pickNpc(ctx, s.id, ['villager', 'merchant', 'smith', 'guard']);
      if (!n) return null;
      s.prosperity = clamp(s.prosperity + 0.4, 0, 100);
      return `${n.name} of ${name} weds; the lanterns burn until dawn.`;
    },
  },
  {
    key: 'drill',
    cooldown: 20,
    weight: (ctx, s) => (pickNpc(ctx, s.id, ['master']) ? 1.1 : 0),
    apply: (ctx, s, name) => {
      const m = pickNpc(ctx, s.id, ['master']);
      if (!m) return null;
      m.xp += 25;
      return `Master ${m.name}'s disciples drill at dawn in ${name}.`;
    },
  },
  {
    key: 'pilgrims',
    cooldown: 25,
    weight: (ctx, s) => (s.blight > 8 && hasBuilding(ctx, s.id, 'shrine') ? 1.6 : 0),
    apply: (ctx, s, name) => `Pilgrims crowd the shrine of ${name}, praying against the Blight.`,
  },
  {
    key: 'rumour',
    cooldown: 12,
    weight: (ctx, s) => (s.blight > 6 && s.status !== 'fallen' ? 1.6 + s.blight / 40 : 0),
    apply: (ctx, s, name) => {
      markBoard(ctx, s.id);
      return ctx.rng.pick([`Travellers whisper of black mist on the roads toward ${name}.`, `Shepherds near ${name} report Hollows moaning in the hills at night.`, `Dogs howl at nothing in ${name}; the elders bar their doors.`]);
    },
  },
  {
    key: 'hermit',
    cooldown: 60,
    weight: () => 0.5,
    apply: (ctx, s, name) => ctx.rng.pick([`A ragged hermit descends to ${name}, speaking of the Blight's source and refusing all food.`, `A wandering physician sets up a stall in ${name} and treats the poor for free.`]),
  },
  {
    key: 'storm',
    cooldown: 20,
    weight: (ctx, s) => {
      const w = ctx.st.weather[ctx.S.rowBand[Math.min(ctx.S.h - 1, Math.max(0, Math.round(ctx.S.defs[s.id].y)))]].kind;
      return w === 'storm' ? 4 : w === 'snow' ? 1.5 : 0;
    },
    apply: (ctx, s, name) => {
      s.prosperity = clamp(s.prosperity - 0.8, 0, 100);
      const w = ctx.st.weather[ctx.S.rowBand[Math.min(ctx.S.h - 1, Math.max(0, Math.round(ctx.S.defs[s.id].y)))]].kind;
      return w === 'snow' ? `Heavy snow buries the lanes of ${name}.` : `Storm winds tear the roofs from houses in ${name}.`;
    },
  },
  {
    key: 'talent',
    cooldown: 60,
    weight: (ctx, s) => (pickNpc(ctx, s.id, ['master']) ? 0.5 : 0),
    apply: (ctx, s, name) => {
      const m = pickNpc(ctx, s.id, ['master']);
      if (!m) return null;
      if (m.disciples < 6) m.disciples++;
      return `A gifted child of ${name} catches Master ${m.name}'s eye and is taken as a disciple.`;
    },
  },
];

function onCooldown(ctx: Ctx, key: string, days: number): boolean {
  const last = ctx.st.ext.chronKeys[key];
  return last !== undefined && ctx.st.clock.totalHours - last < days * 24;
}

export function happeningsDaily(ctx: Ctx): void {
  const st = ctx.st;
  const day = dayOf(st.clock.totalHours);
  const season = seasonOf(day);
  const dayInSeason = day % 30;
  for (const s of st.settlements) {
    if (s.status === 'fallen' || besieged(ctx, s)) continue;
    if (!ctx.rng.chance(HAPPEN.perSettlementDay)) continue;
    const name = settlementName(ctx, s.id);
    const options: (readonly [Happening, number])[] = [];
    for (const h of HAPPENINGS) {
      if (onCooldown(ctx, `hap:${h.key}:${s.id}`, h.cooldown)) continue;
      const w = h.weight(ctx, s, season, dayInSeason);
      if (w > 0) options.push([h, w] as const);
    }
    if (options.length === 0) continue;
    const h = ctx.rng.weighted(options);
    const text = h.apply(ctx, s, name);
    if (!text) continue;
    st.ext.stats.happenings = (st.ext.stats.happenings ?? 0) + 1;
    chron(ctx, 'settlement', text, 1, { sid: s.id, key: `hap:${h.key}:${s.id}`, cooldown: h.cooldown * 24 });
    emit(ctx, { k: 'settle', id: s.id });
  }
}
