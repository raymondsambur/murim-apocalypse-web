import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { randomLook, rollCharacter } from './stats';
import { newCharacterSave } from './character';
import { applyJobXp, applySkillXp, applyXp } from './progression';
import { isBreakthroughLevel, xpToNext } from './ranks';

function fresh() {
  const rng = new Rng(5);
  return newCharacterSave({ id: 1, name: 'Tester', look: randomLook(rng), roll: rollCharacter(rng), homeSettlement: 0, spawn: { x: 1, y: 1 }, now: 0, rerolls: 0 });
}

describe('applyXp', () => {
  it('levels up and awards stat points', () => {
    const s = fresh();
    const r = applyXp(s, xpToNext(1) + 5);
    expect(r.levelsGained).toBe(1);
    expect(s.level).toBe(2);
    expect(s.xp).toBe(5);
    expect(s.statPoints).toBe(2);
  });

  it('chains several levels from one big grant', () => {
    const s = fresh();
    const r = applyXp(s, xpToNext(1) + xpToNext(2) + xpToNext(3));
    expect(r.levelsGained).toBe(3);
    expect(s.level).toBe(4);
  });

  it('stops at the end of a rank and clamps the bar', () => {
    const s = fresh();
    applyXp(s, 10_000_000);
    expect(s.level).toBe(9);
    expect(isBreakthroughLevel(s.level)).toBe(true);
    expect(s.xp).toBe(xpToNext(9));
    const again = applyXp(s, 500);
    expect(again.atBreakthrough).toBe(true);
    expect(s.level).toBe(9);
    expect(s.xp).toBe(xpToNext(9));
  });

  it('ignores negative amounts', () => {
    const s = fresh();
    applyXp(s, -50);
    expect(s.xp).toBe(0);
  });
});

describe('job and skill xp', () => {
  it('levels jobs', () => {
    const s = fresh();
    expect(applyJobXp(s, 'herbalist', 100000)).toBeGreaterThan(5);
    expect(s.jobs.herbalist.lv).toBeLessThanOrEqual(20);
  });

  it('levels known skills only', () => {
    const s = fresh();
    const id = Object.keys(s.skills)[0];
    expect(applySkillXp(s, id, 10000)).toBeGreaterThan(0);
    expect(s.skills[id].lv).toBeLessThanOrEqual(10);
    expect(applySkillXp(s, 'does_not_exist', 100)).toBe(0);
  });
});
