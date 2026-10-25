/**
 * World interaction: taps and clicks on the canvas become moves, selections and quick actions.
 *   tap ground            -> move there
 *   tap entity            -> select it (context card); tapping the selected entity again runs its quick action
 *   right-click / long-press on an entity -> select + quick action (talk / attack / gather / inspect)
 */
import { t } from '../../i18n';
import type { PickGesture, PickResult } from '../../render/api';
import type { UiContext } from '../context';
import { actionContext, isDead, runQuickAction } from './actions';

export function mountInteraction(ui: UiContext, canvas: HTMLCanvasElement): { destroy(): void; select(id: number | null): void } {
  const { state, gameView } = ui;
  let destroyed = false;
  let target: { x: number; y: number } | null = null;
  let sentAt = 0;

  const select = (id: number | null) => {
    if (state.get('selected') !== id) state.set('selected', id);
  };
  const unsubSel = state.subscribe('selected', () => gameView.setSelected(state.get('selected')));

  const moveTo = (x: number, y: number) => {
    if (isDead(ui)) return;
    if (actionContext(ui).inCombat) {
      ui.toast(t('act.whyInCombat'), 'warn');
      return;
    }
    if (!ui.net.send({ t: 'move', x, y })) return;
    target = { x, y };
    sentAt = Date.now();
    gameView.setMoveTarget(target);
  };

  gameView.onPick((pick: PickResult, gesture: PickGesture) => {
    if (destroyed) return;
    const self = state.selfId();
    const ent = pick.entityId !== null && pick.entityId !== self ? state.get('entities').get(pick.entityId) : undefined;
    if (gesture === 'hover') {
      canvas.style.cursor = ent ? 'pointer' : '';
      return;
    }
    if (gesture === 'tap') {
      if (ent) {
        if (state.get('selected') === ent.id) runQuickAction(ui, ent);
        else select(ent.id);
      } else {
        select(null);
        moveTo(pick.x, pick.y);
      }
      return;
    }
    // context (right-click / long-press)
    if (ent) {
      select(ent.id);
      runQuickAction(ui, ent);
    } else {
      moveTo(pick.x, pick.y);
    }
  });

  // Clear the destination marker once we arrive (or the walk was cancelled / blocked).
  const unsubEnts = state.subscribe('entities', () => {
    if (!target) return;
    const me = state.selfEntity();
    if (!me) return;
    const arrived = me.x === target.x && me.y === target.y && me.nx === undefined;
    const stalled = me.nx === undefined && Date.now() - sentAt > 2500;
    if (arrived || stalled) {
      target = null;
      gameView.setMoveTarget(null);
    }
  });

  return {
    select,
    destroy() {
      destroyed = true;
      unsubSel();
      unsubEnts();
    },
  };
}
