/**
 * Settlements: defense, status (with hysteresis), sieges, falls and retakes, daily flags,
 * prosperity and population.
 */
import { FACTIONS, FACTION_BY_ID, type SettlementState, type SettlementStatus } from '@murim/shared';
import { SETTLE } from './constants';
import { heartActive, settlementBlight } from './blight';
import { chron } from './chronicle';
import { dayOf, seasonOf, SEASON_NAMES } from './clock';
import { computeProdCons, foodDays, goodsCoverage, initStock } from './economy';
import { factionName, ownedCount, refreshCapitals, resolveRaid } from './factions';
import { onBoardSiegeEnd, onBoardSiegeStart, onBoardFallen, markBoard } from './missions';
import { onNpcSettlementFallen, onNpcSettlementRetaken } from './npcs';
import type { Ctx } from './types';
import { besieged, clamp, emit, hasFlag, setFlag, settlementName } from './util';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/** Initial controller per settlement from each faction's `homeKind`. Start village stays independent. */
export function initialControllers(ctx: Ctx): (string | null)[] {
  const { S } = ctx;
  const defs = S.defs;
  const start = defs[S.startId];
  const owner: (string | null)[] = defs.map(() => null);
  const taken = new Set<number>([S.startId]);
  if (S.ruinId >= 0) taken.add(S.ruinId);
  const dStart = (id: number) => Math.hypot(defs[id].x - start.x, defs[id].y - start.y);
  for (const f of FACTIONS) {
    const kinds = f.homeKind === 'village' || f.homeKind === 'hamlet' ? ['village', 'hamlet'] : [f.homeKind];
    let cands = defs.filter((d) => kinds.includes(d.kind) && !taken.has(d.id)).map((d) => d.id);
    if (cands.length === 0) cands = defs.filter((d) => !taken.has(d.id)).map((d) => d.id);
    if (cands.length === 0) continue;
    // Outlaws hide far from the starting village; everyone else holds the nearest home of their kind.
    const far = f.ideology === 'outlaw';
    cands.sort((a, b) => (far ? dStart(b) - dStart(a) : dStart(a) - dStart(b)) || a - b);
    owner[cands[0]] = f.id;
    taken.add(cands[0]);
  }
  return owner;
}

export function initSettlements(ctx: Ctx, owners: (string | null)[]): SettlementState[] {
  const { S, rng } = ctx;
  return S.defs.map((d) => {
    const ruin = d.id === S.ruinId;
    const s: SettlementState = {
      id: d.id,
      controller: ruin ? null : owners[d.id],
      status: ruin ? 'fallen' : 'stable',
      prosperity: ruin ? 0 : d.id === S.startId ? 62 : rng.int(50, 64),
      defense: 0,
      population: ruin ? 0 : Math.round(d.population * rng.float(0.92, 1.08)),
      blight: 0,
      siegeUntil: 0,
      siegeStrength: 0,
      siegeBy: null,
      stock: {},
      prod: {},
      cons: {},
      flags: [],
      changedAt: 0,
    };
    return s;
  });
}

/** Second init pass (needs factions + blight in place). */
export function finishSettlementInit(ctx: Ctx): void {
  for (const s of ctx.st.settlements) {
    s.blight = settlementBlight(ctx, s.id);
    if (s.status === 'fallen') {
      ctx.st.ext.fallenAt[s.id] = 0;
      continue;
    }
    computeProdCons(ctx, s);
    initStock(ctx, s);
    s.defense = defenseTarget(ctx, s);
  }
}

// ---------------------------------------------------------------------------
// Defense and status
// ---------------------------------------------------------------------------

export function defenseTarget(ctx: Ctx, s: SettlementState): number {
  if (s.status === 'fallen') return 0;
  const def = ctx.S.defs[s.id];
  let v = SETTLE.baseDefense[def.kind] ?? 30;
  if (s.controller) {
    const f = ctx.st.factions.find((x) => x.id === s.controller);
    if (f) {
      v += Math.min(SETTLE.factionDefCap, (f.power * SETTLE.factionDefMult) / Math.sqrt(Math.max(1, ownedCount(ctx, f.id))));
      if (f.capital === s.id) v += SETTLE.capitalBonus;
      v += SETTLE.ideologyDef[FACTION_BY_ID[f.id]?.ideology ?? 'neutral'] ?? 0;
    }
  }
  v += (s.prosperity - 50) * 0.1;
  v -= s.blight * SETTLE.blightDefPenalty;
  if (hasFlag(s, 'famine')) v -= 6;
  if (hasFlag(s, 'plague')) v -= 4;
  if (besieged(ctx, s)) v -= 5;
  return clamp(v, 0, 100);
}

const LEVEL: Record<SettlementStatus, number> = { fallen: 0, besieged: 2, struggling: 1, stable: 2, thriving: 3 };

function statusScore(s: SettlementState): number {
  return s.prosperity - s.blight * 0.2 - (hasFlag(s, 'famine') ? 8 : 0) - (hasFlag(s, 'plague') ? 6 : 0);
}

/** One hysteresis step from the current (non-siege) status. */
export function classify(s: SettlementState, from: SettlementStatus): SettlementStatus {
  const score = statusScore(s);
  const lvl = LEVEL[from];
  if (lvl >= 3) return score < SETTLE.thriveDown ? 'stable' : 'thriving';
  if (lvl === 2) {
    if (score >= SETTLE.thriveUp) return 'thriving';
    if (score < SETTLE.struggleDown) return 'struggling';
    return 'stable';
  }
  return score >= SETTLE.struggleUp ? 'stable' : 'struggling';
}

export function setStatus(ctx: Ctx, s: SettlementState, status: SettlementStatus): void {
  if (s.status === status) return;
  const before = s.status;
  s.status = status;
  s.changedAt = ctx.st.clock.totalHours;
  emit(ctx, { k: 'settle', id: s.id });
  const name = settlementName(ctx, s.id);
  if (before === 'besieged' || before === 'fallen' || status === 'besieged' || status === 'fallen') return;
  if (status === 'struggling') chron(ctx, 'settlement', `Hard times have come to ${name}.`, 1, { sid: s.id, key: `st:${s.id}`, cooldown: 24 * 6 });
  else if (status === 'thriving') chron(ctx, 'settlement', `${name} prospers; its markets overflow.`, 1, { sid: s.id, key: `st:${s.id}`, cooldown: 24 * 6 });
}

// ---------------------------------------------------------------------------
// Sieges
// ---------------------------------------------------------------------------

export function startSiege(ctx: Ctx, s: SettlementState, by: string, strength: number, hours: number): void {
  const now = ctx.st.clock.totalHours;
  s.siegeUntil = now + Math.max(1, Math.round(hours));
  s.siegeStrength = Math.round(strength * 10) / 10;
  s.siegeBy = by;
  ctx.st.ext.siegeKills[s.id] = 0;
  ctx.st.ext.stats.sieges = (ctx.st.ext.stats.sieges ?? 0) + 1;
  if (by === 'blight') ctx.st.ext.stats.blightSieges = (ctx.st.ext.stats.blightSieges ?? 0) + 1;
  setStatus(ctx, s, 'besieged');
  emit(ctx, { k: 'siege', settlementId: s.id, start: true });
  const name = settlementName(ctx, s.id);
  const capital = ctx.st.factions.some((f) => f.capital === s.id);
  if (by === 'blight') {
    const lines = [`Hollows pour out of the Blight and besiege ${name}!`, `A tide of Hollows has surrounded ${name}.`, `The dead walk on ${name}; its gates are shut against the Hollows.`];
    chron(ctx, 'blight', ctx.rng.pick(lines), capital ? 3 : 2, { sid: s.id, force: true });
  } else {
    const att = factionName(by);
    const def = s.controller ? ` held by the ${factionName(s.controller)}` : '';
    chron(ctx, 'faction', `The ${att} lay siege to ${name}${def}.`, capital ? 3 : 2, { sid: s.id, force: true });
  }
  onBoardSiegeStart(ctx, s.id);
}

function blightSiegeStrength(ctx: Ctx, s: SettlementState): number {
  const def = ctx.S.defs[s.id];
  const now = ctx.st.clock.totalHours;
  let hearts = 0;
  for (const h of ctx.st.hearts) {
    if (!heartActive(h, now)) continue;
    const d = Math.hypot(h.x - def.x, h.y - def.y);
    if (d < 55) hearts += (6 * h.strength) / 100;
  }
  return 8 + s.blight * 0.55 + hearts + ctx.rng.float(0, 8);
}

function endSiege(ctx: Ctx, s: SettlementState): void {
  const by = s.siegeBy ?? 'blight';
  const def = ctx.S.defs[s.id];
  const walls = def.kind === 'fort' || def.kind === 'sectHall' ? 6 : 0;
  const roll = s.defense * ctx.rng.float(0.82, 1.18) + walls;
  const held = roll >= s.siegeStrength;
  const name = settlementName(ctx, s.id);
  s.siegeUntil = 0;
  s.siegeStrength = 0;
  s.siegeBy = null;
  delete ctx.st.ext.siegeKills[s.id];
  ctx.st.ext.siegeCooldown[s.id] = ctx.st.clock.totalHours + SETTLE.siegeCooldownDays * 24;
  emit(ctx, { k: 'siege', settlementId: s.id, start: false });
  onBoardSiegeEnd(ctx, s.id);
  if (by === 'blight') {
    if (held) {
      s.prosperity = clamp(s.prosperity - 8, 0, 100);
      s.population = Math.round(s.population * 0.98);
      s.defense = clamp(s.defense - 4, 0, 100);
      setStatus(ctx, s, classify(s, 'stable'));
      chron(ctx, 'settlement', `${name} has withstood the Hollow siege.`, 2, { sid: s.id, force: true });
    } else {
      fallSettlement(ctx, s);
    }
  } else {
    setStatus(ctx, s, classify(s, 'stable'));
    resolveRaid(ctx, s, by, !held);
  }
  emit(ctx, { k: 'settle', id: s.id });
}

export function fallSettlement(ctx: Ctx, s: SettlementState): void {
  const name = settlementName(ctx, s.id);
  const prev = s.controller;
  const wasCapital = ctx.st.factions.some((f) => f.capital === s.id);
  s.controller = null;
  s.population = Math.round(s.population * SETTLE.fallenPop);
  s.prosperity = 3;
  s.defense = 0;
  s.flags = [];
  s.siegeUntil = 0;
  s.siegeStrength = 0;
  s.siegeBy = null;
  for (const k of Object.keys(ctx.st.ext.flagUntil)) if (k.startsWith(`${s.id}:`)) delete ctx.st.ext.flagUntil[k];
  ctx.st.ext.fallenAt[s.id] = ctx.st.clock.totalHours;
  ctx.st.ext.lastFallHour = ctx.st.clock.totalHours;
  ctx.st.ext.lowDays[s.id] = 0;
  ctx.st.ext.stats.falls = (ctx.st.ext.stats.falls ?? 0) + 1;
  setStatus(ctx, s, 'fallen');
  computeProdCons(ctx, s);
  const tail = prev ? (wasCapital ? ` The ${factionName(prev)} has lost its seat of power.` : ` The ${factionName(prev)} could not hold it.`) : '';
  chron(ctx, 'blight', `${name} has fallen to the Blight!${tail}`, 3, { sid: s.id, force: true });
  if (prev) {
    const f = ctx.st.factions.find((x) => x.id === prev);
    if (f) f.power = Math.max(5, f.power - 6);
  }
  refreshCapitals(ctx);
  onNpcSettlementFallen(ctx, s.id);
  onBoardFallen(ctx, s.id);
}

/** A fallen settlement is reoccupied, by a faction or by returning survivors (controller null). */
export function retakeSettlement(ctx: Ctx, s: SettlementState, controller: string | null): void {
  const def = ctx.S.defs[s.id];
  const name = settlementName(ctx, s.id);
  s.controller = controller;
  s.population = Math.max(s.population, Math.round(def.population * (controller ? 0.28 : 0.2)));
  s.prosperity = controller ? 28 : 24;
  s.flags = [];
  delete ctx.st.ext.fallenAt[s.id];
  delete ctx.st.ext.lowDays[s.id];
  ctx.st.ext.siegeCooldown[s.id] = ctx.st.clock.totalHours + 8 * 24;
  ctx.st.ext.stats.retakes = (ctx.st.ext.stats.retakes ?? 0) + 1;
  s.status = 'struggling';
  s.changedAt = ctx.st.clock.totalHours;
  computeProdCons(ctx, s);
  for (const g of Object.keys(s.cons)) s.stock[g] = Math.round(s.cons[g] * 6 * 10) / 10;
  s.defense = defenseTarget(ctx, s) * 0.8;
  emit(ctx, { k: 'settle', id: s.id });
  if (controller) chron(ctx, 'faction', `The ${factionName(controller)} has retaken ${name} from the Blight.`, 3, { sid: s.id, force: true });
  else chron(ctx, 'settlement', `Survivors return to the ruins of ${name} and rekindle its hearths.`, 2, { sid: s.id, force: true });
  refreshCapitals(ctx);
  onNpcSettlementRetaken(ctx, s.id);
  markBoard(ctx, s.id);
}

// ---------------------------------------------------------------------------
// Hourly / daily
// ---------------------------------------------------------------------------

export function settlementsHourly(ctx: Ctx): void {
  const now = ctx.st.clock.totalHours;
  for (const s of ctx.st.settlements) {
    s.blight = settlementBlight(ctx, s.id);
    if (s.status === 'fallen') continue;
    s.defense = clamp(s.defense + (defenseTarget(ctx, s) - s.defense) * SETTLE.defenseRelax, 0, 100);
    // Defenders (and players) who have worn the attackers down to nothing end the siege at once: a certain hold.
    if (s.siegeUntil > now && s.siegeBy !== null && s.siegeStrength <= 0) s.siegeUntil = now;
    if (s.siegeUntil > 0 && now >= s.siegeUntil) {
      endSiege(ctx, s);
      continue;
    }
    if (s.siegeUntil > 0) continue;
    // Blight sieges (never at the starting village during its first season of grace).
    if (s.id === ctx.S.startId && now < SETTLE.startGraceDays * 24) continue;
    if ((ctx.st.ext.siegeCooldown[s.id] ?? 0) > now) continue;
    const pDay = clamp((s.blight - SETTLE.siegeBlight) / SETTLE.siegeBlightSpan, 0, SETTLE.siegeDailyCap);
    if (pDay > 0 && ctx.rng.chance(pDay / 24)) {
      startSiege(ctx, s, 'blight', blightSiegeStrength(ctx, s), ctx.rng.int(SETTLE.siegeHours[0], SETTLE.siegeHours[1]));
    }
  }
}

function frontier(ctx: Ctx, s: SettlementState): void {
  const ext = ctx.st.ext;
  const lvl = ext.frontier[s.id] ?? 0;
  const b = s.blight;
  let next = lvl;
  if (lvl === 0 && b >= 22) next = b >= 50 ? 2 : 1;
  else if (lvl === 1) next = b >= 50 ? 2 : b < 10 ? 0 : 1;
  else if (lvl === 2) next = b < 10 ? 0 : b < 36 ? 1 : 2;
  if (next === lvl) return;
  ext.frontier[s.id] = next;
  if (s.status === 'fallen' || s.id === ctx.S.ruinId) return;
  const name = settlementName(ctx, s.id);
  if (next > lvl) {
    if (next === 1) chron(ctx, 'blight', `The Blight has reached the outskirts of ${name}.`, 2, { sid: s.id, key: `fr1:${s.id}`, cooldown: 24 * 8 });
    else chron(ctx, 'blight', `The Blight presses against the walls of ${name}.`, 2, { sid: s.id, key: `fr2:${s.id}`, cooldown: 24 * 8 });
  } else if (next === 0) {
    chron(ctx, 'blight', `The Blight recedes from ${name}.`, 1, { sid: s.id, key: `fr0:${s.id}`, cooldown: 24 * 8 });
  }
}

function timedFlag(ctx: Ctx, s: SettlementState, flag: string): boolean {
  const until = ctx.st.ext.flagUntil[`${s.id}:${flag}`];
  return until !== undefined && until > ctx.st.clock.totalHours;
}

function startTimedFlag(ctx: Ctx, s: SettlementState, flag: string, days: number): void {
  ctx.st.ext.flagUntil[`${s.id}:${flag}`] = ctx.st.clock.totalHours + days * 24;
  setFlag(s, flag, true);
}

function dailyFlags(ctx: Ctx, s: SettlementState, day: number): void {
  const name = settlementName(ctx, s.id);
  const rng = ctx.rng;
  // Expire timed flags.
  for (const flag of ['plague', 'festival']) {
    if (hasFlag(s, flag) && !timedFlag(ctx, s, flag)) {
      setFlag(s, flag, false);
      delete ctx.st.ext.flagUntil[`${s.id}:${flag}`];
      if (flag === 'plague') chron(ctx, 'settlement', `The plague in ${name} has run its course.`, 1, { sid: s.id });
    }
  }
  // Plague.
  if (!hasFlag(s, 'plague')) {
    const p = 0.0015 + (s.blight / 255) * 0.035 + (hasFlag(s, 'famine') ? 0.015 : 0) + (s.population > 500 ? 0.002 : 0);
    if (rng.chance(p)) {
      startTimedFlag(ctx, s, 'plague', rng.int(5, 12));
      ctx.st.ext.stats.plagues = (ctx.st.ext.stats.plagues ?? 0) + 1;
      chron(ctx, 'settlement', rng.pick([`Plague breaks out in ${name}.`, `A wasting fever spreads through ${name}.`]), 2, { sid: s.id });
    }
  }
  // Festivals at the turn of a season, or on a whim when times are good.
  if (!hasFlag(s, 'festival') && !besieged(ctx, s) && !hasFlag(s, 'famine') && !hasFlag(s, 'plague')) {
    const seasonStart = day % 30 === 0;
    const p = seasonStart ? (s.status === 'thriving' ? 0.8 : s.status === 'stable' ? 0.45 : 0.1) : s.prosperity > 66 ? 0.012 : 0;
    if (p > 0 && rng.chance(p)) {
      startTimedFlag(ctx, s, 'festival', rng.int(1, 3));
      const season = SEASON_NAMES[seasonOf(day)];
      chron(ctx, 'settlement', seasonStart ? `${name} celebrates the ${season} Festival.` : `Lanterns and drums: ${name} holds a festival.`, 1, { sid: s.id, key: `fest:${s.id}`, cooldown: 24 * 10 });
    }
  }
  // Boom.
  const boom = hasFlag(s, 'boom');
  if (!boom && s.prosperity > 80 && !hasFlag(s, 'famine')) {
    setFlag(s, 'boom', true);
    chron(ctx, 'economy', `Trade booms in ${name}.`, 1, { sid: s.id, key: `boom:${s.id}`, cooldown: 24 * 10 });
  } else if (boom && (s.prosperity < 70 || hasFlag(s, 'famine'))) setFlag(s, 'boom', false);
}

function dailyProsperity(ctx: Ctx, s: SettlementState, openRoads: number): void {
  const food = foodDays(s);
  let target = 50 + clamp((food - 6) * 2.5, -20, 14) + goodsCoverage(s) * 10 - s.blight * 0.15;
  if (hasFlag(s, 'famine')) target -= 12;
  if (hasFlag(s, 'plague')) target -= 10;
  if (hasFlag(s, 'festival')) target += 4;
  if (s.controller === 'jade') target += 5;
  target += Math.min(6, openRoads * 1.5);
  if (besieged(ctx, s)) target -= 15;
  if (s.controller && ctx.st.factions.find((f) => f.id === s.controller)?.atWarWith.length) target -= 4;
  s.prosperity = clamp(s.prosperity + (target - s.prosperity) * 0.12 + ctx.rng.float(-1.5, 1.5), 0, 100);
}

function dailyPopulation(ctx: Ctx, s: SettlementState): void {
  const def = ctx.S.defs[s.id];
  const cap = def.population * (0.8 + (s.prosperity / 100) * 0.7);
  let g = s.population > cap ? -0.003 : 0.0012 * ((s.prosperity - 40) / 60);
  if (hasFlag(s, 'famine')) g -= 0.006;
  if (hasFlag(s, 'plague')) g -= 0.004;
  if (besieged(ctx, s)) g -= 0.002;
  s.population = clamp(Math.round(s.population * (1 + g) * 100) / 100, 5, def.population * 1.6);
}

/** Fallen settlements: refugees leave; low Blight lets survivors or a faction return. */
function dailyFallen(ctx: Ctx, s: SettlementState): void {
  s.population = Math.max(0, Math.round(s.population * 0.92 * 100) / 100);
  if (s.id === ctx.S.ruinId) return;
  const ext = ctx.st.ext;
  if (s.blight < SETTLE.returnBlight) ext.lowDays[s.id] = (ext.lowDays[s.id] ?? 0) + 1;
  else if (s.blight > SETTLE.retakeBlight) ext.lowDays[s.id] = 0;
  const fallenDays = (ctx.st.clock.totalHours - (ext.fallenAt[s.id] ?? 0)) / 24;
  if (fallenDays < 5) return;
  if (s.blight < SETTLE.retakeBlight) {
    const def = ctx.S.defs[s.id];
    let best: { id: string; score: number } | null = null;
    for (const f of ctx.st.factions) {
      if (f.power < 32) continue;
      let near = Infinity;
      for (const o of ctx.st.settlements) {
        if (o.controller !== f.id) continue;
        const od = ctx.S.defs[o.id];
        near = Math.min(near, Math.hypot(od.x - def.x, od.y - def.y));
      }
      const exiled = !Number.isFinite(near);
      const score = f.power - (exiled ? 10 : near * 0.28) + (exiled ? 25 : 0);
      if (!best || score > best.score) best = { id: f.id, score };
    }
    if (best && best.score > 15 && ctx.rng.chance(0.2)) {
      const f = ctx.st.factions.find((x) => x.id === best!.id)!;
      f.power = Math.max(5, f.power - 8);
      retakeSettlement(ctx, s, f.id);
      return;
    }
  }
  if ((ext.lowDays[s.id] ?? 0) >= SETTLE.returnDays) retakeSettlement(ctx, s, null);
}

export function settlementsDaily(ctx: Ctx, openRoads: number[]): void {
  const day = dayOf(ctx.st.clock.totalHours);
  for (const s of ctx.st.settlements) {
    if (s.status === 'fallen') {
      dailyFallen(ctx, s);
      frontier(ctx, s);
      emit(ctx, { k: 'settle', id: s.id });
      continue;
    }
    dailyFlags(ctx, s, day);
    dailyProsperity(ctx, s, openRoads[s.id] ?? 0);
    dailyPopulation(ctx, s);
    computeProdCons(ctx, s);
    if (!besieged(ctx, s)) setStatus(ctx, s, classify(s, s.status === 'besieged' ? 'stable' : s.status));
    frontier(ctx, s);
    emit(ctx, { k: 'settle', id: s.id });
  }
}

/** Siege strength drop from a kill near a besieged settlement. */
export function siegeKill(ctx: Ctx, x: number, y: number, family: string, level: number, elite: number): void {
  for (const s of ctx.st.settlements) {
    if (!besieged(ctx, s)) continue;
    const d = ctx.S.defs[s.id];
    if (Math.hypot(d.x - x, d.y - y) > d.radius + 18) continue;
    const want = s.siegeBy === 'blight' ? 'blight' : 'bandit';
    if (family !== want) continue;
    s.siegeStrength = Math.max(0, s.siegeStrength - (SETTLE.siegeKillBase + level / 40 + elite * 1.5));
    ctx.st.ext.siegeKills[s.id] = (ctx.st.ext.siegeKills[s.id] ?? 0) + 1;
  }
}
