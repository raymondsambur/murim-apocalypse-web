import { describe, expect, it } from 'vitest';
import palette from '../assets/palette.json';
import { cb, cg, cr, hex, rgba } from './color';
import { decodePng, encodePng, packedToRgba, rgbaToPacked, type RawImage } from './png';
import {
  addOutline,
  anchorFor,
  cleanAlpha,
  cloneImage,
  colourDist2,
  countColours,
  cropToBounds,
  derivePalette,
  groundEdgeSlopes,
  imageStats,
  mirrorSpans,
  nearestIndex,
  opaqueBounds,
  paletteFromHex,
  paletteToHex,
  processSprite,
  removeBackground,
  removeSpecks,
  resizeToHeight,
  snapToPalette,
  spansOf,
} from './spriteimport';
import { genPackOx } from './sectprops';
import { INK } from './palette';

const PAL = paletteFromHex(palette);

function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): RawImage {
  const out: RawImage = { w, h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data.set(fn(x, y), (y * w + x) * 4);
  return out;
}
const px = (i: RawImage, x: number, y: number): number[] => [...i.data.subarray((y * i.w + x) * 4, (y * i.w + x) * 4 + 4)];

describe('png codec', () => {
  it('round-trips RGBA exactly', async () => {
    const a = img(13, 7, (x, y) => [x * 19, y * 33, (x * y) & 255, x === 3 ? 0 : 255]);
    const back = await decodePng(await encodePng(a));
    expect(back.w).toBe(13);
    expect(back.h).toBe(7);
    expect([...back.data]).toEqual([...a.data]);
  });
  it('rejects non-PNG bytes and converts packed colours both ways', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow();
    const raw = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]);
    expect(rgbaToPacked(raw)[0]).toBe(rgba(10, 20, 30));
    expect([...packedToRgba(rgbaToPacked(raw))]).toEqual([...raw]);
  });
});

describe('palette derived from the game art', () => {
  it('the committed palette is real: 96 distinct opaque colours incl. the ink and lacquer', () => {
    expect(PAL.length).toBe(96);
    expect(new Set(PAL).size).toBe(96);
    expect(PAL).toContain(INK);
    expect(paletteToHex(PAL.slice(0, 2))).toEqual(['#1c1820', '#2c2630']);
  });
  it('median cut keeps dominant colours and respects the size and forced colours', () => {
    const counts = new Map<number, number>();
    const red = rgba(200, 30, 30);
    const blue = rgba(30, 30, 200);
    counts.set(red, 1000);
    counts.set(rgba(210, 40, 35), 500);
    counts.set(blue, 900);
    counts.set(rgba(20, 20, 190), 300);
    counts.set(rgba(10, 200, 10), 1);
    const pal = derivePalette(counts, 3, [INK]);
    expect(pal.length).toBe(3);
    expect(pal[0]).toBe(INK);
    // both big clusters are represented within a small distance
    const near = (c: number): number => Math.min(...pal.slice(1).map((p) => colourDist2(cr(c), cg(c), cb(c), cr(p), cg(p), cb(p))));
    expect(near(red)).toBeLessThan(400);
    expect(near(blue)).toBeLessThan(400);
  });
  it('counts only fully opaque pixels (baked shadows are ignored)', () => {
    const c = countColours(new Uint32Array([rgba(1, 2, 3), rgba(1, 2, 3, 100), 0, rgba(9, 9, 9)]));
    expect(c.get(rgba(1, 2, 3))).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe('snapping to the palette', () => {
  it('maps every opaque pixel onto a palette colour and leaves transparent ones alone', () => {
    const a = img(8, 8, (x, y) => (x < 2 ? [0, 0, 0, 0] : [(x * 31 + y * 7) & 255, (x * 13 + y * 29) & 255, (x * 5 + y * 3) & 255, 255]));
    const used = snapToPalette(a, PAL);
    expect(used).toBeGreaterThan(1);
    const set = new Set(PAL);
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i + 3] === 0) expect(a.data[i]).toBe(0);
      else expect(set.has(rgba(a.data[i], a.data[i + 1], a.data[i + 2]))).toBe(true);
    }
  });
  it('picks the nearest colour and is exact for colours already in the palette', () => {
    const i = nearestIndex(PAL, cr(PAL[7]), cg(PAL[7]), cb(PAL[7]));
    expect(i).toBe(7);
    expect(PAL[nearestIndex(PAL, 168, 48, 42)]).toBe(hex('#a8302a'));
  });
});

describe('alpha and background', () => {
  it('forces alpha to 0 or 255 and clears the colour under transparency', () => {
    const a = img(4, 1, (x) => [200, 100, 50, [0, 100, 127, 128][x]]);
    const n = cleanAlpha(a, 128);
    expect(n).toBe(1);
    expect([0, 1, 2].map((x) => px(a, x, 0))).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(px(a, 3, 0)).toEqual([200, 100, 50, 255]);
  });
  it('floods the border colour but keeps the same colour inside the object', () => {
    // white background, a red ring around a white hole
    const a = img(20, 20, (x, y) => {
      const dx = x - 10;
      const dy = y - 10;
      const d = Math.hypot(dx, dy);
      if (d < 3) return [255, 255, 255, 255];
      if (d < 7) return [200, 40, 40, 255];
      return [250, 250, 252, 255];
    });
    const removed = removeBackground(a, {});
    expect(removed).toBeGreaterThan(200);
    expect(px(a, 0, 0)[3]).toBe(0);
    expect(px(a, 10, 10)).toEqual([255, 255, 255, 255]); // the hole is part of the object
    expect(px(a, 10, 5)[3]).toBe(255);
  });
  it('keeps an image whose border is already transparent', () => {
    const a = img(6, 6, (x, y) => (x > 1 && x < 4 && y > 1 && y < 4 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
    expect(removeBackground(cloneImage(a))).toBe(0);
  });
  it('removes islands but keeps the main body', () => {
    const a = img(30, 10, (x, y) => (x < 20 ? [9, 9, 9, 255] : x === 25 && y === 5 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
    expect(removeSpecks(a)).toBe(1);
    expect(px(a, 25, 5)[3]).toBe(0);
    expect(px(a, 3, 3)[3]).toBe(255);
  });
});

describe('resize and outline', () => {
  it('area resize averages, nearest picks; both hit the target height and keep the aspect', () => {
    const a = img(20, 20, (x) => (x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const area = resizeToHeight(a, 10, 'area');
    const near = resizeToHeight(a, 10, 'nearest');
    expect([area.w, area.h, near.w, near.h]).toEqual([10, 10, 10, 10]);
    expect(px(area, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(near, 9, 9)).toEqual([0, 0, 255, 255]);
    const b = img(20, 20, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(px(resizeToHeight(b, 10, 'area'), 3, 3)[0]).toBeGreaterThan(100); // mixed to grey
    expect([0, 255]).toContain(px(resizeToHeight(b, 10, 'nearest'), 3, 3)[0]);
  });
  it('area resize does not bleed the transparent colour into the edge', () => {
    const a = img(8, 8, (x) => (x < 4 ? [200, 50, 50, 255] : [0, 255, 0, 0]));
    const r = resizeToHeight(a, 4, 'area');
    for (let y = 0; y < 4; y++) {
      const p = px(r, 1, y);
      expect(p[3]).toBe(255);
      expect(p.slice(0, 3)).toEqual([200, 50, 50]);
    }
  });
  it('outline surrounds the shape by one pixel and leaves its inside alone', () => {
    const a = img(3, 3, () => [10, 200, 10, 255]);
    const o = addOutline(a, INK);
    expect([o.w, o.h]).toEqual([5, 5]);
    expect(px(o, 2, 2)).toEqual([10, 200, 10, 255]);
    expect(px(o, 0, 2)).toEqual([cr(INK), cg(INK), cb(INK), 255]);
    expect(px(o, 0, 0)[3]).toBe(0); // 4-neighbourhood: corners stay empty
    expect(imageStats(o).translucent).toBe(0);
  });
});

describe('anchor, bounds and spans', () => {
  const blob = img(20, 30, (x, y) => (x >= 5 && x < 15 && y >= 8 && y < 26 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
  it('crops to the opaque bounds', () => {
    const c = cropToBounds(blob);
    expect([c.w, c.h]).toEqual([10, 18]);
    expect(opaqueBounds(c)).toEqual({ x0: 0, y0: 0, x1: 9, y1: 17 });
    expect(() => cropToBounds(img(3, 3, () => [0, 0, 0, 0]))).toThrow();
  });
  it('anchors at the feet and at the centre of a footprint diamond', () => {
    const c = cropToBounds(blob);
    expect(anchorFor(c, 'feet')).toEqual({ ax: 5, ay: 17 });
    // a 4 x 1 footprint is 5 tiles of half-height 8 deep: centre 20 px above the nearest corner
    expect(anchorFor(c, 'footprint', { w: 4, d: 1 })).toEqual({ ax: 5, ay: 17 - 20 });
  });
  it('row spans follow the silhouette, empty rows are marked, mirrored spans swap sides', () => {
    const tri = img(9, 5, (x, y) => (y > 0 && x >= 4 - y && x <= 4 + y - 2 ? [1, 1, 1, 255] : [0, 0, 0, 0]));
    const s = spansOf(tri);
    expect(s.max[0]).toBe(-1);
    expect(s.min[0]).toBe(32767);
    expect([s.min[1], s.max[1]]).toEqual([3, 3]);
    expect([s.min[4], s.max[4]]).toEqual([0, 6]);
    const m = mirrorSpans(s, 9);
    expect([m.min[4], m.max[4]]).toEqual([2, 8]);
    expect(m.max[0]).toBe(-1);
  });
  it('measures the 2:1 ground diamond slopes', () => {
    // a diamond 2:1 (half width 16, half height 8)
    const d = img(33, 17, (x, y) => (Math.abs(x - 16) / 16 + Math.abs(y - 8) / 8 <= 1 ? [1, 1, 1, 255] : [0, 0, 0, 0]));
    const s = groundEdgeSlopes(d, 0.5);
    expect(s.left).toBeCloseTo(0.5, 1);
    expect(s.right).toBeCloseTo(0.5, 1);
    // a steeper (3:1 up) shape is detected as not 2:1
    const steep = img(33, 33, (x, y) => (Math.abs(x - 16) / 16 + Math.abs(y - 16) / 16 <= 1 ? [1, 1, 1, 255] : [0, 0, 0, 0]));
    expect(groundEdgeSlopes(steep, 0.5).left).toBeCloseTo(1, 1);
  });
});

describe('processSprite: a messy "AI-like" source becomes a clean game sprite', () => {
  // the procedural ox, upscaled 9x with smooth shading noise, a gradient background and soft edges
  const ox = genPackOx(0, 0);
  const K = 9;
  const W = (ox.pb.w + 8) * K;
  const H = (ox.pb.h + 8) * K;
  const src: RawImage = img(W, H, (X, Y) => {
    const x = Math.floor(X / K) - 4;
    const y = Math.floor(Y / K) - 4;
    const c = x >= 0 && y >= 0 && x < ox.pb.w && y < ox.pb.h ? ox.pb.px[y * ox.pb.w + x] : 0;
    const jitter = ((X * 7 + Y * 13) % 11) - 5;
    if (c >>> 24 === 255) return [Math.min(255, Math.max(0, (c & 255) + jitter)), Math.min(255, Math.max(0, ((c >>> 8) & 255) + jitter)), Math.min(255, Math.max(0, ((c >>> 16) & 255) + jitter)), 255];
    const g = 235 + Math.round((Y / H) * 12) + (jitter >> 2); // near-white gradient background
    return [g, g, g + 2, 255];
  });
  const out = processSprite(src, { height: 34, palette: PAL, method: 'area', ink: INK, anchor: 'feet' });
  it('reaches the target height, keeps the aspect, has alpha 0 or 255 only', () => {
    expect(out.img.h).toBe(34);
    expect(out.heightPx).toBeGreaterThan(30);
    expect(out.heightPx).toBeLessThanOrEqual(34);
    const st = imageStats(out.img);
    expect(st.translucent).toBe(0);
    expect(st.opaque).toBeGreaterThan(300);
    expect(out.stats.bgRemoved).toBeGreaterThan(src.w * src.h * 0.3);
  });
  it('uses only palette colours and has a closed ink outline', () => {
    const set = new Set(PAL);
    for (let i = 0; i < out.img.data.length; i += 4) if (out.img.data[i + 3]) expect(set.has(rgba(out.img.data[i], out.img.data[i + 1], out.img.data[i + 2]))).toBe(true);
    // every transparent pixel next to the shape is ink: no transparent pixel touches a non-ink opaque one
    const { w, h, data } = out.img;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !data[(ny * w + nx) * 4 + 3]) continue;
          // an opaque neighbour of a transparent pixel is part of the outline (ink colour)
          expect(rgba(data[(ny * w + nx) * 4], data[(ny * w + nx) * 4 + 1], data[(ny * w + nx) * 4 + 2])).toBe(INK);
        }
      }
  });
  it('produces an anchor inside the sprite and spans that match the silhouette', () => {
    expect(out.ax).toBeGreaterThan(0);
    expect(out.ax).toBeLessThan(out.img.w);
    expect(out.ay).toBe(out.img.h - 1);
    expect(out.top).toBe(0);
    expect(out.spans.min.length).toBe(out.img.h);
    for (let y = 0; y < out.img.h; y++) {
      const row = out.spans.max[y] >= 0;
      let any = false;
      for (let x = 0; x < out.img.w; x++) if (out.img.data[(y * out.img.w + x) * 4 + 3]) any = true;
      expect(row).toBe(any);
    }
  });
  it('skipping the outline is honoured, and nearest keeps hard source pixels', () => {
    const o2 = processSprite(src, { height: 32, palette: PAL, method: 'nearest', ink: null });
    expect(o2.img.h).toBe(32);
    expect(imageStats(o2.img).translucent).toBe(0);
  });
});
