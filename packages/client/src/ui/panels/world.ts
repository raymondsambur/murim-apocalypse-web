/**
 * World panel (O): a large map, the chronicle of the living world, faction standings and settlement status.
 * Data: query `world` (factions, settlements, hearts), query `chronicle` (paging), store `chronicle` (live `chron`
 * messages) and store `settlements` (live `settle` messages). Refreshed every minute while open.
 */
import { FACTION_BY_ID, type ChronicleEntry, type ChronicleKind, type SettlementDef, type WorldInfo } from '@murim/shared';
import '../../styles/panels/world.css';
import { addStrings, t } from '../../i18n';
import type { UiContext } from '../context';
import { h, isNarrow, mount } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtInt, fmtNum, seasonName } from '../format';
import {
  CHRONICLE_KINDS,
  CHRONICLE_PAGE,
  KIND_GLYPH,
  NO_FILTER,
  STATUS_COLOR,
  STATUS_TONE,
  barPct,
  blightLevel,
  chronicleStamp,
  factionColor,
  factionName,
  factionRows,
  groupByDay,
  mergeChronicle,
  oldestId,
  pageChronicle,
  sortSettlements,
  type ChronicleFilter,
  type SettlementSort,
} from '../logic/world';
import { deviceRatio } from '../portrait';
import { bar } from '../widgets/bar';
import { tabs } from '../widgets/tabs';
import { attachTooltip } from '../widgets/tooltip';
import { registerPanel } from './registry';

addStrings({
  'world.title': 'World',
  'world.tabs': 'World sections',
  'world.tab.map': 'Map',
  'world.tab.chronicle': 'Chronicle',
  'world.tab.factions': 'Factions',
  'world.tab.settlements': 'Settlements',
  'world.loading': 'Reading the world…',
  'world.refresh': 'Refresh',
  'world.updated': 'Updated {time} ago',
  'world.online': '{n} online',
  'world.map.label': 'World map. Click to centre the camera.',
  'world.map.hint': 'Click the map to look at that place.',
  'world.map.unready': 'The map is not ready yet.',
  'world.map.you': 'You',
  'world.map.blight': 'Blight',
  'world.map.heart': 'Blight heart',
  'world.map.siege': 'Besieged',
  'world.map.fallen': 'Fallen',
  'world.map.settlement': 'Settlement (colour = ruling faction)',
  'world.map.hearts': 'Blight hearts: {n}',
  'world.map.legend': 'Legend',
  'world.map.center': 'Centre on me',
  'world.chron.empty': 'No news matches these filters.',
  'world.chron.filter': 'Filter',
  'world.chron.importance': 'Importance',
  'world.chron.imp.1': 'All news',
  'world.chron.imp.2': 'Notable',
  'world.chron.imp.3': 'World-shaking',
  'world.chron.more': 'Older news',
  'world.chron.loadingMore': 'Loading…',
  'world.chron.end': 'That is all the chronicle remembers.',
  'world.chron.day': 'Day {day}',
  'world.chron.go': 'Look at {name}',
  'world.chron.kind.blight': 'Blight',
  'world.chron.kind.faction': 'Factions',
  'world.chron.kind.settlement': 'Settlements',
  'world.chron.kind.npc': 'People',
  'world.chron.kind.weather': 'Weather',
  'world.chron.kind.economy': 'Trade',
  'world.chron.kind.player': 'Heroes',
  'world.chron.kind.legend': 'Legends',
  'world.chron.kind.season': 'Seasons',
  'world.chron.clear': 'Clear filters',
  'world.fac.power': 'Power',
  'world.fac.wealth': 'Wealth',
  'world.fac.influence': 'Influence',
  'world.fac.war': 'At war with {names}',
  'world.fac.ally': 'Allied with {names}',
  'world.fac.peace': 'No wars or alliances',
  'world.fac.holds': 'Holds {n}',
  'world.fac.holdsNone': 'Holds no settlements',
  'world.fac.goal': 'Goal: {goal}',
  'world.fac.rep': 'Your standing: {title} ({n})',
  'world.fac.ideology.righteous': 'Righteous',
  'world.fac.ideology.heterodox': 'Heterodox',
  'world.fac.ideology.neutral': 'Neutral',
  'world.fac.ideology.outlaw': 'Outlaw',
  'world.set.sort': 'Sort',
  'world.set.sort.status': 'Status',
  'world.set.sort.name': 'Name',
  'world.set.sort.prosperity': 'Prosperity',
  'world.set.sort.blight': 'Blight',
  'world.set.status.thriving': 'Thriving',
  'world.set.status.stable': 'Stable',
  'world.set.status.struggling': 'Struggling',
  'world.set.status.besieged': 'Besieged',
  'world.set.status.fallen': 'Fallen',
  'world.set.prosperity': 'Prosperity',
  'world.set.defense': 'Defense',
  'world.set.blight': 'Blight',
  'world.set.blight.clean': 'Clean',
  'world.set.blight.light': 'Light',
  'world.set.blight.heavy': 'Heavy',
  'world.set.blight.severe': 'Severe',
  'world.set.pop': 'Pop. {n}',
  'world.set.free': 'Independent',
  'world.set.siege': 'Under siege',
  'world.set.flag.famine': 'Famine',
  'world.set.flag.plague': 'Plague',
  'world.set.flag.festival': 'Festival',
  'world.set.look': 'Look',
  'world.set.empty': 'No settlements known.',
  'world.set.here': 'You are here',
});

type TabId = 'map' | 'chronicle' | 'factions' | 'settlements';
let tab: TabId = 'map';

interface InfoCache {
  data: WorldInfo | null;
  at: number;
  loading: boolean;
  error: string | null;
}
const info: InfoCache = { data: null, at: 0, loading: false, error: null };

// chronicle view state
let filter: ChronicleFilter = { ...NO_FILTER };
let pages = 1;
let older: ChronicleEntry[] = [];
let exhausted = false;
let loadingOlder = false;
let sortBy: SettlementSort = 'status';

let mapCanvas: HTMLCanvasElement | null = null;
let mapTimer: number | null = null;
let refreshTimer: number | null = null;
let unsubs: (() => void)[] = [];

function settlementDefs(ui: UiContext): SettlementDef[] {
  return ui.state.get('world')?.payload.settlements ?? [];
}

function nameOf(ui: UiContext, id: number | undefined): string {
  if (id === undefined) return '';
  return settlementDefs(ui).find((s) => s.id === id)?.name ?? `#${id}`;
}

function lookAt(ui: UiContext, s: SettlementDef): void {
  ui.gameView.centerOn(s.x, s.y);
  if (isNarrow()) ui.panels.close('world');
}

function loadInfo(ui: UiContext, force = false): void {
  if (info.loading) return;
  if (!force && info.data && Date.now() - info.at < 20_000) return;
  info.loading = true;
  void ui.net
    .query('world', {})
    .then((d) => {
      info.data = d;
      info.error = null;
    })
    .catch((e) => {
      info.error = queryErrorMessage(e);
    })
    .finally(() => {
      info.loading = false;
      info.at = Date.now();
      ui.panels.refresh('world');
    });
}

function loadOlder(ui: UiContext): void {
  if (loadingOlder || exhausted) return;
  const all = mergeChronicle(ui.state.get('chronicle'), older);
  const before = oldestId(all);
  loadingOlder = true;
  ui.panels.refresh('world');
  void ui.net
    .query('chronicle', { before, limit: CHRONICLE_PAGE })
    .then((rows) => {
      if (!rows.length) exhausted = true;
      older = mergeChronicle(older, rows);
      pages++;
    })
    .catch((e) => ui.toast(queryErrorMessage(e), 'bad'))
    .finally(() => {
      loadingOlder = false;
      ui.panels.refresh('world');
    });
}

function drawMap(ui: UiContext): void {
  const canvas = mapCanvas;
  if (!canvas || !canvas.isConnected || document.hidden) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const dpr = deviceRatio();
  const w = Math.round(r.width * dpr);
  const hh = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  try {
    ui.gameView.drawMinimap(canvas);
  } catch (e) {
    console.error('[world map]', e);
  }
}

// ---- Map ------------------------------------------------------------------------------------------------------

function mapTab(ui: UiContext): HTMLElement[] {
  const canvas = h('canvas', { class: 'world-map-canvas', role: 'img', 'aria-label': t('world.map.label'), tabindex: '0' });
  mapCanvas = canvas;
  const centre = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * canvas.width;
    const py = ((ev.clientY - r.top) / r.height) * canvas.height;
    const tile = ui.gameView.minimapToTile(canvas, px, py);
    ui.gameView.centerOn(tile.x, tile.y);
    if (isNarrow()) ui.panels.close('world');
  };
  canvas.addEventListener('click', centre);
  canvas.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      const s = ui.state.selfEntity();
      if (s) ui.gameView.centerOn(s.x, s.y);
      ev.preventDefault();
    }
  });
  const hearts = info.data?.hearts.length;
  const legend = h(
    'ul',
    { class: 'world-legend', 'aria-label': t('world.map.legend') },
    h('li', {}, h('i', { class: 'lg lg-self' }), t('world.map.you')),
    h('li', {}, h('i', { class: 'lg lg-set' }), t('world.map.settlement')),
    h('li', {}, h('i', { class: 'lg lg-siege' }), t('world.map.siege')),
    h('li', {}, h('i', { class: 'lg lg-fallen' }), t('world.map.fallen')),
    h('li', {}, h('i', { class: 'lg lg-blight' }), t('world.map.blight')),
    h('li', {}, h('i', { class: 'lg lg-heart' }), t('world.map.heart')),
  );
  const facs = h(
    'ul',
    { class: 'world-legend world-legend-fac' },
    ...Object.values(FACTION_BY_ID).map((f) => h('li', {}, h('i', { class: 'lg lg-fac', style: { background: f.color } }), f.short)),
  );
  const out = [
    h('div', { class: 'world-map-wrap' }, canvas),
    h('div', { class: 'world-map-bar' }, h('span', { class: 'jobs-fine' }, t('world.map.hint')), hearts !== undefined ? h('span', { class: 'chip chip-bad' }, t('world.map.hearts', { n: hearts })) : null, h('button', { class: 'btn btn-xs', type: 'button', onclick: () => { const s = ui.state.selfEntity(); if (s) ui.gameView.centerOn(s.x, s.y); } }, t('world.map.center'))),
    legend,
    facs,
  ];
  requestAnimationFrame(() => drawMap(ui));
  return out;
}

// ---- Chronicle -----------------------------------------------------------------------------------------------------

function chronicleTab(ui: UiContext): HTMLElement[] {
  const all = mergeChronicle(ui.state.get('chronicle'), older);
  const view = pageChronicle(all, filter, pages);
  const defs = settlementDefs(ui);

  const kindChips = CHRONICLE_KINDS.map((k) => {
    const on = !!filter.kinds?.has(k);
    return h(
      'button',
      {
        class: ['chip', 'world-chip', on && 'chip-gold'],
        type: 'button',
        'aria-pressed': String(on),
        onclick: () => {
          const next = new Set(filter.kinds ?? []);
          if (on) next.delete(k);
          else next.add(k);
          filter = { ...filter, kinds: next.size ? next : null };
          pages = 1;
          ui.panels.refresh('world');
        },
      },
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, KIND_GLYPH[k]),
      t(`world.chron.kind.${k}`),
    );
  });
  const imp = h(
    'select',
    {
      class: 'select world-imp',
      'aria-label': t('world.chron.importance'),
      onchange: (ev: Event) => {
        filter = { ...filter, minImportance: Number((ev.target as HTMLSelectElement).value) as 1 | 2 | 3 };
        pages = 1;
        ui.panels.refresh('world');
      },
    },
    ...([1, 2, 3] as const).map((n) => h('option', { value: String(n), selected: filter.minImportance === n }, t(`world.chron.imp.${n}`))),
  );
  const filtered = !!filter.kinds || filter.minImportance > 1;
  const controls = h(
    'div',
    { class: 'world-filters' },
    h('div', { class: 'chip-row', role: 'group', 'aria-label': t('world.chron.filter') }, kindChips),
    h('div', { class: 'world-filter-row' }, imp, filtered ? h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => { filter = { ...NO_FILTER }; pages = 1; ui.panels.refresh('world'); } }, t('world.chron.clear')) : null),
  );

  const list = h('div', { class: 'world-chron', 'data-scroll-key': 'chron' });
  if (!view.shown.length) list.append(h('p', { class: 'empty-note' }, t('world.chron.empty')));
  for (const g of groupByDay(view.shown)) {
    list.append(h('div', { class: 'world-day' }, t('world.chron.day', { day: g.day + 1 })));
    for (const e of g.entries) {
      const s = e.settlementId !== undefined ? defs.find((d) => d.id === e.settlementId) : undefined;
      const stamp = chronicleStamp(e);
      list.append(
        h(
          'article',
          { class: ['world-entry', `imp-${e.importance}`], dataset: { kind: e.kind } },
          h('span', { class: 'world-entry-glyph', 'aria-hidden': 'true' }, KIND_GLYPH[e.kind]),
          h('div', { class: 'world-entry-body' }, h('div', { class: 'world-entry-text' }, e.text), h('div', { class: 'jobs-fine' }, stamp.hour, ' · ', t(`world.chron.kind.${e.kind}`), s ? [' · ', h('button', { class: 'world-link', type: 'button', title: t('world.chron.go', { name: s.name }), onclick: () => lookAt(ui, s) }, s.name)] : null)),
        ),
      );
    }
  }
  const more = view.hasMoreLocal
    ? h('button', { class: 'btn btn-sm btn-block', type: 'button', onclick: () => { pages++; ui.panels.refresh('world'); } }, t('world.chron.more'))
    : exhausted
      ? h('p', { class: 'jobs-fine world-end' }, t('world.chron.end'))
      : h('button', { class: 'btn btn-sm btn-block', type: 'button', disabled: loadingOlder, onclick: () => loadOlder(ui) }, loadingOlder ? t('world.chron.loadingMore') : t('world.chron.more'));
  return [controls, list, more];
}

// ---- Factions ---------------------------------------------------------------------------------------------------------

function factionsTab(ui: UiContext): HTMLElement[] {
  const data = info.data;
  if (!data) return [info.error ? h('p', { class: 'tone-bad' }, info.error) : h('p', { class: 'empty-note' }, t('world.loading'))];
  const me = ui.state.get('me');
  const rows = factionRows(data.factions, me?.c.reputation);
  const maxInf = Math.max(100, ...rows.map((r) => r.brief.influence));
  return rows.map(({ brief: f, rep, repTitle }) => {
    const def = FACTION_BY_ID[f.id];
    const color = factionColor(f.id);
    const mk = (kind: 'hp' | 'gold' | 'qi', label: string, v: number, max: number) => {
      const b = bar(kind, { label: `${def?.short ?? f.id} ${label}`, size: 'sm', tag: label, text: true });
      b.set(barPct(v, max), 100, fmtInt(v));
      return b.el;
    };
    const names = (ids: string[]) => ids.map((i) => factionName(i) || i).join(', ');
    const held = f.settlements.map((id) => settlementDefs(ui).find((s) => s.id === id)).filter((s): s is SettlementDef => !!s);
    const card = h(
      'section',
      { class: 'card world-faction', style: { '--fac': color } },
      h(
        'header',
        { class: 'world-fac-head' },
        h('span', { class: 'seal world-fac-seal', 'aria-hidden': 'true', style: { background: color } }, (def?.short ?? f.id).slice(0, 1)),
        h('div', { class: 'world-fac-title' }, h('strong', {}, def?.name ?? f.id), def ? h('span', { class: 'chip' }, t(`world.fac.ideology.${def.ideology}`)) : null),
      ),
      def ? h('p', { class: 'jobs-desc' }, def.desc) : null,
      h('div', { class: 'world-fac-bars' }, mk('hp', t('world.fac.power'), f.power, 100), mk('gold', t('world.fac.wealth'), f.wealth, 150), mk('qi', t('world.fac.influence'), f.influence, maxInf)),
      h(
        'div',
        { class: 'chip-row world-fac-rel' },
        f.atWarWith.length ? h('span', { class: 'chip chip-bad' }, t('world.fac.war', { names: names(f.atWarWith) })) : null,
        f.alliedWith.length ? h('span', { class: 'chip chip-good' }, t('world.fac.ally', { names: names(f.alliedWith) })) : null,
        !f.atWarWith.length && !f.alliedWith.length ? h('span', { class: 'chip' }, t('world.fac.peace')) : null,
      ),
      h(
        'div',
        { class: 'world-fac-holds' },
        h('span', { class: 'jobs-fine' }, held.length ? t('world.fac.holds', { n: held.length }) : t('world.fac.holdsNone'), held.length ? ': ' : ''),
        ...held.map((s) => h('button', { class: 'world-link', type: 'button', onclick: () => lookAt(ui, s) }, s.name)),
      ),
      h('div', { class: 'jobs-fine' }, t('world.fac.goal', { goal: f.goal ? f.goal.charAt(0).toUpperCase() + f.goal.slice(1) : '-' })),
      rep !== null ? h('div', { class: ['world-rep', rep < -10 ? 'tone-bad' : rep >= 30 ? 'tone-good' : 'tone-dim'] }, t('world.fac.rep', { title: repTitle ?? '', n: rep })) : null,
    );
    return card;
  });
}

// ---- Settlements ---------------------------------------------------------------------------------------------------------

function settlementsTab(ui: UiContext): HTMLElement[] {
  const defs = settlementDefs(ui);
  const views = ui.state.get('settlements');
  const self = ui.state.selfEntity();
  const rows = defs
    .map((d) => ({ def: d, name: d.name, view: views.get(d.id) }))
    .filter((r): r is { def: SettlementDef; name: string; view: NonNullable<typeof r.view> } => !!r.view);
  if (!rows.length) return [h('p', { class: 'empty-note' }, t('world.set.empty'))];
  const sort = h(
    'label',
    { class: 'world-sort' },
    h('span', { class: 'field-label' }, t('world.set.sort')),
    h(
      'select',
      {
        class: 'select',
        onchange: (ev: Event) => {
          sortBy = (ev.target as HTMLSelectElement).value as SettlementSort;
          ui.panels.refresh('world');
        },
      },
      ...(['status', 'name', 'prosperity', 'blight'] as const).map((k) => h('option', { value: k, selected: sortBy === k }, t(`world.set.sort.${k}`))),
    ),
  );
  const cards = sortSettlements(rows, sortBy).map(({ def, view }) => {
    const here = !!self && Math.hypot(def.x - self.x, def.y - self.y) <= def.radius;
    const pros = bar('xp', { label: t('world.set.prosperity'), size: 'sm', tag: t('world.set.prosperity'), text: true });
    pros.set(view.prosperity, 100, fmtNum(view.prosperity, 0));
    const def2 = bar('hp', { label: t('world.set.defense'), size: 'sm', tag: t('world.set.defense'), text: true });
    def2.set(view.defense, 100, fmtNum(view.defense, 0));
    const bl = blightLevel(view.blight);
    const blb = bar('enemy', { label: t('world.set.blight'), size: 'sm', tag: t('world.set.blight'), text: true });
    blb.set(bl.frac, 1, t(`world.set.blight.${bl.key}`));
    const ctrl = view.controller ? factionName(view.controller) || view.controller : t('world.set.free');
    return h(
      'section',
      { class: ['card', 'world-settle', `st-${view.status}`], style: { '--st': STATUS_COLOR[view.status] } },
      h(
        'header',
        { class: 'world-set-head' },
        h('strong', {}, def.name),
        h('span', { class: `chip chip-${STATUS_TONE[view.status] === 'dim' ? '' : STATUS_TONE[view.status]}`.trim() }, t(`world.set.status.${view.status}`)),
        view.siege ? h('span', { class: 'chip chip-bad world-siege' }, '⚔ ', t('world.set.siege')) : null,
        here ? h('span', { class: 'chip chip-gold' }, t('world.set.here')) : null,
      ),
      h('div', { class: 'world-set-sub' }, h('span', { class: 'world-ctrl' }, h('i', { class: 'lg lg-fac', style: { background: factionColor(view.controller, '#6b6b70') } }), ctrl), h('span', { class: 'jobs-fine' }, t('world.set.pop', { n: fmtInt(view.population) }))),
      h('div', { class: 'world-fac-bars' }, pros.el, def2.el, blb.el),
      view.flags.length ? h('div', { class: 'chip-row' }, ...view.flags.map((f) => h('span', { class: ['chip', f === 'festival' ? 'chip-good' : 'chip-warn'] }, t(`world.set.flag.${f}`) === `world.set.flag.${f}` ? f : t(`world.set.flag.${f}`)))) : null,
      h('div', { class: 'world-set-actions' }, h('button', { class: 'btn btn-xs', type: 'button', onclick: () => lookAt(ui, def) }, t('world.set.look'))),
    );
  });
  return [sort, ...cards];
}

// ---- panel ---------------------------------------------------------------------------------------------------------------------

registerPanel({
  id: 'world',
  title: 'world.title',
  glyph: '世',
  hotkey: 'o',
  order: 60,
  width: 480,
  watch: ['chronicle', 'settlements', 'me'],
  onOpen(ui) {
    loadInfo(ui, true);
    if (mapTimer !== null) window.clearInterval(mapTimer);
    mapTimer = window.setInterval(() => {
      if (tab === 'map') drawMap(ui);
    }, 500);
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => loadInfo(ui, true), 60_000);
    unsubs.push(ui.state.subscribe('settlements', () => loadInfo(ui)));
  },
  onClose() {
    if (mapTimer !== null) window.clearInterval(mapTimer);
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    mapTimer = refreshTimer = null;
    mapCanvas = null;
    for (const u of unsubs) u();
    unsubs = [];
  },
  render(root, ui) {
    const tb = tabs(
      [
        { id: 'map', label: t('world.tab.map'), glyph: '圖' },
        { id: 'chronicle', label: t('world.tab.chronicle'), glyph: '史' },
        { id: 'factions', label: t('world.tab.factions'), glyph: '旗' },
        { id: 'settlements', label: t('world.tab.settlements'), glyph: '城' },
      ],
      (id) => {
        tab = id as TabId;
        ui.panels.refresh('world');
      },
      { initial: tab, label: t('world.tabs'), cls: 'tabs-tight' },
    );
    mapCanvas = null;
    const time = ui.state.get('time');
    const status = h(
      'div',
      { class: 'world-status' },
      time ? h('span', { class: 'chip' }, `${seasonName(time.season)} · ${t('world.chron.day', { day: time.day + 1 })}`) : null,
      info.data ? h('span', { class: 'chip' }, t('world.online', { n: info.data.online })) : null,
      h('button', { class: 'btn btn-xs btn-ghost', type: 'button', disabled: info.loading, onclick: () => loadInfo(ui, true) }, t('world.refresh')),
    );
    const body = h('div', { class: 'world-body', role: 'tabpanel' });
    const parts = tab === 'map' ? mapTab(ui) : tab === 'chronicle' ? chronicleTab(ui) : tab === 'factions' ? factionsTab(ui) : settlementsTab(ui);
    if (info.error && tab !== 'factions') parts.unshift(h('p', { class: 'tone-bad jobs-fine' }, info.error));
    body.append(...parts);
    mount(root, tb.el, status, body);
  },
});

export type { ChronicleKind };
