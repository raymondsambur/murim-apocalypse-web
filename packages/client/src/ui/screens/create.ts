/**
 * Character creation: the first roll is free, further rerolls are limited. Stats, talents and origin are rolled by the
 * server; the player only picks a name and an appearance (live preview via RenderModule.drawLookPreview).
 */
import { ITEMS, LOOK_RANGES, SKILLS, STAT_INFO, STAT_KEYS, TALENTS, getItem, getSkill, type Look, type MeResponse, type RollPreview, type StatKey, type Stats } from '@murim/shared';
import { ApiFailure, api } from '../../net/api';
import { t } from '../../i18n';
import type { LookPreviewOptions, RenderModule } from '../../render/api';
import { glyph, h, mount, prefersReducedMotion } from '../dom';
import { textField } from '../forms';
import { drawLook, swatchesFor } from '../portrait';
import { normalizeCharName, validateCharName } from '../validation';
import { itemSlot } from '../widgets/itemSlot';
import { attachTooltip, skillTooltip, talentTooltip } from '../widgets/tooltip';
import { mountInkBackdrop } from './inkBackdrop';
import { brandBlock } from './auth';
import type { Screen } from './screen';
import { icon } from '../icons';
import { skillIconName } from '../glyphMap';

/** Bar scale for rolled stats (a typical roll lands between 5 and 25). */
export const STAT_BAR_MAX = 24;

export interface CreateScreenOptions {
  me: MeResponse;
  render: RenderModule;
  onCreated(): void;
  onLogout(): void;
}

/** Cosmetic randomness only (never used for game rules). */
export function randomLookUi(rand: () => number = Math.random): Look {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rand() * n));
  return {
    gender: rand() < 0.5 ? 0 : 1,
    skin: pick(LOOK_RANGES.skin),
    hairStyle: pick(LOOK_RANGES.hairStyle),
    hairColor: pick(LOOK_RANGES.hairColor),
    outfit: pick(LOOK_RANGES.outfit),
    outfitColor: pick(LOOK_RANGES.outfitColor),
    sashColor: pick(LOOK_RANGES.sashColor),
    accessory: pick(LOOK_RANGES.accessory),
  };
}

type RangeKey = Exclude<keyof Look, 'gender'>;

/**
 * `RollPreview.origin.items / skills` are display strings from the server ("Raw Meat x3", "Piercing Spear");
 * the mock sends ids. Resolve either form to shared data so we can show glyphs and tooltips.
 */
export function resolveOriginItem(label: string): { id: string; qty: number } | null {
  const m = /^(.*?)(?:\s*[x×]\s*(\d+))?$/.exec(label.trim());
  const base = (m?.[1] ?? label).trim();
  const qty = m?.[2] ? Number(m[2]) : 1;
  if (getItem(base)) return { id: base, qty };
  const found = Object.values(ITEMS).find((d) => d.name.toLowerCase() === base.toLowerCase());
  return found ? { id: found.id, qty } : null;
}

export function resolveSkillId(label: string): string | null {
  if (getSkill(label)) return label;
  const found = Object.values(SKILLS).find((s) => s.name.toLowerCase() === label.trim().toLowerCase());
  return found ? found.id : null;
}

export function createCreateScreen(o: CreateScreenOptions): Screen {
  const { render } = o;
  const root = h('main', { class: 'screen screen-create' });
  const backdrop = mountInkBackdrop(root);

  let preview: RollPreview | null = null;
  let look: Look = randomLookUi();
  let lookTouched = false;
  let rerollsLeft = o.me.rerollsLeft;
  let busy = false;
  let dir: 0 | 1 | 2 | 3 = 0;
  let prevStats: Stats | null = null;
  let destroyed = false;

  // ---- preview canvas -------------------------------------------------------------
  const canvas = h('canvas', { class: 'create-preview', width: 240, height: 300, role: 'img', 'aria-label': t('create.previewLabel') });
  const drawOpts = (time?: number): LookPreviewOptions => ({ dir, state: 'idle', time, backdrop: true });
  const redraw = (time?: number) => drawLook(render, canvas, look, 240, 300, 6, drawOpts(time));
  let raf = 0;
  const still = prefersReducedMotion();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    redraw(now);
  };

  // ---- appearance pickers ------------------------------------------------------------
  const pickersHost = h('div', { class: 'pickers' });

  function setLook(patch: Partial<Look>): void {
    look = { ...look, ...patch };
    lookTouched = true;
    renderPickers();
    redraw();
  }

  function swatchRow(key: RangeKey, label: string, colors: string[]): HTMLElement {
    const group = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label });
    colors.forEach((c, i) => {
      group.appendChild(
        h('button', {
          class: 'swatch',
          type: 'button',
          role: 'radio',
          'aria-checked': String(look[key] === i),
          'aria-label': `${label} ${i + 1}`,
          tabindex: look[key] === i ? '0' : '-1',
          style: { '--sw': c },
          onclick: () => setLook({ [key]: i } as Partial<Look>),
        }),
      );
    });
    group.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      ev.preventDefault();
      const n = colors.length;
      setLook({ [key]: (look[key] + d + n) % n } as Partial<Look>);
      group.querySelectorAll<HTMLElement>('.swatch')[look[key]]?.focus();
    });
    return h('div', { class: 'picker' }, h('span', { class: 'picker-label' }, label), group);
  }

  function cycleRow(key: RangeKey, label: string, count: number): HTMLElement {
    const step = (d: number) => setLook({ [key]: (look[key] + d + count) % count } as Partial<Look>);
    const value = h('span', { class: 'cycle-value', 'aria-live': 'polite' }, `${look[key] + 1} / ${count}`);
    return h(
      'div',
      { class: 'picker' },
      h('span', { class: 'picker-label' }, label),
      h(
        'div',
        { class: 'cycle' },
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('create.prev', { name: label }), onclick: () => step(-1) }, '‹'),
        value,
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('create.next', { name: label }), onclick: () => step(1) }, '›'),
      ),
    );
  }

  function renderPickers(): void {
    const focused = document.activeElement instanceof HTMLElement && pickersHost.contains(document.activeElement) ? document.activeElement : null;
    const focusPath = focused ? [...pickersHost.querySelectorAll('button')].indexOf(focused as HTMLButtonElement) : -1;
    const sw = swatchesFor(render);
    mount(
      pickersHost,
      h(
        'div',
        { class: 'picker' },
        h('span', { class: 'picker-label' }, t('create.gender')),
        h(
          'div',
          { class: 'seg', role: 'radiogroup', 'aria-label': t('create.gender') },
          ...([0, 1] as const).map((g) =>
            h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(look.gender === g), onclick: () => setLook({ gender: g }) }, g === 0 ? t('create.male') : t('create.female')),
          ),
        ),
      ),
      swatchRow('skin', t('create.skin'), sw.skin),
      cycleRow('hairStyle', t('create.hairStyle'), LOOK_RANGES.hairStyle),
      swatchRow('hairColor', t('create.hairColor'), sw.hair),
      cycleRow('outfit', t('create.outfit'), LOOK_RANGES.outfit),
      swatchRow('outfitColor', t('create.outfitColor'), sw.outfit),
      swatchRow('sashColor', t('create.sashColor'), sw.sash),
      cycleRow('accessory', t('create.accessory'), LOOK_RANGES.accessory),
    );
    if (focusPath >= 0) pickersHost.querySelectorAll('button')[focusPath]?.focus();
  }

  const turn = (d: number) => {
    dir = ((dir + d + 4) % 4) as 0 | 1 | 2 | 3;
    redraw();
  };
  const randomise = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setLook(randomLookUi()) }, glyph('shuffle'), t('create.randomise'));

  const left = h(
    'section',
    { class: 'create-card create-look parchment', 'aria-labelledby': 'create-look-h' },
    h('h2', { id: 'create-look-h', class: 'create-h' }, t('create.lookTitle')),
    h(
      'div',
      { class: 'preview-wrap' },
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('create.turnLeft'), onclick: () => turn(-1) }, '↺'),
      canvas,
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('create.turnRight'), onclick: () => turn(1) }, '↻'),
    ),
    pickersHost,
    h('div', { class: 'create-look-actions' }, randomise),
  );

  // ---- fate (rolled) ---------------------------------------------------------------------
  const statRows = new Map<StatKey, { value: HTMLElement; fill: HTMLElement; delta: HTMLElement; row: HTMLElement }>();
  const statsHost = h('div', { class: 'stat-rows' });
  for (const k of STAT_KEYS) {
    const value = h('span', { class: 'stat-value' }, '–');
    const delta = h('span', { class: 'stat-delta', 'aria-hidden': 'true' });
    const fill = h('span', { class: 'stat-fill' });
    const row = h(
      'div',
      { class: 'stat-row', title: STAT_INFO[k].desc },
      h('span', { class: 'stat-name' }, STAT_INFO[k].name),
      h('span', { class: 'stat-track', role: 'img', 'aria-label': STAT_INFO[k].name }, fill),
      value,
      delta,
    );
    statRows.set(k, { value, fill, delta, row });
    statsHost.appendChild(row);
  }
  const fateLine = h('p', { class: 'fate-line' }, t('create.rolling'));
  const talentsHost = h('div', { class: 'chip-row talent-row' });
  const originHost = h('div', { class: 'origin-card card' });
  const rollInfo = h('span', { class: 'roll-info', 'aria-live': 'polite' });
  const rollError = h('div', { class: 'form-error', role: 'alert' });
  const rerollBtn = h('button', { class: 'btn', type: 'button', onclick: () => void roll(true) }, glyph('dice'), h('span', { class: 'reroll-label' }, t('create.reroll')));

  let tumble = 0;
  function showStats(next: Stats, animate: boolean): void {
    window.clearInterval(tumble);
    const settle = () => {
      for (const k of STAT_KEYS) {
        const r = statRows.get(k)!;
        r.value.textContent = String(next[k]);
        r.fill.style.width = `${Math.max(3, Math.min(100, (next[k] / STAT_BAR_MAX) * 100))}%`;
        r.row.dataset.tier = next[k] >= 16 ? 'high' : next[k] <= 6 ? 'low' : 'mid';
        const d = prevStats ? next[k] - prevStats[k] : 0;
        r.delta.textContent = d ? (d > 0 ? `+${d}` : `−${-d}`) : '';
        r.delta.className = `stat-delta ${d > 0 ? 'tone-good' : d < 0 ? 'tone-bad' : ''}`;
      }
    };
    if (!animate || prefersReducedMotion()) return settle();
    let ticks = 0;
    tumble = window.setInterval(() => {
      ticks++;
      if (ticks > 9) {
        window.clearInterval(tumble);
        settle();
        return;
      }
      for (const k of STAT_KEYS) {
        const r = statRows.get(k)!;
        const v = 3 + Math.floor(Math.random() * 20);
        r.value.textContent = String(v);
        r.fill.style.width = `${(v / STAT_BAR_MAX) * 100}%`;
      }
    }, 55);
  }

  function showPreview(p: RollPreview, animate: boolean): void {
    showStats(p.roll.stats, animate);
    fateLine.textContent = p.roll.fate;
    mount(
      talentsHost,
      p.talents.length
        ? p.talents.map((tl) => {
            const chip = h('button', { class: ['chip', tl.positive ? 'chip-good' : 'chip-bad'], type: 'button', 'aria-label': `${tl.name}. ${tl.desc}` }, glyph(tl.positive ? 'sparkle' : 'warn'), tl.name);
            attachTooltip(chip, () => (TALENTS[tl.id] ? talentTooltip(tl.id) : `${tl.name}: ${tl.desc}`));
            return chip;
          })
        : h('span', { class: 'tone-dim' }, t('create.noTalents')),
    );
    const o2 = p.origin;
    mount(
      originHost,
      h('div', { class: 'origin-head' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, icon('flag')), h('div', {}, h('div', { class: 'origin-name' }, o2.name), h('div', { class: 'origin-sub' }, t('create.origin')))),
      h('p', { class: 'origin-desc' }, o2.desc),
      h(
        'div',
        { class: 'origin-loot' },
        h('span', { class: 'chip chip-gold' }, glyph('coin'), t('create.startGold', { n: o2.gold })),
        ...o2.items.map((label) => {
          const it = resolveOriginItem(label);
          return it ? itemSlot({ id: it.id, qty: it.qty }, { size: 'sm' }) : h('span', { class: 'chip' }, label);
        }),
      ),
      o2.skills.length
        ? h(
            'div',
            { class: 'chip-row' },
            ...o2.skills.map((label) => {
              const id = resolveSkillId(label);
              const def = id ? getSkill(id) : undefined;
              const chip = h('button', { class: 'chip chip-info', type: 'button', 'aria-label': def?.name ?? label }, def ? glyph(skillIconName(def)) : null, def?.name ?? label);
              if (def && id) attachTooltip(chip, () => skillTooltip(id, 1, { showReq: false }));
              return chip;
            }),
          )
        : null,
    );
  }

  function updateRollControls(): void {
    rerollBtn.disabled = busy || rerollsLeft <= 0 || !preview;
    rollInfo.textContent = rerollsLeft > 0 ? t('create.rerollsLeft', { n: rerollsLeft }) : t('create.noRerolls');
    createBtn.disabled = busy || !preview;
  }

  async function roll(reroll: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    rollError.textContent = '';
    updateRollControls();
    rerollBtn.classList.toggle('is-rolling', reroll);
    try {
      const p = await api.roll(reroll);
      if (destroyed) return;
      prevStats = preview ? preview.roll.stats : null;
      preview = p;
      rerollsLeft = p.rerollsLeft;
      if (!lookTouched) {
        look = p.look;
        renderPickers();
        redraw();
      }
      showPreview(p, !!prevStats || reroll);
    } catch (e) {
      rollError.textContent = e instanceof ApiFailure ? e.message : t('err.generic');
    } finally {
      busy = false;
      rerollBtn.classList.remove('is-rolling');
      if (!destroyed) updateRollControls();
    }
  }

  const right = h(
    'section',
    { class: 'create-card create-fate parchment', 'aria-labelledby': 'create-fate-h' },
    h('h2', { id: 'create-fate-h', class: 'create-h' }, t('create.fateTitle')),
    h('div', { class: 'scroll fate-scroll' }, fateLine),
    statsHost,
    h('div', { class: 'sect-title' }, t('create.talents')),
    talentsHost,
    originHost,
    h('div', { class: 'roll-controls' }, rerollBtn, rollInfo),
    rollError,
  );

  // ---- name + create --------------------------------------------------------------------------
  const nameField = textField({
    id: 'create-name',
    label: t('create.name'),
    autocomplete: 'off',
    maxLength: 16,
    placeholder: t('create.namePlaceholder'),
    validate: validateCharName,
    showValid: true,
  });
  const createError = h('div', { class: 'form-error', role: 'alert' });
  const createBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, glyph('play'), t('create.submit'));

  const footer = h(
    'form',
    {
      class: 'create-footer parchment',
      novalidate: true,
      onsubmit: async (ev: Event) => {
        ev.preventDefault();
        if (busy || !preview) return;
        if (!nameField.validate(true)) return nameField.focus();
        busy = true;
        createError.textContent = '';
        updateRollControls();
        createBtn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('create.creating'));
        try {
          await api.create({ name: normalizeCharName(nameField.get()), look });
          o.onCreated();
        } catch (e) {
          const msg = e instanceof ApiFailure ? e.message : t('err.generic');
          if (e instanceof ApiFailure && (e.status === 409 || /name/i.test(e.code))) {
            nameField.setError(msg);
            nameField.focus();
          } else createError.textContent = msg;
        } finally {
          busy = false;
          if (!destroyed) {
            createBtn.replaceChildren(glyph('play'), t('create.submit'));
            updateRollControls();
          }
        }
      },
    },
    nameField.el,
    h('div', { class: 'create-submit' }, createBtn, createError),
  );

  const top = h(
    'div',
    { class: 'create-top' },
    brandBlock(),
    h('button', { class: 'link-btn create-logout', type: 'button', onclick: o.onLogout }, t('create.logout', { name: o.me.user.username })),
  );
  root.append(top, h('div', { class: 'create-grid' }, left, right), footer);

  renderPickers();
  redraw();
  if (!still) raf = requestAnimationFrame(loop);
  updateRollControls();
  void roll(false);
  return {
    el: root,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(tumble);
      backdrop.destroy();
      root.remove();
    },
  };
}
