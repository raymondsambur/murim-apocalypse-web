/** Top-right world clock: time-of-day icon, time, day / season and the weather over the player. */
import { t } from '../../i18n';
import type { UiContext } from '../context';
import { PHASE_GLYPH, WEATHER_GLYPH, climateBand, clockText, dayPhase, seasonName, worldClock } from '../format';
import { h } from '../dom';

export function mountClock(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const phase = h('span', { class: 'clock-phase glyph', 'aria-hidden': 'true' });
  const time = h('span', { class: 'clock-time' });
  const date = h('span', { class: 'clock-date' });
  const wGlyph = h('span', { class: 'clock-weather-glyph glyph', 'aria-hidden': 'true' });
  const wText = h('span', { class: 'clock-weather-text' });
  const el = h(
    'div',
    { class: 'clock glass', role: 'timer', 'aria-live': 'off', 'aria-label': t('clock.label') },
    phase,
    h('span', { class: 'clock-main' }, time, date),
    h('span', { class: 'clock-weather' }, wGlyph, wText),
  );
  host.appendChild(el);

  const update = () => {
    const tv = ui.state.get('time');
    if (!tv) return;
    const now = ui.state.serverNow();
    const r = worldClock(tv, now);
    const p = dayPhase(r.hours);
    phase.textContent = PHASE_GLYPH[p];
    phase.dataset.phase = p;
    time.textContent = clockText(r.hours);
    date.textContent = t('clock.date', { day: r.dayOfSeason, season: seasonName(r.season), year: r.year + 1 });
    const world = ui.state.get('world');
    const self = ui.state.selfEntity();
    const band = world && self ? climateBand(self.y, world.payload.h) : 1;
    const w = tv.weather[Math.min(band, tv.weather.length - 1)] ?? 'clear';
    wGlyph.textContent = WEATHER_GLYPH[w];
    wText.textContent = t(`weather.${w}`);
    el.title = `${t(`clock.${p}`)} · ${t(`weather.${w}`)}`;
  };
  update();
  const unsub = ui.state.subscribe(['time', 'world'], update);
  const timer = window.setInterval(update, 1000);
  return {
    destroy() {
      unsub();
      clearInterval(timer);
      el.remove();
    },
  };
}
