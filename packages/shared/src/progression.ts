import { MAX_LEVEL, isBreakthroughLevel, statPointsForLevel, xpToNext } from './ranks';
import { JOB_MAX_LEVEL, jobXpToNext } from './data/jobs';
import { SKILL_MAX_LEVEL, skillXpToNext } from './data/skills';
import type { CharacterSave, JobId } from './types';

export interface XpResult {
  /** XP actually added to the bar (before level-ups). */
  gained: number;
  levelsGained: number;
  newLevel: number;
  /** True when the XP bar is full at a breakthrough stage (or the level cap). */
  atBreakthrough: boolean;
}

/**
 * Add cultivation XP to a character, levelling up through plain stages.
 * Stops at stage 9 of a rank (a Breakthrough is needed to continue) and clamps the bar there.
 * Pure: mutates only `save.xp`, `save.level` and `save.statPoints`.
 */
export function applyXp(save: CharacterSave, amount: number): XpResult {
  const gained = Math.max(0, Math.floor(amount));
  save.xp += gained;
  let levels = 0;
  while (save.level < MAX_LEVEL && !isBreakthroughLevel(save.level)) {
    const need = xpToNext(save.level);
    if (save.xp < need) break;
    save.xp -= need;
    save.level++;
    save.statPoints += statPointsForLevel(save.level);
    levels++;
  }
  const atBreakthrough = save.level >= MAX_LEVEL || isBreakthroughLevel(save.level);
  if (atBreakthrough) save.xp = Math.min(save.xp, xpToNext(save.level));
  return { gained, levelsGained: levels, newLevel: save.level, atBreakthrough };
}

/** Add job XP; returns levels gained. */
export function applyJobXp(save: CharacterSave, job: JobId, amount: number): number {
  const st = save.jobs[job];
  st.xp += Math.max(0, Math.floor(amount));
  let gained = 0;
  while (st.lv < JOB_MAX_LEVEL && st.xp >= jobXpToNext(st.lv)) {
    st.xp -= jobXpToNext(st.lv);
    st.lv++;
    gained++;
  }
  if (st.lv >= JOB_MAX_LEVEL) st.xp = 0;
  return gained;
}

/** Add skill proficiency XP; returns levels gained (0 if the skill is unknown). */
export function applySkillXp(save: CharacterSave, skillId: string, amount: number): number {
  const st = save.skills[skillId];
  if (!st) return 0;
  st.xp += amount;
  let gained = 0;
  while (st.lv < SKILL_MAX_LEVEL && st.xp >= skillXpToNext(st.lv)) {
    st.xp -= skillXpToNext(st.lv);
    st.lv++;
    gained++;
  }
  if (st.lv >= SKILL_MAX_LEVEL) st.xp = 0;
  return gained;
}
