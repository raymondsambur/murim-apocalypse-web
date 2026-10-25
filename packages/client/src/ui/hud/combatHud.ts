/**
 * Combat HUD: both sides' fighters with HP / Qi bars and status icons, a scrolling log in words, a Flee button and a
 * result banner (victory / defeat / fled + rewards) that hides itself after a few seconds.
 */
import type { FighterView } from '@murim/shared';
import { t } from '../../i18n';
import type { CombatLogEntry } from '../../state/store';
import type { UiContext } from '../context';
import { h, mount } from '../dom';
import { fmtInt } from '../format';
import { bannerSeconds, hasReward, mergeRewardItems, resultTone, splitSides } from '../logic/combatView';
import { STATUS_GLYPH, describeCombatEvent, statusName } from '../text/combat';
import { bar } from '../widgets/bar';
import { itemSlot } from '../widgets/itemSlot';
import { attachTooltip } from '../widgets/tooltip';

export function mountCombatHud(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const { state } = ui;
  const el = h('section', { class: 'combat glass', hidden: true, role: 'region', 'aria-label': t('combat.title') });
  host.appendChild(el);

  const title = h('h2', { class: 'combat-title' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, '戰'), h('span', { class: 'combat-title-text' }, t('combat.title')));
  const beat = h('span', { class: 'combat-beat chip' });
  const flee = h(
    'button',
    {
      class: 'btn btn-sm btn-danger combat-flee',
      type: 'button',
      onclick: () => {
        if (ui.net.send({ t: 'flee' })) {
          flee.disabled = true;
          setTimeout(() => (flee.disabled = false), 1200);
        }
      },
    },
    h('span', { class: 'glyph', 'aria-hidden': 'true' }, '逃'),
    t('combat.flee'),
  );
  const head = h('header', { class: 'combat-head' }, title, beat, flee);
  const sides = h('div', { class: 'combat-sides' });
  const log = h('div', { class: 'combat-log', role: 'log', 'aria-live': 'polite', 'aria-label': t('combat.log'), tabindex: '0' });
  const banner = h('div', { class: 'combat-banner', hidden: true, role: 'alert' });
  el.append(head, sides, log, banner);

  const rowCache = new Map<number, { row: HTMLElement; hp: ReturnType<typeof bar>; qi: ReturnType<typeof bar> | null; status: HTMLElement; name: HTMLElement }>();
  let currentId = -1;
  let lastLogKey = 0;
  let hideTimer = 0;
  let bannerFor = -1;

  const fighterRow = (f: FighterView, mine: boolean) => {
    let c = rowCache.get(f.id);
    if (!c) {
      const hp = bar(mine ? 'hp' : 'enemy', { label: t('hud.health'), size: 'sm' });
      const qi = f.maxQi > 0 ? bar('qi', { label: t('hud.qi'), size: 'sm' }) : null;
      const status = h('span', { class: 'fighter-status' });
      const name = h('span', { class: 'fighter-name' });
      const row = h('div', { class: ['fighter', mine ? 'is-mine' : 'is-foe', f.player && 'is-player'] }, h('div', { class: 'fighter-top' }, name, status), hp.el, qi?.el);
      c = { row, hp, qi, status, name };
      rowCache.set(f.id, c);
    }
    const isMe = f.id === state.selfId();
    c.name.textContent = '';
    c.name.append(isMe ? t('combat.you', { name: f.name }) : f.name, h('span', { class: 'fighter-lv' }, ` ${t('ctx.level', { n: f.lv })}`));
    c.hp.set(f.hp, f.maxHp);
    c.qi?.set(f.qi, f.maxQi);
    c.row.classList.toggle('is-down', !f.alive);
    c.row.classList.toggle('is-fled', f.fled);
    c.status.replaceChildren(
      ...(f.fled ? [h('span', { class: 'chip chip-warn' }, t('combat.fled'))] : !f.alive ? [h('span', { class: 'chip chip-bad' }, t('combat.down'))] : []),
      ...f.status.map((st) => {
        const chip = h('span', { class: 'status-chip', tabindex: '0', 'aria-label': statusName(st) }, STATUS_GLYPH[st]);
        attachTooltip(chip, () => statusName(st));
        return chip;
      }),
    );
    return c.row;
  };

  const names = (id: number) => state.get('combat')?.names[id] ?? `#${id}`;
  const logLine = (e: CombatLogEntry) => {
    const c = state.get('combat')!;
    const allies = new Set(splitSides(c.view, state.selfId()).mine.map((f) => f.id));
    const line = describeCombatEvent(e.ev, names, state.selfId(), allies);
    return h('div', { class: ['clog', `tone-${line.tone}`], dataset: { key: e.key } }, h('span', { class: 'clog-beat' }, String(e.beat)), line.text);
  };

  function showBanner(): void {
    const c = state.get('combat');
    const r = c?.ended ?? null;
    banner.hidden = !r;
    flee.hidden = !!r;
    el.classList.toggle('is-ended', !!r);
    if (!r || !c) {
      bannerFor = -1;
      return;
    }
    if (bannerFor === r.id && c.view.id === currentId && banner.childElementCount) return;
    bannerFor = r.id;
    const tone = resultTone(r.result);
    banner.className = `combat-banner tone-banner-${tone}`;
    const reward = hasReward(r.reward) ? r.reward : null;
    mount(
      banner,
      h('div', { class: 'banner-title' }, t(`combat.result.${r.result}`)),
      r.text ? h('div', { class: 'banner-text' }, r.text) : null,
      reward
        ? h(
            'div',
            { class: 'banner-rewards' },
            reward.xp ? h('span', { class: 'chip chip-gold' }, t('combat.reward.xp', { n: fmtInt(reward.xp) })) : null,
            reward.gold ? h('span', { class: 'chip chip-gold' }, t('combat.reward.gold', { n: fmtInt(reward.gold) })) : null,
            ...mergeRewardItems(reward.items).map((it) => itemSlot(it, { size: 'sm' })),
          )
        : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => state.clearCombat(r.id) }, t('common.close')),
    );
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => state.clearCombat(r.id), bannerSeconds(r.result) * 1000);
  }

  const render = () => {
    const c = state.get('combat');
    if (!c) {
      el.hidden = true;
      currentId = -1;
      rowCache.clear();
      log.replaceChildren();
      lastLogKey = 0;
      bannerFor = -1;
      clearTimeout(hideTimer);
      return;
    }
    el.hidden = false;
    if (c.view.id !== currentId) {
      currentId = c.view.id;
      rowCache.clear();
      log.replaceChildren();
      lastLogKey = 0;
      flee.disabled = false;
    }
    beat.textContent = t('combat.beat', { n: c.view.beat });
    const { mine, theirs } = splitSides(c.view, state.selfId());
    const col = (list: FighterView[], isMine: boolean, label: string) =>
      h('div', { class: ['combat-col', isMine ? 'col-mine' : 'col-foe'] }, h('div', { class: 'combat-col-label' }, label), ...list.map((f) => fighterRow(f, isMine)));
    sides.replaceChildren(col(mine, true, t('combat.yourSide')), col(theirs, false, c.view.duel ? t('combat.duelist') : t('combat.foes')));
    // log (incremental)
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    let appended = false;
    for (const e of c.log) {
      if (e.key <= lastLogKey) continue;
      log.appendChild(logLine(e));
      lastLogKey = e.key;
      appended = true;
    }
    while (log.childElementCount > 80) log.firstElementChild?.remove();
    if (appended && stick) log.scrollTop = log.scrollHeight;
    showBanner();
  };

  render();
  const unsub = state.subscribe('combat', render);
  return {
    destroy() {
      unsub();
      clearTimeout(hideTimer);
      el.remove();
    },
  };
}
