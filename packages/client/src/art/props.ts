/** Small pixel props used around buildings (barrels, crates, anvils, cauldrons, racks...). Pure. */
import { hex, mix, scale, type Col } from './color';
import { groundShadow, hf, shadedBlob, bayer, rampTone } from './draw';
import { PixelBuffer } from './pixel';
import { ramp } from './palette';

export interface Prop {
  pb: PixelBuffer;
  ax: number;
  ay: number;
}

const WOOD = ramp('#7a5434', 0.68, 1.22);
const IRON = ramp('#55565e', 0.6, 1.5);
const STRAW = ramp('#c9a649', 0.7, 1.2);
const STONE = ramp('#9a958c', 0.66, 1.2);

function done(pb: PixelBuffer, ax: number, ay: number): Prop {
  pb.outline();
  return { pb, ax, ay };
}

export function barrel(seed = 0): Prop {
  const pb = new PixelBuffer(12, 14);
  groundShadow(pb, 7, 12, 5, 1.8, 54);
  for (let y = 2; y < 12; y++) {
    const t = (y - 2) / 9;
    const half = 3.2 + Math.sin(t * Math.PI) * 1.2;
    for (let x = Math.floor(6 - half); x < Math.ceil(6 + half); x++) {
      const u = (x + 0.5 - (6 - half)) / (half * 2);
      let c = u < 0.3 ? WOOD.l : u < 0.75 ? WOOD.b : WOOD.d;
      if (y === 4 || y === 9) c = IRON.b;
      if ((x + seed) % 3 === 0 && y !== 4 && y !== 9) c = scale(c, 0.9);
      pb.set(x, y, c);
    }
  }
  for (let x = 3; x < 9; x++) pb.set(x, 2, WOOD.l);
  return done(pb, 6, 11);
}

export function crate(color = '#8a6840', seed = 0): Prop {
  const pb = new PixelBuffer(14, 14);
  const r = ramp(color, 0.68, 1.2);
  groundShadow(pb, 8, 12, 6, 2, 54);
  // iso box 8x8 footprint, 6 tall
  const cx = 7;
  const by = 11;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      pb.set(cx - 6 + x, by - 3 - 6 + y + Math.floor(x / 2), (x + y + seed) % 4 === 0 ? r.l : r.b); // left face
      pb.set(cx + x, by - 3 - 6 + y + 3 - Math.floor(x / 2), (x * 2 + y) % 5 === 0 ? r.dd : r.d); // right face
    }
  }
  for (let x = -6; x <= 5; x++) {
    const ty = by - 12 + Math.floor(Math.abs(x + 0.5) / 2);
    pb.set(cx + x, ty, r.l);
    pb.set(cx + x, ty + 1, x < 0 ? r.l : r.b);
  }
  return done(pb, cx, by);
}

export function haystack(): Prop {
  const pb = new PixelBuffer(30, 24);
  groundShadow(pb, 17, 21, 11, 3, 54);
  shadedBlob(pb, 15, 15, 10, 8, STRAW, { seed: 3, speckle: 0.2 });
  for (let i = 0; i < 6; i++) pb.line(15 + i - 3, 7, 15 + (i - 3) * 1.6, 10, STRAW.dd);
  return done(pb, 15, 21);
}

export function anvil(): Prop {
  const pb = new PixelBuffer(16, 14);
  groundShadow(pb, 9, 12, 5, 1.8, 54);
  pb.rect(5, 9, 6, 3, WOOD.d); // stump
  pb.rect(5, 9, 2, 3, WOOD.b);
  pb.rect(3, 5, 10, 3, IRON.b);
  pb.rect(3, 5, 10, 1, IRON.l);
  pb.poly([13, 5, 16, 6, 13, 7], IRON.b);
  pb.rect(6, 8, 4, 1, IRON.d);
  return done(pb, 8, 12);
}

export function cauldron(glow: Col = hex('#7dffa0')): Prop {
  const pb = new PixelBuffer(22, 20);
  groundShadow(pb, 12, 18, 8, 2.4, 56);
  shadedBlob(pb, 11, 11, 8, 7, IRON, { seed: 1, speckle: 0.08 });
  pb.ellipse(11, 6, 7, 2.4, scale(glow, 0.5));
  pb.ellipse(11, 6, 5.5, 1.6, glow);
  pb.set(9, 6, mix(glow, hex('#ffffff'), 0.6));
  pb.rect(5, 16, 2, 3, IRON.dd);
  pb.rect(16, 16, 2, 3, IRON.dd);
  return done(pb, 11, 18);
}

export function weaponRack(): Prop {
  const pb = new PixelBuffer(30, 26);
  groundShadow(pb, 16, 23, 11, 2.6, 54);
  pb.rect(4, 8, 2, 15, WOOD.d);
  pb.rect(24, 8, 2, 15, WOOD.d);
  pb.rect(4, 8, 22, 2, WOOD.b);
  pb.rect(4, 15, 22, 2, WOOD.b);
  const metal = [IRON.l, hex('#d9dde4'), IRON.b];
  for (let i = 0; i < 6; i++) {
    const x = 7 + i * 3.2;
    const spear = i % 3 === 0;
    pb.line(x, spear ? 1 : 5, x + 0.5, 22, spear ? WOOD.l : metal[i % 3]);
    if (spear) pb.set(x, 0, metal[1]);
    else {
      pb.set(x - 1, 11, hex('#a8302a'));
      pb.set(x + 1, 11, hex('#a8302a'));
    }
  }
  return done(pb, 15, 23);
}

export function trainingDummy(): Prop {
  const pb = new PixelBuffer(18, 30);
  groundShadow(pb, 10, 27, 6, 2, 54);
  pb.rect(8, 8, 2, 19, WOOD.b);
  pb.rect(8, 8, 1, 19, WOOD.l);
  pb.rect(3, 12, 12, 2, WOOD.b);
  shadedBlob(pb, 9, 15, 4, 6, STRAW, { seed: 8, speckle: 0.2 });
  shadedBlob(pb, 9, 6, 3.4, 3.4, STRAW, { seed: 9, speckle: 0.2 });
  pb.rect(6, 16, 6, 1, hex('#a8302a'));
  pb.rect(5, 24, 8, 3, WOOD.d);
  return done(pb, 9, 27);
}

export function stoneLantern(): Prop {
  const pb = new PixelBuffer(14, 26);
  groundShadow(pb, 8, 24, 5, 1.8, 54);
  pb.rect(4, 21, 7, 3, STONE.d);
  pb.rect(6, 14, 3, 7, STONE.b);
  pb.rect(6, 14, 1, 7, STONE.l);
  pb.rect(3, 8, 9, 6, STONE.b);
  pb.rect(3, 8, 9, 1, STONE.l);
  pb.rect(5, 10, 5, 3, hex('#ffd98a'));
  pb.poly([2, 8, 7.5, 2, 13, 8], STONE.d);
  pb.poly([3, 8, 7.5, 3, 7, 8], STONE.l);
  pb.rect(6, 0, 3, 3, STONE.b);
  return done(pb, 7, 24);
}

export function well(): Prop {
  const pb = new PixelBuffer(30, 34);
  groundShadow(pb, 16, 30, 11, 3, 54);
  pb.ellipse(15, 24, 11, 5, STONE.d);
  pb.ellipse(15, 22, 11, 5, STONE.b);
  pb.ellipse(15, 22, 8, 3.2, hex('#1d3a52'));
  pb.set(12, 22, hex('#4e86a6'));
  pb.rect(4, 8, 2, 16, WOOD.d);
  pb.rect(24, 8, 2, 16, WOOD.d);
  pb.rect(3, 7, 24, 2, WOOD.b);
  pb.poly([2, 8, 15, 0, 28, 8], hex('#6b4a3a'));
  pb.line(15, 8, 15, 18, hex('#b8a98a'));
  pb.rect(13, 18, 4, 3, WOOD.b);
  return done(pb, 15, 28);
}

export function sack(): Prop {
  const pb = new PixelBuffer(12, 12);
  groundShadow(pb, 7, 10, 4, 1.6, 50);
  shadedBlob(pb, 6, 6.5, 4, 4.5, ramp('#b09a6c', 0.7, 1.2), { seed: 1, speckle: 0.1 });
  pb.rect(5, 1, 3, 2, hex('#8a7448'));
  return done(pb, 6, 10);
}

export function haybale(): Prop {
  const pb = new PixelBuffer(18, 14);
  groundShadow(pb, 10, 12, 7, 2, 50);
  pb.rect(2, 4, 14, 7, STRAW.b);
  pb.rect(2, 4, 14, 2, STRAW.l);
  pb.rect(2, 9, 14, 2, STRAW.d);
  pb.line(6, 4, 6, 10, STRAW.dd);
  pb.line(12, 4, 12, 10, STRAW.dd);
  return done(pb, 9, 11);
}

export function urn(): Prop {
  const pb = new PixelBuffer(12, 14);
  groundShadow(pb, 7, 12, 4, 1.6, 50);
  shadedBlob(pb, 6, 8, 3.8, 4.4, ramp('#7a5a3a', 0.68, 1.25), { seed: 5, speckle: 0.1 });
  pb.rect(4, 2, 4, 2, hex('#6a4a2e'));
  return done(pb, 6, 12);
}

/** Banner on a pole for roofs/gates. */
export function flag(colorCss: string): Prop {
  const c = ramp(colorCss, 0.7, 1.25);
  const pb = new PixelBuffer(14, 22);
  pb.vline(2, 1, 20, hex('#4a3322'));
  pb.vline(3, 1, 20, hex('#6b4a32'));
  for (let y = 2; y < 9; y++) for (let x = 4; x < 12 - Math.floor(Math.abs(y - 5) / 2); x++) pb.set(x, y + (x > 7 ? Math.floor((x - 7) / 2) : 0), x < 6 ? c.l : y > 6 ? c.d : c.b);
  pb.set(2, 0, hex('#d9b867'));
  return done(pb, 2, 20);
}

export function bushSmall(seed = 0): Prop {
  const pb = new PixelBuffer(16, 12);
  groundShadow(pb, 9, 10, 6, 2, 46);
  shadedBlob(pb, 8, 6, 6, 4.5, ramp('#3d7a38', 0.7, 1.3), { seed, speckle: 0.14 });
  return done(pb, 8, 10);
}

export function herbRack(): Prop {
  const pb = new PixelBuffer(28, 26);
  groundShadow(pb, 15, 23, 10, 2.4, 50);
  pb.rect(3, 6, 2, 17, WOOD.d);
  pb.rect(23, 6, 2, 17, WOOD.d);
  pb.rect(3, 6, 22, 2, WOOD.b);
  for (let i = 0; i < 6; i++) {
    const x = 6 + i * 3.4;
    const col = i % 2 ? ramp('#6aa043') : ramp('#a09a4a');
    for (let y = 8; y < 15; y++) pb.set(x, y, rampTone(col, 0.3 + hf(i, y, 1) * 0.5));
    pb.set(x - 1, 12, col.b);
    pb.set(x + 1, 13, col.d);
  }
  void bayer;
  return done(pb, 14, 23);
}
