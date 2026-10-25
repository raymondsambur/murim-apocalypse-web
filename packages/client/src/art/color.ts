/**
 * Packed colours for pixel work. A colour is a uint32 in ImageData byte order on little-endian
 * machines (0xAABBGGRR), so it can be written straight into a Uint32Array view of ImageData.
 * Pure functions only (unit-testable in node).
 */

export type Col = number;

export function rgba(r: number, g: number, b: number, a = 255): Col {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export const cr = (c: Col): number => c & 255;
export const cg = (c: Col): number => (c >>> 8) & 255;
export const cb = (c: Col): number => (c >>> 16) & 255;
export const ca = (c: Col): number => c >>> 24;

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** '#rrggbb' or '#rgb' to a packed colour. */
export function hex(h: string, a = 255): Col {
  let s = h.startsWith('#') ? h.slice(1) : h;
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

export function css(c: Col): string {
  const a = ca(c);
  if (a === 255) return `#${((1 << 24) | (cr(c) << 16) | (cg(c) << 8) | cb(c)).toString(16).slice(1)}`;
  return `rgba(${cr(c)},${cg(c)},${cb(c)},${(a / 255).toFixed(3)})`;
}

export function withAlpha(c: Col, a: number): Col {
  return ((c & 0x00ffffff) | ((clamp255(a) & 255) << 24)) >>> 0;
}

export function mix(a: Col, b: Col, t: number): Col {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return rgba(
    clamp255(cr(a) + (cr(b) - cr(a)) * t),
    clamp255(cg(a) + (cg(b) - cg(a)) * t),
    clamp255(cb(a) + (cb(b) - cb(a)) * t),
    clamp255(ca(a) + (ca(b) - ca(a)) * t),
  );
}

/** Multiply RGB by f (alpha kept). */
export function scale(c: Col, f: number): Col {
  return rgba(clamp255(cr(c) * f), clamp255(cg(c) * f), clamp255(cb(c) * f), ca(c));
}

/**
 * Hue-shifted shading, the classic pixel-art ramp: darker tones drift toward cool violet,
 * lighter tones toward warm yellow. f < 1 darkens, f > 1 lightens.
 */
export function shade(c: Col, f: number): Col {
  const r = cr(c);
  const g = cg(c);
  const b = cb(c);
  if (f < 1) {
    const k = 1 - f;
    return rgba(clamp255(r * f + 18 * k), clamp255(g * f + 8 * k), clamp255(b * f + 34 * k), ca(c));
  }
  const k = Math.min(1, f - 1);
  return rgba(clamp255(r + (255 - r) * k * 0.9 + 10 * k), clamp255(g + (255 - g) * k * 0.85 + 6 * k), clamp255(b + (255 - b) * k * 0.6), ca(c));
}

export function lum(c: Col): number {
  return (cr(c) * 0.299 + cg(c) * 0.587 + cb(c) * 0.114) / 255;
}

export function desaturate(c: Col, t: number): Col {
  const l = cr(c) * 0.299 + cg(c) * 0.587 + cb(c) * 0.114;
  return rgba(clamp255(cr(c) + (l - cr(c)) * t), clamp255(cg(c) + (l - cg(c)) * t), clamp255(cb(c) + (l - cb(c)) * t), ca(c));
}

/** Blend src over dst (straight alpha). */
export function over(dst: Col, src: Col): Col {
  const sa = ca(src);
  if (sa === 255) return src;
  if (sa === 0) return dst;
  const da = ca(dst);
  const t = sa / 255;
  const outA = sa + da * (1 - t);
  if (outA <= 0) return 0;
  const k = sa / outA;
  return rgba(
    clamp255(cr(dst) + (cr(src) - cr(dst)) * k),
    clamp255(cg(dst) + (cg(src) - cg(dst)) * k),
    clamp255(cb(dst) + (cb(src) - cb(dst)) * k),
    clamp255(outA),
  );
}

/** Colour with Blight corruption applied: desaturate, darken and push toward bruise-violet. */
export function corrupt(c: Col, t: number): Col {
  if (t <= 0) return c;
  const d = desaturate(c, Math.min(1, t * 1.1));
  const target = rgba(86, 54, 106, ca(c));
  return mix(scale(d, 1 - 0.2 * t), target, t * 0.5);
}

/** CSS colour string to packed colour (supports #hex only; used by palettes). */
export function parse(s: string): Col {
  return hex(s);
}
