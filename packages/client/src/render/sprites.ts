/**
 * Sprite bank: lazily turns the pure art generators into canvases and caches them (bounded LRUs for the large,
 * high-variety sets such as character frames and mountain tiles).
 */
import { O, T, type BuildingKind } from '@murim/shared';
import { VARIANTS, genObject } from '../art/flora';
import { genMountainTile, type RockSource } from '../art/mountain';
import { genWallTile, genBridgeRails, genFenceTile, genPalisadeTile } from '../art/walls';
import { genBuilding, type BuildingArt, type BuildingSpec } from '../art/buildings';
import { genCharacter, type CharSpec } from '../art/character';
import { gearKey } from '../art/gear';
import { genBeast, type BeastSpec } from '../art/beasts';
import { genNode } from '../art/nodes';
import { makeCanvas, makeSprite, pbToCanvas, type Sprite } from '../art/canvas';
import { FACTION_ROOF, factionColor } from '../art/palette';
import { ihash } from '../art/noise';
import { LRU } from './lru';
import type { BuildingInfo, WorldModel } from './world';
import type { LightDef, SmokeDef } from '../art/bctx';
import type { NodeKind } from '@murim/shared';

export interface BuildingSprite {
  spr: Sprite;
  /** Pixel of the footprint's top vertex inside the sprite. */
  ox: number;
  oy: number;
  lights: LightDef[];
  smoke: SmokeDef[];
}

export interface NodeSpriteSet {
  spr: Sprite;
  glow: HTMLCanvasElement | null;
  light: number | null;
  lightR: number;
}

/** A sprite plus a lazily created white "hit flash" version. */
export interface FlashSprite extends Sprite {
  flash?: HTMLCanvasElement;
  /** Silhouette canvases by tint (see `ghostOf`). */
  ghost?: Record<string, HTMLCanvasElement>;
  /** Weapon tip (sprite px) and the rarity of weapon / outfit for dynamic effects. */
  tip?: [number, number] | null;
  /** Eye rects for the blink overlay. */
  eyes?: { x: number; y: number; w: number; h: number; skin: string }[] | null;
  wRar?: number;
  oRar?: number;
}

/** Cache key of a character frame (exported for tests). */
export function charKey(spec: CharSpec, dir: number = spec.dir): string {
  const l = spec.look;
  const g = spec.gear;
  return `${l.gender}${l.skin}${l.hairStyle}${l.hairColor}${l.outfit}${l.outfitColor}${l.sashColor}${l.accessory}|${spec.weapon ?? '-'}|${spec.state}|${dir}|${spec.frame}|${spec.role ?? '-'}|${spec.faction ?? '-'}|${spec.elite ?? 0}|${spec.special ?? '-'}|${spec.tool ?? '-'}|${g ? gearKey(g) : '-'}|${spec.variant ?? 0}|${spec.wind ?? 0}|${spec.gaze ?? 0}|${spec.tilt ?? 0}|${spec.blink ? 1 : 0}`;
}

/** Horizontally mirrored copy of a sprite (anchor, tip and glow mirrored too). */
export function flipSprite(s: FlashSprite): FlashSprite {
  const cv = makeCanvas(s.w, s.h);
  const g = cv.getContext('2d')!;
  g.translate(s.w, 0);
  g.scale(-1, 1);
  g.drawImage(s.cv, 0, 0);
  let glow: HTMLCanvasElement | undefined;
  if (s.glow) {
    glow = makeCanvas(s.glow.width, s.glow.height);
    const gg = glow.getContext('2d')!;
    gg.translate(glow.width, 0);
    gg.scale(-1, 1);
    gg.drawImage(s.glow, 0, 0);
  }
  return { cv, ax: s.w - 1 - s.ax, ay: s.ay, w: s.w, h: s.h, glow, top: s.top, tip: s.tip ? [s.w - 1 - s.tip[0], s.tip[1]] : s.tip, eyes: s.eyes ? s.eyes.map((e) => ({ ...e, x: s.w - e.x - e.w })) : s.eyes, wRar: s.wRar, oRar: s.oRar };
}

export class SpriteBank {
  season = 1;
  private objects = new Map<number, Sprite | null>();
  private mountains = new LRU<number, Sprite>(1400);
  private walls = new Map<number, Sprite>();
  private rails = new Map<number, Sprite>();
  private fences = new Map<string, Sprite>();
  private buildings = new LRU<string, BuildingSprite>(160);
  /** West facings are drawn as cached mirrors of the east ones (generation is the expensive part). */
  private chars = new LRU<string, { spr: FlashSprite; mir: FlashSprite | null }>(6000);
  private beasts = new LRU<string, { spr: FlashSprite; mir: FlashSprite | null }>(2000);
  /** Milliseconds of sprite generation still allowed this frame (stale frames are drawn beyond it). */
  private genBudget = 0;
  private nodes = new Map<string, NodeSpriteSet>();
  private glows = new Map<string, HTMLCanvasElement>();
  private rock: RockSource;
  built = { objects: 0, mountains: 0, chars: 0, buildings: 0, beasts: 0 };

  constructor(private world: WorldModel) {
    const w = world;
    this.rock = {
      w: w.w,
      h: w.h,
      isRock: (x, y) => w.terrainAt(x, y) === T.Rock,
      dist: (x, y) => (w.inb(x, y) ? w.rockDist[y * w.w + x] : 0),
      climate: (y) => w.climateAt(y),
    };
  }

  setSeason(season: number): void {
    this.season = season;
  }

  /** Drop everything season-dependent. */
  clearSeasonal(): void {
    this.objects.clear();
    this.mountains.clear();
    this.walls.clear();
    this.rails.clear();
    this.fences.clear();
    this.buildings.clear();
    this.nodes.clear();
  }

  // ---- terrain objects -----------------------------------------------------------------

  /** Vegetation / prop sprite for object `code` at tile (x, y); `tier` is the Blight tier. */
  getObject(code: number, x: number, y: number, tier: number, bannerCss?: string): Sprite | null {
    const hash = ihash(x, y, 1);
    const v8 = hash % (VARIANTS * 2);
    const key = code | (v8 << 8) | (this.season << 12) | (tier << 14) | (bannerCss ? 1 << 16 : 0);
    if (code === O.Banner && bannerCss) return this.banner(bannerCss, v8);
    let s = this.objects.get(key);
    if (s !== undefined) return s;
    const flip = v8 >= VARIANTS;
    const g = genObject(code, v8 % VARIANTS, this.season, tier);
    if (!g || !g.visible) s = null;
    else {
      const pb = flip ? g.pb.flipped() : g.pb;
      s = makeSprite(pb, flip ? g.pb.w - 1 - g.ax : g.ax, g.ay, null, g.pb.h >= 40);
    }
    this.objects.set(key, s);
    this.built.objects++;
    return s;
  }

  private banner(css: string, v8: number): Sprite {
    const key = `b${css}${this.season}`;
    let s = this.glows.get(key) as unknown as Sprite | undefined;
    if (!s) {
      const g = genObject(O.Banner, v8 % VARIANTS, this.season, 0, css)!;
      s = makeSprite(g.pb, g.ax, g.ay);
      this.glows.set(key, s as unknown as HTMLCanvasElement);
    }
    return s;
  }

  getMountain(x: number, y: number): Sprite {
    const key = (y * this.world.w + x) * 4 + this.season;
    let s = this.mountains.get(key);
    if (!s) {
      const m = genMountainTile(this.rock, x, y, this.season);
      s = makeSprite(m.pb, m.ax, m.ay, null, true);
      this.mountains.set(key, s);
      this.built.mountains++;
    }
    return s;
  }

  getWall(mask: number, fallen: boolean): Sprite {
    const key = mask | (this.season << 4) | (fallen ? 64 : 0);
    let s = this.walls.get(key);
    if (!s) {
      const t = genWallTile(mask, this.season, fallen);
      s = makeSprite(t.pb, t.ax, t.ay, null, true);
      this.walls.set(key, s);
    }
    return s;
  }

  /** Palisade or rail fence tile by neighbour mask. */
  getFence(kind: 'palisade' | 'fence', mask: number): Sprite {
    const key = `${kind}|${mask}|${this.season}`;
    let s = this.fences.get(key);
    if (!s) {
      const t = kind === 'palisade' ? genPalisadeTile(mask, this.season) : genFenceTile(mask, this.season);
      s = makeSprite(t.pb, t.ax, t.ay, null, kind === 'palisade');
      this.fences.set(key, s);
    }
    return s;
  }

  getBridgeRail(axis: 0 | 1): Sprite {
    const key = axis | (this.season << 2);
    let s = this.rails.get(key);
    if (!s) {
      const t = genBridgeRails(axis, this.season);
      s = makeSprite(t.pb, t.ax, t.ay);
      this.rails.set(key, s);
    }
    return s;
  }

  // ---- buildings ----------------------------------------------------------------------------

  getBuilding(info: BuildingInfo, ctrl: string | null, fallen: boolean): BuildingSprite {
    const b = info.def;
    const key = `${b.id}|${this.season}|${ctrl ?? '-'}|${fallen ? 1 : 0}`;
    let s = this.buildings.get(key);
    if (!s) {
      const spec: BuildingSpec = {
        id: b.id,
        kind: b.kind as BuildingKind,
        w: b.w,
        d: b.d,
        door: { dx: b.door.x - b.x, dy: b.door.y - b.y },
        season: this.season,
        roofCss: ctrl ? (FACTION_ROOF[ctrl] ?? null) : null,
        accentCss: ctrl ? factionColor(ctrl) : null,
        fallen,
      };
      const art: BuildingArt = genBuilding(spec);
      const spr = makeSprite(art.pb, art.ox, art.oy, art.glow, true);
      s = { spr, ox: art.ox, oy: art.oy, lights: art.lights, smoke: art.smoke };
      this.buildings.set(key, s);
      this.built.buildings++;
    }
    return s;
  }

  // ---- characters and monsters --------------------------------------------------------------

  /** Start a frame: set the sprite generation time budget (ms). */
  beginFrame(budgetMs = 5): void {
    this.genBudget = budgetMs;
  }

  getChar(spec: CharSpec, fallback: FlashSprite | null = null): FlashSprite {
    const mirror = spec.dir === 1 || spec.dir === 2;
    const cd = mirror ? (spec.dir === 1 ? 0 : 3) : spec.dir;
    const key = charKey(spec, cd);
    let e = this.chars.get(key);
    if (!e) {
      if (this.genBudget <= 0 && fallback) return fallback;
      const t0 = performance.now();
      const g = genCharacter(cd === spec.dir ? spec : { ...spec, dir: cd as 0 });
      const s: FlashSprite = makeSprite(g.pb, g.ax, g.ay, g.glow);
      s.top = g.top;
      s.tip = g.tip;
      s.eyes = g.eyes;
      s.wRar = g.wRar;
      s.oRar = g.oRar;
      e = { spr: s, mir: null };
      this.chars.set(key, e);
      this.built.chars++;
      this.genBudget -= performance.now() - t0;
    }
    if (!mirror) return e.spr;
    return (e.mir ??= flipSprite(e.spr));
  }

  getBeast(spec: BeastSpec, fallback: FlashSprite | null = null): FlashSprite {
    const mirror = spec.dir === 1 || spec.dir === 2;
    const cd = mirror ? (spec.dir === 1 ? 0 : 3) : spec.dir;
    const key = `${spec.key}|${spec.state}|${cd}|${spec.frame}|${spec.elite ?? 0}|${spec.variant ?? 0}`;
    let e = this.beasts.get(key);
    if (!e) {
      if (this.genBudget <= 0 && fallback) return fallback;
      const t0 = performance.now();
      const g = genBeast(cd === spec.dir ? spec : { ...spec, dir: cd as 0 });
      const s: FlashSprite = makeSprite(g.pb, g.ax, g.ay, g.glow);
      s.top = g.top;
      e = { spr: s, mir: null };
      this.beasts.set(key, e);
      this.built.beasts++;
      this.genBudget -= performance.now() - t0;
    }
    if (!mirror) return e.spr;
    return (e.mir ??= flipSprite(e.spr));
  }

  getNode(kind: NodeKind, variant: number, frame: number): NodeSpriteSet {
    const key = `${kind}|${variant}|${frame}|${this.season}`;
    let s = this.nodes.get(key);
    if (!s) {
      const g = genNode(kind, variant, this.season, frame);
      const spr = makeSprite(g.pb, g.ax, g.ay);
      spr.top = g.pb.bounds()?.y0 ?? 0;
      s = { spr, glow: g.glow && g.glow.bounds() ? pbToCanvas(g.glow) : null, light: g.light, lightR: g.lightR };
      this.nodes.set(key, s);
    }
    return s;
  }

  /** Soft radial light/glow disc (cached by colour and radius bucket). */
  glowDisc(color: number, radius: number): HTMLCanvasElement {
    const r = Math.max(4, Math.round(radius / 4) * 4);
    const key = `${color}|${r}`;
    let c = this.glows.get(key);
    if (!c) {
      c = makeCanvas(r * 2, r * 2);
      const g = c.getContext('2d')!;
      const cr = color & 255;
      const cg = (color >>> 8) & 255;
      const cb = (color >>> 16) & 255;
      const grd = g.createRadialGradient(r, r, 0, r, r, r);
      grd.addColorStop(0, `rgba(${cr},${cg},${cb},0.85)`);
      grd.addColorStop(0.35, `rgba(${cr},${cg},${cb},0.4)`);
      grd.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.12)`);
      grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, r * 2, r * 2);
      this.glows.set(key, c);
    }
    return c;
  }

  /**
   * Faint tinted silhouette with a thin outline, drawn over scenery that covers a sprite (one canvas, 1 px larger on
   * every side; draw it at the sprite position minus one pixel).
   */
  ghostOf(s: FlashSprite, tint: string): HTMLCanvasElement {
    const cache = (s.ghost ??= {});
    let c = cache[tint];
    if (!c) {
      const solid = makeCanvas(s.w, s.h);
      const sg = solid.getContext('2d')!;
      sg.drawImage(s.cv, 0, 0);
      sg.globalCompositeOperation = 'source-atop';
      sg.fillStyle = tint;
      sg.fillRect(0, 0, s.w, s.h);
      c = makeCanvas(s.w + 2, s.h + 2);
      const g = c.getContext('2d')!;
      // outline: the silhouette grown by a pixel in four directions, minus the silhouette itself
      for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) g.drawImage(solid, ox, oy);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(s.cv, 1, 1);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.32;
      g.drawImage(solid, 1, 1);
      cache[tint] = c;
    }
    return c;
  }

  /** White silhouette of a sprite for hit flashes (created once). */
  flashOf(s: FlashSprite): HTMLCanvasElement {
    if (!s.flash) {
      const c = makeCanvas(s.w, s.h);
      const g = c.getContext('2d')!;
      g.drawImage(s.cv, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,0.78)';
      g.fillRect(0, 0, s.w, s.h);
      s.flash = c;
    }
    return s.flash;
  }
}
