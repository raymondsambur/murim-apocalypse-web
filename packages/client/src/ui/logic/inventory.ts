/** Inventory presentation logic: display sort orders and what a stack can do. Pure. */
import { getItem, isEquipment, stackValue, type EquipSlot, type ItemDef, type ItemStack } from '@murim/shared';

export type SortMode = 'default' | 'kind' | 'rarity' | 'value' | 'name';
export const SORT_MODES: SortMode[] = ['default', 'kind', 'rarity', 'value', 'name'];

const KIND_ORDER: Record<string, number> = { weapon: 0, outfit: 1, accessory: 2, consumable: 3, manual: 4, material: 5 };

function nameOf(s: ItemStack): string {
  return getItem(s.id)?.name ?? s.id;
}

/** Display order as indices into the inventory array (the real order, which the server uses, is never changed). */
export function sortOrder(inv: readonly ItemStack[], mode: SortMode): number[] {
  const idx = inv.map((_, i) => i);
  if (mode === 'default') return idx;
  const kind = (s: ItemStack) => KIND_ORDER[getItem(s.id)?.kind ?? 'material'] ?? 9;
  const cmp: Record<Exclude<SortMode, 'default'>, (a: ItemStack, b: ItemStack) => number> = {
    kind: (a, b) => kind(a) - kind(b) || (getItem(b.id)?.tier ?? 0) - (getItem(a.id)?.tier ?? 0) || (b.r ?? 0) - (a.r ?? 0),
    rarity: (a, b) => (b.r ?? 0) - (a.r ?? 0) || (getItem(b.id)?.tier ?? 0) - (getItem(a.id)?.tier ?? 0) || kind(a) - kind(b),
    value: (a, b) => stackValue(b) * b.qty - stackValue(a) * a.qty,
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
  };
  const f = cmp[mode];
  return idx.sort((i, j) => f(inv[i], inv[j]) || i - j);
}

export function nextSortMode(m: SortMode): SortMode {
  return SORT_MODES[(SORT_MODES.indexOf(m) + 1) % SORT_MODES.length];
}

export interface StackActions {
  def: ItemDef | undefined;
  equipSlot: EquipSlot | null;
  /** Use button: pills, food, manuals. */
  usable: boolean;
  /** Breakthrough pills are consumed by the Breakthrough action rather than used directly. */
  breakthroughPill: boolean;
  /** Use label key: 'inv.use' or 'inv.study'. */
  useLabel: 'inv.use' | 'inv.study';
}

export function stackActions(stack: ItemStack): StackActions {
  const def = getItem(stack.id);
  if (!def) return { def, equipSlot: null, usable: false, breakthroughPill: false, useLabel: 'inv.use' };
  const equip = isEquipment(def);
  const bt = !!def.use?.breakthrough;
  return {
    def,
    equipSlot: equip ? (def.slot ?? null) : null,
    usable: !equip && !bt && !!def.use,
    breakthroughPill: bt,
    useLabel: def.kind === 'manual' ? 'inv.study' : 'inv.use',
  };
}

/** Number of free slots after `used` stacks. */
export function freeSlots(used: number, total: number): number {
  return Math.max(0, total - used);
}

/** Keep a selection only while the same item still sits at the same index. */
export function reconcileSelection(inv: readonly ItemStack[], sel: { idx: number; id: string } | null): { idx: number; id: string } | null {
  if (!sel) return null;
  if (inv[sel.idx]?.id === sel.id) return sel;
  // The stack may have moved (e.g. after a use): find the first stack of the same item.
  const i = inv.findIndex((s) => s.id === sel.id);
  return i >= 0 ? { idx: i, id: sel.id } : null;
}
