/** Draw a character into a canvas at a crisp size for the current device pixel ratio. */
import type { Look } from '@murim/shared';
import type { LookPreviewOptions, RenderModule } from '../render/api';
import { standinRenderModule } from './standin/render';

export function deviceRatio(): number {
  return Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}

const SAMPLE_LOOK: Look = { gender: 0, skin: 1, hairStyle: 1, hairColor: 1, outfit: 1, outfitColor: 1, sashColor: 1, accessory: 0 };
const probed = new WeakMap<RenderModule, boolean>();

/**
 * True when `render.drawLookPreview` actually paints something. While the real renderer is unfinished its preview may
 * be a no-op; portraits then fall back to the stand-in instead of showing empty frames.
 */
export function previewWorks(render: RenderModule): boolean {
  const known = probed.get(render);
  if (known !== undefined) return known;
  let ok = false;
  try {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 80;
    render.drawLookPreview(c, SAMPLE_LOOK, { scale: 2, dir: 0, backdrop: false });
    const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    if (data) for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { ok = true; break; }
  } catch {
    ok = false;
  }
  probed.set(render, ok);
  return ok;
}

/**
 * `cssW` x `cssH` is the intended on-screen size in CSS pixels; `scale` is the sprite pixel scale at dpr 1.
 * (A full character is roughly 24 x 40 sprite pixels.)
 */
export function drawLook(render: RenderModule, canvas: HTMLCanvasElement, look: Look, cssW: number, cssH: number, scale: number, opts: LookPreviewOptions = {}): void {
  const dpr = deviceRatio();
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const target = previewWorks(render) ? render : standinRenderModule;
  try {
    target.drawLookPreview(canvas, look, { ...opts, scale: scale * dpr });
  } catch (e) {
    console.error('[portrait] drawLookPreview failed', e);
  }
}

/** Swatch colours for the creation pickers, from the same module that draws the preview. */
export function swatchesFor(render: RenderModule): RenderModule['lookSwatches'] {
  return previewWorks(render) ? render.lookSwatches : standinRenderModule.lookSwatches;
}
