/**
 * The line composer: pure and deterministic. Filters the fragment library by tags, scores by specificity (the more of a
 * fragment's tags match the situation, the better), picks with a seeded RNG, avoids lines used recently, fills `{slots}`
 * and glues opener + body + closer (or hedge + clause + reaction for rumors).
 */
import { Rng, hash32 } from '../../rng';
import { ALL_FRAGMENTS } from './library';
import type { DlgComposed, DlgDeed, DlgDeedRef, DlgFragment, DlgHedge, DlgInput, DlgRecent } from './types';

/** Specificity points per matched tag dimension. */
export const DLG_DIM_SCORE = { role: 3, trait: 2.5, deed: 4, rumor: 5, state: 3, standing: 2.5, weather: 2, time: 1.5, season: 1.5, mood: 1.5, about: 1.5, hedge: 2, tone: 0 } as const;

export const DLG_DEFAULTS = { antiRepeatHours: 36, openChance: 0.3, closeChance: 0.25, hedgeSure: 0.72, hedgeHear: 0.42, specificityPower: 1.7 } as const;

/** Past-tense phrase for `{deed}`, written to follow "you ...". */
export const DEED_PHRASE: Record<DlgDeed, string> = {
  killedBandits: 'cleared the bandits off our roads',
  killedHollows: 'cut down the Hollows at our gates',
  savedTown: 'stood on our walls when the siege came',
  deliveredGoods: 'brought us goods when we needed them most',
  completedMission: 'took on the work nobody else would touch',
  failedMission: 'left a job half done',
  duelWon: 'beat your rival in the duelling ring',
  duelLost: 'took a beating in a duel',
  sectFounded: 'founded a sect of your own',
  rankUp: 'broke through to a higher realm',
  gift: 'gave freely to those in need',
  insult: 'spat on our hospitality',
  purified: 'cleansed the Blight from our fields',
  sealedHeart: 'sealed a Blight heart with your own hands',
  diedNearby: 'fell in the fighting near our walls',
};

/** Third-person phrase for rumors about a deed ("Mu Jinran {phrase}"). */
export const RUMOR_DEED_PHRASE: Record<DlgDeed, string> = {
  killedBandits: 'cleared out a nest of road bandits',
  killedHollows: 'cut down a swarm of Hollows',
  savedTown: 'held a besieged town against all odds',
  deliveredGoods: 'ran a shipment through when nobody else would',
  completedMission: 'finished a job that had defeated others',
  failedMission: 'botched an errand people were counting on',
  duelWon: 'won a duel people are still talking about',
  duelLost: 'lost a duel, and badly',
  sectFounded: 'founded a sect',
  rankUp: 'broke through to a higher realm',
  gift: 'gave away a small fortune to the needy',
  insult: 'insulted a whole town to its face',
  purified: 'cleansed a stretch of Blighted land',
  sealedHeart: 'sealed a Blight heart',
  diedNearby: 'fell in battle, and lived',
};

export function agoWord(ageHours: number): string {
  if (ageHours < 8) return 'only a few hours ago';
  if (ageHours < 30) return 'just the other day';
  if (ageHours < 24 * 6) return 'a few days ago';
  if (ageHours < 24 * 30) return 'not so long ago';
  return 'a good while back';
}

export function hedgeFor(truth: number): DlgHedge {
  return truth > DLG_DEFAULTS.hedgeSure ? 'sure' : truth > DLG_DEFAULTS.hedgeHear ? 'hear' : 'doubt';
}

// ---------------------------------------------------------------------------

interface Pools {
  byKey: Map<string, DlgFragment[]>;
}
let pools: Pools | null = null;
function getPools(): Pools {
  if (!pools) {
    const byKey = new Map<string, DlgFragment[]>();
    for (const f of ALL_FRAGMENTS) {
      const k = `${f.topic}|${f.part}`;
      let list = byKey.get(k);
      if (!list) byKey.set(k, (list = []));
      list.push(f);
    }
    pools = { byKey };
  }
  return pools;
}

interface Candidate {
  f: DlgFragment;
  score: number;
  deed?: DlgDeedRef;
}

const any = <T>(have: readonly T[], want: readonly T[]): boolean => want.some((w) => have.includes(w));

/** Does fragment `f` fit this situation? Returns its specificity score and the deed it would quote, or null. */
export function matchFragment(f: DlgFragment, inp: DlgInput): { score: number; deed?: DlgDeedRef } | null {
  let score = 0;
  let deed: DlgDeedRef | undefined;
  if (f.role) {
    if (!f.role.includes(inp.role)) return null;
    score += DLG_DIM_SCORE.role;
  }
  if (f.trait) {
    if (!any(inp.traits, f.trait)) return null;
    score += DLG_DIM_SCORE.trait;
  }
  if (f.weather) {
    if (!f.weather.includes(inp.weather)) return null;
    score += DLG_DIM_SCORE.weather;
  }
  if (f.time) {
    if (!f.time.includes(inp.time)) return null;
    score += DLG_DIM_SCORE.time;
  }
  if (f.season) {
    if (!f.season.includes(inp.season)) return null;
    score += DLG_DIM_SCORE.season;
  }
  if (f.state) {
    if (!any(inp.states, f.state)) return null;
    score += DLG_DIM_SCORE.state;
  }
  if (f.standing) {
    if (!f.standing.includes(inp.standing)) return null;
    score += DLG_DIM_SCORE.standing;
  }
  if (f.mood) {
    if (!any(inp.moods, f.mood)) return null;
    score += DLG_DIM_SCORE.mood;
  }
  if (f.deed) {
    for (const d of inp.deeds) if (f.deed.includes(d.kind) && (!deed || d.weight > deed.weight)) deed = d;
    if (!deed) return null;
    score += DLG_DIM_SCORE.deed;
  }
  if ((f.part === 'body' && f.topic === 'rumor') || f.rumor) {
    if (!inp.rumor) return null;
    if (f.rumor) {
      if (!f.rumor.includes(inp.rumor.kind)) return null;
      score += DLG_DIM_SCORE.rumor;
    }
    if (f.about) {
      if (f.about !== inp.rumor.about) return null;
      score += DLG_DIM_SCORE.about;
    }
  }
  if (f.hedge) {
    if (!inp.rumor || !f.hedge.includes(hedgeFor(inp.rumor.truth))) return null;
    score += DLG_DIM_SCORE.hedge;
  }
  // Every slot the text uses must be filled.
  for (const s of f.slots) {
    if (s === 'body') continue;
    if (s === 'deed' || s === 'ago') {
      if (!deed && !inp.slots[s]) return null;
      continue;
    }
    if (!inp.slots[s]) return null;
  }
  return { score, deed };
}

function candidates(key: string, inp: DlgInput, recent: DlgRecent | undefined, window: number, tone?: string | null): Candidate[] {
  const list = getPools().byKey.get(key) ?? [];
  const fresh: Candidate[] = [];
  const stale: Candidate[] = [];
  for (const f of list) {
    if (tone !== undefined) {
      // Tone rule for openers / closers: a toneless one fits anything; a toned one needs a body of the same tone.
      if (f.tone && f.tone !== tone) continue;
    }
    const m = matchFragment(f, inp);
    if (!m) continue;
    const c: Candidate = { f, score: m.score, deed: m.deed };
    const last = recent?.[f.id];
    if (last !== undefined && inp.hour - last < window) stale.push(c);
    else fresh.push(c);
  }
  // If everything eligible was used recently, allow repeats rather than staying silent.
  return fresh.length > 0 ? fresh : stale;
}

/** Bodies are picked by specificity (strongly favouring the best fit); openers and closers only mildly (`flat`). */
function pick(cands: Candidate[], rng: Rng, flat = false): Candidate | null {
  if (cands.length === 0) return null;
  let total = 0;
  const ws = cands.map((c) => {
    const w = (flat ? 1 + 0.35 * c.score : Math.pow(0.3 + c.score, DLG_DEFAULTS.specificityPower)) * c.f.w;
    total += w;
    return w;
  });
  let r = rng.next() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= ws[i];
    if (r < 0) return cands[i];
  }
  return cands[cands.length - 1];
}

const ALT_RE = /\[([^[\]|]+(?:\|[^[\]|]+)+)\]/g;

function fill(text: string, slots: Record<string, string | undefined>, rng: Rng): string {
  let out = text.replace(ALT_RE, (_m, body: string) => {
    const opts = body.split('|');
    return opts[Math.floor(rng.next() * opts.length)];
  });
  out = out.replace(/\{([a-z0-9.]+)\}/g, (_m, k: string) => slots[k] ?? '');
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/** Capitalise the first letter, and the first letter after a sentence end (clauses are spliced into hedges and openers). */
export function capFirst(s: string): string {
  const i = s.search(/[A-Za-z]/);
  if (i < 0) return s;
  const head = s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
  return head.replace(/(?<!\.)([.!?])(\s+)([a-z])/g, (_m, p: string, sp: string, c: string) => p + sp + c.toUpperCase());
}

/**
 * Compose one line (or one rumor sentence for topic `rumor`). Returns null when the library has nothing eligible, which the
 * coverage tests make impossible for the real topics. Does not mutate `inp.recent`; call `noteUsed` with the result.
 */
export function composeLine(input: DlgInput): DlgComposed | null {
  // Rumor slots (rumor.place ...) travel inside `rumor.slots`; merge them so matching and filling see one map.
  const inp: DlgInput = input.rumor ? { ...input, slots: { ...input.slots, ...input.rumor.slots } } : input;
  const rng = new Rng(hash32(inp.seed, 0x9e37, inp.topic.length * 131 + inp.role.length));
  const window = inp.antiRepeatHours ?? DLG_DEFAULTS.antiRepeatHours;
  const slots: Record<string, string | undefined> = { ...inp.slots, weather: inp.slots.weather ?? inp.weather, season: inp.slots.season ?? inp.season, time: inp.slots.time ?? inp.time };
  const bodies = candidates(`${inp.topic}|body`, inp, inp.recent, window);
  const body = pick(bodies, rng);
  if (!body) return null;
  const ids = [body.f.id];
  const bodySlots = { ...slots };
  if (body.deed) {
    bodySlots.deed = DEED_PHRASE[body.deed.kind];
    bodySlots.ago = agoWord(body.deed.ageHours);
  }
  let text = fill(body.f.text, bodySlots, rng);

  if (inp.topic === 'rumor' && inp.rumor) {
    const hedges = candidates('rumor|hedge', inp, inp.recent, 6);
    const hedge = pick(hedges, rng, true);
    if (hedge) {
      ids.unshift(hedge.f.id);
      text = fill(hedge.f.text, { ...bodySlots, body: text }, rng);
    }
    if (rng.chance(inp.closeChance ?? 0.5)) {
      const close = pick(candidates('rumor|close', inp, inp.recent, window, body.f.tone ?? null), rng, true);
      if (close) {
        ids.push(close.f.id);
        text += ' ' + fill(close.f.text, bodySlots, rng);
      }
    }
    return { text: capFirst(text), ids };
  }

  const tone = body.f.tone ?? null;
  if (rng.chance(inp.openChance ?? DLG_DEFAULTS.openChance)) {
    const open = pick(candidates('any|open', inp, inp.recent, window, tone), rng, true);
    if (open) {
      ids.unshift(open.f.id);
      text = fill(open.f.text, bodySlots, rng) + ' ' + text;
    }
  }
  if (rng.chance(inp.closeChance ?? DLG_DEFAULTS.closeChance)) {
    const close = pick(candidates('any|close', inp, inp.recent, window, tone), rng, true);
    if (close) {
      ids.push(close.f.id);
      text += ' ' + fill(close.f.text, bodySlots, rng);
    }
  }
  return { text: capFirst(text), ids };
}

/** Record fragment ids as used at `hour`. */
export function noteUsed(recent: DlgRecent, ids: readonly string[], hour: number): void {
  for (const id of ids) recent[id] = hour;
}

/** Forget entries older than `maxAgeHours` so the map stays small. */
export function pruneRecent(recent: DlgRecent, hour: number, maxAgeHours = 24 * 5): void {
  for (const id of Object.keys(recent)) if (hour - recent[id] > maxAgeHours) delete recent[id];
}
