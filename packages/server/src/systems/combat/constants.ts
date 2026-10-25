/** Tuning knobs of the combat manager. Owner: gameplay-combat. */
export const COMBAT_TUNING = {
  /** Players per combat (side 0), assists included. */
  maxPlayers: 5,
  /** Monsters per combat (side 1); the rest of a big pack stays outside and joins a later fight. */
  maxMonsters: 6,
  /** Pack / siege mates within this many tiles of the engaged monster join the fight. */
  mateRadius: 6,
  /** `assist` range (tiles from the combat position). */
  assistRadius: 8,
  /** A player needs at least this share of the damage dealt to a monster to earn rewards for it. */
  minShare: 0.1,
  /** Rewards: XP level factor clamp and the penalty for much weaker monsters. */
  xpFactorMin: 0.1,
  xpFactorMax: 1.6,
  xpFactorPerLevel: 0.1,
  trivialLevelGap: 10,
  trivialXpMult: 0.05,
  /** Loot: chance multiplier is `1 + fortune / lootFortuneDiv`. */
  lootFortuneDiv: 200,
  equipDropChance: 0.06,
  manualDropChance: 0.015,
  eliteEquipMult: 2,
  bossEquipMult: 4,
  eliteManualMult: 3,
  /** Death. */
  respawnMs: 8000,
  goldLossFraction: 0.1,
  injuryMaxStacks: 3,
  injuryMs: 10 * 60_000,
  respawnHpFraction: 0.3,
  /** Fleeing: movement lock afterwards, and how many beats a `flee` request waits for the player to act. */
  fleeLockMs: 2000,
  /** After a successful flee, monsters ignore the player for this long (time to get away). */
  fleeImmuneMs: 6000,
  fleeRequestBeats: 3,
  /** Duels end when a fighter is at or below this fraction of max HP. */
  duelEndFraction: 0.15,
  /** A fight that is still going after this many beats is stopped as a draw. */
  maxBeats: 300,
  /** Skill proficiency: xp per use is `learnRate`, times this for fast schools. */
  fastSchoolMult: 1.5,
  /** Out-of-combat regeneration, evaluated every `regenEveryS` seconds per player. */
  regenEveryS: 5,
  regenHp: 0.01,
  regenQi: 0.05,
  regenSettlementMult: 2,
} as const;
