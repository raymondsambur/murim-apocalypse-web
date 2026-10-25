/**
 * Economy: per-settlement production/consumption of the tracked GOODS, daily stock update,
 * famine, caravans along world roads (blocked by Blight, sieges and falls) and floating prices.
 */
import { GOODS, ITEMS, type SettlementState } from '@murim/shared';
import { ECON } from './constants';
import { chron } from './chronicle';
import { dayOf, seasonOf } from './clock';
import { markBoard } from './missions';
import type { Ctx } from './types';
import { besieged, clamp, hasFlag, setFlag, settlementName } from './util';

const FOOD = ['grain', 'meat'];

function countKinds(ctx: Ctx, sid: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of ctx.S.buildings[sid]) out[b.kind] = (out[b.kind] ?? 0) + 1;
  for (const site of ctx.S.defs[sid].sites) out[`site:${site.kind}`] = (out[`site:${site.kind}`] ?? 0) + 1;
  return out;
}

const CONTROL_BONUS: Record<string, Partial<Record<string, number>>> = {
  jade: { cloth: 1.25, wine: 1.25, pill_heal_s: 1.1 },
  tiger: { ore_iron: 1.2, meat: 1.1 },
  azure: { pill_heal_s: 1.3, herb: 1.1 },
  crimson: { herb: 1.25, wine: 1.1 },
  blackwind: { meat: 1.2, hide: 1.2 },
};

export function computeProdCons(ctx: Ctx, s: SettlementState): void {
  const prod: Record<string, number> = {};
  const cons: Record<string, number> = {};
  if (s.status === 'fallen') {
    for (const g of GOODS) {
      prod[g] = 0;
      cons[g] = 0;
    }
    s.prod = prod;
    s.cons = cons;
    return;
  }
  const def = ctx.S.defs[s.id];
  const k = countKinds(ctx, s.id);
  const pop = s.population;
  const season = seasonOf(dayOf(ctx.st.clock.totalHours));
  const farmhouse = k.farmhouse ?? 0;
  prod.grain = ((k['site:farm'] ?? 0) * ECON.farmGrain + pop * (ECON.gardenByKind[def.kind] ?? 0.004) + farmhouse * 3) * ECON.grainSeason[season];
  prod.meat = pop * ECON.huntMeat + farmhouse * ECON.farmhouseMeat;
  prod.herb = (k.herbHut ?? 0) * ECON.herbHut * ECON.herbSeason[season] + pop * ECON.forageHerb + (ECON.gardenHerb[def.kind] ?? 0) * ECON.herbSeason[season];
  prod.ore_iron = (k['site:mine'] ?? 0) * ECON.mineOre;
  prod.hide = pop * ECON.hideBase + farmhouse;
  prod.cloth = (k.market ?? 0) * ECON.marketCloth;
  prod.wine = (k.inn ?? 0) * ECON.innWine + (k.teahouse ?? 0) * ECON.teaWine;
  prod.pill_heal_s = (k.alchemy ?? 0) * ECON.alchemyPills;
  const blightF = 1 - clamp((s.blight / 255) * 1.6, 0, 0.85);
  const prospF = 0.6 + (0.4 * s.prosperity) / 100;
  const siegeF = besieged(ctx, s) ? 0.35 : 1;
  const bonus = s.controller ? CONTROL_BONUS[s.controller] ?? {} : {};
  for (const g of GOODS) {
    prod[g] = Math.round((prod[g] ?? 0) * blightF * prospF * siegeF * (bonus[g] ?? 1) * 100) / 100;
    let c = pop * ECON.cons[g];
    if (g === 'herb') c += (k.alchemy ?? 0) * 1.5;
    if (g === 'ore_iron') c += (k.smithy ?? 0) * 1.5 + (def.kind === 'fort' ? 1.5 : 0);
    if (g === 'pill_heal_s') c *= def.kind === 'fort' ? 2 : def.kind === 'sectHall' ? 1.5 : 1;
    cons[g] = Math.round(c * 100) / 100;
  }
  s.prod = prod;
  s.cons = cons;
}

export function initStock(ctx: Ctx, s: SettlementState): void {
  for (const g of GOODS) s.stock[g] = Math.round(Math.max(s.cons[g] * 16, s.prod[g] * 8) * 10) / 10;
}

export function foodDays(s: SettlementState): number {
  const need = (s.cons.grain ?? 0) + (s.cons.meat ?? 0);
  if (need <= 0) return 99;
  return ((s.stock.grain ?? 0) + (s.stock.meat ?? 0)) / need;
}

/** Fraction (0..1) of consumed non-food goods with at least 5 days of stock. */
export function goodsCoverage(s: SettlementState): number {
  let n = 0;
  let ok = 0;
  for (const g of GOODS) {
    if (FOOD.includes(g)) continue;
    const c = s.cons[g] ?? 0;
    if (c <= 0) continue;
    n++;
    if ((s.stock[g] ?? 0) >= c * 5) ok++;
  }
  return n ? ok / n : 1;
}

function storeCap(s: SettlementState, g: string): number {
  return Math.max(ECON.storeFloor, (s.cons[g] ?? 0) * ECON.storeDays);
}

/** Mean Blight along a road and whether it is closed to caravans by it. */
export function roadBlight(ctx: Ctx, ri: number): { mean: number; hot: number; blocked: boolean } {
  const tiles = ctx.S.roadTiles[ri];
  if (!tiles || tiles.length === 0) return { mean: 0, hot: 0, blocked: false };
  const B = ctx.st.blight;
  let sum = 0;
  let hot = 0;
  for (let k = 0; k < tiles.length; k++) {
    const v = B[tiles[k]];
    sum += v;
    if (v >= ECON.roadBlockHot) hot++;
  }
  const mean = sum / tiles.length;
  const hotFrac = hot / tiles.length;
  return { mean, hot: hotFrac, blocked: mean > ECON.roadBlockMean || hotFrac > ECON.roadBlockHotFrac };
}

/** Daily economy. Returns the number of open roads per settlement (for prosperity). */
export function economyDaily(ctx: Ctx): number[] {
  const st = ctx.st;
  const ext = st.ext;
  const now = st.clock.totalHours;
  const open = st.settlements.map(() => 0);

  // Production and consumption.
  for (const s of st.settlements) {
    if (s.status === 'fallen') {
      for (const g of GOODS) s.stock[g] = Math.round((s.stock[g] ?? 0) * 0.85 * 10) / 10;
      continue;
    }
    for (const g of GOODS) {
      const v = (s.stock[g] ?? 0) + (s.prod[g] ?? 0) - (s.cons[g] ?? 0);
      s.stock[g] = Math.round(clamp(v, 0, storeCap(s, g)) * 10) / 10;
    }
  }

  // Caravans.
  ctx.world.roads.forEach(([a, b], ri) => {
    const A = st.settlements[a];
    const B = st.settlements[b];
    const rb = roadBlight(ctx, ri);
    const wasBlocked = ext.roadBlocked[ri] === 1;
    if (rb.blocked !== wasBlocked) {
      ext.roadBlocked[ri] = rb.blocked ? 1 : 0;
      const an = settlementName(ctx, a);
      const bn = settlementName(ctx, b);
      if (A.status !== 'fallen' && B.status !== 'fallen') {
        if (rb.blocked) chron(ctx, 'economy', `The road between ${an} and ${bn} is choked by the Blight; caravans have stopped.`, 2, { key: `road:${ri}`, cooldown: 24 * 6 });
        else chron(ctx, 'economy', `Caravans move again between ${an} and ${bn}.`, 1, { key: `road:${ri}`, cooldown: 24 * 6 });
      }
    }
    if (rb.blocked || A.status === 'fallen' || B.status === 'fallen' || besieged(ctx, A) || besieged(ctx, B)) return;
    open[a]++;
    open[b]++;
    let cap = ECON.caravanCap;
    if (A.controller === 'jade' || B.controller === 'jade') cap *= 1.25;
    if (ext.caravanUntil > now) cap *= ECON.jadeCaravanMult;
    let moved = 0;
    let best = { amt: 0, good: '', from: a, to: b };
    for (const g of GOODS) {
      const ab = transfer(A, B, g, cap);
      const ba = transfer(B, A, g, cap);
      moved += ab + ba;
      if (ab > best.amt) best = { amt: ab, good: g, from: a, to: b };
      if (ba > best.amt) best = { amt: ba, good: g, from: b, to: a };
    }
    if (moved > 0) ext.stats.caravanUnits = Math.round(((ext.stats.caravanUnits ?? 0) + moved) * 10) / 10;
    if (best.amt >= ECON.caravanNoteUnits) {
      const item = ITEMS[best.good]?.name.toLowerCase() ?? best.good;
      chron(ctx, 'economy', `A caravan hauls ${Math.round(best.amt)} units of ${item} from ${settlementName(ctx, best.from)} to ${settlementName(ctx, best.to)}.`, 1, { sid: best.to, key: `cv:${ri}`, cooldown: 24 * 5 });
    }
  });

  // Famine.
  for (const s of st.settlements) {
    if (s.status === 'fallen') continue;
    const fd = foodDays(s);
    const name = settlementName(ctx, s.id);
    if (!hasFlag(s, 'famine') && fd < ECON.famineEnter) {
      setFlag(s, 'famine', true);
      ext.stats.famines = (ext.stats.famines ?? 0) + 1;
      chron(ctx, 'economy', `Famine grips ${name}.`, 2, { sid: s.id, key: `famine:${s.id}`, cooldown: 24 * 5 });
      markBoard(ctx, s.id);
      for (const [nb] of ctx.S.adj[s.id]) markBoard(ctx, nb);
    } else if (hasFlag(s, 'famine') && fd > ECON.famineLeave) {
      setFlag(s, 'famine', false);
      chron(ctx, 'economy', `The famine in ${name} has eased.`, 1, { sid: s.id, key: `famine-end:${s.id}`, cooldown: 24 * 5 });
    }
  }
  return open;
}

function transfer(from: SettlementState, to: SettlementState, g: string, cap: number): number {
  const cf = Math.max(from.cons[g] ?? 0, 0.3);
  const ct = Math.max(to.cons[g] ?? 0, 0.3);
  const sf = from.stock[g] ?? 0;
  const stt = to.stock[g] ?? 0;
  if (sf / cf <= ECON.caravanSurplusDays || stt / ct >= ECON.caravanNeedDays) return 0;
  const amount = Math.min(sf - ECON.caravanSurplusDays * cf, (ECON.caravanNeedDays - stt / ct) * ct, cap);
  if (amount < 0.5) return 0;
  const a = Math.round(amount * 10) / 10;
  from.stock[g] = Math.round((sf - a) * 10) / 10;
  to.stock[g] = Math.round((stt + a) * 10) / 10;
  return a;
}

const MEDICINE = new Set(['pill_heal_s', 'pill_heal_m', 'pill_heal_l', 'pill_qi_s', 'pill_qi_m', 'antidote']);

export function priceMultImpl(ctx: Ctx, sid: number, itemId: string): number {
  const s = ctx.st.settlements[sid];
  if (!s || s.status === 'fallen') return 1;
  let m: number;
  if ((GOODS as readonly string[]).includes(itemId)) {
    const c = Math.max(s.cons[itemId] ?? 0, 0.5);
    const target = ECON.priceTargetDays * c;
    m = clamp(Math.sqrt(target / ((s.stock[itemId] ?? 0) + 1)), ECON.priceMin, ECON.priceMax);
    if (itemId === 'pill_heal_s' && hasFlag(s, 'plague')) m *= 1.2;
  } else {
    m = 1 + (50 - s.prosperity) / 400;
    const def = ITEMS[itemId];
    const atWar = !!s.controller && (ctx.st.factions.find((f) => f.id === s.controller)?.atWarWith.length ?? 0) > 0;
    if (def && (def.kind === 'weapon' || def.kind === 'outfit' || def.kind === 'accessory')) {
      if (besieged(ctx, s)) m *= 1.25;
      if (atWar) m *= 1.12;
      if (s.controller === 'tiger') m *= 0.95;
    }
    if (MEDICINE.has(itemId)) {
      if (hasFlag(s, 'plague')) m *= 1.35;
      if (besieged(ctx, s)) m *= 1.1;
      if (s.controller === 'azure') m *= 0.95;
    }
    if (itemId === 'cooked_meat' && hasFlag(s, 'famine')) m *= 1.4;
    if (s.controller === 'jade') m *= 0.97;
  }
  return Math.round(clamp(m, 0.5, 3) * 100) / 100;
}

export function recordTradeImpl(ctx: Ctx, sid: number, itemId: string, qty: number, dir: 'buy' | 'sell'): void {
  const s = ctx.st.settlements[sid];
  if (!s || !(GOODS as readonly string[]).includes(itemId) || !(qty > 0)) return;
  const q = Math.min(999, Math.floor(qty));
  const cur = s.stock[itemId] ?? 0;
  s.stock[itemId] = Math.round((dir === 'sell' ? cur + q : Math.max(0, cur - q)) * 10) / 10;
}
