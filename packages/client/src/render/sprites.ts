/**
 * Sprite bank: lazily turns the pure art generators into canvases and caches them (bounded LRUs for the large,
 * high-variety sets such as character frames and mountain tiles).
 */
import { O, T, type BuildingKind } from '@murim/shared';
import { VARIANTS, genObject } from '../art/flora';
import { genMountainTile, type RockSource } from '../art/mountain';
import { genWallTile, genBridgeRails } from '../art/walls';
import { genBuilding, type BuildingArt, type BuildingSpec } from '../art/buildings';
import { genCharacter, type CharSpec } from '../art/character';
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
}

export class SpriteBank {
  season = 1;
  private objects = new Map<number, Sprite | null>();
  private mountains = new LRU<number, Sprite>(1400);
  private walls = new Map<number, Sprite>();
  private rails = new Map<number, Sprite>();
  private buildings = new LRU<string, BuildingSprite>(80);
  private chars = new LRU<string, FlashSprite>(2600);
  private beasts = new LRU<string, FlashSprite>(900);
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
      s = makeSprite(pb, flip ? g.pb.w - 1 - g.ax : g.ax, g.ay);
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
      s = makeSprite(m.pb, m.ax, m.ay);
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
      s = makeSprite(t.pb, t.ax, t.ay);
      this.walls.set(key, s);
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
      const spr = makeSprite(art.pb, art.ox, art.oy, art.glow);
      s = { spr, ox: art.ox, oy: art.oy, lights: art.lights, smoke: art.smoke };
      this.buildings.set(key, s);
      this.built.buildings++;
    }
    return s;
  }

  // ---- characters and monsters --------------------------------------------------------------

  getChar(spec: CharSpec): FlashSprite {
    const l = spec.look;
    const key = `${l.gender}${l.skin}${l.hairStyle}${l.hairColor}${l.outfit}${l.outfitColor}${l.sashColor}${l.accessory}|${spec.weapon ?? '-'}|${spec.state}|${spec.dir}|${spec.frame}|${spec.role ?? '-'}|${spec.faction ?? '-'}|${spec.elite ?? 0}|${spec.special ?? '-'}|${spec.tool ?? '-'}`;
    let s = this.chars.get(key);
    if (!s) {
      const g = genCharacter(spec);
      s = makeSprite(g.pb, g.ax, g.ay);
      s.top = g.top;
      this.chars.set(key, s);
      this.built.chars++;
    }
    return s;
  }

  getBeast(spec: BeastSpec): FlashSprite {
    const key = `${spec.key}|${spec.state}|${spec.dir}|${spec.frame}|${spec.elite ?? 0}`;
    let s = this.beasts.get(key);
    if (!s) {
      const g = genBeast(spec);
      s = makeSprite(g.pb, g.ax, g.ay);
      s.top = g.top;
      this.beasts.set(key, s);
      this.built.beasts++;
    }
    return s;
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
