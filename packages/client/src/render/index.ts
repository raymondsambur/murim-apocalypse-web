/**
 * Public entry of the world renderer: implements `RenderModule` from ./api.ts.
 * The client shell loads this file (see ui/renderLoader.ts) and also gets it as the default export.
 */
import type { Look } from '@murim/shared';
import { genCharacter, FRAME_COUNTS, type CharSpec, type CharState } from '../art/character';
import { FRAME_MS } from '../art/anim';
import { gearAppearance } from '../art/gear';
import { makeSprite, type Sprite } from '../art/canvas';
import { lookSwatches } from '../art/palette';
import type { GameViewApi, LookPreviewOptions, RenderModule } from './api';
import { LRU } from './lru';
import { GameView } from './view';
import { charKey } from './sprites';

export function createGameView(canvas: HTMLCanvasElement): GameViewApi {
  return new GameView(canvas);
}

const previewCache = new LRU<string, Sprite & { glow?: HTMLCanvasElement }>(300);

function previewFrame(state: CharState, time: number | undefined): number {
  if (time === undefined) return 0;
  const n = FRAME_COUNTS[state];
  return Math.floor(time / FRAME_MS[state]) % n;
}

/** Draw one character crisply into a canvas (character creation, inspect panels, party list). */
export function drawLookPreview(canvas: HTMLCanvasElement, look: Look, opts: LookPreviewOptions = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const state: CharState = opts.state ?? 'idle';
  const frame = opts.frame !== undefined ? opts.frame % FRAME_COUNTS[state] : previewFrame(state, opts.time);
  const spec: CharSpec = {
    look,
    weapon: opts.weapon ?? null,
    state,
    dir: opts.dir ?? 0,
    frame,
    gear: opts.gear ? gearAppearance(opts.gear) : undefined,
    variant: opts.variant ?? 0,
    tool: opts.tool,
    full: true,
  };
  const key = charKey(spec);
  let spr = previewCache.get(key);
  if (!spr) {
    const g = genCharacter(spec);
    spr = makeSprite(g.pb, g.ax, g.ay, g.glow);
    previewCache.set(key, spr);
  }
  // Largest crisp scale that keeps the figure (about 40 x 58 sprite px incl. weapon and hat) inside the canvas.
  const wide = state === 'attack' || state === 'dead' || state === 'die' || state === 'draw' || state === 'work';
  const fit = Math.max(1, Math.floor(Math.min(cw / (wide ? 72 : 40), ch / 62)));
  const scale = Math.max(1, Math.min(opts.scale ?? 6, fit));
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  const cx = Math.round(cw / 2);
  const feet = Math.round(ch - Math.max(4, (ch - 58 * scale) / 2) - 4 * scale);
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
  if (spr.glow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = opts.time === undefined ? 0.6 : 0.45 + 0.35 * Math.sin(opts.time / 380);
    ctx.drawImage(spr.glow, cx - spr.ax * scale, feet - spr.ay * scale, spr.w * scale, spr.h * scale);
  }
  ctx.restore();
}

export { lookSwatches };

export const renderModule: RenderModule = { createGameView, drawLookPreview, lookSwatches };
export default renderModule;
export { GameView };
