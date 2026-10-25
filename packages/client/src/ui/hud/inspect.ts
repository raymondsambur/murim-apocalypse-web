/** Another player's public profile in a modal. */
import { STAT_INFO, STAT_KEYS, levelLabel, rankOf, type PublicProfile } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtInt, rankColorOfRank } from '../format';
import { drawLook } from '../portrait';
import { itemSlot } from '../widgets/itemSlot';
import { openModal } from '../widgets/modal';

export async function inspectPlayer(ui: UiContext, target: { id?: number; name?: string }): Promise<void> {
  let profile: PublicProfile | null;
  try {
    profile = await ui.net.query('player', target);
  } catch (e) {
    ui.toast(queryErrorMessage(e), 'bad');
    return;
  }
  if (!profile) {
    ui.toast(t('inspect.notFound'), 'warn');
    return;
  }
  const p = profile;
  const isSelf = ui.state.get('me')?.c.id === p.id || ui.state.get('me')?.c.name === p.name;
  openModal(
    (close) => {
      const portrait = h('canvas', { class: 'inspect-portrait', width: 96, height: 144, 'aria-hidden': 'true' });
      queueMicrotask(() => drawLook(ui.render, portrait, p.look, 96, 144, 4, { dir: 0, state: 'idle', backdrop: true }));
      const color = rankColorOfRank(p.rank || rankOf(p.level));
      const eq = p.equipment;
      return h(
        'div',
        { class: 'inspect' },
        h(
          'div',
          { class: 'inspect-top' },
          portrait,
          h(
            'div',
            { class: 'inspect-id' },
            h('div', { class: 'inspect-name', style: { color } }, p.name),
            h('div', { class: 'inspect-rank', style: { color } }, levelLabel(p.level)),
            p.title ? h('div', { class: 'inspect-title' }, p.title) : null,
            h('div', { class: 'chip-row' }, p.sect ? h('span', { class: 'chip chip-info' }, p.sect) : h('span', { class: 'chip' }, t('inspect.noSect')), h('span', { class: 'chip chip-good' }, t('inspect.kills', { n: fmtInt(p.kills) })), h('span', { class: 'chip chip-bad' }, t('inspect.deaths', { n: fmtInt(p.deaths) }))),
          ),
        ),
        h('div', { class: 'sect-title' }, t('inspect.gear')),
        h('div', { class: 'inspect-gear' }, itemSlot(eq.weapon, { size: 'lg', emptyGlyph: '劍', emptyLabel: t('inv.slot.weapon') }), itemSlot(eq.outfit, { size: 'lg', emptyGlyph: '衣', emptyLabel: t('inv.slot.outfit') }), itemSlot(eq.accessory, { size: 'lg', emptyGlyph: '環', emptyLabel: t('inv.slot.accessory') })),
        h('div', { class: 'sect-title' }, t('inspect.stats')),
        h('dl', { class: 'kv' }, ...STAT_KEYS.flatMap((k) => [h('dt', {}, STAT_INFO[k].name), h('dd', {}, String(p.stats[k]))])),
        isSelf
          ? null
          : h(
              'div',
              { class: 'modal-actions inspect-actions' },
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (close(), ui.chat(`/w ${p.name.includes(' ') ? `"${p.name}"` : p.name} `)) }, t('act.whisper')),
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ui.net.send({ t: 'friend', op: 'add', name: p.name }) && ui.toast(t('act.friendSent', { name: p.name }), 'info') }, t('act.friend')),
              h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => ui.net.send({ t: 'duel', op: 'challenge', id: ui.state.entityByName(p.name, 'player')?.id ?? p.id }) && ui.toast(t('act.duelSent', { name: p.name }), 'info') }, t('act.duel')),
            ),
      );
    },
    { title: t('inspect.title'), glyph: '觀', cls: 'modal-inspect' },
  );
}
