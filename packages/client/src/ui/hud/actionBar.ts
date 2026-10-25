/**
 * Action bar: one button per registered panel with its hotkey. On narrow screens it collapses into a single
 * menu button that opens a bottom sheet.
 */
import { hasKey, t } from '../../i18n';
import type { UiContext } from '../context';
import { glyph, h } from '../dom';
import { icon } from '../icons';
import { listPanels, type PanelDef } from '../panels/registry';
import { attachTooltip } from '../widgets/tooltip';

export interface ActionBar {
  destroy(): void;
  closeSheet(): boolean;
}

/** Which buttons show an alert dot. */
export function panelAlert(id: string, ui: UiContext): boolean {
  const me = ui.state.get('me');
  if (!me) return false;
  if (id === 'character') return me.c.statPoints > 0;
  if (id === 'missions') return me.c.missions.some((m) => m.done);
  return false;
}

export function mountActionBar(host: HTMLElement, ui: UiContext): ActionBar {
  const defs = listPanels().filter((p) => p.bar !== false);
  const buttons = new Map<string, HTMLButtonElement[]>();
  let sheetOpen = false;

  const makeButton = (p: PanelDef, big: boolean): HTMLButtonElement => {
    const label = t(p.title);
    const shortLabel = hasKey(`bar.short.${p.id}`) ? t(`bar.short.${p.id}`) : label;
    const b = h(
      'button',
      {
        class: ['abtn', big && 'abtn-big'],
        type: 'button',
        'aria-label': p.hotkey ? t('bar.openKey', { name: label, key: p.hotkey.toUpperCase() }) : t('bar.open', { name: label }),
        'aria-pressed': 'false',
        onclick: () => {
          ui.panels.toggle(p.id);
          if (big) setSheet(false);
        },
      },
      h('span', { class: 'abtn-glyph', 'aria-hidden': 'true' }, icon(p.glyph)),
      h('span', { class: 'abtn-label', 'aria-hidden': big ? undefined : 'true' }, shortLabel),
      p.hotkey ? h('kbd', { class: 'abtn-key', 'aria-hidden': 'true' }, p.hotkey.toUpperCase()) : null,
      h('span', { class: 'abtn-dot', hidden: true, 'aria-hidden': 'true' }),
    );
    if (!big) attachTooltip(b, () => (p.hotkey ? `${label} (${p.hotkey.toUpperCase()})` : label), { delay: 400 });
    const list = buttons.get(p.id) ?? [];
    list.push(b);
    buttons.set(p.id, list);
    return b;
  };

  const desktop = h('nav', { class: 'abar glass', 'aria-label': t('bar.label') }, ...defs.map((p) => makeButton(p, false)));
  const sheet = h(
    'div',
    { class: 'abar-sheet glass', id: 'abar-sheet', role: 'menu', 'aria-label': t('bar.label') },
    h('div', { class: 'abar-grid' }, ...defs.map((p) => makeButton(p, true))),
  );
  const menuBtn = h(
    'button',
    { class: 'abar-menu glass', type: 'button', 'aria-label': t('bar.menu'), 'aria-expanded': 'false', 'aria-controls': 'abar-sheet', onclick: () => setSheet(!sheetOpen) },
    glyph('menu'),
    h('span', { class: 'abtn-dot', hidden: true, 'aria-hidden': 'true' }),
  );
  host.append(desktop, menuBtn, sheet);

  function setSheet(open: boolean): void {
    sheetOpen = open;
    sheet.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  // tapping outside the sheet closes it
  const onDown = (ev: PointerEvent) => {
    if (sheetOpen && !(ev.target as HTMLElement).closest('.abar-sheet, .abar-menu')) setSheet(false);
  };
  document.addEventListener('pointerdown', onDown);

  const refresh = () => {
    let any = false;
    for (const p of defs) {
      const open = ui.panels.isOpen(p.id);
      const alert = panelAlert(p.id, ui);
      any ||= alert;
      for (const b of buttons.get(p.id) ?? []) {
        b.setAttribute('aria-pressed', String(open));
        b.classList.toggle('active', open);
        b.querySelector<HTMLElement>('.abtn-dot')!.hidden = !alert;
      }
    }
    menuBtn.querySelector<HTMLElement>('.abtn-dot')!.hidden = !any;
  };
  refresh();
  const unsubPanels = ui.panels.onChange(refresh);
  const unsubState = ui.state.subscribe('me', refresh);
  return {
    closeSheet() {
      const was = sheetOpen;
      setSheet(false);
      return was;
    },
    destroy() {
      unsubPanels();
      unsubState();
      document.removeEventListener('pointerdown', onDown);
      desktop.remove();
      menuBtn.remove();
      sheet.remove();
    },
  };
}
