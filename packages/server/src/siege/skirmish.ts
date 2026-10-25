/**
 * The abstract hit exchange of a battle: pure functions over plain unit data, deterministic given the Rng, so they
 * can be tested without a game. No combat engine is involved for NPC against NPC.
 */
import type { CombatEvent, Rng } from '@murim/shared';
import { SIEGE_TUNING as T } from './tuning';

export type Side = 'att' | 'def';

/** What the exchange needs to know about a fighter. */
export interface Fighter {
  id: number;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Relative blow strength (grunt 1). */
  power: number;
  /** Relative toughness: damage taken is divided by it (grunt 1). */
  toughness: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Damage multiplier of a side for the battle bias b in [-1, 1] (+1 = defenders dominate). */
export function steer(side: Side, bias: number): number {
  const k = side === 'def' ? 1 + T.steerK * bias : 1 - T.steerK * bias;
  return clamp(k, T.steerMin, T.steerMax);
}

export interface Blow {
  event: CombatEvent;
  /** HP removed (0 on a miss). */
  damage: number;
  killed: boolean;
}

/** One blow from `a` on `d`. HP is clamped to 0..maxHp on the defender. `skill` names the animation family. */
export function strike(rng: Rng, a: Fighter, d: Fighter, bias: number, skill = 'basic'): Blow {
  if (!rng.chance(T.hitChance)) return { event: { k: 'miss', s: a.id, d: d.id, sk: skill }, damage: 0, killed: false };
  const crit = rng.chance(T.critChance);
  let dmg = d.maxHp * T.hitFrac * a.power * steer(a.side, bias) * rng.float(0.7, 1.3) * (crit ? T.critMult : 1);
  dmg /= Math.max(0.2, d.toughness);
  const amount = clamp(Math.round(dmg), 1, Math.max(1, d.maxHp));
  const before = d.hp;
  d.hp = clamp(d.hp - amount, 0, d.maxHp);
  const dealt = before - d.hp;
  return { event: { k: 'hit', s: a.id, d: d.id, a: amount, c: crit ? 1 : undefined, sk: skill }, damage: dealt, killed: d.hp <= 0 };
}

/**
 * Pick the foe for `u`: the nearest, with a penalty for every foe already fighting it (loads), within the leash.
 * Returns null when nobody is in range.
 */
export function pickFoe<F extends Fighter>(u: Fighter, foes: readonly F[], loads: ReadonlyMap<number, number>, leash: number = T.leash): F | null {
  let best: F | null = null;
  let bestScore = Infinity;
  const l2 = leash * leash;
  for (const f of foes) {
    const d2 = dist2(u, f);
    if (d2 > l2) continue;
    const score = Math.sqrt(d2) + (loads.get(f.id) ?? 0) * T.loadPenalty;
    if (score < bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

/** Party size for a siege strength. */
export function partySize(strength: number): number {
  return clamp(Math.round(strength / T.strengthPerUnit), T.partyMin, T.partyMax);
}

/** Battle HP of a defender. */
export function defenderHp(level: number, mult: number): number {
  return Math.max(30, Math.round((T.defHpBase + T.defHpPerLevel * level) * mult));
}
