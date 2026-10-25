/**
 * Weather: cheap particle systems (rain, snow, storm) and layered overlays (fog, cloud shadows), cross-faded when
 * the climate band's weather changes. All drawing happens in the low-res scene buffer; no per-frame allocation.
 */
import type { WeatherKind } from '@murim/shared';
import { makeCanvas } from '../art/canvas';

const MAX_DROPS = 2600;

export interface WeatherDraw {
  /** 0..1 darkening multiplier applied by the caller (cloudy/storm/rain/fog). */
  dim: number;
  /** Wind strength 0..1 (tree sway). */
  wind: number;
  /** Lightning flash alpha 0..1. */
  flash: number;
}

const KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

export class Weather {
  /** Eased intensity of each kind (0..1). */
  private k = new Float32Array(KINDS.length);
  private target = new Float32Array(KINDS.length);
  private px = new Float32Array(MAX_DROPS);
  private py = new Float32Array(MAX_DROPS);
  private pv = new Float32Array(MAX_DROPS);
  private pg = new Float32Array(MAX_DROPS);
  private ps = new Float32Array(MAX_DROPS);
  private inited = false;
  private cap = 900;
  private fogTex: HTMLCanvasElement;
  private cloudTex: HTMLCanvasElement;
  private lightningAt = 0;
  private nextLightning = 0;
  private flashes: number[] = [];
  readonly out: WeatherDraw = { dim: 1, wind: 0.2, flash: 0 };
  private bw = 0;
  private bh = 0;

  constructor() {
    this.fogTex = makeSoftBlob(160, 80, 'rgba(214,222,226,');
    this.cloudTex = makeSoftBlob(200, 100, 'rgba(18,24,40,');
    this.target[0] = 1;
    this.k[0] = 1;
  }

  /** Set the target weather for the camera's climate band. */
  setTarget(kind: WeatherKind, instant = false): void {
    for (let i = 0; i < KINDS.length; i++) this.target[i] = KINDS[i] === kind ? 1 : 0;
    if (instant) for (let i = 0; i < KINDS.length; i++) this.k[i] = this.target[i];
  }

  private idx(kind: WeatherKind): number {
    return KINDS.indexOf(kind);
  }

  update(dt: number, now: number, bw: number, bh: number): void {
    this.cap = Math.min(MAX_DROPS, Math.max(300, Math.floor((bw * bh) / 85)));
    const rate = dt / 3500;
    for (let i = 0; i < KINDS.length; i++) {
      const d = this.target[i] - this.k[i];
      this.k[i] += Math.max(-rate, Math.min(rate, d));
    }
    if (!this.inited || bw !== this.bw || bh !== this.bh) {
      this.bw = bw;
      this.bh = bh;
      for (let i = 0; i < MAX_DROPS; i++) {
        this.px[i] = Math.random() * bw;
        this.py[i] = Math.random() * bh;
        this.pv[i] = 0.6 + Math.random() * 0.8;
        this.pg[i] = Math.random() * bh;
        this.ps[i] = Math.random();
      }
      this.inited = true;
    }
    const rain = this.k[this.idx('rain')];
    const storm = this.k[this.idx('storm')];
    const snow = this.k[this.idx('snow')];
    const fog = this.k[this.idx('fog')];
    const cloudy = this.k[this.idx('cloudy')];
    const wet = Math.max(rain, storm);
    const o = this.out;
    o.dim = 1 - cloudy * 0.14 - rain * 0.2 - storm * 0.38 - fog * 0.1 - snow * 0.06;
    o.wind = 0.2 + storm * 0.8 + rain * 0.25 + cloudy * 0.1;
    // lightning
    o.flash = 0;
    if (storm > 0.5) {
      if (now > this.nextLightning) {
        this.nextLightning = now + 3500 + Math.random() * 7000;
        this.lightningAt = now;
        this.flashes = [0, 90 + Math.random() * 60];
      }
      for (const t of this.flashes) {
        const age = now - this.lightningAt - t;
        if (age >= 0 && age < 260) o.flash = Math.max(o.flash, (1 - age / 260) * (t === 0 ? 0.75 : 0.5) * storm);
      }
    }
    // advance particles
    const step = dt / 16.667;
    const nWet = Math.floor(this.cap * Math.min(1, wet) * (storm > rain ? 1 : 0.55));
    const nSnow = Math.floor(this.cap * 0.45 * snow);
    const slant = storm > rain ? 0.62 : 0.28;
    for (let i = 0; i < Math.max(nWet, nSnow); i++) {
      if (i < nWet) {
        this.py[i] += (4.2 + 3.2 * this.pv[i]) * step * (storm > rain ? 1.3 : 1);
        this.px[i] += slant * 4 * step * this.pv[i] * 0.5;
      } else {
        this.py[i] += (0.55 + this.pv[i] * 0.45) * step;
        this.px[i] += Math.sin(now / 900 + this.ps[i] * 20) * 0.35 * step + 0.12 * step;
      }
      if (this.py[i] > bh + 6 || this.px[i] > bw + 6) {
        this.py[i] = -6 - Math.random() * 20;
        this.px[i] = Math.random() * (bw + 40) - 20;
        this.pg[i] = Math.random() * bh;
      }
    }
  }

  /** Draw weather particles/overlays onto the scene buffer. */
  draw(s: CanvasRenderingContext2D, now: number, bw: number, bh: number): void {
    const rain = this.k[this.idx('rain')];
    const storm = this.k[this.idx('storm')];
    const snow = this.k[this.idx('snow')];
    const fog = this.k[this.idx('fog')];
    const cloudy = this.k[this.idx('cloudy')];
    const wet = Math.max(rain, storm);
    if (cloudy > 0.02 || wet > 0.05) {
      // drifting cloud shadows
      s.globalAlpha = Math.min(1, cloudy + wet * 0.6) * 0.16;
      for (let i = 0; i < 7; i++) {
        const sp = 0.008 + (i % 3) * 0.004;
        const x = (((now * sp + i * 191) % (bw + 260)) + (bw + 260)) % (bw + 260) - 200;
        const y = ((i * 97) % Math.max(60, bh)) - 20;
        s.drawImage(this.cloudTex, x, y, 200 + (i % 3) * 60, 100 + (i % 2) * 40);
      }
      s.globalAlpha = 1;
    }
    if (wet > 0.03) {
      const n = Math.floor(this.cap * Math.min(1, wet) * (storm > rain ? 1 : 0.55));
      const col = storm > rain ? 'rgba(200,214,238,0.8)' : 'rgba(196,212,240,0.68)';
      s.fillStyle = col;
      const long = storm > rain ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const x = this.px[i] | 0;
        const y = this.py[i] | 0;
        s.fillRect(x, y, 1, long);
        s.fillRect(x + 1, y + long, 1, long - (storm > rain ? 0 : 1));
        // splash when the drop reaches its ground line
        if (this.py[i] >= this.pg[i] && this.py[i] < this.pg[i] + 3 && this.pg[i] > 8) {
          s.fillStyle = 'rgba(210,226,246,0.55)';
          s.fillRect(x - 1, this.pg[i] | 0, 3, 1);
          s.fillStyle = col;
        }
      }
    }
    if (snow > 0.03) {
      const n = Math.floor(this.cap * 0.45 * snow);
      s.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < n; i++) {
        const big = this.ps[i] > 0.7;
        s.fillRect(this.px[i] | 0, this.py[i] | 0, big ? 2 : 1, big ? 2 : 1);
      }
      s.fillStyle = `rgba(220,232,250,${0.05 * snow})`;
      s.fillRect(0, 0, bw, bh);
    }
    if (fog > 0.02) {
      s.globalAlpha = fog * 0.5;
      for (let i = 0; i < 9; i++) {
        const sp = 0.004 + (i % 4) * 0.002;
        const x = ((((now * sp * (i % 2 ? 1 : -1) + i * 113) % (bw + 320)) + (bw + 320)) % (bw + 320)) - 200;
        const y = ((i * 71) % Math.max(60, bh)) - 30;
        s.drawImage(this.fogTex, x, y, 240 + (i % 3) * 60, 120);
      }
      s.globalAlpha = fog * 0.26;
      s.fillStyle = 'rgb(206,214,218)';
      s.fillRect(0, 0, bw, bh);
      s.globalAlpha = 1;
    }
    if (this.out.flash > 0.01) {
      s.globalAlpha = this.out.flash;
      s.fillStyle = 'rgb(236,240,255)';
      s.fillRect(0, 0, bw, bh);
      s.globalAlpha = 1;
    }
  }
}

function makeSoftBlob(w: number, h: number, rgbaPrefix: string): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = w * (0.2 + 0.6 * ((i * 37) % 10) / 10);
    const y = h * (0.3 + 0.4 * ((i * 53) % 10) / 10);
    const r = (h * (0.35 + 0.25 * ((i * 17) % 10) / 10)) | 0;
    const grd = g.createRadialGradient(x, y, 0, x, y, r * 1.8);
    grd.addColorStop(0, rgbaPrefix + '0.55)');
    grd.addColorStop(1, rgbaPrefix + '0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
  return c;
}
