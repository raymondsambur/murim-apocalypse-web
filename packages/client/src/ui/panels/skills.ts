/**
 * Skills & Build panel (K): the arts you know, the loadout (active slots by rank, one internal art, one movement art),
 * the stance and the tactic rules. Edits are kept in a draft and saved with `{t:'build'}` (Apply / Revert).
 */
import { SKILLS, SKILL_MAX_LEVEL, STANCE_INFO, skillXpToNext, type CharacterSave, type Cond, type MeView, type SkillDef, type Stance, type TacticRule } from '@murim/shared';
import { addStrings, t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { fmtNum, fmtPct } from '../format';
import {
  ACT_KINDS,
  COND_KINDS,
  DEFAULT_TACTICS_DRAFT,
  MAX_TACTICS,
  STANCES,
  addRule,
  brokenRules,
  clampCondValue,
  condHasValue,
  condRange,
  defaultAct,
  defaultCond,
  draftEquals,
  draftFromSave,
  emptyItemRules,
  equippedIds,
  firstEmptyActive,
  groupBySchool,
  itemChoices,
  learnedOfKind,
  moveRule,
  placeSkill,
  previewStats,
  reconcileDraft,
  removeRule,
  replaceRule,
  skillChoices,
  skillProgress,
  slotCount,
  slotValue,
  validateDraft,
  withCondKind,
  withCondValue,
  type ActKind,
  type BuildDraft,
  type CondKind,
  type SlotRef,
} from '../logic/build';
import { describeTactic, itemNameOf, skillName } from '../text/combat';
import { passiveLines } from '../text/tips';
import { bar } from '../widgets/bar';
import { tabs } from '../widgets/tabs';
import { attachTooltip, skillTooltip } from '../widgets/tooltip';
import { registerPanel } from './registry';
import '../../styles/panels/skills.css';

addStrings({
  'sk.tab.arts': 'Arts',
  'sk.tab.loadout': 'Loadout',
  'sk.tab.stance': 'Stance',
  'sk.tab.tactics': 'Tactics',
  'sk.tabs': 'Skills and build sections',
  'sk.loading': 'Loading your arts...',
  'sk.arts.empty': 'You have not learned any arts yet. Masters in towns teach skills, and manuals found in the world can be studied from your bag.',
  'sk.arts.known': 'You know {n} arts.',
  'sk.arts.equip': 'Equip',
  'sk.arts.equipped': 'Equipped',
  'sk.arts.equipTip': 'Put {skill} in your loadout',
  'sk.arts.noRoom': 'All {n} active slots are full. Open the Loadout tab and pick a slot to replace.',
  'sk.arts.lv': 'Lv {lv}/{max}',
  'sk.arts.lvMax': 'Lv {lv} (max)',
  'sk.arts.xp': '{a} / {b} proficiency',
  'sk.arts.passive': 'Passive: always on while equipped',
  'sk.tier': 'Tier {n}',
  'sk.loadout.active': 'Active arts ({used}/{n} slots)',
  'sk.loadout.activeHint': 'Used in combat in the order your tactics pick them. Slots grow with your rank (4, 5, then 6).',
  'sk.loadout.internal': 'Internal art',
  'sk.loadout.movement': 'Movement art',
  'sk.loadout.slot': 'Slot {n}',
  'sk.loadout.empty': 'Empty',
  'sk.loadout.clear': 'Empty this slot',
  'sk.loadout.pick': 'Choose for: {slot}',
  'sk.loadout.pickNone': 'Tap a slot above, then tap an art to put in it. On desktop you can also drag an art onto a slot.',
  'sk.loadout.none': 'You know no {kind} arts yet.',
  'sk.loadout.remove': 'Leave empty',
  'sk.loadout.inUse': 'in a slot',
  'sk.loadout.dragTip': 'Drag onto a slot, or tap to place',
  'sk.preview': 'Passive effects',
  'sk.preview.none': 'Your equipped arts change nothing yet.',
  'sk.preview.note': 'Shows your derived stats with this loadout compared with your saved one.',
  'sk.stance.hint': 'Your stance modifies every fight. It can be changed whenever you are not fighting.',
  'sk.stance.current': 'Current',
  'sk.tactics.hint': 'Rules are checked from top to bottom each beat; the first one whose condition holds is used. If none holds, your active arts are used in slot order.',
  'sk.tactics.count': '{n} / {max} rules',
  'sk.tactics.empty': 'No rules. Your fighter will simply use active arts in slot order.',
  'sk.tactics.add': 'Add rule',
  'sk.tactics.full': 'You can have at most {max} rules.',
  'sk.tactics.reset': 'Reset to default',
  'sk.tactics.up': 'Move rule {n} up',
  'sk.tactics.down': 'Move rule {n} down',
  'sk.tactics.del': 'Delete rule {n}',
  'sk.tactics.rule': 'Rule {n}',
  'sk.tactics.if': 'IF',
  'sk.tactics.then': 'THEN',
  'sk.tactics.value': 'Value for rule {n}',
  'sk.tactics.condLabel': 'Condition of rule {n}',
  'sk.tactics.actLabel': 'Action of rule {n}',
  'sk.tactics.argLabel': 'Skill or item of rule {n}',
  'sk.tactics.noSkill': '(no active art)',
  'sk.tactics.noItem': '(no consumable)',
  'sk.tactics.broken': 'This rule would be refused: pick an art from your loadout or a usable consumable.',
  'sk.tactics.noBag': 'None in your bag right now, so this rule will do nothing.',
  'sk.tactics.defaultAsk': 'Replace all rules with the default (drink a Minor Healing Pill below 35% health)?',
  'sk.tactics.defaultTitle': 'Reset tactics?',
  'sk.cond.always': 'Always',
  'sk.cond.hpBelow': 'My health is below',
  'sk.cond.qiBelow': 'My Qi is below',
  'sk.cond.qiAbove': 'My Qi is above',
  'sk.cond.enemyHpBelow': 'Enemy health is below',
  'sk.cond.enemiesAtLeast': 'Enemies at least',
  'sk.cond.targetBlighted': 'Target is Blighted',
  'sk.act.skill': 'Use an art',
  'sk.act.item': 'Use an item',
  'sk.act.guard': 'Guard',
  'sk.act.flee': 'Flee',
  'sk.act.basic': 'Basic strike',
  'sk.bar.dirty': 'Unsaved changes',
  'sk.bar.clean': 'Build saved',
  'sk.bar.saving': 'Saving...',
  'sk.bar.apply': 'Apply',
  'sk.bar.revert': 'Revert',
  'sk.bar.inCombat': 'You cannot change your build while fighting.',
  'sk.bar.dead': 'You cannot change your build while dead.',
  'build.err.slots': 'Too many active arts for your rank.',
  'build.err.dupe': 'An art can only be equipped once.',
  'build.err.skill': 'A slot holds an art you have not learned or one of the wrong kind.',
  'build.err.stance': 'Unknown stance.',
  'build.err.tooMany': 'At most 6 tactic rules are allowed.',
  'build.err.cond': 'A tactic has an invalid condition.',
  'build.err.tacticSkill': 'A tactic uses an art that is not in your loadout.',
  'build.err.tacticItem': 'A tactic uses an item that cannot be used in combat.',
});

type Tab = 'arts' | 'loadout' | 'stance' | 'tactics';
const TAB_GLYPH: Record<Tab, string> = { arts: '藝', loadout: '裝', stance: '勢', tactics: '策' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const STANCE_GLYPH: Record<Stance, string> = { aggressive: '攻', balanced: '衡', defensive: '守', evasive: '閃' };

let tab: Tab = 'arts';
let draft: BuildDraft | null = null;
let draftChar = -1;
let lastSavedSig = '';
let picking: SlotRef | null = null;
let applying = false;
let applyTimer: ReturnType<typeof setTimeout> | null = null;
let dragging: { id: string; from?: SlotRef } | null = null;
/** Re-evaluates the Apply / status bar after an edit that does not rebuild the panel (typing a number). */
let barSync: (() => void) | null = null;

const refEq = (a: SlotRef | null, b: SlotRef): boolean => !!a && a.kind === b.kind && (a.kind !== 'active' || (b.kind === 'active' && a.slot === b.slot));

function sync(c: CharacterSave): { saved: BuildDraft; dirty: boolean } {
  const saved = draftFromSave(c);
  const sig = JSON.stringify(saved);
  if (!draft || draftChar !== c.id) {
    draft = saved;
    draftChar = c.id;
    lastSavedSig = sig;
  } else if (sig !== lastSavedSig) {
    const wasClean = JSON.stringify(draft) === lastSavedSig;
    draft = wasClean ? saved : draft;
    lastSavedSig = sig;
    applying = false;
  }
  draft = reconcileDraft(draft, c);
  return { saved, dirty: !draftEquals(draft, saved) };
}

function tierChip(def: SkillDef): HTMLElement {
  return h('span', { class: 'chip bld-tier', title: t('sk.tier', { n: def.tier }) }, ROMAN[def.tier] ?? String(def.tier));
}

function glyphBox(def: SkillDef, cls = ''): HTMLElement {
  return h('span', { class: ['bld-glyph', cls, `tier-${def.tier}`], 'aria-hidden': 'true' }, def.glyph);
}

function slotName(ref: SlotRef): string {
  return ref.kind === 'active' ? t('sk.loadout.slot', { n: ref.slot + 1 }) : t(ref.kind === 'internal' ? 'sk.loadout.internal' : 'sk.loadout.movement');
}

// ---- Arts tab -------------------------------------------------------------------------------------------------------------

function artsTab(c: CharacterSave, ui: UiContext, edit: (d: BuildDraft) => void): HTMLElement {
  const groups = groupBySchool(c.skills);
  const root = h('div', { class: 'bld-tabbody' });
  if (!groups.length) {
    root.append(h('p', { class: 'empty-note' }, t('sk.arts.empty')));
    return root;
  }
  const d = draft!;
  const eq = new Set(equippedIds(d.loadout));
  root.append(h('p', { class: 'bld-hint' }, t('sk.arts.known', { n: Object.keys(c.skills).length })));
  for (const g of groups) {
    const list = h('div', { class: 'bld-list' });
    for (const s of g.skills) {
      const def = s.def;
      const xpBar = bar('xp', { label: t('sk.arts.xp', { a: s.xp, b: skillXpToNext(s.lv) }), size: 'sm', text: false });
      xpBar.set(skillProgress(s.lv, s.xp, skillXpToNext, SKILL_MAX_LEVEL) * 100, 100);
      const isEq = eq.has(def.id);
      const equipBtn = h(
        'button',
        {
          class: ['btn', 'btn-xs', isEq ? 'btn-ghost' : 'btn-primary'],
          type: 'button',
          disabled: isEq,
          title: t('sk.arts.equipTip', { skill: def.name }),
          onclick: () => {
            const ref: SlotRef | null = def.kind === 'active' ? (firstEmptyActive(d.loadout) >= 0 ? { kind: 'active', slot: firstEmptyActive(d.loadout) } : null) : { kind: def.kind };
            if (!ref) {
              ui.toast(t('sk.arts.noRoom', { n: slotCount(c.level) }), 'warn');
              tab = 'loadout';
              picking = null;
              ui.panels.refresh('skills');
              return;
            }
            edit(placeSkill(d, ref, def.id));
          },
        },
        isEq ? t('sk.arts.equipped') : t('sk.arts.equip'),
      );
      const row = h(
        'div',
        { class: ['bld-art', isEq && 'is-equipped'] },
        h('button', { class: 'bld-art-icon', type: 'button', 'aria-label': def.name }, glyphBox(def)),
        h(
          'div',
          { class: 'bld-art-main' },
          h('div', { class: 'bld-art-name' }, def.name, tierChip(def), h('span', { class: 'bld-art-lv' }, s.lv >= SKILL_MAX_LEVEL ? t('sk.arts.lvMax', { lv: s.lv }) : t('sk.arts.lv', { lv: s.lv, max: SKILL_MAX_LEVEL }))),
          xpBar.el,
          def.kind !== 'active' && def.passive ? h('div', { class: 'bld-art-sub tone-good' }, passiveLines(def.passive).map((l) => l.text).join(' · ')) : h('div', { class: 'bld-art-sub' }, def.desc),
        ),
        equipBtn,
      );
      attachTooltip(row.querySelector('.bld-art-icon') as HTMLElement, () => skillTooltip(def.id, s.lv, { showReq: false }));
      list.append(row);
    }
    root.append(h('section', { class: 'bld-sec' }, h('div', { class: 'sect-title' }, t(`school.${g.school}`)), list));
  }
  return root;
}

// ---- Loadout tab ----------------------------------------------------------------------------------------------------------

function slotButton(ref: SlotRef, d: BuildDraft, ui: UiContext, edit: (d: BuildDraft) => void, level: number): HTMLElement {
  const id = slotValue(d.loadout, ref);
  const def = id ? SKILLS[id] : undefined;
  const sel = refEq(picking, ref);
  const btn = h(
    'button',
    {
      class: ['bld-slot', def && 'is-filled', sel && 'is-picked'],
      type: 'button',
      'aria-pressed': String(sel),
      'aria-label': `${slotName(ref)}: ${def ? def.name : t('sk.loadout.empty')}`,
      draggable: def ? 'true' : undefined,
      onclick: () => {
        picking = sel ? null : ref;
        ui.panels.refresh('skills');
      },
    },
    def ? glyphBox(def, 'bld-glyph-lg') : h('span', { class: 'bld-slot-plus', 'aria-hidden': 'true' }, '+'),
    h('span', { class: 'bld-slot-name' }, def ? def.name : slotName(ref)),
  );
  if (def) attachTooltip(btn, () => skillTooltip(def.id, undefined, { showReq: false }));
  btn.addEventListener('dragstart', (ev) => {
    if (!id) return;
    dragging = { id, from: ref };
    ev.dataTransfer?.setData('text/plain', id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  });
  btn.addEventListener('dragend', () => (dragging = null));
  btn.addEventListener('dragover', (ev) => {
    if (dragging && SKILLS[dragging.id]?.kind === ref.kind) {
      ev.preventDefault();
      btn.classList.add('is-over');
    }
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('is-over'));
  btn.addEventListener('drop', (ev) => {
    ev.preventDefault();
    btn.classList.remove('is-over');
    if (!dragging || SKILLS[dragging.id]?.kind !== ref.kind) return;
    let next = placeSkill(d, ref, dragging.id);
    // Dragging from another slot of the same row swaps rather than duplicates.
    if (dragging.from && !refEq(dragging.from, ref) && ref.kind === 'active' && dragging.from.kind === 'active') {
      next = placeSkill(placeSkill(d, dragging.from, id), ref, dragging.id);
    }
    dragging = null;
    edit(next);
  });
  void level;
  return h('div', { class: 'bld-slot-wrap' }, btn, def ? h('button', { class: 'btn-icon btn-sm bld-slot-x', type: 'button', 'aria-label': `${t('sk.loadout.clear')} (${slotName(ref)})`, title: t('sk.loadout.clear'), onclick: () => edit(placeSkill(d, ref, null)) }, '✕') : null);
}

function loadoutTab(me: MeView, ui: UiContext, edit: (d: BuildDraft) => void): HTMLElement {
  const c = me.c;
  const d = draft!;
  const n = slotCount(c.level);
  const used = d.loadout.active.filter(Boolean).length;
  const root = h('div', { class: 'bld-tabbody' });
  const slotsRow = h('div', { class: 'bld-slots' });
  for (let i = 0; i < n; i++) slotsRow.append(slotButton({ kind: 'active', slot: i }, d, ui, edit, c.level));
  root.append(
    h('section', { class: 'bld-sec' }, h('div', { class: 'sect-title' }, t('sk.loadout.active', { used, n })), slotsRow, h('p', { class: 'bld-hint' }, t('sk.loadout.activeHint'))),
    h(
      'section',
      { class: 'bld-sec bld-two' },
      h('div', {}, h('div', { class: 'sect-title' }, t('sk.loadout.internal')), slotButton({ kind: 'internal' }, d, ui, edit, c.level)),
      h('div', {}, h('div', { class: 'sect-title' }, t('sk.loadout.movement')), slotButton({ kind: 'movement' }, d, ui, edit, c.level)),
    ),
  );

  // picker / tray: the arts that fit the chosen slot (active arts by default)
  const kind = picking?.kind ?? 'active';
  const pool = learnedOfKind(c.skills, kind);
  const inUse = new Set(equippedIds(d.loadout));
  const tray = h('div', { class: 'bld-tray' });
  tray.addEventListener('dragover', (ev) => {
    if (dragging?.from) ev.preventDefault();
  });
  tray.addEventListener('drop', (ev) => {
    if (!dragging?.from) return;
    ev.preventDefault();
    const from = dragging.from;
    dragging = null;
    edit(placeSkill(d, from, null));
  });
  if (!pool.length) tray.append(h('p', { class: 'empty-note' }, t('sk.loadout.none', { kind: t(`skillKind.${kind}`).toLowerCase() })));
  for (const def of pool) {
    const lv = c.skills[def.id]?.lv ?? 1;
    const b = h(
      'button',
      {
        class: ['bld-pick', inUse.has(def.id) && 'is-used'],
        type: 'button',
        draggable: 'true',
        title: t('sk.loadout.dragTip'),
        onclick: () => {
          const ref: SlotRef | null = picking ?? (kind === 'active' && firstEmptyActive(d.loadout) >= 0 ? { kind: 'active', slot: firstEmptyActive(d.loadout) } : null);
          if (!ref) {
            ui.toast(t('sk.loadout.pickNone'), 'info');
            return;
          }
          picking = null;
          edit(placeSkill(d, ref, def.id));
        },
      },
      glyphBox(def),
      h('span', { class: 'bld-pick-main' }, h('span', { class: 'bld-pick-name' }, def.name), h('span', { class: 'bld-pick-sub' }, t('sk.arts.lv', { lv, max: SKILL_MAX_LEVEL }), inUse.has(def.id) ? ` · ${t('sk.loadout.inUse')}` : '')),
    );
    b.addEventListener('dragstart', (ev) => {
      dragging = { id: def.id };
      ev.dataTransfer?.setData('text/plain', def.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    b.addEventListener('dragend', () => (dragging = null));
    attachTooltip(b, () => skillTooltip(def.id, lv, { showReq: false }));
    tray.append(b);
  }
  root.append(
    h(
      'section',
      { class: 'bld-sec' },
      h('div', { class: 'sect-title' }, picking ? t('sk.loadout.pick', { slot: slotName(picking) }) : t(`skillKind.${kind}`)),
      picking ? null : h('p', { class: 'bld-hint' }, t('sk.loadout.pickNone')),
      tray,
      picking && slotValue(d.loadout, picking) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => edit(placeSkill(d, picking!, null)) }, t('sk.loadout.remove')) : null,
    ),
    previewSection(me),
  );
  return root;
}

function previewSection(me: MeView): HTMLElement {
  const rows = previewStats(me.c, draft!, Date.now());
  const sec = h('section', { class: 'bld-sec' }, h('div', { class: 'sect-title' }, t('sk.preview')));
  if (!rows.length) {
    sec.append(h('p', { class: 'empty-note' }, t('sk.preview.none')));
    return sec;
  }
  const fmt = (v: number, frac?: boolean, key?: string) => (frac ? fmtPct(v, 1) : fmtNum(v, key === 'qiRegen' ? 2 : 1));
  sec.append(
    h(
      'dl',
      { class: 'kv kv-2col bld-preview' },
      ...rows.flatMap((r) => {
        const changed = Math.abs(r.after - r.before) > 1e-9;
        const tone = r.after > r.before ? 'tone-good' : 'tone-bad';
        return [h('dt', {}, t(r.label)), h('dd', {}, changed ? [fmt(r.before, r.frac, r.key), ' → ', h('strong', { class: tone }, fmt(r.after, r.frac, r.key))] : fmt(r.after, r.frac, r.key))];
      }),
    ),
    h('p', { class: 'kv-note' }, t('sk.preview.note')),
  );
  return sec;
}

// ---- Stance tab ---------------------------------------------------------------------------------------------------------------

function stanceTab(saved: BuildDraft, edit: (d: BuildDraft) => void): HTMLElement {
  const d = draft!;
  const cards = STANCES.map((s) => {
    const on = d.stance === s;
    return h(
      'button',
      { class: ['bld-stance', on && 'is-on'], type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => edit({ ...d, stance: s }) },
      h('span', { class: 'seal', 'aria-hidden': 'true' }, STANCE_GLYPH[s]),
      h('span', { class: 'bld-stance-main' }, h('span', { class: 'bld-stance-name' }, STANCE_INFO[s].name, saved.stance === s ? h('span', { class: 'chip chip-gold' }, t('sk.stance.current')) : null), h('span', { class: 'bld-stance-desc' }, STANCE_INFO[s].desc)),
    );
  });
  return h('div', { class: 'bld-tabbody' }, h('p', { class: 'bld-hint' }, t('sk.stance.hint')), h('div', { class: 'bld-stances', role: 'radiogroup', 'aria-label': t('sk.tab.stance') }, cards));
}

// ---- Tactics tab -------------------------------------------------------------------------------------------------------------------

function select(options: { value: string; label: string; disabled?: boolean }[], value: string, label: string, onChange: (v: string) => void): HTMLSelectElement {
  const el = h(
    'select',
    { class: 'select bld-select', 'aria-label': label },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.label)),
  );
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function tacticsTab(c: CharacterSave, ui: UiContext, edit: (d: BuildDraft) => void): HTMLElement {
  const d = draft!;
  const broken = new Set(brokenRules(d));
  const noBag = new Set(emptyItemRules(d, c.inventory));
  const setRules = (rules: TacticRule[]) => edit({ ...d, tactics: rules });
  const root = h('div', { class: 'bld-tabbody' }, h('p', { class: 'bld-hint' }, t('sk.tactics.hint')));
  const list = h('ol', { class: 'bld-rules' });
  if (!d.tactics.length) root.append(h('p', { class: 'empty-note' }, t('sk.tactics.empty')));
  d.tactics.forEach((rule, i) => {
    const n = i + 1;
    const summary = h('div', { class: 'bld-rule-sum' }, describeTactic(rule));
    const condSel = select(
      COND_KINDS.map((k) => ({ value: k, label: t(`sk.cond.${k}`) })),
      rule.cond.k,
      t('sk.tactics.condLabel', { n }),
      (v) => setRules(replaceRule(d.tactics, i, withCondKind(rule, v as CondKind))),
    );
    let valueEl: HTMLElement | null = null;
    if (condHasValue(rule.cond.k)) {
      const range = condRange(rule.cond.k);
      const input = h('input', { class: 'input bld-num', type: 'number', inputmode: 'numeric', min: String(range.min), max: String(range.max), value: String((rule.cond as Extract<Cond, { v: number }>).v), 'aria-label': t('sk.tactics.value', { n }) });
      input.addEventListener('input', () => {
        const v = clampCondValue(rule.cond.k, Number(input.value));
        const next = withCondValue(rule, v);
        // Keep the typed text; update the draft and the summary without rebuilding the panel (it would steal focus).
        d.tactics[i] = next;
        summary.textContent = describeTactic(next);
        barSync?.();
      });
      input.addEventListener('change', () => {
        input.value = String(clampCondValue(rule.cond.k, Number(input.value)));
      });
      valueEl = h('span', { class: 'bld-val' }, input, range.unit);
    }
    const actSel = select(
      ACT_KINDS.map((k) => ({ value: k, label: t(`sk.act.${k}`) })),
      rule.act.k,
      t('sk.tactics.actLabel', { n }),
      (v) => setRules(replaceRule(d.tactics, i, { ...rule, act: defaultAct(v as ActKind, d.loadout, c.inventory, d.tactics) })),
    );
    let argSel: HTMLElement | null = null;
    if (rule.act.k === 'skill') {
      const ids = skillChoices(d.loadout);
      const opts = ids.length ? ids.map((id) => ({ value: id, label: skillName(id) })) : [{ value: '', label: t('sk.tactics.noSkill'), disabled: true }];
      const cur = (rule.act as { id: string }).id;
      if (cur && !ids.includes(cur)) opts.unshift({ value: cur, label: `${skillName(cur)} ⚠`, disabled: false } as never);
      argSel = select(opts, cur, t('sk.tactics.argLabel', { n }), (v) => setRules(replaceRule(d.tactics, i, { ...rule, act: { k: 'skill', id: v } })));
    } else if (rule.act.k === 'item') {
      const ids = itemChoices(c.inventory, d.tactics);
      const opts = ids.length ? ids.map((id) => ({ value: id, label: itemNameOf(id) })) : [{ value: '', label: t('sk.tactics.noItem'), disabled: true }];
      argSel = select(opts, (rule.act as { id: string }).id, t('sk.tactics.argLabel', { n }), (v) => setRules(replaceRule(d.tactics, i, { ...rule, act: { k: 'item', id: v } })));
    }
    const li = h(
      'li',
      { class: ['bld-rule', broken.has(i) && 'is-broken'] },
      h('span', { class: 'bld-rule-n', 'aria-hidden': 'true' }, String(n)),
      h(
        'div',
        { class: 'bld-rule-main' },
        summary,
        h('div', { class: 'bld-rule-edit' }, h('span', { class: 'bld-kw' }, t('sk.tactics.if')), condSel, valueEl, h('span', { class: 'bld-kw' }, t('sk.tactics.then')), actSel, argSel),
        broken.has(i) ? h('div', { class: 'bld-rule-warn tone-bad' }, t('sk.tactics.broken')) : noBag.has(i) ? h('div', { class: 'bld-rule-warn tone-warn' }, t('sk.tactics.noBag')) : null,
      ),
      h(
        'div',
        { class: 'bld-rule-btns' },
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: i === 0, 'aria-label': t('sk.tactics.up', { n }), onclick: () => setRules(moveRule(d.tactics, i, -1)) }, '↑'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: i === d.tactics.length - 1, 'aria-label': t('sk.tactics.down', { n }), onclick: () => setRules(moveRule(d.tactics, i, 1)) }, '↓'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('sk.tactics.del', { n }), onclick: () => setRules(removeRule(d.tactics, i)) }, '✕'),
      ),
    );
    list.append(li);
  });
  if (d.tactics.length) root.append(list);
  const full = d.tactics.length >= MAX_TACTICS;
  root.append(
    h(
      'div',
      { class: 'bld-rule-foot' },
      h('span', { class: ['chip', full && 'chip-warn'] }, t('sk.tactics.count', { n: d.tactics.length, max: MAX_TACTICS })),
      h(
        'button',
        { class: 'btn btn-sm btn-primary', type: 'button', disabled: full, title: full ? t('sk.tactics.full', { max: MAX_TACTICS }) : undefined, onclick: () => setRules(addRule(d.tactics, { cond: defaultCond('hpBelow'), act: { k: 'basic' } })) },
        '+ ',
        t('sk.tactics.add'),
      ),
      h(
        'button',
        {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: async () => {
            if (d.tactics.length && !(await ui.confirm({ title: t('sk.tactics.defaultTitle'), text: t('sk.tactics.defaultAsk'), ok: t('sk.tactics.reset') }))) return;
            setRules(DEFAULT_TACTICS_DRAFT.map((r) => ({ cond: { ...r.cond }, act: { ...r.act } })));
          },
        },
        t('sk.tactics.reset'),
      ),
    ),
  );
  return root;
}

// ---- panel ----------------------------------------------------------------------------------------------------------------------------

registerPanel({
  id: 'skills',
  title: 'panel.skills',
  glyph: '武',
  hotkey: 'k',
  order: 30,
  width: 480,
  watch: ['me'],
  onClose: () => {
    picking = null;
  },
  render(root, ui) {
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('sk.loading')));
      return;
    }
    const c = me.c;
    const { saved, dirty } = sync(c);
    const refreshAll = () => ui.panels.refresh('skills');
    const edit = (next: BuildDraft) => {
      draft = next;
      refreshAll();
    };

    // ---- bottom bar: dirty state, Apply / Revert -----------------------------------------------------------
    const status = h('span', { class: 'bld-status', role: 'status' });
    const why = h('span', { class: 'bld-bar-why tone-warn' });
    const applyBtn = h('button', { class: 'btn btn-sm btn-gold', type: 'button' }, t('sk.bar.apply'));
    const revertBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, t('sk.bar.revert'));
    const blockedNow = (): string => {
      const errors = validateDraft(c, draft!);
      return me.combatId !== null ? t('sk.bar.inCombat') : c.hp <= 0 ? t('sk.bar.dead') : errors.length ? t(errors[0]) : '';
    };
    const paintBar = () => {
      const isDirty = !draftEquals(draft!, saved);
      const blocked = blockedNow();
      status.textContent = applying ? t('sk.bar.saving') : isDirty ? t('sk.bar.dirty') : t('sk.bar.clean');
      status.className = `bld-status ${isDirty ? 'is-dirty' : 'is-clean'}`;
      why.textContent = isDirty ? blocked : '';
      applyBtn.disabled = !isDirty || !!blocked || applying;
      applyBtn.title = blocked;
      revertBtn.disabled = !isDirty;
    };
    paintBar();
    barSync = paintBar;
    void dirty;
    applyBtn.addEventListener('click', () => {
      const cur = draft!;
      if (blockedNow() || draftEquals(cur, saved)) return;
      const sent = ui.net.send({ t: 'build', loadout: cur.loadout, stance: cur.stance, tactics: cur.tactics });
      if (!sent) return;
      applying = true;
      if (applyTimer) clearTimeout(applyTimer);
      // A refusal arrives as an error toast and no `me`; stop showing "Saving" so the player can fix and retry.
      applyTimer = setTimeout(() => {
        applying = false;
        refreshAll();
      }, 3500);
      refreshAll();
    });
    revertBtn.addEventListener('click', () => {
      draft = saved;
      picking = null;
      refreshAll();
    });
    const bottom = h('div', { class: 'bld-bar' }, status, why, h('span', { class: 'bld-bar-btns' }, revertBtn, applyBtn));

    const tb = tabs(
      (Object.keys(TAB_GLYPH) as Tab[]).map((id) => ({ id, label: t(`sk.tab.${id}`), glyph: TAB_GLYPH[id] })),
      (id) => {
        tab = id as Tab;
        picking = null;
        refreshAll();
      },
      { initial: tab, label: t('sk.tabs') },
    );
    const body =
      tab === 'arts' ? artsTab(c, ui, edit) : tab === 'loadout' ? loadoutTab(me, ui, edit) : tab === 'stance' ? stanceTab(saved, edit) : tacticsTab(c, ui, edit);
    root.append(h('div', { class: 'bld' }, tb.el, h('div', { class: 'bld-body', 'data-scroll-key': `bld-${tab}` }, body), bottom));
  },
});
