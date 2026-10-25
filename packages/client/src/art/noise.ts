/** Fast deterministic noise for art generation (not for simulation). Pure. */

/** 32-bit integer hash of up to three ints -> [0, 2^32). */
export function ihash(a: number, b = 0, c = 0): number {
  let h = (a | 0) * 0x27d4eb2d;
  h ^= (b | 0) * 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= (c | 0) * 0x1b873593;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash to [0, 1). */
export function rnd(a: number, b = 0, c = 0): number {
  return ihash(a, b, c) / 4294967296;
}

const N = 256;
const MASK = N - 1;

/** A tileable 256x256 fractal value-noise table sampled bilinearly. Values in [0, 1]. */
export class NoiseTex {
  readonly t: Float32Array;

  constructor(seed: number, octaves = 4, baseCells = 8) {
    this.t = new Float32Array(N * N);
    let amp = 1;
    let norm = 0;
    let cells = baseCells;
    for (let o = 0; o < octaves; o++) {
      const step = N / cells;
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd(i, seed, o * 7919 + 13);
      for (let y = 0; y < N; y++) {
        const gy = y / step;
        const y0 = Math.floor(gy);
        const fy = gy - y0;
        const sy = fy * fy * (3 - 2 * fy);
        const r0 = (y0 % cells) * cells;
        const r1 = ((y0 + 1) % cells) * cells;
        for (let x = 0; x < N; x++) {
          const gx = x / step;
          const x0 = Math.floor(gx);
          const fx = gx - x0;
          const sx = fx * fx * (3 - 2 * fx);
          const c0 = x0 % cells;
          const c1 = (x0 + 1) % cells;
          const a = lat[r0 + c0];
          const b = lat[r0 + c1];
          const c = lat[r1 + c0];
          const d = lat[r1 + c1];
          const v = a + (b - a) * sx + (c + (d - c) * sx - a - (b - a) * sx) * sy;
          this.t[y * N + x] += v * amp;
        }
      }
      norm += amp;
      amp *= 0.5;
      cells *= 2;
      if (cells > N) break;
    }
    for (let i = 0; i < this.t.length; i++) this.t[i] /= norm;
    // Stretch contrast so values use most of [0, 1].
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.t) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const k = 1 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < this.t.length; i++) this.t[i] = (this.t[i] - lo) * k;
  }

  /** Bilinear sample; coordinates in texels (wraps). */
  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const t = this.t;
    const i00 = (y0 & MASK) * N + (x0 & MASK);
    const i10 = (y0 & MASK) * N + ((x0 + 1) & MASK);
    const i01 = ((y0 + 1) & MASK) * N + (x0 & MASK);
    const i11 = ((y0 + 1) & MASK) * N + ((x0 + 1) & MASK);
    const a = t[i00] + (t[i10] - t[i00]) * fx;
    const b = t[i01] + (t[i11] - t[i01]) * fx;
    return a + (b - a) * fy;
  }

  /** Nearest sample (cheaper). */
  near(x: number, y: number): number {
    return this.t[(Math.floor(y) & MASK) * N + (Math.floor(x) & MASK)];
  }
}

let shared: NoiseTex[] | null = null;

/** Lazily created shared noise tables: [broad, medium, fine, ridge]. */
export function noiseTables(): NoiseTex[] {
  if (!shared) shared = [new NoiseTex(11, 4, 4), new NoiseTex(23, 4, 8), new NoiseTex(37, 3, 32), new NoiseTex(53, 3, 16)];
  return shared;
}
