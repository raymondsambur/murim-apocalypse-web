/**
 * Dump every item icon to a contact-sheet PNG (nearest-neighbour zoom), grouped by item kind, for a quick look without a browser.
 * Run: npx tsx scripts/art/dump-itemicons.ts [out.png] [zoom] [kind,kind,...]
 */
import { writeFileSync } from 'node:fs';
import { ITEMS } from '@murim/shared';
import { genItemIcon, ICON_PX } from '../../packages/client/src/art/itemicons';
import { encodePng, packedToRgba } from '../../packages/client/src/art/png';

const out = process.argv[2] ?? 'itemicons.png';
const zoom = Number(process.argv[3] ?? 3);
const kinds = process.argv[4]?.split(',');
const items = Object.values(ITEMS).filter((d) => !kinds || kinds.includes(d.kind));
const cols = Math.min(12, Math.max(6, Math.floor(1800 / (ICON_PX * zoom + 6))));
const cell = ICON_PX + 4;
const rows = Math.ceil(items.length / cols);
const W = cols * cell * zoom;
const H = rows * cell * zoom;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const x = i % W;
  const y = (i - x) / W;
  const alt = (Math.floor(x / (cell * zoom)) + Math.floor(y / (cell * zoom))) & 1;
  img[i * 4] = alt ? 40 : 34;
  img[i * 4 + 1] = alt ? 36 : 30;
  img[i * 4 + 2] = alt ? 48 : 42;
  img[i * 4 + 3] = 255;
}
items.forEach((d, n) => {
  const ic = genItemIcon(d, 0);
  const rgba = packedToRgba(ic.pb.px);
  const grgba = ic.glow ? packedToRgba(ic.glow.px) : null;
  const ox = (n % cols) * cell + 2;
  const oy = Math.floor(n / cols) * cell + 2;
  for (let y = 0; y < ICON_PX; y++)
    for (let x = 0; x < ICON_PX; x++) {
      const o = (y * ICON_PX + x) * 4;
      for (let zy = 0; zy < zoom; zy++)
        for (let zx = 0; zx < zoom; zx++) {
          const p = (((oy + y) * zoom + zy) * W + (ox + x) * zoom + zx) * 4;
          if (grgba && grgba[o + 3]) for (let k = 0; k < 3; k++) img[p + k] = Math.min(255, img[p + k] + (grgba[o + k] * grgba[o + 3]) / 255);
          if (rgba[o + 3]) for (let k = 0; k < 3; k++) img[p + k] = rgba[o + k];
        }
    }
});
writeFileSync(out, await encodePng({ w: W, h: H, data: img }));
console.log('wrote', out, W, H, items.length, 'icons');
