/**
 * Small pooled particle system for entity effects (footfall dust, shallow-water splashes, snow prints, weapon sparks,
 * qi motes, cauldron steam). Typed arrays, no per-frame allocation. Positions are world art pixels so the effects stay
 * put while the camera moves.
 */

export const PK = { Dust: 1, Splash: 2, Print: 3, Spark: 4, Mote: 5, Steam: 6, Ember: 7 } as const;
export type PKind = (typeof PK)[keyof typeof PK];

const N = 640;
/** Colour table (CSS) indexed by the `col` field. */
const COLORS = [
  '#d8c9a2', // 0 dirt dust
  '#e6dcc0', // 1 sand dust
  '#bcd8ee', // 2 water
  '#f2f8ff', // 3 white
  '#9fb2c6', // 4 snow print
  '#ffe27a', // 5 gold
  '#9fe8ff', // 6 qi
  '#ffffff', // 7 steam
  '#b87ae6', // 8 epic
  '#f0a43a', // 9 legendary
  '#5fa4e8', // 10 rare
  '#7ec26b', // 11 fine
  '#c9c2b4', // 12 grey dust
];
export const PCOL = { dirt: 0, sand: 1, water: 2, white: 3, snowPrint: 4, gold: 5, qi: 6, steam: 7, epic: 8, legend: 9, rare: 10, fine: 11, grey: 12 } as const;

export class Particles {
  private x = new Float32Array(N);
  private y = new Float32Array(N);
  private vx = new Float32Array(N);
  private vy = new Float32Array(N);
  private age = new Float32Array(N);
  private life = new Float32Array(N);
  private kind = new Uint8Array(N);
  private col = new Uint8Array(N);
  private next = 0;
  /** Number of live particles (diagnostics). */
  live = 0;

  spawn(kind: PKind, wx: number, wy: number, vx: number, vy: number, life: number, col: number): void {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.x[i] = wx;
    this.y[i] = wy;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.kind[i] = kind;
    this.col[i] = col;
  }

  update(dt: number): void {
    const k = dt / 1000;
    let live = 0;
    for (let i = 0; i < N; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= l) {
        this.life[i] = 0;
        continue;
      }
      live++;
      const kd = this.kind[i];
      if (kd === PK.Print) continue;
      this.x[i] += this.vx[i] * k;
      this.y[i] += this.vy[i] * k;
      if (kd === PK.Splash || kd === PK.Spark) this.vy[i] += 120 * k;
      else if (kd === PK.Dust) this.vx[i] *= 0.96;
    }
    this.live = live;
  }

  /** Footprints etc. that lie on the ground (drawn before the sorted pass). */
  drawGround(s: CanvasRenderingContext2D, ax0: number, ay0: number): void {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0 || this.kind[i] !== PK.Print) continue;
      const t = this.age[i] / this.life[i];
      s.globalAlpha = 0.55 * (1 - t);
      s.fillStyle = COLORS[this.col[i]];
      s.fillRect((this.x[i] - ax0) | 0, (this.y[i] - ay0) | 0, 2, 1);
    }
    s.globalAlpha = 1;
  }

  drawAir(s: CanvasRenderingContext2D, ax0: number, ay0: number): void {
    let last = -1;
    for (let i = 0; i < N; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const kd = this.kind[i];
      if (kd === PK.Print) continue;
      const t = this.age[i] / l;
      const c = this.col[i];
      if (c !== last) {
        s.fillStyle = COLORS[c];
        last = c;
      }
      const x = (this.x[i] - ax0) | 0;
      const y = (this.y[i] - ay0) | 0;
      switch (kd) {
        case PK.Dust: {
          s.globalAlpha = 0.6 * (1 - t);
          const sz = 2 + ((t * 2) | 0);
          s.fillRect(x, y, sz, sz);
          break;
        }
        case PK.Splash:
          s.globalAlpha = 0.9 * (1 - t);
          s.fillRect(x, y, 1, 1);
          break;
        case PK.Spark:
        case PK.Ember:
          s.globalAlpha = 1 - t;
          s.fillRect(x, y, 1, 1);
          break;
        case PK.Mote:
          s.globalAlpha = Math.sin(t * Math.PI) * 0.9;
          s.fillRect(x, y, 1, t < 0.5 ? 2 : 1);
          break;
        case PK.Steam: {
          s.globalAlpha = 0.5 * (1 - t) * Math.min(1, t * 5);
          const sz = 2 + ((t * 4) | 0);
          s.fillRect(x - (sz >> 1), y, sz, sz);
          break;
        }
      }
    }
    s.globalAlpha = 1;
  }
}
