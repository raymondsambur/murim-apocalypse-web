/**
 * The depth-sorted world pass: terrain-bound objects (trees, mountains, walls, bridge rails), buildings and entities
 * are painted in one back-to-front sweep over the visible diagonals (x + y), so no per-frame sorting of thousands of
 * tiles is needed. Also collects night lights, window glow layers and smoke emitters.
 */
import { O, T, FACTION_BY_ID, type Dir, type NodeKind } from '@murim/shared';
import { BEAST_KEYS, BEAST_FRAMES, type BeastKey } from '../art/beasts';
import { FRAME_COUNTS, stateFromEntity, type CharSpec, type CharState, type SpecialStyle } from '../art/character';
import { ihash } from '../art/noise';
import { factionColor } from '../art/palette';
import { NODE_FRAMES } from '../art/nodes';
import type { Sprite } from '../art/canvas';
import { Ent, EntityStore, lookFromId } from './entities';
import { isMoving } from './interp';
import type { FlashSprite, SpriteBank } from './sprites';
import { W_NE, W_NW, W_SE, W_SW, type BuildingInfo, type WorldModel } from './world';
import { makeCanvas } from '../art/canvas';

const SWAY_CODES = new Set<number>([O.Pine, O.Oak, O.Bamboo, O.Reeds]);
const SPECIAL_KEYS = new Set(['bandit', 'bandit_boss', 'hollow', 'hollow_monk', 'hollow_brute', 'hollow_lord']);
const HUMAN_WEAPON: Record<string, 'sword' | 'blade' | 'spear' | 'staff' | 'fist' | null> = {
  bandit: 'blade',
  bandit_boss: 'blade',
  hollow: null,
  hollow_monk: 'staff',
  hollow_brute: 'fist',
  hollow_lord: null,
};

export interface LightSrc {
  x: number;
  y: number;
  r: number;
  c: number;
}

interface Dyn {
  key: number;
  kind: 0 | 1;
  b: BuildingInfo | null;
  e: Ent | null;
}

interface SmokeEmitter {
  /** World art px. */
  wx: number;
  wy: number;
  kind: string;
}

export class SceneRenderer {
  /** Scene-px lights gathered this frame (for night lighting). */
  readonly lights: LightSrc[] = [];
  /** Emissive layers to draw additively at night: sprite + scene position. */
  readonly glowLayers: { cv: HTMLCanvasElement; x: number; y: number }[] = [];
  /** Entities drawn this frame, back-to-front. */
  readonly drawnEnts: Ent[] = [];
  moveTarget: { x: number; y: number } | null = null;
  moveTargetAt = 0;
  selectedId: number | null = null;
  selfId: number | null = null;
  wind = 0.2;
  private dyn: Dyn[] = [];
  private dynPool: Dyn[] = [];
  private smokeNext = new Map<number, number>();
  private emitters: SmokeEmitter[] = [];
  private bannerColor = new Map<number, string | null>();
  private wallFallen = new Map<number, boolean>();
  private shadows = new Map<number, HTMLCanvasElement>();
  private mist: HTMLCanvasElement[] = [];
  // smoke particle pool (world art px)
  private sx = new Float32Array(260);
  private sy = new Float32Array(260);
  private sage = new Float32Array(260);
  private slife = new Float32Array(260);
  private sseed = new Float32Array(260);
  private skind = new Uint8Array(260);
  private snext = 0;
  static readonly SMOKE_KINDS: Record<string, number> = { chimney: 1, alchemy: 2, fire: 3, smolder: 4 };

  constructor(
    private world: WorldModel,
    private bank: SpriteBank,
    private ents: EntityStore,
  ) {
    for (let i = 0; i < 3; i++) this.mist.push(makeMist(i));
  }

  // ---------------------------------------------------------------------------------------------

  private controllerOf(sid: number): string | null {
    return this.world.status.get(sid)?.controller ?? null;
  }

  private fallenOf(sid: number): boolean {
    const st = this.world.status.get(sid);
    const def = this.world.settlementById.get(sid);
    return st?.status === 'fallen' || def?.kind === 'ruin';
  }

  private bannerFor(idx: number, x: number, y: number): string | undefined {
    let c = this.bannerColor.get(idx);
    if (c === undefined) {
      let best = -1;
      let bd = 1e9;
      for (const s of this.world.settlements) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) {
          bd = d;
          best = s.id;
        }
      }
      const ctrl = best >= 0 ? this.controllerOf(best) : null;
      c = ctrl ? factionColor(ctrl) : null;
      this.bannerColor.set(idx, c);
    }
    return c ?? undefined;
  }

  /** Forget cached controller-dependent data (after a settlement update). */
  invalidateOwners(): void {
    this.bannerColor.clear();
    this.wallFallen.clear();
  }

  private wallIsFallen(idx: number, x: number, y: number): boolean {
    let f = this.wallFallen.get(idx);
    if (f === undefined) {
      f = false;
      let bd = 1e9;
      for (const s of this.world.settlements) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd && d <= s.radius + 4) {
          bd = d;
          f = this.fallenOf(s.id);
        }
      }
      this.wallFallen.set(idx, f);
    }
    return f;
  }

  private shadow(rx: number): HTMLCanvasElement {
    const r = Math.max(3, Math.round(rx));
    let c = this.shadows.get(r);
    if (!c) {
      c = makeCanvas(r * 2 + 2, Math.ceil(r) + 3);
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(16,10,30,0.34)';
      const cy = c.height / 2;
      for (let y = 0; y < c.height; y++) {
        const ny = (y + 0.5 - cy) / (c.height / 2 - 0.5);
        const half = Math.sqrt(Math.max(0, 1 - ny * ny)) * r;
        if (half < 0.5) continue;
        g.fillRect(Math.round(r + 1 - half), y, Math.round(half * 2), 1);
      }
      g.fillStyle = 'rgba(16,10,30,0.18)';
      for (let y = 0; y < c.height; y++) {
        const ny = (y + 0.5 - cy) / (c.height / 2 - 0.5);
        const half = Math.sqrt(Math.max(0, 1 - ny * ny)) * (r + 1.5);
        g.fillRect(Math.round(r + 1 - half), y, 1, 1);
        g.fillRect(Math.round(r + 1 + half) - 1, y, 1, 1);
      }
      this.shadows.set(r, c);
    }
    return c;
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Paint the sorted pass. (ax0, ay0) is the art coordinate at scene pixel (0, 0).
   */
  draw(s: CanvasRenderingContext2D, ax0: number, ay0: number, bw: number, bh: number, now: number, dt: number): void {
    const w = this.world;
    this.lights.length = 0;
    this.glowLayers.length = 0;
    this.drawnEnts.length = 0;
    this.emitters.length = 0;
    // --- visible diagonal range -------------------------------------------------------------
    const padB = 100;
    const dmin = Math.max(0, Math.floor((ay0 - 24) / 8));
    const dmax = Math.min(w.w + w.h - 2, Math.ceil((ay0 + bh + padB) / 8));
    const axMin = ax0 - 28;
    const axMax = ax0 + bw + 28;

    // --- dynamic drawables (buildings + entities) -----------------------------------------------
    let nd = 0;
    const take = (): Dyn => {
      if (nd >= this.dynPool.length) this.dynPool.push({ key: 0, kind: 0, b: null, e: null });
      return this.dynPool[nd++];
    };
    for (const b of w.buildings) {
      const d = b.def;
      // quick cull by the footprint's screen box
      const left = (d.x - (d.y + d.d)) * 16 - 24;
      const right = (d.x + d.w - d.y) * 16 + 24;
      const top = (d.x + d.y) * 8 - 190;
      const bottom = (d.x + d.w + d.y + d.d) * 8 + 40;
      if (right < ax0 || left > ax0 + bw || bottom < ay0 || top > ay0 + bh) continue;
      const it = take();
      it.key = b.depth;
      it.kind = 0;
      it.b = b;
      it.e = null;
    }
    const sx0 = -50;
    const sx1 = bw + 50;
    for (const e of this.ents.map.values()) {
      e.drawn = false;
      const art = (e.x - e.y) * 16 - ax0;
      const arty = (e.x + e.y) * 8 - ay0;
      if (art < sx0 - 40 || art > sx1 + 40 || arty < -40 || arty > bh + 160) continue;
      const it = take();
      it.key = e.x + e.y + (e.v.kind === 'node' ? -0.05 : 0.0001 * (e.id % 97));
      it.kind = 1;
      it.b = null;
      it.e = e;
    }
    const list = this.dyn;
    list.length = 0;
    for (let i = 0; i < nd; i++) list.push(this.dynPool[i]);
    list.sort((a, b) => a.key - b.key);
    let di = 0;

    const flush = (limit: number): void => {
      while (di < list.length && list[di].key < limit) {
        const it = list[di++];
        if (it.kind === 0) this.drawBuilding(s, it.b!, ax0, ay0, now);
        else this.drawEntity(s, it.e!, ax0, ay0, now);
      }
    };

    // move target marker sits on the ground, under everything sorted
    this.drawMoveTarget(s, ax0, ay0, now);

    // --- sweep the diagonals --------------------------------------------------------------------
    const terrain = w.terrain;
    const objects = w.objects;
    const blight = w.blight;
    const W = w.w;
    const H = w.h;
    for (let d = dmin; d <= dmax; d++) {
      flush(d);
      let xa = Math.ceil(((axMin / 16 + d) / 2));
      let xb = Math.floor(((axMax / 16 + d) / 2));
      if (xa < d - (H - 1)) xa = d - (H - 1);
      if (xa < 0) xa = 0;
      if (xb > d) xb = d;
      if (xb > W - 1) xb = W - 1;
      for (let x = xa; x <= xb; x++) {
        const y = d - x;
        const i = y * W + x;
        const t = terrain[i];
        const o = objects[i];
        const bl = blight[i];
        const cx = (x - y) * 16 - ax0;
        const cy = (x + y) * 8 - ay0;
        if (t === T.Rock) {
          const m = this.bank.getMountain(x, y);
          s.drawImage(m.cv, cx - m.ax, cy - m.ay);
        } else if (t === T.Bridge) {
          const axis = this.bridgeAxis(x, y);
          const r = this.bank.getBridgeRail(axis);
          s.drawImage(r.cv, cx - r.ax, cy - r.ay);
        }
        if (bl > 110 && ((x * 7 + y * 13) & 3) === 0) this.drawMist(s, cx, cy, x, y, bl, now);
        if (o === 0 || o === O.Building) continue;
        if (o === O.Wall) {
          const spr = this.bank.getWall(w.wallMask(x, y), this.wallIsFallen(i, x, y));
          s.drawImage(spr.cv, cx - spr.ax, cy - spr.ay);
          continue;
        }
        if (o >= 200) continue;
        const tier = bl >= 130 ? 2 : bl >= 60 ? 1 : 0;
        const spr = this.bank.getObject(o, x, y, tier, o === O.Banner ? this.bannerFor(i, x, y) : undefined);
        if (!spr) continue;
        const h = ihash(x, y, 2);
        const jx = (h % 7) - 3;
        const jy = ((h >> 4) % 3) - 1;
        const px = cx - spr.ax + jx;
        const py = cy - spr.ay + jy;
        if (SWAY_CODES.has(o)) {
          const sh = Math.round(Math.sin(now * 0.0016 + (h & 255) * 0.025) * (0.55 + this.wind * 0.9));
          if (sh !== 0) {
            const cut = Math.floor(spr.h * 0.55);
            s.drawImage(spr.cv, 0, cut, spr.w, spr.h - cut, px, py + cut, spr.w, spr.h - cut);
            s.drawImage(spr.cv, 0, 0, spr.w, cut, px + sh, py, spr.w, cut);
            continue;
          }
        }
        s.drawImage(spr.cv, px, py);
      }
    }
    flush(1e9);
    this.updateSmoke(s, ax0, ay0, now, dt);
  }

  private bridgeAxis(x: number, y: number): 0 | 1 {
    const w = this.world;
    const isB = (xx: number, yy: number): boolean => {
      const t = w.terrainAt(xx, yy);
      return t === T.Bridge || t === T.Road || t === T.Dirt || t === T.Plaza;
    };
    const alongX = isB(x - 1, y) || isB(x + 1, y);
    const alongY = isB(x, y - 1) || isB(x, y + 1);
    if (alongX && !alongY) return 0;
    if (alongY && !alongX) return 1;
    return w.terrainAt(x, y - 1) === T.Water || w.terrainAt(x, y - 1) === T.DeepWater ? 0 : 1;
  }

  private drawMist(s: CanvasRenderingContext2D, cx: number, cy: number, x: number, y: number, bl: number, now: number): void {
    const h = ihash(x, y, 9);
    const m = this.mist[h % this.mist.length];
    const ph = now * 0.00035 + (h & 1023) * 0.006;
    const dx = Math.sin(ph) * 9;
    const dy = -Math.abs(Math.cos(ph * 0.7)) * 6 - 2;
    s.globalAlpha = Math.min(0.75, ((bl - 100) / 155) * (0.55 + 0.35 * Math.sin(ph * 1.7)));
    s.drawImage(m, (cx - 22 + dx) | 0, (cy - 14 + dy) | 0);
    s.globalAlpha = 1;
  }

  // ---- buildings -----------------------------------------------------------------------------------

  private drawBuilding(s: CanvasRenderingContext2D, b: BuildingInfo, ax0: number, ay0: number, now: number): void {
    const d = b.def;
    const ctrl = this.controllerOf(b.sid);
    const fallen = this.fallenOf(b.sid);
    const spr = this.bank.getBuilding(b, fallen ? null : ctrl, fallen);
    const vx = (d.x - d.y) * 16 - ax0;
    const vy = (d.x + d.y) * 8 - 8 - ay0;
    const px = Math.round(vx - spr.ox);
    const py = Math.round(vy - spr.oy);
    s.drawImage(spr.spr.cv, px, py);
    if (spr.spr.glow) this.glowLayers.push({ cv: spr.spr.glow, x: px, y: py });
    for (const l of spr.lights) this.lights.push({ x: px + l.x, y: py + l.y, r: l.r, c: l.c });
    const st = this.world.status.get(b.sid);
    const besieged = st?.siege === true || st?.status === 'besieged';
    for (let i = 0; i < spr.smoke.length; i++) {
      const sm = spr.smoke[i];
      this.emitters.push({ wx: px + sm.x + ax0, wy: py + sm.y + ay0, kind: besieged && i === 0 ? 'fire' : sm.kind });
      if (besieged && i === 0) this.emitters.push({ wx: px + sm.x + ax0 + 6, wy: py + sm.y + ay0 + 4, kind: 'fire' });
    }
    if (besieged && spr.smoke.length === 0) this.emitters.push({ wx: px + spr.spr.w / 2 + ax0, wy: py + spr.spr.h * 0.45 + ay0, kind: 'fire' });
    void now;
  }

  // ---- entities ------------------------------------------------------------------------------------

  private drawEntity(s: CanvasRenderingContext2D, e: Ent, ax0: number, ay0: number, now: number): void {
    const v = e.v;
    const moving = isMoving(e.motion, now);
    let ax = (e.x - e.y) * 16 - ax0;
    let ay = (e.x + e.y) * 8 - ay0 + 1;
    const sinceHit = now - e.hitAt;
    if (sinceHit < 120 && sinceHit >= 0) ax += (e.id & 1 ? 1 : -1) * (sinceHit < 60 ? 1 : 0);
    ax = Math.round(ax);
    ay = Math.round(ay);
    const dir: Dir = (moving ? e.face : v.face) ?? 0;
    let spr: FlashSprite | null = null;
    let nodeSet: ReturnType<SpriteBank['getNode']> | null = null;
    let shadowR = 7;
    const sinceAtk = now - e.attackAt;
    const attackFrame = sinceAtk < 160 ? 1 : sinceAtk < 420 ? 2 : 0;
    const attacking = sinceAtk < 600;
    const phase = now + e.t0;

    if (v.kind === 'node') {
      const kind = (v.nodeKind ?? 'herb') as NodeKind;
      const frames = NODE_FRAMES[kind] ?? 1;
      const frame = kind === 'heart' ? Math.floor(now / 220) % frames : kind === 'rareHerb' ? Math.floor(phase / 260) % frames : kind === 'ore' ? Math.floor(phase / 420) % frames : Math.floor(phase / 380) % frames;
      nodeSet = this.bank.getNode(kind, e.id % 3, frame);
      spr = nodeSet.spr;
      shadowR = kind === 'heart' ? 34 : kind === 'ore' ? 12 : 8;
    } else if (v.kind === 'monster' && v.sprite && BEAST_KEYS.includes(v.sprite as BeastKey)) {
      const key = v.sprite as BeastKey;
      let state: 'idle' | 'walk' | 'fight' | 'dead' = v.state === 'dead' ? 'dead' : moving ? 'walk' : v.state === 'fight' || attacking ? 'fight' : 'idle';
      const fr = BEAST_FRAMES[state];
      let frame = 0;
      if (state === 'walk') frame = Math.floor(phase / (Math.min(v.step ?? 420, 600) * 0.3)) % fr;
      else if (state === 'idle') frame = Math.floor(phase / 700) % fr;
      else if (state === 'fight') frame = attacking ? attackFrame : 0;
      if (state === 'fight' && !attacking) state = 'fight';
      spr = this.bank.getBeast({ key, state, dir, frame, elite: v.elite ?? 0 });
      shadowR = key === 'bear' ? 16 : key === 'tiger' ? 15 : key === 'snake' ? 10 : 12;
    } else {
      const special: SpecialStyle = v.kind === 'monster' && v.sprite && SPECIAL_KEYS.has(v.sprite) ? (v.sprite as SpecialStyle) : v.kind === 'monster' ? 'bandit' : 'none';
      let state: CharState = v.state === 'dead' ? 'dead' : moving ? 'walk' : stateFromEntity(v.state);
      if (state === 'walk' && !moving) state = 'idle';
      if (attacking && state !== 'dead') state = 'fight';
      const fr = FRAME_COUNTS[state];
      let frame = 0;
      switch (state) {
        case 'walk':
          frame = Math.floor(phase / (Math.min(v.step ?? 420, 600) * 0.28)) % fr;
          break;
        case 'idle':
          frame = Math.floor(phase / 650) % fr;
          break;
        case 'fight':
          frame = attacking ? attackFrame : 0;
          break;
        case 'work':
          frame = Math.floor(phase / 280) % fr;
          break;
        case 'meditate':
          frame = Math.floor(phase / 900) % fr;
          break;
      }
      const role = v.role ?? null;
      const faction = v.faction && FACTION_BY_ID[v.faction] ? FACTION_BY_ID[v.faction].color : null;
      const spec: CharSpec = {
        look: v.look ?? lookFromId(e.id),
        weapon: v.weapon ?? (special !== 'none' ? HUMAN_WEAPON[special] : role === 'guard' ? 'spear' : null),
        state,
        dir,
        frame,
        role,
        faction,
        elite: v.elite ?? 0,
        special,
        tool: role === 'smith' || role === 'alchemist' || role === 'innkeeper' ? 'hammer' : 'hoe',
      };
      spr = this.bank.getChar(spec);
      shadowR = special === 'hollow_lord' ? 15 : special === 'hollow_brute' || special === 'bandit_boss' ? 11 : 7.5;
    }
    if (!spr) return;
    // soft shadow
    const sh = this.shadow(shadowR * (v.kind === 'node' ? 1 : 1));
    s.drawImage(sh, ax - Math.round(sh.width / 2), ay - Math.round(sh.height / 2) + 1);
    // selection ring under the sprite
    if (this.selectedId === e.id) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 200);
      s.globalAlpha = pulse;
      s.fillStyle = '#ffe27a';
      const rx = shadowR + 4;
      const ry = rx / 2;
      const n = Math.max(20, Math.round(rx * 3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        s.fillRect((ax + Math.cos(a) * rx) | 0, (ay + Math.sin(a) * ry) | 0, 1, 1);
      }
      s.globalAlpha = 1;
    }
    // faction / legend aura
    if (v.role === 'legend' || v.elite === 2) this.aura(s, ax, ay - (spr.ay >> 1), v.role === 'legend' ? '255,222,140' : v.sprite && v.sprite.startsWith('hollow') ? '170,90,255' : '255,120,90', now);
    const fade = v.state === 'dead' && e.deadAt > 0 ? Math.max(0.15, Math.min(1, 1 - (now - e.deadAt - 3500) / 2500)) : 1;
    if (fade < 1) s.globalAlpha = fade;
    if (e.born + 400 > now) s.globalAlpha = Math.min(s.globalAlpha, (now - e.born) / 400);
    const dx = ax - spr.ax;
    const dy = ay - spr.ay;
    s.drawImage(spr.cv, dx, dy);
    if (sinceHit < 150 && sinceHit >= 0 && v.kind !== 'node') s.drawImage(this.bank.flashOf(spr), dx, dy);
    s.globalAlpha = 1;
    if (nodeSet) {
      if (nodeSet.glow) {
        s.globalCompositeOperation = 'lighter';
        s.drawImage(nodeSet.glow, dx, dy);
        s.globalCompositeOperation = 'source-over';
      }
      if (nodeSet.light !== null) this.lights.push({ x: ax, y: ay - 10, r: nodeSet.lightR, c: nodeSet.light });
      if (v.nodeKind === 'heart') this.heartSwirl(s, ax, ay, now);
    }
    if (v.id === this.selfId) this.lights.push({ x: ax, y: ay - 14, r: 34, c: 0xff9fd8ff & 0xffffffff });
    // bookkeeping for overlays / picking
    e.drawn = true;
    e.sx = ax;
    e.sy = ay;
    e.topPx = spr.ay - (spr.top ?? 0);
    e.halfW = Math.max(6, Math.min(spr.w, v.kind === 'node' ? spr.w : 18) / 2);
    e.depth = e.x + e.y;
    this.drawnEnts.push(e);
  }

  private aura(s: CanvasRenderingContext2D, x: number, y: number, rgb: string, now: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(now / 340);
    const g = s.createRadialGradient(x, y, 2, x, y, 26 + pulse * 3);
    g.addColorStop(0, `rgba(${rgb},${0.38 + pulse * 0.1})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    s.globalCompositeOperation = 'lighter';
    s.fillStyle = g;
    s.fillRect(x - 32, y - 32, 64, 64);
    s.globalCompositeOperation = 'source-over';
  }

  private heartSwirl(s: CanvasRenderingContext2D, ax: number, ay: number, now: number): void {
    s.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const life = ((now / 2600 + i * 0.0385) % 1);
      const a = now / 700 + i * 0.7 + life * 5;
      const r = 8 + (1 - life) * 34;
      const px = ax + Math.cos(a) * r;
      const py = ay - 22 - life * 70 + Math.sin(a) * r * 0.4;
      s.globalAlpha = Math.sin(life * Math.PI) * 0.9;
      s.fillStyle = i % 3 === 0 ? '#e8c4ff' : i % 3 === 1 ? '#b866ff' : '#7a2f9a';
      s.fillRect(px | 0, py | 0, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1);
    }
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
  }

  private drawMoveTarget(s: CanvasRenderingContext2D, ax0: number, ay0: number, now: number): void {
    const t = this.moveTarget;
    if (!t) return;
    const cx = Math.round((t.x - t.y) * 16 - ax0);
    const cy = Math.round((t.x + t.y) * 8 - ay0);
    const ph = ((now - this.moveTargetAt) / 900) % 1;
    s.fillStyle = '#fff1b0';
    // diamond outline
    s.globalAlpha = 0.9;
    for (let i = 0; i < 16; i++) {
      s.fillRect(cx - 16 + i * 2, cy - Math.round((i < 8 ? i : 16 - i) * 0.5) - 0, 1, 1);
      s.fillRect(cx - 16 + i * 2, cy + Math.round((i < 8 ? i : 16 - i) * 0.5), 1, 1);
    }
    for (let k = 0; k < 2; k++) {
      const p = (ph + k * 0.5) % 1;
      const rx = 3 + p * 15;
      const ry = rx / 2;
      s.globalAlpha = (1 - p) * 0.9;
      const n = Math.max(12, Math.round(rx * 2.5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        s.fillRect((cx + Math.cos(a) * rx) | 0, (cy + Math.sin(a) * ry) | 0, 1, 1);
      }
    }
    s.globalAlpha = 1;
  }

  // ---- smoke ------------------------------------------------------------------------------------------

  private updateSmoke(s: CanvasRenderingContext2D, ax0: number, ay0: number, now: number, dt: number): void {
    // spawn
    for (let i = 0; i < this.emitters.length; i++) {
      const em = this.emitters[i];
      const key = (Math.round(em.wx) * 73856093) ^ (Math.round(em.wy) * 19349663);
      const next = this.smokeNext.get(key) ?? 0;
      if (now >= next) {
        const interval = em.kind === 'fire' ? 90 : em.kind === 'smolder' ? 520 : em.kind === 'alchemy' ? 420 : 460;
        this.smokeNext.set(key, now + interval * (0.7 + ((key >>> 3) % 7) / 10));
        const p = this.snext;
        this.snext = (this.snext + 1) % this.sx.length;
        this.sx[p] = em.wx + ((Math.random() - 0.5) * (em.kind === 'fire' ? 8 : 3));
        this.sy[p] = em.wy;
        this.sage[p] = 0;
        this.slife[p] = em.kind === 'fire' ? 650 : 2600;
        this.sseed[p] = Math.random();
        this.skind[p] = SceneRenderer.SMOKE_KINDS[em.kind] ?? 1;
      }
    }
    if (this.smokeNext.size > 400) this.smokeNext.clear();
    const wind = 0.3 + this.wind * 1.4;
    for (let p = 0; p < this.sx.length; p++) {
      const life = this.slife[p];
      if (life <= 0) continue;
      this.sage[p] += dt;
      if (this.sage[p] >= life) {
        this.slife[p] = 0;
        continue;
      }
      const t = this.sage[p] / life;
      const k = this.skind[p];
      const x = this.sx[p] + t * wind * 22 + Math.sin(t * 6 + this.sseed[p] * 6) * (k === 3 ? 0.8 : 2.2) - ax0;
      const y = this.sy[p] - t * (k === 3 ? 14 : 28) - ay0;
      if (k === 3) {
        // flame
        s.globalAlpha = 1 - t;
        s.fillStyle = t < 0.3 ? '#fff0a0' : t < 0.6 ? '#ff9a30' : '#d8401c';
        const sz = t < 0.5 ? 3 : 2;
        s.fillRect(x | 0, y | 0, sz, sz + 1);
        s.globalAlpha = 1;
        continue;
      }
      const sz = 2 + t * 5;
      s.globalAlpha = (k === 4 ? 0.5 : 0.42) * (1 - t) * Math.min(1, t * 6);
      s.fillStyle = k === 2 ? '#a8f0b8' : k === 4 ? '#3a3238' : '#d6d6dc';
      s.fillRect((x - sz / 2) | 0, (y - sz / 2) | 0, sz | 0, sz | 0);
      if (k === 4 && t < 0.25 && this.sseed[p] > 0.7) {
        s.globalAlpha = 1 - t * 4;
        s.fillStyle = '#ff9a30';
        s.fillRect(x | 0, (y - 3) | 0, 1, 1);
      }
    }
    s.globalAlpha = 1;
  }
}

function makeMist(seed: number): HTMLCanvasElement {
  const c = makeCanvas(48, 28);
  const g = c.getContext('2d')!;
  const img = g.createImageData(48, 28);
  for (let y = 0; y < 28; y++)
    for (let x = 0; x < 48; x++) {
      const nx = (x - 24) / 24;
      const ny = (y - 14) / 14;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const n = (ihash(x >> 1, y >> 1, seed + 5) % 100) / 100;
      const a = (1 - d) * (0.35 + n * 0.65);
      // dither to a pixelated translucency
      const th = ((x & 1) + (y & 1) * 2) / 4;
      if (a < th * 0.7) continue;
      const i = (y * 48 + x) * 4;
      img.data[i] = 70 + n * 40;
      img.data[i + 1] = 30 + n * 20;
      img.data[i + 2] = 96 + n * 50;
      img.data[i + 3] = 150 + a * 90;
    }
  g.putImageData(img, 0, 0);
  return c;
}

export { W_NE, W_NW, W_SE, W_SW };
export type { Sprite };
