/**
 * Kill rewards: XP, gold, loot, equipment and manual drops (GAMEPLAY_SPEC section 2). Pure apart from `rng`.
 * Owner: gameplay-combat.
 */
import { MONSTERS, SKILLS, makeEquipment, monsterStats, type CharacterSave, type ItemStack, type MonsterDef, type Rng } from '@murim/shared';
import { COMBAT_TUNING as K } from './constants';
import { eliteBoost } from '../monsters/state';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** XP multiplier for a monster of `mLv` killed by a player of `pLv`. */
export function xpFactor(mLv: number, pLv: number): number {
  if (mLv <= pLv - K.trivialLevelGap) return K.trivialXpMult;
  return clamp(1 + K.xpFactorPerLevel * (mLv - pLv), K.xpFactorMin, K.xpFactorMax);
}

/** Base XP (before talent / sect multipliers) a player earns for one monster. */
export function killXp(def: MonsterDef, mLv: number, elite: 0 | 1 | 2, pLv: number): number {
  const base = monsterStats(def, mLv).xp * eliteBoost(def, elite).xp;
  return Math.max(1, Math.round(base * xpFactor(mLv, pLv)));
}

export interface KillDrop {
  gold: number;
  items: ItemStack[];
}

/** Roll gold and drops of one monster for one player. */
export function rollKillDrop(rng: Rng, save: CharacterSave, def: MonsterDef, mLv: number, elite: 0 | 1 | 2, fortune: number): KillDrop {
  const stats = monsterStats(def, mLv);
  const gold = stats.gold[1] > 0 ? rng.int(Math.min(stats.gold[0], stats.gold[1]), stats.gold[1]) : 0;
  const items: ItemStack[] = [];
  const luck = 1 + fortune / K.lootFortuneDiv;
  for (const l of def.loot) {
    if (rng.chance(Math.min(1, l.chance * luck))) items.push({ id: l.item, qty: rng.int(l.min, Math.max(l.min, l.max)) });
  }
  const equipMult = elite === 2 ? K.bossEquipMult : elite === 1 ? K.eliteEquipMult : 1;
  if (rng.chance(Math.min(1, K.equipDropChance * equipMult))) {
    const eq = makeEquipment(rng, clamp(Math.ceil(mLv / 8), 1, 5), fortune, undefined, elite);
    if (eq) items.push(eq);
  }
  if (rng.chance(Math.min(1, K.manualDropChance * (elite > 0 ? K.eliteManualMult : 1)))) {
    const maxTier = Math.ceil(mLv / 10);
    const pool = Object.values(SKILLS).filter((s) => s.tier <= maxTier && !save.skills[s.id]);
    if (pool.length) items.push({ id: `manual_${rng.pick(pool).id}`, qty: 1 });
  }
  return { gold, items };
}

export function defOf(id: string): MonsterDef | undefined {
  return MONSTERS[id];
}
