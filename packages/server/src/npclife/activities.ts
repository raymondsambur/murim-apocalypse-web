/**
 * Activities, the default schedule table by role, and the utility scoring that turns
 * (schedule + needs + traits + weather + settlement mood) into a choice.
 *
 * To add an activity: add its id to `ActivityId`, a row to `ACTIVITIES` (cue, entity state, duration, need
 * effects), a score in `scoreAll`, and a place rule in `resolvePlan` (life.ts). Optionally give it weights
 * in `SCHEDULE`.
 */
import type { EntityState, NpcAct, NpcRole, NpcState } from '@murim/shared';
import { NPCLIFE_TUNING } from './tuning';

export type ActivityId =
  | 'sleep'
  | 'eat'
  | 'work'
  | 'socialise'
  | 'pray'
  | 'sweep'
  | 'train'
  | 'trade'
  | 'patrol'
  | 'wander'
  | 'rest'
  | 'shelter'
  | 'hide'
  | 'mourn'
  | 'celebrate'
  | 'mope'
  | 'muster';

export const ACTIVITY_IDS: readonly ActivityId[] = ['sleep', 'eat', 'work', 'socialise', 'pray', 'sweep', 'train', 'trade', 'patrol', 'wander', 'rest', 'shelter', 'hide', 'mourn', 'celebrate', 'mope', 'muster'];

export interface Needs {
  hunger: number;
  rest: number;
  company: number;
  devotion: number;
  /** 0 calm .. 1 under threat (derived from the settlement's state at each decision). */
  safety: number;
  /** Pressure to be at the workplace during working hours. */
  duty: number;
}

export function freshNeeds(): Needs {
  return { hunger: 0.3, rest: 0.2, company: 0.3, devotion: 0.2, safety: 0, duty: 0 };
}

export interface ActivityDef {
  id: ActivityId;
  /** The `NpcAct` cue shown while standing and doing it (undefined = chosen per plan, e.g. `work` -> farm / forge / brew...). */
  cue?: NpcAct;
  /** `entity.state` while doing it. */
  state: EntityState;
  /** Duration range, world hours. */
  hours: readonly [number, number];
  /** Net change of the needs per world hour while doing it (on top of the base drift, see `NEED_BASE`). */
  net: Partial<Record<'hunger' | 'rest' | 'company' | 'devotion' | 'duty', number>>;
}

export const ACTIVITIES: Record<ActivityId, ActivityDef> = {
  sleep: { id: 'sleep', state: 'idle', hours: [4, 10], net: { hunger: 0.03, rest: -0.17, company: 0.01, devotion: 0.01, duty: 0 } },
  eat: { id: 'eat', cue: 'eat', state: 'idle', hours: [0.35, 0.7], net: { hunger: -1.5 } },
  work: { id: 'work', state: 'work', hours: [1.5, 3], net: { duty: -0.5, rest: 0.07 } },
  socialise: { id: 'socialise', cue: 'chat', state: 'idle', hours: [0.4, 0.9], net: { company: -1.5 } },
  pray: { id: 'pray', cue: 'pray', state: 'idle', hours: [0.3, 0.6], net: { devotion: -2 } },
  sweep: { id: 'sweep', cue: 'sweep', state: 'work', hours: [0.3, 0.7], net: { duty: -0.15 } },
  train: { id: 'train', cue: 'train', state: 'work', hours: [1, 2], net: { duty: -0.4, rest: 0.09 } },
  trade: { id: 'trade', cue: 'trade', state: 'work', hours: [1.5, 3], net: { duty: -0.5 } },
  patrol: { id: 'patrol', cue: 'guard', state: 'work', hours: [0.3, 0.8], net: { duty: -0.5, rest: 0.07 } },
  wander: { id: 'wander', state: 'idle', hours: [0.2, 0.5], net: {} },
  rest: { id: 'rest', cue: 'rest', state: 'idle', hours: [0.5, 1.1], net: { rest: -0.4 } },
  shelter: { id: 'shelter', cue: 'shelter', state: 'idle', hours: [0.7, 1.5], net: {} },
  hide: { id: 'hide', state: 'idle', hours: [1, 2], net: { rest: -0.05 } },
  mourn: { id: 'mourn', cue: 'mourn', state: 'idle', hours: [1.2, 2.6], net: { company: -0.4, devotion: -0.3 } },
  celebrate: { id: 'celebrate', cue: 'celebrate', state: 'idle', hours: [0.7, 1.6], net: { company: -1, duty: -0.2 } },
  mope: { id: 'mope', cue: 'rest', state: 'idle', hours: [1, 2], net: { company: -0.25 } },
  muster: { id: 'muster', cue: 'patrol', state: 'work', hours: [1, 2], net: { duty: -0.5 } },
};

export type ScheduleKey = 'villager' | 'guardDay' | 'guardNight' | 'artisan' | 'merchant' | 'innkeeper' | 'master' | 'elder' | 'legend' | 'wanderer';

export function scheduleKey(role: NpcRole, shift: 0 | 1): ScheduleKey {
  switch (role) {
    case 'guard':
      return shift === 0 ? 'guardDay' : 'guardNight';
    case 'smith':
    case 'alchemist':
    case 'physician':
      return 'artisan';
    case 'merchant':
      return 'merchant';
    case 'innkeeper':
      return 'innkeeper';
    case 'master':
      return 'master';
    case 'elder':
      return 'elder';
    case 'legend':
      return 'legend';
    case 'wanderer':
      return 'wanderer';
    default:
      return 'villager';
  }
}

type W = Partial<Record<ActivityId, number>>;
type Seg = readonly [from: number, to: number, weights: W];

/** Default day by role: world hour ranges (0..24, end exclusive) -> base weight per activity. Day starts 06:00. */
export const SCHEDULE: Record<ScheduleKey, readonly Seg[]> = {
  villager: [
    [0, 5, { sleep: 1.6 }],
    [5, 6, { sleep: 0.6, sweep: 0.5, eat: 0.5 }],
    [6, 7, { eat: 0.9, sweep: 0.6, work: 0.6, pray: 0.15 }],
    [7, 12, { work: 1.1, socialise: 0.25, pray: 0.1, sweep: 0.15 }],
    [12, 13.5, { eat: 1.0, socialise: 0.55, rest: 0.3 }],
    [13.5, 17, { work: 1.0, socialise: 0.3, sweep: 0.2 }],
    [17, 18, { pray: 0.5, socialise: 0.6, sweep: 0.4, eat: 0.3 }],
    [18, 19.5, { eat: 1.0, socialise: 0.5 }],
    [19.5, 21, { socialise: 0.7, pray: 0.35, wander: 0.25, rest: 0.4 }],
    [21, 22, { sleep: 1.0, socialise: 0.3 }],
    [22, 24, { sleep: 1.6 }],
  ],
  guardDay: [
    [0, 5, { sleep: 1.6 }],
    [5, 6, { sleep: 0.5, eat: 0.8, patrol: 0.5 }],
    [6, 12, { patrol: 1.1, train: 0.35, sweep: 0.1 }],
    [12, 13, { eat: 1.0, socialise: 0.4, rest: 0.3 }],
    [13, 19, { patrol: 1.0, train: 0.4, sweep: 0.15, socialise: 0.2 }],
    [19, 20, { eat: 1.0, socialise: 0.3 }],
    [20, 21, { socialise: 0.4, rest: 0.5, sleep: 0.4 }],
    [21, 24, { sleep: 1.6 }],
  ],
  guardNight: [
    [0, 1, { patrol: 1.1, eat: 0.4 }],
    [1, 6, { patrol: 1.1, rest: 0.2 }],
    [6, 7, { eat: 1.0, patrol: 0.5 }],
    [7, 8, { socialise: 0.3, rest: 0.5, sleep: 0.8 }],
    [8, 15, { sleep: 1.6 }],
    [15, 16, { sleep: 0.5, eat: 0.9, sweep: 0.3 }],
    [16, 18, { train: 0.5, socialise: 0.4, rest: 0.3, eat: 0.3 }],
    [18, 19, { eat: 1.0, train: 0.3, pray: 0.2 }],
    [19, 24, { patrol: 1.1, eat: 0.2 }],
  ],
  artisan: [
    [0, 5, { sleep: 1.6 }],
    [5, 6.5, { sleep: 0.6, eat: 0.6, sweep: 0.5 }],
    [6.5, 7.5, { sweep: 0.7, eat: 0.6, work: 0.6 }],
    [7.5, 12, { work: 1.2, socialise: 0.15 }],
    [12, 13, { eat: 1.0, socialise: 0.5, rest: 0.3 }],
    [13, 18, { work: 1.2, socialise: 0.15 }],
    [18, 19, { sweep: 0.7, eat: 0.5, work: 0.3 }],
    [19, 20.5, { eat: 1.0, socialise: 0.6 }],
    [20.5, 22, { socialise: 0.5, rest: 0.5, pray: 0.2, sleep: 0.5 }],
    [22, 24, { sleep: 1.6 }],
  ],
  merchant: [
    [0, 5, { sleep: 1.6 }],
    [5, 6.5, { sleep: 0.6, eat: 0.6, sweep: 0.5 }],
    [6.5, 7.5, { sweep: 0.9, eat: 0.6, trade: 0.5 }],
    [7.5, 12, { trade: 1.2, socialise: 0.2 }],
    [12, 13, { eat: 1.0, socialise: 0.5 }],
    [13, 18, { trade: 1.2, socialise: 0.2 }],
    [18, 19, { sweep: 0.8, eat: 0.5, trade: 0.3 }],
    [19, 20.5, { eat: 1.0, socialise: 0.6 }],
    [20.5, 22, { socialise: 0.5, rest: 0.5, pray: 0.2, sleep: 0.5 }],
    [22, 24, { sleep: 1.6 }],
  ],
  // The innkeeper stays open until late and sleeps in the small hours.
  innkeeper: [
    [0, 1, { work: 0.7, socialise: 0.35 }],
    [1, 6, { sleep: 1.7 }],
    [6, 7, { sweep: 0.9, eat: 0.6, work: 0.4 }],
    [7, 9, { work: 1.0, sweep: 0.4 }],
    [9, 12, { work: 1.1, socialise: 0.2 }],
    [12, 13.5, { work: 1.0, eat: 0.8 }],
    [13.5, 15, { eat: 0.9, rest: 0.5, work: 0.5 }],
    [15, 18, { work: 1.1, socialise: 0.3 }],
    [18, 19.5, { work: 0.9, eat: 1.0, socialise: 0.3 }],
    [19.5, 24, { work: 1.1, socialise: 0.4 }],
  ],
  master: [
    [0, 5, { sleep: 1.6 }],
    [5, 6, { pray: 0.6, train: 0.7, sleep: 0.4 }],
    [6, 7, { eat: 0.9, train: 0.6 }],
    [7, 12, { train: 1.0, work: 0.5, pray: 0.1, socialise: 0.15 }],
    [12, 13, { eat: 1.0, rest: 0.3, socialise: 0.3 }],
    [13, 17, { train: 0.8, work: 0.7, socialise: 0.25 }],
    [17, 18, { pray: 0.5, socialise: 0.4, sweep: 0.3 }],
    [18, 19.5, { eat: 1.0, socialise: 0.4 }],
    [19.5, 21, { pray: 0.45, socialise: 0.5, rest: 0.4, train: 0.3 }],
    [21, 22, { sleep: 1.0 }],
    [22, 24, { sleep: 1.6 }],
  ],
  elder: [
    [0, 5, { sleep: 1.7 }],
    [5, 6.5, { sleep: 0.5, pray: 0.5, eat: 0.5 }],
    [6.5, 7.5, { eat: 0.9, sweep: 0.3 }],
    [7.5, 12, { work: 1.0, socialise: 0.55, pray: 0.2 }],
    [12, 13.5, { eat: 1.0, rest: 0.5, socialise: 0.4 }],
    [13.5, 17.5, { work: 0.9, socialise: 0.5, pray: 0.3, rest: 0.3 }],
    [17.5, 19, { pray: 0.6, eat: 0.7, socialise: 0.5 }],
    [19, 20.5, { eat: 0.8, socialise: 0.6, pray: 0.3 }],
    [20.5, 22, { sleep: 1.2, rest: 0.4 }],
    [22, 24, { sleep: 1.7 }],
  ],
  // Legends keep to their hermitage: they train, pray and rest there, and come down only for the evening and festivals.
  legend: [
    [0, 5, { sleep: 1.6 }],
    [5, 6.5, { pray: 0.8, train: 0.6, sleep: 0.3 }],
    [6.5, 7.5, { eat: 0.9, train: 0.5, sweep: 0.2 }],
    [7.5, 12, { train: 1.0, pray: 0.25, rest: 0.35, sweep: 0.1 }],
    [12, 13, { eat: 1.0, rest: 0.4 }],
    [13, 17.5, { train: 0.8, pray: 0.3, rest: 0.45, wander: 0.1 }],
    [17.5, 19, { eat: 1.0, socialise: 0.5, pray: 0.2, wander: 0.2 }],
    [19, 21.5, { socialise: 0.9, pray: 0.2, rest: 0.4, wander: 0.25 }],
    [21.5, 22, { sleep: 1.0, socialise: 0.3 }],
    [22, 24, { sleep: 1.6 }],
  ],
  wanderer: [
    [0, 5, { sleep: 1.6 }],
    [5, 6, { pray: 0.6, train: 0.6, sleep: 0.4 }],
    [6, 7, { eat: 0.9, train: 0.5, wander: 0.3 }],
    [7, 12, { train: 0.8, wander: 0.5, socialise: 0.45, pray: 0.2, rest: 0.3 }],
    [12, 13.5, { eat: 1.0, socialise: 0.6 }],
    [13.5, 18, { wander: 0.6, socialise: 0.6, train: 0.5, rest: 0.4 }],
    [18, 19.5, { eat: 1.0, socialise: 0.6 }],
    [19.5, 22, { socialise: 0.8, pray: 0.3, rest: 0.5, wander: 0.2 }],
    [22, 24, { sleep: 1.5 }],
  ],
};

/** Base weight of `act` for a schedule key at a (possibly personal-offset) hour of day. */
export function schedWeight(key: ScheduleKey, hour: number, act: ActivityId): number {
  const h = ((hour % 24) + 24) % 24;
  for (const [from, to, w] of SCHEDULE[key]) if (h >= from && h < to) return w[act] ?? 0;
  return 0;
}

/** Base drift of the needs (per world hour) when the activity does not override it. */
export function needNet(act: ActivityId, need: 'hunger' | 'rest' | 'company' | 'devotion' | 'duty'): number {
  const over = ACTIVITIES[act].net[need];
  return over !== undefined ? over : NPCLIFE_TUNING.needs[need];
}

/** Advance the needs by `dtHours` while `act` (or nothing) was going on. */
export function advanceNeeds(n: Needs, act: ActivityId | null, dtHours: number, traits: ReadonlySet<string>): void {
  const dt = Math.min(NPCLIFE_TUNING.needsMaxDt, Math.max(0, dtHours));
  if (dt <= 0) return;
  const a = act ?? 'wander';
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  n.hunger = clamp(n.hunger + needNet(a, 'hunger') * dt);
  n.rest = clamp(n.rest + needNet(a, 'rest') * dt);
  n.company = clamp(n.company + needNet(a, 'company') * dt * (traits.has('cheerful') ? 1.25 : traits.has('gruff') ? 0.7 : 1));
  n.devotion = clamp(n.devotion + needNet(a, 'devotion') * dt * (traits.has('devout') ? 1.6 : traits.has('superstitious') ? 1.2 : 1));
  n.duty = clamp(n.duty + needNet(a, 'duty') * dt);
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

export interface Mood {
  siege: boolean;
  blightAlarm: boolean;
  famine: boolean;
  festival: boolean;
  /** 0..1 how bad the weather is for being outside. */
  rain: number;
}

export interface ScoreInput {
  role: NpcRole;
  key: ScheduleKey;
  traits: ReadonlySet<string>;
  needs: Needs;
  /** Personal hour of day (world hour + personal offset). */
  hour: number;
  mood: Mood;
  /** 0 soft .. 1 hardy: how little the weather bothers this NPC. */
  hardy: number;
  old: boolean;
  /** Stable 0..1 per NPC, for "x% of the village" splits. */
  roll: number;
  mournPending: boolean;
}

const CIVILIAN_HIDERS: ReadonlySet<NpcRole> = new Set(['villager', 'merchant', 'smith', 'alchemist', 'innkeeper', 'elder', 'physician', 'wanderer']);

/** Utility score of every activity. `noise()` returns small random jitter. */
export function scoreAll(i: ScoreInput, noise: () => number): Record<ActivityId, number> {
  const s = (a: ActivityId) => schedWeight(i.key, i.hour, a);
  const t = (x: string) => i.traits.has(x);
  const { needs: n, mood: m } = i;
  const R = m.rain;
  const alarm = m.siege || m.blightAlarm;
  const civilian = CIVILIAN_HIDERS.has(i.role);
  const fighter = i.role === 'guard' || i.role === 'master' || i.role === 'legend';
  const outdoor = R * (0.9 - 0.3 * i.hardy);
  const out = {} as Record<ActivityId, number>;

  out.sleep = s('sleep') + n.rest * 0.55 + (t('weary') ? 0.2 : 0) + (i.old ? 0.1 : 0);
  out.eat = s('eat') + n.hunger * 1.5 - (n.hunger < 0.3 ? 1.3 : 0);
  out.work = s('work') + n.duty * 0.5 + (t('greedy') ? 0.15 : 0) + (t('honest') ? 0.1 : 0) - outdoor * (i.role === 'villager' ? 1 : 0.35) - (m.famine ? 0.4 : 0) - (i.old ? 0.1 : 0);
  out.trade = s('trade') + n.duty * 0.4 + (t('greedy') ? 0.2 : 0) - outdoor * 0.4 - (m.famine ? 0.4 : 0);
  out.socialise =
    s('socialise') + n.company * 1.2 + (t('cheerful') ? 0.25 : 0) + (t('kind') ? 0.1 : 0) + (t('boastful') ? 0.1 : 0) - (t('gruff') ? 0.3 : 0) - (t('stern') ? 0.15 : 0) - outdoor * 0.6;
  out.pray = s('pray') + n.devotion * 0.9 + (t('devout') ? 0.4 : 0) + (t('superstitious') ? 0.15 : 0) - outdoor * 0.4;
  out.sweep = s('sweep') - (t('weary') ? 0.1 : 0) + (t('kind') ? 0.05 : 0) - outdoor;
  out.train = s('train') + (t('boastful') ? 0.15 : 0) + (t('stern') ? 0.1 : 0) - outdoor * 0.5;
  out.patrol = s('patrol') + n.duty * 0.3 - outdoor * 0.25;
  out.wander = 0.15 + s('wander') + (t('cheerful') ? 0.05 : 0) - outdoor * 1.2;
  out.rest = s('rest') + n.rest * 0.5 + (t('weary') ? 0.2 : 0) + (i.old ? 0.2 : 0) - outdoor * 0.5;

  // Reactions to the weather and to the settlement's state.
  const guardish = i.role === 'guard';
  out.shelter = R > 0.2 ? R * (1.5 - 0.9 * i.hardy) * (guardish ? 0.3 : i.role === 'innkeeper' ? 0.2 : i.role === 'merchant' ? 0.5 : 1) : -9;
  out.hide = alarm && civilian ? (m.siege ? 4 : i.roll < NPCLIFE_TUNING.blightHideShare ? 2.2 : -9) : -9;
  out.muster = alarm ? (guardish ? 4.2 : i.role === 'master' || i.role === 'legend' ? (m.siege ? 2.6 : 1.5) : -9) : -9;
  out.celebrate = m.festival && !alarm ? (guardish ? 0.5 : 1.6) + (t('cheerful') ? 0.2 : 0) + (t('boastful') ? 0.15 : 0) - (t('stern') ? 0.2 : 0) - (t('gruff') ? 0.1 : 0) : -9;
  out.mope = m.famine && !alarm && !fighter && i.role !== 'innkeeper' && i.hour >= 8 && i.hour < 20 ? 1.35 + (t('weary') ? 0.1 : 0) - (t('cheerful') ? 0.1 : 0) : -9;
  out.mourn = i.mournPending ? 3 : -9;

  // Nobody sits about outdoors in the small hours: they sleep indoors or stay on their feet.
  const night = ((i.hour % 24) + 24) % 24;
  if (night >= 21 || night < 6) out.rest = -9;
  if (alarm) {
    // Nobody lingers over breakfast with the gates under attack.
    out.sleep *= 0.5;
    out.socialise -= 0.5;
    out.wander -= 0.3;
  }
  for (const k of ACTIVITY_IDS) out[k] += noise();
  return out;
}

/** Hour of day at which this NPC wakes (personal), for the length of a sleep. */
export function wakeHour(key: ScheduleKey, traits: ReadonlySet<string>, old: boolean, phase: number): number {
  const base = key === 'guardNight' ? 15 : key === 'innkeeper' ? 6.5 : key === 'elder' ? 5.5 : 5.4;
  return base + phase + (traits.has('devout') ? -0.4 : 0) + (traits.has('weary') ? 0.4 : 0) + (old ? -0.4 : 0);
}

export function isCivilianRole(role: NpcRole): boolean {
  return CIVILIAN_HIDERS.has(role);
}

export function isOldNpc(npc: NpcState): boolean {
  return npc.age >= 60;
}
