import { describe, expect, it } from 'vitest';
import { guardHeadcount, guardPolicy, planGuards, shiftHeadcount, type GuardAssignment } from './guardplan';
import type { SettlementKind } from './terrain';

const KINDS: SettlementKind[] = ['hamlet', 'village', 'sectHall', 'town', 'fort', 'ruin'];

function summary(plan: GuardAssignment[], shift: 0 | 1) {
  const mine = plan.filter((a) => a.shift === shift);
  const gate = new Map<number, number>();
  let squad = 0;
  for (const a of mine) {
    if (a.duty.kind === 'gate') gate.set(a.duty.gate, (gate.get(a.duty.gate) ?? 0) + 1);
    else squad++;
  }
  return { total: mine.length, gate, squad };
}

describe('guard headcount', () => {
  it('matches the policy table', () => {
    expect(guardHeadcount('hamlet')).toBe(3);
    expect(guardHeadcount('village')).toBe(6);
    expect(guardHeadcount('sectHall')).toBe(6);
    expect(guardHeadcount('town')).toBe(16);
    expect(guardHeadcount('fort')).toBe(19);
    expect(guardHeadcount('ruin')).toBe(0);
  });

  it('splits into day and night totals', () => {
    expect([shiftHeadcount('hamlet', 0), shiftHeadcount('hamlet', 1)]).toEqual([2, 1]);
    expect([shiftHeadcount('village', 0), shiftHeadcount('village', 1)]).toEqual([4, 2]);
    expect([shiftHeadcount('town', 0), shiftHeadcount('town', 1)]).toEqual([10, 6]);
    expect([shiftHeadcount('fort', 0), shiftHeadcount('fort', 1)]).toEqual([12, 7]);
  });
});

describe('planGuards at full strength', () => {
  it('staffs every gate and forms the squads of the policy', () => {
    for (const kind of KINDS) {
      const p = guardPolicy(kind);
      const plan = planGuards(kind, guardHeadcount(kind), p.gates);
      expect(plan).toHaveLength(guardHeadcount(kind));
      for (const shift of [0, 1] as const) {
        const s = summary(plan, shift);
        expect(s.total).toBe(shiftHeadcount(kind, shift));
        expect(s.squad).toBe(p.squad[shift]);
        for (let g = 0; g < p.gates; g++) expect(s.gate.get(g) ?? 0).toBe(p.perGate[shift]);
      }
    }
  });

  it('gives a village a day pair and an unsquadded night', () => {
    const plan = planGuards('village', 6, 2);
    expect(summary(plan, 0)).toMatchObject({ total: 4, squad: 2 });
    expect(summary(plan, 1)).toMatchObject({ total: 2, squad: 0 });
  });

  it('numbers squad members and gate slots from zero', () => {
    const plan = planGuards('town', 16, 3);
    const squad = plan.filter((a) => a.shift === 0 && a.duty.kind === 'squad').map((a) => (a.duty.kind === 'squad' ? a.duty : null)!);
    expect(squad.map((d) => d.slot).sort()).toEqual([0, 1, 2, 3]);
    expect(squad.every((d) => d.size === 4)).toBe(true);
    for (let g = 0; g < 3; g++) {
      const slots = plan.filter((a) => a.shift === 0 && a.duty.kind === 'gate' && a.duty.gate === g).map((a) => (a.duty.kind === 'gate' ? a.duty.slot : -1));
      expect(slots.sort()).toEqual([0, 1]);
    }
  });
});

describe('planGuards under any strength', () => {
  it('is deterministic and covers every guard', () => {
    for (const kind of KINDS) {
      for (let n = 0; n <= 30; n++) {
        const a = planGuards(kind, n, 4);
        expect(a).toEqual(planGuards(kind, n, 4));
        expect(a).toHaveLength(n);
      }
    }
  });

  it('never leaves a lone patroller', () => {
    for (const kind of KINDS) {
      for (let n = 0; n <= 30; n++) {
        for (let gates = 0; gates <= 5; gates++) {
          const plan = planGuards(kind, n, gates);
          for (const shift of [0, 1] as const) {
            const squad = plan.filter((x) => x.shift === shift && x.duty.kind === 'squad');
            expect(squad.length === 0 || squad.length >= 2).toBe(true);
            for (const x of squad) expect(x.duty.kind === 'squad' && x.duty.size).toBe(squad.length);
          }
        }
      }
    }
  });

  it('puts one guard on each staffed gate before anything else', () => {
    const plan = planGuards('town', 5, 3);
    for (const shift of [0, 1] as const) {
      const mine = plan.filter((a) => a.shift === shift);
      const gates = new Set(mine.filter((a) => a.duty.kind === 'gate').map((a) => (a.duty.kind === 'gate' ? a.duty.gate : -1)));
      expect(gates.size).toBe(Math.min(3, mine.length));
    }
  });

  it('keeps both shifts staffed when at least two guards remain', () => {
    for (const kind of ['hamlet', 'village', 'town', 'fort'] as const) {
      for (let n = 2; n <= 25; n++) {
        const plan = planGuards(kind, n, 4);
        expect(summary(plan, 0).total).toBeGreaterThan(0);
        expect(summary(plan, 1).total).toBeGreaterThan(0);
      }
    }
  });

  it('puts extras on the gates round-robin', () => {
    // A hamlet with 9 guards: day and night all stand at its single gate with rising slots.
    const plan = planGuards('hamlet', 9, 1);
    const slots = plan.filter((a) => a.shift === 0).map((a) => (a.duty.kind === 'gate' ? a.duty.slot : -1));
    expect(slots.sort((x, y) => x - y)).toEqual(slots.map((_, i) => i));
    const town = planGuards('town', 30, 3);
    const day = summary(town, 0);
    const counts = [0, 1, 2].map((g) => day.gate.get(g) ?? 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('copes with a settlement that has fewer gates than the policy', () => {
    const plan = planGuards('fort', 19, 2);
    for (const a of plan) if (a.duty.kind === 'gate') expect(a.duty.gate).toBeLessThan(2);
    const noGates = planGuards('town', 4, 0);
    for (const a of noGates) if (a.duty.kind === 'gate') expect(a.duty.gate).toBe(0);
  });

  it('spreads the shifts through the id order', () => {
    const plan = planGuards('town', 16, 3);
    const firstEight = plan.slice(0, 8);
    expect(firstEight.some((a) => a.shift === 0)).toBe(true);
    expect(firstEight.some((a) => a.shift === 1)).toBe(true);
  });
});
