/** Runs a context action (from the context card, a quick tap or a right-click) against the server. */
import type { EntityView } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { canInviteToSect, quickAction, type ActionContext, type ContextActionId } from '../logic/interact';

export function actionContext(ui: UiContext): ActionContext {
  const { state } = ui;
  const me = state.get('me');
  return {
    selfId: state.selfId(),
    selfDead: isDead(ui),
    inCombat: !!me?.combatId || (!!state.get('combat') && !state.get('combat')!.ended),
    sectRole: me?.sect?.role ?? null,
  };
}

export function isDead(ui: UiContext): boolean {
  const me = ui.state.get('me');
  return !!me && (me.c.hp <= 0 || ui.state.selfEntity()?.state === 'dead');
}

export function runAction(ui: UiContext, id: ContextActionId, e: EntityView): void {
  switch (id) {
    case 'talk':
    case 'attack':
    case 'gather':
      ui.interact(e.id);
      break;
    case 'assist':
      if (e.combatId !== undefined) ui.net.send({ t: 'assist', combat: e.combatId });
      break;
    case 'inspect':
      ui.inspectPlayer({ name: e.name });
      break;
    case 'whisper':
      ui.chat(`/w ${e.name.includes(' ') ? `"${e.name}"` : e.name} `);
      break;
    case 'friend':
      if (ui.net.send({ t: 'friend', op: 'add', name: e.name })) ui.toast(t('act.friendSent', { name: e.name }), 'info');
      break;
    case 'sectInvite':
      if (canInviteToSect(ui.state.get('me')?.sect?.role ?? null) && ui.net.send({ t: 'sect', op: 'invite', name: e.name })) ui.toast(t('act.sectInviteSent', { name: e.name }), 'info');
      break;
    case 'duel':
      if (ui.net.send({ t: 'duel', op: 'challenge', id: e.id })) ui.toast(t('act.duelSent', { name: e.name }), 'info');
      break;
  }
}

/** Right-click / long-press / second tap. */
export function runQuickAction(ui: UiContext, e: EntityView): void {
  const a = quickAction(e, actionContext(ui));
  if (a) runAction(ui, a.id, e);
}
