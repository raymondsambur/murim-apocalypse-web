/**
 * What an activity produced over some interval, how reports merge, and how they read to a player.
 * Reports of workers who are offline are persisted (table `activity_away`) until their next login.
 */
import { getItem, JOB_DEFS, type JobId } from '@murim/shared';

export type EndReason = 'stopped' | 'moved' | 'combat' | 'dead' | 'cap' | 'bag' | 'done' | 'xpfull' | 'invalid';

export interface Report {
  /** Real time worked (ms). */
  ms: number;
  /** Items delivered to the bag (crafted output included). */
  items: Record<string, number>;
  gold: number;
  /** Cultivation XP actually credited to the bar. */
  xp: number;
  /** Cultivation levels gained. */
  levels: number;
  jobXp: Partial<Record<JobId, number>>;
  /** Job -> level reached when it rose. */
  jobLevels: Partial<Record<JobId, number>>;
  /** Craft inputs returned to the bag. */
  refunded: Record<string, number>;
  /** Items that did not fit in the bag and were lost. */
  lost: Record<string, number>;
  ended?: EndReason;
  /** Activity kind this report is about (for wording). */
  kind?: 'train' | 'shift' | 'craft';
}

export function emptyReport(): Report {
  return { ms: 0, items: {}, gold: 0, xp: 0, levels: 0, jobXp: {}, jobLevels: {}, refunded: {}, lost: {} };
}

function addMap(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** Fold `b` into `a` (a is mutated and returned). */
export function mergeReport(a: Report, b: Report): Report {
  a.ms += b.ms;
  a.gold += b.gold;
  a.xp += b.xp;
  a.levels += b.levels;
  addMap(a.items, b.items);
  addMap(a.refunded, b.refunded);
  addMap(a.lost, b.lost);
  addMap(a.jobXp as Record<string, number>, b.jobXp as Record<string, number>);
  Object.assign(a.jobLevels, b.jobLevels);
  if (b.ended) a.ended = b.ended;
  a.kind ??= b.kind;
  return a;
}

export function hasGains(r: Report): boolean {
  return r.gold > 0 || r.xp > 0 || Object.keys(r.items).length > 0 || Object.keys(r.jobXp).length > 0 || Object.keys(r.refunded).length > 0;
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

const stacks = (m: Record<string, number>): string =>
  Object.entries(m)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${n}x ${getItem(id)?.name ?? id}`)
    .join(', ');

/** "12x Qi-Gathering Grass; 40 gold; ..." or '' when nothing was earned. */
export function describeGains(r: Report): string {
  const parts: string[] = [];
  const items = stacks(r.items);
  if (items) parts.push(items);
  if (r.gold > 0) parts.push(`${r.gold} gold`);
  for (const [job, xp] of Object.entries(r.jobXp)) {
    if (!xp) continue;
    const lv = r.jobLevels[job as JobId];
    parts.push(`${xp} ${JOB_DEFS[job as JobId].name} XP${lv ? ` (level ${lv})` : ''}`);
  }
  if (r.xp > 0) parts.push(`${r.xp} cultivation XP${r.levels ? ` (+${r.levels} level${r.levels > 1 ? 's' : ''})` : ''}`);
  const refunded = stacks(r.refunded);
  if (refunded) parts.push(`${refunded} returned`);
  return parts.join('; ');
}

export function describeLost(r: Report): string {
  const l = stacks(r.lost);
  return l ? `Your bag was full: ${l} could not be stored and were lost.` : '';
}

export const END_TEXT: Record<EndReason, string> = {
  stopped: 'You stop what you were doing.',
  moved: 'You leave your work.',
  combat: 'Combat interrupts what you were doing.',
  dead: 'Your work ends with your death.',
  cap: 'Your work ended after the 8-hour limit.',
  bag: 'Your bag is full, so you stopped working.',
  done: 'Your crafting is finished.',
  xpfull: 'Your cultivation has reached its limit for this rank. Seek a Breakthrough.',
  invalid: 'Your work could no longer continue.',
};
