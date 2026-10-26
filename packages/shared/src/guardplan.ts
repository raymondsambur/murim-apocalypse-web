/**
 * Guard staffing policy: how many guards a settlement keeps, which of them stand at the gates and which
 * walk the rounds as a squad, per shift (day = 0, night = 1). Pure and deterministic, so the roster
 * seeding (server `sim/npcs.ts`), the life controller (`npclife/life.ts`) and the tests agree.
 */
import type { SettlementKind } from './terrain';

export type GuardShift = 0 | 1;

export type GuardDuty =
  /** Stand at gate number `gate`; `slot` is the guard's index among those at that gate (picks the flank). */
  | { kind: 'gate'; gate: number; slot: number }
  /** Walk the rounds as a squad of `size`; `slot` is the member index (0..size-1). */
  | { kind: 'squad'; squad: number; slot: number; size: number };

export interface GuardAssignment {
  shift: GuardShift;
  duty: GuardDuty;
}

export interface GuardPolicy {
  /** Gates that are kept staffed. */
  gates: number;
  /** Guards per gate by shift (day, night). */
  perGate: readonly [day: number, night: number];
  /** Squad size by shift (day, night); 0 = no squad. */
  squad: readonly [day: number, night: number];
}

const POLICY: Record<SettlementKind, GuardPolicy> = {
  hamlet: { gates: 1, perGate: [2, 1], squad: [0, 0] },
  village: { gates: 2, perGate: [1, 1], squad: [2, 0] },
  sectHall: { gates: 2, perGate: [1, 1], squad: [2, 0] },
  town: { gates: 3, perGate: [2, 1], squad: [4, 3] },
  fort: { gates: 4, perGate: [2, 1], squad: [4, 3] },
  ruin: { gates: 0, perGate: [0, 0], squad: [0, 0] },
};

export function guardPolicy(kind: SettlementKind): GuardPolicy {
  return POLICY[kind];
}

/** Guards wanted on one shift. */
export function shiftHeadcount(kind: SettlementKind, shift: GuardShift): number {
  const p = POLICY[kind];
  return p.gates * p.perGate[shift] + p.squad[shift];
}

/** Total guards a settlement of this kind keeps (both shifts). */
export function guardHeadcount(kind: SettlementKind): number {
  return shiftHeadcount(kind, 0) + shiftHeadcount(kind, 1);
}

/** How many of `n` guards work the day shift: proportional to the policy, never leaving a shift empty if n >= 2. */
function dayCount(kind: SettlementKind, n: number): number {
  const total = guardHeadcount(kind);
  if (n <= 0 || total === 0) return 0;
  if (n === 1) return 1;
  const d = Math.round((n * shiftHeadcount(kind, 0)) / total);
  return Math.min(n - 1, Math.max(1, d));
}

/** Lay out one shift of `m` guards over `gates` gates and a squad of at most `squadTarget`. */
function layoutShift(m: number, gates: number, squadTarget: number): GuardDuty[] {
  const out: GuardDuty[] = [];
  const staffed = Math.min(m, gates);
  const perGate: number[] = new Array(gates).fill(0);
  for (let g = 0; g < staffed; g++) {
    out.push({ kind: 'gate', gate: g, slot: 0 });
    perGate[g] = 1;
  }
  let rest = m - staffed;
  // A squad needs at least two members: one leftover guard just stands a second post at a gate.
  const size = rest >= 2 ? Math.min(rest, squadTarget) : 0;
  if (size >= 2) {
    for (let k = 0; k < size; k++) out.push({ kind: 'squad', squad: 0, slot: k, size });
    rest -= size;
  }
  for (let k = 0; k < rest && gates > 0; k++) {
    const g = k % gates;
    out.push({ kind: 'gate', gate: g, slot: perGate[g]++ });
  }
  return out;
}

/**
 * Duties for `n` living guards of a settlement, in the order of the guards sorted by id. The day / night split
 * follows the policy and is spread evenly through the list, so losing one guard never empties a shift.
 * `gateCount` is how many gate places the settlement really has (at least one is assumed).
 */
export function planGuards(kind: SettlementKind, n: number, gateCount: number): GuardAssignment[] {
  const out: GuardAssignment[] = new Array(Math.max(0, n));
  if (n <= 0 || POLICY[kind].gates === 0) {
    for (let i = 0; i < out.length; i++) out[i] = { shift: 0, duty: { kind: 'gate', gate: 0, slot: i } };
    return out;
  }
  const p = POLICY[kind];
  const gates = Math.max(1, Math.min(p.gates, gateCount));
  const d = dayCount(kind, n);
  const members: [number[], number[]] = [[], []];
  for (let i = 0; i < n; i++) {
    const day = Math.floor(((i + 1) * d) / n) > Math.floor((i * d) / n);
    members[day ? 0 : 1].push(i);
  }
  for (const shift of [0, 1] as const) {
    const idx = members[shift];
    const duties = layoutShift(idx.length, gates, p.squad[shift]);
    idx.forEach((gi, k) => (out[gi] = { shift, duty: duties[k] }));
  }
  return out;
}
