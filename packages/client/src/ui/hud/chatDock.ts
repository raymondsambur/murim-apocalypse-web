/**
 * Chat dock: tabs (Local / World / Sect / Whisper / System) with unread badges, a channel picker and slash commands.
 * Collapsible; on narrow screens it collapses into a round button and expands into a bottom sheet.
 */
import type { ChatChannel } from '@murim/shared';
import { t } from '../../i18n';
import { CHAT_COMMANDS, parseChatInput, type SendChannel } from '../../state/chatCommands';
import type { ChatLine } from '../../state/store';
import { CHAT_CHANNELS } from '../../state/store';
import type { UiContext } from '../context';
import { NARROW_QUERY, glyph, h, isNarrow, isTypingTarget } from '../dom';
import { rankColor, rankColorOfRank } from '../format';
import { formatChatTime, maxKey, pushHistory, stepHistory, unreadSince, whisperParty } from '../logic/chat';
import { tabs } from '../widgets/tabs';

export interface ChatDock {
  destroy(): void;
  /** Expand, optionally pre-fill the input, and focus it. */
  focus(prefill?: string): void;
  isCollapsed(): boolean;
  collapse(): void;
}

const SEND_CHANNELS: SendChannel[] = ['local', 'world', 'sect', 'whisper'];

export function mountChatDock(host: HTMLElement, ui: UiContext): ChatDock {
  const { state } = ui;
  let collapsed = isNarrow() ? true : ui.settings.get().chatCollapsed;
  let sendCh: SendChannel = 'local';
  let whisperTo: string | null = null;
  let seenKey = maxKey(state.get('chat'));
  let history: string[] = [];
  let hcur = 0;
  let renderedTab: ChatChannel | null = null;
  let lastRenderedKey = 0;

  // ---- structure ------------------------------------------------------------------------
  const tabBar = tabs(
    CHAT_CHANNELS.map((c) => ({ id: c, label: t(`chat.tab.${c}`) })),
    (id) => state.setChatTab(id as ChatChannel),
    { initial: state.get('chatTab'), label: t('chat.tabs'), cls: 'chat-tabs' },
  );
  const toggleBadge = h('span', { class: 'badge', hidden: true });
  const toggle = h(
    'button',
    { class: 'chat-toggle', type: 'button', 'aria-controls': 'chat-body', onclick: () => setCollapsed(!collapsed) },
    glyph('chat'),
    h('span', { class: 'chat-toggle-label' }, t('chat.title')),
    toggleBadge,
  );
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', tabindex: '0', 'aria-label': t('chat.log') });
  const jump = h('button', { class: 'chat-jump btn btn-xs btn-gold', type: 'button', hidden: true, onclick: () => scrollBottom() }, t('chat.newBelow'));

  const channel = h('select', { class: 'select chat-channel', 'aria-label': t('chat.channel') });
  for (const c of SEND_CHANNELS) channel.appendChild(h('option', { value: c }, t(`chat.ch.${c}`)));
  channel.addEventListener('change', () => {
    sendCh = channel.value as SendChannel;
    if (sendCh !== 'whisper') whisperTo = null;
    refreshInput();
    input.focus();
  });
  const target = h('button', {
    class: 'chip chip-info chat-target',
    type: 'button',
    hidden: true,
    'aria-label': t('chat.clearTarget'),
    onclick: () => {
      whisperTo = null;
      refreshInput();
      input.focus();
    },
  });
  const input = h('input', {
    class: 'input chat-text',
    type: 'text',
    maxlength: '200',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'send',
    'aria-label': t('chat.input'),
  });
  const send = h('button', { class: 'btn btn-primary chat-send', type: 'submit', 'aria-label': t('chat.send') }, h('span', { 'aria-hidden': 'true' }, '➤'));
  const form = h(
    'form',
    {
      class: 'chat-form',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        submit();
      },
    },
    channel,
    target,
    input,
    send,
  );

  const body = h('div', { class: 'chat-body', id: 'chat-body' }, tabBar.el, h('div', { class: 'chat-logwrap' }, log, jump), form);
  const el = h(
    'section',
    { class: 'chat glass', 'aria-label': t('chat.title') },
    h('div', { class: 'chat-head' }, toggle, h('button', { class: 'btn-icon btn-sm chat-min', type: 'button', 'aria-label': t('chat.collapse'), onclick: () => setCollapsed(true) }, '▾')),
    body,
  );
  host.appendChild(el);

  function setCollapsed(c: boolean, persist = true): void {
    collapsed = c;
    el.classList.toggle('collapsed', c);
    toggle.setAttribute('aria-expanded', String(!c));
    seenKey = maxKey(state.get('chat'));
    if (!c) {
      state.setChatTab(state.get('chatTab'));
      scrollBottom();
    }
    if (persist && !isNarrow()) ui.settings.set({ chatCollapsed: c });
    updateBadge();
  }

  function updateBadge(): void {
    const chat = state.get('chat');
    const n = collapsed ? unreadSince(chat, seenKey) : 0;
    toggleBadge.hidden = n <= 0;
    toggleBadge.textContent = n > 99 ? '99+' : String(n);
    for (const c of CHAT_CHANNELS) tabBar.setBadge(c, c === state.get('chatTab') ? 0 : chat[c].unread);
  }

  function refreshInput(): void {
    channel.value = sendCh;
    target.hidden = !(sendCh === 'whisper' && whisperTo);
    target.textContent = whisperTo ? `→ ${whisperTo}  ✕` : '';
    const sect = [...channel.options].find((o) => o.value === 'sect');
    if (sect) {
      const inSect = !!state.get('me')?.sect;
      sect.disabled = !inSect;
      sect.textContent = inSect ? t('chat.ch.sect') : t('chat.ch.sectNone');
    }
    input.placeholder = sendCh === 'whisper' && !whisperTo ? t('chat.placeholder.whisperNone') : t(`chat.placeholder.${sendCh}`);
  }

  // ---- rendering ---------------------------------------------------------------------------
  function nameColor(line: ChatLine): string | undefined {
    const me = state.get('me');
    if (me && (line.self || line.from === me.c.name)) return rankColor(me.c.level);
    const ents = state.get('entities');
    const e = (line.fromId !== undefined ? ents.get(line.fromId) : undefined) ?? state.entityByName(line.from, 'player');
    return e?.rank ? rankColorOfRank(e.rank) : undefined;
  }

  function nameButton(name: string, color?: string): HTMLElement {
    const me = state.get('me');
    if (me && name === me.c.name) return h('span', { class: 'chat-name is-me', style: color ? { color } : undefined }, name);
    return h(
      'button',
      {
        class: 'chat-name',
        type: 'button',
        style: color ? { color } : undefined,
        title: t('chat.whisperHint', { name }),
        onclick: () => api.focus(`/w ${name.includes(' ') ? `"${name}"` : name} `),
      },
      name,
    );
  }

  function lineEl(l: ChatLine): HTMLElement {
    const row = h('div', { class: ['chat-line', l.self && 'is-self', l.level && `lvl-${l.level}`], dataset: { key: l.key, ch: l.ch } });
    row.appendChild(h('span', { class: 'chat-time' }, formatChatTime(l.t)));
    if (l.ch === 'system') {
      row.appendChild(h('span', { class: 'chat-text' }, l.text));
      return row;
    }
    const me = state.get('me');
    if (l.ch === 'whisper') {
      const w = whisperParty(l, me?.c.name ?? '');
      row.appendChild(h('span', { class: 'chat-whisper' }, w.dir === 'to' ? t('chat.whisperTo') : t('chat.whisperFrom')));
      row.appendChild(nameButton(w.other));
    } else {
      if (l.tag) row.appendChild(h('span', { class: 'chat-tag' }, `[${l.tag}]`));
      row.appendChild(nameButton(l.from, nameColor(l)));
    }
    row.appendChild(h('span', { class: 'chat-sep', 'aria-hidden': 'true' }, ':'));
    row.appendChild(h('span', { class: 'chat-text' }, l.text));
    return row;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  function scrollBottom(): void {
    log.scrollTop = log.scrollHeight;
    jump.hidden = true;
  }

  function renderLog(): void {
    const tab = state.get('chatTab');
    const lines = state.get('chat')[tab].lines;
    if (renderedTab !== tab) {
      log.replaceChildren(...lines.map(lineEl));
      renderedTab = tab;
      lastRenderedKey = lines.length ? lines[lines.length - 1].key : 0;
      scrollBottom();
      return;
    }
    const stick = nearBottom();
    // drop the lines the store trimmed
    const first = lines.length ? lines[0].key : Infinity;
    while (log.firstElementChild && Number((log.firstElementChild as HTMLElement).dataset.key) < first) log.firstElementChild.remove();
    let appended = 0;
    for (const l of lines) {
      if (l.key <= lastRenderedKey) continue;
      log.appendChild(lineEl(l));
      lastRenderedKey = l.key;
      appended++;
    }
    if (appended) {
      if (stick || lines[lines.length - 1]?.self) scrollBottom();
      else jump.hidden = false;
    }
  }

  const onChat = () => {
    if (!collapsed) {
      // everything on the open tab counts as read while the dock is expanded
      const tab = state.get('chatTab');
      state.get('chat')[tab].unread = 0;
      seenKey = maxKey(state.get('chat'));
    }
    renderLog();
    updateBadge();
  };

  // ---- sending ------------------------------------------------------------------------------------
  function sysLine(text: string, level: 'info' | 'bad' = 'info'): void {
    state.addChat({ ch: 'system', from: '', text, t: state.serverNow() }, { level, visible: state.get('chatTab') === 'system' });
  }

  function submit(): void {
    const raw = input.value;
    const names = [...state.get('entities').values()].filter((e) => e.kind === 'player').map((e) => e.name);
    const intent = parseChatInput(raw, { channel: sendCh, whisperTo, lastWhisper: state.get('lastWhisper'), knownNames: names });
    switch (intent.kind) {
      case 'empty':
        return;
      case 'help':
        sysLine(t('chat.help'));
        for (const c of CHAT_COMMANDS) sysLine(c);
        state.setChatTab('system');
        break;
      case 'error':
        sysLine(t(intent.key, intent.params), 'bad');
        state.setChatTab('system');
        break;
      case 'switch':
        sendCh = intent.ch;
        whisperTo = intent.ch === 'whisper' ? (intent.to ?? whisperTo) : null;
        refreshInput();
        break;
      case 'send':
        if (!ui.net.send({ t: 'chat', ch: intent.ch, text: intent.text, to: intent.to })) return;
        sendCh = intent.ch;
        if (intent.ch === 'whisper') whisperTo = intent.to ?? whisperTo;
        refreshInput();
        tabBar.select(intent.ch, true);
        break;
    }
    history = pushHistory(history, raw);
    hcur = history.length;
    input.value = '';
  }

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      input.blur();
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      const s = stepHistory(history, hcur, ev.key === 'ArrowUp' ? -1 : 1);
      hcur = s.cursor;
      input.value = s.text;
      ev.preventDefault();
    }
  });

  // ---- wiring ---------------------------------------------------------------------------------------
  const api: ChatDock = {
    destroy() {
      unsubs.forEach((u) => u());
      document.removeEventListener('keydown', onKey);
      el.remove();
    },
    focus(prefill) {
      if (collapsed) setCollapsed(false, false);
      if (prefill !== undefined) input.value = prefill;
      input.focus();
      const n = input.value.length;
      input.setSelectionRange(n, n);
    },
    isCollapsed: () => collapsed,
    collapse: () => setCollapsed(true),
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || isTypingTarget(ev.target)) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      api.focus();
    } else if (ev.key === '/') {
      ev.preventDefault();
      api.focus('/');
    }
  };
  document.addEventListener('keydown', onKey);
  const mq = matchMedia(NARROW_QUERY);
  const onBreakpoint = () => setCollapsed(mq.matches ? true : ui.settings.get().chatCollapsed, false);
  mq.addEventListener('change', onBreakpoint);
  const unsubs = [
    () => mq.removeEventListener('change', onBreakpoint),
    state.subscribe('chat', onChat),
    state.subscribe('chatTab', () => {
      tabBar.select(state.get('chatTab'), false);
      renderLog();
      updateBadge();
    }),
    state.subscribe('me', refreshInput),
  ];

  setCollapsed(collapsed, false);
  refreshInput();
  renderLog();
  updateBadge();
  return api;
}
