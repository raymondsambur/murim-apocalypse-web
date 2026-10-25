export const STAGES_PER_RANK = 9;
/** Highest rank with playable content in the first release. */
export const MAX_PLAYABLE_RANK = 5;
export const MAX_LEVEL = MAX_PLAYABLE_RANK * STAGES_PER_RANK;

export interface RankDef {
  id: number;
  name: string;
  title: string;
  color: string;
}

export const RANKS: readonly RankDef[] = [
  { id: 1, name: 'Third-Rate', title: 'Third-Rate Fighter', color: '#b9b2a0' },
  { id: 2, name: 'Second-Rate', title: 'Second-Rate Fighter', color: '#7ec26b' },
  { id: 3, name: 'First-Rate', title: 'First-Rate Master', color: '#5fa4e8' },
  { id: 4, name: 'Peak', title: 'Peak Master', color: '#b87ae6' },
  { id: 5, name: 'Transcendent', title: 'Transcendent', color: '#f0a43a' },
  { id: 6, name: 'Realm of Fusion', title: 'Fusion Sage', color: '#e8574a' },
  { id: 7, name: 'Realm of Mystery', title: 'Mystery Sage', color: '#e8574a' },
  { id: 8, name: 'Life-and-Death', title: 'Life-and-Death Sage', color: '#e8574a' },
];

export function rankOf(level: number): number {
  return Math.min(RANKS.length, Math.floor((level - 1) / STAGES_PER_RANK) + 1);
}

export function stageOf(level: number): number {
  return ((level - 1) % STAGES_PER_RANK) + 1;
}

export function rankName(level: number): string {
  return RANKS[rankOf(level) - 1].name;
}

export function levelLabel(level: number): string {
  return `${rankName(level)} · Stage ${stageOf(level)}`;
}

/** XP needed to complete this level (stage). */
export function xpToNext(level: number): number {
  return Math.round(36 * Math.pow(level, 1.58));
}

/** True when the next step requires a breakthrough (rank change) instead of a plain level up. */
export function isBreakthroughLevel(level: number): boolean {
  return level % STAGES_PER_RANK === 0;
}

export interface BreakthroughReq {
  /** Rank the character is leaving. */
  fromRank: number;
  pill: string;
  baseChance: number;
  gold: number;
}

export const BREAKTHROUGHS: Record<number, BreakthroughReq> = {
  1: { fromRank: 1, pill: 'pill_break_1', baseChance: 0.8, gold: 100 },
  2: { fromRank: 2, pill: 'pill_break_2', baseChance: 0.7, gold: 400 },
  3: { fromRank: 3, pill: 'pill_break_3', baseChance: 0.6, gold: 1500 },
  4: { fromRank: 4, pill: 'pill_break_4', baseChance: 0.5, gold: 6000 },
};

export function breakthroughChance(rank: number, spirit: number, insight: number): number {
  const req = BREAKTHROUGHS[rank];
  if (!req) return 0;
  return Math.max(0.15, Math.min(0.97, req.baseChance + spirit * 0.004 + insight * 0.006 - 0.05 * (rank - 1) * 0));
}

/** Free stat points granted by advancing to `newLevel`. */
export function statPointsForLevel(newLevel: number): number {
  return 2 + (newLevel % STAGES_PER_RANK === 1 ? 5 : 0);
}

/** Loadout size grows with rank. */
export function activeSlots(rank: number): number {
  return rank >= 5 ? 6 : rank >= 3 ? 5 : 4;
}
