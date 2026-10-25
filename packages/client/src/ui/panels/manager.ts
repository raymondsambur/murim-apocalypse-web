/**
 * PanelManager: floating, draggable, closable windows on desktop (positions remembered in localStorage),
 * full-screen sheets on narrow screens. Several can be open at once. Open panels re-render when a watched
 * store key changes (coalesced per animation frame, deferred while the player is typing inside the panel).
 */
import { t } from '../../i18n';
import type { StoreKey } from '../../state/store';
import type { UiContext } from '../context';
import { h, isNarrow, isTypingTarget, loadJson, saveJson } from '../dom';
import { hideTooltipIfDetached } from '../widgets/tooltip';
import { getPanel, type PanelDef } from './registry';

interface OpenPanel {
  def: PanelDef;
  el: HTMLElement;
  body: HTMLElement;
  dirty: boolean;
  pending: Set<StoreKey>;
  returnFocus: HTMLElement | null;
}

type Pos = { x: number; y: number };
const POS_KEY = 'murim.panels.pos.v1';

export class PanelManager {
  private open = new Map<string, OpenPanel>();
  private z = 20;
  private positions: Record<string, Pos>;
  private changed = new Set<StoreKey>();
  private raf = 0;
  private listeners = new Set<() => void>();
  private unsub: () => void;
  private onResize = () => this.clampAll();
  private ui!: UiContext;

  constructor(private host: HTMLElement) {
    this.positions = loadJson<Record<string, Pos>>(POS_KEY, {});
    this.unsub = () => {};
    window.addEventListener('resize', this.onResize);
  }

  /** Called once the UiContext exists (it references this manager). */
  attach(ui: UiContext): void {
    this.ui = ui;
    this.unsub = ui.state.subscribeAll((k) => this.onStore(k));
  }

  destroy(): void {
    this.unsub();
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.raf);
    for (const id of [...this.open.keys()]) this.close(id);
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  openIds(): string[] {
    return [...this.open.keys()];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toggle(id: string): void {
    if (this.open.has(id)) {
      // A panel hidden behind others is brought forward first instead of closed.
      const p = this.open.get(id)!;
      if (!isNarrow() && Number(p.el.style.zIndex) < this.z) this.front(p);
      else this.close(id);
    } else this.show(id);
  }

  show(id: string): void {
    const existing = this.open.get(id);
    if (existing) {
      this.front(existing);
      existing.el.focus({ preventScroll: true });
      return;
    }
    const def = getPanel(id);
    if (!def) {
      console.warn(`[panels] unknown panel '${id}'`);
      return;
    }
    const titleId = `win-title-${def.id}`;
    const body = h('div', { class: 'win-body', 'data-scroll-key': 'body' });
    const closeBtn = h('button', { class: 'btn-icon btn-close win-close', type: 'button', 'aria-label': t('common.closePanel', { name: t(def.title) }), onclick: () => this.close(id) }, '✕');
    const head = h(
      'header',
      { class: 'win-head' },
      h('span', { class: 'seal win-seal', 'aria-hidden': 'true' }, def.glyph),
      h('h2', { class: 'win-title', id: titleId }, t(def.title)),
      def.placeholder ? h('span', { class: 'chip chip-warn' }, t('panel.draft')) : null,
      def.hotkey ? h('kbd', { class: 'win-key', 'aria-hidden': 'true' }, def.hotkey.toUpperCase()) : null,
      closeBtn,
    );
    const el = h('section', { class: 'win parchment', role: 'dialog', 'aria-labelledby': titleId, tabindex: '-1', dataset: { panel: id } }, head, body);
    el.style.setProperty('--win-w', `${(def.width ?? 420) / 16}rem`);
    const p: OpenPanel = { def, el, body, dirty: false, pending: new Set(), returnFocus: document.activeElement as HTMLElement | null };
    this.open.set(id, p);
    this.host.appendChild(el);
    this.place(p);
    this.front(p);
    this.enableDrag(p, head);
    el.addEventListener('pointerdown', () => this.front(p));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !isTypingTarget(ev.target)) {
        ev.stopPropagation();
        this.close(id);
      }
    });
    body.addEventListener('focusout', () => {
      // Apply a deferred re-render once focus leaves the field being edited.
      setTimeout(() => {
        if (p.dirty && !this.typingIn(p)) this.renderPanel(p, p.pending);
      }, 0);
    });
    try {
      def.onOpen?.(this.ui);
    } catch (e) {
      console.error(e);
    }
    this.renderPanel(p, new Set());
    // Force a style flush so the entrance transition runs without waiting for a frame (hidden tabs never get one).
    void el.offsetWidth;
    el.classList.add('win-in');
    el.focus({ preventScroll: true });
    this.emitChange();
  }

  close(id: string): void {
    const p = this.open.get(id);
    if (!p) return;
    this.open.delete(id);
    try {
      p.def.onClose?.(this.ui);
    } catch (e) {
      console.error(e);
    }
    p.el.remove();
    hideTooltipIfDetached();
    if (p.returnFocus?.isConnected) p.returnFocus.focus({ preventScroll: true });
    this.emitChange();
  }

  /** Close the top-most panel. Returns false when none was open. */
  closeTop(): boolean {
    let top: OpenPanel | null = null;
    for (const p of this.open.values()) if (!top || Number(p.el.style.zIndex) > Number(top.el.style.zIndex)) top = p;
    if (!top) return false;
    this.close(top.def.id);
    return true;
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.close(id);
  }

  /** Forget remembered window positions; open windows return to the default cascade. */
  resetPositions(): void {
    this.positions = {};
    saveJson(POS_KEY, {});
    let n = 0;
    for (const p of this.open.values()) {
      if (isNarrow()) break;
      const w = p.el.offsetWidth || 420;
      this.setPos(p, { x: Math.round(Math.max(16, (window.innerWidth - w) / 2 + n * 28 - 120)), y: 84 + n * 28 });
      n++;
    }
  }

  /** Force a re-render of one panel (or all open panels). */
  refresh(id?: string): void {
    for (const p of this.open.values()) if (!id || p.def.id === id) this.renderPanel(p, new Set());
  }

  // -------------------------------------------------------------------------

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  private onStore(k: StoreKey): void {
    if (!this.open.size) return;
    this.changed.add(k);
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const changed = this.changed;
      this.changed = new Set();
      for (const p of this.open.values()) {
        const watch = p.def.watch ?? ['me'];
        const hit = [...changed].filter((c) => watch.includes(c));
        if (!hit.length) continue;
        for (const c of hit) p.pending.add(c);
        if (this.typingIn(p)) {
          p.dirty = true;
          continue;
        }
        this.renderPanel(p, p.pending);
      }
    });
  }

  private typingIn(p: OpenPanel): boolean {
    const a = document.activeElement;
    return !!a && p.body.contains(a) && isTypingTarget(a);
  }

  private renderPanel(p: OpenPanel, changed: Set<StoreKey>): void {
    const keys = new Set(changed);
    p.pending.clear();
    p.dirty = false;
    try {
      if (keys.size && p.def.update && p.def.update(p.body, this.ui, keys)) return;
      const scrolls = new Map<string, number>();
      p.el.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((s) => scrolls.set(s.dataset.scrollKey!, s.scrollTop));
      p.body.replaceChildren();
      p.def.render(p.body, this.ui);
      p.el.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((s) => {
        const v = scrolls.get(s.dataset.scrollKey!);
        if (v) s.scrollTop = v;
      });
    } catch (e) {
      console.error(`[panels] render of '${p.def.id}' failed`, e);
      p.body.replaceChildren(h('p', { class: 'empty-note tone-bad' }, t('panel.error')));
    }
    hideTooltipIfDetached();
  }

  private front(p: OpenPanel): void {
    p.el.style.zIndex = String(++this.z);
    for (const o of this.open.values()) o.el.classList.toggle('win-top', o === p);
  }

  private place(p: OpenPanel): void {
    if (isNarrow()) return;
    const saved = this.positions[p.def.id];
    const vw = window.innerWidth;
    const w = p.el.offsetWidth || 420;
    let pos: Pos;
    if (saved) pos = saved;
    else {
      const n = this.open.size - 1;
      pos = { x: Math.round(Math.max(16, (vw - w) / 2 + n * 28 - 120)), y: Math.round(84 + n * 28) };
    }
    this.setPos(p, pos);
  }

  private setPos(p: OpenPanel, pos: Pos): Pos {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = p.el.offsetWidth || 420;
    const x = Math.max(8 - w + 120, Math.min(vw - 120, pos.x));
    const y = Math.max(8, Math.min(vh - 56, pos.y));
    p.el.style.left = `${x}px`;
    p.el.style.top = `${y}px`;
    return { x, y };
  }

  private clampAll(): void {
    for (const p of this.open.values()) {
      if (isNarrow()) {
        p.el.style.left = '';
        p.el.style.top = '';
        continue;
      }
      const r = p.el.getBoundingClientRect();
      this.setPos(p, { x: r.left, y: r.top });
    }
  }

  private enableDrag(p: OpenPanel, handle: HTMLElement): void {
    let start: { px: number; py: number; x: number; y: number } | null = null;
    handle.addEventListener('pointerdown', (ev) => {
      if (isNarrow() || ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return;
      const r = p.el.getBoundingClientRect();
      start = { px: ev.clientX, py: ev.clientY, x: r.left, y: r.top };
      handle.setPointerCapture(ev.pointerId);
      p.el.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!start) return;
      this.setPos(p, { x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py });
    });
    const end = () => {
      if (!start) return;
      start = null;
      p.el.classList.remove('dragging');
      const r = p.el.getBoundingClientRect();
      this.positions[p.def.id] = { x: Math.round(r.left), y: Math.round(r.top) };
      saveJson(POS_KEY, this.positions);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', (ev) => {
      if ((ev.target as HTMLElement).closest('button') || isNarrow()) return;
      delete this.positions[p.def.id];
      saveJson(POS_KEY, this.positions);
      const w = p.el.offsetWidth;
      this.setPos(p, { x: (window.innerWidth - w) / 2, y: 84 });
    });
  }
}
