/**
 * Dev-only check of the real item slot widget with the pixel-art icons: small, medium and large slots, rarity borders and a
 * tooltip card. Run: npx vite packages/client --port 5201 -> http://localhost:5201/uislots.html (add ?tip=w_sword_4 for a tooltip).
 */
import { ITEMS, type ItemStack } from '@murim/shared';
import './styles.css';
import { h } from './ui/dom';
import { itemGrid, itemSlot } from './ui/widgets/itemSlot';
import { itemTooltip } from './ui/widgets/tooltip';

const out = document.getElementById('out')!;
const ids = ['w_sword_3', 'w_spear_4', 'w_fist_2', 'o_3', 'a_spirit_3', 'a_fortune_4', 'herb_rare', 'ore_silver', 'blight_core', 'pill_heal_m', 'pill_break_3', 'antidote', 'manual_sword_azure', 'manual_int_sun'];
const stacks: ItemStack[] = ids.filter((id) => ITEMS[id]).map((id, i) => ({ id, qty: ITEMS[id].stack > 1 ? 3 + i : 1, r: ITEMS[id].kind === 'weapon' || ITEMS[id].kind === 'outfit' || ITEMS[id].kind === 'accessory' ? (i % 5) as 0 | 1 | 2 | 3 | 4 : 0 }));

for (const size of ['sm', 'md', 'lg'] as const) {
  out.append(h('div', { style: { margin: '8px 0 2px', color: '#b3a98f', font: '12px ui-monospace, monospace' } }, `size ${size}`));
  const row = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  for (const s of stacks) row.append(itemSlot(s, { size }));
  out.append(row);
}
out.append(h('div', { style: { margin: '12px 0 2px', color: '#b3a98f', font: '12px ui-monospace, monospace' } }, 'item grid (md, 6 columns)'));
const grid = itemGrid(stacks, 18, { size: 'md' });
grid.style.width = '420px';
out.append(grid);

const tip = new URLSearchParams(location.search).get('tip');
if (tip && ITEMS[tip]) {
  const card = itemTooltip({ id: tip, qty: 1, r: 3, aff: [['atk', 7]] });
  const wrap = h('div', { class: 'tip show', style: { position: 'static', margin: '16px 0', display: 'block', opacity: '1', transform: 'none' } }, card);
  out.append(wrap);
}
document.body.dataset.ready = '1';
