/**
 * GameView: the world renderer. Draws everything into a low-resolution "scene" canvas (1 pixel = 1 art pixel),
 * then blits it to the visible canvas with nearest-neighbour scaling so the look stays crisp pixel art at any zoom.
 * Text overlays (name plates, floating numbers, speech bubbles) are drawn at device resolution on top.
 */
import { TILE_H, TILE_W, type CombatEvent, type EntityPatch, type EntityView, type FxKind, type SettlementView, type TimeView } from '@murim/shared';
import type { DecodedWorld, GameViewApi, MinimapOptions, PickGesture, PickResult } from './api';
import { Camera } from './camera';
import { ChunkManager } from './chunks';
import { WorldClock } from './clock';
import { EntityStore, type Ent } from './entities';
import { Fx } from './fx';
import { InputController, type GestureEvent } from './input';
import { ART, clampZoom, cssToTile, makeFrameXf, snapZoom, tileToWorld, worldToTile, type FrameXf } from './iso';
import { ambientAt, rgbStr, type Ambient } from './lighting';
import { Minimap } from './minimap';
import { Overlay } from './overlay';
import { SceneRenderer } from './scene';
import { SpriteBank } from './sprites';
import { Weather } from './weather';
import { WorldModel } from './world';

const BG = '#0d1823';

export class GameView implements GameViewApi {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private input: InputController;
  private raf = 0;
  private running = false;
  private last = 0;
  private dpr = 1;
  private devW = 0;
  private devH = 0;
  private cssW = 0;
  private cssH = 0;

  world: WorldModel | null = null;
  chunks: ChunkManager | null = null;
  bank: SpriteBank | null = null;
  sceneR: SceneRenderer | null = null;
  minimap: Minimap | null = null;
  readonly ents = new EntityStore();
  readonly cam = new Camera();
  readonly clock = new WorldClock();
  readonly fxs = new Fx();
  readonly weather = new Weather();
  private overlay = new Overlay();
  private xf: FrameXf = makeFrameXf(0, 0, 1, 1, 1, 1);
  private pickCb: ((p: PickResult, g: PickGesture) => void) | null = null;
  private wheelAcc = 0;
  private selfId: number | null = null;
  private selectedId: number | null = null;
  private hoverId: number | null = null;
  private ambient: Ambient = { r: 255, g: 255, b: 255, night: 0 };
  private burst = 0;
  private follow = { x: 0, y: 0 };
  /** Diagnostics for the sandbox. */
  stats = { fps: 0, frameMs: 0, chunksBuilt: 0, entities: 0, drawn: 0, hours: 0 };
  private fpsAcc = 0;
  private fpsFrames = 0;
  private frameNo = 0;
  private scratch = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.scene = document.createElement('canvas');
    this.sctx = this.scene.getContext('2d', { alpha: false })!;
    const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 640;
    this.cam.zoom = this.cam.targetZoom = small ? 0.75 : 1.5;
    this.input = new InputController(canvas, {
      gesture: (e) => this.onGesture(e),
      wheel: (dy, x, y) => this.onWheel(dy, x, y),
    });
    this.resize();
    this.cam.zoom = this.cam.targetZoom = snapZoom(this.cam.targetZoom, this.dpr);
  }

  // ---- lifecycle ---------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.devW = w;
    this.devH = h;
    this.cam.targetZoom = snapZoom(this.cam.targetZoom, dpr);
  }

  // ---- data ---------------------------------------------------------------------

  loadWorld(world: DecodedWorld): void {
    this.world = new WorldModel(world);
    this.chunks = new ChunkManager(this.world);
    this.bank = new SpriteBank(this.world);
    this.sceneR = new SceneRenderer(this.world, this.bank, this.ents);
    this.minimap = new Minimap(this.world);
    this.applySeason(this.clock.season);
    this.ents.clear();
    const s = world.payload.settlements[0];
    if (s) this.centerOn(s.spawn.x, s.spawn.y, true);
  }

  private applySeason(season: number): void {
    if (!this.bank || !this.chunks) return;
    if (this.bank.season !== season) {
      this.bank.setSeason(season);
      this.bank.clearSeasonal();
    }
    this.chunks.setSeason(season);
  }

  setSelf(entityId: number): void {
    this.selfId = entityId;
    if (this.sceneR) this.sceneR.selfId = entityId;
    const e = this.ents.map.get(entityId);
    if (e) this.centerOn(e.x, e.y, true);
  }

  applyEntities(delta: { add?: EntityView[]; upd?: EntityPatch[]; del?: number[] }): void {
    const now = performance.now();
    if (delta.add)
      for (const v of delta.add) {
        const e = this.ents.add(v, now);
        if (v.id === this.selfId && !this.snapped) {
          this.snapped = true;
          this.centerOn(e.x, e.y, true);
        }
      }
    if (delta.upd)
      for (const p of delta.upd) {
        this.ents.patch(p, now);
        if (p.id === this.selfId && ('x' in p || 'y' in p || 'nx' in p)) this.cam.attach();
      }
    if (delta.del)
      for (const id of delta.del) {
        this.ents.remove(id);
        this.overlay.forget(id);
        if (this.selectedId === id) this.selectedId = null;
      }
  }
  private snapped = false;

  clearEntities(): void {
    this.ents.clear();
    this.snapped = false;
  }

  setTime(time: TimeView): void {
    this.clock.set(time, performance.now());
    this.applySeason(this.clock.season);
  }

  setBlight(data: Uint8Array): void {
    if (!this.world) return;
    this.world.blight.set(data.subarray(0, this.world.blight.length));
    this.chunks?.invalidateAll();
    this.minimap?.invalidate();
  }

  patchBlight(idx: number[], val: number[]): void {
    const w = this.world;
    if (!w) return;
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i];
      if (k < 0 || k >= w.blight.length) continue;
      w.blight[k] = val[i] ?? 0;
      this.chunks?.invalidateTile(k % w.w, Math.floor(k / w.w));
    }
    this.minimap?.invalidate();
  }

  setSettlements(list: SettlementView[]): void {
    if (!this.world) return;
    for (const s of list) this.world.status.set(s.id, s);
    this.sceneR?.invalidateOwners();
  }

  combatEvents(events: CombatEvent[]): void {
    const now = performance.now();
    const pos = (id: number): { x: number; y: number } | null => {
      const e = this.ents.map.get(id);
      return e ? { x: e.x, y: e.y } : null;
    };
    for (const ev of events)
      this.fxs.combat(ev, now, pos, this.selfId, (a, d, crit) => {
        const ae = this.ents.map.get(a);
        if (ae) ae.attackAt = now;
        const de = this.ents.map.get(d);
        if (de) {
          de.hitAt = now;
          de.crit = crit;
        }
      });
  }

  fx(kind: FxKind, entityId?: number, text?: string): void {
    const now = performance.now();
    const e = entityId !== undefined ? this.ents.map.get(entityId) : this.selfId !== null ? this.ents.map.get(this.selfId) : undefined;
    let x: number;
    let y: number;
    if (e) {
      x = e.x;
      y = e.y;
    } else {
      const t = worldToTile(this.cam.x, this.cam.y);
      x = t.x;
      y = t.y;
    }
    this.fxs.fx(kind, e ? e.id : 0, x, y, now, text);
  }

  say(entityId: number, text: string): void {
    const e = this.ents.map.get(entityId);
    if (e && text) this.overlay.setBubble(e, text, performance.now());
  }

  setMoveTarget(tile: { x: number; y: number } | null): void {
    if (!this.sceneR) return;
    this.sceneR.moveTarget = tile ? { x: tile.x, y: tile.y } : null;
    this.sceneR.moveTargetAt = performance.now();
  }

  setSelected(entityId: number | null): void {
    this.selectedId = entityId;
    if (this.sceneR) this.sceneR.selectedId = entityId;
  }

  onPick(cb: (pick: PickResult, gesture: PickGesture) => void): void {
    this.pickCb = cb;
  }

  centerOn(x: number, y: number, instant = false): void {
    const w = tileToWorld(x, y);
    const self = this.selfId !== null ? this.ents.map.get(this.selfId) : undefined;
    const attach = !self || Math.hypot(self.x - x, self.y - y) < 1.2;
    this.cam.centerOn(w.sx, w.sy, instant, attach);
    if (instant) this.burst = 8;
  }

  setZoom(zoom: number): void {
    this.cam.setZoomTarget(snapZoom(clampZoom(zoom), this.dpr));
  }

  getZoom(): number {
    return this.cam.targetZoom;
  }

  getEntity(id: number): EntityView | undefined {
    return this.ents.map.get(id)?.v;
  }

  nearby(radius: number): EntityView[] {
    const self = this.selfId !== null ? this.ents.map.get(this.selfId) : undefined;
    let cx: number;
    let cy: number;
    if (self) {
      cx = self.v.x;
      cy = self.v.y;
    } else {
      const t = worldToTile(this.cam.x, this.cam.y);
      cx = t.x;
      cy = t.y;
    }
    const out: { v: EntityView; d: number }[] = [];
    for (const e of this.ents.map.values()) {
      if (e.id === this.selfId) continue;
      const d = Math.hypot(e.v.x - cx, e.v.y - cy);
      if (d <= radius) out.push({ v: e.v, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.v);
  }

  drawMinimap(canvas: HTMLCanvasElement, opts?: MinimapOptions): void {
    if (!this.minimap) return;
    const xf = this.xf;
    const corners: [number, number][] = [];
    for (const [cx, cy] of [
      [0, 0],
      [this.cssW, 0],
      [this.cssW, this.cssH],
      [0, this.cssH],
    ]) {
      const t = cssToTile(xf, cx, cy);
      corners.push([t.x, t.y]);
    }
    this.minimap.draw(canvas, opts, this.ents.map.values(), this.selfId, corners, performance.now());
  }

  minimapToTile(canvas: HTMLCanvasElement, px: number, py: number): { x: number; y: number } {
    if (!this.minimap) return { x: Math.round(px), y: Math.round(py) };
    return this.minimap.toTile(canvas, px, py);
  }

  // ---- input ----------------------------------------------------------------------

  private onWheel(deltaY: number, x: number, y: number): void {
    this.wheelAcc += deltaY;
    if (Math.abs(this.wheelAcc) < 40) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    const unit = Math.max(1 / (ART * this.dpr), 0.25);
    const next = snapZoom(clampZoom(this.cam.targetZoom + dir * unit), this.dpr);
    this.zoomAt(next, x, y);
  }

  private zoomAt(zoom: number, cssX: number, cssY: number): void {
    const cam = this.cam;
    if (cam.detached) {
      const sxo = cssX - this.cssW / 2;
      const syo = cssY - this.cssH / 2;
      cam.setZoomTarget(zoom, { wx: cam.x + sxo / cam.zoom, wy: cam.y + syo / cam.zoom, sx: sxo, sy: syo });
    } else cam.setZoomTarget(zoom);
  }

  private onGesture(e: GestureEvent): void {
    switch (e.k) {
      case 'pan':
        this.cam.panBy(-e.dx / this.cam.zoom, -e.dy / this.cam.zoom);
        break;
      case 'pinch':
        this.cam.setZoomTarget(clampZoom(this.cam.targetZoom * e.scale));
        break;
      case 'tap':
        if (e.button === 0) this.emitPick(e.x, e.y, 'tap');
        break;
      case 'context':
        this.emitPick(e.x, e.y, 'context');
        break;
      case 'hover':
        this.emitPick(e.x, e.y, 'hover');
        break;
    }
  }

  /** Entity id under a css-pixel point (topmost drawn sprite, with tolerance), or null. */
  pickEntity(cssX: number, cssY: number): number | null {
    const sr = this.sceneR;
    if (!sr) return null;
    const P = this.xf.P;
    const sx = (cssX * this.dpr) / P;
    const sy = (cssY * this.dpr) / P;
    const tol = (5 * this.dpr) / P;
    const list = sr.drawnEnts;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.v.kind === 'node' && e.v.nodeKind !== 'heart' && false) continue;
      const x0 = e.sx - e.halfW - tol;
      const x1 = e.sx + e.halfW + tol;
      const y0 = e.sy - e.topPx - tol;
      const y1 = e.sy + 3 + tol;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return e.id;
    }
    return null;
  }

  private emitPick(cssX: number, cssY: number, g: PickGesture): void {
    if (!this.world) return;
    const t = cssToTile(this.xf, cssX, cssY);
    const x = Math.max(0, Math.min(this.world.w - 1, Math.round(t.x)));
    const y = Math.max(0, Math.min(this.world.h - 1, Math.round(t.y)));
    const id = this.pickEntity(cssX, cssY);
    if (g === 'hover') this.hoverId = id;
    this.pickCb?.({ x, y, entityId: id }, g);
  }

  // ---- frame ------------------------------------------------------------------------

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.frameNo++;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.stats.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.canvas.clientWidth !== this.cssW || this.canvas.clientHeight !== this.cssH) this.resize();

    this.ents.update(now);
    this.fxs.update(now);
    // camera follows the local player
    let follow: { x: number; y: number } | null = null;
    const self = this.selfId !== null ? this.ents.map.get(this.selfId) : undefined;
    if (self) {
      const w = tileToWorld(self.x, self.y);
      this.follow.x = w.sx;
      this.follow.y = w.sy;
      follow = this.follow;
    }
    this.cam.update(dt, follow);
    this.clampCamera();
    const cam = this.cam;
    const xf = makeFrameXf(cam.x, cam.y, cam.zoom, this.dpr, this.devW, this.devH);
    this.xf = xf;
    const sc = this.scene;
    if (sc.width !== xf.bw || sc.height !== xf.bh) {
      sc.width = xf.bw;
      sc.height = xf.bh;
    }
    const s = this.sctx;
    s.imageSmoothingEnabled = false;
    s.fillStyle = BG;
    s.fillRect(0, 0, xf.bw, xf.bh);

    if (this.world && this.chunks && this.bank && this.sceneR) {
      const ax0 = xf.camAX - xf.cx;
      const ay0 = xf.camAY - xf.cy;
      const centerTile = worldToTile(cam.x, cam.y);
      // weather for the climate band of the local player
      const band = this.world.climateAt(self ? self.y : centerTile.y);
      this.weather.setTarget(this.clock.weather[band] ?? 'clear', this.frameNo < 4);
      this.weather.update(dt, now, xf.bw, xf.bh);
      this.sceneR.wind = this.weather.out.wind;
      const hours = this.clock.hours(now);
      this.stats.hours = hours;
      const amb = ambientAt(hours, this.ambient);

      this.chunks.beginFrame();
      const budget = this.burst >= 8 ? 600 : this.burst > 0 ? 45 : 7;
      if (this.burst > 0) this.burst--;
      const tA = performance.now();
      this.chunks.draw(s, ax0, ay0, ax0 + xf.bw, ay0 + xf.bh, Math.floor(now / 280) % 4, 0.45 + 0.4 * Math.sin(now / 520), budget, Math.floor(centerTile.x / 16), Math.floor(centerTile.y / 16));
      this.stats.chunksBuilt = this.chunks.built;
      const tB = performance.now();
      this.sceneR.draw(s, ax0, ay0, xf.bw, xf.bh, now, dt);
      this.stats.entities = this.ents.map.size;
      this.stats.drawn = this.sceneR.drawnEnts.length;
      this.tm.chunks = tB - tA;
      this.tm.scene = performance.now() - tB;

      // ---- lighting -------------------------------------------------------------------
      const dim = this.weather.out.dim;
      const r = amb.r * dim;
      const g = amb.g * dim;
      const b = amb.b * dim * (1 + (1 - dim) * 0.04);
      if (r < 250 || g < 250 || b < 250) {
        s.globalCompositeOperation = 'multiply';
        s.fillStyle = `rgb(${r | 0},${g | 0},${Math.min(255, b) | 0})`;
        s.fillRect(0, 0, xf.bw, xf.bh);
        s.globalCompositeOperation = 'source-over';
      }
      const night = Math.max(amb.night, (1 - dim) * 0.5);
      if (night > 0.03) {
        s.globalCompositeOperation = 'lighter';
        s.globalAlpha = Math.min(1, night * 0.95);
        for (const gl of this.sceneR.glowLayers) s.drawImage(gl.cv, gl.x, gl.y);
        for (const l of this.sceneR.lights) {
          const rr = Math.max(8, l.r);
          const disc = this.bank.glowDisc(l.c, rr);
          s.globalAlpha = night * 0.5;
          s.drawImage(disc, l.x - rr, l.y - rr * 0.8, rr * 2, rr * 1.6);
        }
        s.globalAlpha = 1;
        s.globalCompositeOperation = 'source-over';
      }
      // ---- effects and weather (not tinted) -------------------------------------------------
      this.fxs.drawWorld(s, now, (e, out) => {
        const ent = e.id ? this.ents.map.get(e.id) : undefined;
        const tx = ent ? ent.x : e.x;
        const ty = ent ? ent.y : e.y;
        out.x = (tx - ty) * 16 - ax0;
        out.y = (tx + ty) * 8 - ay0 + 1;
      });
      this.weather.draw(s, now, xf.bw, xf.bh);
      if (this.fxs.flash > 0.01) {
        s.globalAlpha = this.fxs.flash;
        s.fillStyle = '#f2ecff';
        s.fillRect(0, 0, xf.bw, xf.bh);
        s.globalAlpha = 1;
      }
    }

    const tC = performance.now();
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.drawImage(sc, 0, 0, xf.bw, xf.bh, 0, 0, xf.bw * xf.P, xf.bh * xf.P);
    this.tm.blit = performance.now() - tC;

    if (this.sceneR) {
      const P = xf.P;
      this.overlay.draw(c, this.sceneR.drawnEnts, P, this.dpr, cam.zoom, now, this.selfId, this.selectedId, this.hoverId);
      const ax0 = xf.camAX - xf.cx;
      const ay0 = xf.camAY - xf.cy;
      this.fxs.drawText(c, now, this.dpr * Math.max(0.9, Math.min(1.25, 0.8 + cam.zoom * 0.22)), (f, out) => {
        const ent = f.id ? this.ents.map.get(f.id) : undefined;
        const tx = ent ? ent.x : f.x;
        const ty = ent ? ent.y : f.y;
        const top = ent && ent.drawn ? ent.topPx : 30;
        out.x = ((tx - ty) * 16 - ax0) * P;
        out.y = ((tx + ty) * 8 - ay0 - top - 4) * P;
      });
    }
    this.tm.overlay = performance.now() - tC - this.tm.blit;
    this.stats.frameMs = performance.now() - t0;
  }

  /** Per-section timings (ms) of the last frame, for the sandbox. */
  readonly tm = { chunks: 0, scene: 0, blit: 0, overlay: 0 };

  private clampCamera(): void {
    const w = this.world;
    if (!w) return;
    const t = worldToTile(this.cam.x, this.cam.y);
    const m = 6;
    const cx = Math.max(-m, Math.min(w.w + m, t.x));
    const cy = Math.max(-m, Math.min(w.h + m, t.y));
    if (cx !== t.x || cy !== t.y) {
      const p = tileToWorld(cx, cy);
      this.cam.x = p.sx;
      this.cam.y = p.sy;
    }
  }

  /** Current frame transform (for pickers/overlays). */
  get frameXf(): FrameXf {
    return this.xf;
  }

  /** Entity record (for tests/sandbox). */
  entity(id: number): Ent | undefined {
    return this.ents.map.get(id);
  }
}

export { TILE_H, TILE_W, rgbStr };
