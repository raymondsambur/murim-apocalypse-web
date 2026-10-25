/**
 * Device-resolution overlays drawn after the pixel scene is blitted: name plates, HP bars and speech bubbles.
 * Plates and bubbles are rendered once into small cached canvases.
 */
import { makeCanvas } from '../art/canvas';
import { NAME_COLORS } from '../art/palette';
import type { Ent } from './entities';

const RANK_COLORS = ['#d8e4f2', '#b8e6c8', '#9edcff', '#ffe08a', '#ffb36a', '#ff9ad2', '#d6a6ff', '#ff8a8a'];

export function nameColor(e: Ent, selfId: number | null): string {
  const v = e.v;
  if (v.id === selfId) return NAME_COLORS.self;
  if (v.kind === 'monster') return v.elite === 2 ? NAME_COLORS.boss : v.elite === 1 ? NAME_COLORS.elite : NAME_COLORS.hostile;
  if (v.kind === 'node') return NAME_COLORS.node;
  if (v.kind === 'player') {
    if (v.online === false) return NAME_COLORS.offline;
    return RANK_COLORS[Math.max(0, Math.min(7, (v.rank ?? 1) - 1))];
  }
  if (v.role === 'villager' || v.role === 'wanderer') return NAME_COLORS.villager;
  if (v.role === 'master') return '#ffd98a';
  if (v.role === 'legend') return '#ff9ad2';
  return NAME_COLORS.npc;
}

const FONT = 'Georgia, "Times New Roman", serif';

function plateCanvas(name: string, tag: string | undefined, lv: number | undefined, color: string, scale: number, accent: string | null): HTMLCanvasElement {
  const nameSize = Math.round(12 * scale);
  const tagSize = Math.round(10 * scale);
  const pad = Math.round(3 * scale);
  const m = makeCanvas(8, 8).getContext('2d')!;
  m.font = `600 ${nameSize}px ${FONT}`;
  const lvText = lv !== undefined ? `Lv.${lv} ` : '';
  const lvSize = Math.round(10 * scale);
  m.font = `600 ${lvSize}px ${FONT}`;
  const lvW = lvText ? m.measureText(lvText).width : 0;
  m.font = `600 ${nameSize}px ${FONT}`;
  const nameW = m.measureText(name).width;
  m.font = `${tagSize}px ${FONT}`;
  const tagW = tag ? m.measureText(tag).width : 0;
  const w = Math.ceil(Math.max(lvW + nameW, tagW) + pad * 2 + 4);
  const rowH = nameSize + 2;
  const h = rowH + (tag ? tagSize + 3 : 0) + pad;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  let y = pad / 2 + (tag ? tagSize : 0) + (tag ? 3 : 0) + nameSize - 2;
  if (tag) {
    g.font = `${tagSize}px ${FONT}`;
    g.textAlign = 'center';
    g.lineWidth = Math.max(2, Math.round(tagSize * 0.28));
    g.strokeStyle = 'rgba(16,10,24,0.85)';
    g.strokeText(tag, w / 2, tagSize + pad / 2);
    g.fillStyle = accent ?? '#d9b867';
    g.fillText(tag, w / 2, tagSize + pad / 2);
  }
  const startX = (w - (lvW + nameW)) / 2;
  g.textAlign = 'left';
  if (lvText) {
    g.font = `600 ${lvSize}px ${FONT}`;
    g.lineWidth = Math.max(2, Math.round(lvSize * 0.28));
    g.strokeStyle = 'rgba(16,10,24,0.85)';
    g.strokeText(lvText, startX, y);
    g.fillStyle = 'rgba(235,225,200,0.85)';
    g.fillText(lvText, startX, y);
  }
  g.font = `600 ${nameSize}px ${FONT}`;
  g.lineWidth = Math.max(2, Math.round(nameSize * 0.24));
  g.strokeStyle = 'rgba(16,10,24,0.9)';
  g.strokeText(name, startX + lvW, y);
  g.fillStyle = color;
  g.fillText(name, startX + lvW, y);
  return c;
}

function bubbleCanvas(text: string, scale: number): HTMLCanvasElement {
  const size = Math.round(12 * scale);
  const pad = Math.round(6 * scale);
  const maxW = Math.round(170 * scale);
  const probe = makeCanvas(8, 8).getContext('2d')!;
  probe.font = `${size}px ${FONT}`;
  const words = text.slice(0, 140).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? `${cur} ${wd}` : wd;
    if (probe.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = wd;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  const lh = Math.round(size * 1.25);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, probe.measureText(l).width);
  const w = Math.ceil(tw + pad * 2);
  const h = lines.length * lh + pad * 2 - 2;
  const tail = Math.round(6 * scale);
  const c = makeCanvas(w, h + tail + 2);
  const g = c.getContext('2d')!;
  const r = Math.round(5 * scale);
  g.fillStyle = 'rgba(246,239,216,0.96)';
  g.strokeStyle = 'rgba(70,50,30,0.9)';
  g.lineWidth = Math.max(1, Math.round(scale));
  g.beginPath();
  g.moveTo(r, 0.5);
  g.arcTo(w - 0.5, 0.5, w - 0.5, h, r);
  g.arcTo(w - 0.5, h, 0.5, h, r);
  g.arcTo(0.5, h, 0.5, 0.5, r);
  g.arcTo(0.5, 0.5, w - 0.5, 0.5, r);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(w / 2 - tail, h - 0.5);
  g.lineTo(w / 2, h + tail);
  g.lineTo(w / 2 + tail, h - 0.5);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(246,239,216,0.96)';
  g.fillRect(w / 2 - tail + 1, h - 1.5, tail * 2 - 2, 2);
  g.fillStyle = '#2a1e16';
  g.font = `${size}px ${FONT}`;
  g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, pad, pad - 1 + i * lh));
  return c;
}

export class Overlay {
  private bubbles = new Map<number, { cv: HTMLCanvasElement; key: string }>();

  setBubble(e: Ent, text: string, now: number): void {
    e.bubble = text;
    e.bubbleAt = now;
    e.bubbleUntil = now + Math.min(7500, 2800 + text.length * 70);
    this.bubbles.delete(e.id);
  }

  forget(id: number): void {
    this.bubbles.delete(id);
  }

  /**
   * Draw plates, HP bars and bubbles. `P` is device px per scene px; `selfPos` is the self entity (for node proximity).
   */
  draw(ctx: CanvasRenderingContext2D, ents: readonly Ent[], P: number, dpr: number, zoom: number, now: number, selfId: number | null, selectedId: number | null, hoverId: number | null): void {
    const zs = Math.max(0.9, Math.min(1.2, 0.8 + zoom * 0.22));
    const scale = dpr * zs;
    const self = selfId !== null ? ents.find((e) => e.id === selfId) : undefined;
    // plate budget: when crowded keep the important ones
    let crowded = ents.length > 40;
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i];
      const v = e.v;
      if (v.kind === 'node') {
        const near = self ? Math.hypot(self.x - e.x, self.y - e.y) < 5 : false;
        if (!(near || selectedId === e.id || hoverId === e.id)) continue;
      } else if (crowded && v.kind === 'npc' && v.role === 'villager' && selectedId !== e.id && hoverId !== e.id && zoom < 1.1) continue;
      const x = e.sx * P;
      let y = (e.sy - e.topPx) * P - 4 * dpr;
      const color = nameColor(e, selfId);
      const lv = v.kind === 'monster' ? v.lv : undefined;
      const tag = v.tag;
      const key = `${v.name}|${tag ?? ''}|${lv ?? ''}|${color}|${scale.toFixed(2)}`;
      if (e.plateKey !== key || !e.plate) {
        e.plate = plateCanvas(v.name, tag, lv, color, scale, v.faction ? null : null);
        e.plateKey = key;
      }
      const showHp = v.hp !== undefined && v.maxHp !== undefined && v.maxHp > 0 && (v.kind === 'monster' || v.state === 'fight' || selectedId === e.id || v.hp < v.maxHp);
      if (showHp && v.kind !== 'node') {
        const bw = Math.round((v.kind === 'monster' ? 34 : 30) * scale);
        const bh = Math.max(3, Math.round(4 * scale));
        const frac = Math.max(0, Math.min(1, v.hp! / v.maxHp!));
        const bx = Math.round(x - bw / 2);
        const by = Math.round(y);
        ctx.fillStyle = 'rgba(14,8,18,0.85)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = '#3a2024';
        ctx.fillRect(bx, by, bw, bh);
        const col = v.kind === 'monster' ? (frac > 0.5 ? '#d8453a' : frac > 0.25 ? '#e8742e' : '#f0a020') : frac > 0.5 ? '#58c46a' : frac > 0.25 ? '#d6b83a' : '#e0503a';
        ctx.fillStyle = col;
        ctx.fillRect(bx, by, Math.round(bw * frac), bh);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(bx, by, Math.round(bw * frac), 1);
        y -= bh + 3 * dpr;
      }
      if (v.state !== 'dead') ctx.drawImage(e.plate, Math.round(x - e.plate.width / 2), Math.round(y - e.plate.height));
      // speech bubble
      if (e.bubble && now < e.bubbleUntil) {
        let b = this.bubbles.get(e.id);
        if (!b || b.key !== e.bubble + scale.toFixed(2)) {
          b = { cv: bubbleCanvas(e.bubble, scale), key: e.bubble + scale.toFixed(2) };
          this.bubbles.set(e.id, b);
        }
        const fade = Math.min(1, (e.bubbleUntil - now) / 400, (now - e.bubbleAt) / 120 + 0.2);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.drawImage(b.cv, Math.round(x - b.cv.width / 2), Math.round(y - e.plate.height - b.cv.height - 2 * dpr));
        ctx.globalAlpha = 1;
      } else if (e.bubble) {
        e.bubble = null;
        this.bubbles.delete(e.id);
      }
    }
    crowded = false;
  }
}
