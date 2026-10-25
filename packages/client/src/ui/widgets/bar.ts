/** Resource bars (HP / Qi / XP / generic) with an accessible progressbar role. */
import { h } from '../dom';
import { fmtInt } from '../format';

export type BarKind = 'hp' | 'qi' | 'xp' | 'gold' | 'job' | 'enemy';

export interface BarHandle {
  el: HTMLDivElement;
  set(value: number, max: number, text?: string): void;
}

export interface BarOptions {
  /** Accessible name, e.g. "Health". */
  label: string;
  /** Show "value / max" text inside the bar. Default true. */
  text?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Short label drawn at the left inside the bar (e.g. "HP"). */
  tag?: string;
}

export function bar(kind: BarKind, opts: BarOptions): BarHandle {
  const fill = h('div', { class: 'bar-fill' });
  const ghost = h('div', { class: 'bar-ghost' });
  const txt = h('span', { class: 'bar-text' });
  const el = h(
    'div',
    {
      class: ['bar', `bar-${kind}`, `bar-${opts.size ?? 'md'}`],
      role: 'progressbar',
      'aria-label': opts.label,
      'aria-valuemin': 0,
    },
    ghost,
    fill,
    opts.tag ? h('span', { class: 'bar-tag', 'aria-hidden': 'true' }, opts.tag) : null,
    opts.text === false ? null : txt,
  );
  let last = -1;
  return {
    el,
    set(value, max, text) {
      const m = Math.max(1, max);
      const v = Math.max(0, Math.min(m, value));
      const pct = (v / m) * 100;
      fill.style.width = `${pct}%`;
      // The ghost trails behind on loss, showing the damage just taken.
      if (pct < last) setTimeout(() => (ghost.style.width = `${pct}%`), 350);
      else ghost.style.width = `${pct}%`;
      last = pct;
      el.setAttribute('aria-valuemax', String(Math.round(m)));
      el.setAttribute('aria-valuenow', String(Math.round(v)));
      el.classList.toggle('bar-low', kind === 'hp' && pct < 30);
      if (opts.text !== false) txt.textContent = text ?? `${fmtInt(value)} / ${fmtInt(max)}`;
    },
  };
}
