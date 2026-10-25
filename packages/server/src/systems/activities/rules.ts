/**
 * Pure rules for activities (training, shifts, crafting). No ctx, no side effects, so the math can be
 * tested as tables. Owner: gameplay-activities. See docs/GAMEPLAY_SPEC.md section 8.
 */
import { JOB_DEFS, OFFLINE_CAP_MS, ORIGINS, SEASON_YIELD, TALENTS, shiftYieldPerHour, type Activity, type JobId } from '@murim/shared';

export const HOUR_MS = 3_600_000;
/** Shift output is simulated in chunks of at most this long so job level-ups and full bags are handled mid-interval. */
export const CHUNK_MS = 60_000;
export const DOJO_TRAIN_MULT = 1.5;
/** A dojo must be this close (tiles) to start training there. */
export const DOJO_RANGE = 6;
export const SHIFT_RANGE = 3;
export const CRAFT_RANGE = 6;
export const MAX_CRAFT_QTY = 20;
/** Stopping a craft within this long of starting the current unit does not forfeit it. */
export const CRAFT_CANCEL_GRACE_MS = 5000;
export const SETTLE_EVERY_MS = 60_000;

export type Carry = Record<string, number>;

/** Last moment (ms epoch) that output can accrue for this activity. */
export function capTime(a: Pick<Activity, 'since'>): number {
  return a.since + OFFLINE_CAP_MS;
}

/** End of the interval to settle at `now`; <= `a.settled` means nothing to do (also covers clock skew). */
export function settleEnd(a: Pick<Activity, 'since'>, now: number): number {
  return Math.min(now, capTime(a));
}

export function capReached(a: Pick<Activity, 'since'>, now: number): boolean {
  return now >= capTime(a);
}

/** Cultivation XP per real hour before sect/talent multipliers: (12 + 2*insight + spirit) x site multiplier. */
export function trainXpPerHour(insight: number, spirit: number, siteMult = 1): number {
  return (12 + 2 * insight + spirit) * siteMult;
}

export function seasonMultFor(job: JobId, season: number): number {
  const table = (SEASON_YIELD as Record<string, number[] | undefined>)[job];
  if (!table) return 1;
  const s = ((Math.floor(season) % 4) + 4) % 4;
  return table[s] ?? 1;
}

/** Job XP multiplier from talents (x1.3) and the origin's job bonus (x1.2). */
export function jobXpMultiplier(talents: readonly string[], origin: string, job: JobId): number {
  let m = 1;
  if (talents.some((t) => TALENTS[t]?.jobXp?.includes(job))) m *= 1.3;
  if (ORIGINS[origin]?.jobBonus === job) m *= 1.2;
  return m;
}

export interface Fractional {
  items: [string, number][];
  gold: number;
  /** Base job XP (before multipliers). */
  xp: number;
}

/** Exact (fractional) shift output for `ms` of work. */
export function shiftOutput(job: JobId, level: number, season: number, ms: number): Fractional {
  const y = shiftYieldPerHour(job, level, seasonMultFor(job, season));
  const h = ms / HOUR_MS;
  return { items: y.items.map(([id, n]) => [id, n * h] as [string, number]), gold: y.gold * h, xp: y.xp * h };
}

/**
 * Add `amount` to the carry under `key` and return the whole units now payable; the fraction stays in the
 * carry. A tiny epsilon keeps values like 0.9999999999 from losing a whole unit to float noise.
 */
export function takeWhole(carry: Carry, key: string, amount: number): number {
  const total = (carry[key] ?? 0) + Math.max(0, amount);
  const whole = Math.floor(total + 1e-9);
  const rest = total - whole;
  if (rest > 1e-9) carry[key] = rest;
  else delete carry[key];
  return whole;
}

/** Whole crafting units finished in `ms`, limited by the units remaining. */
export function craftUnits(ms: number, seconds: number, remaining: number): number {
  if (ms <= 0 || seconds <= 0) return 0;
  return Math.max(0, Math.min(remaining, Math.floor(ms / (seconds * 1000))));
}

/** Longest batch (units) of a recipe that fits inside the activity time limit. */
export function maxCraftQty(seconds: number): number {
  return Math.min(MAX_CRAFT_QTY, Math.floor(OFFLINE_CAP_MS / (Math.max(1, seconds) * 1000)));
}

export function isGatherJob(job: JobId): boolean {
  return JOB_DEFS[job].mode === 'gather';
}

export function cloneCarry(c: Carry | undefined): Carry {
  return c ? { ...c } : {};
}
