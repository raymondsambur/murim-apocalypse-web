/** Bridges the pure PixelBuffer world to DOM canvases (the only art module that touches the DOM). */
import type { PixelBuffer } from './pixel';
import { rowSpans, type RowSpans } from '../render/occlusion';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;

/** Upload a pixel buffer into a new canvas. */
export function pbToCanvas(pb: PixelBuffer): HTMLCanvasElement {
  const c = makeCanvas(pb.w, pb.h);
  pbDraw(pb, c);
  return c;
}

/** Overwrite a canvas with the pixel buffer contents. */
export function pbDraw(pb: PixelBuffer, c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(pb.w, pb.h);
  if (LITTLE_ENDIAN) {
    new Uint32Array(img.data.buffer).set(pb.px);
  } else {
    const d = img.data;
    for (let i = 0; i < pb.px.length; i++) {
      const v = pb.px[i];
      d[i * 4] = v & 255;
      d[i * 4 + 1] = (v >>> 8) & 255;
      d[i * 4 + 2] = (v >>> 16) & 255;
      d[i * 4 + 3] = v >>> 24;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A drawable sprite with an anchor (the pixel that sits on the entity's ground point). */
export interface Sprite {
  cv: HTMLCanvasElement;
  /** Anchor inside the sprite (art px). */
  ax: number;
  ay: number;
  w: number;
  h: number;
  /** Optional emissive layer drawn additively at night. */
  glow?: HTMLCanvasElement;
  /** First opaque row (for plates above the head). */
  top?: number;
  /** Opaque extent per row (only for tall drawables that can hide people; see render/occlusion.ts). */
  spans?: RowSpans;
}

export function makeSprite(pb: PixelBuffer, ax: number, ay: number, glow?: PixelBuffer | null, spans = false): Sprite {
  const cv = pbToCanvas(pb);
  const s: Sprite = { cv, ax, ay, w: pb.w, h: pb.h };
  if (spans) s.spans = rowSpans(pb.px, pb.w, pb.h);
  if (glow && glow.bounds()) s.glow = pbToCanvas(glow);
  return s;
}
