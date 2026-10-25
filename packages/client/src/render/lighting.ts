/** Day/night colour grading over the 24 h clock. Pure (unit tested). */

export interface Ambient {
  r: number;
  g: number;
  b: number;
  /** 0 (full daylight) .. 1 (full night): drives lanterns, window glow and light pools. */
  night: number;
}

/** Multiply colours by hour: [hour, r, g, b]. Last entry wraps to the first. */
const KEYS: [number, number, number, number][] = [
  [0, 116, 130, 188],
  [4.5, 114, 126, 182],
  [5.6, 230, 168, 150],
  [7, 255, 228, 200],
  [9, 255, 248, 238],
  [12, 255, 255, 255],
  [15.5, 255, 250, 240],
  [17.2, 255, 228, 188],
  [18.5, 255, 170, 112],
  [19.6, 190, 120, 140],
  [20.8, 136, 122, 176],
  [22, 118, 130, 186],
  [24, 116, 130, 188],
];

const smooth = (t: number): number => t * t * (3 - 2 * t);

export function ambientAt(hours: number, out: Ambient = { r: 255, g: 255, b: 255, night: 0 }): Ambient {
  const h = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(Math.min(1, Math.max(0, (h - a[0]) / (b[0] - a[0]))));
  out.r = a[1] + (b[1] - a[1]) * t;
  out.g = a[2] + (b[2] - a[2]) * t;
  out.b = a[3] + (b[3] - a[3]) * t;
  // night factor: lights come on around dusk and go off after dawn
  let n: number;
  if (h < 5) n = 1;
  else if (h < 7.2) n = 1 - smooth((h - 5) / 2.2);
  else if (h < 17.2) n = 0;
  else if (h < 20.5) n = smooth((h - 17.2) / 3.3);
  else n = 1;
  out.night = n;
  return out;
}

export const rgbStr = (a: Ambient): string => `rgb(${a.r | 0},${a.g | 0},${a.b | 0})`;
