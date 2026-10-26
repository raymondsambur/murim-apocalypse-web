/**
 * Dump the procedural sect props to a contact-sheet PNG (nearest-neighbour zoom) for a quick look without a browser.
 * Run: npx tsx scripts/art/dump-sectprops.ts [out.png] [zoom] [id,id,...]
 */
import { writeFileSync } from 'node:fs';
import { encodePng, packedToRgba } from '../../packages/client/src/art/png';
import { SECT_ASSETS, type SectSprite } from '../../packages/client/src/art/sectprops';
import { PERSON_PX } from '../../packages/client/src/art/scale';

const out = process.argv[2] ?? 'sectprops.png';
const zoom = Number(process.argv[3] ?? 3);
const only = process.argv[4]?.split(',');
const cells: { s: SectSprite; label: string }[][] = SECT_ASSETS.filter((a) => !only || only.includes(a.id)).map((a) => {
  const row: { s: SectSprite; label: string }[] = [];
  for (const d of [0, 1, 2, 3] as const) row.push({ s: a.make(d, 0), label: `${a.id} ${d}` });
  if (a.frames > 1) row.push({ s: a.make(0, 1), label: `${a.id} 0b` });
  return row;
});
const cellW = Math.max(...cells.flat().map((c) => c.s.pb.w)) + 8;
const rowH = cells.map((r) => Math.max(...r.map((c) => c.s.pb.h)) + 8);
const cols = Math.max(...cells.map((r) => r.length));
const W = (cellW * cols + 20) * zoom;
const H = (rowH.reduce((a, b) => a + b, 0) + 10) * zoom;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  img[i * 4] = 70;
  img[i * 4 + 1] = 104;
  img[i * 4 + 2] = 56;
  img[i * 4 + 3] = 255;
}
let y0 = 5;
cells.forEach((row, ri) => {
  row.forEach((c, ci) => {
    const ox = 10 + ci * cellW + 4;
    const oy = y0 + rowH[ri] - 4; // ground line
    const rgba = packedToRgba(c.s.pb.px);
    for (let y = 0; y < c.s.pb.h; y++)
      for (let x = 0; x < c.s.pb.w; x++) {
        const a = rgba[(y * c.s.pb.w + x) * 4 + 3];
        if (!a) continue;
        const px = ox + x - c.s.ax + 20;
        const py = oy + y - c.s.ay;
        for (let zy = 0; zy < zoom; zy++)
          for (let zx = 0; zx < zoom; zx++) {
            const X = px * zoom + zx;
            const Y = py * zoom + zy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const o = (Y * W + X) * 4;
            const t = a / 255;
            for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - t) + rgba[(y * c.s.pb.w + x) * 4 + k] * t);
          }
      }
    // 30 px person-height tick at the left edge of each cell
    for (let zy = 0; zy < zoom; zy++) for (let k = 0; k < PERSON_PX * zoom; k += 1) if (k % 2 === 0) { const X = (ox - 2 + 20) * zoom + 0; const Y = (oy - k) * 1; void zy; void X; void Y; }
  });
  y0 += rowH[ri];
});
writeFileSync(out, await encodePng({ w: W, h: H, data: img }));
console.log('wrote', out, W, H);
for (const a of SECT_ASSETS) {
  const s = a.make(0, 0);
  console.log(a.id.padEnd(16), `size ${s.pb.w}x${s.pb.h}`, `anchor ${s.ax},${s.ay}`, `height ${s.heightPx}px = ${(s.heightPx / PERSON_PX).toFixed(2)} persons`);
}
