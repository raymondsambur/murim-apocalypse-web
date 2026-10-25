/** Small card for the selected entity: name, level, health, tag, and the actions that make sense for it. */
import { FACTION_BY_ID, type EntityView } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h, mount } from '../dom';
import { rankColorOfRank } from '../format';
import { contextActions, entityGlyph, entityKindKey, tileDistance } from '../logic/interact';
import { drawLook } from '../portrait';
import { bar } from '../widgets/bar';
import { actionContext, runAction } from './actions';

/** Fields that change what the card shows. Position is deliberately excluded so walking does not rebuild it. */
export function cardSignature(e: EntityView, extra: string): string {
  return [e.id, e.name, e.lv, e.hp, e.maxHp, e.state, e.tag, e.online, e.combatId, e.elite, e.rank, e.role, extra].join('|');
}

export function mountContextCard(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const { state } = ui;
  const el = h('section', { class: 'ctx glass', hidden: true, 'aria-live': 'polite' });
  host.appendChild(el);
  let sig = '';
  let distEl: HTMLElement | null = null;

  const render = () => {
    const id = state.get('selected');
    const e = id !== null ? state.get('entities').get(id) : undefined;
    if (!e || id === state.selfId()) {
      el.hidden = true;
      sig = '';
      el.replaceChildren();
      return;
    }
    const ac = actionContext(ui);
    const s = cardSignature(e, `${ac.inCombat}${ac.selfDead}${ac.sectRole}`);
    if (s === sig && !el.hidden) {
      updateDistance(e);
      return;
    }
    sig = s;
    el.hidden = false;
    el.dataset.kind = e.kind;

    // portrait
    let portrait: HTMLElement;
    if (e.look) {
      const c = h('canvas', { class: 'ctx-portrait', width: 48, height: 64, 'aria-hidden': 'true' });
      drawLook(ui.render, c, e.look, 48, 64, 1.6, { dir: 0, backdrop: false, weapon: e.weapon });
      portrait = c;
    } else portrait = h('span', { class: ['seal', e.kind === 'monster' && 'seal-monster', !!e.elite && 'seal-elite'] }, entityGlyph(e));

    const nameColor = e.kind === 'player' && e.rank ? rankColorOfRank(e.rank) : e.kind === 'monster' ? (e.elite ? 'var(--warn)' : '#e8a090') : e.kind === 'npc' ? '#bfe8d5' : 'var(--text)';
    const faction = e.faction ? FACTION_BY_ID[e.faction] : undefined;
    distEl = h('span', { class: 'ctx-dist' });
    const chips: HTMLElement[] = [];
    if (e.lv) chips.push(h('span', { class: 'chip chip-gold' }, t('ctx.level', { n: e.lv })));
    if (e.elite) chips.push(h('span', { class: 'chip chip-warn' }, t(e.elite === 2 ? 'kind.boss' : 'kind.elite')));
    if (e.tag) chips.push(h('span', { class: 'chip chip-info' }, e.tag));
    if (faction) chips.push(h('span', { class: 'chip', style: { color: faction.color, borderColor: faction.color } }, faction.short));
    if (e.state && e.state !== 'idle' && e.state !== 'walk') chips.push(h('span', { class: ['chip', e.state === 'dead' ? 'chip-bad' : e.state === 'fight' ? 'chip-warn' : 'chip-good'] }, t(`state.${e.state}`)));

    let hpBar: HTMLElement | null = null;
    if (e.hp !== undefined && e.maxHp) {
      const b = bar('enemy', { label: t('hud.health'), size: 'sm' });
      b.set(e.hp, e.maxHp);
      hpBar = b.el;
    }

    const actions = contextActions(e, ac).map((a) =>
      h(
        'button',
        {
          class: ['btn', 'btn-sm', a.primary && (a.danger ? 'btn-danger' : 'btn-primary')],
          type: 'button',
          disabled: !!a.disabled,
          title: a.disabled ? t(a.disabled) : undefined,
          onclick: () => runAction(ui, a.id, e),
        },
        h('span', { class: 'glyph', 'aria-hidden': 'true' }, a.glyph),
        t(a.label),
      ),
    );

    mount(
      el,
      h(
        'div',
        { class: 'ctx-head' },
        portrait,
        h('div', { class: 'ctx-id' }, h('div', { class: 'ctx-name', style: { color: nameColor } }, e.name), h('div', { class: 'ctx-sub' }, t(entityKindKey(e)), ' · ', distEl)),
        h('button', { class: 'btn-icon btn-sm btn-close', type: 'button', 'aria-label': t('ctx.close'), onclick: () => ui.select(null) }, '✕'),
      ),
      chips.length ? h('div', { class: 'chip-row' }, chips) : null,
      hpBar,
      actions.length ? h('div', { class: 'ctx-actions' }, actions) : null,
    );
    updateDistance(e);
  };

  const updateDistance = (e: EntityView) => {
    const me = state.selfEntity();
    if (!distEl || !me) return;
    distEl.textContent = t('ctx.distance', { n: Math.max(0, Math.round(tileDistance(me, e))) });
  };

  render();
  const unsub = state.subscribe(['selected', 'entities', 'me', 'combat'], render);
  return {
    destroy() {
      unsub();
      el.remove();
    },
  };
}
