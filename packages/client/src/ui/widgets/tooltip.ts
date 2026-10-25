/**
 * Rich tooltips. Desktop: hover/focus. Touch: long-press (or the caller shows them in a popover on tap).
 * `itemTooltip(stack)`, `skillTooltip(id, lv)`, `talentTooltip(id)` build the DOM from the pure models.
 */
import type { ItemStack } from '@murim/shared';
import { h } from '../dom';
import { icon } from '../icons';
import { itemTipModel, skillTipModel, talentTipModel, type ItemTipOptions, type TipLine, type TipModel } from '../text/tips';

export type TipContent = Node | string | null | undefined;

let tipEl: HTMLDivElement | null = null;
let currentOwner: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function ensureTip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'tooltip', id: 'tip', 'aria-hidden': 'true' });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function lineEl(l: TipLine): HTMLElement {
  return h('div', { class: ['tip-line', l.tone && `tone-${l.tone}`] }, l.text);
}

export function renderTip(m: TipModel): HTMLElement {
  return h(
    'div',
    { class: 'tipcard' },
    h(
      'div',
      { class: 'tip-head' },
      h('span', { class: 'tip-glyph', style: { color: m.glyphColor, '--rc': m.titleColor }, 'aria-hidden': 'true' }, icon(m.glyph)),
      h('div', { class: 'tip-titles' }, h('div', { class: 'tip-title', style: { color: m.titleColor } }, m.title), m.subtitle ? h('div', { class: 'tip-sub' }, m.subtitle) : null),
    ),
    m.lines.length ? h('div', { class: 'tip-lines' }, m.lines.map(lineEl)) : null,
    m.desc ? h('p', { class: 'tip-desc' }, m.desc) : null,
    m.footer.length ? h('div', { class: 'tip-foot' }, m.footer.map(lineEl)) : null,
  );
}

export function itemTooltip(stack: ItemStack, opts?: ItemTipOptions): HTMLElement {
  return renderTip(itemTipModel(stack, opts));
}

export function skillTooltip(id: string, level?: number, opts?: { showReq?: boolean }): HTMLElement {
  return renderTip(skillTipModel(id, level, opts));
}

export function talentTooltip(id: string): HTMLElement {
  return renderTip(talentTipModel(id));
}

/** Show tooltip content next to an anchor rect (flips to stay on screen). */
export function showTooltip(content: TipContent, anchor: DOMRect | { x: number; y: number }, owner?: HTMLElement): void {
  if (content === null || content === undefined) return hideTooltip();
  const el = ensureTip();
  el.replaceChildren(typeof content === 'string' ? h('div', { class: 'tip-plain' }, content) : content);
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  currentOwner = owner ?? null;
  const rect = 'width' in anchor ? anchor : new DOMRect(anchor.x, anchor.y, 0, 0);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const gap = 10;
  const fitsRight = rect.right + gap + tw <= vw - 8;
  const fitsLeft = rect.left - gap - tw >= 8;
  let x: number;
  let y: number;
  if (fitsRight || fitsLeft) {
    x = fitsRight ? rect.right + gap : rect.left - gap - tw;
    y = rect.top + rect.height / 2 - th / 2;
  } else {
    x = rect.left + rect.width / 2 - tw / 2;
    y = rect.top - gap - th >= 8 ? rect.top - gap - th : rect.bottom + gap;
  }
  x = Math.max(8, Math.min(vw - tw - 8, x));
  y = Math.max(8, Math.min(vh - th - 8, y));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTooltip(owner?: HTMLElement): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  if (owner && currentOwner && owner !== currentOwner) return;
  if (!tipEl) return;
  tipEl.classList.remove('show');
  tipEl.setAttribute('aria-hidden', 'true');
  currentOwner = null;
}

/**
 * Attach a lazily built tooltip to an element. Mouse: hover after a short delay. Keyboard: on focus.
 * Touch: long-press (~450 ms). Returns a detach function.
 */
export function attachTooltip(el: HTMLElement, content: () => TipContent, opts: { delay?: number } = {}): () => void {
  const delay = opts.delay ?? 280;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const show = () => showTooltip(content(), el.getBoundingClientRect(), el);
  const onEnter = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse') return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(show, delay);
  };
  const onLeave = () => hideTooltip(el);
  const onDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse') return;
    pressTimer = setTimeout(() => {
      show();
      el.dataset.tipShown = '1';
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  const onUp = () => {
    cancelPress();
    if (el.dataset.tipShown) setTimeout(() => hideTooltip(el), 1600);
    delete el.dataset.tipShown;
  };
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' && pressTimer && (Math.abs(ev.movementX) > 4 || Math.abs(ev.movementY) > 4)) cancelPress();
  });
  el.addEventListener('focus', show);
  el.addEventListener('blur', onLeave);
  return () => {
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('focus', show);
    el.removeEventListener('blur', onLeave);
    hideTooltip(el);
  };
}

/** Tooltips must not outlive their owners when panels re-render. */
export function hideTooltipIfDetached(): void {
  if (currentOwner && !currentOwner.isConnected) hideTooltip();
}
