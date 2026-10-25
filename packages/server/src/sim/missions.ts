/**
 * Mission boards: each living settlement keeps 4-8 offers generated from live world state
 * (local danger, Blight, sieges, famine, scarcity, roads), refreshed daily and on relevant events.
 * Also the player-facing operations: take / return an offer and record a completed mission.
 */
import {
  FACTION_BY_ID,
  GOODS,
  ITEMS,
  MONSTERS,
  SKILL_LIST,
  isPassable,
  levelForDanger,
  pickSpecies,
  rankOf,
  type ItemStack,
  type MissionOffer,
  type MissionReward,
  type MissionType,
  type MonsterDef,
  type MonsterFamily,
  type NpcRole,
  type SimEvent,
} from '@murim/shared';
import { MISSION, SETTLE } from './constants';
import { emitBlight, heartActive, nearestSettlementName, purifyArea } from './blight';
import { chron } from './chronicle';
import { dayOf } from './clock';
import type { Ctx } from './types';
import { besieged, clamp, emit, hasFlag, settlementName } from './util';

// ---------------------------------------------------------------------------
// Dirty tracking and settlement hooks
// ---------------------------------------------------------------------------

export function markBoard(ctx: Ctx, sid: number): void {
  const d = ctx.st.ext.boardDirty;
  if (!d.includes(sid)) d.push(sid);
}

export function onBoardSiegeStart(ctx: Ctx, sid: number): void {
  markBoard(ctx, sid);
}

export function onBoardSiegeEnd(ctx: Ctx, sid: number): void {
  markBoard(ctx, sid);
}

export function onBoardFallen(ctx: Ctx, sid: number): void {
  ctx.st.boards[sid] = [];
  emit(ctx, { k: 'board', settlementId: sid });
  for (const [nb] of ctx.S.adj[sid]) markBoard(ctx, nb);
}

// ---------------------------------------------------------------------------
// Generation helpers
// ---------------------------------------------------------------------------

function plural(name: string): string {
  if (/Wolf$/.test(name)) return name.replace(/Wolf$/, 'Wolves');
  return `${name}s`;
}

function localLevel(ctx: Ctx, sid: number): number {
  let lv = levelForDanger(ctx.S.danger[sid], ctx.rng);
  if (sid === ctx.S.startId) lv = Math.min(lv, 4);
  return Math.max(1, lv);
}

function patronFaction(ctx: Ctx, sid: number): string | null {
  const s = ctx.st.settlements[sid];
  if (s.controller) return s.controller;
  const d = ctx.S.defs[sid];
  let best: string | null = null;
  let bd = Infinity;
  for (const o of ctx.st.settlements) {
    if (!o.controller || o.status === 'fallen') continue;
    const dd = Math.hypot(ctx.S.defs[o.id].x - d.x, ctx.S.defs[o.id].y - d.y);
    if (dd < bd) {
      bd = dd;
      best = o.controller;
    }
  }
  return best;
}

function giverFor(ctx: Ctx, sid: number, roles: NpcRole[]): number | undefined {
  const cand = ctx.st.npcs.filter((n) => n.alive && n.settlementId === sid && roles.includes(n.role));
  if (!cand.length) return undefined;
  return cand[ctx.rng.int(0, cand.length - 1)].id;
}

function rewardItem(ctx: Ctx, sid: number, level: number, manualP: number): ItemStack {
  const rng = ctx.rng;
  if (rng.chance(manualP)) {
    const rank = rankOf(level);
    const fac = patronFaction(ctx, sid);
    const schools = fac ? FACTION_BY_ID[fac]?.schools : undefined;
    let pool = SKILL_LIST.filter((s) => s.tier <= rank && s.tier >= Math.max(1, rank - 1));
    const pref = schools ? pool.filter((s) => schools.includes(s.school)) : [];
    if (pref.length) pool = pref;
    if (pool.length) {
      const sk = rng.pick(pool);
      if (ITEMS[`manual_${sk.id}`]) return { id: `manual_${sk.id}`, qty: 1 };
    }
  }
  let ids: string[];
  if (level < 8) ids = ['pill_heal_s', 'pill_heal_s', 'pill_qi_s', 'cooked_meat'];
  else if (level < 18) ids = ['pill_heal_m', 'pill_qi_m', 'antidote', 'pill_heal_s', 'pill_train'];
  else ids = ['pill_heal_l', 'pill_qi_m', 'pill_train', 'antidote', 'pill_break_1'];
  return { id: rng.pick(ids), qty: rng.int(1, level < 8 ? 3 : 2) };
}

function makeReward(ctx: Ctx, sid: number, type: MissionType, level: number, mult: number, itemP: number, manualP = 0.06): MissionReward {
  const rng = ctx.rng;
  const r: MissionReward = {
    xp: Math.max(1, Math.round((25 + level * 9) * mult)),
    gold: Math.max(1, Math.round((12 + level * 6) * mult)),
  };
  const fac = patronFaction(ctx, sid);
  if (fac) r.rep = { faction: fac, amount: clamp(Math.round(2 + mult * 2.2 + rng.float(0, 1.5)), 2, 8) };
  if (rng.chance(itemP)) r.items = [rewardItem(ctx, sid, level, manualP)];
  void type;
  return r;
}

function expiry(ctx: Ctx, extra = 0): number {
  return dayOf(ctx.st.clock.totalHours) + ctx.rng.int(MISSION.expiresDays[0], MISSION.expiresDays[1]) + extra;
}

function minRankFor(level: number): number {
  return Math.max(1, rankOf(Math.max(1, level - 2)));
}

function baseOffer(ctx: Ctx, sid: number, type: MissionType, level: number): Omit<MissionOffer, 'title' | 'desc' | 'target' | 'reward'> {
  return { id: '', type, settlementId: sid, minRank: minRankFor(level), level, expires: expiry(ctx) };
}

/** Familiy odds for hunts and bounties around a settlement. */
function familyWeights(ctx: Ctx, sid: number): [MonsterFamily, number][] {
  const s = ctx.st.settlements[sid];
  const spawns = ctx.S.spawnsNear[sid];
  const has = (f: MonsterFamily) => spawns.some((sp) => sp.family === f);
  const out: [MonsterFamily, number][] = [['beast', has('beast') || spawns.length === 0 ? 6 : 2]];
  if (has('blight') || s.blight > 25) out.push(['blight', 1.5 + s.blight / 30 + (has('blight') ? 1 : 0)]);
  const bandits = ctx.st.settlements.some((o) => o.controller === 'blackwind' && Math.hypot(ctx.S.defs[o.id].x - ctx.S.defs[sid].x, ctx.S.defs[o.id].y - ctx.S.defs[sid].y) < 130);
  if (has('bandit') || bandits) out.push(['bandit', has('bandit') ? 3 : 1.2]);
  return out;
}

/** A spawn point of the family near the settlement, for mission coordinates. */
function areaFor(ctx: Ctx, sid: number, family: MonsterFamily): { x: number; y: number; radius: number } {
  const sp = ctx.S.spawnsNear[sid].find((p) => p.family === family);
  if (sp) return { x: sp.x, y: sp.y, radius: Math.max(8, sp.radius + 4) };
  const d = ctx.S.defs[sid];
  return { x: d.x, y: d.y, radius: d.radius + 16 };
}

function pickT<T>(ctx: Ctx, arr: readonly T[]): T {
  return ctx.rng.pick(arr);
}

// ---------------------------------------------------------------------------
// Type generators. Each returns an offer without an id, or null when not applicable.
// ---------------------------------------------------------------------------

function genHunt(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const level = localLevel(ctx, sid);
  const family = rng.weighted(familyWeights(ctx, sid));
  const mon = pickSpecies(rng, family, level, false);
  if (!MONSTERS[mon.id]) return null;
  const n = rng.int(3, 8);
  const area = areaFor(ctx, sid, family);
  const place = nearestSettlementName(ctx, area.x, area.y);
  const pl = plural(mon.name);
  const titles = family === 'blight' ? [`Put the ${pl} to Rest`, `Silence the ${pl}`, `Hollows Near ${place}`] : family === 'bandit' ? [`Bandits on the Road`, `Break the ${pl}`, `Bounty on ${pl}`] : [`Cull the ${pl}`, `Thin the ${pl}`, `The ${pl} Must Go`, `Hunt the ${pl}`];
  const descs =
    family === 'blight'
      ? [`Hollows shamble where the Blight lies thick. Cut down ${n} ${pl} near ${place} before their moaning keeps the village awake another night.`, `The dead do not rest near ${place}. Lay ${n} ${pl} to rest and burn what remains.`]
      : family === 'bandit'
        ? [`${n} ${pl} are bleeding the road near ${place} dry. The magistrate will pay well for proof of their end.`, `Caravans no longer pass ${place} unescorted. Scatter ${n} ${pl} and the carters may find courage again.`]
        : [`${n} ${pl} have grown bold near ${place}. The elders will pay silver to the one who thins them.`, `Herders near ${place} lost another animal to the ${pl}. Bring down ${n} and the pastures are yours to walk safely.`, `The ${pl} stalk the edge of ${place} at dusk. A steady hand could end ${n} of them before the harvest.`];
  const mult = 0.85 + n * 0.04;
  return {
    ...baseOffer(ctx, sid, 'hunt', level),
    title: pickT(ctx, titles),
    desc: pickT(ctx, descs),
    giverId: giverFor(ctx, sid, ['guard', 'elder', 'merchant']),
    target: { monster: mon.id, family, count: n, x: area.x, y: area.y, radius: area.radius },
    reward: makeReward(ctx, sid, 'hunt', level, mult, 0.18),
  };
}

const GATHER_ITEMS: { item: string; good: boolean; label: string }[] = [
  { item: 'herb', good: true, label: 'Qi-Gathering Grass' },
  { item: 'ore_iron', good: true, label: 'iron ore' },
  { item: 'hide', good: true, label: 'beast hides' },
  { item: 'meat', good: true, label: 'fresh meat' },
  { item: 'fang', good: false, label: 'wolf fangs' },
];

function stockDays(ctx: Ctx, sid: number, g: string): number {
  const s = ctx.st.settlements[sid];
  return (s.stock[g] ?? 0) / Math.max(s.cons[g] ?? 0, 0.3);
}

function genGather(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const s = ctx.st.settlements[sid];
  const level = localLevel(ctx, sid);
  const items = GATHER_ITEMS.map((g) => {
    let w = 1;
    if (g.good) {
      const d = stockDays(ctx, sid, g.item);
      if (d < 6) w += 3;
      else if (d < 12) w += 1;
    }
    if (g.item === 'meat' && hasFlag(s, 'famine')) w += 3;
    if (g.item === 'herb' && hasFlag(s, 'plague')) w += 3;
    return [g, w] as const;
  });
  const g = rng.weighted(items);
  const scarce = g.good && stockDays(ctx, sid, g.item) < 6;
  const n = rng.int(4, 12);
  const mult = 0.8 + n * 0.015 + (scarce ? 0.45 : 0);
  const place = settlementName(ctx, sid);
  const titles = [`Gather ${g.label}`, `${g.label[0].toUpperCase()}${g.label.slice(1)} Wanted`, `Fetch ${g.label}`];
  const descs = scarce
    ? [`${place}'s stores of ${g.label} run dangerously low. Bring ${n} and the elders will pay a premium.`, `Without ${g.label}, the workshops of ${place} sit idle. ${n} would be a mercy.`]
    : [`The craftsmen of ${place} need ${n} ${g.label}. Honest work for honest coin.`, `Bring ${n} ${g.label} to the board-keeper of ${place} and collect your due.`];
  const giverRoles: NpcRole[] = g.item === 'herb' ? ['alchemist', 'merchant'] : g.item === 'ore_iron' ? ['smith', 'merchant'] : ['merchant', 'innkeeper', 'elder'];
  return {
    ...baseOffer(ctx, sid, 'gather', level),
    title: pickT(ctx, titles),
    desc: pickT(ctx, descs),
    giverId: giverFor(ctx, sid, giverRoles),
    target: { item: g.item, count: n },
    reward: makeReward(ctx, sid, 'gather', level, mult, 0.12),
  };
}

function genDeliver(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const nbs = ctx.S.adj[sid].filter(([o, ri]) => {
    const t = ctx.st.settlements[o];
    return t.status !== 'fallen' && !besieged(ctx, t) && ctx.st.ext.roadBlocked[ri] !== 1;
  });
  if (nbs.length === 0) return null;
  const pick = rng.weighted(nbs.map((e) => [e, 1 + (hasFlag(ctx.st.settlements[e[0]], 'famine') ? 3 : 0)] as const));
  const dest = pick[0];
  const d = ctx.st.settlements[dest];
  const famine = hasFlag(d, 'famine');
  // What the destination lacks most, if we have it.
  let want = 'grain';
  let worst = Infinity;
  for (const g of GOODS) {
    if ((d.cons[g] ?? 0) <= 0) continue;
    const days = stockDays(ctx, dest, g);
    if (days < worst && stockDays(ctx, sid, g) > 6) {
      worst = days;
      want = g;
    }
  }
  if (famine) want = rng.chance(0.6) ? 'grain' : 'meat';
  if (!ITEMS[want]) return null;
  const n = rng.int(3, 8);
  const level = Math.max(localLevel(ctx, sid), sid === ctx.S.startId ? 1 : Math.min(localLevel(ctx, dest), localLevel(ctx, sid) + 3));
  const dist = Math.hypot(ctx.S.defs[sid].x - ctx.S.defs[dest].x, ctx.S.defs[sid].y - ctx.S.defs[dest].y);
  const mult = 0.85 + dist * 0.004 + (famine ? 0.6 : 0);
  const to = settlementName(ctx, dest);
  const label = ITEMS[want].name.toLowerCase();
  const titles = famine ? [`Relief for ${to}`, `Bread for ${to}`] : [`Caravan to ${to}`, `Deliver to ${to}`, `A Parcel for ${to}`];
  const descs = famine
    ? [`Famine grips ${to}. Carry ${n} ${label} down the road before the hungry turn desperate.`, `${to} starves while we hold surplus. Take ${n} ${label} there, and do not tarry.`]
    : [`The merchants of ${to} await ${n} ${label}. The road is open; make it before dusk.`, `Carry ${n} ${label} to ${to}. A guild seal will vouch for you at the gate.`];
  return {
    ...baseOffer(ctx, sid, 'deliver', level),
    title: pickT(ctx, titles),
    desc: pickT(ctx, descs),
    giverId: giverFor(ctx, sid, ['merchant', 'elder']),
    target: { item: want, count: n, toSettlement: dest },
    reward: makeReward(ctx, sid, 'deliver', level, mult, 0.12),
  };
}

function genPurify(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const def = ctx.S.defs[sid];
  const B = ctx.st.blight;
  const w = ctx.S.w;
  const spots: { x: number; y: number; v: number }[] = [];
  const R = 36;
  for (let y = Math.max(0, def.y - R); y <= Math.min(ctx.S.h - 1, def.y + R); y += 3) {
    for (let x = Math.max(0, def.x - R); x <= Math.min(w - 1, def.x + R); x += 3) {
      const dd = Math.hypot(x - def.x, y - def.y);
      if (dd < def.radius + 2 || dd > R) continue;
      const v = B[y * w + x];
      if (v >= 45 && ctx.S.land[y * w + x]) spots.push({ x, y, v });
    }
  }
  if (spots.length === 0) return null;
  spots.sort((a, b) => b.v - a.v || a.y - b.y || a.x - b.x);
  const top = spots.slice(0, 10);
  const spot = rng.weighted(top.map((p) => [p, p.v] as const));
  const level = clamp(localLevel(ctx, sid) + (spot.v > 150 ? 2 : spot.v > 100 ? 1 : 0), 1, 48);
  const n = rng.int(5, 10);
  const place = nearestSettlementName(ctx, spot.x, spot.y);
  const titles = [`Cleanse the Land near ${place}`, `Drive Back the Blight`, `Purify the Blighted Ground`];
  const descs = [`Black mist pools near ${place}. Slay ${n} Hollows where it gathers and the ground may breathe again.`, `The Blight creeps toward ${place}. Kill ${n} of the corrupted creatures lurking in its heart to blunt its advance.`];
  const mult = 1.15 + (n - 5) * 0.06 + spot.v / 600;
  return {
    ...baseOffer(ctx, sid, 'purify', level),
    title: pickT(ctx, titles),
    desc: pickT(ctx, descs),
    giverId: giverFor(ctx, sid, ['elder', 'master', 'alchemist']),
    target: { family: 'blight', count: n, x: spot.x, y: spot.y, radius: 8 },
    reward: makeReward(ctx, sid, 'purify', level, mult, 0.22, 0.1),
  };
}

function genDefend(ctx: Ctx, sid: number): MissionOffer | null {
  const s = ctx.st.settlements[sid];
  if (!besieged(ctx, s)) return null;
  const rng = ctx.rng;
  const def = ctx.S.defs[sid];
  const blight = s.siegeBy === 'blight';
  const family: MonsterFamily = blight ? 'blight' : 'bandit';
  const level = Math.max(3, localLevel(ctx, sid));
  const n = rng.int(6, 12);
  const name = settlementName(ctx, sid);
  const hoursLeft = Math.max(1, s.siegeUntil - ctx.st.clock.totalHours);
  const titles = [`Defend ${name}!`, `The Walls of ${name}`, `Hold the Gate`];
  const descs = blight
    ? [`Hollows hammer at the gates of ${name}. Cut down ${n} of them and buy the defenders breath.`, `The dead swarm ${name}! Every blade that kills ${n} Hollows today saves a hearth tonight.`]
    : [`Raiders are at the gates of ${name}. Strike down ${n} of them before the walls give.`, `${name} is under attack. The guards are outnumbered: help break ${n} of the raiders.`];
  return {
    ...baseOffer(ctx, sid, 'defend', level),
    title: pickT(ctx, titles),
    desc: pickT(ctx, descs),
    giverId: giverFor(ctx, sid, ['guard', 'elder']),
    target: { family, count: n, x: def.x, y: def.y, radius: def.radius + 14 },
    reward: makeReward(ctx, sid, 'defend', level, 1.6, 0.35, 0.1),
    expires: dayOf(ctx.st.clock.totalHours) + Math.ceil(hoursLeft / 24) + 1,
  };
}

const EPITHET = ['Scarred', 'Red-Eyed', 'Nine-Toed', 'Grey-Maned', 'Hollow-Voiced', 'Iron-Hided', 'Black-Fanged', 'One-Eared'];

function genBounty(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const s = ctx.st.settlements[sid];
  const def = ctx.S.defs[sid];
  const level0 = localLevel(ctx, sid);
  const now = ctx.st.clock.totalHours;
  const fw = familyWeights(ctx, sid);
  const cands: (readonly [MonsterDef, number])[] = [];
  for (const m of Object.values(MONSTERS)) {
    if (!m.elite && !m.boss) continue;
    const fwt = fw.find((f) => f[0] === m.family)?.[1] ?? 0;
    if (fwt <= 0) continue;
    if (m.boss) {
      const nearHeart = ctx.st.hearts.some((h) => heartActive(h, now) && Math.hypot(h.x - def.x, h.y - def.y) < 70);
      if (!nearHeart || level0 < 11 || s.blight < 40) continue;
      cands.push([m, 0.25] as const);
    } else if (m.minLevel <= level0 + 6) {
      cands.push([m, fwt] as const);
    }
  }
  if (cands.length === 0) return null;
  const mon = rng.weighted(cands);
  const level = mon.boss ? Math.max(30, mon.minLevel) : clamp(level0 + 3, mon.minLevel, mon.maxLevel);
  const elite = mon.boss ? 2 : 1;
  const area = areaFor(ctx, sid, mon.family);
  const place = nearestSettlementName(ctx, area.x, area.y);
  const epithet = pickT(ctx, EPITHET);
  const title = mon.boss ? `Slay the ${mon.name}` : `Bounty: the ${epithet} ${mon.name}`;
  const desc = mon.boss
    ? `A ${mon.name} stirs in the black heart of the Blight near ${place}. Whoever ends it will be sung of in every tavern, assuming anyone survives to sing.`
    : `A ${epithet.toLowerCase()} ${mon.name} has been preying on those near ${place}. The elders post a bounty for its head.`;
  return {
    ...baseOffer(ctx, sid, 'bounty', level),
    title,
    desc,
    giverId: giverFor(ctx, sid, ['elder', 'master', 'guard']),
    target: { monster: mon.id, family: mon.family, count: 1, elite, x: area.x, y: area.y, radius: area.radius },
    reward: makeReward(ctx, sid, 'bounty', level, mon.boss ? 4.5 : 2.4, 0.4, 0.22),
    expires: expiry(ctx, 3),
  };
}

function nearPassable(ctx: Ctx, x: number, y: number): { x: number; y: number } | null {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(ctx.world, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

function genInvestigate(ctx: Ctx, sid: number): MissionOffer | null {
  const rng = ctx.rng;
  const def = ctx.S.defs[sid];
  const now = ctx.st.clock.totalHours;
  const level0 = localLevel(ctx, sid);
  interface Spot {
    x: number;
    y: number;
    kind: 'shrine' | 'ruin' | 'heart' | 'fallen';
    lvl: number;
    name: string;
  }
  const spots: (readonly [Spot, number])[] = [];
  for (const n of ctx.world.nodes) {
    const d = Math.hypot(n.x - def.x, n.y - def.y);
    if (n.kind === 'shrine' && d <= 80 && d >= 3) spots.push([{ x: n.x, y: n.y, kind: 'shrine', lvl: level0, name: 'a wayside shrine' }, 2] as const);
    else if (n.kind === 'heart' && d <= 80 && level0 >= 7) {
      const h = ctx.st.hearts.find((x) => x.id === n.id);
      if (!h || !heartActive(h, now)) continue;
      const k = d > 0 ? 12 / d : 0;
      const p = nearPassable(ctx, Math.round(n.x + (def.x - n.x) * k), Math.round(n.y + (def.y - n.y) * k));
      if (p) spots.push([{ x: p.x, y: p.y, kind: 'heart', lvl: level0 + 3, name: 'the edge of a Blight heart' }, 1.2] as const);
    }
  }
  for (const o of ctx.st.settlements) {
    if (o.status !== 'fallen' || o.id === sid) continue;
    const od = ctx.S.defs[o.id];
    const d = Math.hypot(od.x - def.x, od.y - def.y);
    if (d > 95 || (o.id === ctx.S.ruinId && level0 < 8)) continue;
    spots.push([{ x: od.spawn.x, y: od.spawn.y, kind: o.id === ctx.S.ruinId ? 'ruin' : 'fallen', lvl: level0 + (o.id === ctx.S.ruinId ? 3 : 1), name: `the ruins of ${od.name}` }, 1.5] as const);
  }
  if (spots.length === 0) return null;
  const spot = rng.weighted(spots);
  const level = clamp(spot.lvl, 1, 48);
  const place = nearestSettlementName(ctx, spot.x, spot.y);
  const titles: Record<Spot['kind'], string[]> = {
    shrine: ['Pay Respects at the Shrine', 'A Shrine Gone Silent', 'Check the Wayside Shrine'],
    ruin: ['Scout the Fallen Capital', 'Whispers from the Ruins'],
    heart: ['Scout the Heart of the Blight', 'Mark the Edge of the Mist'],
    fallen: ['Survey the Ruins', 'Is Anyone Left?'],
  };
  const descs: Record<Spot['kind'], string[]> = {
    shrine: [`Pilgrims report an odd chill at the shrine near ${place}. Go and see what troubles the spirits.`, `The shrine lamp near ${place} has gone dark. Visit it, and return with word.`],
    ruin: [`Something moves among the broken halls near ${place}. Walk the ruins and learn what you can, then withdraw.`],
    heart: [`The elders want to know how far the mist has spread around ${spot.name}. Reach the marked spot near ${place} and return alive.`],
    fallen: [`${spot.name} has gone silent. Travel there, see whether anyone survives, and report back.`],
  };
  return {
    ...baseOffer(ctx, sid, 'investigate', level),
    title: pickT(ctx, titles[spot.kind]),
    desc: pickT(ctx, descs[spot.kind]),
    giverId: giverFor(ctx, sid, ['elder', 'master']),
    target: { x: spot.x, y: spot.y, radius: 3, count: 1 },
    reward: makeReward(ctx, sid, 'investigate', level, spot.kind === 'heart' ? 1.5 : 1.0, 0.25, 0.14),
    expires: expiry(ctx, 2),
  };
}

function generate(ctx: Ctx, sid: number, type: MissionType): MissionOffer | null {
  switch (type) {
    case 'hunt':
      return genHunt(ctx, sid);
    case 'gather':
      return genGather(ctx, sid);
    case 'deliver':
      return genDeliver(ctx, sid);
    case 'purify':
      return genPurify(ctx, sid);
    case 'defend':
      return genDefend(ctx, sid);
    case 'bounty':
      return genBounty(ctx, sid);
    case 'investigate':
      return genInvestigate(ctx, sid);
    default:
      return null;
  }
}

function offerKey(o: MissionOffer): string {
  const t = o.target;
  return `${o.type}:${t.monster ?? ''}:${t.item ?? ''}:${t.toSettlement ?? ''}:${t.x ?? ''},${t.y ?? ''}`;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

function boardOf(ctx: Ctx, sid: number): MissionOffer[] {
  let b = ctx.st.boards[sid];
  if (!b) {
    b = [];
    ctx.st.boards[sid] = b;
  }
  return b;
}

function desiredSize(ctx: Ctx, sid: number): number {
  const ext = ctx.st.ext;
  let n = ext.boardSize[sid];
  if (n === undefined) {
    const kind = ctx.S.defs[sid].kind;
    n = kind === 'hamlet' ? 4 : kind === 'town' ? ctx.rng.int(7, 8) : sid === ctx.S.startId ? 5 : ctx.rng.int(5, 6);
    ext.boardSize[sid] = n;
  }
  return clamp(n, MISSION.minOffers, MISSION.maxOffers);
}

function pickType(ctx: Ctx, board: MissionOffer[], failed: Set<MissionType>, sid: number): MissionType {
  const cnt: Record<string, number> = {};
  for (const o of board) cnt[o.type] = (cnt[o.type] ?? 0) + 1;
  const s = ctx.st.settlements[sid];
  const w: [MissionType, number][] = [
    ['hunt', Math.max(0.6, 4 - (cnt.hunt ?? 0) * 0.9)],
    ['gather', Math.max(0.5, 3 - (cnt.gather ?? 0) * 0.8) + (hasFlag(s, 'famine') ? 1.5 : 0)],
    ['deliver', Math.max(0.2, 2 - (cnt.deliver ?? 0) * 0.8)],
    ['purify', Math.max(0.2, 2.2 - (cnt.purify ?? 0) * 1.1) + s.blight / 80],
    ['investigate', cnt.investigate ? 0.3 : 1.2],
    ['bounty', cnt.bounty ? 0.1 : 0.9],
  ];
  const ok = w.filter(([t]) => !failed.has(t));
  if (ok.length === 0) return 'hunt';
  return ctx.rng.weighted(ok.map(([t, x]) => [t, x] as const));
}

/** Top the board up to `size`, adding defend offers during a siege. Returns true when it changed. */
function fillBoard(ctx: Ctx, sid: number): boolean {
  const s = ctx.st.settlements[sid];
  if (s.status === 'fallen') return false;
  const board = boardOf(ctx, sid);
  const size = desiredSize(ctx, sid);
  let changed = false;
  const push = (o: MissionOffer): boolean => {
    if (board.some((b) => offerKey(b) === offerKey(o))) return false;
    o.id = `m${ctx.st.nextOfferId++}`;
    board.push(o);
    changed = true;
    return true;
  };
  if (besieged(ctx, s)) {
    let have = board.filter((o) => o.type === 'defend').length;
    for (let i = 0; i < 4 && have < 2; i++) {
      const o = genDefend(ctx, sid);
      if (o && push(o)) have++;
    }
  }
  const failed = new Set<MissionType>();
  for (let guard = 0; board.length < Math.max(size, board.filter((o) => o.type === 'defend').length + 3) && guard < size * 5; guard++) {
    const type = pickType(ctx, board, failed, sid);
    const o = generate(ctx, sid, type);
    if (!o) {
      failed.add(type);
      continue;
    }
    push(o);
  }
  return changed;
}

/** Drop offers that no longer make sense (expired, defend without a siege, dead delivery route). */
function pruneBoard(ctx: Ctx, sid: number, retireChance: number): boolean {
  const day = dayOf(ctx.st.clock.totalHours);
  const board = boardOf(ctx, sid);
  const s = ctx.st.settlements[sid];
  const before = board.length;
  const keep = board.filter((o) => {
    if (o.expires <= day) return false;
    if (o.giverId !== undefined) {
      const g = ctx.npcById.get(o.giverId);
      if (!g || !g.alive || g.settlementId !== sid) o.giverId = undefined;
    }
    if (o.type === 'defend') return besieged(ctx, s);
    if (o.type === 'deliver') {
      const t = o.target.toSettlement !== undefined ? ctx.st.settlements[o.target.toSettlement] : undefined;
      if (!t || t.status === 'fallen' || besieged(ctx, t)) return false;
    }
    if (retireChance > 0 && ctx.rng.chance(retireChance)) return false;
    return true;
  });
  if (keep.length === before) return false;
  ctx.st.boards[sid] = keep;
  return true;
}

export function initBoards(ctx: Ctx): void {
  for (const s of ctx.st.settlements) {
    ctx.st.boards[s.id] = [];
    if (s.status === 'fallen') continue;
    desiredSize(ctx, s.id);
    fillBoard(ctx, s.id);
  }
}

/** Daily (at BOARD_HOUR): retire stale offers, post fresh ones. */
export function refreshBoards(ctx: Ctx): void {
  for (const s of ctx.st.settlements) {
    if (s.status === 'fallen') {
      if ((ctx.st.boards[s.id]?.length ?? 0) > 0) {
        ctx.st.boards[s.id] = [];
        emit(ctx, { k: 'board', settlementId: s.id });
      }
      continue;
    }
    const a = pruneBoard(ctx, s.id, 0.14);
    const b = fillBoard(ctx, s.id);
    ctx.st.ext.boardDirty = ctx.st.ext.boardDirty.filter((x) => x !== s.id);
    if (a || b) emit(ctx, { k: 'board', settlementId: s.id });
  }
}

/** Hourly: boards flagged by events (siege, famine, take-offs) are refreshed. */
export function topUpBoards(ctx: Ctx): void {
  const dirty = ctx.st.ext.boardDirty;
  if (dirty.length === 0) return;
  ctx.st.ext.boardDirty = [];
  for (const sid of dirty) {
    const s = ctx.st.settlements[sid];
    if (!s) continue;
    if (s.status === 'fallen') {
      if ((ctx.st.boards[sid]?.length ?? 0) > 0) ctx.st.boards[sid] = [];
      emit(ctx, { k: 'board', settlementId: sid });
      continue;
    }
    let changed = pruneBoard(ctx, sid, 0);
    // Make room so an event (famine, siege...) can reshape a full board.
    const board = boardOf(ctx, sid);
    const free = board.filter((o) => o.type !== 'defend');
    if (free.length >= desiredSize(ctx, sid) && (hasFlag(s, 'famine') || besieged(ctx, s)) && free.length) {
      const victim = free[ctx.rng.int(0, free.length - 1)];
      ctx.st.boards[sid] = board.filter((o) => o !== victim);
      changed = true;
    }
    if (fillBoard(ctx, sid)) changed = true;
    if (changed) emit(ctx, { k: 'board', settlementId: sid });
  }
}

// ---------------------------------------------------------------------------
// Player-facing operations
// ---------------------------------------------------------------------------

export function boardView(ctx: Ctx, sid: number): MissionOffer[] {
  const day = dayOf(ctx.st.clock.totalHours);
  return (ctx.st.boards[sid] ?? []).filter((o) => o.expires > day);
}

export function takeOfferImpl(ctx: Ctx, sid: number, offerId: string): MissionOffer | null {
  const board = ctx.st.boards[sid];
  if (!board) return null;
  const i = board.findIndex((o) => o.id === offerId);
  if (i < 0) return null;
  const [o] = board.splice(i, 1);
  markBoard(ctx, sid);
  if (o.expires <= dayOf(ctx.st.clock.totalHours)) return null;
  return o;
}

export function returnOfferImpl(ctx: Ctx, offer: MissionOffer): void {
  const s = ctx.st.settlements[offer.settlementId];
  if (!s || s.status === 'fallen') return;
  if (offer.expires <= dayOf(ctx.st.clock.totalHours)) return;
  if (offer.type === 'defend' && !besieged(ctx, s)) return;
  const board = boardOf(ctx, offer.settlementId);
  if (board.some((o) => o.id === offer.id) || board.length >= MISSION.maxOffers) return;
  board.push(offer);
  markBoard(ctx, offer.settlementId);
}

/** A player finished an offer: the world feels it. Returns the events produced. */
export function recordMissionDoneImpl(ctx: Ctx, offer: MissionOffer, playerName: string): void {
  const s = ctx.st.settlements[offer.settlementId];
  if (!s) return;
  const st = ctx.st;
  st.ext.stats.missionsDone = (st.ext.stats.missionsDone ?? 0) + 1;
  const name = settlementName(ctx, offer.settlementId);
  if (s.status !== 'fallen') s.prosperity = clamp(s.prosperity + clamp(0.5 + offer.level * 0.04, 0.5, 2.5), 0, 100);
  const t = offer.target;
  switch (offer.type) {
    case 'gather':
      if (t.item && (GOODS as readonly string[]).includes(t.item) && s.status !== 'fallen') s.stock[t.item] = Math.round(((s.stock[t.item] ?? 0) + t.count) * 10) / 10;
      break;
    case 'deliver': {
      const dest = t.toSettlement !== undefined ? st.settlements[t.toSettlement] : undefined;
      if (dest && dest.status !== 'fallen' && t.item && (GOODS as readonly string[]).includes(t.item)) {
        dest.stock[t.item] = Math.round(((dest.stock[t.item] ?? 0) + t.count) * 10) / 10;
        dest.prosperity = clamp(dest.prosperity + 0.8, 0, 100);
        emit(ctx, { k: 'settle', id: dest.id });
        if (hasFlag(dest, 'famine')) {
          chron(ctx, 'economy', `${playerName} brought relief to famine-struck ${settlementName(ctx, dest.id)}.`, 1, { sid: dest.id, key: `relief:${dest.id}`, cooldown: 24 });
        }
      }
      break;
    }
    case 'purify': {
      if (t.x !== undefined && t.y !== undefined) {
        const changed = purifyArea(ctx, t.x, t.y, (t.radius ?? 8) + 2, 40 + offer.level * 2);
        emitBlight(ctx, changed);
        chron(ctx, 'blight', `${playerName} cleansed the Blight near ${nearestSettlementName(ctx, t.x, t.y)}.`, offer.level >= 12 ? 2 : 1, { key: `purify:${offer.settlementId}`, cooldown: 12 });
      }
      break;
    }
    case 'defend':
      if (besieged(ctx, s)) {
        s.siegeStrength = Math.round(s.siegeStrength * (1 - SETTLE.defendMissionHit) * 10) / 10;
        st.ext.siegeKills[s.id] = (st.ext.siegeKills[s.id] ?? 0) + (t.count ?? 0);
        chron(ctx, 'settlement', `${playerName} rallied the defenders of ${name}.`, 2, { sid: s.id, key: `rally:${s.id}`, cooldown: 6 });
      }
      break;
    case 'bounty': {
      const m = t.monster ? MONSTERS[t.monster] : undefined;
      if (m) {
        chron(ctx, 'player', `${playerName} slew the ${m.name} that haunted ${t.x !== undefined && t.y !== undefined ? nearestSettlementName(ctx, t.x, t.y) : name}.`, t.elite === 2 ? 3 : 2, { sid: s.id, force: true });
      }
      break;
    }
    case 'investigate':
      if (offer.level >= 10) chron(ctx, 'player', `${playerName} returned from the dangerous lands beyond ${name} with word of what lies there.`, 1, { sid: s.id, key: `inv:${playerName}`, cooldown: 12 });
      break;
    default:
      break;
  }
  emit(ctx, { k: 'settle', id: s.id });
  markBoard(ctx, s.id);
}
