/** Optional frame-rate / latency readout (Settings -> Show FPS). */
import type { UiContext } from '../context';
import { h } from '../dom';

export function mountFps(host: HTMLElement, ui: UiContext): { destroy(): void } {
  const el = h('div', { class: 'fps', 'aria-hidden': 'true', hidden: true });
  host.appendChild(el);
  let raf = 0;
  let frames = 0;
  let last = performance.now();
  let running = false;

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    frames++;
    if (now - last >= 500) {
      const fps = Math.round((frames * 1000) / (now - last));
      const ping = ui.net.latency;
      el.textContent = `${fps} fps${ping !== null ? ` · ${Math.round(ping)} ms` : ''}`;
      frames = 0;
      last = now;
    }
  };
  const sync = () => {
    const on = ui.settings.get().showFps;
    el.hidden = !on;
    if (on && !running) {
      running = true;
      last = performance.now();
      frames = 0;
      raf = requestAnimationFrame(loop);
    } else if (!on && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };
  sync();
  const unsub = ui.settings.subscribe(sync);
  return {
    destroy() {
      unsub();
      cancelAnimationFrame(raf);
      el.remove();
    },
  };
}
