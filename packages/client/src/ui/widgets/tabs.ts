/** Accessible tab strip (role=tablist, arrow-key navigation, optional unread badges). */
import { h } from '../dom';
import { icon } from '../icons';

export interface TabDef {
  id: string;
  label: string;
  /** Icon name (see ui/icons.ts). */
  glyph?: string;
  badge?: number;
  disabled?: boolean;
}

export interface TabsHandle {
  el: HTMLDivElement;
  select(id: string, notify?: boolean): void;
  setBadge(id: string, n: number): void;
  current(): string;
}

export function tabs(defs: TabDef[], onSelect: (id: string) => void, opts: { initial?: string; label?: string; cls?: string } = {}): TabsHandle {
  let cur = opts.initial ?? defs.find((d) => !d.disabled)?.id ?? '';
  const buttons = new Map<string, HTMLButtonElement>();
  const badges = new Map<string, HTMLSpanElement>();
  const el = h('div', { class: ['tabs', opts.cls], role: 'tablist', 'aria-label': opts.label });

  const select = (id: string, notify = true) => {
    if (!buttons.has(id)) return;
    cur = id;
    for (const [bid, b] of buttons) {
      const on = bid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (notify) onSelect(id);
  };

  for (const d of defs) {
    const badge = h('span', { class: 'badge', hidden: !(d.badge && d.badge > 0) }, d.badge ? String(d.badge) : '');
    const b = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'aria-selected': String(d.id === cur),
        tabindex: d.id === cur ? '0' : '-1',
        disabled: d.disabled,
        onclick: () => select(d.id),
      },
      d.glyph ? h('span', { class: 'tab-glyph', 'aria-hidden': 'true' }, icon(d.glyph)) : null,
      h('span', { class: 'tab-label' }, d.label),
      badge,
    );
    buttons.set(d.id, b);
    badges.set(d.id, badge);
    el.appendChild(b);
  }

  el.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
    const ids = defs.filter((d) => !d.disabled).map((d) => d.id);
    let i = ids.indexOf(cur);
    if (ev.key === 'ArrowRight') i = (i + 1) % ids.length;
    else if (ev.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (ev.key === 'Home') i = 0;
    else i = ids.length - 1;
    select(ids[i]);
    buttons.get(ids[i])?.focus();
    ev.preventDefault();
  });

  return {
    el,
    select,
    setBadge(id, n) {
      const b = badges.get(id);
      if (!b) return;
      b.hidden = n <= 0;
      b.textContent = n > 99 ? '99+' : String(n);
    },
    current: () => cur,
  };
}
