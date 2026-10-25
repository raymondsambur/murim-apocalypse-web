/**
 * Stand-in RenderModule used only while src/render/index.ts does not exist (see ui/renderLoader.ts).
 * Flat coloured diamonds, simple entity markers, picking, minimap and a tiny paper-doll preview:
 * enough to exercise the UI. The real renderer replaces it automatically.
 */
import { STEP_MS, T, type CombatEvent, type EntityPatch, type EntityView, type FxKind, type Look, type SettlementView, type TimeView } from '@murim/shared';
import type { DecodedWorld, GameViewApi, LookPreviewOptions, MinimapOptions, PickGesture, PickResult, RenderModule } from '../../render/api';

const SKIN = ['#f1d1b0', '#e3b98f', '#cf9f74', '#b07c52', '#8c5b3a', '#f5dcc4'];
const HAIR = ['#1b1714', '#3a2a1f', '#5b3b24', '#8a5a2b', '#b9b2a0', '#e8e2cf', '#6b1f1f', '#2a3550'];
const OUTFIT = ['#3d5a80', '#7a2e2e', '#2f5d50', '#5b4a7a', '#8a6d3b', '#3a3a3a', '#d9d2c0', '#2d4a6b', '#6b3a2e', '#4a5d3a'];
const SASH = ['#c8452d', '#d9b867', '#2f5d50', '#1b1714', '#5fa4e8', '#e8e2cf', '#b87ae6', '#7a2e2e'];

const TERRAIN_COLOR: Record<number, string> = {
  [T.DeepWater]: '#14304a',
  [T.Water]: '#1f4a6b',
  [T.Grass]: '#3f5a33',
  [T.Plains]: '#5b6a3a',
  [T.Forest]: '#2c4428',
  [T.Dirt]: '#6b5639',
  [T.Road]: '#7d7363',
  [T.Plaza]: '#8b806c',
  [T.Rock]: '#4b4a4f',
  [T.Hill]: '#5d5a44',
  [T.Sand]: '#a08f62',
  [T.Snow]: '#c9cfd6',
  [T.Bridge]: '#7a5a3a',
  [T.Farm]: '#6f6a2f',
  [T.Ruin]: '#4e4740',
};

const KIND_COLOR: Record<string, string> = { player: '#d9b867', npc: '#5cc29a', monster: '#c8452d', node: '#7ec26b' };

interface Tracked {
  v: EntityView;
  /** Start of the current step (performance.now()). */
  t0: number;
}

interface Floater {
  wx: number;
  wy: number;
  text: string;
  color: string;
  t0: number;
}

function iso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * 32, y: (x + y) * 16 };
}

function createGameView(canvas: HTMLCanvasElement): GameViewApi {
  const ctx = canvas.getContext('2d')!;
  let world: DecodedWorld | null = null;
  const ents = new Map<number, Tracked>();
  let selfId: number | null = null;
  let selected: number | null = null;
  let moveTarget: { x: number; y: number } | null = null;
  let zoom = 1;
  let cam = { x: 0, y: 0 };
  let follow = true;
  let raf = 0;
  let dpr = 1;
  let time: TimeView | null = null;
  const floaters: Floater[] = [];
  const bubbles = new Map<number, { text: string; until: number }>();
  const pickCbs: ((p: PickResult, g: PickGesture) => void)[] = [];
  let miniCache: HTMLCanvasElement | null = null;

  const pos = (tr: Tracked, now: number) => {
    const v = tr.v;
    if (v.nx !== undefined && v.ny !== undefined && v.step) {
      const k = Math.min(1, (now - tr.t0) / v.step);
      return { x: v.x + (v.nx - v.x) * k, y: v.y + (v.ny - v.y) * k };
    }
    return { x: v.x, y: v.y };
  };

  const toScreen = (wx: number, wy: number) => ({ x: (wx - cam.x) * zoom + canvas.width / dpr / 2, y: (wy - cam.y) * zoom + canvas.height / dpr / 2 });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - canvas.width / dpr / 2) / zoom + cam.x, y: (sy - canvas.height / dpr / 2) / zoom + cam.y });
  const tileAt = (sx: number, sy: number) => {
    const w = toWorld(sx, sy);
    const a = w.x / 32;
    const b = (w.y - 16) / 16;
    return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
  };

  function frame() {
    raf = requestAnimationFrame(frame);
    draw(performance.now());
  }

  function draw(now: number) {
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a09';
    ctx.fillRect(0, 0, W, H);
    if (follow && selfId !== null) {
      const s = ents.get(selfId);
      if (s) {
        const p = pos(s, now);
        const target = iso(p.x, p.y);
        cam.x += (target.x - cam.x) * 0.2;
        cam.y += (target.y + 16 - cam.y) * 0.2;
      }
    }
    if (world) {
      const { w, h } = world.payload;
      const c0 = tileAt(0, 0);
      const c1 = tileAt(W, 0);
      const c2 = tileAt(0, H);
      const c3 = tileAt(W, H);
      const minX = Math.max(0, Math.min(c0.x, c1.x, c2.x, c3.x) - 2);
      const maxX = Math.min(w - 1, Math.max(c0.x, c1.x, c2.x, c3.x) + 2);
      const minY = Math.max(0, Math.min(c0.y, c1.y, c2.y, c3.y) - 2);
      const maxY = Math.min(h - 1, Math.max(c0.y, c1.y, c2.y, c3.y) + 2);
      const paths = new Map<string, Path2D>();
      const objs = new Path2D();
      const blds = new Path2D();
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const i = y * w + x;
          const col = TERRAIN_COLOR[world.terrain[i]] ?? '#333';
          let p = paths.get(col);
          if (!p) paths.set(col, (p = new Path2D()));
          const s = toScreen((x - y) * 32, (x + y) * 16);
          const hw = 32 * zoom + 0.6;
          const hh = 16 * zoom + 0.4;
          p.moveTo(s.x, s.y - 0.4);
          p.lineTo(s.x + hw, s.y + hh - 0.4);
          p.lineTo(s.x, s.y + 2 * hh - 0.4);
          p.lineTo(s.x - hw, s.y + hh - 0.4);
          p.closePath();
          const o = world.objects[i];
          if (o === 200 || o === 201) {
            blds.rect(s.x - 14 * zoom, s.y - 6 * zoom, 28 * zoom, 26 * zoom);
          } else if (o >= 1 && o <= 4) {
            objs.moveTo(s.x, s.y - 14 * zoom);
            objs.lineTo(s.x + 9 * zoom, s.y + 16 * zoom);
            objs.lineTo(s.x - 9 * zoom, s.y + 16 * zoom);
            objs.closePath();
          }
        }
      }
      for (const [col, p] of paths) {
        ctx.fillStyle = col;
        ctx.fill(p);
      }
      ctx.fillStyle = 'rgba(16,28,14,0.85)';
      ctx.fill(objs);
      ctx.fillStyle = '#5a4632';
      ctx.fill(blds);
      ctx.strokeStyle = 'rgba(217,184,103,0.35)';
      ctx.stroke(blds);
    }
    if (moveTarget) {
      const s = toScreen((moveTarget.x - moveTarget.y) * 32, (moveTarget.x + moveTarget.y) * 16 + 16);
      const k = 0.6 + 0.4 * Math.sin(now / 160);
      ctx.strokeStyle = `rgba(217,184,103,${k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 18 * zoom * k, 9 * zoom * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const list = [...ents.values()].map((tr) => ({ tr, p: pos(tr, now) })).sort((a, b) => a.p.x + a.p.y - (b.p.x + b.p.y));
    ctx.textAlign = 'center';
    for (const { tr, p } of list) {
      const v = tr.v;
      const s = toScreen((p.x - p.y) * 32, (p.x + p.y) * 16 + 16);
      const col = v.kind === 'node' ? (v.nodeKind === 'ore' ? '#9aa3b5' : v.nodeKind === 'heart' ? '#8a3fb0' : '#7ec26b') : KIND_COLOR[v.kind];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 14 * zoom, 7 * zoom, 0, 0, Math.PI * 2);
      ctx.fill();
      if (v.id === selected) {
        ctx.strokeStyle = '#f0d58a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, 20 * zoom, 10 * zoom, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const bodyH = (v.kind === 'node' ? 14 : v.elite ? 40 : 30) * zoom;
      ctx.globalAlpha = v.state === 'dead' ? 0.35 : v.online === false ? 0.6 : 1;
      ctx.fillStyle = v.look ? OUTFIT[v.look.outfitColor % OUTFIT.length] : col;
      ctx.beginPath();
      if (v.kind === 'node') {
        ctx.moveTo(s.x, s.y - bodyH);
        ctx.lineTo(s.x + 10 * zoom, s.y - 2);
        ctx.lineTo(s.x - 10 * zoom, s.y - 2);
      } else ctx.roundRect(s.x - 9 * zoom, s.y - bodyH, 18 * zoom, bodyH - 2, 5 * zoom);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (v.look) {
        ctx.fillStyle = SKIN[v.look.skin % SKIN.length];
        ctx.beginPath();
        ctx.arc(s.x, s.y - bodyH - 5 * zoom, 7 * zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = HAIR[v.look.hairColor % HAIR.length];
        ctx.beginPath();
        ctx.arc(s.x, s.y - bodyH - 7 * zoom, 7 * zoom, Math.PI, 0);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (v.state === 'meditate' || v.state === 'work') {
        ctx.fillStyle = '#8fd7e8';
        ctx.font = `${12 * zoom}px serif`;
        ctx.fillText(v.state === 'work' ? '+' : '~', s.x + 16 * zoom, s.y - bodyH);
      }
      if (v.kind !== 'node' || v.id === selected) {
        const ny = s.y - bodyH - (v.look ? 18 : 6) * zoom;
        ctx.font = `600 ${Math.max(10, 12 * zoom)}px Georgia, serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        const label = v.lv ? `${v.name} · ${v.lv}` : v.name;
        ctx.strokeText(label, s.x, ny);
        ctx.fillStyle = v.kind === 'monster' ? (v.elite ? '#f0a43a' : '#e8a090') : v.kind === 'npc' ? '#bfe8d5' : '#f3e7c4';
        ctx.fillText(label, s.x, ny);
        if (v.hp !== undefined && v.maxHp && v.hp < v.maxHp) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(s.x - 16 * zoom, ny + 3, 32 * zoom, 4);
          ctx.fillStyle = '#c8452d';
          ctx.fillRect(s.x - 16 * zoom, ny + 3, (32 * zoom * Math.max(0, v.hp)) / v.maxHp, 4);
        }
      }
      const b = bubbles.get(v.id);
      if (b && b.until > now) {
        ctx.font = `13px Georgia, serif`;
        const tw = Math.min(220, ctx.measureText(b.text).width + 16);
        const by = s.y - bodyH - 46 * zoom;
        ctx.fillStyle = 'rgba(236,227,207,0.95)';
        ctx.beginPath();
        ctx.roundRect(s.x - tw / 2, by - 16, tw, 22, 8);
        ctx.fill();
        ctx.fillStyle = '#2a2118';
        ctx.fillText(b.text.length > 34 ? b.text.slice(0, 33) + '…' : b.text, s.x, by);
      } else if (b) bubbles.delete(v.id);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const age = (now - f.t0) / 1200;
      if (age >= 1) {
        floaters.splice(i, 1);
        continue;
      }
      const s = toScreen(f.wx, f.wy);
      ctx.globalAlpha = 1 - age;
      ctx.font = `700 ${15 + 4 * (1 - age)}px Georgia, serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.text, s.x, s.y - age * 40);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y - age * 40);
      ctx.globalAlpha = 1;
    }
    if (time) {
      const hrs = time.hours;
      const night = hrs < 5 || hrs > 20 ? 0.38 : hrs < 7 || hrs > 18 ? 0.18 : 0;
      if (night) {
        ctx.fillStyle = `rgba(8,12,30,${night})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  const floatAt = (id: number, text: string, color: string) => {
    const tr = ents.get(id);
    if (!tr) return;
    const p = pos(tr, performance.now());
    const w = iso(p.x, p.y);
    floaters.push({ wx: w.x + (Math.random() - 0.5) * 16, wy: w.y - 30, text, color, t0: performance.now() });
  };

  // ---- Input -------------------------------------------------------------------
  const emit = (sx: number, sy: number, g: PickGesture) => {
    const tile = tileAt(sx, sy);
    let best: number | null = null;
    let bestD = 26 * Math.max(0.7, zoom);
    const now = performance.now();
    for (const tr of ents.values()) {
      const p = pos(tr, now);
      const s = toScreen((p.x - p.y) * 32, (p.x + p.y) * 16 + 16);
      const d = Math.hypot(s.x - sx, s.y - 14 * zoom - sy);
      if (d < bestD && tr.v.id !== selfId) {
        bestD = d;
        best = tr.v.id;
      }
    }
    for (const cb of pickCbs) cb({ x: tile.x, y: tile.y, entityId: best }, g);
  };
  let down: { x: number; y: number; t: number; id: number; long: boolean } | null = null;
  let longTimer: ReturnType<typeof setTimeout> | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number } | null = null;
  const local = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (ev) => {
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
      down = null;
      return;
    }
    if (ev.button !== 0) return;
    down = { ...p, t: performance.now(), id: ev.pointerId, long: false };
    if (ev.pointerType !== 'mouse') {
      longTimer = setTimeout(() => {
        if (down) {
          down.long = true;
          emit(down.x, down.y, 'context');
        }
      }, 520);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = local(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      api.setZoom((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinch.d));
      return;
    }
    if (down && Math.hypot(p.x - down.x, p.y - down.y) > 10) {
      if (longTimer) clearTimeout(longTimer);
      down = null;
    }
    if (ev.pointerType === 'mouse' && !down) emit(p.x, p.y, 'hover');
  });
  const up = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (longTimer) clearTimeout(longTimer);
    if (!down || down.id !== ev.pointerId) return;
    const d = down;
    down = null;
    if (!d.long && ev.type === 'pointerup') emit(d.x, d.y, 'tap');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const p = { x: ev.offsetX, y: ev.offsetY };
    emit(p.x, p.y, 'context');
  });
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      api.setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );

  const api: GameViewApi = {
    start() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    },
    loadWorld(w) {
      world = w;
      miniCache = null;
      const s = w.payload.settlements[0];
      if (s) {
        const p = iso(s.x, s.y);
        cam = { x: p.x, y: p.y };
      }
    },
    setSelf(id) {
      selfId = id;
      follow = true;
    },
    applyEntities(delta: { add?: EntityView[]; upd?: EntityPatch[]; del?: number[] }) {
      const now = performance.now();
      for (const e of delta.add ?? []) ents.set(e.id, { v: { ...e }, t0: now });
      for (const p of delta.upd ?? []) {
        const tr = ents.get(p.id);
        if (!tr) continue;
        const moving = p.nx !== undefined;
        if ((p.x !== undefined || p.y !== undefined) && !moving) {
          delete tr.v.nx;
          delete tr.v.ny;
          delete tr.v.step;
        }
        Object.assign(tr.v, p);
        if (moving) {
          tr.t0 = now;
          tr.v.step = p.step ?? STEP_MS;
          if (tr.v.id === selfId) follow = true;
        }
      }
      for (const id of delta.del ?? []) ents.delete(id);
    },
    clearEntities() {
      ents.clear();
    },
    setTime(t) {
      time = t;
    },
    setBlight() {},
    patchBlight() {},
    setSettlements(_list: SettlementView[]) {},
    combatEvents(events: CombatEvent[]) {
      for (const e of events) {
        if (e.k === 'hit') floatAt(e.d, e.c ? `${e.a}!` : String(e.a), e.d === selfId ? '#ff8a73' : e.c ? '#f0d58a' : '#f3e7c4');
        else if (e.k === 'miss') floatAt(e.d, 'miss', '#b9b2a0');
        else if (e.k === 'heal') floatAt(e.d, `+${e.a}`, '#7ec26b');
        else if (e.k === 'dot') floatAt(e.d, String(e.a), '#b87ae6');
      }
    },
    fx(kind: FxKind, entityId?: number, text?: string) {
      if (entityId !== undefined) floatAt(entityId, text ?? kind, '#f0d58a');
    },
    say(id, text) {
      bubbles.set(id, { text, until: performance.now() + 5000 });
    },
    setMoveTarget(tile) {
      moveTarget = tile;
    },
    setSelected(id) {
      selected = id;
    },
    onPick(cb) {
      pickCbs.push(cb);
    },
    centerOn(x, y) {
      const p = iso(x, y);
      cam = { x: p.x, y: p.y + 16 };
      follow = false;
    },
    setZoom(z) {
      zoom = Math.max(0.5, Math.min(2.5, z));
    },
    getZoom: () => zoom,
    getEntity: (id) => ents.get(id)?.v,
    nearby(radius) {
      const s = selfId !== null ? ents.get(selfId)?.v : undefined;
      if (!s) return [];
      return [...ents.values()]
        .map((tr) => tr.v)
        .filter((v) => v.id !== selfId && Math.hypot(v.x - s.x, v.y - s.y) <= radius)
        .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y));
    },
    drawMinimap(mc: HTMLCanvasElement, opts: MinimapOptions = {}) {
      const g = mc.getContext('2d');
      if (!g || !world) return;
      const { w, h } = world.payload;
      if (!miniCache) {
        miniCache = document.createElement('canvas');
        miniCache.width = w;
        miniCache.height = h;
        const mg = miniCache.getContext('2d')!;
        const img = mg.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
          const hex = TERRAIN_COLOR[world.terrain[i]] ?? '#333';
          const n = parseInt(hex.slice(1), 16);
          img.data[i * 4] = (n >> 16) & 255;
          img.data[i * 4 + 1] = (n >> 8) & 255;
          img.data[i * 4 + 2] = n & 255;
          img.data[i * 4 + 3] = 255;
        }
        mg.putImageData(img, 0, 0);
      }
      const f = fit(mc, w, h);
      g.fillStyle = '#0b0a09';
      g.fillRect(0, 0, mc.width, mc.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(miniCache, f.ox, f.oy, w * f.s, h * f.s);
      if (opts.settlements !== false) {
        g.fillStyle = '#d9b867';
        for (const st of world.payload.settlements) g.fillRect(f.ox + st.x * f.s - 2, f.oy + st.y * f.s - 2, 4, 4);
      }
      if (opts.entities !== false) {
        for (const tr of ents.values()) {
          if (tr.v.id === selfId) continue;
          g.fillStyle = KIND_COLOR[tr.v.kind];
          g.fillRect(f.ox + tr.v.x * f.s - 1, f.oy + tr.v.y * f.s - 1, 2, 2);
        }
        const s = selfId !== null ? ents.get(selfId)?.v : undefined;
        if (s) {
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(f.ox + s.x * f.s, f.oy + s.y * f.s, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
    minimapToTile(mc, px, py) {
      if (!world) return { x: 0, y: 0 };
      const f = fit(mc, world.payload.w, world.payload.h);
      return { x: Math.round((px - f.ox) / f.s), y: Math.round((py - f.oy) / f.s) };
    },
  };
  return api;
}

function fit(c: HTMLCanvasElement, w: number, h: number) {
  const s = Math.min(c.width / w, c.height / h);
  return { s, ox: (c.width - w * s) / 2, oy: (c.height - h * s) / 2 };
}

function drawLookPreview(canvas: HTMLCanvasElement, look: Look, opts: LookPreviewOptions = {}): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  const u = opts.scale ?? Math.min(W / 24, H / 34);
  g.clearRect(0, 0, W, H);
  if (opts.backdrop !== false) {
    const grd = g.createRadialGradient(W / 2, H * 0.62, 2, W / 2, H * 0.62, W * 0.6);
    grd.addColorStop(0, 'rgba(217,184,103,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  const bob = opts.time !== undefined ? Math.sin(opts.time / 380) * u * 0.25 : 0;
  const cx = W / 2;
  const base = H / 2 + 14 * u;
  const dir = opts.dir ?? 0;
  const back = dir === 2 || dir === 3;
  g.save();
  if (dir === 1 || dir === 2) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(cx, base, 7 * u, 2.2 * u, 0, 0, Math.PI * 2);
  g.fill();
  const outfit = OUTFIT[look.outfitColor % OUTFIT.length];
  const skin = SKIN[look.skin % SKIN.length];
  const hair = HAIR[look.hairColor % HAIR.length];
  const sash = SASH[look.sashColor % SASH.length];
  const y0 = base + bob;
  g.fillStyle = '#1b1714';
  g.fillRect(cx - 3.2 * u, y0 - 6 * u, 2.4 * u, 6 * u);
  g.fillRect(cx + 0.8 * u, y0 - 6 * u, 2.4 * u, 6 * u);
  g.fillStyle = outfit;
  g.beginPath();
  const flare = look.outfit === 2 ? 1.6 : look.outfit === 3 ? 0.4 : 1;
  g.moveTo(cx - 4.5 * u, y0 - 17 * u);
  g.lineTo(cx + 4.5 * u, y0 - 17 * u);
  g.lineTo(cx + (4.5 + flare) * u, y0 - 4.5 * u);
  g.lineTo(cx - (4.5 + flare) * u, y0 - 4.5 * u);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(cx - 0.3 * u, y0 - 17 * u, 0.6 * u, 12 * u);
  g.fillStyle = sash;
  g.fillRect(cx - 4.8 * u, y0 - 11.5 * u, 9.6 * u, 1.6 * u);
  g.fillStyle = outfit;
  g.fillRect(cx - 6.4 * u, y0 - 16.5 * u, 2 * u, 8 * u);
  g.fillRect(cx + 4.4 * u, y0 - 16.5 * u, 2 * u, 8 * u);
  g.fillStyle = skin;
  g.fillRect(cx - 6.4 * u, y0 - 8.8 * u, 2 * u, 1.8 * u);
  g.fillRect(cx + 4.4 * u, y0 - 8.8 * u, 2 * u, 1.8 * u);
  g.fillRect(cx - 1.2 * u, y0 - 18.6 * u, 2.4 * u, 2 * u);
  g.beginPath();
  g.arc(cx, y0 - 22 * u, 4.2 * u, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.arc(cx, y0 - 23 * u, 4.4 * u, Math.PI * 1.02, Math.PI * 1.98);
  g.fill();
  const style = look.hairStyle % 7;
  if (style === 0 || style === 4) {
    g.beginPath();
    g.arc(cx, y0 - 28 * u, 1.8 * u, 0, Math.PI * 2);
    g.fill();
  }
  if (style === 1 || style === 5 || look.gender === 1) g.fillRect(cx - 4.4 * u, y0 - 23 * u, 1.6 * u, (style === 5 ? 9 : 6) * u);
  if (style === 2 || style === 5 || look.gender === 1) g.fillRect(cx + 2.8 * u, y0 - 23 * u, 1.6 * u, (style === 5 ? 9 : 6) * u);
  if (style === 3) {
    g.beginPath();
    g.ellipse(cx + 3.5 * u, y0 - 26 * u, 2 * u, 1.4 * u, 0.5, 0, Math.PI * 2);
    g.fill();
  }
  if (back) g.fillRect(cx - 4.2 * u, y0 - 24 * u, 8.4 * u, 4 * u);
  else {
    g.fillStyle = '#1b1714';
    g.fillRect(cx + 0.8 * u, y0 - 22.4 * u, 0.9 * u, 0.9 * u);
    g.fillRect(cx - 1.7 * u, y0 - 22.4 * u, 0.9 * u, 0.9 * u);
  }
  if (look.accessory === 1) {
    g.fillStyle = sash;
    g.fillRect(cx - 4.4 * u, y0 - 25 * u, 8.8 * u, 1 * u);
  } else if (look.accessory === 2) {
    g.fillStyle = '#6b5639';
    g.beginPath();
    g.moveTo(cx - 8 * u, y0 - 25 * u);
    g.lineTo(cx, y0 - 30 * u);
    g.lineTo(cx + 8 * u, y0 - 25 * u);
    g.closePath();
    g.fill();
  } else if (look.accessory === 3) {
    g.fillStyle = 'rgba(30,30,30,0.85)';
    g.fillRect(cx - 3.6 * u, y0 - 21.2 * u, 7.2 * u, 2 * u);
  } else if (look.accessory === 4) {
    g.fillStyle = '#d9b867';
    g.beginPath();
    g.arc(cx, y0 - 14.5 * u, 1 * u, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export const standinRenderModule: RenderModule = {
  createGameView,
  drawLookPreview,
  lookSwatches: { skin: SKIN, hair: HAIR, outfit: OUTFIT, sash: SASH },
};
