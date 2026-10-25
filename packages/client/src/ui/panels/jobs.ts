/**
 * Jobs & Crafting panel (J): five job cards, the running activity (train / shift / craft) with live time and an output
 * estimate, work sites of the settlement you stand in (start training / shifts) and recipes with bag counts.
 * Server rules: docs/notes/gameplay-activities.md.
 */
import { JOB_DEFS, JOB_MAX_LEVEL, OFFLINE_CAP_MS, RECIPES, type Activity, type JobId, type RecipeView, type SiteView } from '@murim/shared';
import '../../styles/panels/jobs.css';
import { addStrings, t } from '../../i18n';
import type { UiContext } from '../context';
import { h, mount } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtDuration, fmtInt, fmtNum } from '../format';
import {
  CRAFT_RANGE,
  JOB_ORDER,
  bagCount,
  craftProgress,
  elapsedInfo,
  itemName,
  jobCard,
  maxCraftQty,
  nearestSettlement,
  recipeAffordability,
  shiftEstimate,
  shiftPerHour,
  siteModel,
  sortSites,
  trainXpPerHour,
  type SiteModel,
} from '../logic/jobs';
import { bar } from '../widgets/bar';
import { stepper } from '../widgets/stepper';
import { tabs } from '../widgets/tabs';
import { attachTooltip } from '../widgets/tooltip';
import { registerPanel } from './registry';
import { icon } from '../icons';
import { jobIconName } from '../glyphMap';

addStrings({
  'jobs.title': 'Jobs & Crafting',
  'jobs.tab.work': 'Work',
  'jobs.tab.sites': 'Sites',
  'jobs.tab.craft': 'Crafting',
  'jobs.tabs': 'Jobs sections',
  'jobs.current': 'Current activity',
  'jobs.idle': 'You are not working. Pick a site below to train, work a shift or craft.',
  'jobs.idleGo': 'Open sites',
  'jobs.kind.train': 'Training',
  'jobs.kind.shift': '{job} shift',
  'jobs.kind.craft': 'Crafting: {name}',
  'jobs.elapsed': 'Elapsed {time}',
  'jobs.capLeft': 'Ends automatically in {time}',
  'jobs.capReached': 'The 8-hour limit was reached; output stopped.',
  'jobs.capNote': 'Work continues while you are offline for up to {n} hours.',
  'jobs.estimate': 'Estimated so far',
  'jobs.perHour': 'Per hour',
  'jobs.est.gold': '{n} gold',
  'jobs.est.xp': '{n} job XP',
  'jobs.est.cult': '{n} cultivation XP',
  'jobs.est.note': 'An estimate: whole units are paid out about once a minute.',
  'jobs.stop': 'Stop',
  'jobs.stopTip': 'Settle what you have earned and end the activity.',
  'jobs.stopCraft': 'Stopping gives back unstarted units but loses the one in progress.',
  'jobs.stopConfirm': 'Stop crafting? The unit in progress is lost.',
  'jobs.craft.units': '{done} done, {left} to go',
  'jobs.craft.unit': 'Current unit',
  'jobs.craft.eta': 'All done in {time}',
  'jobs.jobs': 'Trades',
  'jobs.level': 'Lv {n}',
  'jobs.maxed': 'Max',
  'jobs.xpLabel': '{name} experience',
  'jobs.mode.gather': 'Gathers: {items}',
  'jobs.mode.craft': 'Crafts {n} recipes at a {site}',
  'jobs.site.herbHut': 'herb hut',
  'jobs.site.mine': 'mine',
  'jobs.site.farm': 'farm',
  'jobs.site.smithy': 'smithy',
  'jobs.site.alchemyLab': 'alchemy lab',
  'jobs.site.dojo': 'dojo',
  'jobs.site.other': 'Site',
  'jobs.site.none': 'Nothing to do here.',
  'jobs.yield': 'About {items} and {gold} gold per hour',
  'jobs.recent': 'Recent reports',
  'jobs.recent.empty': 'Nothing to report yet.',
  'jobs.sites.where': 'Sites in {name}',
  'jobs.sites.nowhere': 'You are not near a settlement. Walk to a town or village to find work.',
  'jobs.sites.nearest': 'Nearest: {name}, {n} tiles away.',
  'jobs.sites.loading': 'Looking for work sites…',
  'jobs.sites.empty': 'This settlement has no work sites.',
  'jobs.sites.train': 'Train here',
  'jobs.sites.trainTip': 'Meditate inside the settlement to gain cultivation XP. A dojo gives x1.5.',
  'jobs.sites.trainAny': 'Meditate',
  'jobs.sites.dojoBonus': 'x{n} XP',
  'jobs.sites.startShift': 'Start shift',
  'jobs.sites.craftHere': 'Craft here',
  'jobs.sites.walk': 'Walk there',
  'jobs.sites.dist': '{n} tiles',
  'jobs.sites.close': 'In reach',
  'jobs.sites.far': 'Walk closer ({n} tiles to go)',
  'jobs.why.busy': 'Stop your current activity first.',
  'jobs.why.combat': 'Not while fighting.',
  'jobs.why.far': 'Walk up to it first ({n} tiles).',
  'jobs.why.dead': 'Not while down.',
  'jobs.craft.pick': 'Workshop',
  'jobs.craft.none': 'No workshop in reach. Visit a smithy or alchemy lab to see recipes.',
  'jobs.craft.loading': 'Loading recipes…',
  'jobs.craft.empty': 'No recipes here.',
  'jobs.craft.needLv': 'Needs {job} level {n}',
  'jobs.craft.makes': 'Makes {item}',
  'jobs.craft.time': '{time} each',
  'jobs.craft.inputs': 'Materials',
  'jobs.craft.qty': 'Quantity',
  'jobs.craft.total': 'Total {time}',
  'jobs.craft.go': 'Craft',
  'jobs.craft.goN': 'Craft x{n}',
  'jobs.craft.missing': 'Missing materials',
  'jobs.craft.maxTime': 'Up to {n} per batch (8-hour limit)',
  'jobs.craft.canNot': 'Cannot craft yet',
  'jobs.craft.have': '{have}/{need}',
  'jobs.craft.rarity': 'Gear rolls its quality when finished; a higher trade level improves the odds.',
  'jobs.craft.walkFirst': 'Walk up to the workshop (within {n} tiles).',
  'jobs.craft.started': 'Crafting started.',
  'jobs.refresh': 'Refresh',
  'jobs.err.noWorld': 'The world map is not loaded yet.',
});

type TabId = 'work' | 'sites' | 'craft';
let tab: TabId = 'work';
let craftSiteId: string | null = null;
let craftRecipeId: string | null = null;
let craftQty = 1;

interface Cached<T> {
  key: string;
  at: number;
  loading: boolean;
  data: T | null;
  error: string | null;
}
const sitesCache: Cached<SiteView[]> = { key: '', at: 0, loading: false, data: null, error: null };
const recipesCache: Cached<RecipeView[]> = { key: '', at: 0, loading: false, data: null, error: null };

let tick: (() => void) | null = null;
let timer: number | null = null;
let slowCount = 0;

function worldSettlements(ui: UiContext) {
  return ui.state.get('world')?.payload.settlements ?? [];
}

function currentSettlement(ui: UiContext) {
  const pos = ui.state.selfEntity();
  const me = ui.state.get('me');
  const x = pos?.x ?? me?.c.x ?? 0;
  const y = pos?.y ?? me?.c.y ?? 0;
  const near = nearestSettlement(worldSettlements(ui), x, y);
  return { pos: { x, y }, near };
}

function load<T>(cache: Cached<T>, key: string, fetcher: () => Promise<T>, ui: UiContext, force = false): void {
  const stale = Date.now() - cache.at > 1500;
  if (cache.loading) return;
  if (!force && cache.key === key && !stale) return;
  if (cache.key !== key) {
    cache.data = null;
  }
  cache.key = key;
  cache.loading = true;
  void fetcher()
    .then((d) => {
      cache.data = d;
      cache.error = null;
    })
    .catch((e) => {
      cache.error = queryErrorMessage(e);
    })
    .finally(() => {
      cache.loading = false;
      cache.at = Date.now();
      ui.panels.refresh('jobs');
    });
}

function itemChips(list: [string, number][], digits = 0): HTMLElement[] {
  return list.map(([id, n]) => h('span', { class: 'chip jobs-chip' }, `${digits ? fmtNum(n, digits) : fmtInt(n)} × ${itemName(id)}`));
}

function jobName(id: JobId): string {
  return JOB_DEFS[id].name;
}

// ---- Work tab ------------------------------------------------------------------------------------------------------------

function activityCard(ui: UiContext, a0: Activity | null): HTMLElement {
  const a = a0;
  const me = ui.state.get('me')!;
  if (!a) {
    return h(
      'section',
      { class: 'card jobs-current jobs-idle' },
      h('div', { class: 'sect-title' }, t('jobs.current')),
      h('p', { class: 'empty-note' }, t('jobs.idle')),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => selectTab('sites', ui) }, t('jobs.idleGo')),
    );
  }
  const season = ui.state.get('time')?.season ?? 0;
  const now = ui.state.serverNow();
  const live = h('div', { class: 'jobs-live' });
  const progress = h('div', { class: 'jobs-progress' });
  const refreshLive = () => {
    const a: Activity = ui.state.get('me')?.c.activity ?? a0!;
    const nowT = ui.state.serverNow();
    const info = elapsedInfo(a, nowT);
    const rows: HTMLElement[] = [];
    rows.push(h('div', { class: 'jobs-row' }, h('span', {}, t('jobs.elapsed', { time: fmtDuration(info.workedMs) })), h('span', { class: info.capped ? 'tone-warn' : 'tone-dim' }, info.capped ? t('jobs.capReached') : t('jobs.capLeft', { time: fmtDuration(info.remainingMs) }))));
    if (a.kind === 'shift') {
      const lv = me.c.jobs[a.job]?.lv ?? 1;
      const est = shiftEstimate(a.job, lv, season, info.workedMs);
      rows.push(
        h(
          'div',
          { class: 'jobs-est' },
          h('div', { class: 'jobs-est-title' }, t('jobs.estimate')),
          h('div', { class: 'chip-row' }, ...itemChips(est.items, 1), h('span', { class: 'chip chip-gold' }, t('jobs.est.gold', { n: fmtInt(est.gold) })), h('span', { class: 'chip chip-info' }, t('jobs.est.xp', { n: fmtInt(est.xp) }))),
          h('p', { class: 'jobs-fine' }, t('jobs.est.note')),
        ),
      );
    } else if (a.kind === 'train') {
      const insight = me.d.total.insight;
      const spirit = me.d.total.spirit;
      const dojo = (sitesCache.data ?? []).find((s) => s.id === a.site)?.kind === 'dojo';
      const perHour = trainXpPerHour(insight, spirit, dojo);
      rows.push(h('div', { class: 'jobs-est' }, h('div', { class: 'jobs-est-title' }, t('jobs.estimate')), h('div', { class: 'chip-row' }, h('span', { class: 'chip chip-info' }, t('jobs.est.cult', { n: fmtInt((perHour * info.workedMs) / 3_600_000) })), h('span', { class: 'chip' }, `${t('jobs.perHour')}: ${fmtInt(perHour)}`))));
    } else {
      const p = craftProgress(a, nowT);
      if (p) {
        const unit = bar('job', { label: t('jobs.craft.unit'), size: 'sm', text: false });
        unit.set(p.unit, 1);
        rows.push(
          h('div', { class: 'jobs-row' }, h('span', {}, t('jobs.craft.units', { done: p.done, left: p.remaining })), h('span', { class: 'tone-dim' }, t('jobs.craft.eta', { time: fmtDuration(p.etaMs) }))),
          unit.el,
        );
      }
    }
    mount(live, ...rows);
  };
  refreshLive();
  tick = refreshLive;
  void now;
  void progress;

  const title =
    a.kind === 'train' ? t('jobs.kind.train') : a.kind === 'shift' ? t('jobs.kind.shift', { job: jobName(a.job) }) : t('jobs.kind.craft', { name: RECIPES[a.recipe]?.name ?? a.recipe });
  const headIcon = a.kind === 'train' ? 'training' : a.kind === 'shift' ? jobIconName(JOB_DEFS[a.job]) : jobIconName(JOB_DEFS[RECIPES[a.recipe]?.job ?? 'blacksmith']);
  const stop = h(
    'button',
    {
      class: 'btn btn-sm btn-danger',
      type: 'button',
      onclick: async () => {
        if (a.kind === 'craft' && a.remaining > 0 && !(await ui.confirm({ title: t('jobs.stop'), text: t('jobs.stopConfirm'), ok: t('jobs.stop'), danger: true }))) return;
        ui.net.send({ t: 'astop' });
      },
    },
    t('jobs.stop'),
  );
  attachTooltip(stop, () => (a.kind === 'craft' ? `${t('jobs.stopTip')} ${t('jobs.stopCraft')}` : t('jobs.stopTip')));
  return h(
    'section',
    { class: 'card jobs-current' },
    h('div', { class: 'sect-title' }, t('jobs.current')),
    h('div', { class: 'jobs-head' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, icon(headIcon)), h('div', { class: 'jobs-head-text' }, h('div', { class: 'jobs-name' }, title), h('div', { class: 'jobs-fine' }, t('jobs.capNote', { n: OFFLINE_CAP_MS / 3_600_000 }))), stop),
    live,
  );
}

function jobCards(ui: UiContext): HTMLElement {
  const me = ui.state.get('me')!;
  const season = ui.state.get('time')?.season ?? 0;
  const active = me.c.activity;
  const cards = JOB_ORDER.map((id) => {
    const def = JOB_DEFS[id];
    const m = jobCard(id, me.c.jobs[id], JOB_MAX_LEVEL);
    const xp = bar('job', { label: t('jobs.xpLabel', { name: def.name }), size: 'sm', text: true });
    xp.set(m.maxed ? 1 : m.xp, m.maxed ? 1 : m.xpNext, m.maxed ? t('jobs.maxed') : `${fmtInt(m.xp)} / ${fmtInt(m.xpNext)}`);
    const working = (active?.kind === 'shift' && active.job === id) || (active?.kind === 'craft' && RECIPES[active.recipe]?.job === id);
    let desc: HTMLElement;
    if (def.mode === 'gather') {
      const ph = shiftPerHour(id, m.level, season);
      desc = h('p', { class: 'jobs-desc' }, def.desc, ' ', h('span', { class: 'tone-good' }, t('jobs.yield', { items: ph.items.filter(([, n]) => n >= 0.5).map(([i, n]) => `${fmtNum(n, 1)} ${itemName(i)}`).join(', '), gold: fmtInt(ph.gold) })));
    } else {
      const n = Object.values(RECIPES).filter((r) => r.job === id).length;
      desc = h('p', { class: 'jobs-desc' }, def.desc, ' ', h('span', { class: 'tone-dim' }, t('jobs.mode.craft', { n, site: t(`jobs.site.${def.site}`) })));
    }
    return h(
      'div',
      { class: ['jobs-job', working && 'working'], role: 'listitem' },
      h('span', { class: 'seal jobs-seal', 'aria-hidden': 'true' }, icon(jobIconName(def))),
      h('div', { class: 'jobs-job-body' }, h('div', { class: 'jobs-job-head' }, h('strong', {}, def.name), h('span', { class: 'chip chip-gold' }, t('jobs.level', { n: m.level }))), xp.el, desc),
    );
  });
  return h('section', { class: 'jobs-sec' }, h('div', { class: 'sect-title' }, t('jobs.jobs')), h('div', { class: 'jobs-list', role: 'list' }, cards));
}

const REPORT_RE = /while you were away|shift|crafting|crafted|skill rose|you stop|you sit down|meditate|training|work limit|bag is full|cultivation is at its limit/i;

function recentReports(ui: UiContext): HTMLElement {
  const notes = ui.state.get('notes').filter((n) => REPORT_RE.test(n.text)).slice(-4).reverse();
  return h(
    'section',
    { class: 'jobs-sec' },
    h('div', { class: 'sect-title' }, t('jobs.recent')),
    notes.length ? h('ul', { class: 'jobs-reports' }, ...notes.map((n) => h('li', { class: `tone-${n.level === 'info' ? 'neutral' : n.level}` }, n.text))) : h('p', { class: 'empty-note' }, t('jobs.recent.empty')),
  );
}

// ---- Sites tab ------------------------------------------------------------------------------------------------------------

function selectTab(id: TabId, ui: UiContext): void {
  tab = id;
  ui.panels.refresh('jobs');
}

function siteLabel(s: SiteView): string {
  const key = `jobs.site.${s.kind}`;
  return t(key);
}

function sitesTab(ui: UiContext): HTMLElement[] {
  const me = ui.state.get('me')!;
  const { pos, near } = currentSettlement(ui);
  if (!near) return [h('p', { class: 'empty-note' }, t('jobs.err.noWorld'))];
  const reach = near.s.radius + 6;
  if (near.d > reach) {
    return [
      h('p', { class: 'empty-note' }, t('jobs.sites.nowhere')),
      h('p', { class: 'jobs-fine' }, t('jobs.sites.nearest', { name: near.s.name, n: Math.round(near.d) })),
    ];
  }
  const sid = near.s.id;
  load(sitesCache, String(sid), () => ui.net.query('sites', { settlement: sid }), ui);
  const sites: SiteView[] = sitesCache.data ?? near.s.sites.map((w) => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, settlementId: w.settlementId, job: (Object.values(JOB_DEFS).find((j) => j.site === w.kind)?.id) as JobId | undefined, trainBonus: w.kind === 'dojo' ? 1.5 : undefined }));
  const busy = !!me.c.activity;
  const inCombat = !!me.combatId;
  const dead = me.c.hp <= 0;
  const models = sortSites(sites.map((s) => siteModel(s, pos, busy, inCombat)));
  const out: HTMLElement[] = [h('div', { class: 'sect-title' }, t('jobs.sites.where', { name: near.s.name }))];
  if (sitesCache.error) out.push(h('p', { class: 'tone-bad jobs-fine' }, sitesCache.error));

  // plain meditation inside the settlement (works with any site id of the settlement)
  const anySite = sites.find((s) => s.kind !== 'dojo') ?? sites[0];
  if (anySite) {
    const dis = busy || inCombat || dead || !near.inside;
    const btn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: dis, onclick: () => ui.net.send({ t: 'astart', kind: 'train', site: anySite.id }) }, t('jobs.sites.trainAny'));
    attachTooltip(btn, () => (busy ? t('jobs.why.busy') : !near.inside ? t('jobs.sites.nowhere') : t('jobs.sites.trainTip')));
    out.push(h('div', { class: 'card jobs-site' }, h('span', { class: 'seal jobs-seal', 'aria-hidden': 'true' }, icon('training')), h('div', { class: 'jobs-site-body' }, h('strong', {}, t('jobs.sites.train')), h('div', { class: 'jobs-fine' }, t('jobs.sites.trainTip'))), btn));
  }
  if (!models.length) out.push(h('p', { class: 'empty-note' }, t('jobs.sites.empty')));
  for (const m of models) out.push(siteCard(ui, m, dead));
  return out;
}

function siteCard(ui: UiContext, m: SiteModel, dead: boolean): HTMLElement {
  const s = m.site;
  const siteIcon = s.kind === 'dojo' ? 'training' : s.job ? jobIconName(JOB_DEFS[s.job]) : 'sites';
  const act = m.action;
  let button: HTMLElement | null = null;
  const blocked = dead ? { key: 'jobs.why.dead' } : m.blocked;
  const why = blocked ? t(blocked.key, blocked.params) : '';
  if (act?.kind === 'train') {
    button = h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: !!blocked, onclick: () => ui.net.send({ t: 'astart', kind: 'train', site: s.id }) }, t('jobs.sites.train'));
  } else if (act?.kind === 'shift') {
    button = h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: !!blocked, onclick: () => ui.net.send({ t: 'astart', kind: 'shift', site: s.id, job: act.job }) }, t('jobs.sites.startShift'));
  } else if (act?.kind === 'craft') {
    button = h(
      'button',
      {
        class: 'btn btn-sm btn-primary',
        type: 'button',
        onclick: () => {
          craftSiteId = s.id;
          craftRecipeId = null;
          recipesCache.key = '';
          selectTab('craft', ui);
        },
      },
      t('jobs.sites.craftHere'),
    );
  }
  if (button && why) attachTooltip(button, () => why);
  const walk = h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => ui.net.send({ t: 'move', x: s.x, y: s.y }) }, t('jobs.sites.walk'));
  return h(
    'div',
    { class: ['card', 'jobs-site', m.inRange && 'in-reach'] },
    h('span', { class: 'seal jobs-seal', 'aria-hidden': 'true' }, icon(siteIcon)),
    h(
      'div',
      { class: 'jobs-site-body' },
      h('strong', {}, siteLabel(s), s.trainBonus && s.trainBonus > 1 ? h('span', { class: 'chip chip-gold jobs-bonus' }, t('jobs.sites.dojoBonus', { n: s.trainBonus })) : null),
      h('div', { class: 'jobs-fine' }, Number.isFinite(m.distance) ? t('jobs.sites.dist', { n: Math.round(m.distance) }) : '', ' · ', m.inRange ? h('span', { class: 'tone-good' }, t('jobs.sites.close')) : h('span', {}, t('jobs.sites.far', { n: Math.max(0, Math.ceil(m.distance - m.range)) })), why && act?.kind !== 'craft' && blocked?.key !== 'jobs.why.far' ? h('span', { class: 'tone-warn' }, ` · ${why}`) : null),
    ),
    h('div', { class: 'jobs-site-actions' }, button, m.inRange ? null : walk),
  );
}

// ---- Craft tab ------------------------------------------------------------------------------------------------------------

function craftTab(ui: UiContext): HTMLElement[] {
  const me = ui.state.get('me')!;
  const { pos, near } = currentSettlement(ui);
  const sitesAll: SiteView[] = near && near.d <= near.s.radius + 6 ? (sitesCache.data ?? near.s.sites.map((w) => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, settlementId: w.settlementId, job: Object.values(JOB_DEFS).find((j) => j.site === w.kind)?.id }))) : [];
  const workshops = sitesAll.filter((s) => s.job && JOB_DEFS[s.job].mode === 'craft').sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y));
  if (near && !sitesCache.data) load(sitesCache, String(near.s.id), () => ui.net.query('sites', { settlement: near.s.id }), ui);
  if (!workshops.length) return [h('p', { class: 'empty-note' }, t('jobs.craft.none'))];
  if (!craftSiteId || !workshops.some((w) => w.id === craftSiteId)) craftSiteId = workshops[0].id;
  const site = workshops.find((w) => w.id === craftSiteId)!;
  const sig = `${site.id}|${me.c.inventory.map((s) => `${s.id}:${s.qty}`).join(',')}|${me.c.activity ? 1 : 0}|${Math.round(pos.x / 3)}${Math.round(pos.y / 3)}|${JSON.stringify(me.c.jobs)}`;
  load(recipesCache, sig, () => ui.net.query('recipes', { site: site.id }), ui);

  const picker =
    workshops.length > 1
      ? h(
          'label',
          { class: 'field jobs-picker' },
          h('span', { class: 'field-label' }, t('jobs.craft.pick')),
          h(
            'select',
            {
              class: 'select',
              onchange: (ev: Event) => {
                craftSiteId = (ev.target as HTMLSelectElement).value;
                craftRecipeId = null;
                recipesCache.key = '';
                ui.panels.refresh('jobs');
              },
            },
            ...workshops.map((w) => h('option', { value: w.id, selected: w.id === craftSiteId }, `${siteLabel(w)} (${Math.round(Math.hypot(w.x - pos.x, w.y - pos.y))})`)),
          ),
        )
      : h('div', { class: 'jobs-fine' }, `${t('jobs.craft.pick')}: ${siteLabel(site)}`);

  const out: HTMLElement[] = [picker];
  const dist = Math.hypot(site.x - pos.x, site.y - pos.y);
  if (dist > CRAFT_RANGE) out.push(h('p', { class: 'tone-warn jobs-fine' }, t('jobs.craft.walkFirst', { n: CRAFT_RANGE }), ' ', h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => ui.net.send({ t: 'move', x: site.x, y: site.y }) }, t('jobs.sites.walk'))));
  const list = recipesCache.data;
  if (!list) {
    out.push(recipesCache.error ? h('p', { class: 'tone-bad' }, recipesCache.error) : h('p', { class: 'empty-note' }, t('jobs.craft.loading')));
    return out;
  }
  if (!list.length) {
    out.push(h('p', { class: 'empty-note' }, t('jobs.craft.empty')));
    return out;
  }
  const sorted = [...list].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!craftRecipeId || !sorted.some((r) => r.id === craftRecipeId)) craftRecipeId = (sorted.find((r) => r.canCraft) ?? sorted[0]).id;

  const rows = sorted.map((r) => {
    const aff = recipeAffordability(r, me.c.inventory, 1);
    const lvOk = (me.c.jobs[r.job]?.lv ?? 1) >= r.level;
    const ok = r.canCraft;
    return h(
      'button',
      {
        class: ['jobs-recipe', r.id === craftRecipeId && 'selected', ok && 'can', !lvOk && 'locked'],
        type: 'button',
        role: 'option',
        'aria-selected': String(r.id === craftRecipeId),
        onclick: () => {
          craftRecipeId = r.id;
          craftQty = 1;
          ui.panels.refresh('jobs');
        },
      },
      h('span', { class: 'jobs-recipe-name' }, r.name),
      h('span', { class: 'jobs-recipe-meta' }, lvOk ? (aff.missing.length ? t('jobs.craft.missing') : ok ? '' : t('jobs.craft.canNot')) : t('jobs.craft.needLv', { job: jobName(r.job), n: r.level })),
    );
  });
  out.push(h('div', { class: 'jobs-recipes', role: 'listbox', 'aria-label': t('jobs.tab.craft'), 'data-scroll-key': 'recipes' }, rows));

  const r = sorted.find((x) => x.id === craftRecipeId)!;
  out.push(recipeDetail(ui, r));
  return out;
}

function recipeDetail(ui: UiContext, r: RecipeView): HTMLElement {
  const me = ui.state.get('me')!;
  const maxTime = maxCraftQty(r.seconds);
  const aff0 = recipeAffordability(r, me.c.inventory, 1);
  const cap = Math.max(1, Math.min(maxTime, Math.max(1, aff0.maxByItems)));
  craftQty = Math.max(1, Math.min(cap, craftQty));
  const detail = h('div', { class: 'card jobs-recipe-detail' });
  const total = h('span', { class: 'jobs-fine' });
  const goBtn = h('button', { class: 'btn btn-primary', type: 'button' });
  const matList = h('ul', { class: 'jobs-inputs', 'aria-label': t('jobs.craft.inputs') });
  const upd = () => {
    const aff = recipeAffordability(r, me.c.inventory, craftQty);
    mount(
      matList,
      ...r.inputs.map(([id, n]) => {
        const have = bagCount(me.c.inventory, id);
        const need = n * craftQty;
        return h('li', { class: have >= need ? 'ok' : 'short' }, h('span', {}, `${itemName(id)}`), h('span', { class: have >= need ? 'tone-good' : 'tone-bad' }, t('jobs.craft.have', { have: fmtInt(have), need: fmtInt(need) })));
      }),
    );
    total.textContent = t('jobs.craft.total', { time: fmtDuration(r.seconds * 1000 * craftQty) });
    const busy = !!me.c.activity;
    // Server `canCraft` covers level, distance, bag room and "busy"; the local check adds quantity-based materials.
    const blockedByServer = !r.canCraft && aff0.missing.length === 0;
    goBtn.disabled = aff.missing.length > 0 || busy || craftQty > maxTime || blockedByServer || !!me.combatId;
    goBtn.textContent = craftQty > 1 ? t('jobs.craft.goN', { n: craftQty }) : t('jobs.craft.go');
  };
  const qty = stepper({
    value: craftQty,
    min: 1,
    max: cap,
    label: t('jobs.craft.qty'),
    onChange: (v) => {
      craftQty = v;
      upd();
    },
  });
  goBtn.addEventListener('click', () => {
    if (craftSiteId) ui.net.send({ t: 'astart', kind: 'craft', site: craftSiteId, recipe: r.id, qty: craftQty });
  });
  const [outId, outN] = r.output;
  mount(
    detail,
    h('div', { class: 'jobs-recipe-title' }, h('strong', {}, r.name), h('span', { class: 'chip' }, t('jobs.craft.makes', { item: `${outN > 1 ? `${outN} × ` : ''}${itemName(outId)}` }))),
    h('div', { class: 'jobs-fine' }, t('jobs.craft.time', { time: fmtDuration(r.seconds * 1000) }), ' · ', t('jobs.craft.needLv', { job: jobName(r.job), n: r.level })),
    h('div', { class: 'sect-title' }, t('jobs.craft.inputs')),
    matList,
    r.canCraft ? null : h('p', { class: 'tone-warn jobs-fine' }, r.reason ?? t('jobs.craft.canNot')),
    maxTime < 20 ? h('p', { class: 'jobs-fine' }, t('jobs.craft.maxTime', { n: maxTime })) : null,
    RECIPES[r.id]?.gear ? h('p', { class: 'jobs-fine' }, t('jobs.craft.rarity')) : null,
    h('div', { class: 'jobs-craft-row' }, h('label', { class: 'jobs-qty' }, h('span', { class: 'field-label' }, t('jobs.craft.qty')), qty.el), goBtn),
    total,
  );
  upd();
  return detail;
}

// ---- panel ------------------------------------------------------------------------------------------------------------------

registerPanel({
  id: 'jobs',
  title: 'jobs.title',
  glyph: 'jobs',
  hotkey: 'j',
  order: 50,
  width: 440,
  watch: ['me', 'notes', 'time'],
  onOpen(ui) {
    sitesCache.key = '';
    recipesCache.key = '';
    slowCount = 0;
    if (timer !== null) window.clearInterval(timer);
    timer = window.setInterval(() => {
      tick?.();
      slowCount++;
      if (slowCount % 4 === 0 && ui.panels.isOpen('jobs') && (tab === 'sites' || tab === 'craft')) ui.panels.refresh('jobs');
    }, 1000);
  },
  onClose() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    tick = null;
  },
  render(root, ui) {
    tick = null;
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('common.loading')));
      return;
    }
    const tb = tabs(
      [
        { id: 'work', label: t('jobs.tab.work'), glyph: 'jobs' },
        { id: 'sites', label: t('jobs.tab.sites'), glyph: 'sites' },
        { id: 'craft', label: t('jobs.tab.craft'), glyph: 'craft' },
      ],
      (id) => selectTab(id as TabId, ui),
      { initial: tab, label: t('jobs.tabs') },
    );
    const body = h('div', { class: 'jobs-body', role: 'tabpanel' });
    if (tab === 'work') body.append(activityCard(ui, me.c.activity), jobCards(ui), recentReports(ui));
    else if (tab === 'sites') body.append(...sitesTab(ui));
    else body.append(...craftTab(ui));
    mount(root, tb.el, body);
  },
});
