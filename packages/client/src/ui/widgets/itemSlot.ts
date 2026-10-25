/** Item slots and grids: rarity border, CJK glyph, quantity badge, rich tooltip. */
import { getItem, type ItemStack } from '@murim/shared';
import { t } from '../../i18n';
import { h } from '../dom';
import { stackColor, stackTitle, type ItemTipOptions } from '../text/tips';
import { attachTooltip, itemTooltip } from './tooltip';

export interface SlotOptions {
  size?: 'sm' | 'md' | 'lg';
  onClick?: (ev: MouseEvent) => void;
  /** Glyph shown faintly when empty (e.g. 劍 for the weapon slot). */
  emptyGlyph?: string;
  /** Accessible label when empty. */
  emptyLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Tooltip: true (default) builds the item tooltip, false disables it. */
  tooltip?: boolean;
  tipOptions?: ItemTipOptions;
}

export function itemSlot(stack: ItemStack | null, opts: SlotOptions = {}): HTMLButtonElement {
  const def = stack ? getItem(stack.id) : undefined;
  const color = stack ? stackColor(stack) : undefined;
  const label = stack ? (stack.qty > 1 ? `${stackTitle(stack)} ×${stack.qty}` : stackTitle(stack)) : (opts.emptyLabel ?? t('inv.emptySlot'));
  const el = h(
    'button',
    {
      type: 'button',
      class: ['slot', `slot-${opts.size ?? 'md'}`, !stack && 'slot-empty', opts.selected && 'slot-selected', !!stack && (stack.r ?? 0) >= 3 && 'slot-glow'],
      style: color ? { '--rc': color } : undefined,
      'aria-label': label,
      'aria-pressed': opts.selected ? 'true' : undefined,
      disabled: opts.disabled,
      onclick: opts.onClick,
    },
    stack
      ? h('span', { class: 'slot-glyph', style: { color: def?.color ?? '#ccc' }, 'aria-hidden': 'true' }, def?.glyph ?? '?')
      : opts.emptyGlyph
        ? h('span', { class: 'slot-glyph slot-ghost', 'aria-hidden': 'true' }, opts.emptyGlyph)
        : null,
    stack && stack.qty > 1 ? h('span', { class: 'slot-qty', 'aria-hidden': 'true' }, stack.qty > 999 ? '999+' : String(stack.qty)) : null,
  );
  if (stack && opts.tooltip !== false) attachTooltip(el, () => itemTooltip(stack, opts.tipOptions));
  return el;
}

export interface GridOptions {
  size?: 'sm' | 'md' | 'lg';
  /** Inventory index of the selected stack. */
  selected?: number | null;
  onClick?: (stack: ItemStack, idx: number, el: HTMLButtonElement) => void;
  /** Display order: array of inventory indices (defaults to natural order). */
  order?: number[];
  tipOptions?: (stack: ItemStack, idx: number) => ItemTipOptions | undefined;
  /** Dim stacks that fail this test (e.g. unsellable). */
  enabled?: (stack: ItemStack, idx: number) => boolean;
  label?: string;
}

/** Fixed-size grid; empty cells fill up to `slots`. */
export function itemGrid(stacks: ItemStack[], slots: number, opts: GridOptions = {}): HTMLDivElement {
  const grid = h('div', { class: ['item-grid', `grid-${opts.size ?? 'md'}`], role: 'group', 'aria-label': opts.label });
  const order = opts.order ?? stacks.map((_, i) => i);
  for (const idx of order) {
    const stack = stacks[idx];
    if (!stack) continue;
    const ok = opts.enabled ? opts.enabled(stack, idx) : true;
    const el = itemSlot(stack, {
      size: opts.size,
      selected: opts.selected === idx,
      disabled: !ok,
      tipOptions: opts.tipOptions?.(stack, idx),
      onClick: () => opts.onClick?.(stack, idx, el),
    });
    el.dataset.idx = String(idx);
    grid.appendChild(el);
  }
  for (let i = order.length; i < slots; i++) grid.appendChild(h('div', { class: ['slot', `slot-${opts.size ?? 'md'}`, 'slot-empty', 'slot-cell'], 'aria-hidden': 'true' }));
  return grid;
}
