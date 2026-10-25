/**
 * Missions panel (M): the jobs you carry (progress, reward, time left, where to hand in, abandon) and the board of the
 * settlement you stand in (offers with level / rank, rewards, Accept with the reason when it is disabled).
 */
import { FACTION_BY_ID, MAX_ACTIVE_MISSIONS, MONSTERS, RANKS, getItem, rankOf, type ActiveMission, type MeView, type MissionOffer, type SettlementDef, type SettlementView } from '@murim/shared';
import { addStrings, t, tn } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtInt, rankColorOfRank, worldClock } from '../format';
import { MISSION_GLYPH, boardSettlement, daysLeft, hintTo, nearestSettlement, objectiveKey, progressFraction, progressText, sortActive, turnInSettlementId, urgency } from '../logic/missions';
import { offerGate } from '../logic/npc';
import { bar } from '../widgets/bar';
import { itemSlot } from '../widgets/itemSlot';
import { tabs } from '../widgets/tabs';
import { registerPanel } from './registry';
import '../../styles/panels/missions.css';

addStrings({
  'ms.tab.active': 'Active',
  'ms.tab.board': 'Board',
  'ms.tabs': 'Mission sections',
  'ms.loading': 'Loading your missions...',
  'ms.active.count': '{n} of {max} missions carried',
  'ms.active.empty': 'You carry no missions. Visit a settlement and check its board, or ask the elder and the guards.',
  'ms.active.goBoard': 'Open the board',
  'ms.ready': 'Ready to hand in',
  'ms.readyAt': 'Report to the elder, a guard, a master or a merchant in {place}.',
  'ms.readyHere': 'You are in {place}: talk to the elder, a guard, a master or a merchant.',
  'ms.goto': 'Go to {place}: about {n} tiles {dir}.',
  'ms.gotoHere': 'Hand it in at {place} (you are close).',
  'ms.dir.east': 'east',
  'ms.dir.south-east': 'south-east',
  'ms.dir.south': 'south',
  'ms.dir.south-west': 'south-west',
  'ms.dir.west': 'west',
  'ms.dir.north-west': 'north-west',
  'ms.dir.north': 'north',
  'ms.dir.north-east': 'north-east',
  'ms.days.one': '{n} day left',
  'ms.days.other': '{n} days left',
  'ms.lastDay': 'Ends today',
  'ms.level': 'Lv {n}',
  'ms.abandon': 'Abandon',
  'ms.abandonTitle': 'Abandon this mission?',
  'ms.abandonText': 'Abandon "{title}"? Your progress is lost and the posting goes back to the board.',
  'ms.log': 'Missions completed: {n}',
  'ms.reward': 'Reward',
  'ms.obj.hunt': 'Defeat {n} × {what}',
  'ms.obj.bounty': 'Hunt down {n} × {what} (your personal target)',
  'ms.obj.purify': 'Destroy {n} × {what} in the marked area',
  'ms.obj.defend': 'Defeat {n} attackers while the settlement is besieged',
  'ms.obj.gather': 'Bring {n} × {what}',
  'ms.obj.deliver': 'Carry {n} × {what} to its destination',
  'ms.obj.investigate': 'Investigate the marked place',
  'ms.obj.unknown': 'creatures',
  'ms.obj.sect': 'Complete the sect task ({n})',
  'ms.board.none': 'There is no mission board within reach. The nearest settlement is {place}, about {n} tiles {dir}.',
  'ms.board.noWorld': 'The map has not loaded yet.',
  'ms.board.title': 'Board of {place}',
  'ms.board.refresh': 'Refresh the board',
  'ms.board.empty': 'No postings at the moment. Check back later.',
  'ms.board.loading': 'Reading the board...',
  'ms.board.accept': 'Accept',
  'ms.board.accepted': 'Accepted',
  'ms.board.expires': 'Posted for {n} more days',
  'ms.board.minRank': 'Rank {rank}+',
  'ms.board.errTooFar': 'You are too far from the board.',
  'ms.board.state': 'Settlement is {status}',
});

type Tab = 'active' | 'board';
let tab: Tab = 'active';
let board: { sid: number; offers: MissionOffer[]; settlement: SettlementView | null } | null = null;
let boardStatus: 'idle' | 'loading' | 'error' = 'idle';
let boardError = '';
let boardAskedFor = -1;

function monsterOrFamily(id: string): string {
  return MONSTERS[id]?.name ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : t('ms.obj.unknown'));
}

function objective(m: Pick<MissionOffer, 'type' | 'target'>): string {
  const o = objectiveKey(m);
  const what = m.type === 'gather' || m.type === 'deliver' ? (getItem(String(o.params.what))?.name ?? String(o.params.what)) : monsterOrFamily(String(o.params.what));
  return t(o.key, { ...o.params, what });
}

function rewardRow(o: MissionOffer): HTMLElement {
  const r = o.reward;
  return h(
    'div',
    { class: 'chip-row ms-reward', 'aria-label': t('ms.reward') },
    r.xp ? h('span', { class: 'chip chip-gold' }, t('combat.reward.xp', { n: fmtInt(r.xp) })) : null,
    r.gold ? h('span', { class: 'chip chip-gold' }, t('combat.reward.gold', { n: fmtInt(r.gold) })) : null,
    r.rep ? h('span', { class: 'chip chip-info' }, t('npc.mission.rep', { faction: FACTION_BY_ID[r.rep.faction]?.short ?? r.rep.faction, n: r.rep.amount })) : null,
    ...(r.items ?? []).map((it) => itemSlot(it, { size: 'sm' })),
  );
}

function timeLeft(expires: number, today: number): HTMLElement {
  const left = daysLeft(expires, today);
  const u = urgency(left);
  return h('span', { class: ['chip', u === 'last' ? 'chip-bad' : u === 'soon' ? 'chip-warn' : ''] }, left <= 0 ? t('ms.lastDay') : tn('ms.days', left));
}

function placeHint(m: ActiveMission, settlements: readonly SettlementDef[], self: { x: number; y: number } | null): string {
  const s = settlements.find((x) => x.id === turnInSettlementId(m));
  if (!s) return '';
  const hint = hintTo(s, self);
  if (m.done) return hint.here ? t('ms.readyHere', { place: hint.name }) : `${t('ms.readyAt', { place: hint.name })} ${t('ms.goto', { place: hint.name, n: hint.dist, dir: t(`ms.dir.${hint.dir}`) })}`;
  return hint.here ? t('ms.gotoHere', { place: hint.name }) : t('ms.goto', { place: hint.name, n: hint.dist, dir: t(`ms.dir.${hint.dir}`) });
}

function activeTab(me: MeView, ui: UiContext, today: number): HTMLElement {
  const c = me.c;
  const world = ui.state.get('world');
  const settlements = world?.payload.settlements ?? [];
  const self = ui.state.selfEntity();
  const pos = self ? { x: self.x, y: self.y } : null;
  const root = h('div', { class: 'ms-body' });
  root.append(h('div', { class: 'ms-count' }, h('span', { class: ['chip', c.missions.length >= MAX_ACTIVE_MISSIONS && 'chip-warn'] }, t('ms.active.count', { n: c.missions.length, max: MAX_ACTIVE_MISSIONS }))));
  if (!c.missions.length) {
    root.append(
      h(
        'div',
        { class: 'ms-empty' },
        h('p', { class: 'empty-note' }, t('ms.active.empty')),
        h(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            onclick: () => {
              tab = 'board';
              ui.panels.refresh('missions');
            },
          },
          t('ms.active.goBoard'),
        ),
      ),
    );
  }
  const list = h('ul', { class: 'ms-list' });
  for (const m of sortActive(c.missions, today)) {
    const pb = bar(m.done ? 'gold' : 'xp', { label: `${m.title}: ${progressText(m)}`, size: 'md' });
    pb.set(progressFraction(m) * 100, 100, progressText(m));
    const hint = placeHint(m, settlements, pos);
    list.append(
      h(
        'li',
        { class: ['ms-card', 'card', m.done && 'is-ready'] },
        h('span', { class: 'seal ms-seal', 'aria-hidden': 'true' }, MISSION_GLYPH[m.type] ?? '令'),
        h(
          'div',
          { class: 'ms-main' },
          h('div', { class: 'ms-title' }, m.title, m.done ? h('span', { class: 'chip chip-good' }, t('ms.ready')) : null),
          h('div', { class: 'chip-row' }, h('span', { class: 'chip' }, t(`mission.type.${m.type}`)), h('span', { class: 'chip' }, t('ms.level', { n: m.level })), timeLeft(m.expires, today)),
          h('div', { class: 'ms-obj' }, objective(m)),
          pb.el,
          rewardRow(m),
          hint ? h('div', { class: ['ms-hint', m.done && 'tone-good'] }, hint) : null,
        ),
        h(
          'div',
          { class: 'ms-act' },
          h(
            'button',
            {
              class: 'btn btn-sm btn-danger btn-ghost',
              type: 'button',
              onclick: async () => {
                if (await ui.confirm({ title: t('ms.abandonTitle'), text: t('ms.abandonText', { title: m.title }), ok: t('ms.abandon'), danger: true })) ui.net.send({ t: 'mabandon', id: m.id });
              },
            },
            t('ms.abandon'),
          ),
        ),
      ),
    );
  }
  if (c.missions.length) root.append(list);
  root.append(h('p', { class: 'ms-log' }, t('ms.log', { n: fmtInt(c.completedMissions) })));
  return root;
}

async function loadBoard(ui: UiContext, s: SettlementDef): Promise<void> {
  boardAskedFor = s.id;
  boardStatus = 'loading';
  ui.panels.refresh('missions');
  try {
    const res = await ui.net.query('board', { settlement: s.id });
    board = { sid: s.id, offers: res.offers, settlement: res.settlement ?? null };
    boardStatus = 'idle';
  } catch (e) {
    boardStatus = 'error';
    boardError = queryErrorMessage(e);
  }
  ui.panels.refresh('missions');
}

function boardTab(me: MeView, ui: UiContext, today: number): HTMLElement {
  const root = h('div', { class: 'ms-body' });
  const world = ui.state.get('world');
  const self = ui.state.selfEntity();
  const pos = self ? { x: self.x, y: self.y } : null;
  if (!world) return h('div', { class: 'ms-body' }, h('p', { class: 'empty-note' }, t('ms.board.noWorld')));
  const list = world.payload.settlements;
  const here = boardSettlement(list, pos);
  if (!here) {
    const near = nearestSettlement(list, pos);
    const hint = near ? hintTo(near, pos) : null;
    root.append(h('p', { class: 'empty-note' }, hint ? t('ms.board.none', { place: hint.name, n: hint.dist, dir: t(`ms.dir.${hint.dir}`) }) : t('ms.board.none', { place: '-', n: 0, dir: '' })));
    return root;
  }
  if (boardAskedFor !== here.id && boardStatus !== 'loading') queueMicrotask(() => void loadBoard(ui, here));
  const refresh = h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('ms.board.refresh'), title: t('ms.board.refresh'), onclick: () => void loadBoard(ui, here) }, '↻');
  const st = board?.sid === here.id ? board.settlement : null;
  root.append(h('div', { class: 'ms-boardhead' }, h('h3', { class: 'ms-boardtitle' }, t('ms.board.title', { place: here.name })), st ? h('span', { class: ['chip', st.siege && 'chip-bad'] }, t('ms.board.state', { status: st.status })) : null, refresh));
  if (boardStatus === 'loading' && !(board?.sid === here.id)) {
    root.append(h('p', { class: 'empty-note' }, h('span', { class: 'spinner' }), ' ', t('ms.board.loading')));
    return root;
  }
  if (boardStatus === 'error') {
    root.append(h('p', { class: 'empty-note tone-bad' }, boardError, ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => void loadBoard(ui, here) }, t('common.retry'))));
    return root;
  }
  const offers = board?.sid === here.id ? board.offers : [];
  if (!offers.length) {
    root.append(h('p', { class: 'empty-note' }, t('ms.board.empty')));
    return root;
  }
  const rank = rankOf(me.c.level);
  const ul = h('ul', { class: 'ms-list' });
  for (const o of offers) {
    const gate = offerGate(o, me);
    const rn = RANKS[o.minRank - 1]?.name ?? String(o.minRank);
    const reason = gate.reason ? t(gate.reason, { max: MAX_ACTIVE_MISSIONS, rank: rn }) : '';
    const btn = h(
      'button',
      {
        class: ['btn', 'btn-sm', gate.accepted ? 'btn-ghost' : 'btn-primary'],
        type: 'button',
        disabled: !gate.ok,
        title: reason || undefined,
        onclick: () => {
          ui.net.send({ t: 'maccept', offer: o.id, settlement: here.id });
          setTimeout(() => void loadBoard(ui, here), 500);
        },
      },
      gate.accepted ? t('ms.board.accepted') : t('ms.board.accept'),
    );
    ul.append(
      h(
        'li',
        { class: ['ms-card', 'card', !gate.ok && !gate.accepted && 'is-off'] },
        h('span', { class: 'seal ms-seal', 'aria-hidden': 'true' }, MISSION_GLYPH[o.type] ?? '令'),
        h(
          'div',
          { class: 'ms-main' },
          h('div', { class: 'ms-title' }, o.title),
          h('div', { class: 'chip-row' }, h('span', { class: 'chip' }, t(`mission.type.${o.type}`)), h('span', { class: 'chip' }, t('ms.level', { n: o.level })), h('span', { class: ['chip', rank < o.minRank && 'chip-bad'], style: { color: rank >= o.minRank ? rankColorOfRank(o.minRank) : undefined } }, t('ms.board.minRank', { rank: rn })), timeLeft(o.expires, today)),
          h('div', { class: 'ms-desc' }, o.desc),
          h('div', { class: 'ms-obj' }, objective(o)),
          rewardRow(o),
          !gate.ok && !gate.accepted && reason ? h('div', { class: 'ms-hint tone-warn' }, reason) : null,
        ),
        h('div', { class: 'ms-act' }, btn),
      ),
    );
  }
  root.append(ul);
  return root;
}

registerPanel({
  id: 'missions',
  title: 'panel.missions',
  glyph: '令',
  hotkey: 'm',
  order: 40,
  width: 460,
  watch: ['me'],
  onOpen: () => {
    boardAskedFor = -1;
  },
  render(root, ui) {
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('ms.loading')));
      return;
    }
    const time = ui.state.get('time');
    const today = time ? worldClock(time, ui.state.serverNow()).day : 0;
    const ready = me.c.missions.filter((m) => m.done).length;
    const tb = tabs(
      [
        { id: 'active', label: t('ms.tab.active'), glyph: '行', badge: ready },
        { id: 'board', label: t('ms.tab.board'), glyph: '榜' },
      ],
      (id) => {
        tab = id as Tab;
        boardAskedFor = -1;
        ui.panels.refresh('missions');
      },
      { initial: tab, label: t('ms.tabs') },
    );
    root.append(h('div', { class: 'ms' }, tb.el, h('div', { 'data-scroll-key': `ms-${tab}` }, tab === 'active' ? activeTab(me, ui, today) : boardTab(me, ui, today))));
  },
});
