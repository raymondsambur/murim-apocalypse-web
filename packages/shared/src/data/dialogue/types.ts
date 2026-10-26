/**
 * Vocabulary of the rule-based dialogue system (no AI): the tags a handwritten line fragment can carry, the slots it
 * can use, and the input the composer reads. Pure data and types. Server and client share it.
 */
import type { NpcRole, WeatherKind } from '../../simtypes';

export const DLG_TRAITS = ['stern', 'kind', 'greedy', 'boastful', 'weary', 'devout', 'cunning', 'honest', 'gruff', 'cheerful', 'superstitious', 'scholarly'] as const;
export type DlgTrait = (typeof DLG_TRAITS)[number];

export const DLG_ROLES: readonly NpcRole[] = ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'];
export type DlgRole = NpcRole;

/** What the player can ask. `greet` is the line shown when the dialog opens. */
export const DLG_TOPICS = ['greet', 'news', 'town', 'folk', 'me', 'blight', 'work'] as const;
export type DlgTopic = (typeof DLG_TOPICS)[number];
/** Topics a fragment may belong to (`rumor` = a clause about one rumor; `any` = openers and closers). */
export type DlgFragTopic = DlgTopic | 'rumor' | 'any';

export const DLG_TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export type DlgTime = (typeof DLG_TIMES)[number];

export const DLG_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type DlgSeason = (typeof DLG_SEASONS)[number];

export const DLG_WEATHER: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

/** Settlement situations. `calm` is set when none of the others apply. */
export const DLG_STATES = ['siege', 'famine', 'plague', 'festival', 'fallen', 'prosperous', 'struggling', 'blighted', 'calm'] as const;
export type DlgState = (typeof DLG_STATES)[number];

/** How a town regards the asking player. */
export const DLG_STANDINGS = ['unknown', 'noted', 'welcomed', 'honoured', 'feared', 'despised'] as const;
export type DlgStanding = (typeof DLG_STANDINGS)[number];

/** Derived temper of the speaker right now. */
export const DLG_MOODS = ['tired', 'hungry', 'afraid', 'content', 'grieving', 'worried'] as const;
export type DlgMood = (typeof DLG_MOODS)[number];

/** Memory kinds a line may react to (kept in sync with the server's memory kinds). */
export const DLG_DEEDS = [
  'killedBandits',
  'killedHollows',
  'savedTown',
  'deliveredGoods',
  'completedMission',
  'failedMission',
  'duelWon',
  'duelLost',
  'sectFounded',
  'rankUp',
  'gift',
  'insult',
  'purified',
  'sealedHeart',
  'diedNearby',
] as const;
export type DlgDeed = (typeof DLG_DEEDS)[number];

/** Rumor kinds the rumor fragments know how to tell. */
export const DLG_RUMOR_KINDS = [
  'siege',
  'hollowSiege',
  'held',
  'fell',
  'captured',
  'plundered',
  'retaken',
  'famine',
  'famineEnd',
  'plague',
  'plagueEnd',
  'festival',
  'boom',
  'hardTimes',
  'npcDeath',
  'legendRise',
  'legendSeen',
  'newMaster',
  'heartSealed',
  'heartWounded',
  'heartStirs',
  'blightAdvance',
  'blightRecede',
  'roadBlocked',
  'caravan',
  'war',
  'truce',
  'alliance',
  'uprising',
  'refugees',
  'expedition',
  'playerDeed',
  'misc',
] as const;
export type DlgRumorKind = (typeof DLG_RUMOR_KINDS)[number];

/** How sure the teller sounds: `sure` (truth > .72), `hear` (.42-.72), `doubt` (below). */
export const DLG_HEDGES = ['sure', 'hear', 'doubt'] as const;
export type DlgHedge = (typeof DLG_HEDGES)[number];

export type DlgTone = 'warm' | 'curt' | 'grim';
export type DlgPart = 'body' | 'open' | 'close' | 'hedge';

/** Every slot a fragment may use as `{name}`. A fragment is only eligible when all its slots are filled. */
export const DLG_SLOTS = [
  'player',
  'npc',
  'title',
  'settlement',
  'kind',
  'faction',
  'controller',
  'weather',
  'season',
  'time',
  'rank',
  'deed',
  'ago',
  'trade',
  'price',
  'elder',
  'smith',
  'innkeeper',
  'master',
  'merchant',
  'alchemist',
  'guards',
  'folk',
  'rumor.place',
  'rumor.place2',
  'rumor.who',
  'rumor.faction',
  'rumor.faction2',
  'rumor.n',
  'rumor.deed',
  'rumor.age',
  'body',
] as const;
export type DlgSlot = (typeof DLG_SLOTS)[number];
/** Slots the composer always fills. */
export const DLG_ALWAYS_SLOTS: readonly DlgSlot[] = ['player', 'npc', 'settlement', 'weather', 'season', 'time'];

type One<T> = T | readonly T[];

/** Authoring form of a fragment's tags: a single value or a list; every given dimension must match. */
export interface DlgTags {
  role?: One<DlgRole>;
  trait?: One<DlgTrait>;
  weather?: One<WeatherKind>;
  time?: One<DlgTime>;
  season?: One<DlgSeason>;
  state?: One<DlgState>;
  standing?: One<DlgStanding>;
  mood?: One<DlgMood>;
  deed?: One<DlgDeed>;
  rumor?: One<DlgRumorKind>;
  hedge?: One<DlgHedge>;
  about?: 'self' | 'other';
  tone?: DlgTone;
  /** Relative weight inside the same specificity (default 1). */
  w?: number;
}

export interface DlgFragment {
  id: string;
  topic: DlgFragTopic;
  part: DlgPart;
  text: string;
  w: number;
  role?: readonly DlgRole[];
  trait?: readonly DlgTrait[];
  weather?: readonly WeatherKind[];
  time?: readonly DlgTime[];
  season?: readonly DlgSeason[];
  state?: readonly DlgState[];
  standing?: readonly DlgStanding[];
  mood?: readonly DlgMood[];
  deed?: readonly DlgDeed[];
  rumor?: readonly DlgRumorKind[];
  hedge?: readonly DlgHedge[];
  about?: 'self' | 'other';
  tone?: DlgTone;
  /** Slots referenced in `text` (computed at build time). */
  slots: readonly string[];
}

/** A group of lines sharing the same tags: `[tags, ...texts]`. */
export type DlgGroup = readonly [DlgTags, ...string[]];

const arr = <T>(v: One<T> | undefined): readonly T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? (v as readonly T[]) : [v as T]);

const SLOT_RE = /\{([a-z0-9.]+)\}/g;

/** Tone implied by other tags when none is given (so openers and closers match the body's mood). */
const TRAIT_TONE: Partial<Record<DlgTrait, DlgTone>> = { gruff: 'curt', stern: 'curt', kind: 'warm', cheerful: 'warm', weary: 'grim', superstitious: 'grim' };

function inferTone(t: DlgTags): DlgTone | undefined {
  if (t.tone) return t.tone;
  const standing = arr(t.standing);
  if (standing && standing.length === 1) {
    if (standing[0] === 'despised' || standing[0] === 'feared') return 'curt';
    if (standing[0] === 'honoured' || standing[0] === 'welcomed') return 'warm';
  }
  const trait = arr(t.trait);
  if (trait && trait.length === 1 && TRAIT_TONE[trait[0]]) return TRAIT_TONE[trait[0]];
  const state = arr(t.state);
  if (state && state.length === 1) {
    if (state[0] === 'siege' || state[0] === 'blighted' || state[0] === 'plague' || state[0] === 'famine') return 'grim';
    if (state[0] === 'festival' || state[0] === 'prosperous') return 'warm';
  }
  return undefined;
}

/** Expand groups into flat fragments with stable ids (`prefix` + running index; append new lines at the end to keep ids). */
export function buildFragments(topic: DlgFragTopic, part: DlgPart, prefix: string, groups: readonly DlgGroup[]): DlgFragment[] {
  const out: DlgFragment[] = [];
  let n = 0;
  for (const [tags, ...texts] of groups) {
    const tone = part === 'body' || part === 'hedge' ? inferTone(tags) : tags.tone;
    for (const text of texts) {
      const slots = [...text.matchAll(SLOT_RE)].map((m) => m[1]);
      out.push({
        id: `${prefix}${n++}`,
        topic,
        part,
        text,
        w: tags.w ?? 1,
        role: arr(tags.role),
        trait: arr(tags.trait),
        weather: arr(tags.weather),
        time: arr(tags.time),
        season: arr(tags.season),
        state: arr(tags.state),
        standing: arr(tags.standing),
        mood: arr(tags.mood),
        deed: arr(tags.deed),
        rumor: arr(tags.rumor),
        hedge: arr(tags.hedge),
        about: tags.about,
        tone,
        slots: [...new Set(slots)],
      });
    }
  }
  return out;
}

/** Shorthand used by the line files: `g({role:'guard'}, 'line one', 'line two')`. */
export const g = (tags: DlgTags, ...texts: string[]): DlgGroup => [tags, ...texts];

// ---------------------------------------------------------------------------
// Composer input
// ---------------------------------------------------------------------------

export interface DlgDeedRef {
  kind: DlgDeed;
  /** Decayed weight; the strongest deed that matches a line is the one quoted. */
  weight: number;
  /** Hours since it happened (for `{ago}`). */
  ageHours: number;
}

export interface DlgRumorInput {
  kind: DlgRumorKind;
  /** 0..1, how reliable this version of the story is. */
  truth: number;
  /** True when the story is about the player being spoken to. */
  about: 'self' | 'other';
  /** Filled rumor.* slots (rumor.place, rumor.who, rumor.n ...). */
  slots: Partial<Record<string, string>>;
}

/** Recently used fragment ids -> world hour last used. Mutated by `noteUsed`. */
export type DlgRecent = Record<string, number>;

export interface DlgInput {
  topic: DlgFragTopic;
  /** Deterministic seed for this line (callers mix npc id, player id, hour and a counter). */
  seed: number;
  /** World hour (for anti-repeat). */
  hour: number;
  role: DlgRole;
  traits: readonly DlgTrait[];
  weather: WeatherKind;
  time: DlgTime;
  season: DlgSeason;
  states: readonly DlgState[];
  standing: DlgStanding;
  moods: readonly DlgMood[];
  deeds: readonly DlgDeedRef[];
  /** Filled slots (`player`, `settlement`, ... see `DLG_SLOTS`); missing optional slots make fragments that use them ineligible. */
  slots: Partial<Record<string, string>>;
  rumor?: DlgRumorInput;
  recent?: DlgRecent;
  /** Do not reuse a fragment used within this many world hours (default 36). */
  antiRepeatHours?: number;
  /** Probability of adding an opener / closer (defaults 0.42 / 0.3). */
  openChance?: number;
  closeChance?: number;
}

export interface DlgComposed {
  text: string;
  /** Fragment ids used, in order (for anti-repeat bookkeeping and tests). */
  ids: string[];
}
