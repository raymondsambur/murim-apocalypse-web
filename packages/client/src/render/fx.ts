/**
 * Effects: floating combat text (drawn at device resolution), and world effects drawn into the pixel scene
 * (slash arcs, hit sparks, level-up pillar, breakthrough lightning, soul wisps, loot sparkle, heal motes, learn glow,
 * gather puffs, purify rings). Pooled; no per-frame allocation in steady state.
 */
import { getSkill, MONSTER_SKILLS, type CombatEvent, type FxKind, type StatusKind } from '@murim/shared';
import { makeCanvas } from '../art/canvas';

export interface Floater {
  active: boolean;
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  t0: number;
  life: number;
  crit: boolean;
  dx: number;
  rise: number;
}

export interface Effect {
  active: boolean;
  kind: string;
  id: number;
  x: number;
  y: number;
  t0: number;
  dur: number;
  seed: number;
  color: string;
  /** Direction of a slash (screen px, unit-ish). */
  dirx: number;
  diry: number;
}

const SCHOOL_COLOR: Record<string, string> = {
  sword: '#d6ecff',
  blade: '#ffa882',
  spear: '#ecf4c8',
  staff: '#ecd8a0',
  fist: '#fff2c4',
  internal: '#bde9ff',
  medicine: '#a4ffc8',
  poison: '#a8ff88',
  movement: '#d4dcff',
};

const STATUS_STYLE: Record<StatusKind, { text: string; color: string }> = {
  bleed: { text: 'Bleed', color: '#ff7a7a' },
  poison: { text: 'Poison', color: '#8ee66a' },
  stun: { text: 'Stun!', color: '#ffe27a' },
  slow: { text: 'Slow', color: '#9ac8ff' },
  guard: { text: 'Guard', color: '#9ac8ff' },
  buffAtk: { text: 'Power up', color: '#ffb07a' },
  buffDef: { text: 'Defense up', color: '#9ac8ff' },
  rot: { text: 'Rot', color: '#c58aff' },
};

const DOT_COLOR: Record<string, string> = { bleed: '#ff6a6a', poison: '#7ed84f', rot: '#b87aff', slow: '#9ac8ff' };

function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class Fx {
  readonly floaters: Floater[] = [];
  readonly effects: Effect[] = [];
  /** Full-screen flash from breakthroughs (0..1). */
  flash = 0;
  private flashT0 = -1e9;
  private pillar: HTMLCanvasElement;
  private halo: HTMLCanvasElement;
  private seedCounter = 1;

  constructor() {
    for (let i = 0; i < 96; i++) this.floaters.push({ active: false, id: 0, x: 0, y: 0, text: '', color: '#fff', size: 12, t0: 0, life: 900, crit: false, dx: 0, rise: 34 });
    for (let i = 0; i < 80; i++) this.effects.push({ active: false, kind: '', id: 0, x: 0, y: 0, t0: 0, dur: 1000, seed: 0, color: '#fff', dirx: 1, diry: 0 });
    this.pillar = makeCanvas(24, 128);
    const g = this.pillar.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,230,140,0)');
    grd.addColorStop(0.5, 'rgba(255,224,130,0.55)');
    grd.addColorStop(1, 'rgba(255,248,210,0.95)');
    g.fillStyle = grd;
    g.fillRect(4, 0, 16, 128);
    const grd2 = g.createLinearGradient(0, 0, 0, 128);
    grd2.addColorStop(0, 'rgba(255,255,255,0)');
    grd2.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = grd2;
    g.fillRect(9, 0, 6, 128);
    this.halo = makeCanvas(64, 64);
    const h = this.halo.getContext('2d')!;
    const rg = h.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,240,180,0.9)');
    rg.addColorStop(1, 'rgba(255,220,120,0)');
    h.fillStyle = rg;
    h.fillRect(0, 0, 64, 64);
  }

  private slot<T extends { active: boolean }>(arr: T[]): T {
    for (const a of arr) if (!a.active) return a;
    // recycle the first (oldest) one
    return arr[0];
  }

  addFloater(id: number, x: number, y: number, text: string, color: string, size: number, now: number, life = 950, crit = false, rise = 34): void {
    const f = this.slot(this.floaters);
    f.active = true;
    f.id = id;
    f.x = x;
    f.y = y;
    f.text = text;
    f.color = color;
    f.size = size;
    f.t0 = now;
    f.life = life;
    f.crit = crit;
    f.dx = (hash(this.seedCounter++) - 0.5) * 22;
    f.rise = rise;
  }

  addEffect(kind: string, id: number, x: number, y: number, now: number, dur: number, color = '#fff', dirx = 1, diry = 0): void {
    const e = this.slot(this.effects);
    e.active = true;
    e.kind = kind;
    e.id = id;
    e.x = x;
    e.y = y;
    e.t0 = now;
    e.dur = dur;
    e.seed = this.seedCounter++;
    e.color = color;
    e.dirx = dirx;
    e.diry = diry;
  }

  // ---- event ingestion ---------------------------------------------------------------------------

  /** Convert a combat event into floaters and effects. `pos(id)` returns the tile position of an entity or null. */
  combat(ev: CombatEvent, now: number, pos: (id: number) => { x: number; y: number } | null, selfId: number | null, onHit: (attacker: number, defender: number, crit: boolean) => void): void {
    switch (ev.k) {
      case 'hit': {
        const p = pos(ev.d);
        const sPos = pos(ev.s);
        if (!p) {
          onHit(ev.s, ev.d, !!ev.c);
          return;
        }
        const school = (getSkill(ev.sk)?.school ?? MONSTER_SKILLS[ev.sk]?.school ?? '') as string;
        const col = SCHOOL_COLOR[school] ?? '#ffe0d0';
        // direction from attacker to defender in screen space
        let dx = 1;
        let dy = 0.4;
        if (sPos) {
          const sx = (p.x - p.y - (sPos.x - sPos.y)) * 32;
          const sy = (p.x + p.y - (sPos.x + sPos.y)) * 16;
          const l = Math.hypot(sx, sy) || 1;
          dx = sx / l;
          dy = sy / l;
        }
        const kind = school === 'spear' ? 'thrust' : school === 'fist' ? 'impact' : school === 'poison' ? 'poisoncloud' : school === 'internal' ? 'qiburst' : 'slash';
        this.addEffect(kind, ev.d, p.x, p.y, now, ev.c ? 360 : 280, col, dx, dy);
        this.addEffect('spark', ev.d, p.x, p.y, now, 260, ev.c ? '#ffe27a' : '#ffffff');
        const toSelf = selfId !== null && ev.d === selfId;
        this.addFloater(ev.d, p.x, p.y, String(ev.a), ev.c ? '#ffd84a' : toSelf ? '#ff9c8a' : '#ffffff', ev.c ? 20 : 14, now, ev.c ? 1150 : 900, !!ev.c, ev.c ? 44 : 34);
        onHit(ev.s, ev.d, !!ev.c);
        break;
      }
      case 'miss': {
        const p = pos(ev.d);
        if (p) this.addFloater(ev.d, p.x, p.y, 'Miss', '#b6bcc6', 12, now, 800);
        onHit(ev.s, -1, false);
        break;
      }
      case 'heal': {
        const p = pos(ev.d);
        if (p) {
          this.addFloater(ev.d, p.x, p.y, `+${ev.a}`, '#7cf09a', 14, now, 1000);
          this.addEffect('heal', ev.d, p.x, p.y, now, 900);
        }
        break;
      }
      case 'dot': {
        const p = pos(ev.d);
        if (p) this.addFloater(ev.d, p.x, p.y, String(ev.a), DOT_COLOR[ev.st] ?? '#ffb0b0', 11, now, 750, false, 26);
        break;
      }
      case 'status': {
        const p = pos(ev.d);
        const st = STATUS_STYLE[ev.st];
        if (p && st) this.addFloater(ev.d, p.x, p.y, st.text, st.color, 11, now, 1000, false, 40);
        break;
      }
      case 'use': {
        const p = pos(ev.s);
        const name = getSkill(ev.sk)?.name ?? MONSTER_SKILLS[ev.sk]?.name;
        if (p && name) this.addFloater(ev.s, p.x, p.y, name, '#ffe9a8', 11, now, 900, false, 46);
        break;
      }
      case 'item': {
        const p = pos(ev.s);
        if (p) this.addFloater(ev.s, p.x, p.y, 'Item', '#bfe8ff', 11, now, 800, false, 40);
        break;
      }
      case 'guard': {
        const p = pos(ev.s);
        if (p) this.addFloater(ev.s, p.x, p.y, 'Guard', '#9ac8ff', 11, now, 800, false, 36);
        break;
      }
      case 'flee': {
        const p = pos(ev.s);
        if (p) this.addFloater(ev.s, p.x, p.y, ev.ok ? 'Fled!' : 'Failed', ev.ok ? '#d6e2ff' : '#ff9a8a', 12, now, 900);
        break;
      }
      case 'stun': {
        const p = pos(ev.s);
        if (p) this.addFloater(ev.s, p.x, p.y, 'Stunned', '#ffe27a', 11, now, 900, false, 40);
        break;
      }
      case 'down': {
        const p = pos(ev.d);
        if (p) this.addEffect('death', ev.d, p.x, p.y, now, 1900);
        break;
      }
    }
  }

  /** Non-combat effect by kind. */
  fx(kind: FxKind, id: number, x: number, y: number, now: number, text?: string): void {
    switch (kind) {
      case 'levelup':
        this.addEffect('levelup', id, x, y, now, 2000);
        this.addFloater(id, x, y, text || 'Level Up!', '#ffe27a', 22, now, 2000, true, 60);
        break;
      case 'breakthrough':
        this.addEffect('breakthrough', id, x, y, now, 1900);
        this.addFloater(id, x, y, text || 'Breakthrough!', '#d6c4ff', 22, now, 2200, true, 64);
        this.flash = 0.55;
        this.flashT0 = now;
        break;
      case 'death':
        this.addEffect('death', id, x, y, now, 2200);
        break;
      case 'loot':
        this.addEffect('loot', id, x, y, now, 1500);
        if (text) this.addFloater(id, x, y, text, '#ffe9a8', 12, now, 1200);
        break;
      case 'heal':
        this.addEffect('heal', id, x, y, now, 1500);
        break;
      case 'learn':
        this.addEffect('learn', id, x, y, now, 1900);
        if (text) this.addFloater(id, x, y, text, '#fff0b8', 13, now, 1600, false, 50);
        break;
      case 'gather':
        this.addEffect('gather', id, x, y, now, 900);
        if (text) this.addFloater(id, x, y, text, '#d8f0c8', 12, now, 1000);
        break;
      case 'purify':
        this.addEffect('purify', id, x, y, now, 2400);
        if (text) this.addFloater(id, x, y, text, '#ffe9b0', 14, now, 1500, false, 50);
        break;
    }
  }

  update(now: number): void {
    for (const f of this.floaters) if (f.active && now - f.t0 > f.life) f.active = false;
    for (const e of this.effects) if (e.active && now - e.t0 > e.dur) e.active = false;
    if (this.flash > 0) this.flash = Math.max(0, 0.55 * (1 - (now - this.flashT0) / 450));
  }

  hasActive(): boolean {
    for (const e of this.effects) if (e.active) return true;
    return false;
  }

  // ---- drawing: world effects into the scene buffer --------------------------------------------------

  /**
   * Draw effects. `anchor(id, fallbackX, fallbackY, out)` gives scene px of the entity's feet.
   */
  drawWorld(s: CanvasRenderingContext2D, now: number, anchor: (e: Effect, out: { x: number; y: number }) => void): void {
    const o = { x: 0, y: 0 };
    for (const e of this.effects) {
      if (!e.active) continue;
      const t = (now - e.t0) / e.dur;
      if (t < 0 || t > 1) continue;
      anchor(e, o);
      const px = Math.round(o.x);
      const py = Math.round(o.y);
      switch (e.kind) {
        case 'slash':
          this.drawSlash(s, px, py - 9, e, t);
          break;
        case 'thrust':
          this.drawThrust(s, px, py - 9, e, t);
          break;
        case 'impact':
          this.drawImpact(s, px, py - 9, e, t);
          break;
        case 'poisoncloud':
          this.drawPuffs(s, px, py - 8, e, t, 'rgba(120,230,90,', 6, 8);
          break;
        case 'qiburst':
          ring(s, px, py - 7, 3 + t * 12, (3 + t * 12) / 2, e.color, 1 - t);
          ring(s, px, py - 7, 2 + t * 7, (2 + t * 7) / 2, '#ffffff', 1 - t);
          break;
        case 'spark':
          this.drawSpark(s, px, py - 9, e, t);
          break;
        case 'levelup':
          this.drawLevelUp(s, px, py, e, t);
          break;
        case 'breakthrough':
          this.drawBreakthrough(s, px, py, e, t, now);
          break;
        case 'death':
          this.drawWisps(s, px, py, e, t);
          break;
        case 'loot':
          this.drawLoot(s, px, py, e, t);
          break;
        case 'heal':
          this.drawHeal(s, px, py, e, t);
          break;
        case 'learn':
          this.drawLearn(s, px, py, e, t);
          break;
        case 'gather':
          this.drawPuffs(s, px, py - 4, e, t, 'rgba(196,180,130,', 7, 8);
          break;
        case 'purify':
          this.drawPurify(s, px, py, e, t);
          break;
      }
    }
  }

  private drawSlash(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    const a0 = Math.atan2(e.diry, e.dirx);
    const r = 8 + t * 2;
    const alpha = Math.min(1, (1 - t) * 1.6);
    s.fillStyle = e.color;
    s.globalAlpha = alpha;
    const sweep = Math.min(1, t * 3.5);
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      if (u > sweep) break;
      const a = a0 + Math.PI + (u - 0.5) * 2.3;
      const px = x + Math.cos(a) * r * 0.8 + e.dirx * 4;
      const py2 = y + Math.sin(a) * r * 0.55 + e.diry * 2;
      s.fillRect(px | 0, py2 | 0, 2, 1);
      if (u > 0.2 && u < 0.8) s.fillRect((px - Math.cos(a) * 2) | 0, (py2 - Math.sin(a)) | 0, 1, 1);
    }
    s.globalAlpha = 1;
  }

  private drawThrust(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    s.globalAlpha = (1 - t) * 1.4 > 1 ? 1 : (1 - t) * 1.4;
    s.fillStyle = e.color;
    const len = 11 * Math.min(1, t * 4);
    for (let i = 0; i < len; i++) s.fillRect((x - e.dirx * (12 - i)) | 0, (y - e.diry * (12 - i) * 0.6) | 0, 2, 1);
    s.globalAlpha = 1;
  }

  private drawImpact(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    s.globalAlpha = 1 - t;
    s.fillStyle = e.color;
    const r = 3 + t * 9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      s.fillRect((x + Math.cos(a) * r) | 0, (y + Math.sin(a) * r * 0.65) | 0, 2, 2);
    }
    s.fillStyle = '#ffffff';
    s.fillRect(x - 1, y - 1, 3, 3);
    s.globalAlpha = 1;
  }

  private drawSpark(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    s.globalAlpha = 1 - t;
    s.fillStyle = e.color;
    for (let i = 0; i < 6; i++) {
      const a = hash(e.seed * 7 + i) * Math.PI * 2;
      const r = 3 + t * (7 + hash(e.seed + i * 3) * 6);
      s.fillRect((x + Math.cos(a) * r) | 0, (y + Math.sin(a) * r * 0.8 - t * 3) | 0, 1, 1);
    }
    s.globalAlpha = 1;
  }

  private drawPuffs(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number, rgbPrefix: string, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(e.seed + i) * 0.8;
      const r = 2 + t * spread * (0.6 + hash(e.seed + i * 5) * 0.6);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.55 - t * 8;
      s.fillStyle = `${rgbPrefix}${(0.55 * (1 - t)).toFixed(2)})`;
      const sz = 2 + (1 - t) * 3;
      s.fillRect((px - sz / 2) | 0, (py - sz / 2) | 0, sz | 0, (sz * 0.8) | 0);
    }
  }

  private drawLevelUp(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    const grow = Math.min(1, t * 6);
    const fade = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = fade * 0.9;
    const h = 66 * grow;
    s.drawImage(this.pillar, 0, 0, 24, 128, x - 12 + (1 - grow) * 6, y - h, 24 - (1 - grow) * 12, h + 2);
    s.globalAlpha = fade * 0.55;
    s.drawImage(this.halo, x - 22, y - 12, 44, 22);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 3; k++) {
      const tt = (t * 1.5 - k * 0.18) % 1.2;
      if (tt <= 0 || tt > 1) continue;
      ring(s, x, y, 5 + tt * 26, (5 + tt * 26) / 2, '#ffe27a', (1 - tt) * fade);
    }
    s.fillStyle = '#fff0b0';
    for (let i = 0; i < 18; i++) {
      const ph = (t * 1.3 + i * 0.137) % 1;
      const px = x + Math.sin(i * 12.97) * (6 + ph * 8);
      const py = y - ph * 56;
      s.globalAlpha = (1 - ph) * fade;
      s.fillRect(px | 0, py | 0, 1, ph < 0.5 ? 2 : 1);
    }
    s.globalAlpha = 1;
  }

  private drawBreakthrough(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number, now: number): void {
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    // shockwave
    const tw = Math.min(1, t * 1.8);
    ring(s, x, y, 6 + tw * 52, (6 + tw * 52) / 2, '#cbb8ff', (1 - tw) * 0.9);
    ring(s, x, y, 3 + tw * 34, (3 + tw * 34) / 2, '#ffffff', (1 - tw) * 0.8);
    if (t < 0.55) {
      const seed = Math.floor(now / 55) + e.seed * 13;
      s.globalCompositeOperation = 'lighter';
      for (let b = 0; b < 5; b++) {
        let bx = x + (hash(seed + b * 17) - 0.5) * 36;
        let by = y - 150;
        s.fillStyle = b % 2 ? 'rgba(200,180,255,0.95)' : 'rgba(255,255,255,0.95)';
        const steps = 14;
        for (let i = 0; i < steps; i++) {
          const nx = x + (bx - x) * 0.55 * (1 - i / steps) + (hash(seed + b * 31 + i) - 0.5) * 12;
          const ny = by + (y - 9 - by) / steps;
          s.fillRect(Math.min(bx, nx) | 0, by | 0, Math.max(1, Math.abs(nx - bx)) | 0, Math.ceil(ny - by) + 1);
          bx = nx;
          by = ny;
        }
      }
      s.globalAlpha = 0.5 * (1 - t / 0.55);
      s.drawImage(this.halo, x - 40, y - 54, 80, 70);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'source-over';
    }
    s.fillStyle = '#e8ddff';
    for (let i = 0; i < 24; i++) {
      const a = hash(e.seed * 3 + i) * Math.PI * 2;
      const r = (6 + t * 60) * (0.5 + hash(e.seed + i * 9) * 0.6);
      s.globalAlpha = (1 - t) * fade;
      s.fillRect((x + Math.cos(a) * r) | 0, (y - 10 + Math.sin(a) * r * 0.55 - t * 14) | 0, 2, 1);
    }
    s.globalAlpha = 1;
  }

  private drawWisps(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    for (let w = 0; w < 3; w++) {
      const ph = Math.min(1, t * 1.15 - w * 0.08);
      if (ph <= 0) continue;
      const baseX = x + (w - 1) * 7;
      for (let i = 0; i < 9; i++) {
        const u = i / 9;
        const yy = y - 4 - ph * 42 - u * 9;
        const xx = baseX + Math.sin(ph * 5 + u * 3 + w * 2) * 5;
        s.globalAlpha = Math.max(0, (1 - ph) * (1 - u) * 0.9);
        s.fillStyle = u < 0.3 ? '#ffffff' : '#bfe0ff';
        s.fillRect(xx | 0, yy | 0, u < 0.5 ? 2 : 1, 2);
      }
    }
    s.globalAlpha = 1;
  }

  private drawLoot(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    for (let i = 0; i < 6; i++) {
      const life = (t * 1.6 + i * 0.17) % 1;
      const px = x + (hash(e.seed + i * 7) - 0.5) * 24;
      const py = y - 3 - hash(e.seed + i * 11) * 9 - life * 5;
      const sz = Math.sin(life * Math.PI);
      if (sz < 0.1) continue;
      s.globalAlpha = sz;
      s.fillStyle = i % 2 ? '#fff6c8' : '#ffd84a';
      const r = Math.round(sz * 2.4);
      s.fillRect((px - r) | 0, py | 0, r * 2 + 1, 1);
      s.fillRect(px | 0, (py - r) | 0, 1, r * 2 + 1);
    }
    s.globalAlpha = 1;
  }

  private drawHeal(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    for (let i = 0; i < 8; i++) {
      const ph = (t * 1.2 + i * 0.13) % 1;
      const px = x + (hash(e.seed + i * 5) - 0.5) * 22;
      const py = y - 3 - ph * 24;
      s.globalAlpha = (1 - ph) * (1 - t * 0.4);
      s.fillStyle = i % 2 ? '#9affb8' : '#5fdc86';
      s.fillRect(px | 0, (py - 1) | 0, 1, 3);
      s.fillRect((px - 1) | 0, py | 0, 3, 1);
    }
    s.globalAlpha = 1;
  }

  private drawLearn(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const cy = y - 31 - t * 6;
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = 0.7 * fade;
    s.drawImage(this.halo, x - 22, cy - 22, 44, 44);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = fade;
    // book icon
    s.fillStyle = '#7a3a2a';
    s.fillRect(x - 5, cy - 3, 10, 7);
    s.fillStyle = '#f3e6c0';
    s.fillRect(x - 4, cy - 2, 4, 5);
    s.fillRect(x + 1, cy - 2, 4, 5);
    s.fillStyle = '#d9b867';
    s.fillRect(x, cy - 3, 1, 7);
    // rays
    s.fillStyle = '#fff0b8';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + t * 2;
      const r = 9 + (Math.sin(t * 14 + i) + 1) * 3;
      s.fillRect((x + Math.cos(a) * r) | 0, (cy + Math.sin(a) * r * 0.8) | 0, 1, 1);
    }
    s.globalAlpha = 1;
  }

  private drawPurify(s: CanvasRenderingContext2D, x: number, y: number, e: Effect, t: number): void {
    const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const r1 = 6 + Math.min(1, t * 1.4) * 58;
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = 0.5 * fade;
    s.drawImage(this.halo, x - r1, y - r1 / 2, r1 * 2, r1);
    s.globalCompositeOperation = 'source-over';
    ring(s, x, y, r1, r1 / 2, '#fff2b8', fade);
    ring(s, x, y, r1 * 0.7, r1 * 0.35, '#ffe27a', fade * 0.8);
    ring(s, x, y, r1 * 0.4, r1 * 0.2, '#ffffff', fade * 0.7);
    for (let i = 0; i < 26; i++) {
      const ph = (t * 1.2 + i * 0.071) % 1;
      const a = hash(e.seed + i) * Math.PI * 2;
      const r = r1 * 0.9 * hash(e.seed + i * 3);
      s.globalAlpha = (1 - ph) * fade;
      s.fillStyle = i % 3 ? '#fff0b0' : '#ffffff';
      s.fillRect((x + Math.cos(a) * r) | 0, (y + Math.sin(a) * r * 0.5 - ph * 36) | 0, 1, 2);
    }
    s.globalAlpha = 1;
  }

  // ---- drawing: floating text at device resolution -------------------------------------------------------

  /**
   * Draw floaters on the main canvas. `toDevice(id, tx, ty, out)` maps an entity (or fallback tile) to device px of
   * its head. `scale` is the device pixel ratio times a zoom factor for text size.
   */
  drawText(ctx: CanvasRenderingContext2D, now: number, scale: number, toDevice: (f: Floater, out: { x: number; y: number }) => void): void {
    const o = { x: 0, y: 0 };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const f of this.floaters) {
      if (!f.active) continue;
      const t = (now - f.t0) / f.life;
      if (t < 0 || t > 1) continue;
      toDevice(f, o);
      const ease = 1 - Math.pow(1 - t, 2.2);
      const pop = f.crit ? 1 + Math.max(0, 0.5 * (1 - t * 6)) : 1 + Math.max(0, 0.25 * (1 - t * 8));
      const size = Math.round(f.size * scale * pop);
      ctx.font = `${f.crit ? 'bold ' : '600 '}${size}px Georgia, "Times New Roman", serif`;
      const x = o.x + f.dx * scale * 0.4 * ease;
      const y = o.y - f.rise * scale * ease;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.lineWidth = Math.max(2, Math.round(size * 0.22));
      ctx.strokeStyle = 'rgba(20,12,24,0.9)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Pixel ring (isometric ellipse) drawn as 1px dots. */
export function ring(s: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, alpha: number): void {
  if (alpha <= 0.02 || rx < 1) return;
  s.globalAlpha = Math.min(1, alpha);
  s.fillStyle = color;
  const n = Math.max(12, Math.round(rx * 2.4));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s.fillRect((cx + Math.cos(a) * rx) | 0, (cy + Math.sin(a) * ry) | 0, 1, 1);
  }
  s.globalAlpha = 1;
}
