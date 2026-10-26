/**
 * Landmark beacons: always-visible markers (a small icon, and a label when there is room) hovering above the roofline of the
 * places people look for: inns, markets, smithies, alchemists, shrines, training halls, halls, pagodas, hermitages and gates.
 * They are drawn in the device-resolution overlay, so scenery never covers them; they fade with the distance from the centre
 * of the screen and disappear when zoomed far out (the minimap takes over). "Show" in the World panel pulses one.
 *
 * The pure part (alpha, de-cluttering, pulse timing) is unit tested; the drawing needs a canvas.
 */
import { landmarksOf, type LandmarkDef, type LandmarkKind } from '@murim/shared';
import { makeCanvas } from '../art/canvas';
import { AHW, worldToTile, type FrameXf } from './iso';
import type { SpriteBank } from './sprites';
import type { WorldModel } from './world';

// ---- pure rules ---------------------------------------------------------------------------------------------------------

/** Below this zoom the beacons are gone; they are fully there from `BEACON_ZOOM_FULL`. */
export const BEACON_ZOOM_MIN = 0.55;
export const BEACON_ZOOM_FULL = 0.75;
/** Fully visible within this many tiles of the screen centre, gone beyond `BEACON_FAR`. */
export const BEACON_NEAR = 18;
export const BEACON_FAR = 44;
/** A pulse (from "Show") lasts this long. */
export const PULSE_MS = 5000;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Opacity of a beacon `dist` tiles from the camera centre at this zoom (0 = not drawn). */
export function beaconAlpha(dist: number, zoom: number): number {
  const z = clamp01((zoom - BEACON_ZOOM_MIN) / (BEACON_ZOOM_FULL - BEACON_ZOOM_MIN));
  const d = 1 - clamp01((dist - BEACON_NEAR) / (BEACON_FAR - BEACON_NEAR));
  return z * (d * d * (3 - 2 * d));
}

export interface PulseState {
  active: boolean;
  /** 0..1 through the pulse. */
  k: number;
}

export function pulseState(startedAt: number | undefined, now: number): PulseState {
  if (startedAt === undefined || now < startedAt || now - startedAt >= PULSE_MS) return { active: false, k: 1 };
  return { active: true, k: (now - startedAt) / PULSE_MS };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Greedy de-cluttering: items in priority order (first wins); returns which are kept. Forced items are always kept. */
export function declutter(items: readonly { rect: Rect; force?: boolean }[]): boolean[] {
  const kept: Rect[] = [];
  const out: boolean[] = [];
  for (const it of items) {
    const ok = !!it.force || !kept.some((k) => intersects(k, it.rect));
    if (ok) kept.push(it.rect);
    out.push(ok);
  }
  return out;
}

/** Drawing order / importance: lower first. */
export const BEACON_PRIORITY: Record<LandmarkKind, number> = { shrine: 0, hermitage: 1, pagoda: 2, dojo: 3, hall: 4, inn: 5, market: 6, smithy: 7, alchemy: 8, gate: 9 };

const KIND_COLOR: Record<LandmarkKind, string> = {
  inn: '#f0b650',
  market: '#e8d060',
  smithy: '#f08a48',
  alchemy: '#6ee09a',
  shrine: '#f06a5a',
  dojo: '#e89a58',
  hall: '#78b4e8',
  pagoda: '#b090f0',
  hermitage: '#86d8b0',
  gate: '#c0c8d8',
};

/** Height of the pin tip above the ground for a landmark without a building sprite (a gate). */
const GATE_PIN_PX = 30;

// ---- drawing -------------------------------------------------------------------------------------------------------------

type Glyph = (g: CanvasRenderingContext2D, r: number) => void;

/** Tiny line icons in a box of radius `r` around the origin (stroke and fill colours are set by the caller). */
const GLYPHS: Record<LandmarkKind, Glyph> = {
  inn(g, r) {
    // a cup with steam
    g.beginPath();
    g.moveTo(-r * 0.6, -r * 0.1);
    g.lineTo(r * 0.5, -r * 0.1);
    g.lineTo(r * 0.38, r * 0.62);
    g.lineTo(-r * 0.48, r * 0.62);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(r * 0.55, r * 0.22, r * 0.25, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.35);
    g.quadraticCurveTo(0, -r * 0.6, -r * 0.1, -r * 0.8);
    g.stroke();
  },
  market(g, r) {
    // a coin with a square hole
    g.beginPath();
    g.arc(0, 0, r * 0.68, 0, Math.PI * 2);
    g.stroke();
    g.strokeRect(-r * 0.26, -r * 0.26, r * 0.52, r * 0.52);
  },
  smithy(g, r) {
    // an anvil
    g.beginPath();
    g.moveTo(-r * 0.75, -r * 0.35);
    g.lineTo(r * 0.7, -r * 0.35);
    g.lineTo(r * 0.45, -r * 0.05);
    g.lineTo(r * 0.2, -r * 0.05);
    g.lineTo(r * 0.3, r * 0.45);
    g.lineTo(r * 0.6, r * 0.45);
    g.lineTo(r * 0.6, r * 0.7);
    g.lineTo(-r * 0.6, r * 0.7);
    g.lineTo(-r * 0.6, r * 0.45);
    g.lineTo(-r * 0.3, r * 0.45);
    g.lineTo(-r * 0.2, -r * 0.05);
    g.stroke();
  },
  alchemy(g, r) {
    // a flask
    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.7);
    g.lineTo(-r * 0.2, -r * 0.2);
    g.lineTo(-r * 0.7, r * 0.6);
    g.lineTo(r * 0.7, r * 0.6);
    g.lineTo(r * 0.2, -r * 0.2);
    g.lineTo(r * 0.2, -r * 0.7);
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.4, r * 0.2);
    g.lineTo(r * 0.4, r * 0.2);
    g.stroke();
  },
  shrine(g, r) {
    // a torii gate
    g.beginPath();
    g.moveTo(-r * 0.8, -r * 0.5);
    g.lineTo(r * 0.8, -r * 0.5);
    g.moveTo(-r * 0.55, -r * 0.15);
    g.lineTo(r * 0.55, -r * 0.15);
    g.moveTo(-r * 0.42, -r * 0.5);
    g.lineTo(-r * 0.42, r * 0.7);
    g.moveTo(r * 0.42, -r * 0.5);
    g.lineTo(r * 0.42, r * 0.7);
    g.stroke();
  },
  dojo(g, r) {
    // two crossed blades
    g.beginPath();
    g.moveTo(-r * 0.65, -r * 0.65);
    g.lineTo(r * 0.65, r * 0.65);
    g.moveTo(r * 0.65, -r * 0.65);
    g.lineTo(-r * 0.65, r * 0.65);
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.2, r * 0.4);
    g.lineTo(-r * 0.5, r * 0.1);
    g.moveTo(r * 0.2, r * 0.4);
    g.lineTo(r * 0.5, r * 0.1);
    g.stroke();
  },
  hall(g, r) {
    // a hanging banner
    g.beginPath();
    g.moveTo(-r * 0.5, -r * 0.7);
    g.lineTo(r * 0.5, -r * 0.7);
    g.lineTo(r * 0.5, r * 0.7);
    g.lineTo(0, r * 0.38);
    g.lineTo(-r * 0.5, r * 0.7);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.3);
    g.lineTo(r * 0.2, -r * 0.3);
    g.stroke();
  },
  pagoda(g, r) {
    // three stacked roofs
    for (let i = 0; i < 3; i++) {
      const y = -r * 0.5 + i * r * 0.5;
      const w = r * (0.4 + i * 0.28);
      g.beginPath();
      g.moveTo(-w, y + r * 0.22);
      g.lineTo(0, y - r * 0.22);
      g.lineTo(w, y + r * 0.22);
      g.stroke();
    }
  },
  hermitage(g, r) {
    // a pine
    g.beginPath();
    g.moveTo(0, -r * 0.8);
    g.lineTo(-r * 0.4, -r * 0.2);
    g.lineTo(-r * 0.2, -r * 0.2);
    g.lineTo(-r * 0.6, r * 0.35);
    g.lineTo(r * 0.6, r * 0.35);
    g.lineTo(r * 0.2, -r * 0.2);
    g.lineTo(r * 0.4, -r * 0.2);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(0, r * 0.35);
    g.lineTo(0, r * 0.75);
    g.stroke();
  },
  gate(g, r) {
    // an arch in a wall
    g.beginPath();
    g.moveTo(-r * 0.7, r * 0.7);
    g.lineTo(-r * 0.7, -r * 0.4);
    g.lineTo(r * 0.7, -r * 0.4);
    g.lineTo(r * 0.7, r * 0.7);
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.3, r * 0.7);
    g.lineTo(-r * 0.3, r * 0.1);
    g.arc(0, r * 0.1, r * 0.3, Math.PI, 0);
    g.lineTo(r * 0.3, r * 0.7);
    g.stroke();
  },
};

const FONT = 'Georgia, "Times New Roman", serif';

/** The pin: a dark disc with a coloured rim and the icon, and a pointer below it. `r` is the disc radius in device px. */
function pinCanvas(kind: LandmarkKind, r: number): HTMLCanvasElement {
  const tail = Math.round(r * 0.7);
  const pad = 3;
  const w = Math.ceil(r * 2 + pad * 2);
  const h = Math.ceil(r * 2 + tail + pad * 2);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const cx = w / 2;
  const cy = pad + r;
  const color = KIND_COLOR[kind];
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // pointer
  g.fillStyle = 'rgba(18,12,24,0.9)';
  g.beginPath();
  g.moveTo(cx - r * 0.42, cy + r * 0.8);
  g.lineTo(cx, cy + r + tail);
  g.lineTo(cx + r * 0.42, cy + r * 0.8);
  g.closePath();
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, r * 0.1);
  g.stroke();
  // disc
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(18,12,24,0.9)';
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.16);
  g.strokeStyle = color;
  g.stroke();
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.3, r * 0.15);
  GLYPHS[kind](g, r * 0.78);
  g.restore();
  return c;
}

function labelCanvas(text: string, size: number): HTMLCanvasElement {
  const probe = makeCanvas(8, 8).getContext('2d')!;
  probe.font = `600 ${size}px ${FONT}`;
  const w = Math.ceil(probe.measureText(text).width + 8);
  const h = Math.ceil(size + 6);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.font = `600 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, Math.round(size * 0.26));
  g.strokeStyle = 'rgba(16,10,24,0.9)';
  g.strokeText(text, w / 2, size);
  g.fillStyle = '#f6efd8';
  g.fillText(text, w / 2, size);
  return c;
}

export interface BeaconFrame {
  bank: SpriteBank;
  world: WorldModel;
  xf: FrameXf;
  /** Camera centre in world px. */
  camX: number;
  camY: number;
  zoom: number;
  dpr: number;
  now: number;
}

interface Prepared {
  lm: LandmarkDef;
  /** Device px of the pin tip (the point just above the roof). */
  x: number;
  y: number;
  alpha: number;
  pulse: PulseState;
  rect: Rect;
  priority: number;
}

export class Beacons {
  private list: LandmarkDef[] = [];
  readonly byId = new Map<string, LandmarkDef>();
  private pulses = new Map<string, number>();
  private pins = new Map<string, HTMLCanvasElement>();
  private labels = new Map<string, HTMLCanvasElement>();
  private tops = new WeakMap<object, number>();
  private prepared: Prepared[] = [];
  private infoById = new Map<number, WorldModel['buildings'][number]>();

  setWorld(world: WorldModel): void {
    this.list = landmarksOf({ settlements: world.settlements, buildings: world.payload.buildings, roads: world.payload.roads });
    this.byId.clear();
    for (const l of this.list) this.byId.set(l.id, l);
    this.infoById.clear();
    for (const b of world.buildings) this.infoById.set(b.def.id, b);
    this.pulses.clear();
  }

  get landmarks(): readonly LandmarkDef[] {
    return this.list;
  }

  /** Make a landmark's beacon pulse for a few seconds, visible whatever the distance or zoom. */
  pulse(id: string, now: number): boolean {
    if (!this.byId.has(id)) return false;
    this.pulses.set(id, now);
    return true;
  }

  /** Scene-px height of the roof peak above the footprint's top vertex (cached per sprite). */
  private roofTop(spr: { spr: { spans?: { min: Int16Array; max: Int16Array }; h: number }; oy: number }): number {
    let v = this.tops.get(spr);
    if (v === undefined) {
      let row = 0;
      const sp = spr.spr.spans;
      if (sp) while (row < spr.spr.h - 1 && sp.min[row] > sp.max[row]) row++;
      v = spr.oy - row;
      this.tops.set(spr, v);
    }
    return v;
  }

  /** Draw the beacons into the overlay canvas (device px). */
  draw(ctx: CanvasRenderingContext2D, f: BeaconFrame): void {
    const { world, xf, zoom, dpr, now } = f;
    const P = xf.P;
    const ax0 = xf.camAX - xf.cx;
    const ay0 = xf.camAY - xf.cy;
    const cam = worldToTile(f.camX, f.camY);
    const prep = this.prepared;
    prep.length = 0;
    const zs = Math.max(0.9, Math.min(1.2, 0.8 + zoom * 0.22));
    const scale = dpr * zs;
    const r = Math.round(10 * scale);
    const labelSize = Math.round(11 * scale);
    for (const lm of this.list) {
      const pulse = pulseState(this.pulses.get(lm.id), now);
      const dist = Math.hypot(lm.x - cam.x, lm.y - cam.y);
      let alpha = beaconAlpha(dist, zoom);
      if (pulse.active) alpha = 1;
      if (alpha < 0.03) continue;
      let px: number;
      let py: number;
      if (lm.building >= 0) {
        const info = this.infoById.get(lm.building);
        if (!info) continue;
        const d = info.def;
        const st = world.status.get(info.sid);
        const fallen = st?.status === 'fallen' || world.settlementById.get(info.sid)?.kind === 'ruin';
        const bs = f.bank.getBuilding(info, fallen ? null : (st?.controller ?? null), fallen);
        const vx = (d.x - d.y) * AHW - ax0 + ((d.w - d.d) / 2) * AHW;
        const vy = (d.x + d.y) * 8 - 8 - ay0;
        px = vx * P;
        py = (vy - this.roofTop(bs) - 3) * P;
      } else {
        px = ((lm.x - lm.y) * AHW - ax0) * P;
        py = ((lm.x + lm.y) * 8 - ay0 - GATE_PIN_PX) * P;
      }
      const label = this.labelFor(lm.label, labelSize);
      const w = Math.max(r * 2 + 6, label.width);
      const h = r * 2 + Math.round(r * 0.7) + 6 + label.height;
      const rect: Rect = { x: px - w / 2, y: py - h, w, h };
      if (rect.x > ctx.canvas.width || rect.x + rect.w < 0 || rect.y > ctx.canvas.height || rect.y + rect.h < 0) continue;
      prep.push({ lm, x: px, y: py, alpha, pulse, rect, priority: pulse.active ? -1 : BEACON_PRIORITY[lm.kind] + dist * 0.01 });
    }
    if (prep.length === 0) return;
    prep.sort((a, b) => a.priority - b.priority);
    const keep = declutter(prep.map((p) => ({ rect: p.rect, force: p.pulse.active })));
    for (let i = 0; i < prep.length; i++) {
      if (keep[i]) this.drawOne(ctx, prep[i], r, labelSize, zoom, now);
    }
    ctx.globalAlpha = 1;
  }

  private pinFor(kind: LandmarkKind, r: number): HTMLCanvasElement {
    const key = `${kind}|${r}`;
    let c = this.pins.get(key);
    if (!c) {
      c = pinCanvas(kind, r);
      this.pins.set(key, c);
    }
    return c;
  }

  labelFor(text: string, size: number): HTMLCanvasElement {
    const key = `${text}|${size}`;
    let c = this.labels.get(key);
    if (!c) {
      if (this.labels.size > 200) this.labels.clear();
      c = labelCanvas(text, size);
      this.labels.set(key, c);
    }
    return c;
  }

  private drawOne(ctx: CanvasRenderingContext2D, p: Prepared, r: number, labelSize: number, zoom: number, now: number): void {
    const pin = this.pinFor(p.lm.kind, r);
    // the pin's pointer touches (x, y); the disc sits above it
    const pop = p.pulse.active ? 1 + 0.22 * Math.abs(Math.sin(now / 160)) : 1;
    const w = pin.width * pop;
    const h = pin.height * pop;
    const x = p.x - w / 2;
    const y = p.y - h + 3 * pop;
    if (p.pulse.active) {
      // expanding rings around the disc
      const cx = p.x;
      const cy = y + (3 + r) * pop;
      const color = KIND_COLOR[p.lm.kind];
      for (let k = 0; k < 2; k++) {
        const t = (((now / 900) + k * 0.5) % 1);
        ctx.globalAlpha = (1 - t) * (1 - p.pulse.k * 0.6);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, r * 0.18);
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.1 + t * 2.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const fade = p.pulse.active ? Math.min(1, (1 - p.pulse.k) * 6) : 1;
    ctx.globalAlpha = p.alpha * (p.pulse.active ? Math.max(fade, 0.9) : 1);
    ctx.drawImage(pin, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    // label above the disc once there is room for it (zoomed in enough, or pulsing)
    if (zoom >= 0.9 || p.pulse.active) {
      const lab = this.labelFor(p.lm.label, labelSize);
      ctx.drawImage(lab, Math.round(p.x - lab.width / 2), Math.round(y - lab.height + 2));
    }
  }
}
