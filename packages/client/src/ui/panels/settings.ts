/** Settings panel: UI scale, chat font, motion, FPS readout, camera zoom, panel layout reset and logout. */
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { registerPanel } from './registry';

function rangeRow(id: string, label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLElement {
  const out = h('output', { class: 'setting-out', for: id }, fmt(value));
  const input = h('input', { class: 'range', id, type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return h('div', { class: 'setting' }, h('label', { class: 'setting-label', for: id }, label), h('div', { class: 'setting-ctl' }, input, out));
}

function switchRow(id: string, label: string, hint: string | null, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { id, type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, label, hint ? h('div', { class: 'setting-hint' }, hint) : null), h('label', { class: 'switch', for: id }, input, h('span', { class: 'switch-track' }), h('span', { class: 'sr-only' }, label)));
}

function build(root: HTMLElement, ui: UiContext): void {
  const s = ui.settings.get();
  const motion = h('select', { class: 'select', id: 'set-motion', 'aria-label': t('set.motion') });
  for (const [v, key] of [['system', 'set.motion.system'], ['on', 'set.motion.reduce'], ['off', 'set.motion.full']] as const) motion.appendChild(h('option', { value: v }, t(key)));
  motion.value = s.reduceMotion === null ? 'system' : s.reduceMotion ? 'on' : 'off';
  motion.addEventListener('change', () => ui.settings.set({ reduceMotion: motion.value === 'system' ? null : motion.value === 'on' }));

  const ping = ui.net.latency;
  root.append(
    h('div', { class: 'sect-title' }, t('set.display')),
    rangeRow('set-scale', t('set.uiScale'), 0.75, 1.5, 0.05, s.uiScale, (v) => `${Math.round(v * 100)}%`, (v) => ui.settings.set({ uiScale: v })),
    rangeRow('set-chat', t('set.chatFont'), 11, 20, 1, s.chatFont, (v) => `${v}px`, (v) => ui.settings.set({ chatFont: v })),
    rangeRow('set-zoom', t('set.zoom'), 0.5, 2.5, 0.1, ui.gameView.getZoom(), (v) => `${v.toFixed(1)}×`, (v) => ui.gameView.setZoom(v)),
    h('div', { class: 'setting' }, h('label', { class: 'setting-label', for: 'set-motion' }, t('set.motion'), h('div', { class: 'setting-hint' }, t('set.motionHint'))), motion),
    switchRow('set-fps', t('set.fps'), t('set.fpsHint'), s.showFps, (v) => ui.settings.set({ showFps: v })),
    h('div', { class: 'sect-title' }, t('set.layout')),
    h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, t('set.resetPanels'), h('div', { class: 'setting-hint' }, t('set.resetPanelsHint'))), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (ui.panels.resetPositions(), ui.toast(t('set.resetDone'), 'good')) }, t('set.reset'))),
    h('div', { class: 'sect-title' }, t('set.connection')),
    h('dl', { class: 'kv' }, h('dt', {}, t('set.ping')), h('dd', {}, ping === null ? '–' : `${Math.round(ping)} ms`), h('dt', {}, t('set.status')), h('dd', {}, ui.net.connected ? t('set.online') : t('set.offline'))),
    h('div', { class: 'sect-title' }, t('set.account')),
    h(
      'button',
      {
        class: 'btn btn-danger btn-block',
        type: 'button',
        onclick: async () => {
          if (await ui.confirm({ title: t('set.logoutTitle'), text: t('set.logoutText'), ok: t('set.logout'), danger: true, glyph: '離' })) ui.logout();
        },
      },
      t('set.logout'),
    ),
    h('p', { class: 'setting-hint', style: 'margin-top:.6rem;text-align:center' }, t('set.keys')),
  );
}

registerPanel({
  id: 'settings',
  title: 'panel.settings',
  glyph: '設',
  order: 90,
  width: 380,
  // Static form: never re-render while a slider is being dragged.
  watch: [],
  render: build,
});
