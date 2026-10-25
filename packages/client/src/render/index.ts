/**
 * Public entry of the world renderer: implements `RenderModule` from ./api.ts.
 * The client shell loads this file (see ui/renderLoader.ts) and also gets it as the default export.
 */
import type { Look } from '@murim/shared';
import { genCharacter, FRAME_COUNTS, type CharSpec, type CharState } from '../art/character';
import { makeSprite, type Sprite } from '../art/canvas';
import { lookSwatches } from '../art/palette';
import type { GameViewApi, LookPreviewOptions, RenderModule } from './api';
import { LRU } from './lru';
import { GameView } from './view';

export function createGameView(canvas: HTMLCanvasElement): GameViewApi {
  return new GameView(canvas);
}

const previewCache = new LRU<string, Sprite>(240);

function previewFrame(state: CharState, time: number | undefined): number {
  if (time === undefined) return 0;
  const n = FRAME_COUNTS[state];
  switch (state) {
    case 'walk':
      return Math.floor(time / 130) % n;
    case 'fight':
      return Math.floor(time / 320) % n;
    case 'meditate':
      return Math.floor(time / 900) % n;
    default:
      return Math.floor(time / 650) % n;
  }
}

/** Draw one character crisply into a canvas (character creation, inspect panels, party list). */
export function drawLookPreview(canvas: HTMLCanvasElement, look: Look, opts: LookPreviewOptions = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const state: CharState = opts.state ?? 'idle';
  const spec: CharSpec = { look, weapon: opts.weapon ?? null, state, dir: opts.dir ?? 0, frame: previewFrame(state, opts.time) };
  const key = `${look.gender}${look.skin}${look.hairStyle}${look.hairColor}${look.outfit}${look.outfitColor}${look.sashColor}${look.accessory}|${spec.weapon}|${state}|${spec.dir}|${spec.frame}`;
  let spr = previewCache.get(key);
  if (!spr) {
    const g = genCharacter(spec);
    spr = makeSprite(g.pb, g.ax, g.ay);
    previewCache.set(key, spr);
  }
  // Largest crisp scale that keeps the figure (about 26 x 42 sprite px incl. weapon and hat) inside the canvas.
  const fit = Math.max(1, Math.floor(Math.min(cw / 28, ch / 44)));
  const scale = Math.max(1, Math.min(opts.scale ?? 6, fit));
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  const cx = Math.round(cw / 2);
  const feet = Math.round(ch - Math.max(4, (ch - 42 * scale) / 2) - 5 * scale);
  if (opts.backdrop !== false) {
    const r = Math.min(cw, ch) * 0.48;
    const g = ctx.createRadialGradient(cx, ch * 0.55, r * 0.1, cx, ch * 0.55, r);
    g.addColorStop(0, 'rgba(70,56,84,0.85)');
    g.addColorStop(0.7, 'rgba(32,24,42,0.55)');
    g.addColorStop(1, 'rgba(20,14,28,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    // ground shadow, drawn as a crisp pixel ellipse
    ctx.fillStyle = 'rgba(8,4,16,0.5)';
    const rx = Math.round(9 * scale);
    const ry = Math.round(3.6 * scale);
    for (let y = -ry; y <= ry; y++) {
      const half = Math.round(rx * Math.sqrt(1 - (y / ry) * (y / ry)));
      ctx.fillRect(cx - half, feet + y + scale, half * 2, 1);
    }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr.cv, cx - spr.ax * scale, feet - spr.ay * scale, spr.w * scale, spr.h * scale);
  ctx.restore();
}

export { lookSwatches };

export const renderModule: RenderModule = { createGameView, drawLookPreview, lookSwatches };
export default renderModule;
export { GameView };
