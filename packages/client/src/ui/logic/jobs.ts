/** Pure rules behind the Jobs & Crafting panel: activity timing, output estimates, recipe affordability, site hints. */
import {
  JOB_DEFS,
  OFFLINE_CAP_MS,
  RECIPES,
  SEASON_YIELD,
  getItem,
  jobXpToNext,
  shiftYieldPerHour,
  type Activity,
  type ItemStack,
  type JobId,
  type RecipeView,
  type SettlementDef,
  type SiteView,
} from '@murim/shared';

export const HOUR_MS = 3_600_000;
/** Server rules (systems/activities/rules.ts): keep in sync. */
export const SHIFT_RANGE = 3;
export const CRAFT_RANGE = 6;
export const DOJO_RANGE = 6;
export const MAX_CRAFT_QTY = 20;
export const TRAIN_DOJO_MULT = 1.5;

export const JOB_ORDER: JobId[] = ['herbalist', 'miner', 'farmer', 'blacksmith', 'alchemist'];

export function seasonMult(job: JobId, season: number): number {
  const table = (SEASON_YIELD as Record<string, number[] | undefined>)[job];
  return table ? (table[((Math.floor(season) % 4) + 4) % 4] ?? 1) : 1;
}

export interface ElapsedInfo {
  /** ms of work so far, clamped to the offline cap. */
  workedMs: number;
  /** ms until the activity ends by the 8 h cap. */
  remainingMs: number;
  capped: boolean;
  deadline: number;
}

export function elapsedInfo(a: Pick<Activity, 'since'>, now: number): ElapsedInfo {
  const deadline = a.since + OFFLINE_CAP_MS;
  const workedMs = Math.max(0, Math.min(now, deadline) - a.since);
  return { workedMs, remainingMs: Math.max(0, deadline - now), capped: now >= deadline, deadline };
}

export interface ShiftEstimate {
  items: [string, number][];
  gold: number;
  xp: number;
}

/** Expected output of `ms` of shift work (fractional; whole units are what you actually get). */
export function shiftEstimate(job: JobId, level: number, season: number, ms: number): ShiftEstimate {
  const y = shiftYieldPerHour(job, level, seasonMult(job, season));
  const hrs = Math.max(0, ms) / HOUR_MS;
  return { items: y.items.map(([id, n]) => [id, n * hrs] as [string, number]), gold: y.gold * hrs, xp: y.xp * hrs };
}

/** Per-hour yield for display, rounded sensibly. */
export function shiftPerHour(job: JobId, level: number, season: number): ShiftEstimate {
  return shiftEstimate(job, level, season, HOUR_MS);
}

/** Cultivation XP per real hour while training: (12 + 2 insight + spirit) x site multiplier. */
export function trainXpPerHour(insight: number, spirit: number, dojo: boolean): number {
  return (12 + 2 * insight + spirit) * (dojo ? TRAIN_DOJO_MULT : 1);
}

export interface CraftProgress {
  done: number;
  remaining: number;
  /** 0..1 progress through the unit being worked on. */
  unit: number;
  secondsPerUnit: number;
  etaMs: number;
}

export function craftProgress(a: Extract<Activity, { kind: 'craft' }>, now: number): CraftProgress | null {
  const r = RECIPES[a.recipe];
  if (!r) return null;
  const per = r.seconds * 1000;
  const sinceSettled = Math.max(0, now - a.settled);
  const extraDone = Math.min(a.remaining, Math.floor(sinceSettled / per));
  const remaining = a.remaining - extraDone;
  const unit = remaining > 0 ? Math.min(1, (sinceSettled - extraDone * per) / per) : 1;
  const total = a.remaining; // units outstanding at `settled`
  return { done: extraDone, remaining, unit, secondsPerUnit: r.seconds, etaMs: Math.max(0, total * per - sinceSettled) };
}

export function bagCount(inv: readonly ItemStack[], id: string): number {
  let n = 0;
  for (const s of inv) if (s.id === id) n += s.qty;
  return n;
}

export interface Affordability {
  /** Largest quantity the bag supports (ignores level / position / time cap). */
  maxByItems: number;
  /** Largest quantity allowed by the 8 h work window and the 20 unit cap. */
  maxByTime: number;
  max: number;
  missing: { id: string; need: number; have: number }[];
}

export function maxCraftQty(seconds: number): number {
  return Math.max(0, Math.min(MAX_CRAFT_QTY, Math.floor(OFFLINE_CAP_MS / (Math.max(1, seconds) * 1000))));
}

export function recipeAffordability(r: Pick<RecipeView, 'inputs' | 'seconds'>, inv: readonly ItemStack[], qty = 1): Affordability {
  let maxByItems = Infinity;
  const missing: Affordability['missing'] = [];
  for (const [id, n] of r.inputs) {
    const have = bagCount(inv, id);
    maxByItems = Math.min(maxByItems, Math.floor(have / Math.max(1, n)));
    if (have < n * qty) missing.push({ id, need: n * qty, have });
  }
  if (!Number.isFinite(maxByItems)) maxByItems = 0;
  const maxByTime = maxCraftQty(r.seconds);
  return { maxByItems, maxByTime, max: Math.min(maxByItems, maxByTime), missing };
}

export function itemName(id: string): string {
  return getItem(id)?.name ?? id;
}

export interface JobCardModel {
  id: JobId;
  level: number;
  xp: number;
  xpNext: number;
  maxed: boolean;
}

export function jobCard(job: JobId, st: { lv: number; xp: number } | undefined, maxLevel: number): JobCardModel {
  const level = st?.lv ?? 1;
  const maxed = level >= maxLevel;
  return { id: job, level, xp: st?.xp ?? 0, xpNext: maxed ? 0 : jobXpToNext(level), maxed };
}

export function jobMode(job: JobId): 'gather' | 'craft' {
  return JOB_DEFS[job].mode;
}

export function nearestSettlement(settlements: readonly SettlementDef[], x: number, y: number): { s: SettlementDef; d: number; inside: boolean } | null {
  let best: { s: SettlementDef; d: number; inside: boolean } | null = null;
  for (const s of settlements) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (!best || d < best.d) best = { s, d, inside: d <= s.radius };
  }
  return best;
}

export type SiteAction = { kind: 'train' } | { kind: 'shift'; job: JobId } | { kind: 'craft'; job: JobId };

export interface SiteModel {
  site: SiteView;
  distance: number;
  /** i18n key suffix of the site's kind. */
  action: SiteAction | null;
  range: number;
  inRange: boolean;
  /** Reason it cannot be started right now (i18n key + params), or null. */
  blocked: { key: string; params?: Record<string, string | number> } | null;
}

/** What can be done at a site, and what stops it. `jobLevels` is `me.c.jobs`. */
export function siteModel(site: SiteView, pos: { x: number; y: number } | null, busy: boolean, inCombat: boolean): SiteModel {
  const distance = pos ? Math.hypot(site.x - pos.x, site.y - pos.y) : Infinity;
  let action: SiteAction | null = null;
  let range = SHIFT_RANGE;
  if (site.kind === 'dojo') {
    action = { kind: 'train' };
    range = DOJO_RANGE;
  } else if (site.job) {
    const mode = JOB_DEFS[site.job].mode;
    action = mode === 'gather' ? { kind: 'shift', job: site.job } : { kind: 'craft', job: site.job };
    range = mode === 'gather' ? SHIFT_RANGE : CRAFT_RANGE;
  }
  const inRange = distance <= range;
  let blocked: SiteModel['blocked'] = null;
  if (!action) blocked = { key: 'jobs.site.none' };
  else if (inCombat) blocked = { key: 'jobs.why.combat' };
  else if (busy && action.kind !== 'craft') blocked = { key: 'jobs.why.busy' };
  else if (!inRange && action.kind !== 'craft') blocked = { key: 'jobs.why.far', params: { n: Math.ceil(distance - range) } };
  return { site, distance, action, range, inRange, blocked };
}

export function sortSites(models: SiteModel[]): SiteModel[] {
  return [...models].sort((a, b) => a.distance - b.distance);
}
