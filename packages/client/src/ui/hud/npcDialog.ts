/**
 * NPC dialog (`S2C npc`): portrait and greeting, then the tabs this NPC offers - Shop (buy and sell), Teach, Missions,
 * Rest and Disciple. Driven by the Store so it refreshes when the server re-sends the menu or the character changes.
 */
import { FACTION_BY_ID, MAX_ACTIVE_MISSIONS, RANKS, getItem, getSkill, type MeView, type MissionOffer, type MissionType, type NpcMenu, type ShopEntry, type TeachEntry } from '@murim/shared';
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { glyph, h } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtInt, rankColor } from '../format';
import { buyList, maxBuy, menuSignature, npcTabs, offerGate, restNeeded, sellList, turnInMissions, type NpcTab } from '../logic/npc';
import { drawLook } from '../portrait';
import { requirementLines } from '../text/tips';
import { itemSlot } from '../widgets/itemSlot';
import { stepper } from '../widgets/stepper';
import { tabs } from '../widgets/tabs';
import { attachTooltip, skillTooltip } from '../widgets/tooltip';
import { icon } from '../icons';
import { skillIconName } from '../glyphMap';
import { MISSION_ICON } from '../logic/missions';

const TAB_ICON: Record<NpcTab, string> = { shop: 'shop', teach: 'teach', missions: 'board', rest: 'rest', disciple: 'recruit', talk: 'chat' };

type Board = { offers: MissionOffer[]; settlement: number };
type TalkEntry = { q: string; lines: string[]; pending: boolean; failed: boolean };
/** Most conversation entries kept on screen. */
const TALK_LOG_MAX = 24;

export function mountNpcDialog(host: HTMLElement, ui: UiContext): { destroy(): void; isOpen(): boolean } {
  const { state } = ui;
  const backdrop = h('div', { class: 'npc-backdrop', hidden: true });
  host.appendChild(backdrop);

  let openId = -1;
  let tab: NpcTab | null = null;
  let shopMode: 'buy' | 'sell' = 'buy';
  let board: Board | null = null;
  let boardStatus: 'idle' | 'loading' | 'error' = 'idle';
  let boardError = '';
  let boardFor = -1;
  const qty = new Map<string, number>();
  let bodyScroll = 0;
  let menuSig = '';
  // Talk tab: what the player asked and what the NPC said (kept while the same NPC stays open).
  let talkLog: TalkEntry[] = [];
  let talkBusy = false;
  let logScroll = 0;
  let logStick = true;
  let requeryTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => ui.closeNpc();
  backdrop.addEventListener('pointerdown', (ev) => {
    if (ev.target === backdrop) close();
  });
  backdrop.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    }
  });

  // ---- helpers -----------------------------------------------------------------------------
  const rowQty = (key: string, min: number, max: number, label: string) => {
    const s = stepper({
      value: Math.min(Math.max(qty.get(key) ?? 1, min), Math.max(min, max)),
      min,
      max: Math.max(min, max),
      label,
      onChange: (v) => qty.set(key, v),
    });
    return s;
  };

  async function loadBoard(menu: NpcMenu, force = false): Promise<void> {
    if (!force && boardFor === menu.settlementId && board) return;
    boardFor = menu.settlementId;
    boardStatus = 'loading';
    paint();
    try {
      const res = await ui.net.query('board', { settlement: menu.settlementId });
      if (openId !== menu.id) return;
      board = { offers: res.offers, settlement: menu.settlementId };
      boardStatus = 'idle';
    } catch (e) {
      if (openId !== menu.id) return;
      boardStatus = 'error';
      boardError = queryErrorMessage(e);
    }
    paint();
  }

  async function ask(menu: NpcMenu, topic: { id: string; label: string }): Promise<void> {
    if (talkBusy) return;
    const entry: TalkEntry = { q: topic.label, lines: [], pending: true, failed: false };
    talkLog.push(entry);
    if (talkLog.length > TALK_LOG_MAX) talkLog = talkLog.slice(-TALK_LOG_MAX);
    talkBusy = true;
    logStick = true;
    paint();
    try {
      const res = await ui.net.query('npcTalk', { id: menu.id, topic: topic.id });
      entry.lines = res.lines;
    } catch (e) {
      entry.failed = true;
      entry.lines = [queryErrorMessage(e)];
    }
    entry.pending = false;
    talkBusy = false;
    if (openId === menu.id) {
      logStick = true;
      paint();
    }
  }

  function talkBody(menu: NpcMenu): HTMLElement {
    const talk = menu.talk!;
    const buttons = h(
      'div',
      { class: 'talk-topics', role: 'group', 'aria-label': t('npc.talk.topics') },
      ...talk.topics.map((tp) => h('button', { class: 'btn btn-sm', type: 'button', disabled: talkBusy, onclick: () => void ask(menu, tp) }, tp.label)),
    );
    const log = h('div', { class: 'talk-log', role: 'log', 'aria-label': t('npc.talk.log'), 'aria-live': 'polite', tabindex: '0' });
    if (talkLog.length === 0) log.appendChild(h('p', { class: 'empty-note' }, t('npc.talk.hint', { name: menu.name })));
    for (const e of talkLog) {
      const node = h('div', { class: 'talk-entry' }, h('div', { class: 'talk-q' }, e.q));
      if (e.pending) node.appendChild(h('p', { class: 'talk-line tone-dim' }, h('span', { class: 'spinner' }), ' ', t('npc.talk.listening')));
      for (const line of e.lines) node.appendChild(h('p', { class: ['talk-line', e.failed && 'tone-bad'] }, e.failed ? line : '“' + line + '”'));
      log.appendChild(node);
    }
    return h('div', { class: 'npc-tabbody npc-talk' }, buttons, log);
  }

  // ---- tab bodies ---------------------------------------------------------------------------------
  function shopBody(menu: NpcMenu, me: MeView): HTMLElement {
    const shop = menu.shop!;
    const mode = h(
      'div',
      { class: 'seg shop-mode', role: 'radiogroup', 'aria-label': t('npc.shop.mode') },
      ...(['buy', 'sell'] as const).map((m) =>
        h(
          'button',
          {
            class: 'seg-btn',
            type: 'button',
            role: 'radio',
            'aria-checked': String(shopMode === m),
            onclick: () => {
              shopMode = m;
              paint();
            },
          },
          t(`npc.shop.${m}`),
        ),
      ),
    );
    const list = h('div', { class: 'npc-list' });
    if (shopMode === 'buy') {
      const entries = buyList(shop.entries);
      if (!entries.length) list.appendChild(h('p', { class: 'empty-note' }, t('npc.shop.emptyBuy')));
      for (const e of entries) list.appendChild(buyRow(menu, me, e));
    } else {
      const items = sellList(me.c.inventory, shop.sellMult, shop.sellPrices);
      if (!items.length) list.appendChild(h('p', { class: 'empty-note' }, t('npc.shop.emptySell')));
      for (const it of items) {
        const def = getItem(it.stack.id)!;
        const key = `sell:${it.idx}:${it.stack.id}`;
        const st = rowQty(key, 1, it.stack.qty, t('npc.qty'));
        const total = () => it.unit * st.get();
        const btn = h('button', { class: 'btn btn-sm btn-gold', type: 'button' });
        const sync = () => (btn.textContent = t('npc.shop.sellFor', { n: fmtInt(total()) }));
        sync();
        st.el.addEventListener('click', sync);
        st.el.addEventListener('change', sync);
        btn.addEventListener('click', async () => {
          const n = st.get();
          const valuable = (it.stack.r ?? 0) >= 2 || it.unit * n >= 250;
          if (valuable && !(await ui.confirm({ title: t('npc.shop.confirmSellTitle'), text: t('npc.shop.confirmSell', { n, name: def.name, gold: fmtInt(it.unit * n) }), ok: t('npc.shop.sell') }))) return;
          ui.net.send({ t: 'sell', npc: menu.id, idx: it.idx, id: it.stack.id, qty: n });
        });
        list.appendChild(
          h('div', { class: 'npc-row' }, itemSlot(it.stack, { size: 'md', tipOptions: { sellMult: shop.sellMult } }), h('div', { class: 'npc-row-main' }, h('div', { class: 'npc-row-name' }, def.name), h('div', { class: 'npc-row-sub' }, t('npc.shop.unit', { n: fmtInt(it.unit) }), it.stack.qty > 1 ? ` · ×${it.stack.qty}` : '')), h('div', { class: 'npc-row-act' }, it.stack.qty > 1 ? st.el : null, btn)),
        );
      }
    }
    return h('div', { class: 'npc-tabbody' }, mode, list);
  }

  function buyRow(menu: NpcMenu, me: MeView, e: ShopEntry): HTMLElement {
    const def = getItem(e.id)!;
    const cap = maxBuy(e, me.c.gold);
    const st = rowQty(`buy:${e.id}`, 1, Math.max(1, cap), t('npc.qty'));
    const btn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: cap < 1 });
    const sync = () => {
      btn.textContent = t('npc.shop.buyFor', { n: fmtInt(e.price * st.get()) });
    };
    sync();
    st.el.addEventListener('click', sync);
    st.el.addEventListener('change', sync);
    btn.addEventListener('click', () => ui.net.send({ t: 'buy', npc: menu.id, item: e.id, qty: st.get() }));
    const why = e.stock === 0 ? t('npc.shop.soldOut') : cap < 1 ? t('npc.shop.cantAfford') : '';
    if (why) btn.title = why;
    return h(
      'div',
      { class: ['npc-row', cap < 1 && 'is-off'] },
      itemSlot({ id: e.id, qty: 1, r: 0 }, { size: 'md', tipOptions: { price: e.price } }),
      h('div', { class: 'npc-row-main' }, h('div', { class: 'npc-row-name' }, def.name), h('div', { class: 'npc-row-sub' }, t('npc.shop.price', { n: fmtInt(e.price) }), e.stock !== null ? ` · ${t('npc.shop.stock', { n: e.stock })}` : '', why ? ` · ${why}` : '')),
      h('div', { class: 'npc-row-act' }, cap > 1 ? st.el : null, btn),
    );
  }

  function teachRow(menu: NpcMenu, me: MeView, e: TeachEntry): HTMLElement {
    const def = getSkill(e.skill);
    const name = def?.name ?? e.skill;
    const afford = me.c.gold >= e.gold;
    const reason = e.learned ? t('npc.teach.learned') : !e.ok ? (e.reason ?? t('npc.teach.locked')) : !afford ? t('npc.teach.cantAfford') : '';
    const btn = h('button', { class: 'btn btn-sm btn-gold', type: 'button', disabled: e.learned || !e.ok || !afford, title: reason || undefined }, e.learned ? t('npc.teach.known') : t('npc.teach.learn', { n: fmtInt(e.gold) }));
    btn.addEventListener('click', async () => {
      if (e.gold >= 100 && !(await ui.confirm({ title: t('npc.teach.confirmTitle'), text: t('npc.teach.confirm', { skill: name, gold: fmtInt(e.gold) }), ok: t('npc.teach.learnShort') }))) return;
      ui.net.send({ t: 'learn', npc: menu.id, skill: e.skill });
    });
    const badge = h('button', { class: 'skill-glyph', type: 'button', 'aria-label': name }, icon(skillIconName(def)));
    if (def) attachTooltip(badge, () => skillTooltip(e.skill, undefined, { showReq: true }));
    const reqs = def ? requirementLines(def)[0]?.text : '';
    return h(
      'div',
      { class: ['npc-row', (e.learned || !e.ok) && 'is-off'] },
      badge,
      h('div', { class: 'npc-row-main' }, h('div', { class: 'npc-row-name' }, name), h('div', { class: ['npc-row-sub', !e.ok && !e.learned && 'tone-warn'] }, e.learned ? t('npc.teach.learned') : !e.ok ? (e.reason ?? reqs ?? '') : reqs)),
      h('div', { class: 'npc-row-act' }, btn),
    );
  }

  function teachBody(menu: NpcMenu, me: MeView): HTMLElement {
    return h('div', { class: 'npc-tabbody' }, h('div', { class: 'npc-list' }, ...(menu.teaches ?? []).map((e) => teachRow(menu, me, e))));
  }

  function rewardChips(o: MissionOffer): HTMLElement {
    const r = o.reward;
    return h(
      'div',
      { class: 'chip-row' },
      r.xp ? h('span', { class: 'chip chip-gold' }, t('combat.reward.xp', { n: fmtInt(r.xp) })) : null,
      r.gold ? h('span', { class: 'chip chip-gold' }, t('combat.reward.gold', { n: fmtInt(r.gold) })) : null,
      r.rep ? h('span', { class: 'chip chip-info' }, t('npc.mission.rep', { faction: FACTION_BY_ID[r.rep.faction]?.short ?? r.rep.faction, n: r.rep.amount })) : null,
      ...(r.items ?? []).map((it) => itemSlot(it, { size: 'sm' })),
    );
  }

  function missionsBody(menu: NpcMenu, me: MeView): HTMLElement {
    const body = h('div', { class: 'npc-tabbody' });
    const ready = turnInMissions(menu, me);
    if (ready.length) {
      body.appendChild(h('div', { class: 'sect-title' }, t('npc.mission.turnIn')));
      for (const m of ready) {
        body.appendChild(
          h(
            'div',
            { class: 'npc-row mission-row' },
            h('span', { class: 'seal', 'aria-hidden': 'true' }, icon(MISSION_ICON[m.type] ?? 'missions')),
            h('div', { class: 'npc-row-main' }, h('div', { class: 'npc-row-name' }, m.title), h('div', { class: 'npc-row-sub' }, m.done ? t('npc.mission.done') : t('npc.mission.progress', { a: m.progress, b: m.target.count })), rewardChips(m)),
            h('div', { class: 'npc-row-act' }, h('button', { class: 'btn btn-sm btn-gold', type: 'button', disabled: !m.done, onclick: () => ui.net.send({ t: 'mturnin', id: m.id, npc: menu.id }) }, t('npc.mission.turnInBtn'))),
          ),
        );
      }
    }
    body.appendChild(h('div', { class: 'sect-title' }, t('npc.mission.board'), h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('common.retry'), onclick: () => void loadBoard(menu, true) }, '↻')));
    if (boardStatus === 'loading' && !board) body.appendChild(h('p', { class: 'empty-note' }, h('span', { class: 'spinner' }), ' ', t('common.loading')));
    else if (boardStatus === 'error') body.appendChild(h('p', { class: 'empty-note tone-bad' }, boardError, ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => void loadBoard(menu, true) }, t('common.retry'))));
    else if (board) {
      if (!board.offers.length) body.appendChild(h('p', { class: 'empty-note' }, t('npc.mission.none')));
      for (const o of board.offers) {
        const gate = offerGate(o, me);
        const rank = RANKS[o.minRank - 1];
        const btn = h(
          'button',
          {
            class: ['btn', 'btn-sm', gate.accepted ? 'btn-ghost' : 'btn-primary'],
            type: 'button',
            disabled: !gate.ok,
            title: gate.reason ? t(gate.reason, { max: MAX_ACTIVE_MISSIONS, rank: rank?.name ?? o.minRank }) : undefined,
            onclick: () => {
              ui.net.send({ t: 'maccept', offer: o.id, settlement: menu.settlementId });
              setTimeout(() => openId === menu.id && void loadBoard(menu, true), 600);
            },
          },
          gate.accepted ? t('npc.mission.acceptedBtn') : t('npc.mission.accept'),
        );
        body.appendChild(
          h(
            'div',
            { class: ['npc-row', 'mission-row', !gate.ok && !gate.accepted && 'is-off'] },
            h('span', { class: 'seal', 'aria-hidden': 'true' }, icon(MISSION_ICON[o.type] ?? 'missions')),
            h(
              'div',
              { class: 'npc-row-main' },
              h('div', { class: 'npc-row-name' }, o.title),
              h('div', { class: 'npc-row-sub' }, o.desc),
              h('div', { class: 'chip-row' }, h('span', { class: 'chip' }, t(`mission.type.${o.type}`)), h('span', { class: 'chip', style: { color: rankColor((o.minRank - 1) * 9 + 1) } }, t('npc.mission.minRank', { rank: rank?.name ?? o.minRank })), o.target.count > 1 ? h('span', { class: 'chip' }, `×${o.target.count}`) : null),
              rewardChips(o),
              !gate.ok && gate.reason && !gate.accepted ? h('div', { class: 'npc-row-sub tone-warn' }, t(gate.reason, { max: MAX_ACTIVE_MISSIONS, rank: rank?.name ?? o.minRank })) : null,
            ),
            h('div', { class: 'npc-row-act' }, btn),
          ),
        );
      }
    }
    return body;
  }

  function restBody(menu: NpcMenu, me: MeView): HTMLElement {
    const price = menu.restPrice ?? 0;
    const v = state.selfVitals() ?? { hp: me.c.hp, maxHp: me.d.maxHp, qi: me.c.qi, maxQi: me.d.maxQi };
    const full = !restNeeded(v, me.c.injuryStacks, me.c.injuryUntil, state.serverNow());
    const afford = me.c.gold >= price;
    return h(
      'div',
      { class: 'npc-tabbody npc-rest' },
      h('div', { class: 'scroll' }, t('npc.rest.text', { n: fmtInt(price) })),
      h('div', { class: 'chip-row' }, h('span', { class: 'chip chip-bad' }, `${t('hud.health')} ${fmtInt(v.hp)} / ${fmtInt(v.maxHp)}`), h('span', { class: 'chip chip-info' }, `${t('hud.qi')} ${fmtInt(v.qi)} / ${fmtInt(v.maxQi)}`)),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: full || !afford, title: full ? t('npc.rest.full') : !afford ? t('npc.rest.cantAfford') : undefined, onclick: () => ui.net.send({ t: 'rest', npc: menu.id }) }, t('npc.rest.btn', { n: fmtInt(price) })),
      full ? h('p', { class: 'tone-dim' }, t('npc.rest.full')) : !afford ? h('p', { class: 'tone-warn' }, t('npc.rest.cantAfford')) : null,
    );
  }

  function discipleBody(menu: NpcMenu): HTMLElement {
    const d = menu.disciple!;
    return h(
      'div',
      { class: 'npc-tabbody' },
      h('div', { class: 'scroll' }, d.already ? t('npc.disciple.already', { name: menu.name }) : t('npc.disciple.text', { name: menu.name })),
      d.ok && !d.already ? null : d.reason ? h('p', { class: 'tone-warn' }, d.reason) : null,
      h('button', { class: 'btn btn-primary', type: 'button', disabled: !d.ok || d.already, onclick: () => ui.net.send({ t: 'master', op: 'request', npc: menu.id }) }, t('npc.disciple.btn')),
    );
  }

  // ---- paint ------------------------------------------------------------------------------------------------
  function paint(): void {
    const menu = state.get('npc');
    const me = state.get('me');
    if (!menu || !me) {
      backdrop.hidden = true;
      backdrop.replaceChildren();
      openId = -1;
      return;
    }
    const available = npcTabs(menu);
    if (menu.id !== openId) {
      openId = menu.id;
      menuSig = menuSignature(me);
      tab = available[0] ?? null;
      shopMode = 'buy';
      board = null;
      boardFor = -1;
      boardStatus = 'idle';
      qty.clear();
      bodyScroll = 0;
      talkLog = [];
      talkBusy = false;
      logStick = true;
    }
    if (!tab || !available.includes(tab)) tab = available[0] ?? null;
    const prevBody = backdrop.querySelector<HTMLElement>('.npc-body');
    if (prevBody) bodyScroll = prevBody.scrollTop;
    const prevLog = backdrop.querySelector<HTMLElement>('.talk-log');
    if (prevLog) logScroll = prevLog.scrollTop;

    const portrait = h('canvas', { class: 'npc-portrait', width: 72, height: 104, 'aria-hidden': 'true' });
    drawLook(ui.render, portrait, menu.look, 72, 104, 3, { dir: 0, state: 'idle', backdrop: true });
    const faction = menu.faction ? FACTION_BY_ID[menu.faction] : undefined;
    const head = h(
      'header',
      { class: 'npc-head' },
      portrait,
      h(
        'div',
        { class: 'npc-id' },
        h('h2', { class: 'npc-name', id: 'npc-title' }, menu.name),
        h('div', { class: 'npc-title' }, menu.title),
        menu.talk?.mood ? h('div', { class: 'npc-mood', title: t('npc.mood') }, menu.talk.mood) : null,
        h('div', { class: 'chip-row' }, h('span', { class: 'chip chip-gold', style: { color: rankColor(menu.level) } }, t('ctx.level', { n: menu.level })), h('span', { class: 'chip' }, t(`role.${menu.role}`)), faction ? h('span', { class: 'chip', style: { color: faction.color, borderColor: faction.color } }, faction.short) : null, menu.standing && menu.standing !== 'unknown' ? h('span', { class: ['chip', 'chip-standing', `standing-${menu.standing}`], title: t('npc.standing.tip') }, t(`npc.standing.${menu.standing}`)) : null),
      ),
      h('button', { class: 'btn-icon btn-close', type: 'button', 'aria-label': t('npc.close'), onclick: close }, icon('close')),
    );
    const greeting = h('div', { class: 'scroll npc-greeting' }, `“${menu.greeting}”`);

    let content: HTMLElement | null = null;
    if (tab === 'shop') content = shopBody(menu, me);
    else if (tab === 'teach') content = teachBody(menu, me);
    else if (tab === 'missions') {
      if (!board && boardStatus === 'idle') void loadBoard(menu);
      content = missionsBody(menu, me);
    } else if (tab === 'rest') content = restBody(menu, me);
    else if (tab === 'disciple') content = discipleBody(menu);
    else if (tab === 'talk') content = talkBody(menu);

    const tabBar = available.length > 1 ? tabs(available.map((id) => ({ id, label: t(`npc.tab.${id}`), glyph: TAB_ICON[id] })), (id) => ((tab = id as NpcTab), paint()), { initial: tab ?? undefined, label: t('npc.tabs') }) : null;

    const foot = h('footer', { class: 'npc-foot' }, h('span', { class: 'chip chip-gold' }, glyph('coin'), t('npc.gold', { n: fmtInt(me.c.gold) })), available.length === 0 ? h('span', { class: 'tone-dim' }, t('npc.nothing')) : null);

    const card = h('section', { class: 'npc parchment', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'npc-title', tabindex: '-1' }, head, greeting, tabBar?.el ?? null, h('div', { class: 'npc-body', 'data-scroll-key': 'npc' }, content), foot);
    const wasHidden = backdrop.hidden;
    backdrop.replaceChildren(card);
    backdrop.hidden = false;
    const nb = card.querySelector<HTMLElement>('.npc-body');
    if (nb) nb.scrollTop = bodyScroll;
    const lg = card.querySelector<HTMLElement>('.talk-log');
    if (lg) lg.scrollTop = logStick ? lg.scrollHeight : logScroll;
    logStick = false;
    if (wasHidden) requestAnimationFrame(() => card.focus({ preventScroll: true }));
  }

  // The server closes the conversation implicitly when you walk away: mirror that.
  const watchDistance = () => {
    const menu = state.get('npc');
    if (!menu) return;
    const npcEnt = state.get('entities').get(menu.id);
    const self = state.selfEntity();
    if (npcEnt && self && Math.hypot(npcEnt.x - self.x, npcEnt.y - self.y) > 9) ui.closeNpc();
  };

  paint();
  // Typing in a stepper must not be wiped by a re-render: skip while an input inside the dialog has focus.
  let pending = false;
  const repaint = () => {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && backdrop.contains(a)) {
      pending = true;
      return;
    }
    paint();
  };
  backdrop.addEventListener('focusout', () => {
    if (pending) {
      pending = false;
      setTimeout(paint, 0);
    }
  });
  // The real server answers buy / sell / learn / rest / hand-in with `me` only: re-ask for the menu (prices, `ok` flags, turn-ins).
  const watchMe = () => {
    const menu = state.get('npc');
    const me = state.get('me');
    if (!menu || !me || menu.id !== openId) return;
    const sig = menuSignature(me);
    if (sig === menuSig) return;
    menuSig = sig;
    if (requeryTimer) clearTimeout(requeryTimer);
    requeryTimer = setTimeout(() => {
      requeryTimer = null;
      void ui.net
        .query('npc', { id: menu.id })
        .then((fresh) => {
          if (state.get('npc')?.id === menu.id) state.set('npc', fresh);
        })
        .catch((e) => {
          if (e instanceof Error && /too_far|not_found/.test((e as { serverCode?: string }).serverCode ?? '')) ui.closeNpc();
        });
    }, 250);
  };
  const unsubs = [state.subscribe(['npc', 'me', 'combat'], repaint), state.subscribe('me', watchMe), state.subscribe('entities', watchDistance)];
  return {
    isOpen: () => !backdrop.hidden,
    destroy() {
      unsubs.forEach((u) => u());
      if (requeryTimer) clearTimeout(requeryTimer);
      backdrop.remove();
    },
  };
}

