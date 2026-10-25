/**
 * Helper for the unfinished panels. Each placeholder is clearly labelled "Draft" in the title bar and says what the
 * finished panel will hold, plus one live line of data to prove the store wiring. Wave-2 engineers replace the file.
 */
import { t } from '../../i18n';
import type { StoreKey } from '../../state/store';
import type { UiContext } from '../context';
import { h, mount } from '../dom';
import { registerPanel } from './registry';

export interface PlaceholderOptions {
  id: string;
  /** i18n key of the title. */
  title: string;
  glyph: string;
  hotkey?: string;
  order: number;
  /** i18n key of the paragraph that describes the finished panel. */
  blurb: string;
  /** i18n keys of the bullet points that will be in it. */
  features: string[];
  watch?: StoreKey[];
  /** One line of live data, to show the panel is wired to the store. */
  live?(ui: UiContext): string;
}

export function placeholderPanel(o: PlaceholderOptions): void {
  registerPanel({
    id: o.id,
    title: o.title,
    glyph: o.glyph,
    hotkey: o.hotkey,
    order: o.order,
    placeholder: true,
    width: 380,
    watch: o.watch ?? ['me'],
    render(root, ui) {
      mount(
        root,
        h('div', { class: 'placeholder' }, h('span', { class: 'seal seal-lg placeholder-seal', 'aria-hidden': 'true' }, o.glyph), h('p', { class: 'placeholder-blurb' }, t(o.blurb))),
        h('ul', { class: 'placeholder-list' }, ...o.features.map((f) => h('li', {}, t(f)))),
        o.live ? h('div', { class: 'card placeholder-live' }, o.live(ui)) : null,
        h('p', { class: 'placeholder-foot' }, t('panel.placeholderFoot')),
      );
    },
  });
}
