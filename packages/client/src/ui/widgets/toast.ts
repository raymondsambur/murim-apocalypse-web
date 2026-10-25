/** Toast notifications (server `note` messages, local feedback). Identical toasts in a row stack a counter. */
import type { NoteLevel } from '@murim/shared';
import { t } from '../../i18n';
import { h } from '../dom';

const LEVEL_GLYPH: Record<NoteLevel, string> = { info: '訊', good: '吉', warn: '警', bad: '凶' };
const MAX = 5;

let host: HTMLElement | null = null;

export function initToasts(container?: HTMLElement): HTMLElement {
  if (host && host.isConnected && !container) return host;
  host = container ?? h('div', { class: 'toasts', 'aria-live': 'polite', role: 'status' });
  if (!host.isConnected) document.body.appendChild(host);
  return host;
}

export interface ToastOptions {
  /** Milliseconds before auto-dismiss (default scales with length). */
  ttl?: number;
  glyph?: string;
  action?: { label: string; run: () => void };
}

export function toast(text: string, level: NoteLevel = 'info', opts: ToastOptions = {}): void {
  const root = initToasts();
  const last = root.lastElementChild as HTMLElement | null;
  if (last && last.dataset.text === text && last.dataset.level === level && !last.classList.contains('leaving')) {
    const n = Number(last.dataset.count ?? '1') + 1;
    last.dataset.count = String(n);
    const c = last.querySelector('.toast-count');
    if (c) c.textContent = `×${n}`;
    restart(last, opts.ttl ?? ttlFor(text));
    return;
  }
  const el = h(
    'div',
    { class: ['toast', `toast-${level}`], dataset: { text, level, count: 1 } },
    h('span', { class: 'toast-glyph', 'aria-hidden': 'true' }, opts.glyph ?? LEVEL_GLYPH[level]),
    h('span', { class: 'toast-text' }, text),
    h('span', { class: 'toast-count', 'aria-hidden': 'true' }),
    opts.action
      ? h(
          'button',
          {
            class: 'btn btn-xs btn-gold',
            type: 'button',
            onclick: () => {
              opts.action!.run();
              dismiss(el);
            },
          },
          opts.action.label,
        )
      : null,
    h('button', { class: 'toast-x', type: 'button', 'aria-label': t('common.dismiss'), onclick: () => dismiss(el) }, '✕'),
  );
  root.appendChild(el);
  const live = [...root.children].filter((c) => !c.classList.contains('leaving')) as HTMLElement[];
  for (let i = 0; i < live.length - MAX; i++) dismiss(live[i], true);
  restart(el, opts.ttl ?? ttlFor(text));
}

function ttlFor(text: string): number {
  return Math.min(9000, 3200 + text.length * 45);
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function restart(el: HTMLElement, ttl: number): void {
  const prev = timers.get(el);
  if (prev) clearTimeout(prev);
  timers.set(
    el,
    setTimeout(() => dismiss(el), ttl),
  );
}

function dismiss(el: HTMLElement, instant = false): void {
  if (!el || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), instant ? 0 : 260);
}
