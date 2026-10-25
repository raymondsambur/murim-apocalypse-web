/** Top-left player card: portrait, name, rank colour, HP / Qi / XP bars, gold and status chips. */
import { isBreakthroughLevel, levelLabel } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { fmtDuration, fmtInt, rankColor } from '../format';
import { glyph, h } from '../dom';
import { drawLook } from '../portrait';
import { bar } from '../widgets/bar';
import { attachTooltip } from '../widgets/tooltip';

export function mountPlayerCard(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const { state } = ui;
  const portrait = h('canvas', { class: 'pcard-portrait', width: 56, height: 80, 'aria-hidden': 'true' });
  const name = h('span', { class: 'pcard-name' });
  const rank = h('span', { class: 'pcard-rank' });
  const hp = bar('hp', { label: t('hud.health'), tag: 'HP', size: 'sm' });
  const qi = bar('qi', { label: t('hud.qi'), tag: 'QI', size: 'sm' });
  const xp = bar('xp', { label: t('hud.xp'), tag: 'XP', size: 'sm' });
  const gold = h('span', { class: 'chip chip-gold pcard-gold' });
  const injury = h('span', { class: 'chip chip-bad', hidden: true });
  const fighting = h('span', { class: 'chip chip-warn', hidden: true }, glyph('swords'), t('hud.inCombat'));
  const points = h('button', { class: 'chip chip-good pcard-points', type: 'button', hidden: true, onclick: () => ui.panels.show('character') });
  attachTooltip(gold, () => t('hud.goldTip'));
  attachTooltip(injury, () => t('hud.injuryTip'));
  attachTooltip(points, () => t('hud.pointsTip'));

  const open = h(
    'button',
    { class: 'pcard-open', type: 'button', 'aria-label': t('hud.openCharacter'), onclick: () => ui.panels.toggle('character') },
    portrait,
    h('span', { class: 'pcard-id' }, name, rank),
  );
  const el = h('section', { class: 'pcard glass', 'aria-label': t('hud.playerCard') }, open, h('div', { class: 'pcard-bars' }, hp.el, qi.el, xp.el), h('div', { class: 'pcard-meta' }, gold, injury, fighting, points));
  host.appendChild(el);

  let lookKey = '';
  const update = () => {
    const me = state.get('me');
    if (!me) return;
    const c = me.c;
    const v = state.selfVitals()!;
    name.textContent = c.name;
    rank.textContent = levelLabel(c.level);
    rank.style.color = rankColor(c.level);
    hp.set(v.hp, v.maxHp);
    qi.set(v.qi, v.maxQi);
    const full = c.xp >= me.xpNext;
    xp.set(c.xp, me.xpNext, isBreakthroughLevel(c.level) && full ? t('hud.readyBreak') : undefined);
    gold.textContent = '';
    gold.append(glyph('coin'), fmtInt(c.gold));
    const left = c.injuryUntil - state.serverNow();
    injury.hidden = left <= 0;
    if (left > 0) injury.textContent = t('hud.injured', { n: c.injuryStacks, time: fmtDuration(left) });
    const cb = state.get('combat');
    fighting.hidden = !(me.combatId || (cb && !cb.ended));
    points.hidden = c.statPoints <= 0;
    points.textContent = t('hud.points', { n: c.statPoints });
    const key = JSON.stringify(c.look);
    if (key !== lookKey) {
      lookKey = key;
      drawLook(ui.render, portrait, c.look, 56, 80, 2, { dir: 0, state: 'idle', backdrop: false });
    }
  };
  update();
  const unsub = state.subscribe(['me', 'combat', 'serverOffset'], update);
  const timer = window.setInterval(update, 5000);
  return {
    destroy() {
      unsub();
      clearInterval(timer);
      el.remove();
    },
  };
}
