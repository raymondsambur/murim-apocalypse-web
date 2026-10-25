/**
 * Reading and steering the sim's outcome. The sim rolls it once, when the siege ends (settlements.ts `endSiege`):
 * `defense * U(0.82, 1.18) + walls >= siegeStrength` holds the town. We cannot see that roll in advance, but we know
 * its distribution exactly, so the battle leans towards the likely result while it is undecided and plays the real
 * result out as the finale as soon as the sim has rolled it.
 */
import type { SimEvent } from '@murim/shared';

/** The sim's roll bounds (see `endSiege`). Keep in sync with sim/settlements.ts. */
export const ROLL_LOW = 0.82;
export const ROLL_HIGH = 1.18;
/** Fortresses and sect halls add this to the defense roll. */
export const WALL_BONUS = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function wallBonus(kind: string): number {
  return kind === 'fort' || kind === 'sectHall' ? WALL_BONUS : 0;
}

/** Probability that the town holds if the siege ended now. */
export function holdChance(defense: number, walls: number, strength: number): number {
  const need = strength - walls;
  if (need <= 0) return 1;
  if (defense <= 0) return 0;
  return clamp((defense * ROLL_HIGH - need) / (defense * (ROLL_HIGH - ROLL_LOW)), 0, 1);
}

/** Battle momentum in [-1, 1]: +1 = the defence dominates, -1 = the raiders do. */
export function momentum(pHold: number): number {
  return clamp((pHold - 0.5) * 2, -1, 1);
}

export type Outcome = 'held' | 'fell' | 'captured' | 'plundered';

/** Did the raiders win? */
export const raidersWon = (o: Outcome): boolean => o !== 'held';

export interface SettlementSnapshot {
  controller: string | null;
  status: string;
}

/**
 * What happened when the siege ended, from the settlement state before / after and the chronicle lines of that hour
 * (the only place a plunder shows: the sim does not change the controller for it).
 */
export function classifyEnd(before: SettlementSnapshot, after: SettlementSnapshot, events: readonly SimEvent[], sid: number): Outcome {
  if (after.status === 'fallen') return 'fell';
  if (after.controller !== before.controller && after.controller !== null) return 'captured';
  for (const ev of events) {
    if (ev.k === 'chron' && ev.entry.settlementId === sid && /plunder|ransack|looted/i.test(ev.entry.text)) return 'plundered';
  }
  return 'held';
}
