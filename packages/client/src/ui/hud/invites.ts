/** Pending invitations (friend / sect / master / duel) as small cards with Accept and Decline. */
import { t } from '../../i18n';
import type { Invite } from '../../state/store';
import type { UiContext } from '../context';
import { h } from '../dom';
import { INVITE_GLYPH, INVITE_TTL_MS, inviteReplies, isExpired } from '../logic/invites';

export function mountInvites(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const { state } = ui;
  const el = h('div', { class: 'invites', 'aria-live': 'polite', 'aria-label': t('invite.label') });
  host.appendChild(el);

  const card = (inv: Invite) => {
    const r = inviteReplies(inv);
    const done = () => state.removeInvite(inv.key);
    return h(
      'div',
      { class: 'invite glass', dataset: { kind: inv.kind } },
      h('span', { class: 'seal', 'aria-hidden': 'true' }, INVITE_GLYPH[inv.kind]),
      h('div', { class: 'invite-text' }, t(`invite.${inv.kind}`, { name: inv.from })),
      h(
        'div',
        { class: 'invite-actions' },
        h(
          'button',
          {
            class: 'btn btn-sm btn-primary',
            type: 'button',
            disabled: !r.accept,
            onclick: () => {
              if (r.accept) ui.net.send(r.accept);
              done();
            },
          },
          t('invite.accept'),
        ),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            onclick: () => {
              if (r.decline) ui.net.send(r.decline);
              done();
            },
          },
          t('invite.decline'),
        ),
      ),
    );
  };

  const render = () => {
    const now = Date.now();
    for (const inv of [...state.get('invites')]) if (isExpired(inv, now, INVITE_TTL_MS)) state.removeInvite(inv.key);
    el.replaceChildren(...state.get('invites').map(card));
  };
  render();
  const unsub = state.subscribe('invites', render);
  const timer = window.setInterval(render, 5000);
  return {
    destroy() {
      unsub();
      clearInterval(timer);
      el.remove();
    },
  };
}
