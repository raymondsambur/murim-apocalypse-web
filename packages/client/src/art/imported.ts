/**
 * Runtime side of the sprite import pipeline: loads sprites written by `scripts/art/import-sprite.ts`
 * (`assets/sprites/<id>.json` + `<id>/<dir>.png`) and serves them as `Sprite`-compatible objects, including the row `spans`
 * that `render/occlusion.ts` needs. Directions that the metadata derives from another one are mirrored here, the same way
 * `flipSprite` in render/sprites.ts mirrors a character (anchor, top and spans move with the picture).
 *
 * Not wired into `SpriteBank` or the scene yet; the dev gallery (`assets.html`) is the only consumer for now.
 */
import type { RowSpans } from '../render/occlusion';
import { makeCanvas, type Sprite } from './canvas';
import { mirrorSpans, spansOf } from './spriteimport';

/** One facing: either a picture of its own or another facing, optionally mirrored. Own fields override the top-level ones. */
export interface ImportedDir {
  file?: string;
  w?: number;
  h?: number;
  ax?: number;
  ay?: number;
  top?: number;
  /** Take this facing from another one. */
  from?: number;
  flip?: boolean;
}

export interface ImportedMeta {
  id: string;
  /** Size, anchor and top row of the first drawn facing; the other facings may override them in `dirs`. */
  w: number;
  h: number;
  ax: number;
  ay: number;
  top: number;
  footprint: { w: number; d: number };
  /** Height of the object above its ground point, in px (the number checked against the scale table). */
  heightPx: number;
  /** Facings 0 SE, 1 SW, 2 NW, 3 NE (keys "0".."3"). */
  dirs: Record<string, ImportedDir>;
  provenance: { tool: string; prompt: string; date: string };
}

/** A `Sprite` whose `spans` are always present. */
export interface ImportedSprite extends Sprite {
  spans: RowSpans;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Validate a parsed `<id>.json`. Throws a descriptive Error. */
export function parseMeta(raw: unknown): ImportedMeta {
  const m = raw as Partial<ImportedMeta> | null;
  const bad = (why: string): never => {
    throw new Error(`bad sprite metadata${m && typeof m.id === 'string' ? ` (${m.id})` : ''}: ${why}`);
  };
  if (!m || typeof m !== 'object') return bad('not an object');
  if (typeof m.id !== 'string' || !/^[a-z0-9_]+$/.test(m.id)) bad('id must be lower-case letters, digits and underscores');
  for (const k of ['w', 'h', 'ax', 'ay', 'top', 'heightPx'] as const) if (!isInt(m[k]) || (m[k] as number) < 0) bad(`${k} must be a non-negative integer`);
  if (!m.footprint || !isInt(m.footprint.w) || !isInt(m.footprint.d)) bad('footprint {w, d} missing');
  if (!m.dirs || typeof m.dirs !== 'object' || !Object.keys(m.dirs).length) bad('dirs missing');
  for (const [k, d] of Object.entries(m.dirs!)) {
    if (!/^[0-3]$/.test(k)) bad(`dir "${k}" is not 0-3`);
    if (!d.file && !isInt(d.from)) bad(`dir ${k} needs a file or a source facing`);
    if (d.from !== undefined && !m.dirs![String(d.from)]) bad(`dir ${k} copies missing dir ${d.from}`);
  }
  if (!m.provenance || typeof m.provenance.tool !== 'string' || typeof m.provenance.prompt !== 'string' || typeof m.provenance.date !== 'string') bad('provenance {tool, prompt, date} missing');
  return m as ImportedMeta;
}

export interface ResolvedDir {
  /** Facing whose picture is used. */
  source: number;
  /** Net mirroring after following the `from` chain. */
  flip: boolean;
  entry: ImportedDir;
}

/** Follow `from` links (with cycle protection) to the facing that owns a picture. Pure. */
export function resolveDir(meta: ImportedMeta, dir: number): ResolvedDir | null {
  let cur = String(dir);
  let flip = false;
  for (let guard = 0; guard < 5; guard++) {
    const e = meta.dirs[cur];
    if (!e) return null;
    if (e.file) return { source: Number(cur), flip, entry: e };
    if (e.from === undefined) return null;
    if (e.flip) flip = !flip;
    cur = String(e.from);
  }
  return null;
}

/** Top-level numbers overridden by a facing's own. */
export function dirGeometry(meta: ImportedMeta, e: ImportedDir): { w: number; h: number; ax: number; ay: number; top: number } {
  return { w: e.w ?? meta.w, h: e.h ?? meta.h, ax: e.ax ?? meta.ax, ay: e.ay ?? meta.ay, top: e.top ?? meta.top };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load sprite ${url}`));
    img.src = url;
  });
}

/**
 * Load one picture as a `Sprite`. `meta` supplies the anchor and top row (use `{ ...meta, ...dirEntry }` for a facing with its
 * own geometry); the canvas size comes from the picture and must agree with `meta.w` x `meta.h`.
 */
export async function loadImportedSprite(meta: Pick<ImportedMeta, 'id' | 'w' | 'h' | 'ax' | 'ay' | 'top'>, url: string): Promise<ImportedSprite> {
  const img = await loadImage(url);
  if (img.naturalWidth !== meta.w || img.naturalHeight !== meta.h) throw new Error(`sprite ${meta.id}: ${url} is ${img.naturalWidth}x${img.naturalHeight}, metadata says ${meta.w}x${meta.h}`);
  const cv = makeCanvas(meta.w, meta.h);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, meta.w, meta.h).data;
  return { cv, ax: meta.ax, ay: meta.ay, w: meta.w, h: meta.h, top: meta.top, spans: spansOf({ w: meta.w, h: meta.h, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }) };
}

/** Horizontally mirrored copy (anchor, top and spans mirrored; nearest-neighbour, no resampling). */
export function mirrorImported(s: ImportedSprite): ImportedSprite {
  const cv = makeCanvas(s.w, s.h);
  const g = cv.getContext('2d')!;
  g.translate(s.w, 0);
  g.scale(-1, 1);
  g.drawImage(s.cv, 0, 0);
  return { cv, ax: s.w - 1 - s.ax, ay: s.ay, w: s.w, h: s.h, top: s.top, spans: mirrorSpans(s.spans, s.w) };
}

export class ImportedRegistry {
  private metas = new Map<string, { meta: ImportedMeta; urlOf: (file: string) => string }>();
  private sprites = new Map<string, ImportedSprite>();
  private mirrors = new Map<string, ImportedSprite>();

  /** Add an asset; `urlOf` maps a file name from the metadata (`"0.png"`) to a loadable URL. */
  register(raw: unknown, urlOf: (file: string) => string): ImportedMeta {
    const meta = parseMeta(raw);
    this.metas.set(meta.id, { meta, urlOf });
    for (const k of [...this.sprites.keys(), ...this.mirrors.keys()]) if (k.startsWith(`${meta.id}|`)) (this.sprites.delete(k), this.mirrors.delete(k));
    return meta;
  }

  ids(): string[] {
    return [...this.metas.keys()].sort();
  }

  meta(id: string): ImportedMeta | undefined {
    return this.metas.get(id)?.meta;
  }

  /** Load every picture of an asset (call once before `get`). */
  async load(id: string): Promise<void> {
    const e = this.metas.get(id);
    if (!e) throw new Error(`unknown imported sprite ${id}`);
    for (const [k, d] of Object.entries(e.meta.dirs)) {
      if (!d.file) continue;
      const geo = dirGeometry(e.meta, d);
      this.sprites.set(`${id}|${k}`, await loadImportedSprite({ id, ...geo }, e.urlOf(d.file)));
    }
  }

  /** Sprite for a facing, mirrored when the metadata derives it from another facing. Undefined until loaded. */
  get(id: string, dir: number): ImportedSprite | undefined {
    const e = this.metas.get(id);
    if (!e) return undefined;
    const r = resolveDir(e.meta, dir);
    if (!r) return undefined;
    const base = this.sprites.get(`${id}|${r.source}`);
    if (!base) return undefined;
    if (!r.flip) return base;
    const key = `${id}|${r.source}`;
    let m = this.mirrors.get(key);
    if (!m) {
      m = mirrorImported(base);
      this.mirrors.set(key, m);
    }
    return m;
  }
}

/** The shared registry. */
export const importedSprites = new ImportedRegistry();
