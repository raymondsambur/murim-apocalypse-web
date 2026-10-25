/**
 * Factions: five NPC powers with power / wealth / influence, pairwise relations, wars and
 * alliances, and a daily AI that picks one weighted "major action" every 1-3 days:
 * develop, recruit, fight the Blight, raid, seek goodwill, trade (Jade), or annex a free town.
 * Raids are sieges (`startSiege` with the faction id as attacker) resolved by `resolveRaid`.
 */
import { FACTIONS, FACTION_BY_ID, initialRelation, type FactionBrief, type FactionState, type SettlementState } from '@murim/shared';
import { FACT } from './constants';
import { damageHeartImpl, emitBlight, heartActive, nearestSettlementName, purifyArea, settlementBlight } from './blight';
import { chron } from './chronicle';
import { markBoard } from './missions';
import { onNpcControllerChanged } from './npcs';
import { classify, setStatus, startSiege } from './settlements';
import type { Ctx } from './types';
import { besieged, clamp, emit, pairKey, round1, settlementName } from './util';

export function factionName(id: string): string {
  return FACTION_BY_ID[id]?.name ?? id;
}

export function getFaction(ctx: Ctx, id: string | null | undefined): FactionState | undefined {
  if (!id) return undefined;
  return ctx.st.factions.find((f) => f.id === id);
}

export function ownedIds(ctx: Ctx, id: string): number[] {
  const out: number[] = [];
  for (const s of ctx.st.settlements) if (s.controller === id && s.status !== 'fallen') out.push(s.id);
  return out;
}

export function ownedCount(ctx: Ctx, id: string): number {
  let n = 0;
  for (const s of ctx.st.settlements) if (s.controller === id && s.status !== 'fallen') n++;
  return n;
}

/** Faction settlement share among living, claimable settlements (excludes the ruin). */
function livingCount(ctx: Ctx): number {
  let n = 0;
  for (const s of ctx.st.settlements) if (s.status !== 'fallen') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initFactions(ctx: Ctx, owners: (string | null)[]): FactionState[] {
  return FACTIONS.map((f) => {
    const relations: Record<string, number> = {};
    for (const o of FACTIONS) if (o.id !== f.id) relations[o.id] = initialRelation(f.id, o.id);
    const home = owners.findIndex((o) => o === f.id);
    ctx.st.ext.nextAct[f.id] = ctx.rng.int(FACT.actEvery[0], FACT.actEvery[1]) + 12;
    return {
      id: f.id,
      power: f.power,
      wealth: f.wealth,
      influence: Math.round(f.power * 0.45 + f.wealth * 0.25),
      relations,
      atWarWith: [],
      alliedWith: [],
      capital: home,
      goal: 'consolidate',
      lastActionHour: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

function rel(a: FactionState, b: string): number {
  return a.relations[b] ?? 0;
}

function bump(ctx: Ctx, a: string, b: string, delta: number): void {
  const fa = getFaction(ctx, a);
  const fb = getFaction(ctx, b);
  if (!fa || !fb || a === b) return;
  const v = clamp((fa.relations[b] ?? 0) + delta, -100, 100);
  fa.relations[b] = round1(v);
  fb.relations[a] = round1(v);
}

function setWar(ctx: Ctx, a: FactionState, b: FactionState, on: boolean): void {
  const set = (x: FactionState, y: string) => {
    const i = x.atWarWith.indexOf(y);
    if (on && i < 0) x.atWarWith.push(y);
    else if (!on && i >= 0) x.atWarWith.splice(i, 1);
    x.atWarWith.sort();
  };
  set(a, b.id);
  set(b, a.id);
  const key = pairKey(a.id, b.id);
  if (on) ctx.st.ext.warSince[key] = ctx.st.clock.totalHours;
  else delete ctx.st.ext.warSince[key];
}

function setAlly(a: FactionState, b: FactionState, on: boolean): void {
  const set = (x: FactionState, y: string) => {
    const i = x.alliedWith.indexOf(y);
    if (on && i < 0) x.alliedWith.push(y);
    else if (!on && i >= 0) x.alliedWith.splice(i, 1);
    x.alliedWith.sort();
  };
  set(a, b.id);
  set(b, a.id);
}

/** 0..~1.5: how hard the Blight is pressing the living world right now. */
export function blightThreat(ctx: Ctx): number {
  let sum = 0;
  let n = 0;
  let besiegedByBlight = 0;
  for (const s of ctx.st.settlements) {
    if (s.status === 'fallen') continue;
    sum += s.blight;
    n++;
    if (besieged(ctx, s) && s.siegeBy === 'blight') besiegedByBlight++;
  }
  const avg = n ? sum / n : 0;
  const recentFall = ctx.st.clock.totalHours - ctx.st.ext.lastFallHour < 20 * 24 ? 0.3 : 0;
  return clamp(avg / 70 + recentFall + besiegedByBlight * 0.12, 0, 1.5);
}

function updateRelations(ctx: Ctx): void {
  const st = ctx.st;
  const fs = st.factions;
  const threat = blightThreat(ctx);
  const living = Math.max(1, livingCount(ctx));
  // A dominant faction draws suspicion from the rest.
  let leader: FactionState | null = null;
  let leaderShare = 0;
  for (const f of fs) {
    const share = ownedCount(ctx, f.id) / living;
    if (share > leaderShare) {
      leaderShare = share;
      leader = f;
    }
  }
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i];
      const b = fs[j];
      const base = initialRelation(a.id, b.id);
      const cur = rel(a, b.id);
      let d = (base - cur) * FACT.relationDrift;
      if (a.atWarWith.includes(b.id)) d -= 0.35;
      if (a.alliedWith.includes(b.id)) d += 0.18;
      for (const c of fs) {
        if (c.id === a.id || c.id === b.id) continue;
        if (a.atWarWith.includes(c.id) && b.atWarWith.includes(c.id)) d += 0.2;
        if (a.alliedWith.includes(c.id) && b.atWarWith.includes(c.id)) d -= 0.1;
      }
      if (threat > 0.4) d += 0.12 * threat;
      if (leader && leaderShare > 0.34 && (leader.id === a.id || leader.id === b.id)) d -= 0.45 * (leaderShare - 0.28) * 4;
      d += ctx.rng.float(-0.5, 0.5);
      bump(ctx, a.id, b.id, d);
    }
  }
}

/** Random frictions and courtesies keep relations moving even in quiet years. */
function incidents(ctx: Ctx): void {
  if (!ctx.rng.chance(FACT.incidentChance)) return;
  const fs = ctx.st.factions;
  const i = ctx.rng.int(0, fs.length - 1);
  let j = ctx.rng.int(0, fs.length - 2);
  if (j >= i) j++;
  const a = fs[i];
  const b = fs[j];
  if (a.atWarWith.includes(b.id)) return;
  const na = FACTION_BY_ID[a.id].short;
  const nb = FACTION_BY_ID[b.id].short;
  const allied = a.alliedWith.includes(b.id);
  const bad = ctx.rng.chance(allied ? 0.4 : 0.62);
  const key = `inc:${pairKey(a.id, b.id)}`;
  if (bad) {
    bump(ctx, a.id, b.id, -ctx.rng.float(9, 18));
    chron(ctx, 'faction', ctx.rng.pick([`Patrols of the ${na} and the ${nb} clash on a border road.`, `An envoy of the ${na} is insulted at the court of the ${nb}.`, `Toll quarrels sour relations between the ${na} and the ${nb}.`]), 1, { key, cooldown: 24 * 6 });
  } else {
    bump(ctx, a.id, b.id, ctx.rng.float(7, 13));
    chron(ctx, 'faction', ctx.rng.pick([`The ${na} and the ${nb} exchange gifts at a mountain festival.`, `Envoys of the ${na} and the ${nb} share tea and old grievances.`]), 1, { key, cooldown: 24 * 6 });
  }
}

// ---------------------------------------------------------------------------
// Daily economy and power
// ---------------------------------------------------------------------------

const POWER_MULT = [0.6, 0.94, 1.04, 1.1, 1.15, 1.18, 1.2, 1.2];

function dailyEconomy(ctx: Ctx, f: FactionState): void {
  const def = FACTION_BY_ID[f.id];
  const owned = ownedIds(ctx, f.id);
  const now = ctx.st.clock.totalHours;
  let income = 0;
  for (const sid of owned) {
    const s = ctx.st.settlements[sid];
    const fam = s.flags.includes('famine') ? 0.5 : 1;
    income += FACT.incomePerSettlement * (0.45 + (s.prosperity / 100) * 0.9) * fam * (besieged(ctx, s) ? 0.4 : 1);
  }
  if (owned.length === 0) income = FACT.exileIncome;
  if (f.id === 'jade') income *= ctx.st.ext.caravanUntil > now ? 1.9 : 1.4;
  let upkeep = f.power * FACT.upkeepPerPower + Math.max(0, owned.length - 1) * FACT.extraSettlementUpkeep;
  if (f.atWarWith.length) upkeep += 0.6 * f.atWarWith.length;
  let wealth = f.wealth + income - upkeep;
  if (wealth > FACT.wealthSoftCap) wealth -= (wealth - FACT.wealthSoftCap) * FACT.wealthLeak;
  f.wealth = round1(clamp(wealth, 0, 250));

  // Power relaxes toward what the faction's holdings can sustain.
  const mult = POWER_MULT[Math.min(owned.length, POWER_MULT.length - 1)];
  let target = def.power * mult;
  if (owned.length === 0) target = Math.max(FACT.exileTarget, def.power * 0.55);
  if (f.wealth < 4) target *= 0.9;
  f.power = round1(clamp(f.power + (target - f.power) * FACT.powerRelax + ctx.rng.float(-0.3, 0.3) - 0.12 * f.atWarWith.length, FACT.powerFloor, 100));

  // Influence follows land, friends and prosperity.
  let prosp = 0;
  for (const sid of owned) prosp += ctx.st.settlements[sid].prosperity;
  const itarget = clamp(12 + owned.length * 11 + f.alliedWith.length * 6 + (owned.length ? prosp / owned.length / 5 : 0) - f.atWarWith.length * 3, 0, 100);
  f.influence = round1(f.influence + (itarget - f.influence) * 0.06);
}

// ---------------------------------------------------------------------------
// Capitals
// ---------------------------------------------------------------------------

const KIND_RANK: Record<string, number> = { sectHall: 4, fort: 4, town: 3, village: 2, hamlet: 1, ruin: 0 };

export function refreshCapitals(ctx: Ctx): void {
  for (const f of ctx.st.factions) {
    const cur = f.capital >= 0 ? ctx.st.settlements[f.capital] : undefined;
    if (cur && cur.controller === f.id && cur.status !== 'fallen') continue;
    const owned = ownedIds(ctx, f.id);
    if (owned.length === 0) {
      f.capital = -1;
      continue;
    }
    const home = FACTION_BY_ID[f.id].homeKind;
    let best = owned[0];
    let bs = -1;
    for (const sid of owned) {
      const d = ctx.S.defs[sid];
      const sc = (d.kind === home ? 6 : 0) + (KIND_RANK[d.kind] ?? 0) + ctx.st.settlements[sid].population / 400;
      if (sc > bs) {
        bs = sc;
        best = sid;
      }
    }
    const hadOne = f.capital >= 0;
    f.capital = best;
    if (hadOne) chron(ctx, 'faction', `The ${factionName(f.id)} make ${settlementName(ctx, best)} their new seat.`, 2, { sid: best, key: `cap:${f.id}`, cooldown: 24 * 10 });
  }
}

// ---------------------------------------------------------------------------
// Diplomacy: wars, truces, alliances
// ---------------------------------------------------------------------------

function declareWar(ctx: Ctx, a: FactionState, b: FactionState): void {
  setWar(ctx, a, b, true);
  ctx.st.ext.stats.wars = (ctx.st.ext.stats.wars ?? 0) + 1;
  if (a.alliedWith.includes(b.id)) {
    setAlly(a, b, false);
  }
  chron(ctx, 'faction', `The ${factionName(a.id)} has declared war on the ${factionName(b.id)}.`, 3, { force: true });
  // Allies are drawn in when they dislike the other side.
  for (const [side, foe] of [[a, b], [b, a]] as const) {
    for (const aid of side.alliedWith) {
      const ally = getFaction(ctx, aid);
      if (!ally || ally.id === foe.id || ally.atWarWith.includes(foe.id) || ally.atWarWith.length >= 2) continue;
      if (rel(ally, foe.id) < -15 && ctx.rng.chance(0.6)) {
        setWar(ctx, ally, foe, true);
        chron(ctx, 'faction', `The ${factionName(ally.id)} joins the ${factionName(side.id)} against the ${factionName(foe.id)}.`, 2, { force: true });
      }
    }
  }
}

function endWar(ctx: Ctx, a: FactionState, b: FactionState, threat: number): void {
  setWar(ctx, a, b, false);
  const key = pairKey(a.id, b.id);
  ctx.st.ext.truceUntil[key] = ctx.st.clock.totalHours + FACT.truceDays * 24;
  bump(ctx, a.id, b.id, 28);
  if (rel(a, b.id) < -45) bump(ctx, a.id, b.id, -45 - rel(a, b.id));
  ctx.st.ext.stats.truces = (ctx.st.ext.stats.truces ?? 0) + 1;
  const reason = threat > 0.45 ? ' as the Blight closes in on both' : '';
  chron(ctx, 'faction', `The ${factionName(a.id)} and the ${factionName(b.id)} have agreed to a truce${reason}.`, 2, { force: true });
}

function diplomacy(ctx: Ctx): void {
  const st = ctx.st;
  const fs = st.factions;
  const now = st.clock.totalHours;
  const threat = blightThreat(ctx);
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i];
      const b = fs[j];
      const key = pairKey(a.id, b.id);
      const r = rel(a, b.id);
      if (a.atWarWith.includes(b.id)) {
        // The cost of war: attrition on both sides.
        a.wealth = Math.max(0, round1(a.wealth - 0.5));
        b.wealth = Math.max(0, round1(b.wealth - 0.5));
        const days = (now - (st.ext.warSince[key] ?? now)) / 24;
        if (days < FACT.warEndMinDays) continue;
        const exhausted = Math.min(a.wealth, b.wealth) < 6 || Math.min(a.power, b.power) < 24;
        let p = 0.012 + (days > 50 ? 0.03 : 0);
        if (exhausted) p = 0.12;
        if (threat > 0.45) p = Math.max(p, 0.16);
        if (r > -15) p = Math.max(p, 0.1);
        if (ctx.rng.chance(p)) endWar(ctx, a, b, threat);
        continue;
      }
      if (a.alliedWith.includes(b.id)) {
        if (r < FACT.allianceBreak) {
          setAlly(a, b, false);
          chron(ctx, 'faction', `The pact between the ${factionName(a.id)} and the ${factionName(b.id)} has crumbled.`, 2, { key: `pact:${key}`, cooldown: 24 * 8 });
        }
        continue;
      }
      if (r <= FACT.warDeclare && now >= (st.ext.truceUntil[key] ?? 0) && a.power >= 24 && b.power >= 24 && a.atWarWith.length < 2 && b.atWarWith.length < 2 && threat < 0.55) {
        if (ctx.rng.chance(0.06)) declareWar(ctx, a, b);
      } else if (r >= FACT.allianceAt && a.alliedWith.length < 2 && b.alliedWith.length < 2 && canAlly(a, b) && ctx.rng.chance(0.06)) {
        setAlly(a, b, true);
        st.ext.stats.alliances = (st.ext.stats.alliances ?? 0) + 1;
        chron(ctx, 'faction', `The ${factionName(a.id)} and the ${factionName(b.id)} have sworn an alliance.`, 2, { force: true });
      }
    }
  }
}

function canAlly(a: FactionState, b: FactionState): boolean {
  for (const w of a.atWarWith) if (b.alliedWith.includes(w)) return false;
  for (const w of b.atWarWith) if (a.alliedWith.includes(w)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const FIGHT_BLIGHT_W: Record<string, number> = { righteous: 3.2, neutral: 1.6, heterodox: 0.5, outlaw: 0.3 };
const RAID_IDEOLOGY_W: Record<string, number> = { righteous: 0.45, neutral: 0.2, heterodox: 1, outlaw: 2.2 };

interface RaidChoice {
  sid: number;
  w: number;
}

function raidTargets(ctx: Ctx, f: FactionState): RaidChoice[] {
  const def = FACTION_BY_ID[f.id];
  const st = ctx.st;
  const now = st.clock.totalHours;
  const owned = ownedIds(ctx, f.id);
  const out: RaidChoice[] = [];
  // One raid at a time per faction.
  for (const s of st.settlements) if (s.siegeUntil > now && s.siegeBy === f.id) return out;
  const startDay = Math.floor(now / 24);
  for (const s of st.settlements) {
    if (s.status === 'fallen' || s.controller === f.id) continue;
    if (s.id === ctx.S.startId) continue; // the starting village lies under the martial world's truce
    if (besieged(ctx, s) || (st.ext.siegeCooldown[s.id] ?? 0) > now) continue;
    if (s.controller && f.alliedWith.includes(s.controller)) continue;
    const warring = !!s.controller && f.atWarWith.includes(s.controller);
    const r = s.controller ? rel(f, s.controller) : 0;
    let w: number;
    if (warring) w = 5;
    else if (s.controller && r < FACT.raidRelation) w = 2.5 + (-r - 30) / 25;
    else if (!s.controller) w = 1.6 * RAID_IDEOLOGY_W[def.ideology];
    else if (def.ideology === 'outlaw') w = 0.5;
    else continue;
    if (startDay < 8 && !warring) continue; // a short quiet start
    const sd = ctx.S.defs[s.id];
    let dmin = 40;
    if (owned.length) {
      dmin = Infinity;
      for (const o of owned) dmin = Math.min(dmin, Math.hypot(ctx.S.defs[o].x - sd.x, ctx.S.defs[o].y - sd.y));
    }
    w *= Math.exp(-dmin / 160);
    // Everyone gangs up on a faction that grows too large.
    if (s.controller) {
      const share = ownedCount(ctx, s.controller) / Math.max(1, livingCount(ctx));
      if (share > 0.3) w *= 1 + (share - 0.3) * 6;
    }
    // Prefer fights that can be won: a logistic on expected strength vs expected defense.
    const expStrength = f.power * 0.95 + Math.min(14, f.wealth * 0.1) + 2.5 + (owned.length === 0 ? FACT.exileRaidBonus : 0);
    const walls = sd.kind === 'fort' || sd.kind === 'sectHall' ? 6 : 0;
    const pWin = 1 / (1 + Math.exp(-(expStrength - (s.defense + walls)) / 7));
    w *= 0.08 + pWin * 1.6;
    if (w > 0.02) out.push({ sid: s.id, w });
  }
  return out;
}

function startRaid(ctx: Ctx, f: FactionState, sid: number): void {
  const s = ctx.st.settlements[sid];
  const warring = !!s.controller && f.atWarWith.includes(s.controller);
  const exile = ownedCount(ctx, f.id) === 0;
  const strength = f.power * ctx.rng.float(FACT.raidStrength[0], FACT.raidStrength[1]) * (warring ? 1.15 : 1) + Math.min(14, f.wealth * 0.1) + ctx.rng.float(0, 5) + (exile ? FACT.exileRaidBonus : 0);
  f.wealth = round1(Math.max(0, f.wealth - 8));
  f.power = round1(Math.max(FACT.powerFloor, f.power - 1.5));
  ctx.st.ext.stats.raids = (ctx.st.ext.stats.raids ?? 0) + 1;
  if (s.controller) bump(ctx, f.id, s.controller, -8);
  startSiege(ctx, s, f.id, strength, ctx.rng.int(18, 36));
  // Allies of the defender rush to help.
  const def = getFaction(ctx, s.controller);
  if (def) {
    for (const aid of def.alliedWith) {
      const ally = getFaction(ctx, aid);
      if (ally && ally.id !== f.id && ally.power >= 35 && ctx.rng.chance(0.6)) {
        s.siegeStrength = round1(s.siegeStrength * 0.85);
        bump(ctx, def.id, ally.id, 3);
        chron(ctx, 'faction', `The ${factionName(ally.id)} sends warriors to the aid of ${settlementName(ctx, sid)}.`, 1, { sid, key: `aid:${sid}`, cooldown: 24 * 4 });
        break;
      }
    }
  }
}

/** Where a faction can usefully fight the Blight: its own settlements and nearby fallen ones. */
function fightTarget(ctx: Ctx, f: FactionState, owned: number[]): { sid: number; need: number } {
  let sid = -1;
  let need = 0;
  for (const s of ctx.st.settlements) {
    if (s.id === ctx.S.ruinId) continue;
    let n = 0;
    if (s.controller === f.id) n = s.blight;
    else if (s.status === 'fallen' && f.power >= 40) {
      const d = ctx.S.defs[s.id];
      let dmin = owned.length ? Infinity : 0;
      for (const o of owned) dmin = Math.min(dmin, Math.hypot(ctx.S.defs[o].x - d.x, ctx.S.defs[o].y - d.y));
      if (dmin <= 75) n = s.blight * 0.8;
    }
    if (n > need) {
      need = n;
      sid = s.id;
    }
  }
  return { sid, need };
}

/** An active heart close enough to a living owned settlement for an expedition (heart id or -1). */
function expeditionHeart(ctx: Ctx, owned: number[]): number {
  const now = ctx.st.clock.totalHours;
  let best = -1;
  let bd = Infinity;
  for (const h of ctx.st.hearts) {
    if (!heartActive(h, now)) continue;
    for (const o of owned) {
      const d = Math.hypot(ctx.S.defs[o].x - h.x, ctx.S.defs[o].y - h.y);
      if (d <= 50 && d < bd) {
        bd = d;
        best = h.id;
      }
    }
  }
  return best;
}

function expedition(ctx: Ctx, f: FactionState, heartId: number): void {
  const st = ctx.st;
  const h = st.hearts.find((x) => x.id === heartId);
  if (!h) return;
  const label = factionName(f.id);
  f.wealth = round1(Math.max(0, f.wealth - FACT.expeditionWealth));
  f.power = round1(clamp(f.power - 3, FACT.powerFloor, 100));
  const pSeal = clamp(0.2 + (f.power - 50) / 120 + (h.strength < 50 ? 0.12 : 0), 0.12, 0.55);
  st.ext.stats.expeditions = (st.ext.stats.expeditions ?? 0) + 1;
  if (ctx.rng.chance(pSeal)) {
    f.influence = round1(clamp(f.influence + 8, 0, 100));
    damageHeartImpl(ctx, heartId, h.strength + 1, `the ${label}`);
  } else if (ctx.rng.chance(0.5)) {
    damageHeartImpl(ctx, heartId, ctx.rng.float(15, 35), `the ${label}`);
  } else {
    f.power = round1(clamp(f.power - 5, FACT.powerFloor, 100));
    chron(ctx, 'faction', `A ${label} expedition against the Blight heart near ${nearestSettlementName(ctx, h.x, h.y)} was lost to the Hollows.`, 2, { key: `exp-lost:${f.id}`, cooldown: 24 * 4 });
  }
}

function doAction(ctx: Ctx, f: FactionState): void {
  const st = ctx.st;
  const rng = ctx.rng;
  const def = FACTION_BY_ID[f.id];
  const now = st.clock.totalHours;
  const owned = ownedIds(ctx, f.id);
  const exile = owned.length === 0;

  let lowProsp = 101;
  let lowSid = -1;
  for (const sid of owned) {
    const s = st.settlements[sid];
    if (s.prosperity < lowProsp) {
      lowProsp = s.prosperity;
      lowSid = sid;
    }
  }
  const fight = fightTarget(ctx, f, owned);
  const heartId = def.ideology === 'righteous' && f.power >= FACT.expeditionPower && f.wealth >= FACT.expeditionWealth ? expeditionHeart(ctx, owned) : -1;
  const raids = f.power >= FACT.raidMinPower && f.wealth >= 6 ? raidTargets(ctx, f) : [];
  const raidW = raids.length ? Math.min(5, raids.reduce((a, r) => a + r.w, 0)) * (f.atWarWith.length ? 1.6 : 1) : 0;
  const annexable = annexTargets(ctx, f);

  const weights: [string, number][] = [
    ['develop', owned.length && f.wealth >= 6 ? 3 + (lowProsp < 55 ? 2 : 0) : 0],
    ['recruit', f.wealth >= 10 ? 2.4 + (f.power < 45 ? 2.2 : 0) : exile ? 1 : 0],
    ['fight', fight.sid >= 0 && fight.need >= 14 && f.wealth >= 4 ? (FIGHT_BLIGHT_W[def.ideology] ?? 1) * clamp(fight.need / 25, 0.5, 4) : 0],
    ['expedition', heartId >= 0 ? 0.7 : 0],
    ['raid', raidW],
    ['goodwill', 1.2],
    ['trade', f.id === 'jade' ? 3 : 0.3],
    ['annex', annexable.length && f.wealth >= 14 ? 1.1 + f.influence / 60 : 0],
    ['rest', 1],
  ];
  const action = rng.weighted(weights.filter(([, w]) => w > 0).map(([k, w]) => [k, w] as const));
  f.lastActionHour = now;

  switch (action) {
    case 'develop': {
      f.goal = 'consolidate';
      f.wealth = round1(f.wealth - 6);
      const s = st.settlements[lowSid];
      if (!s) break;
      s.prosperity = clamp(s.prosperity + rng.float(3, 6), 0, 100);
      for (const g of ['grain', 'meat']) s.stock[g] = round1((s.stock[g] ?? 0) + (s.cons[g] ?? 0) * 3);
      emit(ctx, { k: 'settle', id: s.id });
      const where = settlementName(ctx, s.id);
      chron(ctx, 'faction', rng.pick([`The ${def.short} fund new granaries in ${where}.`, `The ${def.short} repair the walls and wells of ${where}.`, `Stewards of the ${def.short} bring order to the markets of ${where}.`]), 1, { sid: s.id, key: `dev:${f.id}`, cooldown: 24 * 3 });
      break;
    }
    case 'recruit': {
      f.goal = exile ? 'rebuild strength' : 'recruit disciples';
      f.wealth = round1(Math.max(0, f.wealth - 10));
      f.power = round1(clamp(f.power + rng.float(1.5, 3.5) * clamp((105 - f.power) / 45, 0.2, 1), FACT.powerFloor, 100));
      const line = exile ? `The scattered ${def.short} gather in the hills and swear to return.` : rng.pick([`The ${def.short} open their gates to new disciples.`, `Young hopefuls flock to the banners of the ${def.short}.`]);
      chron(ctx, 'faction', line, 1, { key: `rec:${f.id}`, cooldown: 24 * 4 });
      break;
    }
    case 'fight': {
      f.goal = 'cleanse the Blight';
      f.wealth = round1(Math.max(0, f.wealth - 4));
      const d = ctx.S.defs[fight.sid];
      const changed = purifyArea(ctx, d.x, d.y, d.radius + 7, 22 + f.power * 0.28);
      emitBlight(ctx, changed);
      const s = st.settlements[fight.sid];
      s.blight = settlementBlight(ctx, fight.sid);
      f.influence = round1(clamp(f.influence + 1.5, 0, 100));
      st.ext.stats.cleansings = (st.ext.stats.cleansings ?? 0) + 1;
      if (fight.need >= 20) {
        const where = settlementName(ctx, fight.sid);
        chron(ctx, 'faction', s.status === 'fallen' ? `The ${def.short} send purifiers to the ruins of ${where}.` : `The ${def.short} drive back the Blight near ${where}.`, 1, { sid: fight.sid, key: `purge:${f.id}`, cooldown: 24 * 4 });
      }
      break;
    }
    case 'expedition': {
      f.goal = 'seal the Blight heart';
      expedition(ctx, f, heartId);
      break;
    }
    case 'raid': {
      const pick = rng.weighted(raids.map((r) => [r.sid, r.w] as const));
      f.goal = `conquer ${settlementName(ctx, pick)}`;
      startRaid(ctx, f, pick);
      break;
    }
    case 'goodwill': {
      f.goal = 'seek allies';
      let best: FactionState | null = null;
      let bs = -Infinity;
      for (const o of st.factions) {
        if (o.id === f.id || f.atWarWith.includes(o.id)) continue;
        const r = rel(f, o.id);
        if (r >= 70) continue;
        const sc = r + rng.float(0, 30);
        if (sc > bs) {
          bs = sc;
          best = o;
        }
      }
      if (best) {
        f.wealth = round1(Math.max(0, f.wealth - 3));
        bump(ctx, f.id, best.id, rng.float(5, 11));
        chron(ctx, 'faction', `Envoys of the ${def.short} call on the ${FACTION_BY_ID[best.id].short}.`, 1, { key: `env:${f.id}`, cooldown: 24 * 5 });
      } else if (f.atWarWith.length) {
        // Sue for peace: war weariness.
        const foe = getFaction(ctx, f.atWarWith[0]);
        if (foe) bump(ctx, f.id, foe.id, rng.float(3, 7));
      }
      break;
    }
    case 'trade': {
      f.goal = 'expand trade';
      if (f.id === 'jade') {
        st.ext.caravanUntil = Math.max(st.ext.caravanUntil, now + 96);
        f.wealth = round1(f.wealth + 5);
        for (const sid of owned) st.settlements[sid].prosperity = clamp(st.settlements[sid].prosperity + 1, 0, 100);
        chron(ctx, 'economy', 'The Jade Merchant Guild dispatches great caravans along the roads.', 1, { key: 'jade-caravans', cooldown: 24 * 8 });
      } else {
        f.wealth = round1(f.wealth + 2);
      }
      break;
    }
    case 'annex': {
      const pick = rng.pick(annexable);
      f.goal = `court ${settlementName(ctx, pick)}`;
      f.wealth = round1(Math.max(0, f.wealth - 14));
      annex(ctx, f, pick);
      break;
    }
    default:
      f.goal = exile ? 'recover lost lands' : 'consolidate';
      break;
  }
}

function annexTargets(ctx: Ctx, f: FactionState): number[] {
  if (f.power < 30) return [];
  const out: number[] = [];
  const owned = ownedIds(ctx, f.id);
  for (const s of ctx.st.settlements) {
    if (s.controller || s.status === 'fallen' || s.id === ctx.S.startId || besieged(ctx, s)) continue;
    if ((ctx.st.ext.lockUntil[s.id] ?? 0) > ctx.st.clock.totalHours) continue;
    if (s.status === 'struggling' && s.prosperity < 20) continue;
    const d = ctx.S.defs[s.id];
    let dmin = Infinity;
    for (const o of owned) dmin = Math.min(dmin, Math.hypot(ctx.S.defs[o].x - d.x, ctx.S.defs[o].y - d.y));
    if (owned.length === 0 || dmin <= 80) out.push(s.id);
  }
  return out;
}

function annex(ctx: Ctx, f: FactionState, sid: number): void {
  const s = ctx.st.settlements[sid];
  s.controller = f.id;
  s.prosperity = clamp(s.prosperity + 3, 0, 100);
  ctx.st.ext.lockUntil[sid] = ctx.st.clock.totalHours + FACT.lockDays * 24;
  ctx.st.ext.stats.annexed = (ctx.st.ext.stats.annexed ?? 0) + 1;
  emit(ctx, { k: 'settle', id: sid });
  chron(ctx, 'faction', `${settlementName(ctx, sid)} has accepted the protection of the ${factionName(f.id)}.`, 2, { sid, force: true });
  refreshCapitals(ctx);
  onNpcControllerChanged(ctx, sid, null);
  markBoard(ctx, sid);
}

// ---------------------------------------------------------------------------
// Raid resolution (called when a faction siege ends)
// ---------------------------------------------------------------------------

export function resolveRaid(ctx: Ctx, s: SettlementState, attackerId: string, success: boolean): void {
  const att = getFaction(ctx, attackerId);
  const name = settlementName(ctx, s.id);
  const prev = getFaction(ctx, s.controller);
  const capital = !!prev && prev.capital === s.id;
  if (!att) return;
  if (!success) {
    att.power = round1(clamp(att.power - ctx.rng.float(4, 8), FACT.powerFloor, 100));
    s.prosperity = clamp(s.prosperity - 3, 0, 100);
    if (prev) {
      prev.power = round1(clamp(prev.power + 1, FACT.powerFloor, 100));
      bump(ctx, att.id, prev.id, -4);
    }
    ctx.st.ext.stats.raidsRepelled = (ctx.st.ext.stats.raidsRepelled ?? 0) + 1;
    chron(ctx, 'faction', prev ? `The ${factionName(prev.id)} drove the ${factionName(att.id)} from the gates of ${name}.` : `${name} turned back the ${factionName(att.id)}.`, capital ? 3 : 2, { sid: s.id, force: true });
    emit(ctx, { k: 'settle', id: s.id });
    markBoard(ctx, s.id);
    return;
  }
  const captureP = FACTION_BY_ID[att.id].ideology === 'outlaw' ? 0.5 : 0.78;
  const canHold = att.power >= 30 && ownedCount(ctx, att.id) < FACT.maxHoldings;
  if (canHold && ctx.rng.chance(captureP)) {
    capture(ctx, s, att, prev);
  } else {
    plunder(ctx, s, att, prev);
  }
}

function capture(ctx: Ctx, s: SettlementState, att: FactionState, prev: FactionState | undefined): void {
  const name = settlementName(ctx, s.id);
  const wasCapital = !!prev && prev.capital === s.id;
  const before = s.controller;
  s.controller = att.id;
  s.prosperity = clamp(s.prosperity - 14, 4, 100);
  s.population = Math.round(s.population * 0.9 * 100) / 100;
  s.defense = clamp(s.defense * 0.55, 0, 100);
  s.flags = s.flags.filter((f) => f === 'plague' || f === 'famine');
  for (const g of Object.keys(s.stock)) s.stock[g] = round1(s.stock[g] * 0.7);
  att.power = round1(clamp(att.power + 1.5, FACT.powerFloor, 100));
  att.influence = round1(clamp(att.influence + 4, 0, 100));
  if (prev) {
    prev.power = round1(clamp(prev.power - 5, FACT.powerFloor, 100));
    bump(ctx, att.id, prev.id, -25);
  }
  setStatus(ctx, s, 'struggling');
  s.changedAt = ctx.st.clock.totalHours;
  ctx.st.ext.siegeCooldown[s.id] = ctx.st.clock.totalHours + 10 * 24;
  ctx.st.ext.stats.captures = (ctx.st.ext.stats.captures ?? 0) + 1;
  if (prev) {
    ctx.st.ext.formerOwner[s.id] = prev.id;
    ctx.st.ext.lostAt[s.id] = ctx.st.clock.totalHours;
  }
  const from = prev ? ` from the ${factionName(prev.id)}` : '';
  chron(ctx, 'faction', `The ${factionName(att.id)} seized ${name}${from}.`, wasCapital ? 3 : 2, { sid: s.id, force: true });
  refreshCapitals(ctx);
  onNpcControllerChanged(ctx, s.id, before);
  markBoard(ctx, s.id);
  emit(ctx, { k: 'settle', id: s.id });
}

function plunder(ctx: Ctx, s: SettlementState, att: FactionState, prev: FactionState | undefined): void {
  const name = settlementName(ctx, s.id);
  for (const g of Object.keys(s.stock)) s.stock[g] = round1(s.stock[g] * 0.4);
  s.prosperity = clamp(s.prosperity - 10, 2, 100);
  s.population = Math.round(s.population * 0.95 * 100) / 100;
  s.defense = clamp(s.defense * 0.8, 0, 100);
  att.wealth = round1(clamp(att.wealth + 16, 0, 250));
  att.power = round1(clamp(att.power - 1, FACT.powerFloor, 100));
  if (prev) bump(ctx, att.id, prev.id, -14);
  setStatus(ctx, s, classify(s, 'stable'));
  ctx.st.ext.stats.plunders = (ctx.st.ext.stats.plunders ?? 0) + 1;
  chron(ctx, 'faction', `${factionName(att.id)} raiders plundered ${name} and withdrew.`, 2, { sid: s.id, force: true });
  emit(ctx, { k: 'settle', id: s.id });
  markBoard(ctx, s.id);
}

// ---------------------------------------------------------------------------
// Revolts
// ---------------------------------------------------------------------------

/** The people of a recently conquered settlement may rise and welcome back their old masters. */
function uprisings(ctx: Ctx): void {
  const ext = ctx.st.ext;
  const now = ctx.st.clock.totalHours;
  for (const sid of Object.keys(ext.formerOwner)) {
    const s = ctx.st.settlements[Number(sid)];
    const lost = ext.lostAt[sid] ?? 0;
    const fid = ext.formerOwner[sid];
    if (!s || s.status === 'fallen' || s.controller === fid || now - lost > FACT.uprisingDays * 24) {
      delete ext.formerOwner[sid];
      delete ext.lostAt[sid];
      continue;
    }
    const old = getFaction(ctx, fid);
    if (!old || old.power < 24 || besieged(ctx, s) || s.prosperity > 62) continue;
    if (!ctx.rng.chance(FACT.uprisingChance)) continue;
    const before = s.controller;
    s.controller = fid;
    s.prosperity = clamp(s.prosperity - 3, 0, 100);
    delete ext.formerOwner[sid];
    delete ext.lostAt[sid];
    ext.stats.uprisings = (ext.stats.uprisings ?? 0) + 1;
    if (before) bump(ctx, fid, before, -10);
    old.power = round1(clamp(old.power + 2, FACT.powerFloor, 100));
    const cur = getFaction(ctx, before);
    if (cur) cur.power = round1(clamp(cur.power - 3, FACT.powerFloor, 100));
    chron(ctx, 'faction', `The people of ${settlementName(ctx, s.id)} rise against ${before ? `the ${factionName(before)}` : 'their garrison'} and welcome back the ${factionName(fid)}.`, 2, { sid: s.id, force: true });
    refreshCapitals(ctx);
    onNpcControllerChanged(ctx, s.id, before);
    markBoard(ctx, s.id);
    emit(ctx, { k: 'settle', id: s.id });
  }
}

/** The faction a rebel settlement is most likely to turn to: weak, landless, and not the one it fled. */
function pickHeir(ctx: Ctx, from: string): FactionState | undefined {
  const cand = ctx.st.factions.filter((x) => x.id !== from && x.power >= 22 && !x.alliedWith.includes(from));
  if (cand.length === 0) return undefined;
  return ctx.rng.weighted(cand.map((x) => [x, (ownedCount(ctx, x.id) === 0 ? 4 : 1 / (1 + ownedCount(ctx, x.id))) * (1 + Math.max(0, -rel(x, from)) / 60)] as const));
}

function revolts(ctx: Ctx): void {
  uprisings(ctx);
  for (const s of ctx.st.settlements) {
    if (!s.controller || s.status === 'fallen' || s.id === ctx.S.startId || besieged(ctx, s)) continue;
    if ((ctx.st.ext.lockUntil[s.id] ?? 0) > ctx.st.clock.totalHours) continue;
    const f = getFaction(ctx, s.controller);
    if (!f) continue;
    const n = ownedCount(ctx, f.id);
    let p = 0;
    if (n > 2 && f.capital !== s.id) p += FACT.revoltChance * (n - 2);
    if (s.prosperity < 24) p += 0.012;
    if (f.power < 20 && f.capital !== s.id) p += 0.02;
    if (p > 0 && ctx.rng.chance(p)) {
      const before = s.controller;
      s.controller = null;
      s.prosperity = clamp(s.prosperity + 2, 0, 100);
      ctx.st.ext.lockUntil[s.id] = ctx.st.clock.totalHours + FACT.lockDays * 24;
      ctx.st.ext.stats.revolts = (ctx.st.ext.stats.revolts ?? 0) + 1;
      f.power = round1(clamp(f.power - 2, FACT.powerFloor, 100));
      // Often a weaker rival (above all a landless one) is waiting to be welcomed.
      const heir = pickHeir(ctx, f.id);
      if (heir && ctx.rng.chance(FACT.revoltHeirChance)) {
        s.controller = heir.id;
        heir.influence = round1(clamp(heir.influence + 4, 0, 100));
        ctx.st.ext.stats.revoltsToRival = (ctx.st.ext.stats.revoltsToRival ?? 0) + 1;
        chron(ctx, 'faction', `The people of ${settlementName(ctx, s.id)} rise against the ${factionName(f.id)} and declare for the ${factionName(heir.id)}.`, 2, { sid: s.id, force: true });
      } else {
        chron(ctx, 'faction', `${settlementName(ctx, s.id)} has thrown off the rule of the ${factionName(f.id)}.`, 2, { sid: s.id, force: true });
      }
      refreshCapitals(ctx);
      onNpcControllerChanged(ctx, s.id, before);
      emit(ctx, { k: 'settle', id: s.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Daily entry point
// ---------------------------------------------------------------------------

export function factionsDaily(ctx: Ctx): void {
  const st = ctx.st;
  const now = st.clock.totalHours;
  updateRelations(ctx);
  incidents(ctx);
  for (const f of st.factions) dailyEconomy(ctx, f);
  diplomacy(ctx);
  // Rotate who acts first so order never favours one faction.
  const fs = st.factions;
  const start = Math.floor(now / 24) % fs.length;
  for (let k = 0; k < fs.length; k++) {
    const f = fs[(start + k) % fs.length];
    if (now < (st.ext.nextAct[f.id] ?? 0)) continue;
    st.ext.nextAct[f.id] = now + ctx.rng.int(FACT.actEvery[0], FACT.actEvery[1]);
    doAction(ctx, f);
  }
  revolts(ctx);
  refreshCapitals(ctx);
}

export function factionBriefs(ctx: Ctx): FactionBrief[] {
  return ctx.st.factions.map((f) => ({
    id: f.id,
    power: Math.round(f.power),
    wealth: Math.round(f.wealth),
    influence: Math.round(f.influence),
    atWarWith: [...f.atWarWith],
    alliedWith: [...f.alliedWith],
    settlements: ownedIds(ctx, f.id),
    goal: f.goal,
  }));
}

/** True when any heart is active within `r` tiles of a point. */
export function heartNear(ctx: Ctx, x: number, y: number, r: number): boolean {
  const now = ctx.st.clock.totalHours;
  for (const h of ctx.st.hearts) if (heartActive(h, now) && Math.hypot(h.x - x, h.y - y) <= r) return true;
  return false;
}
