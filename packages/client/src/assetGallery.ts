/**
 * Dev-only asset gallery: every procedural (art/sectprops.ts) and imported (art/imported.ts) sprite at zoom 1, 2 and 3 with
 * nearest-neighbour scaling, next to a standing person, a house and a tree, and a pass/fail check of each measured height
 * against its scale target. Run: npx vite packages/client --port 5201  ->  http://localhost:5201/assets.html
 * URL params: zoom=1,2,3 (which zoom levels to draw), marks=0 (hide anchor and footprint marks).
 */
import { O } from '@murim/shared';
import { genBuilding } from './art/buildings';
import { genCharacter } from './art/character';
import { pbToCanvas } from './art/canvas';
import { genObject } from './art/flora';
import { importedSprites, type ImportedMeta } from './art/imported';
import { PERSON_PX, TARGETS, type Target } from './art/scale';
import { SECT_ASSETS, SECT_TARGETS, type SectAssetDef, type SectTargetKey } from './art/sectprops';

const params = new URLSearchParams(location.search);
const zooms = (params.get('zoom') ?? '1,2,3').split(',').map(Number).filter((z) => z >= 1 && z <= 6);
const state = { marks: params.get('marks') !== '0' };

interface Item {
  label: string;
  cv: HTMLCanvasElement;
  ax: number;
  ay: number;
  /** Footprint in tiles; draws the ground diamond under the anchor when the marks are on. */
  fp?: { w: number; d: number };
  anchorMark?: boolean;
}

// ---------------------------------------------------------------------------
// Scale references: a person, a house and a tree from the real generators
// ---------------------------------------------------------------------------

function references(): Item[] {
  const c = genCharacter({ look: { gender: 0, skin: 2, hairStyle: 0, hairColor: 0, outfit: 0, outfitColor: 3, sashColor: 1, accessory: 0 }, state: 'idle', dir: 0, frame: 0, weapon: null });
  const h = genBuilding({ id: 3, kind: 'house', w: 3, d: 3, door: { dx: 1, dy: 3 }, season: 1, roofCss: null, accentCss: null, fallen: false });
  const tree = genObject(O.Oak, 1, 1, 0)!;
  return [
    { label: 'person', cv: pbToCanvas(c.pb), ax: c.ax, ay: c.ay },
    { label: 'house 3x3', cv: pbToCanvas(h.pb), ax: Math.round(h.ox), ay: Math.round(h.oy + 3 * 8), fp: { w: 3, d: 3 } },
    { label: 'tree', cv: pbToCanvas(tree.pb), ax: tree.ax, ay: tree.ay },
  ];
}

const REFS = references();

// ---------------------------------------------------------------------------
// Drawing a strip at a zoom level
// ---------------------------------------------------------------------------

function drawStrip(items: Item[], zoom: number, withRefs: boolean): HTMLCanvasElement {
  const all = withRefs ? [...REFS, ...items] : items;
  const gap = 14;
  const above = Math.max(...all.map((i) => i.ay)) + 6;
  const below = Math.max(...all.map((i) => i.cv.height - i.ay)) + 10;
  const width = all.reduce((s, i) => s + i.cv.width + gap, gap);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(width * zoom);
  cv.height = Math.ceil((above + below) * zoom);
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  let x = gap;
  const base = above;
  for (const it of all) {
    const ox = x + it.ax;
    if (state.marks && it.fp) {
      // ground diamond of the footprint: tile space (u, v) in [0,w] x [0,d], centred on the anchor, 32 x 16 px per tile
      g.strokeStyle = 'rgba(255,240,160,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      const fp = it.fp;
      const pt = (u: number, v: number): [number, number] => [ox + (u - fp.w / 2 - (v - fp.d / 2)) * 16, base + (u - fp.w / 2 + (v - fp.d / 2)) * 8];
      [pt(0, 0), pt(fp.w, 0), pt(fp.w, fp.d), pt(0, fp.d)].forEach(([px, py], i) => (i ? g.lineTo(px * zoom + 0.5, py * zoom + 0.5) : g.moveTo(px * zoom + 0.5, py * zoom + 0.5)));
      g.closePath();
      g.stroke();
    }
    g.drawImage(it.cv, 0, 0, it.cv.width, it.cv.height, x * zoom, (base - it.ay) * zoom, it.cv.width * zoom, it.cv.height * zoom);
    if (state.marks && it.anchorMark !== false) {
      g.fillStyle = '#ff2a6a';
      g.fillRect(ox * zoom + Math.floor(zoom / 2) - 1, base * zoom, Math.max(2, zoom), Math.max(2, zoom));
    }
    x += it.cv.width + gap;
  }
  return cv;
}

// ---------------------------------------------------------------------------
// Height check
// ---------------------------------------------------------------------------

interface Check {
  px: number;
  persons: number;
  target: Target;
  pass: boolean;
}

function check(px: number, key: SectTargetKey): Check {
  const target = SECT_TARGETS[key];
  const persons = px / PERSON_PX;
  return { px, persons, target, pass: persons >= target.min && persons <= target.max };
}

const html = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

function head(name: string, source: string, c: Check, extra = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = 'head';
  d.innerHTML = `<b>${html(name)}</b><span>${html(source)}</span><span>height ${c.px}px = ${c.persons.toFixed(2)} persons</span><span>target ${c.target.want} (${c.target.min}-${c.target.max})</span><span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</span>${extra ? `<span>${html(extra)}</span>` : ''}`;
  return d;
}

// ---------------------------------------------------------------------------
// Procedural assets
// ---------------------------------------------------------------------------

function proceduralItems(a: SectAssetDef): { items: Item[]; check: Check } {
  const items: Item[] = [];
  for (const dir of [0, 1, 2, 3] as const) {
    const s = a.make(dir, 0);
    items.push({ label: `dir ${dir}`, cv: pbToCanvas(s.pb), ax: s.ax, ay: s.ay, fp: s.footprint });
  }
  if (a.frames > 1) for (let f = 1; f < a.frames; f++) {
    const s = a.make(0, f);
    items.push({ label: `dir 0 frame ${f}`, cv: pbToCanvas(s.pb), ax: s.ax, ay: s.ay, fp: s.footprint });
  }
  return { items, check: check(a.make(0, 0).heightPx, a.key) };
}

// ---------------------------------------------------------------------------
// Imported assets (the Vite globs only exist in the dev gallery)
// ---------------------------------------------------------------------------

const metaFiles = import.meta.glob('./assets/sprites/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const pngUrls = import.meta.glob('./assets/sprites/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

async function importedItems(meta: ImportedMeta): Promise<Item[]> {
  await importedSprites.load(meta.id);
  const items: Item[] = [];
  for (const dir of [0, 1, 2, 3]) {
    const s = importedSprites.get(meta.id, dir);
    if (s) items.push({ label: `dir ${dir}${meta.dirs[String(dir)]?.from !== undefined ? ' (derived)' : ''}`, cv: s.cv, ax: s.ax, ay: s.ay, fp: meta.footprint });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const out = document.getElementById('out')!;
  const summary = document.getElementById('summary')!;
  const bar = document.getElementById('bar')!;
  const keyOf = new Map<string, SectTargetKey>(SECT_ASSETS.map((a) => [a.id, a.key]));
  for (const [file, raw] of Object.entries(metaFiles)) {
    const id = /\/([a-z0-9_]+)\.json$/.exec(file)?.[1] ?? file;
    try {
      importedSprites.register(raw, (f) => pngUrls[`./assets/sprites/${id}/${f}`] ?? f);
    } catch (e) {
      out.insertAdjacentHTML('beforeend', `<p class="fail">${html((e as Error).message)}</p>`);
    }
  }

  const marks = document.createElement('label');
  marks.innerHTML = `<input type="checkbox" ${state.marks ? 'checked' : ''}> anchor (pink) and footprint diamond`;
  marks.querySelector('input')!.addEventListener('change', (e) => {
    state.marks = (e.target as HTMLInputElement).checked;
    void render();
  });
  bar.append(marks);
  const tallies = { pass: 0, fail: 0 };
  const rows: string[] = [];

  async function render(): Promise<void> {
    out.innerHTML = '';
    tallies.pass = tallies.fail = 0;
    rows.length = 0;
    out.insertAdjacentHTML('beforeend', '<h2>Procedural (art/sectprops.ts)</h2><p class="note">Drawn in code from the shared ramps; dirs 2 and 3 of the symmetric props reuse the two street axes, the cart and the ox mirror dirs 0 and 3.</p>');
    for (const a of SECT_ASSETS) {
      const p = proceduralItems(a);
      await block(a.id, a.name, 'procedural', p.items, p.check, `footprint ${a.footprint.w}x${a.footprint.d}`);
    }
    const ids = importedSprites.ids();
    out.insertAdjacentHTML('beforeend', `<h2>Imported (assets/sprites, ${ids.length})</h2>${ids.length ? '' : '<p class="note">Nothing imported yet. Run scripts/art/import-sprite.ts, see docs/notes/art-adobe-trial.md.</p>'}`);
    for (const id of ids) {
      const meta = importedSprites.meta(id)!;
      const key = keyOf.get(id.replace(/^selftest_/, ''));
      const items = await importedItems(meta);
      const c = key ? check(meta.heightPx, key) : { px: meta.heightPx, persons: meta.heightPx / PERSON_PX, target: TARGETS.person, pass: false };
      await block(id, id, `imported, ${meta.provenance.tool}`, items, c, key ? `footprint ${meta.footprint.w}x${meta.footprint.d}` : 'no target row for this id');
    }
    summary.innerHTML = `<table><tr><th>asset</th><th>source</th><th>height px</th><th>persons</th><th>target</th><th>result</th></tr>${rows.join('')}</table><p>${tallies.pass} pass, <span class="${tallies.fail ? 'fail' : 'pass'}">${tallies.fail} fail</span></p>`;
    document.body.dataset.ready = '1';
  }

  async function block(id: string, name: string, source: string, items: Item[], c: Check, extra: string): Promise<void> {
    if (c.pass) tallies.pass++;
    else tallies.fail++;
    rows.push(`<tr><td>${html(name)}</td><td>${html(source)}</td><td>${c.px}</td><td>${c.persons.toFixed(2)}</td><td>${c.target.want} (${c.target.min}-${c.target.max})</td><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</td></tr>`);
    const wrap = document.createElement('div');
    wrap.className = 'asset';
    wrap.id = `asset-${id}-${source.split(',')[0]}`;
    wrap.append(head(name, source, c, extra));
    for (const z of zooms) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.append(drawStrip(items, z, true));
      const cap = document.createElement('span');
      cap.textContent = `zoom ${z} (person, house, tree, then ${items.map((i) => i.label).join(', ')})`;
      cell.append(cap);
      const row = document.createElement('div');
      row.className = 'row';
      row.append(cell);
      wrap.append(row);
    }
    out.append(wrap);
  }

  await render();
}

void main();
