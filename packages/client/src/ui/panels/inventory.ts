/**
 * Inventory panel: equipment slots (weapon / outfit / accessory) with unequip, the 40-slot grid with a display sort,
 * a detail card with Equip / Use / Drop, and gold.
 */
import { INVENTORY_SLOTS, type EquipSlot, type ItemStack } from '@murim/shared';
import { t } from '../../i18n';
import { h, loadJson, saveJson } from '../dom';
import { fmtInt } from '../format';
import { freeSlots, nextSortMode, reconcileSelection, sortOrder, stackActions, type SortMode } from '../logic/inventory';
import { itemTipModel, stackTitle } from '../text/tips';
import { itemGrid, itemSlot } from '../widgets/itemSlot';
import { stepper } from '../widgets/stepper';
import { renderTip } from '../widgets/tooltip';
import { registerPanel } from './registry';

type Selection = { kind: 'inv'; idx: number; id: string } | { kind: 'eq'; slot: EquipSlot } | null;

const PREF_KEY = 'murim.inventory.v1';
const SLOTS: { slot: EquipSlot; glyph: string }[] = [
  { slot: 'weapon', glyph: '劍' },
  { slot: 'outfit', glyph: '衣' },
  { slot: 'accessory', glyph: '環' },
];

let selection: Selection = null;
let sortMode: SortMode = loadJson<{ sort: SortMode }>(PREF_KEY, { sort: 'default' }).sort;
let dropQty = 1;
let lastClick = { idx: -1, at: 0 };

registerPanel({
  id: 'inventory',
  title: 'panel.inventory',
  glyph: '袋',
  hotkey: 'i',
  order: 20,
  width: 440,
  watch: ['me'],
  onClose: () => {
    selection = null;
  },
  render(root, ui) {
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('common.loading')));
      return;
    }
    const c = me.c;
    const inv = c.inventory;
    if (selection?.kind === 'inv') {
      const r = reconcileSelection(inv, selection);
      selection = r ? { kind: 'inv', ...r } : null;
    }
    if (selection?.kind === 'eq' && !c.equipment[selection.slot]) selection = null;

    const select = (s: Selection) => {
      selection = s;
      ui.panels.refresh('inventory');
    };

    // ---- top: equipment + gold + sort -------------------------------------------------------
    const eqRow = h(
      'div',
      { class: 'inv-equip' },
      ...SLOTS.map(({ slot, glyph }) => {
        const st = c.equipment[slot];
        const sel = selection?.kind === 'eq' && selection.slot === slot;
        return h(
          'div',
          { class: 'inv-eq-cell' },
          itemSlot(st, { size: 'lg', emptyGlyph: glyph, emptyLabel: t(`inv.slot.${slot}`), selected: sel, tipOptions: { equipped: true }, onClick: () => st && select(sel ? null : { kind: 'eq', slot }) }),
          h('span', { class: 'inv-eq-label' }, t(`inv.slot.${slot}`)),
        );
      }),
      h(
        'div',
        { class: 'inv-meta' },
        h('span', { class: 'chip chip-gold inv-gold' }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, '金'), fmtInt(c.gold)),
        h('span', { class: ['chip', freeSlots(inv.length, INVENTORY_SLOTS) === 0 ? 'chip-bad' : ''] }, t('inv.slots', { used: inv.length, total: INVENTORY_SLOTS })),
        h(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            title: t('inv.sortTip'),
            onclick: () => {
              sortMode = nextSortMode(sortMode);
              saveJson(PREF_KEY, { sort: sortMode });
              ui.panels.refresh('inventory');
            },
          },
          h('span', { class: 'glyph', 'aria-hidden': 'true' }, '序'),
          t('inv.sort', { mode: t(`inv.sort.${sortMode}`) }),
        ),
      ),
    );

    // ---- grid -----------------------------------------------------------------------------------
    const quick = (stack: ItemStack, idx: number) => {
      const a = stackActions(stack);
      if (a.equipSlot) ui.net.send({ t: 'equip', idx, id: stack.id });
      else if (a.usable) ui.net.send({ t: 'use', idx, id: stack.id });
    };
    const grid = itemGrid(inv, INVENTORY_SLOTS, {
      label: t('inv.grid'),
      order: sortOrder(inv, sortMode),
      selected: selection?.kind === 'inv' ? selection.idx : null,
      tipOptions: (stack) => {
        const a = stackActions(stack);
        return a.equipSlot ? { compare: c.equipment[a.equipSlot] ?? null } : undefined;
      },
      onClick: (stack, idx) => {
        const now = Date.now();
        if (lastClick.idx === idx && now - lastClick.at < 350) {
          lastClick = { idx: -1, at: 0 };
          quick(stack, idx);
          return;
        }
        lastClick = { idx, at: now };
        select(selection?.kind === 'inv' && selection.idx === idx ? null : { kind: 'inv', idx, id: stack.id });
      },
    });

    // ---- detail ---------------------------------------------------------------------------------------
    const detail = h('div', { class: 'inv-detail card' });
    if (!selection) {
      detail.append(h('p', { class: 'empty-note' }, inv.length ? t('inv.pick') : t('inv.empty')));
    } else if (selection.kind === 'eq') {
      const st = c.equipment[selection.slot]!;
      detail.append(
        renderTip(itemTipModel(st, { equipped: true })),
        h(
          'div',
          { class: 'inv-actions' },
          h(
            'button',
            {
              class: 'btn btn-sm',
              type: 'button',
              disabled: inv.length >= INVENTORY_SLOTS,
              title: inv.length >= INVENTORY_SLOTS ? t('inv.full') : undefined,
              onclick: () => ui.net.send({ t: 'unequip', slot: selection!.kind === 'eq' ? selection!.slot : 'weapon' }),
            },
            t('inv.unequip'),
          ),
        ),
      );
    } else {
      const sel = selection;
      const stack = inv[sel.idx];
      const a = stackActions(stack);
      const current = a.equipSlot ? c.equipment[a.equipSlot] : undefined;
      detail.append(renderTip(itemTipModel(stack, a.equipSlot ? { compare: current ?? null } : {})));
      const actions = h('div', { class: 'inv-actions' });
      if (a.equipSlot) actions.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => ui.net.send({ t: 'equip', idx: sel.idx, id: stack.id }) }, current ? t('inv.swap') : t('inv.equip')));
      if (a.usable) actions.append(h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => ui.net.send({ t: 'use', idx: sel.idx, id: stack.id }) }, t(a.useLabel)));
      if (a.breakthroughPill) actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ui.panels.show('character') }, t('inv.openBreakthrough')));
      const qty = Math.max(1, stack.qty);
      dropQty = Math.min(Math.max(1, dropQty), qty);
      const drop = stepper({ value: dropQty, min: 1, max: qty, label: t('inv.dropQty'), onChange: (v) => (dropQty = v) });
      const dropBtn = h(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          type: 'button',
          onclick: async () => {
            const n = drop.get();
            const ok = await ui.confirm({ title: t('inv.dropTitle'), text: t('inv.dropText', { n, name: stackTitle(stack) }), ok: t('inv.drop'), danger: true });
            if (ok) {
              ui.net.send({ t: 'drop', idx: sel.idx, id: stack.id, qty: n });
              selection = null;
            }
          },
        },
        t('inv.drop'),
      );
      actions.append(h('span', { class: 'inv-drop' }, qty > 1 ? drop.el : null, dropBtn));
      detail.append(actions);
    }

    root.append(eqRow, grid, detail, h('p', { class: 'inv-hint' }, t('inv.hint')));
  },
});
