/**
 * The pixel-art item icon (art/itemicons.ts) as a DOM element for slots and tooltips. The icon is 40 x 40 art px and is shown
 * at 1:1 with nearest-neighbour scaling, so it needs a slot of at least 44 px; small slots keep the vector icon.
 */
import type { ItemDef } from '@murim/shared';
import { genItemIcon, ICON_PX } from '../../art/itemicons';
import { pbToCanvas } from '../../art/canvas';
import { h } from '../dom';

/** Slot sizes (see `.slot-sm / .slot-md / .slot-lg` in components.css) that are big enough for the 40 px icon. */
export function usesPixelIcon(size: 'sm' | 'md' | 'lg' | undefined): boolean {
  return size !== 'sm';
}

const composed = new Map<string, HTMLCanvasElement>();

/** Colour layer plus the additive glow, composed once per item and rarity. */
function composedIcon(def: ItemDef, rarity: number): HTMLCanvasElement {
  const key = `${def.id}|${def.kind === 'weapon' ? rarity : 0}`;
  let cv = composed.get(key);
  if (!cv) {
    const ic = genItemIcon(def, rarity);
    cv = pbToCanvas(ic.pb);
    if (ic.glow) {
      const g = cv.getContext('2d')!;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(pbToCanvas(ic.glow), 0, 0);
    }
    composed.set(key, cv);
  }
  return cv;
}

/** A fresh element holding a copy of the cached icon (an element can only live in one place). */
export function itemPixelIcon(def: ItemDef, rarity = 0): HTMLElement {
  const src = composedIcon(def, rarity);
  const cv = document.createElement('canvas');
  cv.width = ICON_PX;
  cv.height = ICON_PX;
  cv.getContext('2d')!.drawImage(src, 0, 0);
  cv.className = 'px-icon';
  return h('span', { class: 'px-ico', 'aria-hidden': 'true' }, cv);
}
