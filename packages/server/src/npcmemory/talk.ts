/**
 * Talking to NPCs: builds the composer input from the live game (settlement situation, weather, time, the player's standing
 * and deeds, the NPC's own traits and the rumors it knows) and returns finished lines. All text comes from the handwritten
 * fragment library in `@murim/shared/data/dialogue`.
 */
import {
  DLG_DEEDS,
  DLG_TRAITS,
  FACTION_BY_ID,
  RUMOR_DEED_PHRASE,
  composeLine,
  hash32,
  noteUsed,
  pruneRecent,
  rankName,
  type DlgDeedRef,
  type DlgInput,
  type DlgMood,
  type DlgRecent,
  type DlgRole,
  type DlgSeason,
  type DlgState,
  type DlgTime,
  type DlgTopic,
  type DlgTrait,
  type NpcState,
  type SettlementView,
  type WeatherKind,
} from '@murim/shared';
import type { GameContext, Player } from '../ctx';
import type { MemoryStore } from './memory';
import { ageWord, numberWord, type RumorFacts, type RumorMill, type Tellable } from './rumors';
import { RUMOR } from './tuning';

export const TALK_TOPICS: readonly { id: Exclude<DlgTopic, 'greet'>; label: string }[] = [
  { id: 'news', label: 'Any news?' },
  { id: 'town', label: 'How is the town?' },
  { id: 'folk', label: 'Who lives here?' },
  { id: 'me', label: 'What do you think of me?' },
  { id: 'blight', label: 'About the Blight' },
  { id: 'work', label: 'About your work' },
];

const WEATHER_WORD: Record<WeatherKind, string> = { clear: 'clear sky', cloudy: 'grey cloud', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
const GOOD_WORD: Record<string, string> = { grain: 'grain', meat: 'game', herb: 'herbs', ore_iron: 'iron ore', hide: 'hides', cloth: 'cloth', wine: 'wine', pill_heal_s: 'tonics' };
const KIND_WORD: Record<string, string> = { village: 'village', hamlet: 'hamlet', town: 'town', fort: 'fort', sectHall: 'sect hall', ruin: 'ruin' };
const SEASONS: readonly DlgSeason[] = ['spring', 'summer', 'autumn', 'winter'];
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export interface TalkDeps {
  ctx: GameContext;
  memory: MemoryStore;
  mill: RumorMill;
}

/** Per (npc, player) conversation state: recent fragments, rumors already told, a counter for fresh seeds. */
interface Convo {
  recent: DlgRecent;
  told: Record<number, number>;
  n: number;
  greeting?: { hour: number; text: string };
}

export class TalkState {
  private readonly convos = new Map<string, Convo>();

  get(npcId: number, charId: number): Convo {
    const key = `${npcId}:${charId}`;
    let c = this.convos.get(key);
    if (!c) {
      c = { recent: {}, told: {}, n: 0 };
      this.convos.set(key, c);
      if (this.convos.size > 1500) this.convos.delete(this.convos.keys().next().value as string);
    }
    return c;
  }

  prune(hour: number): void {
    for (const [k, c] of this.convos) {
      pruneRecent(c.recent, hour);
      for (const id of Object.keys(c.told)) if (hour - c.told[Number(id)] > RUMOR.tellCooldownHours * 3) delete c.told[Number(id)];
      if (Object.keys(c.recent).length === 0 && Object.keys(c.told).length === 0 && !c.greeting) this.convos.delete(k);
    }
  }

  clear(): void {
    this.convos.clear();
  }
}

const isTrait = (t: string): t is DlgTrait => (DLG_TRAITS as readonly string[]).includes(t);
export const traitsOf = (npc: NpcState): DlgTrait[] => npc.traits.filter(isTrait);
export const roleOf = (npc: NpcState): DlgRole => (npc.legend ? 'legend' : npc.role);

function timeOfDay(hour: number): DlgTime {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

export function settlementStates(view: SettlementView): DlgState[] {
  const s: DlgState[] = [];
  if (view.siege || view.status === 'besieged') s.push('siege');
  if (view.flags.includes('famine')) s.push('famine');
  if (view.flags.includes('plague')) s.push('plague');
  if (view.flags.includes('festival')) s.push('festival');
  if (view.status === 'fallen') s.push('fallen');
  if (view.status === 'thriving') s.push('prosperous');
  if (view.status === 'struggling') s.push('struggling');
  if (view.blight >= 50) s.push('blighted');
  if (s.length === 0) s.push('calm');
  return s;
}

function moodsOf(states: readonly DlgState[], time: DlgTime, traits: readonly DlgTrait[]): DlgMood[] {
  const m: DlgMood[] = [];
  if (states.includes('siege') || states.includes('blighted')) m.push('afraid');
  if (states.includes('famine')) m.push('hungry');
  if (states.includes('struggling') || states.includes('plague')) m.push('worried');
  if (states.includes('prosperous') || states.includes('festival')) m.push('content');
  if (time === 'night' || traits.includes('weary')) m.push('tired');
  if (m.length === 0) m.push('content');
  return m;
}

/** "gruff, weary": the subtle line under the NPC's name. */
export function moodLine(npc: NpcState): string {
  return traitsOf(npc).join(', ');
}

export function topicsFor(npc: NpcState): { id: string; label: string }[] {
  void npc;
  return TALK_TOPICS.map((t) => ({ id: t.id, label: t.label }));
}

const name = (ctx: GameContext, id: number | undefined): string | undefined => (id === undefined ? undefined : ctx.world.settlements[id]?.name);
const factionFull = (id: string | undefined): string | undefined => (id && FACTION_BY_ID[id] ? `the ${FACTION_BY_ID[id].name}` : undefined);

/** Slots describing the settlement: roster names, trade, prices. */
function settlementSlots(ctx: GameContext, npc: NpcState, view: SettlementView): Record<string, string> {
  const s: Record<string, string> = {};
  const def = ctx.world.settlements[npc.settlementId];
  s.settlement = def?.name ?? 'this place';
  s.kind = KIND_WORD[def?.kind ?? 'village'] ?? 'village';
  const roster = ctx.sim.npcs(npc.settlementId).filter((n) => n.alive && n.id !== npc.id);
  const first = (role: string): string | undefined => roster.find((n) => n.role === role && !n.legend)?.name;
  const set = (k: string, v: string | undefined): void => {
    if (v) s[k] = v;
  };
  set('elder', first('elder'));
  set('smith', first('smith'));
  set('innkeeper', first('innkeeper'));
  set('master', first('master'));
  set('merchant', first('merchant'));
  set('alchemist', first('alchemist'));
  const guards = roster.filter((n) => n.role === 'guard').length + (npc.role === 'guard' ? 1 : 0);
  if (guards > 0) s.guards = guards < SMALL.length ? SMALL[guards] : String(guards);
  if (view.population > 0) s.folk = String(Math.max(5, Math.round(view.population / 5) * 5));
  if (view.controller && FACTION_BY_ID[view.controller]) s.controller = FACTION_BY_ID[view.controller].short;
  // The settlement's main product and what it costs right now.
  try {
    const st = ctx.sim.state.settlements[npc.settlementId];
    let best: string | undefined;
    let bestV = 0;
    for (const [good, v] of Object.entries(st?.prod ?? {})) {
      if (v > bestV && GOOD_WORD[good]) {
        best = good;
        bestV = v;
      }
    }
    if (best) {
      s.trade = GOOD_WORD[best];
      const m = ctx.sim.priceMult(npc.settlementId, best);
      s.price = m < 0.85 ? 'cheap' : m > 1.25 ? 'dear' : 'fair';
    }
  } catch {
    /* stub sim without economy: leave unset */
  }
  return s;
}

function mergeDeeds(a: readonly DlgDeedRef[], b: readonly DlgDeedRef[], boostB = 1.5): DlgDeedRef[] {
  const m = new Map<string, DlgDeedRef>();
  for (const d of a) m.set(d.kind, d);
  for (const d of b) {
    if (!(DLG_DEEDS as readonly string[]).includes(d.kind)) continue;
    const prev = m.get(d.kind);
    const boosted = { ...d, weight: d.weight * boostB };
    if (!prev || boosted.weight > prev.weight) m.set(d.kind, boosted);
  }
  return [...m.values()].sort((x, y) => y.weight - x.weight);
}

export function buildInput(deps: TalkDeps, p: Player, npc: NpcState, topic: DlgInput['topic'], seed: number, convo: Convo): DlgInput {
  const { ctx, memory } = deps;
  const clock = ctx.sim.clock();
  const view = ctx.sim.settlementView(npc.settlementId);
  const traits = traitsOf(npc);
  const states = settlementStates(view);
  const time = timeOfDay(clock.hour);
  const st = memory.townStanding(npc.settlementId, p.charId, clock.totalHours);
  const recall = memory.recall(npc.id, p.charId, clock.totalHours);
  const slots: Record<string, string> = {
    player: p.name,
    npc: npc.name,
    rank: rankName(p.save.level),
    ...settlementSlots(ctx, npc, view),
  };
  if (npc.title) slots.title = npc.title;
  const faction = npc.faction ? FACTION_BY_ID[npc.faction] : undefined;
  if (faction) slots.faction = faction.short;
  const weather = ctx.sim.weatherAt(npc.homeX, npc.homeY);
  slots.weather = WEATHER_WORD[weather];
  return {
    topic,
    seed,
    hour: clock.totalHours,
    role: roleOf(npc),
    traits,
    weather,
    time,
    season: SEASONS[clock.season % 4],
    states,
    standing: st.standing,
    moods: moodsOf(states, time, traits),
    deeds: mergeDeeds(memory.townDeeds(npc.settlementId, p.charId, clock.totalHours), recall.deeds),
    slots,
    recent: convo.recent,
  };
}

/** Slots for one rumor as this NPC would tell it. */
export function rumorSlots(ctx: GameContext, t: Tellable, hour: number): Record<string, string> {
  const f: RumorFacts = t.facts;
  const out: Record<string, string> = {};
  const set = (k: string, v: string | undefined): void => {
    if (v) out[k] = v;
  };
  set('rumor.place', name(ctx, f.place));
  set('rumor.place2', name(ctx, f.place2));
  set('rumor.who', f.who);
  set('rumor.faction', factionFull(f.faction));
  set('rumor.faction2', factionFull(f.faction2));
  if (f.n !== undefined) out['rumor.n'] = numberWord(f.n);
  if (f.deed) out['rumor.deed'] = RUMOR_DEED_PHRASE[f.deed];
  out['rumor.age'] = ageWord(hour - t.since);
  return out;
}

function nextSeed(npc: NpcState, p: Player, hour: number, convo: Convo): number {
  return hash32(npc.id, p.charId, hour, convo.n++);
}

function used(convo: Convo, ids: readonly string[], hour: number): void {
  noteUsed(convo.recent, ids, hour);
}

/** The greeting shown when the dialog opens (stable within a world hour so menu re-sends do not flicker). */
export function greetingLine(deps: TalkDeps, p: Player, npc: NpcState): string {
  const clock = deps.ctx.sim.clock();
  const convo = talkStateOf(deps).get(npc.id, p.charId);
  if (convo.greeting && convo.greeting.hour === clock.totalHours) return convo.greeting.text;
  const seed = nextSeed(npc, p, clock.totalHours, convo);
  const inp = buildInput(deps, p, npc, 'greet', seed, convo);
  // Deeds colour only some greetings; the rest talk about the day.
  if (inp.standing !== 'unknown' && hash32(seed, 17) % 100 >= 65) inp.deeds = [];
  const out = composeLine(inp);
  const text = out?.text ?? `${npc.name} nods at you.`;
  if (out) used(convo, out.ids, clock.totalHours);
  convo.greeting = { hour: clock.totalHours, text };
  return text;
}

const stateByCtx = new WeakMap<GameContext, TalkState>();
/** Conversation state shared by every talk call of this game context. */
export function talkStateOf(deps: TalkDeps): TalkState {
  let s = stateByCtx.get(deps.ctx);
  if (!s) {
    s = new TalkState();
    stateByCtx.set(deps.ctx, s);
  }
  return s;
}

/** Answer a topic with 1-2 finished lines. */
export function talkLines(deps: TalkDeps, p: Player, npc: NpcState, topic: Exclude<DlgTopic, 'greet'>): string[] {
  const { ctx, mill } = deps;
  const clock = ctx.sim.clock();
  const hour = clock.totalHours;
  const convo = talkStateOf(deps).get(npc.id, p.charId);
  const lines: string[] = [];

  if (topic === 'news') {
    const all = mill.tellable(npc.settlementId, npc.id, hour, p.charId);
    const fresh = all.filter((t) => hour - (convo.told[t.rumor.id] ?? -1e9) >= RUMOR.tellCooldownHours);
    const pool = fresh.length ? fresh : [];
    for (const t of pool) {
      if (lines.length >= 2) break;
      const inp = buildInput(deps, p, npc, 'rumor', nextSeed(npc, p, hour, convo), convo);
      const self = t.rumor.subjectIds.includes(p.charId) || (!!t.facts.who && t.facts.who.toLowerCase() === p.name.toLowerCase());
      inp.rumor = { kind: t.facts.kind, truth: t.truth, about: self ? 'self' : 'other', slots: rumorSlots(ctx, t, hour) };
      const out = composeLine(inp);
      if (!out) continue;
      lines.push(out.text);
      used(convo, out.ids, hour);
      convo.told[t.rumor.id] = hour;
    }
    if (lines.length === 0) {
      const out = composeLine(buildInput(deps, p, npc, 'news', nextSeed(npc, p, hour, convo), convo));
      if (out) {
        lines.push(out.text);
        used(convo, out.ids, hour);
      }
    }
  } else {
    const inp = buildInput(deps, p, npc, topic, nextSeed(npc, p, hour, convo), convo);
    const out = composeLine(inp);
    if (out) {
      lines.push(out.text);
      used(convo, out.ids, hour);
    }
  }
  if (lines.length === 0) lines.push(`${npc.name} shrugs. "Nothing to say about that."`);
  return lines;
}
