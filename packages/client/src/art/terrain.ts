/**
 * Procedural ground painter. A chunk is 16x16 tiles painted per art pixel into a 512x256 PixelBuffer.
 *
 * Each pixel is mapped back to continuous tile space and assigned to one of the four nearest tiles by a noisy,
 * weighted Voronoi rule: "pushier" terrain (roads, sand, snow) bleeds into softer neighbours, so every
 * boundary is organic instead of following the tile diamonds. Textures are driven by world-anchored noise
 * and hashes, so chunk seams are invisible and no tile ever repeats.
 *
 * Pure (no DOM): unit-testable and dumpable to PNG in node.
 */
import { T, TERRAIN_COUNT } from '@murim/shared';
import { cb, cg, corrupt, cr, mix, rgba, scale, type Col, hex } from './color';
import { ihash, noiseTables, NoiseTex } from './noise';
import { PixelBuffer } from './pixel';
import { BLIGHT, TERRAIN_PAL, WATER } from './palette';

export const CHUNK = 16;
export const CHUNK_PX_W = 512;
export const CHUNK_PX_H = 256;
export const WATER_FRAMES = 4;

export interface TerrainSource {
  w: number;
  h: number;
  terrain: Uint8Array;
  /** Optional Blight map (w*h bytes). */
  blight?: Uint8Array | null;
}

export interface ChunkPaint {
  base: PixelBuffer;
  /** Animated water frames (foam + glints), or null when the chunk holds no water. */
  water: PixelBuffer[] | null;
  /** Additive vein glow layer for heavily blighted chunks, or null. */
  veins: PixelBuffer | null;
  maxBlight: number;
}

/** World art-pixel offset of a chunk canvas origin (top-left). */
export function chunkOrigin(cx: number, cy: number): { ox: number; oy: number } {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  return { ox: (x0 - y0) * 16 - 256, oy: (x0 + y0) * 8 - 8 };
}

// ---------------------------------------------------------------------------
// Palettes (parsed once)
// ---------------------------------------------------------------------------

interface Pal {
  d: Col;
  b: Col;
  l: Col;
  a: Col;
}

const PAL: Pal[][] = [];
for (let t = 0; t < TERRAIN_COUNT; t++) {
  const row: Pal[] = [];
  for (let s = 0; s < 4; s++) {
    const p = TERRAIN_PAL[t][s];
    row.push({ d: hex(p[0]), b: hex(p[1]), l: hex(p[2]), a: hex(p[3]) });
  }
  PAL.push(row);
}

/** Terrain "push": higher values bleed into lower ones. */
const BIAS = new Float32Array(TERRAIN_COUNT);
/** 0 = organic noisy borders, 1 = follows the tile geometry. */
const CRISP = new Float32Array(TERRAIN_COUNT);
BIAS[T.DeepWater] = -0.1;
BIAS[T.Water] = -0.06;
BIAS[T.Sand] = 0.03;
BIAS[T.Grass] = 0;
BIAS[T.Plains] = 0.005;
BIAS[T.Forest] = 0.045;
BIAS[T.Hill] = 0.035;
BIAS[T.Snow] = 0.07;
BIAS[T.Dirt] = 0.055;
BIAS[T.Road] = 0.09;
BIAS[T.Plaza] = 0.12;
BIAS[T.Rock] = 0.08;
BIAS[T.Bridge] = 0.3;
BIAS[T.Farm] = 0.11;
BIAS[T.Ruin] = 0.075;
CRISP[T.Road] = 0.35;
CRISP[T.Plaza] = 0.75;
CRISP[T.Bridge] = 0.9;
CRISP[T.Farm] = 0.8;
CRISP[T.Ruin] = 0.35;
CRISP[T.Dirt] = 0.1;

const isWaterCode = (t: number): boolean => t === T.DeepWater || t === T.Water;
const isRoadish = (t: number): boolean => t === T.Dirt || t === T.Road || t === T.Plaza || t === T.Bridge;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const frac = (v: number): number => v - Math.floor(v);

// Colour constants
const SNOW_SPARK = rgba(255, 255, 255);
const MOSS = hex('#4d6a3c');
const WET_SAND = hex('#8c7650');

/** Seasonal accent colours for sprinkled details on grass-like terrain. */
const FLOWER_SPRING = [hex('#f6c3d6'), hex('#ffffff'), hex('#f2e27a')];
const FLOWER_SUMMER = [hex('#f2d45c'), hex('#ffffff'), hex('#e87a8f')];
const LEAF_AUTUMN = [hex('#d2692a'), hex('#b8412a'), hex('#e0a233')];

// ---------------------------------------------------------------------------
// Chunk painting
// ---------------------------------------------------------------------------

const PAD = 3;
const SZ = CHUNK + PAD * 2;

interface Work {
  tiles: Uint8Array; // padded terrain codes
  blight: Uint8Array; // padded
  roadAxis: Uint8Array; // padded: bit0 = road-like neighbour along x, bit1 along y
  // water pass scratch
  wIdx: Int32Array;
  wShore: Float32Array;
  wDepth: Uint8Array;
  wCount: number;
}

let work: Work | null = null;
function getWork(): Work {
  if (!work) {
    work = {
      tiles: new Uint8Array(SZ * SZ),
      blight: new Uint8Array(SZ * SZ),
      roadAxis: new Uint8Array(SZ * SZ),
      wIdx: new Int32Array(CHUNK_PX_W * CHUNK_PX_H),
      wShore: new Float32Array(CHUNK_PX_W * CHUNK_PX_H),
      wDepth: new Uint8Array(CHUNK_PX_W * CHUNK_PX_H),
      wCount: 0,
    };
  }
  return work;
}

export function terrainAt(src: TerrainSource, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= src.w || y >= src.h) return T.DeepWater;
  return src.terrain[y * src.w + x];
}

/** True when the chunk (and its 1-tile border) is only deep water with no Blight. */
export function isPureOcean(src: TerrainSource, cx: number, cy: number): boolean {
  const x0 = cx * CHUNK - 1;
  const y0 = cy * CHUNK - 1;
  for (let y = y0; y < y0 + CHUNK + 2; y++)
    for (let x = x0; x < x0 + CHUNK + 2; x++) {
      if (terrainAt(src, x, y) !== T.DeepWater) return false;
      if (src.blight && x >= 0 && y >= 0 && x < src.w && y < src.h && src.blight[y * src.w + x] > 0) return false;
    }
  return true;
}

const tex = (): NoiseTex[] => noiseTables();

/** Paint one chunk. `season` 0..3. */
export function paintChunk(src: TerrainSource, cx: number, cy: number, season: number): ChunkPaint {
  const wk = getWork();
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const { ox: offX, oy: offY } = chunkOrigin(cx, cy);
  const tiles = wk.tiles;
  const bl = wk.blight;
  let maxBlight = 0;
  let anyWater = false;
  for (let j = 0; j < SZ; j++)
    for (let i = 0; i < SZ; i++) {
      const wx = x0 + i - PAD;
      const wy = y0 + j - PAD;
      const code = terrainAt(src, wx, wy);
      tiles[j * SZ + i] = code;
      if (isWaterCode(code)) anyWater = true;
      let bv = 0;
      if (src.blight && wx >= 0 && wy >= 0 && wx < src.w && wy < src.h) bv = src.blight[wy * src.w + wx];
      bl[j * SZ + i] = bv;
      if (bv > maxBlight && i >= PAD - 1 && j >= PAD - 1 && i < SZ - PAD + 1 && j < SZ - PAD + 1) maxBlight = bv;
    }
  for (let j = 1; j < SZ - 1; j++)
    for (let i = 1; i < SZ - 1; i++) {
      const k = j * SZ + i;
      let m = 0;
      if (isRoadish(tiles[k - 1]) || isRoadish(tiles[k + 1])) m |= 1;
      if (isRoadish(tiles[k - SZ]) || isRoadish(tiles[k + SZ])) m |= 2;
      wk.roadAxis[k] = m;
    }

  const base = new PixelBuffer(CHUNK_PX_W, CHUNK_PX_H);
  const veins = maxBlight > 120 ? new PixelBuffer(CHUNK_PX_W, CHUNK_PX_H) : null;
  const [tBroad, tMed, tFine, tRidge] = tex();
  const px = base.px;
  wk.wCount = 0;
  const w = wk.wIdx;
  const wShore = wk.wShore;
  const wDepth = wk.wDepth;

  const score = [0, 0, 0, 0];
  const codes = [0, 0, 0, 0];
  const wtx = [0, 0, 0, 0];
  const wty = [0, 0, 0, 0];

  for (let py = 0; py < CHUNK_PX_H; py++) {
    const ay = py + 0.5 + offY;
    const b = ay / 8;
    for (let pxl = 0; pxl < CHUNK_PX_W; pxl++) {
      const ax = pxl + 0.5 + offX;
      const a = ax / 16;
      const fx = (a + b) * 0.5;
      const fy = (b - a) * 0.5;
      const tx = Math.floor(fx + 0.5);
      const ty = Math.floor(fy + 0.5);
      const lx = tx - x0;
      const ly = ty - y0;
      if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK) continue;
      // Domain-warped coordinates decide which tile a pixel belongs to, so borders never follow the diamonds.
      // Crisp terrain (roads, plazas, fields, bridges) is warped much less.
      const ux = fx - tx < 0 ? -1 : 1;
      const uy = fy - ty < 0 ? -1 : 1;
      const k0 = (ty - y0 + PAD) * SZ + (tx - x0 + PAD);
      const crispNear = Math.max(CRISP[tiles[k0]], CRISP[tiles[k0 + ux]], CRISP[tiles[k0 + uy * SZ]], CRISP[tiles[k0 + ux + uy * SZ]]);
      const wk2 = 1 - 0.8 * crispNear;
      const wfx = fx + ((tMed.at(fx * 22 + 5, fy * 22 + 91) - 0.5) * 0.95 + (tFine.at(fx * 47, fy * 47) - 0.5) * 0.4) * wk2;
      const wfy = fy + ((tMed.at(fx * 22 + 140, fy * 22 + 7) - 0.5) * 0.95 + (tFine.at(fx * 47 + 77, fy * 47) - 0.5) * 0.4) * wk2;
      const vtx = Math.floor(wfx + 0.5);
      const vty = Math.floor(wfy + 0.5);
      const dx = wfx - vtx;
      const dy = wfy - vty;
      const sx = dx < 0 ? -1 : 1;
      const sy = dy < 0 ? -1 : 1;
      const ki = (vty - y0 + PAD) * SZ + (vtx - x0 + PAD);
      const c0 = tiles[ki];
      const c1 = tiles[ki + sx];
      const c2 = tiles[ki + sy * SZ];
      const c3 = tiles[ki + sx + sy * SZ];

      let win = 0;
      let margin = 1;
      let wtX = vtx;
      let wtY = vty;
      const ix = ax | 0;
      const iy = ay | 0;
      const axx = ax < 0 ? Math.floor(ax) : ix;
      const ayy = ay < 0 ? Math.floor(ay) : iy;
      let wcode = c0;
      let shore = 9;
      if (c0 === c1 && c0 === c2 && c0 === c3) {
        // uniform neighbourhood
      } else {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const ex = 1 - adx;
        const ey = 1 - ady;
        codes[0] = c0;
        codes[1] = c1;
        codes[2] = c2;
        codes[3] = c3;
        wtx[0] = vtx;
        wty[0] = vty;
        wtx[1] = vtx + sx;
        wty[1] = vty;
        wtx[2] = vtx;
        wty[2] = vty + sy;
        wtx[3] = vtx + sx;
        wty[3] = vty + sy;
        score[0] = Math.sqrt(adx * adx + ady * ady);
        score[1] = Math.sqrt(ex * ex + ady * ady);
        score[2] = Math.sqrt(adx * adx + ey * ey);
        score[3] = Math.sqrt(ex * ex + ey * ey);
        for (let c = 0; c < 4; c++) {
          const code = codes[c];
          const nz = (tMed.at(fx * 22 + c * 61, fy * 22 + c * 37) - 0.5) * 0.5 * (1 - CRISP[code]);
          score[c] = score[c] - BIAS[code] - nz;
        }
        let best = 0;
        for (let c = 1; c < 4; c++) if (score[c] < score[best]) best = c;
        win = best;
        wcode = codes[best];
        wtX = wtx[best];
        wtY = wty[best];
        let second = 99;
        for (let c = 0; c < 4; c++) if (codes[c] !== wcode && score[c] < second) second = score[c];
        margin = second - score[best];
        if (margin > 1) margin = 1;
        if (wcode === T.DeepWater || wcode === T.Water) shore = marginToLand(codes, score, win);
      }

      // ---- shared noise samples -------------------------------------------------
      const nB = tBroad.at(fx * 11, fy * 11);
      const nM = tMed.at(fx * 29, fy * 29);
      const nF = tFine.near(axx * 0.9, ayy * 1.8);
      const hsh = ihash(axx, ayy, 17) / 4294967296;
      const dith = (BAYER[(axx & 3) + ((ayy & 3) << 2)] + 0.5) / 16 - 0.5;

      // ---- Blight at this pixel (bilinear between tile centres) -----------------
      let bt = 0;
      if (maxBlight > 0) {
        const fxf = Math.floor(fx);
        const fyf = Math.floor(fy);
        const wx2 = fx - fxf;
        const wy2 = fy - fyf;
        const kb = (fyf - y0 + PAD) * SZ + (fxf - x0 + PAD);
        if (kb >= 0 && kb + SZ + 1 < SZ * SZ) {
          const b00 = bl[kb];
          const b10 = bl[kb + 1];
          const b01 = bl[kb + SZ];
          const b11 = bl[kb + SZ + 1];
          const bv = (b00 + (b10 - b00) * wx2) * (1 - wy2) + (b01 + (b11 - b01) * wx2) * wy2;
          bt = bv / 255;
        }
      }

      let col: Col;
      const wdx = fx - wtX;
      const wdy = fy - wtY;
      switch (wcode) {
        case T.DeepWater:
        case T.Water: {
          const deep = wcode === T.DeepWater;
          col = paintWater(deep, margin, nB, nM, dith, season, hsh);
          // remember for animation pass
          const idx = py * CHUNK_PX_W + pxl;
          w[wk.wCount] = idx;
          wShore[wk.wCount] = shore;
          wDepth[wk.wCount] = deep ? 1 : 0;
          wk.wCount++;
          break;
        }
        case T.Grass:
        case T.Plains:
          col = paintGrass(wcode, season, nB, nM, nF, hsh, dith, axx, ayy, margin);
          break;
        case T.Forest:
          col = paintForest(season, nB, nM, hsh, dith, margin);
          break;
        case T.Hill:
          col = paintHill(season, nB, nM, hsh, dith, margin);
          break;
        case T.Dirt:
          col = paintDirt(season, nB, nM, hsh, dith, wdx, wdy, wk.roadAxis[(wtY - y0 + PAD) * SZ + (wtX - x0 + PAD)], margin);
          break;
        case T.Road:
          col = paintRoad(season, nB, hsh, fx, fy, margin);
          break;
        case T.Plaza:
          col = paintPlaza(season, nB, hsh, fx, fy, wtX, wtY, margin);
          break;
        case T.Rock:
          col = paintRock(season, nB, nM, hsh, dith, fx, fy);
          break;
        case T.Sand:
          col = paintSand(season, nB, nM, hsh, dith, fx, fy, margin);
          break;
        case T.Snow:
          col = paintSnow(nB, nM, hsh, dith, fx, fy);
          break;
        case T.Bridge:
          col = paintBridge(season, hsh, fx, fy, wdx, wdy, wk.roadAxis[(wtY - y0 + PAD) * SZ + (wtX - x0 + PAD)], margin);
          break;
        case T.Farm:
          col = paintFarm(season, nB, nM, hsh, wdx, wdy, margin);
          break;
        case T.Ruin:
          col = paintRuin(season, nB, nM, hsh, fx, fy, wtX, wtY, margin);
          break;
        default:
          col = PAL[T.Grass][season].b;
      }

      // ---- wet shoreline on land --------------------------------------------------
      if (!isWaterCode(wcode) && margin < 0.2) {
        let nearWater = false;
        for (let c = 0; c < 4; c++) if (isWaterCode(codes[c]) && score[c] - score[win] < 0.2) nearWater = true;
        if (nearWater) col = wcode === T.Bridge ? col : mix(col, WET_SAND, margin < 0.1 ? 0.55 : 0.22);
      }

      // ---- Blight tint, cracks and veins -------------------------------------------
      if (bt > 0.04) {
        const k = Math.min(1, (bt - 0.04) / 0.5);
        if (!isWaterCode(wcode)) {
          col = corrupt(col, k);
          if (bt > 0.25) {
            const r = tRidge.at(fx * 23, fy * 23);
            const ridge = Math.abs(r - 0.5);
            if (ridge < 0.018 + (bt - 0.25) * 0.05) {
              col = mix(col, BLIGHT.deep, 0.75);
              if (bt > 0.47 && veins) {
                const vi = py * CHUNK_PX_W + pxl;
                veins.px[vi] = ridge < 0.01 + (bt - 0.47) * 0.03 ? BLIGHT.vein : BLIGHT.ooze;
                if (ridge < 0.01) col = mix(col, BLIGHT.ooze, 0.6);
              }
            }
            if (hsh < 0.02 * bt) col = mix(col, BLIGHT.mid, 0.7);
          }
        } else {
          col = mix(corrupt(col, k * 0.8), BLIGHT.deep, k * 0.35);
        }
      }
      px[py * CHUNK_PX_W + pxl] = col;
    }
  }

  let water: PixelBuffer[] | null = null;
  if (anyWater && wk.wCount > 0) water = paintWaterFrames(wk, season, offX, offY);
  return { base, water, veins, maxBlight };
}

function marginToLand(codes: number[], score: number[], win: number): number {
  // Shore distance only counts neighbours that are land.
  let best = 99;
  for (let c = 0; c < 4; c++) if (!isWaterCode(codes[c]) && score[c] - score[win] < best) best = score[c] - score[win];
  return best > 98 ? 9 : best;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

function paintWater(deep: boolean, margin: number, nB: number, nM: number, dith: number, season: number, hsh: number): Col {
  const p = PAL[deep ? T.DeepWater : T.Water][season];
  let v = nB * 0.55 + nM * 0.45 + dith * 0.35;
  // Near the boundary with the other depth class, dither toward its colour.
  let c: Col;
  if (v < 0.36) c = p.d;
  else if (v > 0.66) c = p.l;
  else c = p.b;
  if (!deep) {
    if (season === 3) {
      // Ice sheet: pale, with hairline cracks.
      const ice = v > 0.6 ? WATER.iceLight : v < 0.34 ? WATER.iceCrack : WATER.ice;
      c = hsh < 0.02 ? WATER.iceCrack : ice;
      return c;
    }
    if (margin < 0.5 && v + (0.5 - margin) * 0.5 > 0.62) c = p.l;
  } else if (season === 3 && margin < 0.12) {
    c = mix(c, WATER.ice, 0.55);
  }
  void hsh;
  return c;
}

/** Animated overlay frames: shoreline foam bands and drifting glints. */
function paintWaterFrames(wk: Work, season: number, offX: number, offY: number): PixelBuffer[] {
  const frames: PixelBuffer[] = [];
  const foamC = rgba(236, 248, 246);
  const foamD = rgba(190, 226, 230);
  const glint = rgba(232, 246, 255);
  const glintDeep = rgba(120, 178, 214);
  const [, tMed] = tex();
  for (let f = 0; f < WATER_FRAMES; f++) {
    const pb = new PixelBuffer(CHUNK_PX_W, CHUNK_PX_H);
    const ph = f / WATER_FRAMES;
    const ice = season === 3;
    for (let n = 0; n < wk.wCount; n++) {
      const idx = wk.wIdx[n];
      const pxl = idx % CHUNK_PX_W;
      const py = (idx / CHUNK_PX_W) | 0;
      const ax = pxl + offX;
      const ay = py + offY;
      const shore = wk.wShore[n];
      let out = 0;
      if (!ice && shore < 0.5) {
        // Foam: a travelling band that breathes in and out (1 art px of margin ~ 0.09).
        const wave = 0.5 + 0.5 * Math.sin((ph + tMed.near(ax * 0.5, ay) * 0.9) * Math.PI * 2);
        const band = 0.1 + wave * 0.26;
        if (shore < 0.09) out = foamC;
        else if (shore < band) out = (ax + ay + f) & 1 ? foamC : foamD;
        else if (shore < band + 0.1 && ((ax >> 1) + (ay >> 1) + f) % 3 === 0) out = foamD;
      }
      if (!out) {
        // Glints: short horizontal dashes that wander.
        const gx = ax + f * 3;
        const hh = ihash(gx >> 2, ay >> 1, f * 0 + 91) >>> 0;
        const sel = (hh & 1023) / 1023;
        if (sel > (ice ? 0.99 : 0.972) && (gx & 3) < (hh & 1 ? 3 : 2)) {
          const wave = Math.sin((f / WATER_FRAMES + (hh >>> 12) / 1048576) * Math.PI * 2);
          if (wave > -0.2) out = wk.wDepth[n] ? glintDeep : glint;
        }
      }
      if (out) pb.px[idx] = out;
    }
    frames.push(pb);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Land textures
// ---------------------------------------------------------------------------

function tone3(v: number, p: Pal): Col {
  return v < 0.38 ? p.d : v > 0.64 ? p.l : p.b;
}

function paintGrass(code: number, season: number, nB: number, nM: number, nF: number, hsh: number, dith: number, ax: number, ay: number, margin: number): Col {
  const p = PAL[code][season];
  const v = nB * 0.55 + nM * 0.3 + nF * 0.15 + dith * 0.3;
  if (season === 3) {
    // Snow dusting with grass peeking through.
    if (v < 0.26 + (hsh < 0.1 ? 0.06 : 0) && nM < 0.55) return p.a;
    const tone = v > 0.72 ? p.l : v < 0.4 ? p.d : p.b;
    if (hsh > 0.992) return SNOW_SPARK;
    return tone;
  }
  let c = tone3(v, p);
  // Blade tufts: dark base pixel with a light tip above it.
  const h2 = ihash(ax, ay + 1, 17) / 4294967296;
  if (h2 < 0.028) c = p.d;
  else if (hsh < 0.028) c = p.l;
  // Flowers / leaves
  if (season === 0 && hsh > 0.9945 && nB > 0.35) c = FLOWER_SPRING[ihash(ax >> 1, ay >> 1) % 3];
  else if (season === 1 && hsh > 0.9965 && nB > 0.42) c = FLOWER_SUMMER[ihash(ax >> 1, ay >> 1) % 3];
  else if (season === 2 && hsh > 0.985) c = LEAF_AUTUMN[ihash(ax, ay) % 3];
  if (code === T.Plains && hsh > 0.07 && hsh < 0.1) c = p.a;
  void margin;
  return c;
}

function paintForest(season: number, nB: number, nM: number, hsh: number, dith: number, margin: number): Col {
  const p = PAL[T.Forest][season];
  const v = nB * 0.45 + nM * 0.4 + dith * 0.3;
  if (season === 3) {
    if (v < 0.3 && nM < 0.5) return p.a;
    return v > 0.7 ? p.l : v < 0.42 ? p.d : p.b;
  }
  let c = tone3(v, p);
  if (hsh < 0.045) c = p.d; // shade flecks
  else if (hsh > 0.975) c = p.a; // leaf litter / needles
  else if (hsh > 0.955 && nM > 0.6) c = p.l; // dappled light
  void margin;
  return c;
}

function paintHill(season: number, nB: number, nM: number, hsh: number, dith: number, margin: number): Col {
  const p = PAL[T.Hill][season];
  const v = nB * 0.5 + nM * 0.35 + dith * 0.3;
  if (season === 3) {
    if (v < 0.3 && nM < 0.5) return p.a;
    return v > 0.7 ? p.l : v < 0.42 ? p.d : p.b;
  }
  let c = tone3(v, p);
  if (nM > 0.7 && hsh < 0.5) c = mix(p.a, p.l, hsh) ; // rocky outcrops
  else if (hsh < 0.04) c = p.d;
  else if (hsh > 0.97) c = p.l;
  void margin;
  return c;
}

function paintDirt(season: number, nB: number, nM: number, hsh: number, dith: number, dx: number, dy: number, axis: number, margin: number): Col {
  const p = PAL[T.Dirt][season];
  const v = nB * 0.4 + nM * 0.4 + dith * 0.35;
  let c = tone3(v, p);
  if (hsh < 0.035) c = p.a;
  else if (hsh > 0.975) c = p.l;
  // Cart ruts on straight stretches.
  if (axis === 1 || axis === 2) {
    const across = axis === 1 ? dy : dx;
    const r1 = Math.abs(Math.abs(across) - 0.2);
    if (r1 < 0.045 && nM > 0.28) c = r1 < 0.02 ? p.a : p.d;
  }
  // Worn edge toward softer neighbours.
  if (margin < 0.1) c = p.d;
  return c;
}

function paintRoad(season: number, nB: number, hsh: number, fx: number, fy: number, margin: number): Col {
  const p = PAL[T.Road][season];
  // Staggered pavers aligned with the tile axes.
  const row = Math.floor(fy * 4 + 0.5);
  const u = fx * 3 + (row & 1) * 0.5;
  const fu = frac(u);
  const fv = frac(fy * 4 + 0.5);
  const cellId = ihash(Math.floor(u), row, 5) / 4294967296;
  if (fu < 0.1 || fv < 0.16) return p.a; // mortar
  let c = cellId < 0.3 ? p.d : cellId > 0.7 ? p.l : p.b;
  if (fv > 0.82 || fu > 0.9) c = mix(c, p.l, 0.25); // top bevel
  if (hsh < 0.03) c = p.d;
  if (margin < 0.09) c = mix(c, p.d, 0.6);
  void nB;
  return c;
}

function paintPlaza(season: number, nB: number, hsh: number, fx: number, fy: number, tx: number, ty: number, margin: number): Col {
  const p = PAL[T.Plaza][season];
  const sx = Math.floor(fx * 2 + 1);
  const sy = Math.floor(fy * 2 + 1);
  const fu = frac(fx * 2 + 1);
  const fv = frac(fy * 2 + 1);
  const slab = ihash(sx, sy, 9) / 4294967296;
  if (fu < 0.07 || fv < 0.07) return p.a;
  let c = slab < 0.25 ? p.d : slab > 0.7 ? p.l : p.b;
  if (fu < 0.16 || fv < 0.16) c = mix(c, p.l, 0.3);
  if (hsh < 0.02) c = p.d;
  // Ornamental inlay at the middle of each tile.
  const cx = Math.abs(fx - tx);
  const cy = Math.abs(fy - ty);
  if (cx + cy < 0.17 && ((tx * 7 + ty * 13) & 3) === 0) c = mix(c, p.a, 0.5);
  if (margin < 0.09) c = mix(c, p.d, 0.5);
  void nB;
  return c;
}

function paintRock(season: number, nB: number, nM: number, hsh: number, dith: number, fx: number, fy: number): Col {
  const p = PAL[T.Rock][season];
  const v = nB * 0.4 + nM * 0.5 + dith * 0.3;
  let c = tone3(v, p);
  if (hsh < 0.06) c = p.a;
  else if (hsh > 0.97) c = p.l;
  void fx;
  void fy;
  return c;
}

function paintSand(season: number, nB: number, nM: number, hsh: number, dith: number, fx: number, fy: number, margin: number): Col {
  const p = PAL[T.Sand][season];
  const ripple = Math.sin((fx * 1.3 - fy * 0.7) * 9 + nB * 11) * 0.5 + 0.5;
  const v = nB * 0.4 + ripple * 0.2 + nM * 0.25 + dith * 0.25;
  let c = tone3(v, p);
  if (hsh < 0.03) c = p.a;
  else if (hsh > 0.985) c = p.l;
  void margin;
  return c;
}

function paintSnow(nB: number, nM: number, hsh: number, dith: number, fx: number, fy: number): Col {
  const p = PAL[T.Snow][3];
  const v = nB * 0.5 + nM * 0.35 + dith * 0.3;
  let c = v < 0.34 ? p.d : v > 0.66 ? p.l : p.b;
  if (hsh > 0.992) c = SNOW_SPARK;
  else if (hsh < 0.02) c = p.d;
  void fx;
  void fy;
  return c;
}

function paintBridge(season: number, hsh: number, fx: number, fy: number, dx: number, dy: number, axis: number, margin: number): Col {
  const p = PAL[T.Bridge][season];
  // Planks run across the direction of travel.
  const along = axis === 2 ? fy : fx;
  const across = axis === 2 ? dx : dy;
  const pl = frac(along * 5 + 0.5);
  const plank = Math.floor(along * 5 + 0.5);
  if (Math.abs(across) > 0.43) return p.d; // stringers at the sides
  if (pl < 0.12) return p.a;
  const id = ihash(plank, 3, 7) / 4294967296;
  let c = id < 0.3 ? p.d : id > 0.7 ? p.l : p.b;
  if (hsh < 0.04) c = p.d;
  if (pl > 0.85) c = mix(c, p.l, 0.3);
  void margin;
  return c;
}

const CROP_SPRING = hex('#7fcf55');
const CROP_SUMMER = hex('#4f9c3c');
const CROP_SUMMER_L = hex('#78c24d');
const CROP_AUTUMN = hex('#d9b14a');
const CROP_AUTUMN_L = hex('#f0cf69');

function paintFarm(season: number, nB: number, nM: number, hsh: number, dx: number, dy: number, margin: number): Col {
  const p = PAL[T.Farm][season];
  // Rows along the x axis: four per tile.
  const rowPos = (dy + 0.5) * 4;
  const r = Math.floor(rowPos);
  const rf = rowPos - r;
  const crop = (r + ((dx + 0.5) > 0.5 ? 0 : 0)) & 1;
  let c: Col = nM < 0.4 ? p.d : p.b;
  if (crop === 0) {
    // ridge with crop
    if (season === 3) {
      c = rf > 0.2 && rf < 0.8 ? mix(p.l, rgba(235, 240, 245), 0.7) : p.d;
    } else {
      const rowCol = season === 0 ? CROP_SPRING : season === 1 ? (hsh < 0.5 ? CROP_SUMMER : CROP_SUMMER_L) : hsh < 0.5 ? CROP_AUTUMN : CROP_AUTUMN_L;
      const tall = season === 0 ? 0.25 : season === 1 ? 0.6 : 0.7;
      if (rf > 0.15 && rf < 0.15 + tall * 0.8) c = rowCol;
      if (season !== 0 && hsh > 0.8) c = scale(rowCol, 0.78);
      if (rf >= 0.15 + tall * 0.8 - 0.12 && rf < 0.15 + tall * 0.8 && season !== 0) c = scale(rowCol, 1.12);
    }
  } else {
    c = rf < 0.2 ? p.l : nB < 0.4 ? p.d : p.b; // furrow
    if (season === 3 && hsh > 0.5) c = mix(c, rgba(215, 222, 230), 0.4);
  }
  if (margin < 0.09) c = scale(c, 0.78);
  return c;
}

function paintRuin(season: number, nB: number, nM: number, hsh: number, fx: number, fy: number, tx: number, ty: number, margin: number): Col {
  const p = PAL[T.Ruin][season];
  const sx = Math.floor(fx * 2 + 1);
  const sy = Math.floor(fy * 2 + 1);
  const fu = frac(fx * 2 + 1);
  const fv = frac(fy * 2 + 1);
  const slab = ihash(sx, sy, 21) / 4294967296;
  if (slab < 0.22) {
    // broken slab: bare earth with moss
    return nM > 0.55 ? MOSS : hsh < 0.3 ? PAL[T.Dirt][season].d : PAL[T.Dirt][season].b;
  }
  if (fu < 0.08 || fv < 0.08) return p.a;
  let c = slab < 0.5 ? p.d : slab > 0.8 ? p.l : p.b;
  // crack
  if (Math.abs(frac(fx * 3.1 + fy * 1.7) - 0.5) < 0.025 && nB > 0.4) c = p.a;
  if (nM > 0.72 && hsh < 0.5) c = MOSS;
  if (hsh < 0.025) c = p.a;
  void tx;
  void ty;
  void margin;
  return c;
}

// Exported for minimap and tests.
export function terrainSummaryColor(code: number, season: number): Col {
  return PAL[code]?.[season]?.b ?? 0xff808080;
}

export function colorRgb(c: Col): [number, number, number] {
  return [cr(c), cg(c), cb(c)];
}
