/** Combat HUD helpers. Pure. */
import type { CombatReward, CombatView, FighterView, ItemStack } from '@murim/shared';
import type { CombatResult } from '../../state/store';

/** Split fighters into "my side" (the side the local player fights on) and the opposition. */
export function splitSides(view: CombatView, selfId: number | null): { mine: FighterView[]; theirs: FighterView[] } {
  const self = view.fighters.find((f) => f.id === selfId);
  const mySide = self ? self.side : 0;
  return {
    mine: view.fighters.filter((f) => f.side === mySide),
    theirs: view.fighters.filter((f) => f.side !== mySide),
  };
}

export function resultKind(r: CombatResult['result']): 'win' | 'lose' | 'fled' | 'draw' {
  return r;
}

export function resultTone(r: CombatResult['result']): 'good' | 'bad' | 'warn' | 'dim' {
  return r === 'win' ? 'good' : r === 'lose' ? 'bad' : r === 'fled' ? 'warn' : 'dim';
}

/** True when a reward has anything to show. */
export function hasReward(r: CombatReward | undefined): r is CombatReward {
  return !!r && (r.xp > 0 || r.gold > 0 || r.items.length > 0);
}

/** Merge duplicate item ids in a reward for display. */
export function mergeRewardItems(items: readonly ItemStack[]): ItemStack[] {
  const out: ItemStack[] = [];
  for (const it of items) {
    const prev = out.find((o) => o.id === it.id && !o.uid && !it.uid && o.r === it.r);
    if (prev) prev.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}

/** Seconds the result banner stays before the HUD hides itself. */
export function bannerSeconds(r: CombatResult['result']): number {
  return r === 'win' ? 7 : 8;
}

export function fighterPct(f: FighterView): number {
  return f.maxHp > 0 ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 0;
}
