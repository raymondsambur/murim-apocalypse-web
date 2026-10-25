/** Dev tool: set DUMP=<name> to write PNG contact sheets of sprite frames into the scratchpad (skipped otherwise). */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { Look } from '@murim/shared';
import { genCharacter, type CharSpec } from '../src/art/character';
import { gearAppearance } from '../src/art/gear';
import { PixelBuffer } from '../src/art/pixel';

const OUT = process.env.DUMP_DIR ?? 'C:/Users/raymo/AppData/Local/Temp/claude/D--Game-Built-Project-murim-apocalypse-web/a0cb625b-7ff5-4f79-bf56-3fcecdecb1d9/scratchpad';

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface Cell {
  pb: PixelBuffer;
  glow?: PixelBuffer | null;
  ax: number;
  ay: number;
}

export function sheet(name: string, cells: Cell[], cols: number, scale: number, cw = 64, ch = 80): void {
  const rows = Math.ceil(cells.length / cols);
  const W = cols * cw * scale;
  const H = rows * ch * scale;
  const buf = new Uint8Array(W * H * 4);
  const bg = [44, 38, 54];
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = bg[0];
    buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2];
    buf[i * 4 + 3] = 255;
  }
  cells.forEach((cell, i) => {
    const ox = (i % cols) * cw * scale;
    const oy = Math.floor(i / cols) * ch * scale;
    // ground tile hint
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const dx = x - cw / 2;
        const dy = (y - (ch - 10)) * 2;
        const inside = Math.abs(dx) + Math.abs(dy) < 16 ? 1 : 0;
        const px = ox + x * scale;
        const py = oy + y * scale;
        const col = inside ? [66, 88, 52] : bg;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const o = ((py + sy) * W + px + sx) * 4;
          buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2];
        }
      }
    const put = (src: PixelBuffer, additive: boolean): void => {
      const offx = cw / 2 - cell.ax;
      const offy = ch - 10 - cell.ay;
      for (let y = 0; y < src.h; y++)
        for (let x = 0; x < src.w; x++) {
          if (x + offx < 0 || x + offx >= cw || y + offy < 0 || y + offy >= ch) continue;
          const v = src.px[y * src.w + x];
          const a = v >>> 24;
          if (!a) continue;
          const r = v & 255, g = (v >>> 8) & 255, b = (v >>> 16) & 255;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const o = ((oy + (y + offy) * scale + sy) * W + ox + (x + offx) * scale + sx) * 4;
            const t = a / 255;
            if (additive) { buf[o] = Math.min(255, buf[o] + r * t); buf[o + 1] = Math.min(255, buf[o + 1] + g * t); buf[o + 2] = Math.min(255, buf[o + 2] + b * t); }
            else { buf[o] = buf[o] + (r - buf[o]) * t; buf[o + 1] = buf[o + 1] + (g - buf[o + 1]) * t; buf[o + 2] = buf[o + 2] + (b - buf[o + 2]) * t; }
          }
        }
    };
    put(cell.pb, false);
    if (cell.glow) put(cell.glow, true);
  });
  writeFileSync(`${OUT}/${name}.png`, png(W, H, buf));
}

export const look = (i: number): Look => ({ gender: (i % 2) as 0 | 1, skin: i % 6, hairStyle: i % 7, hairColor: (i * 3) % 8, outfit: i % 4, outfitColor: (i * 3) % 10, sashColor: i % 8, accessory: i % 5 });

const MODE = process.env.DUMP;
describe.skipIf(!MODE)('dump', () => {
  it('writes sheets', () => {
    const mk = (spec: Partial<CharSpec> & { look: Look }): Cell => {
      const s = genCharacter({ state: 'idle', dir: 0, frame: 0, ...spec });
      return { pb: s.pb, glow: s.glow, ax: s.ax, ay: s.ay };
    };
    if (MODE === 'basic') {
      const cells: Cell[] = [];
      for (let i = 0; i < 14; i++) cells.push(mk({ look: look(i), weapon: (['sword', 'blade', 'spear', 'staff', 'fist', null] as const)[i % 6] }));
      sheet('basic', cells, 7, 5);
    }
    if (MODE === 'tiers') {
      const cells: Cell[] = [];
      for (const lk of [look(1), look(3), look(4), look(2)])
        for (let t = 0; t <= 5; t++) cells.push(mk({ look: lk, weapon: 'sword', gear: gearAppearance(t ? { o: { t, r: 0 }, w: { t, r: 0 } } : undefined) }));
      sheet('tiers', cells, 6, 5);
    }
    if (MODE === 'walk') {
      const cells: Cell[] = [];
      for (let f = 0; f < 8; f++) cells.push(mk({ look: look(2), state: 'walk', frame: f, weapon: 'sword' }));
      for (let f = 0; f < 6; f++) cells.push(mk({ look: look(3), state: 'run', frame: f, weapon: 'spear' }));
      for (let f = 0; f < 8; f++) cells.push(mk({ look: look(4), state: 'idle', frame: f, weapon: 'staff' }));
      sheet('walk', cells, 8, 5);
    }
    if (MODE === 'attack') {
      const cells: Cell[] = [];
      for (const [w, v] of [['sword', 0], ['sword', 1], ['sword', 2], ['sword', 3], ['spear', 0], ['staff', 1], ['fist', 0], ['fist', 2]] as const)
        for (let f = 0; f < 6; f++) cells.push(mk({ look: look(2), state: 'attack', frame: f, weapon: w, variant: v, gear: gearAppearance({ w: { t: 3, r: 2 }, o: { t: 3, r: 0 } }) }));
      sheet('attack', cells, 6, 4);
    }
    if (MODE === 'misc') {
      const cells: Cell[] = [];
      for (const st of ['draw', 'fight', 'hit', 'block', 'dodge', 'die', 'dead', 'meditate', 'cheer', 'loot', 'stretch', 'sweep', 'chat', 'fan', 'wipe', 'form', 'work', 'craft', 'eat', 'pray', 'rest', 'trade', 'shelter', 'mourn'] as const)
        for (let f = 0; f < 4; f++) cells.push(mk({ look: look(3), state: st, frame: f, weapon: st === 'form' ? null : 'sword', tool: st === 'work' ? 'hammer' : undefined }));
      sheet('misc', cells, 8, 4, 80, 80);
    }
  });
});

describe.skipIf(MODE !== 'zoom')('dump zoom', () => {
  it('writes zoom', () => {
    const cells: Cell[] = [];
    const g = process.env.GEAR ? JSON.parse(process.env.GEAR) : undefined;
    for (const [i, w] of [[1, 'sword'], [3, 'staff'], [6, 'fist'], [2, null]] as const) {
      const s = genCharacter({ look: look(i), weapon: w, state: process.env.STATE as 'idle' ?? 'idle', dir: Number(process.env.DIR ?? 0) as 0, frame: Number(process.env.FRAME ?? 0), gear: gearAppearance(g) });
      cells.push({ pb: s.pb, glow: s.glow, ax: s.ax, ay: s.ay });
    }
    sheet('zoom', cells, 4, 10);
  });
});

describe.skipIf(!['weapons', 'acc', 'back', 'rar', 'mon'].includes(MODE ?? ''))('dump2', () => {
  it('writes', () => {
    const mk = (spec: Partial<CharSpec> & { look: Look }): Cell => {
      const s = genCharacter({ state: 'idle', dir: 0, frame: 0, ...spec });
      return { pb: s.pb, glow: s.glow, ax: s.ax, ay: s.ay };
    };
    const cells: Cell[] = [];
    if (MODE === 'weapons') {
      for (const w of ['sword', 'blade', 'spear', 'staff', 'fist'] as const)
        for (const r of [0, 4])
          for (let t = 1; t <= 5; t++) cells.push(mk({ look: look(1), state: 'fight', frame: 1, weapon: w, gear: gearAppearance({ w: { t, r }, o: { t: 3, r: 0 } }) }));
      sheet('weapons', cells, 10, 4, 80, 80);
    }
    if (MODE === 'acc') {
      for (const k of ['might', 'agility', 'vitality', 'spirit', 'insight', 'fortune'] as const)
        for (const t of [1, 3, 5]) cells.push(mk({ look: look(2), weapon: null, gear: gearAppearance({ o: { t: 2, r: 0 }, a: { k, t, r: t === 5 ? 3 : 0 } }) }));
      sheet('acc', cells, 9, 5, 64, 80);
    }
    if (MODE === 'back') {
      for (let t = 1; t <= 5; t++) cells.push(mk({ look: look(3), dir: 3, weapon: 'sword', gear: gearAppearance({ o: { t, r: 0 }, w: { t, r: 0 } }) }));
      for (let t = 1; t <= 5; t++) cells.push(mk({ look: look(1), dir: 3, state: 'walk', frame: t, weapon: 'spear', gear: gearAppearance({ o: { t, r: 0 } }) }));
      sheet('back', cells, 5, 5, 64, 80);
    }
    if (MODE === 'rar') {
      for (let r = 0; r <= 4; r++) cells.push(mk({ look: look(4), weapon: 'sword', gear: gearAppearance({ o: { t: 4, r }, w: { t: 4, r } }) }));
      for (let r = 0; r <= 4; r++) cells.push(mk({ look: look(5), weapon: 'staff', gear: gearAppearance({ o: { t: 5, r }, w: { t: 5, r } }) }));
      sheet('rar', cells, 5, 5, 64, 80);
    }
    if (MODE === 'mon') {
      for (const sp of ['bandit', 'bandit_boss', 'hollow', 'hollow_monk', 'hollow_brute', 'hollow_lord'] as const)
        for (const st of ['idle', 'fight'] as const)
          cells.push(mk({ look: look(2), state: st, special: sp, elite: sp === 'bandit_boss' || sp === 'hollow_lord' ? 2 : 0, weapon: sp === 'bandit' || sp === 'bandit_boss' ? 'blade' : sp === 'hollow_monk' ? 'staff' : sp === 'hollow_brute' ? 'fist' : null }));
      for (const role of ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'] as const)
        cells.push(mk({ look: look(3), role, weapon: role === 'guard' ? 'spear' : null, gear: gearAppearance(undefined) }));
      sheet('mon', cells, 8, 5, 80, 96);
    }
  });
});

import { BEAST_KEYS, genBeast, type BeastState } from '../src/art/beasts';
describe.skipIf(MODE !== 'beasts')('dump beasts', () => {
  it('writes', () => {
    const cells: Cell[] = [];
    const list: [BeastState, number, number][] = [['idle', 0, 0], ['walk', 0, 0], ['walk', 2, 0], ['fight', 1, 0], ['attack', 2, 0], ['attack', 2, 1]];
    for (const key of BEAST_KEYS) for (const [state, frame, variant] of list) {
      const g = genBeast({ key, state, dir: 0, frame, variant });
      cells.push({ pb: g.pb, glow: g.glow, ax: g.ax, ay: g.ay });
    }
    sheet('beasts', cells, list.length, 4, 100, 80);
  });
});

describe.skipIf(MODE !== 'bench')('bench', () => {
  it('times generation', () => {
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 400; i++) {
      genCharacter({ look: look(i), weapon: (['sword', 'blade', 'spear', 'staff', 'fist', null] as const)[i % 6], state: i % 2 ? 'walk' : 'idle', dir: (i % 4) as 0, frame: i % 8, gear: gearAppearance({ o: { t: 1 + (i % 5), r: i % 5 }, w: { t: 1 + (i % 5), r: i % 3 }, a: { k: 'spirit', t: 3, r: 1 } }) });
      n++;
    }
    const t1 = performance.now();
    console.log(`genCharacter avg ${((t1 - t0) / n).toFixed(3)} ms`);
    const b0 = performance.now();
    for (let i = 0; i < 200; i++) genBeast({ key: BEAST_KEYS[i % 6], state: 'walk', dir: 0, frame: i % 8 });
    console.log(`genBeast avg ${((performance.now() - b0) / 200).toFixed(3)} ms`);
  });
});

describe.skipIf(MODE !== 'heads')('heads', () => {
  it('writes', () => {
    const cells: Cell[] = [];
    for (const lk of [look(1), look(2), look(5), look(6)])
      for (const [gaze, tilt] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]] as const) {
        const s = genCharacter({ look: lk, state: 'idle', dir: 0, frame: 0, gaze, tilt, weapon: null });
        cells.push({ pb: s.pb, glow: s.glow, ax: s.ax, ay: s.ay });
      }
    sheet('heads', cells, 5, 8, 64, 80);
  });
});
