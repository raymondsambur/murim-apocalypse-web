/**
 * Character panel: identity, base attributes (spend free points), derived stats with gear totals, the
 * Breakthrough requirements, faction reputation and the life record.
 */
import { FACTIONS, ORIGINS, STAT_INFO, STAT_KEYS, TALENTS, gearTotals, getItem, levelLabel, reputationTitle, stackValue, type MeView, type StatKey } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { fmtDuration, fmtInt, fmtNum, fmtPct, fmtSigned, rankColor } from '../format';
import { breakthroughStatus } from '../logic/breakthrough';
import { drawLook } from '../portrait';
import { bar } from '../widgets/bar';
import { attachTooltip, itemTooltip, talentTooltip } from '../widgets/tooltip';
import { registerPanel } from './registry';

function attributesSection(me: MeView, ui: UiContext): HTMLElement {
  const c = me.c;
  const gear = gearTotals(c.equipment);
  const points = c.statPoints;
  const rows = STAT_KEYS.map((k: StatKey) => {
    const bonus = me.d.total[k] - c.stats[k];
    const info = STAT_INFO[k];
    const add = (n: number) => ui.net.send({ t: 'alloc', stat: k, n });
    const row = h(
      'div',
      { class: 'attr-row' },
      h('div', { class: 'attr-name' }, h('span', { class: 'attr-short' }, info.short), info.name),
      h('div', { class: 'attr-val', 'aria-label': `${info.name} ${c.stats[k]}${bonus ? ` plus ${bonus} from gear` : ''}` }, String(c.stats[k]), bonus ? h('span', { class: ['attr-bonus', bonus > 0 ? 'tone-good' : 'tone-bad'] }, ` ${fmtSigned(bonus)}`) : null),
      h(
        'div',
        { class: 'attr-add' },
        points >= 5 ? h('button', { class: 'btn btn-xs', type: 'button', 'aria-label': t('char.addN', { n: 5, stat: info.name }), onclick: () => add(5) }, '+5') : null,
        h('button', { class: 'btn-icon btn-sm attr-plus', type: 'button', disabled: points <= 0, 'aria-label': t('char.addN', { n: 1, stat: info.name }), onclick: () => add(1) }, '+'),
      ),
    );
    attachTooltip(row, () => `${info.desc}${bonus ? ` ${t('char.fromGear', { n: fmtSigned(bonus) })}` : ''}`, { delay: 500 });
    return row;
  });
  void gear;
  return h(
    'section',
    { class: 'char-sec' },
    h('div', { class: 'sect-title' }, t('char.attributes')),
    points > 0 ? h('div', { class: 'points-banner', role: 'status' }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, '點'), t('char.pointsLeft', { n: points })) : h('p', { class: 'attr-hint' }, t('char.pointsHint')),
    h('div', { class: 'attr-grid' }, rows),
  );
}

function derivedSection(me: MeView): HTMLElement {
  const d = me.d;
  const gear = gearTotals(me.c.equipment);
  const rows: [string, string, string?][] = [
    [t('char.d.hp'), fmtInt(d.maxHp), gear.hp ? fmtSigned(gear.hp) : undefined],
    [t('char.d.qi'), fmtInt(d.maxQi)],
    [t('char.d.atk'), fmtNum(d.atk), gear.atk ? fmtSigned(gear.atk) : undefined],
    [t('char.d.def'), fmtNum(d.def), gear.def ? fmtSigned(gear.def) : undefined],
    [t('char.d.speed'), fmtNum(d.speed)],
    [t('char.d.crit'), `${fmtNum(d.crit)}%`],
    [t('char.d.dodge'), `${fmtNum(d.dodge)}%`],
    [t('char.d.qiRegen'), t('char.perBeat', { n: fmtNum(d.qiRegen, 2) })],
    [t('char.d.learn'), `×${fmtNum(d.learnRate, 2)}`],
    [t('char.d.heal'), fmtInt(d.healPower)],
  ];
  if (d.antiBlight) rows.push([t('char.d.antiBlight'), `+${fmtPct(d.antiBlight)}`]);
  if (d.lifesteal) rows.push([t('char.d.lifesteal'), fmtPct(d.lifesteal)]);
  if (d.resist) rows.push([t('char.d.resist'), fmtPct(d.resist)]);
  if (d.flee) rows.push([t('char.d.flee'), `+${fmtNum(d.flee)}`]);
  return h(
    'section',
    { class: 'char-sec' },
    h('div', { class: 'sect-title' }, t('char.derived')),
    h('dl', { class: 'kv kv-2col' }, ...rows.flatMap(([k, v, g]) => [h('dt', {}, k), h('dd', {}, v, g ? h('span', { class: 'tone-good kv-gear' }, ` (${g})`) : null)])),
    gear.atk || gear.def || gear.hp || Object.keys(gear.stats).length ? h('p', { class: 'kv-note' }, t('char.gearNote')) : null,
  );
}

function breakthroughSection(me: MeView, ui: UiContext): HTMLElement {
  const bt = breakthroughStatus(me);
  const head = h('div', { class: 'sect-title' }, t('char.breakthrough'));
  if (bt.sealed && bt.atPeak) {
    return h('section', { class: 'char-sec' }, head, h('div', { class: 'bt card bt-sealed' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, '封'), h('p', {}, t('bt.sealed'))));
  }
  if (bt.sealed) {
    return h('section', { class: 'char-sec' }, head, h('p', { class: 'attr-hint' }, t('bt.sealedFar')));
  }
  const check = (ok: boolean, text: string, extra?: HTMLElement | null) =>
    h('li', { class: ['bt-item', ok ? 'is-ok' : 'is-missing'] }, h('span', { class: 'bt-mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'), h('span', { class: 'bt-text' }, text), extra ?? null, h('span', { class: 'sr-only' }, ok ? t('bt.met') : t('bt.notMet')));
  const pillTip = bt.pill ? h('button', { class: 'chip chip-gold bt-pill', type: 'button', 'aria-label': bt.pill.name }, getItem(bt.pill.id)?.glyph ?? '丹', ' ', bt.pill.name) : null;
  if (pillTip && bt.pill) attachTooltip(pillTip, () => itemTooltip({ id: bt.pill!.id, qty: 1 }));
  const chanceBar = bar('xp', { label: t('bt.chance'), size: 'md' });
  chanceBar.set(bt.chance * 100, 100, t('bt.chanceText', { n: Math.round(bt.chance * 100) }));
  const atPeak = bt.atPeak;
  const list = h(
    'ul',
    { class: 'bt-list' },
    check(!atPeak ? false : bt.xp.ok, atPeak ? t('bt.xp', { a: fmtInt(bt.xp.have), b: fmtInt(bt.xp.need) }) : t('bt.stage', { n: bt.stagesLeft })),
    check(!!bt.pill?.ok, t('bt.pill', { have: bt.pill?.have ?? 0, need: 1 }), pillTip),
    check(bt.gold.ok, t('bt.gold', { have: fmtInt(bt.gold.have), need: fmtInt(bt.gold.need) })),
  );
  const btn = h(
    'button',
    {
      class: 'btn btn-gold btn-block',
      type: 'button',
      disabled: !bt.ready,
      title: bt.ready ? undefined : bt.blockers.map((b) => t(b)).join(' '),
      onclick: async () => {
        const ok = await ui.confirm({
          title: t('bt.confirmTitle'),
          glyph: '突',
          text: t('bt.confirmText', { rank: bt.nextRankName, chance: Math.round(bt.chance * 100) }),
          ok: t('bt.attempt'),
          danger: bt.chance < 0.6,
        });
        if (ok) ui.net.send({ t: 'breakthrough' });
      },
    },
    h('span', { class: 'glyph', 'aria-hidden': 'true' }, '突'),
    t('bt.attempt'),
  );
  return h(
    'section',
    { class: 'char-sec' },
    head,
    h(
      'div',
      { class: ['bt', 'card', bt.ready && 'is-ready'] },
      h('div', { class: 'bt-head' }, h('span', { class: 'bt-from', style: { color: rankColor(me.c.level) } }, levelLabel(me.c.level)), h('span', { class: 'bt-arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: 'bt-to' }, bt.nextRankName)),
      list,
      chanceBar.el,
      h('p', { class: 'bt-warn' }, t('bt.warning')),
      btn,
      !atPeak ? h('p', { class: 'attr-hint' }, t('bt.notYet')) : null,
    ),
  );
}

function reputationSection(me: MeView): HTMLElement {
  const rep = me.c.reputation;
  const rows = FACTIONS.map((f) => {
    const v = rep[f.id] ?? 0;
    const pct = Math.max(-100, Math.min(100, v));
    const fill = h('span', { class: ['rep-fill', pct < 0 && 'neg'], style: { width: `${Math.abs(pct) / 2}%`, [pct < 0 ? 'right' : 'left']: '50%', background: pct < 0 ? 'var(--bad)' : f.color } });
    const row = h(
      'div',
      { class: 'rep-row' },
      h('span', { class: 'rep-dot', style: { background: f.color }, 'aria-hidden': 'true' }),
      h('span', { class: 'rep-name' }, f.short),
      h('span', { class: 'rep-track', role: 'img', 'aria-label': `${f.name}: ${reputationTitle(v)} (${v})` }, h('span', { class: 'rep-mid', 'aria-hidden': 'true' }), fill),
      h('span', { class: 'rep-title' }, reputationTitle(v)),
      h('span', { class: 'rep-val' }, fmtSigned(v)),
    );
    attachTooltip(row, () => `${f.name}: ${f.desc}`, { delay: 500 });
    return row;
  });
  return h('section', { class: 'char-sec' }, h('div', { class: 'sect-title' }, t('char.reputation')), h('div', { class: 'rep-list' }, rows));
}

function recordSection(me: MeView, ui: UiContext): HTMLElement {
  const c = me.c;
  const equipValue = (['weapon', 'outfit', 'accessory'] as const).reduce((a, s) => a + (c.equipment[s] ? stackValue(c.equipment[s]!) : 0), 0);
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(1) : c.kills ? '∞' : '–';
  const age = ui.state.serverNow() - c.createdAt;
  return h(
    'section',
    { class: 'char-sec' },
    h('div', { class: 'sect-title' }, t('char.record')),
    h(
      'dl',
      { class: 'kv kv-2col' },
      h('dt', {}, t('char.kills')),
      h('dd', {}, fmtInt(c.kills)),
      h('dt', {}, t('char.deaths')),
      h('dd', {}, fmtInt(c.deaths)),
      h('dt', {}, t('char.kd')),
      h('dd', {}, kd),
      h('dt', {}, t('char.missionsDone')),
      h('dd', {}, fmtInt(c.completedMissions)),
      h('dt', {}, t('char.gear')),
      h('dd', {}, t('char.goldValue', { n: fmtInt(equipValue) })),
      h('dt', {}, t('char.age')),
      h('dd', {}, age > 0 ? fmtDuration(age) : '–'),
    ),
  );
}

function header(me: MeView, ui: UiContext): HTMLElement {
  const c = me.c;
  const portrait = h('canvas', { class: 'char-portrait', width: 72, height: 104, 'aria-hidden': 'true' });
  queueMicrotask(() => drawLook(ui.render, portrait, c.look, 72, 104, 3, { dir: 0, state: 'idle', backdrop: true }));
  const origin = ORIGINS[c.origin];
  const xpBar = bar('xp', { label: t('hud.xp'), tag: 'XP', size: 'md' });
  xpBar.set(c.xp, me.xpNext);
  const talents = c.talents.map((id) => {
    const def = TALENTS[id];
    const chip = h('button', { class: ['chip', def?.positive === false ? 'chip-bad' : 'chip-good'], type: 'button', 'aria-label': def?.name ?? id }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, def?.positive === false ? '凶' : '吉'), def?.name ?? id);
    attachTooltip(chip, () => talentTooltip(id));
    return chip;
  });
  const left = c.injuryUntil - ui.state.serverNow();
  return h(
    'header',
    { class: 'char-head' },
    portrait,
    h(
      'div',
      { class: 'char-id' },
      h('h3', { class: 'char-name' }, c.name),
      c.title ? h('div', { class: 'char-title' }, c.title) : null,
      h('div', { class: 'char-rank', style: { color: rankColor(c.level) } }, levelLabel(c.level)),
      h('div', { class: 'char-origin' }, origin ? t('char.origin', { name: origin.name }) : null),
      xpBar.el,
      h('div', { class: 'chip-row' }, talents.length ? talents : h('span', { class: 'tone-dim' }, t('char.noTalents')), left > 0 ? h('span', { class: 'chip chip-bad' }, t('hud.injured', { n: c.injuryStacks, time: fmtDuration(left) })) : null),
    ),
  );
}

registerPanel({
  id: 'character',
  title: 'panel.character',
  glyph: '人',
  hotkey: 'c',
  order: 10,
  width: 480,
  watch: ['me'],
  render(root, ui) {
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('common.loading')));
      return;
    }
    root.append(header(me, ui), attributesSection(me, ui), breakthroughSection(me, ui), derivedSection(me), reputationSection(me), recordSection(me, ui));
  },
});
