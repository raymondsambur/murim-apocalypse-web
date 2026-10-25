/** Modal dialogs: generic `openModal` and promise-based `confirmModal`. Esc / backdrop click cancel. */
import { t } from '../../i18n';
import { h, type Child } from '../dom';

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

export interface ModalOptions {
  title?: string;
  glyph?: string;
  cls?: string;
  /** Called once when the modal closes for any reason. */
  onClose?: () => void;
  /** Disable closing via backdrop click. */
  sticky?: boolean;
}

const stack: ModalHandle[] = [];

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

/** Close the topmost modal; returns false when none is open. */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function openModal(build: (close: () => void) => Child, opts: ModalOptions = {}): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(handle);
    if (i >= 0) stack.splice(i, 1);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 160);
    opts.onClose?.();
    prevFocus?.focus?.();
  };
  const card = h(
    'div',
    { class: ['modal', 'parchment', opts.cls], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': opts.title ? titleId : undefined },
    opts.title
      ? h(
          'header',
          { class: 'modal-head' },
          opts.glyph ? h('span', { class: 'seal', 'aria-hidden': 'true' }, opts.glyph) : null,
          h('h2', { class: 'modal-title', id: titleId }, opts.title),
          h('button', { class: 'btn-icon btn-close', type: 'button', 'aria-label': t('common.close'), onclick: close }, '✕'),
        )
      : null,
    h('div', { class: 'modal-body' }, build(close)),
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, card);
  backdrop.addEventListener('pointerdown', (ev) => {
    if (ev.target === backdrop && !opts.sticky) close();
  });
  backdrop.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    } else if (ev.key === 'Tab') trapFocus(card, ev);
  });
  document.body.appendChild(backdrop);
  const handle: ModalHandle = { el: card, close };
  stack.push(handle);
  requestAnimationFrame(() => {
    const target = card.querySelector<HTMLElement>('[data-autofocus]') ?? card.querySelector<HTMLElement>('button, [href], input, select, textarea');
    target?.focus();
  });
  return handle;
}

function trapFocus(root: HTMLElement, ev: KeyboardEvent): void {
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    last.focus();
    ev.preventDefault();
  } else if (!ev.shiftKey && document.activeElement === last) {
    first.focus();
    ev.preventDefault();
  }
}

export interface ConfirmOptions {
  title: string;
  text?: Child;
  ok?: string;
  cancel?: string;
  danger?: boolean;
  glyph?: string;
}

export function confirmModal(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v: boolean, close: () => void) => {
      answered = true;
      resolve(v);
      close();
    };
    openModal(
      (close) => [
        o.text ? h('div', { class: 'modal-text' }, o.text) : null,
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => answer(false, close) }, o.cancel ?? t('common.cancel')),
          h('button', { class: ['btn', o.danger ? 'btn-danger' : 'btn-primary'], type: 'button', 'data-autofocus': '', onclick: () => answer(true, close) }, o.ok ?? t('common.confirm')),
        ),
      ],
      {
        title: o.title,
        glyph: o.glyph ?? (o.danger ? '危' : '問'),
        cls: 'modal-confirm',
        onClose: () => {
          if (!answered) resolve(false);
        },
      },
    );
  });
}
