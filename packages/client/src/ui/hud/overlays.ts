/** Full-screen states: entering the world, connection lost / replaced / kicked, and the death overlay. */
import { t } from '../../i18n';
import type { GameSocket } from '../../net/socket';
import type { UiContext } from '../context';
import { h } from '../dom';
import { connectionView, type ConnView } from '../logic/connection';
import { isDead } from './actions';

export interface OverlayOptions {
  socket: GameSocket;
  /** Back to the sign-in screen, optionally with a notice. */
  onReauth(notice?: string): void;
}

export function mountOverlays(host: HTMLElement, ui: UiContext, o: OverlayOptions): { destroy(): void } {
  const { state } = ui;
  const conn = h('div', { class: 'overlay conn-overlay', hidden: true, role: 'alertdialog', 'aria-live': 'assertive' });
  const death = h('div', { class: 'death-overlay', hidden: true, role: 'status' });
  host.append(death, conn);

  let retryAt = 0;
  let lastKind = '';
  const countdown = h('span', { class: 'conn-count' });

  const card = (glyph: string, title: string, text: string | null, actions: HTMLElement[], spinner = false) =>
    h(
      'div',
      { class: 'overlay-card parchment' },
      h('span', { class: ['seal', 'seal-lg', spinner && 'seal-pulse'], 'aria-hidden': 'true' }, glyph),
      h('h2', { class: 'overlay-title' }, title),
      text ? h('p', { class: 'overlay-text' }, text) : null,
      spinner ? h('div', { class: 'overlay-spin' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })) : null,
      actions.length ? h('div', { class: 'modal-actions' }, actions) : null,
    );

  const paintConn = () => {
    const v: ConnView = connectionView(state.get('conn'), !!state.get('me'), state.get('kicked'));
    conn.hidden = v.kind === 'none';
    if (v.kind === 'none') {
      lastKind = '';
      conn.replaceChildren();
      return;
    }
    if (v.kind === 'reconnecting') retryAt = Date.now() + (v.retryIn ?? 0);
    const key = v.kind + (v.kind === 'reconnecting' ? v.attempt : '');
    if (key === lastKind) return;
    lastKind = key;
    const retry = h('button', { class: 'btn', type: 'button', onclick: () => o.socket.retryNow() }, t('conn.retryNow'));
    const toLogin = (msg?: string) => h('button', { class: 'btn btn-primary', type: 'button', onclick: () => o.onReauth(msg) }, t('conn.toLogin'));
    switch (v.kind) {
      case 'loading':
        conn.replaceChildren(card('武', t('conn.entering'), t('conn.enteringText'), [], true));
        break;
      case 'reconnecting':
        conn.replaceChildren(
          card('斷', t('conn.lost'), null, [retry], true),
        );
        conn.querySelector('.overlay-title')!.after(h('p', { class: 'overlay-text' }, t('conn.attempt', { n: v.attempt }), ' ', countdown));
        break;
      case 'replaced':
        conn.replaceChildren(card('他', t('conn.replaced'), t('conn.replacedText'), [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, t('conn.playHere'))]));
        break;
      case 'auth':
        conn.replaceChildren(card('期', t('conn.expired'), t('conn.expiredText'), [toLogin(t('err.sessionExpired'))]));
        break;
      case 'banned':
        conn.replaceChildren(card('禁', t('conn.banned'), t('conn.bannedText'), [toLogin()]));
        break;
      case 'kicked':
        conn.replaceChildren(card('離', t('conn.kicked'), v.reason || t('conn.kickedText'), [toLogin()]));
        break;
      case 'failed':
        conn.replaceChildren(card('斷', t('conn.failed'), t('conn.failedText'), [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, t('conn.reload'))]));
        break;
    }
    const first = conn.querySelector<HTMLElement>('button');
    if (v.kind !== 'loading' && v.kind !== 'reconnecting') first?.focus();
  };

  const tick = () => {
    if (lastKind.startsWith('reconnecting')) {
      const s = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      countdown.textContent = s > 0 ? t('conn.retryIn', { n: s }) : t('conn.retrying');
    }
  };

  const paintDeath = () => {
    const dead = !!state.get('me') && isDead(ui);
    death.hidden = !dead;
    if (!dead) {
      death.replaceChildren();
      return;
    }
    if (death.childElementCount) return;
    death.replaceChildren(
      h(
        'div',
        { class: 'death-card' },
        h('span', { class: 'death-glyph glyph', 'aria-hidden': 'true' }, '亡'),
        h('h2', { class: 'death-title' }, t('death.title')),
        h('p', { class: 'death-text' }, t('death.text')),
        h('div', { class: 'overlay-spin' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' ', t('death.waking')),
      ),
    );
  };

  paintConn();
  paintDeath();
  const unsubs = [state.subscribe(['conn', 'me', 'kicked'], paintConn), state.subscribe(['me', 'entities'], paintDeath)];
  const timer = window.setInterval(tick, 250);
  return {
    destroy() {
      unsubs.forEach((u) => u());
      clearInterval(timer);
      conn.remove();
      death.remove();
    },
  };
}
