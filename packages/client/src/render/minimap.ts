/**
 * Minimap: whole-world map drawn into a caller-provided canvas. Terrain and roads are cached once, the Blight layer is
 * rebuilt only when the Blight map changes, everything else (settlements, entities, camera frustum) is drawn live.
 */
import { O, T } from '@murim/shared';
import { hex, cb, cg, cr } from '../art/color';
import { factionColor, MINIMAP_CSS } from '../art/palette';
import { makeCanvas } from '../art/canvas';
import type { MinimapOptions } from './api';
import type { Ent } from './entities';
import type { WorldModel } from './world';

export interface MapRect {
  x0: number;
  y0: number;
  scale: number;
}

/** Fit the whole world into a canvas (contain). Pure. */
export function mapRect(cw: number, ch: number, w: number, h: number): MapRect {
  const scale = Math.min(cw / w, ch / h);
  return { x0: (cw - w * scale) / 2, y0: (ch - h * scale) / 2, scale };
}

/** Canvas pixel -> world tile (continuous), clamped to the world. Pure. */
export function mapToTile(rect: MapRect, px: number, py: number, w: number, h: number): { x: number; y: number } {
  const x = (px - rect.x0) / rect.scale - 0.5;
  const y = (py - rect.y0) / rect.scale - 0.5;
  return { x: Math.max(0, Math.min(w - 1, Math.round(x))), y: Math.max(0, Math.min(h - 1, Math.round(y))) };
}

const TERRAIN_RGB: [number, number, number][] = MINIMAP_CSS.map((c) => {
  const k = hex(c);
  return [cr(k), cg(k), cb(k)];
});

export class Minimap {
  private terrainCv: HTMLCanvasElement;
  private blightCv: HTMLCanvasElement;
  private blightVersion = -1;

  constructor(private world: WorldModel) {
    const { w, h } = world;
    this.terrainCv = makeCanvas(w, h);
    this.blightCv = makeCanvas(w, h);
    this.buildTerrain();
  }

  private buildTerrain(): void {
    const w = this.world;
    const g = this.terrainCv.getContext('2d')!;
    const img = g.createImageData(w.w, w.h);
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        const i = y * w.w + x;
        const t = w.terrain[i];
        let [r, gg, b] = TERRAIN_RGB[t] ?? [90, 90, 90];
        // soft relief so mountains and hills read
        if (t === T.Rock) {
          const k = 0.8 + Math.min(0.5, w.rockDist[i] * 0.05) + (((x * 7 + y * 3) & 3) - 1.5) * 0.03;
          r *= k;
          gg *= k;
          b *= k;
        } else if (t === T.Forest || t === T.Hill) {
          const k = 0.94 + (((x * 5 + y * 11) & 7) - 3.5) * 0.012;
          r *= k;
          gg *= k;
          b *= k;
        }
        const o = w.objects[i];
        if (o === O.Building) {
          r = 118;
          gg = 78;
          b = 54;
        } else if (o === O.Wall) {
          r = 86;
          gg = 86;
          b = 94;
        } else if (o === O.Pine || o === O.Oak || o === O.Bamboo) {
          r *= 0.82;
          gg *= 0.9;
          b *= 0.82;
        }
        const j = i * 4;
        img.data[j] = r;
        img.data[j + 1] = gg;
        img.data[j + 2] = b;
        img.data[j + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  private buildBlight(): void {
    const w = this.world;
    const g = this.blightCv.getContext('2d')!;
    const img = g.createImageData(w.w, w.h);
    for (let i = 0; i < w.w * w.h; i++) {
      const v = w.blight[i];
      if (v < 12) continue;
      const j = i * 4;
      img.data[j] = 150 + (v >> 3);
      img.data[j + 1] = 40;
      img.data[j + 2] = 210;
      img.data[j + 3] = Math.min(210, v * 0.8);
    }
    g.putImageData(img, 0, 0);
  }

  /** Mark the Blight layer stale (call after the Blight map changed). */
  invalidate(): void {
    this.blightVersion = -1;
  }

  draw(canvas: HTMLCanvasElement, opts: MinimapOptions | undefined, ents: Iterable<Ent>, selfId: number | null, frustum: [number, number][] | null, now: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = this.world;
    const cw = canvas.width;
    const ch = canvas.height;
    const rect = mapRect(cw, ch, w.w, w.h);
    ctx.save();
    ctx.fillStyle = '#0b141d';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrainCv, rect.x0, rect.y0, w.w * rect.scale, w.h * rect.scale);
    if (opts?.blight !== false) {
      if (this.blightVersion < 0) {
        this.buildBlight();
        this.blightVersion = 1;
      }
      ctx.drawImage(this.blightCv, rect.x0, rect.y0, w.w * rect.scale, w.h * rect.scale);
    }
    ctx.imageSmoothingEnabled = false;
    const tx = (x: number): number => rect.x0 + (x + 0.5) * rect.scale;
    const ty = (y: number): number => rect.y0 + (y + 0.5) * rect.scale;
    const px = Math.max(1, Math.round(canvas.width / 160));

    if (opts?.settlements !== false) {
      const showNames = cw >= 150;
      ctx.font = `${Math.max(8, Math.round(cw / 26))}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const s of w.settlements) {
        const st = w.status.get(s.id);
        const fallen = st?.status === 'fallen' || s.kind === 'ruin';
        const besieged = st?.siege === true || st?.status === 'besieged';
        const x = tx(s.x);
        const y = ty(s.y);
        const col = st?.controller ? (factionColor(st.controller) ?? '#d9b867') : '#d9b867';
        const r = (s.kind === 'town' || s.kind === 'sectHall' || s.kind === 'fort' ? 3.4 : 2.6) * px * 0.9;
        if (besieged) {
          const p = (now / 700) % 1;
          ctx.strokeStyle = `rgba(255,90,60,${1 - p})`;
          ctx.lineWidth = px;
          ctx.beginPath();
          ctx.arc(x, y, r + 2 + p * 8 * px, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (fallen) {
          ctx.strokeStyle = '#ff4a3a';
          ctx.lineWidth = Math.max(2, px * 1.4);
          ctx.beginPath();
          ctx.moveTo(x - r, y - r);
          ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r);
          ctx.lineTo(x - r, y + r);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(12,8,16,0.9)';
          ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
          ctx.fillStyle = col;
          if (s.kind === 'fort') ctx.fillRect(x - r, y - r, r * 2, r * 2);
          else {
            ctx.beginPath();
            ctx.moveTo(x, y - r - 1);
            ctx.lineTo(x + r + 1, y);
            ctx.lineTo(x, y + r + 1);
            ctx.lineTo(x - r - 1, y);
            ctx.closePath();
            ctx.fill();
          }
        }
        if (showNames) {
          const name = s.name;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(10,6,14,0.9)';
          ctx.strokeText(name, x, y + r + 2);
          ctx.fillStyle = fallen ? '#ff8a7a' : '#f1e6c8';
          ctx.fillText(name, x, y + r + 2);
        }
      }
    }

    if (opts?.entities !== false) {
      for (const e of ents) {
        const v = e.v;
        if (v.kind === 'node') {
          if (v.nodeKind === 'heart') {
            ctx.fillStyle = '#d58aff';
            const x = tx(e.x);
            const y = ty(e.y);
            ctx.fillRect(x - px * 1.5, y - px * 1.5, px * 3, px * 3);
          }
          continue;
        }
        if (e.id === selfId) continue;
        ctx.fillStyle = v.kind === 'monster' ? '#ff5a4a' : v.kind === 'player' ? '#6aa8ff' : '#f3d65a';
        ctx.fillRect(Math.round(tx(e.x) - px / 2), Math.round(ty(e.y) - px / 2), px, px);
      }
      const self = selfId !== null ? [...[]] : [];
      void self;
    }

    if (frustum) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, px * 0.8);
      ctx.beginPath();
      frustum.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(tx(x), ty(y)) : ctx.lineTo(tx(x), ty(y))));
      ctx.closePath();
      ctx.stroke();
    }

    if (selfId !== null && opts?.entities !== false) {
      for (const e of ents) {
        if (e.id !== selfId) continue;
        const x = tx(e.x);
        const y = ty(e.y);
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        ctx.fillStyle = 'rgba(12,8,16,0.9)';
        ctx.fillRect(x - px * 2.5, y - px * 2.5, px * 5, px * 5);
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(x - px * 1.5, y - px * 1.5, px * 3, px * 3);
        ctx.strokeStyle = `rgba(255,243,196,${0.8 - pulse * 0.6})`;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(x, y, px * (4 + pulse * 3), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  toTile(canvas: HTMLCanvasElement, px: number, py: number): { x: number; y: number } {
    const rect = mapRect(canvas.width, canvas.height, this.world.w, this.world.h);
    return mapToTile(rect, px, py, this.world.w, this.world.h);
  }
}
