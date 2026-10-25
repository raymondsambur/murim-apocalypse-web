/**
 * The depth-sorted world pass: terrain-bound objects (trees, mountains, walls, bridge rails), buildings and entities
 * are painted in one back-to-front sweep over the visible diagonals (x + y), so no per-frame sorting of thousands of
 * tiles is needed. Also collects night lights, window glow layers and smoke emitters.
 */
import { O, T, FACTION_BY_ID, type Dir, type NodeKind } from '@murim/shared';
import { BEAST_KEYS, type BeastKey } from '../art/beasts';
import { sizeMult, type CharSpec, type SpecialStyle } from '../art/character';
import { coverage, isHidden, stepOcc, type Coverage, type Occluder, type RowSpans } from './occlusion';
import type { ToolKind } from '../art/anim';
import { gearFor, rarityCol } from '../art/gear';
import { newBeastPick, newPick, pickBeast, pickChar, reactionOffset, windLevel, motion, type AnimPick, type BeastPick, type PickEnv } from './life';
import { PCOL, PK, Particles } from './particles';
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
  /** Tall drawables of this frame (pool) used to decide which plates are hidden behind scenery. */
  private occl: Occluder[] = [];
  private nOcc = 0;
  private cov: Coverage = { frac: 0, head: false };
  /** Your own sprite of this frame, redrawn as an x-ray ghost when scenery covers it. */
  private xray: { spr: FlashSprite; dx: number; dy: number } | null = null;
  moveTarget: { x: number; y: number } | null = null;
  moveTargetAt = 0;
  selectedId: number | null = null;
  selfId: number | null = null;
  wind = 0.2;
  readonly particles = new Particles();
  private pick: AnimPick = newPick();
  private bpick: BeastPick = newBeastPick();
  private react = { x: 0, y: 0 };
  private spec: CharSpec = { look: lookFromId(0), state: 'idle', dir: 0, frame: 0 };
  private env: PickEnv;
  private dyn: Dyn[] = [];
  private dynPool: Dyn[] = [];
  private smokeNext = new Map<number, number>();
  private emitters: SmokeEmitter[] = [];
  private bannerColor = new Map<number, string | null>();
  /** Settlements whose buildings burn (a town being sacked after the raiders won). */
  private readonly burning = new Set<number>();
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
    this.env = { now: 0, moving: false, ents, wind: 0, weapon: null, hollow: false, hasHuman: true, toolFor: (e) => this.toolFor(e) };
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

  setBurning(sid: number, on: boolean): void {
    if (on) this.burning.add(sid);
    else this.burning.delete(sid);
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
    this.windLvl = windLevel(this.wind);
    this.bank.beginFrame();
    this.lights.length = 0;
    this.glowLayers.length = 0;
    this.drawnEnts.length = 0;
    this.emitters.length = 0;
    this.nOcc = 0;
    this.xray = null;
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
      e.dkey = it.key;
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
    this.particles.update(dt);
    this.particles.drawGround(s, ax0, ay0);

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
          this.pushOcc(cx - m.ax, cy - m.ay, m.w, m.h, d, m.spans);
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
          this.pushOcc(cx - spr.ax, cy - spr.ay, spr.w, spr.h, d, spr.spans);
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
            if (spr.spans) this.pushOcc(px, py, spr.w, spr.h, d, spr.spans);
            continue;
          }
        }
        s.drawImage(spr.cv, px, py);
        if (spr.spans) this.pushOcc(px, py, spr.w, spr.h, d, spr.spans);
      }
    }
    flush(1e9);
    this.resolveOcclusion(s, dt);
    this.particles.drawAir(s, ax0, ay0);
    this.updateSmoke(s, ax0, ay0, now, dt);
  }

  private pushOcc(x: number, y: number, w: number, h: number, depth: number, spans: RowSpans | undefined): void {
    if (this.nOcc >= this.occl.length) this.occl.push({ x: 0, y: 0, w: 0, h: 0, depth: 0, spans: null });
    const o = this.occl[this.nOcc++];
    o.x = x;
    o.y = y;
    o.w = w;
    o.h = h;
    o.depth = depth;
    o.spans = spans ?? null;
  }

  /** Per entity: smoothed "hidden behind scenery" level for the overlay, and the x-ray ghost of your own character. */
  private resolveOcclusion(s: CanvasRenderingContext2D, dt: number): void {
    const list = this.drawnEnts;
    const box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      box.x0 = e.sx - e.halfW;
      box.x1 = e.sx + e.halfW;
      box.y0 = e.sy - e.topPx;
      box.y1 = e.sy;
      e.occ = stepOcc(e.occ, isHidden(coverage(box, e.dkey, this.occl, this.nOcc, this.cov)), dt);
    }
    const x = this.xray;
    if (x && this.selfId !== null) {
      const me = this.ents.map.get(this.selfId);
      if (me && me.occ > 0.04) {
        s.globalAlpha = 0.5 * me.occ;
        s.drawImage(x.spr.cv, x.dx, x.dy);
        s.globalAlpha = 0.3 * me.occ;
        s.drawImage(this.bank.flashOf(x.spr), x.dx, x.dy);
        s.globalAlpha = 1;
      }
    }
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
    this.pushOcc(px, py, spr.spr.w, spr.spr.h, b.depth, spr.spr.spans);
    if (spr.spr.glow) this.glowLayers.push({ cv: spr.spr.glow, x: px, y: py });
    for (const l of spr.lights) this.lights.push({ x: px + l.x, y: py + l.y, r: l.r, c: l.c });
    const st = this.world.status.get(b.sid);
    const burning = this.burning.has(b.sid);
    const besieged = st?.siege === true || st?.status === 'besieged' || burning;
    for (let i = 0; i < spr.smoke.length; i++) {
      const sm = spr.smoke[i];
      this.emitters.push({ wx: px + sm.x + ax0, wy: py + sm.y + ay0, kind: (besieged && i === 0) || burning ? 'fire' : sm.kind });
      if (besieged && i === 0) this.emitters.push({ wx: px + sm.x + ax0 + 6, wy: py + sm.y + ay0 + 4, kind: 'fire' });
    }
    if (besieged && spr.smoke.length === 0) this.emitters.push({ wx: px + spr.spr.w / 2 + ax0, wy: py + spr.spr.h * 0.45 + ay0, kind: 'fire' });
    if (burning) this.emitters.push({ wx: px + spr.spr.w * 0.32 + ax0, wy: py + spr.spr.h * 0.3 + ay0, kind: 'fire' }, { wx: px + spr.spr.w * 0.66 + ax0, wy: py + spr.spr.h * 0.5 + ay0, kind: 'fire' });
    void now;
  }

  // ---- entities ------------------------------------------------------------------------------------

  /** Tool a working entity swings (by role, farmland or the nearest resource node). */
  private toolFor(e: Ent): ToolKind | null {
    if (e.tool !== null && this.nowRef - e.toolAt < 2500) return e.tool as ToolKind;
    let tool: ToolKind = 'hammer';
    const role = e.v.role;
    if (role === 'smith') tool = 'hammer';
    else {
      const t = this.world.terrainAt(Math.round(e.x), Math.round(e.y));
      let node: string | null = null;
      let bd = 2.4 * 2.4;
      for (const o of this.ents.map.values()) {
        if (o.v.kind !== 'node') continue;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          node = o.v.nodeKind ?? null;
        }
      }
      if (node === 'ore') tool = 'pick';
      else if (node === 'herb' || node === 'rareHerb') tool = 'herb';
      else if (t === T.Farm) tool = e.seed < 0.5 ? 'hoe' : 'sickle';
      else if (role === 'villager' || role === 'wanderer' || e.v.kind === 'player') tool = e.seed < 0.5 ? 'hoe' : 'pick';
    }
    e.tool = tool;
    e.toolAt = this.nowRef;
    return tool;
  }

  private nowRef = 0;

  /** Screen-space sign (-1/+1) toward the nearest neighbour, or `fallback`. */
  private lookSign(e: Ent, fallback: number): number {
    let best = 0;
    let bd = 5 * 5;
    for (const o of this.ents.map.values()) {
      if (o === e || o.v.kind === 'node') continue;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = (o.x - o.y) - (e.x - e.y);
      }
    }
    return Math.abs(best) > 0.6 ? (best > 0 ? 1 : -1) : fallback;
  }

  /** Dust, splashes and winter prints at a footfall. */
  private footfall(e: Ent, wx: number, wy: number): void {
    if (motion.reduced) return;
    const t = this.world.terrainAt(Math.round(e.x), Math.round(e.y));
    const pr = this.particles;
    const r = e.seed;
    if (t === T.Water) {
      for (let i = 0; i < 4; i++) pr.spawn(PK.Splash, wx + (i - 1.5) * 1.6, wy - 1, (i - 1.5) * 14 + (r - 0.5) * 10, -34 - i * 6, 340, i & 1 ? PCOL.white : PCOL.water);
      return;
    }
    const snowy = this.bank.season === 3 && (t === T.Grass || t === T.Plains || t === T.Forest || t === T.Hill || t === T.Snow || t === T.Dirt || t === T.Farm);
    if (snowy) {
      pr.spawn(PK.Print, wx - 3 + (r > 0.5 ? 0 : 5), wy - 1, 0, 0, 5200, PCOL.snowPrint);
      return;
    }
    if (t === T.Dirt || t === T.Sand || t === T.Farm || t === T.Road) {
      const col = t === T.Sand ? PCOL.sand : t === T.Road ? PCOL.grey : PCOL.dirt;
      pr.spawn(PK.Dust, wx - 2 + r * 4, wy - 1, -6 + r * 12, -10, 460, col);
      pr.spawn(PK.Dust, wx + 1 + r * 3, wy, 5, -7, 380, col);
    }
  }

  private drawGlowLayer(s: CanvasRenderingContext2D, gl: HTMLCanvasElement, dx: number, dy: number, now: number, e: Ent, rar: number): void {
    s.globalCompositeOperation = 'lighter';
    if (motion.reduced) {
      s.globalAlpha = 0.5;
      s.drawImage(gl, dx, dy);
    } else {
      const ph = now / 380 + e.seed * 6.28;
      const bands = 3;
      const bh = Math.ceil(gl.height / bands);
      for (let b = 0; b < bands; b++) {
        const y0 = b * bh;
        const h = Math.min(bh, gl.height - y0);
        if (h <= 0) break;
        s.globalAlpha = rar >= 4 ? 0.6 + 0.3 * Math.sin(ph * 0.7 + b * 0.5) : 0.3 + 0.6 * Math.max(0, Math.sin(ph - b * 0.9));
        s.drawImage(gl, 0, y0, gl.width, h, dx, dy + y0, gl.width, h);
      }
    }
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
  }

  private drawEntity(s: CanvasRenderingContext2D, e: Ent, ax0: number, ay0: number, now: number): void {
    const v = e.v;
    this.nowRef = now;
    const moving = isMoving(e.motion, now);
    reactionOffset(e, now, this.react);
    const wx = (e.x - e.y) * 16;
    const wy = (e.x + e.y) * 8 + 1;
    const ax = Math.round(wx - ax0 + this.react.x);
    const ay = Math.round(wy - ay0 + this.react.y);
    let dir: Dir = (moving ? e.face : v.face) ?? 0;
    let spr: FlashSprite | null = null;
    let nodeSet: ReturnType<SpriteBank['getNode']> | null = null;
    let shadowR = 7;
    const sinceHit = now - e.hitAt;
    const phase = now + e.t0;
    const pk = this.pick;
    let human = false;
    let beast = false;
    let mirror = false;

    if (v.kind === 'node') {
      const kind = (v.nodeKind ?? 'herb') as NodeKind;
      const frames = NODE_FRAMES[kind] ?? 1;
      const frame = kind === 'heart' ? Math.floor(now / 220) % frames : kind === 'rareHerb' ? Math.floor(phase / 260) % frames : kind === 'ore' ? Math.floor(phase / 420) % frames : Math.floor(phase / 380) % frames;
      nodeSet = this.bank.getNode(kind, e.id % 3, frame);
      spr = nodeSet.spr;
      shadowR = kind === 'heart' ? 34 : kind === 'ore' ? 12 : 8;
    } else if (v.kind === 'monster' && v.sprite && BEAST_KEYS.includes(v.sprite as BeastKey)) {
      const key = v.sprite as BeastKey;
      const bp = this.bpick;
      pickBeast(e, now, moving, key === 'wolf_blight', key === 'snake', bp);
      spr = this.bank.getBeast({ key, state: bp.state, dir, frame: bp.frame, elite: v.elite ?? 0, variant: bp.variant }, e.lastSpr);
      shadowR = (key === 'bear' ? 11 : key === 'tiger' ? 12 : key === 'snake' ? 6 : 8) * (v.elite === 2 ? 1.4 : v.elite === 1 ? 1.15 : 1);
      beast = true;
      const fk = bp.frame + 16 * (bp.state === 'walk' ? 1 : 0);
      if (fk !== e.lastFrame) {
        e.lastFrame = fk;
        if (bp.state === 'walk' && key !== 'snake' && (bp.frame === 0 || bp.frame === 4)) this.footfall(e, wx, wy);
      }
    } else {
      human = true;
      const special: SpecialStyle = v.kind === 'monster' && v.sprite && SPECIAL_KEYS.has(v.sprite) ? (v.sprite as SpecialStyle) : v.kind === 'monster' ? 'bandit' : 'none';
      const role = v.role ?? null;
      const faction = v.faction && FACTION_BY_ID[v.faction] ? FACTION_BY_ID[v.faction].color : null;
      const weapon = v.weapon ?? (special !== 'none' ? HUMAN_WEAPON[special] : role === 'guard' ? 'spear' : null);
      const env = this.env;
      env.now = now;
      env.moving = moving;
      env.weapon = weapon;
      env.hollow = special.startsWith('hollow');
      env.hasHuman = true;
      pickChar(e, env, pk);
      if (pk.dir >= 0) dir = pk.dir as Dir;
      mirror = dir === 1 || dir === 2;
      let gz = pk.gaze;
      if (gz !== 0 && !env.hollow) gz = this.lookSign(e, gz);
      // head fidgets hold the body at one of two frames so the cache stays small
      if ((gz !== 0 || pk.tilt !== 0) && pk.state === 'idle') pk.frame = pk.frame < 4 ? 0 : 4;
      const spec = this.spec;
      spec.look = v.look ?? lookFromId(e.id);
      spec.weapon = weapon;
      spec.state = pk.state;
      spec.dir = dir;
      spec.frame = pk.frame;
      spec.role = role;
      spec.faction = faction;
      spec.elite = v.elite ?? 0;
      spec.special = special;
      spec.tool = pk.tool ?? (role === 'smith' || role === 'alchemist' || role === 'innkeeper' ? 'hammer' : undefined);
      spec.gear = gearFor(v.gear, role, special !== 'none' ? special : null);
      spec.variant = pk.variant;
      spec.wind = this.windLvl;
      spec.gaze = mirror ? -gz : gz;
      spec.tilt = pk.tilt;
      spec.blink = false;
      spr = this.bank.getChar(spec, e.lastSpr);
      shadowR = Math.round(5 * sizeMult({ special, elite: v.elite ?? 0 }));
      if (pk.state === 'dead' || pk.state === 'die') shadowR += 2;
      // footfalls and event effects
      const fk = pk.frame + 16 * (pk.state === 'walk' ? 1 : pk.state === 'run' ? 2 : pk.state === 'work' ? 3 : 0);
      if (fk !== e.lastFrame) {
        e.lastFrame = fk;
        if (pk.state === 'walk' && (pk.frame === 0 || pk.frame === 4)) this.footfall(e, wx, wy);
        else if (pk.state === 'run' && (pk.frame === 0 || pk.frame === 3)) this.footfall(e, wx, wy);
        else if (pk.state === 'work' && pk.frame === 3 && !motion.reduced && (pk.tool === 'hammer' || pk.tool === 'pick')) {
          for (let i = 0; i < 4; i++) this.particles.spawn(PK.Spark, wx + (mirror ? -1 : 1) * (9 + i * 0.7), wy - 5, (mirror ? -1 : 1) * (14 + i * 9), -38 - i * 6, 300, i & 1 ? PCOL.gold : PCOL.white);
        }
      }
    }
    if (!spr) return;
    e.lastSpr = spr;
    // soft shadow
    const sh = this.shadow(shadowR);
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
    const oRar = spr.oRar ?? 0;
    const wRar = spr.wRar ?? 0;
    // faction / legend / rarity auras (cached soft discs, additive)
    if (v.role === 'legend' || v.elite === 2) this.aura(s, ax, ay - (spr.ay >> 1), v.role === 'legend' ? 0xff8cdeff : v.sprite && v.sprite.startsWith('hollow') ? 0xffff5aaa : 0xff5a78ff, now, Math.round(spr.h * 0.62));
    else if (oRar >= 4) this.aura(s, ax, ay - (spr.ay >> 1) - 1, rarityCol(oRar), now, 15);
    else if (oRar === 3 && !motion.reduced) this.aura(s, ax, ay - (spr.ay >> 1) - 1, rarityCol(3), now, 10, 0.45);
    if (pk.state === 'meditate' && human) this.meditateAura(s, e, ax, ay, spr, now, wx, wy);
    const hl = now - e.healAt;
    if (hl >= 0 && hl < 1100) {
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = (1 - hl / 1100) * 0.75;
      const d = this.bank.glowDisc(0xff80f09a, 12);
      s.drawImage(d, ax - 12, ay - (spr.ay >> 1) - 9, 24, 19);
      s.globalAlpha = 1;
      s.globalCompositeOperation = 'source-over';
    }
    const fade = v.state === 'dead' && e.deadAt > 0 ? Math.max(0.15, Math.min(1, 1 - (now - e.deadAt - 3500) / 2500)) : 1;
    if (fade < 1) s.globalAlpha = fade;
    if (e.born + 400 > now) s.globalAlpha = Math.min(s.globalAlpha, (now - e.born) / 400);
    const dx = ax - spr.ax;
    const dy = ay - spr.ay;
    s.drawImage(spr.cv, dx, dy);
    if (v.id === this.selfId) this.xray = { spr, dx, dy };
    if (v.flag === 1 && v.state !== 'dead' && (human || beast)) this.drawBanner(s, e, ax, ay, spr, now);
    if (human && pk.blink && spr.eyes) {
      // blink: close the eyes with a tiny overlay instead of regenerating the sprite
      for (const ey of spr.eyes) {
        s.fillStyle = ey.skin;
        s.fillRect(dx + ey.x, dy + ey.y, ey.w, ey.h);
        s.fillStyle = '#2a1c22';
        s.fillRect(dx + ey.x, dy + ey.y + ey.h - 1, ey.w, 1);
      }
    }
    if (sinceHit < 150 && sinceHit >= 0 && v.kind !== 'node' && !motion.reduced) s.drawImage(this.bank.flashOf(spr), dx, dy);
    s.globalAlpha = 1;
    if ((human || beast) && spr.glow) this.drawGlowLayer(s, spr.glow, dx, dy, now, e, Math.max(oRar, wRar));
    if (human) this.humanFx(s, e, spr, dx, dy, ax0, ay0, wx, wy, mirror, now, oRar, wRar);
    if (nodeSet) {
      if (nodeSet.glow) {
        s.globalCompositeOperation = 'lighter';
        s.drawImage(nodeSet.glow, dx, dy);
        s.globalCompositeOperation = 'source-over';
      }
      if (nodeSet.light !== null) this.lights.push({ x: ax, y: ay - 10, r: nodeSet.lightR, c: nodeSet.light });
      if (v.nodeKind === 'heart') this.heartSwirl(s, ax, ay, now);
    }
    if (v.id === this.selfId) this.lights.push({ x: ax, y: ay - 9, r: 30, c: 0xff9fd8ff & 0xffffffff });
    // bookkeeping for overlays / picking
    e.drawn = true;
    e.sx = ax;
    e.sy = ay;
    e.topPx = spr.ay - (spr.top ?? 0);
    e.halfW = Math.max(6, Math.min(spr.w, v.kind === 'node' ? spr.w : 18) / 2);
    e.depth = e.x + e.y;
    this.drawnEnts.push(e);
  }

  /** The war banner a unit carries: a pole beside it with a waving cloth in its faction colour (Hollows: Blight violet). */
  private drawBanner(s: CanvasRenderingContext2D, e: Ent, ax: number, ay: number, spr: FlashSprite, now: number): void {
    const v = e.v;
    const fac = v.faction && FACTION_BY_ID[v.faction] ? FACTION_BY_ID[v.faction].color : null;
    const hollow = !!v.sprite && v.sprite.startsWith('hollow');
    const col = fac ?? (hollow || (v.side === 'raid' && !fac) ? '#8a3fc8' : '#d8c070');
    const top = Math.round(Math.min(50, spr.ay + 16));
    const poleX = ax + (v.face === 1 || v.face === 2 ? -7 : 7);
    const dirX = v.face === 1 || v.face === 2 ? -1 : 1;
    s.fillStyle = '#4a3422';
    s.fillRect(poleX, ay - top, 1, top);
    s.fillStyle = '#e8c860';
    s.fillRect(poleX - 1, ay - top - 2, 3, 2);
    const w = 14;
    const h = 10;
    const t = motion.reduced ? 0 : now / 170 + e.seed * 6;
    for (let i = 0; i < w; i++) {
      const wob = Math.round(Math.sin(t + i * 0.55) * (0.4 + i * 0.12));
      const x = poleX + dirX * (i + 1) - (dirX < 0 ? 0 : 0);
      s.fillStyle = col;
      s.fillRect(x, ay - top + wob, 1, h - (i > w - 4 ? i - (w - 4) : 0));
      s.fillStyle = 'rgba(0,0,0,0.28)';
      s.fillRect(x, ay - top + wob + h - 1 - (i > w - 4 ? i - (w - 4) : 0), 1, 1);
      if (i > 0 && i < w - 1) {
        s.fillStyle = 'rgba(255,255,255,0.22)';
        s.fillRect(x, ay - top + wob, 1, 1);
      }
    }
    // a small emblem square on the cloth
    s.fillStyle = 'rgba(255,255,255,0.55)';
    s.fillRect(poleX + dirX * 4, ay - top + 3, 2, 2);
  }

  /** Wind bucket for this frame. */
  windLvl = 0;

  /** Particle and overlay effects of a character (rarity motes, weapon sparks, steam, chat icon). */
  private humanFx(s: CanvasRenderingContext2D, e: Ent, spr: FlashSprite, dx: number, dy: number, ax0: number, ay0: number, wx: number, wy: number, mirror: boolean, now: number, oRar: number, wRar: number): void {
    const pk = this.pick;
    const pr = this.particles;
    const red = motion.reduced;
    if (!red) {
      // legendary outfit: drifting motes around the body
      if (oRar >= 3 && now - e.fxAt > (oRar >= 4 ? 150 : 420)) {
        e.fxAt = now;
        const r = e.seed;
        pr.spawn(PK.Mote, wx + (Math.random() - 0.5) * 11, wy - 5 - Math.random() * 16, (Math.random() - 0.5) * 6, -9 - Math.random() * 6, 1500, oRar >= 4 ? PCOL.legend : PCOL.epic);
        void r;
      }
      // legendary weapon: trailing sparks from the tip while it moves, embers otherwise
      if (wRar >= 4 && spr.tip && now - e.fx2At > 60) {
        const swinging = pk.state === 'attack' || pk.state === 'walk' || pk.state === 'run' || pk.state === 'draw';
        if (swinging || now % 300 < 20) {
          e.fx2At = now;
          pr.spawn(PK.Spark, dx + spr.tip[0] + ax0, dy + spr.tip[1] + ay0, (Math.random() - 0.5) * 16, -6 - Math.random() * 10, swinging ? 420 : 700, Math.random() < 0.5 ? PCOL.legend : PCOL.gold);
        }
      } else if (wRar === 3 && spr.tip && pk.state === 'attack' && now - e.fx2At > 90) {
        e.fx2At = now;
        pr.spawn(PK.Spark, dx + spr.tip[0] + ax0, dy + spr.tip[1] + ay0, (Math.random() - 0.5) * 12, -4, 360, PCOL.epic);
      }
      // cauldron steam
      if (pk.state === 'craft' && now - e.fxAt > 130) {
        e.fxAt = now;
        pr.spawn(PK.Steam, wx + (mirror ? -1 : 1) * 9 + (Math.random() - 0.5) * 3, wy - 8, (Math.random() - 0.5) * 6, -16 - Math.random() * 8, 1100, PCOL.steam);
      }
    }
    // celebration confetti
    if (!red && e.v.act === 'celebrate' && pk.state === 'cheer' && now - e.fxAt > 110) {
      e.fxAt = now;
      pr.spawn(PK.Spark, wx + (Math.random() - 0.5) * 12, wy - 20 - Math.random() * 6, (Math.random() - 0.5) * 30, -20 - Math.random() * 14, 800, Math.random() < 0.34 ? PCOL.legend : Math.random() < 0.5 ? PCOL.rare : PCOL.gold);
    }
    // resting: drifting z
    if (pk.chatIcon === 2) {
      const ph = (now / 1400 + e.seed) % 1;
      const bx = Math.round(dx + spr.ax + (mirror ? -4 : 4) + ph * (mirror ? -4 : 4));
      const by = Math.round(dy + (spr.top ?? 0) - 2 - ph * 8);
      s.globalAlpha = Math.sin(ph * Math.PI);
      s.fillStyle = '#f4f0ff';
      s.fillRect(bx, by, 3, 1);
      s.fillRect(bx + 1, by + 1, 1, 1);
      s.fillRect(bx, by + 2, 3, 1);
      s.globalAlpha = 1;
    }
    // chat bubble icon (no text)
    if (pk.chatIcon === 1) {
      const bx = Math.round(dx + spr.ax + (mirror ? -6 : 6));
      const by = Math.round(dy + (spr.top ?? 0) - 4 - (Math.floor(now / 260) % 2));
      s.fillStyle = '#2a1e16';
      s.fillRect(bx - 4, by - 1, 9, 6);
      s.fillStyle = '#f6efd8';
      s.fillRect(bx - 3, by, 7, 4);
      s.fillRect(mirror ? bx + 2 : bx - 3, by + 4, 2, 2);
      s.fillStyle = '#2a1e16';
      s.fillRect(bx - 2, by + 2, 1, 1);
      s.fillRect(bx, by + 2, 1, 1);
      s.fillRect(bx + 2, by + 2, 1, 1);
    }
  }

  private meditateAura(s: CanvasRenderingContext2D, e: Ent, ax: number, ay: number, spr: FlashSprite, now: number, wx: number, wy: number): void {
    const rank = e.v.rank ?? Math.min(8, 1 + Math.floor((e.v.lv ?? 1) / 12));
    const pulse = motion.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 900 + e.seed * 6.28);
    const r = 12 + rank * 1.5;
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = 0.28 + pulse * 0.22;
    const d = this.bank.glowDisc(0xffffe89f, Math.round(r));
    s.drawImage(d, ax - r, ay - (spr.ay >> 1) - r * 0.7, r * 2, r * 1.6);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    if (!motion.reduced && now - e.fxAt > 560 - rank * 50) {
      e.fxAt = now;
      this.particles.spawn(PK.Mote, wx + (Math.random() - 0.5) * (9 + rank * 1.5), wy - 2 - Math.random() * 8, (Math.random() - 0.5) * 5, -9 - Math.random() * 8 - rank, 1700, PCOL.qi);
    }
  }

  private aura(s: CanvasRenderingContext2D, x: number, y: number, color: number, now: number, radius: number, strength = 1): void {
    const pulse = motion.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 340);
    const r = radius + pulse * 2;
    s.globalCompositeOperation = 'lighter';
    s.globalAlpha = Math.min(1, (0.5 + pulse * 0.14) * strength);
    const d = this.bank.glowDisc(color, Math.round(r));
    s.drawImage(d, x - r, y - r * 0.8, r * 2, r * 1.6);
    s.globalAlpha = 1;
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
