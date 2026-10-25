/** Breakthrough (rank-up) requirements from the live character. Pure so the panel and tests share it. */
import {
  BREAKTHROUGHS,
  MAX_PLAYABLE_RANK,
  RANKS,
  STAGES_PER_RANK,
  breakthroughChance,
  getItem,
  isBreakthroughLevel,
  rankOf,
  type MeView,
} from '@murim/shared';

export interface BreakthroughStatus {
  /** Level is the last stage of its rank. */
  atPeak: boolean;
  /** Next rank is beyond the playable slice. */
  sealed: boolean;
  rank: number;
  nextRankName: string;
  stagesLeft: number;
  xp: { have: number; need: number; ok: boolean };
  pill: { id: string; name: string; have: number; need: number; ok: boolean } | null;
  gold: { have: number; need: number; ok: boolean };
  /** 0..1 success chance with current Spirit and Insight. */
  chance: number;
  /** i18n keys describing what is still missing. */
  blockers: string[];
  ready: boolean;
}

export function inventoryCount(inv: readonly { id: string; qty: number }[], id: string): number {
  let n = 0;
  for (const s of inv) if (s.id === id) n += s.qty;
  return n;
}

export function breakthroughStatus(me: MeView): BreakthroughStatus {
  const c = me.c;
  const rank = rankOf(c.level);
  const atPeak = isBreakthroughLevel(c.level);
  const req = BREAKTHROUGHS[rank];
  const sealed = rank >= MAX_PLAYABLE_RANK || !req;
  const stagesLeft = atPeak ? 0 : STAGES_PER_RANK - (((c.level - 1) % STAGES_PER_RANK) + 1);
  const xp = { have: c.xp, need: me.xpNext, ok: c.xp >= me.xpNext };
  const gold = { have: c.gold, need: req?.gold ?? 0, ok: c.gold >= (req?.gold ?? 0) };
  const pillHave = req ? inventoryCount(c.inventory, req.pill) : 0;
  const pill = req ? { id: req.pill, name: getItem(req.pill)?.name ?? req.pill, have: pillHave, need: 1, ok: pillHave >= 1 } : null;
  const chance = req ? breakthroughChance(rank, me.d.total.spirit, me.d.total.insight) : 0;
  const blockers: string[] = [];
  if (!atPeak) blockers.push('bt.need.peak');
  else if (sealed) blockers.push('bt.need.sealed');
  else {
    if (!xp.ok) blockers.push('bt.need.xp');
    if (pill && !pill.ok) blockers.push('bt.need.pill');
    if (!gold.ok) blockers.push('bt.need.gold');
  }
  return {
    atPeak,
    sealed,
    rank,
    nextRankName: RANKS[rank]?.name ?? '?',
    stagesLeft,
    xp,
    pill,
    gold,
    chance,
    blockers,
    ready: atPeak && !sealed && blockers.length === 0,
  };
}
