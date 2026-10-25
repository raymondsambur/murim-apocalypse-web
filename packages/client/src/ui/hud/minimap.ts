/** Top-right minimap: tap to centre the camera, zoom buttons, a recentre button and the current location. */
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { h } from '../dom';
import { deviceRatio } from '../portrait';

export function nearestSettlementName(ui: UiContext): { name: string; status: string | null } | null {
  const world = ui.state.get('world');
  const self = ui.state.selfEntity();
  if (!world || !self) return null;
  let best: { name: string; id: number; d: number } | null = null;
  for (const s of world.payload.settlements) {
    const d = Math.hypot(s.x - self.x, s.y - self.y);
    if (!best || d < best.d) best = { name: s.name, id: s.id, d };
  }
  if (!best) return null;
  const near = best.d <= 24;
  return { name: near ? best.name : t('map.wilds', { name: best.name }), status: near ? (ui.state.get('settlements').get(best.id)?.status ?? null) : null };
}

export function mountMinimap(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const canvas = h('canvas', { class: 'minimap-canvas', role: 'img', 'aria-label': t('map.label') });
  const where = h('span', { class: 'minimap-where' });
  const coords = h('span', { class: 'minimap-coords' });
  const collapseBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('map.toggle'), 'aria-expanded': 'true' }, '▾');
  const el = h(
    'section',
    { class: 'minimap glass', 'aria-label': t('map.label') },
    h(
      'div',
      { class: 'minimap-head' },
      h('span', { class: 'minimap-loc' }, where, coords),
      h(
        'span',
        { class: 'minimap-tools' },
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('map.zoomOut'), onclick: () => ui.gameView.setZoom(ui.gameView.getZoom() / 1.2) }, '−'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('map.zoomIn'), onclick: () => ui.gameView.setZoom(ui.gameView.getZoom() * 1.2) }, '+'),
        h(
          'button',
          {
            class: 'btn-icon btn-sm',
            type: 'button',
            'aria-label': t('map.recenter'),
            onclick: () => {
              const s = ui.state.selfEntity();
              if (s) ui.gameView.centerOn(s.x, s.y);
            },
          },
          '◎',
        ),
        collapseBtn,
      ),
    ),
    canvas,
  );
  host.appendChild(el);

  const setCollapsed = (c: boolean, persist = true) => {
    el.classList.toggle('collapsed', c);
    collapseBtn.setAttribute('aria-expanded', String(!c));
    collapseBtn.textContent = c ? '▸' : '▾';
    if (persist) ui.settings.set({ minimapCollapsed: c });
    if (!c) fit();
  };
  collapseBtn.addEventListener('click', () => setCollapsed(!el.classList.contains('collapsed')));

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = deviceRatio();
    const w = Math.round(r.width * dpr);
    const hh = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
  };
  const draw = () => {
    if (el.classList.contains('collapsed') || document.hidden) return;
    fit();
    if (!canvas.width) return;
    try {
      ui.gameView.drawMinimap(canvas);
    } catch (e) {
      console.error('[minimap]', e);
    }
  };
  const text = () => {
    const loc = nearestSettlementName(ui);
    where.textContent = loc?.name ?? t('map.unknown');
    where.dataset.status = loc?.status ?? '';
    const s = ui.state.selfEntity();
    coords.textContent = s ? `${Math.round(s.x)}, ${Math.round(s.y)}` : '';
  };
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * canvas.width;
    const py = ((ev.clientY - r.top) / r.height) * canvas.height;
    const tile = ui.gameView.minimapToTile(canvas, px, py);
    ui.gameView.centerOn(tile.x, tile.y);
  });

  setCollapsed(ui.settings.get().minimapCollapsed, false);
  text();
  const timer = window.setInterval(draw, 400);
  const textTimer = window.setInterval(text, 1000);
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  const unsub = ui.state.subscribe(['world', 'settlements'], text);
  requestAnimationFrame(draw);
  return {
    destroy() {
      unsub();
      ro.disconnect();
      clearInterval(timer);
      clearInterval(textTimer);
      el.remove();
    },
  };
}
