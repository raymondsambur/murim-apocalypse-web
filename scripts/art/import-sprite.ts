/**
 * Turn a source picture into a game sprite: remove the background, crop, resize to a pixel height, force alpha to 0 / 255,
 * snap the colours to the palette derived from the game art, add the 1 px ink outline, and write
 *   packages/client/src/assets/sprites/<id>/<dir>.png   the sprite
 *   packages/client/src/assets/sprites/<id>.json        id, w, h, ax, ay, top, footprint, heightPx, dirs, provenance
 * The work is done by packages/client/src/art/spriteimport.ts (unit tested); this file is argument parsing and file IO.
 *
 *   npx tsx scripts/art/import-sprite.ts --src in.png --id pack_ox --dir 0 --height 27 \
 *       --tool "Adobe Firefly" --prompt "..." [--footprint 1x1] [--method area|nearest] [--anchor feet|footprint|X,Y]
 *       [--bg auto|none|#rrggbb] [--tolerance 40] [--no-outline] [--derive 1=0:flip,2=3:flip] [--apex-offset N] [--out dir]
 *
 * Run it once per drawn facing (--dir 0..3); --derive adds facings that are copies or mirrors of drawn ones.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../../packages/client/src/art/png';
import { INK, INK_SOFT } from '../../packages/client/src/art/palette';
import { groundEdgeSlopes, paletteFromHex, processSprite, type AnchorMode } from '../../packages/client/src/art/spriteimport';
import type { ImportedMeta } from '../../packages/client/src/art/imported';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function args(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) m.set(k, 'true');
    else {
      m.set(k, next);
      i++;
    }
  }
  return m;
}

const a = args(process.argv.slice(2));
const need = (k: string): string => {
  const v = a.get(k);
  if (!v) {
    console.error(`missing --${k}\n\nsee the header of scripts/art/import-sprite.ts for usage`);
    process.exit(2);
  }
  return v;
};

const src = need('src');
const id = need('id');
const dir = Number(need('dir'));
const height = Number(need('height'));
if (!/^[a-z0-9_]+$/.test(id) || !(dir >= 0 && dir <= 3) || !(height > 3 && height < 400)) {
  console.error('bad --id (a-z0-9_), --dir (0-3) or --height (4-399)');
  process.exit(2);
}
const [fw, fd] = (a.get('footprint') ?? '1x1').split('x').map(Number);
const outRoot = resolve(root, a.get('out') ?? 'packages/client/src/assets/sprites');
const palette = paletteFromHex(JSON.parse(readFileSync(resolve(root, a.get('palette') ?? 'packages/client/src/assets/palette.json'), 'utf8')) as string[]);

const anchorArg = a.get('anchor') ?? 'feet';
const anchor: AnchorMode | { ax: number; ay: number } = anchorArg === 'feet' || anchorArg === 'footprint' ? anchorArg : { ax: Number(anchorArg.split(',')[0]), ay: Number(anchorArg.split(',')[1]) };
const bgArg = a.get('bg') ?? 'auto';
const bg = bgArg === 'none' ? { mode: 'none' as const } : bgArg.startsWith('#') ? { colour: [parseInt(bgArg.slice(1, 3), 16), parseInt(bgArg.slice(3, 5), 16), parseInt(bgArg.slice(5, 7), 16)] as [number, number, number], tolerance: Number(a.get('tolerance') ?? 40) } : { tolerance: Number(a.get('tolerance') ?? 40) };

const source = await decodePng(new Uint8Array(readFileSync(src)));
const out = processSprite(source, {
  height,
  palette,
  method: a.get('method') === 'nearest' ? 'nearest' : 'area',
  bg,
  ink: a.has('no-outline') ? null : a.get('ink') === 'soft' ? INK_SOFT : INK,
  anchor,
  footprint: { w: fw, d: fd },
  apexOffset: Number(a.get('apex-offset') ?? 0),
});

const png = await encodePng(out.img);
if (png.length > 300 * 1024) {
  console.error(`refusing to write ${(png.length / 1024).toFixed(0)} KB, the limit is 300 KB per PNG`);
  process.exit(1);
}
const dirOut = resolve(outRoot, id);
mkdirSync(dirOut, { recursive: true });
writeFileSync(resolve(dirOut, `${dir}.png`), png);

// metadata: merge with what is already there
const metaPath = resolve(outRoot, `${id}.json`);
const prev: ImportedMeta | null = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as ImportedMeta) : null;
const first = !prev || Object.keys(prev.dirs).length === 0;
const entry: ImportedMeta['dirs'][string] = { file: `${dir}.png` };
if (!first && (out.img.w !== prev.w || out.img.h !== prev.h || out.ax !== prev.ax || out.ay !== prev.ay || out.top !== prev.top)) Object.assign(entry, { w: out.img.w, h: out.img.h, ax: out.ax, ay: out.ay, top: out.top });
const meta: ImportedMeta = {
  id,
  w: first ? out.img.w : prev.w,
  h: first ? out.img.h : prev.h,
  ax: first ? out.ax : prev.ax,
  ay: first ? out.ay : prev.ay,
  top: first ? out.top : prev.top,
  footprint: out.footprint,
  heightPx: first ? out.heightPx : prev.heightPx,
  dirs: { ...(prev?.dirs ?? {}), [String(dir)]: entry },
  provenance: { tool: a.get('tool') ?? prev?.provenance.tool ?? 'unknown', prompt: a.get('prompt') ?? prev?.provenance.prompt ?? '', date: a.get('date') ?? new Date().toISOString().slice(0, 10) },
};
for (const spec of (a.get('derive') ?? '').split(',').filter(Boolean)) {
  const m = /^([0-3])=([0-3])(:flip)?$/.exec(spec);
  if (!m) {
    console.error(`bad --derive entry "${spec}" (want e.g. 1=0:flip)`);
    process.exit(2);
  }
  meta.dirs[m[1]] = m[3] ? { from: Number(m[2]), flip: true } : { from: Number(m[2]) };
}
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

const slopes = groundEdgeSlopes(out.img);
console.log(`${id}/${dir}.png  ${out.img.w}x${out.img.h}  anchor ${out.ax},${out.ay}  height ${out.heightPx}px  ${out.stats.colours} colours  ${out.stats.opaque} opaque px  ${(png.length / 1024).toFixed(1)} KB`);
console.log(`  background removed: ${out.stats.bgRemoved} px, specks removed: ${out.stats.specksRemoved}, translucent px: ${out.stats.translucent}`);
console.log(`  ground edge slopes (2:1 diamond = 0.50): left ${slopes.left.toFixed(2)}, right ${slopes.right.toFixed(2)}`);
console.log(`  wrote ${statSync(metaPath).size} byte metadata -> ${metaPath}`);
