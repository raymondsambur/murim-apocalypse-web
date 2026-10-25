/**
 * Scale reference set: one sprite of everything that has a target height (scale.ts), generated with the real art code.
 * Used by the sandbox "scale reference" overlay (draws them side by side next to a person) and by scale.test.ts (measures
 * them against the target table). Pure (no DOM).
 */
import { O } from '@murim/shared';
import { genBeast, type BeastKey } from './beasts';
import { genBuilding } from './buildings';
import { genCharacter } from './character';
import { genObject } from './flora';
import { stoneLantern } from './props';
import { PERSON_PX, TARGETS, type TargetKey } from './scale';
import type { PixelBuffer } from './pixel';
import { genWallTile, W_NW, W_SE } from './walls';

export interface RefItem {
  name: string;
  /** 0 = people and beasts, 1 = plants and props, 2 = buildings. */
  row: 0 | 1 | 2;
  /** Sprite parts (walls are several tiles), each placed at (dx, dy) from the item's ground point. */
  parts: { pb: PixelBuffer; ax: number; ay: number; dx: number; dy: number }[];
  /** Height from the ground point to the top opaque pixel (px). */
  h: number;
  /** Width of the opaque area (px). */
  w: number;
  key?: TargetKey;
  /** Extra measured values (px) for buildings: door and eave height. */
  door?: number;
  eave?: number;
  /** Draw a person next to it. */
  withPerson?: boolean;
}

const LOOK = { gender: 0, skin: 2, hairStyle: 0, hairColor: 0, outfit: 0, outfitColor: 3, sashColor: 1, accessory: 0 } as const;

function measure(parts: RefItem['parts']): { h: number; w: number } {
  let top = 1e9;
  let x0 = 1e9;
  let x1 = -1e9;
  for (const p of parts) {
    const b = p.pb.bounds();
    if (!b) continue;
    top = Math.min(top, p.dy - p.ay + b.y0);
    x0 = Math.min(x0, p.dx - p.ax + b.x0);
    x1 = Math.max(x1, p.dx - p.ax + b.x1);
  }
  return { h: Math.round(-top + 1), w: Math.round(x1 - x0 + 1) };
}

function item(name: string, row: 0 | 1 | 2, parts: RefItem['parts'], key?: TargetKey, extra: Partial<RefItem> = {}): RefItem {
  const m = measure(parts);
  return { name, row, parts, h: m.h, w: m.w, key, ...extra };
}

function person(name: string, key: TargetKey, o: { accessory?: number; elite?: 0 | 1 | 2; special?: 'hollow_lord' | 'hollow_brute' | 'bandit_boss'; weapon?: 'spear' | null } = {}): RefItem {
  const c = genCharacter({ look: { ...LOOK, accessory: o.accessory ?? 0 }, state: 'idle', dir: 0, frame: 0, elite: o.elite, special: o.special, weapon: o.weapon ?? null });
  return item(name, 0, [{ pb: c.pb, ax: c.ax, ay: c.ay, dx: 0, dy: 0 }], key);
}

function beast(key: BeastKey, name: string, tk: TargetKey): RefItem {
  const b = genBeast({ key, state: 'idle', dir: 0, frame: 0 });
  return item(name, 0, [{ pb: b.pb, ax: b.ax, ay: b.ay, dx: 0, dy: 0 }], tk);
}

function plant(code: number, name: string, tk: TargetKey | undefined, variant = 1, person = true): RefItem {
  const g = genObject(code, variant, 1, 0)!;
  return item(name, 1, [{ pb: g.pb, ax: g.ax, ay: g.ay, dx: 0, dy: 0 }], tk, { withPerson: person });
}

function building(kind: 'house' | 'inn' | 'tower' | 'pagoda' | 'hall' | 'gate', w: number, d: number, id: number, key: TargetKey): RefItem {
  const a = genBuilding({ id, kind, w, d, door: { dx: Math.floor(w / 2), dy: d }, season: 1, roofCss: null, accentCss: null, fallen: false });
  const ax = Math.round(a.ox + (w - d) * 8);
  const ay = Math.round(a.oy + (w + d) * 4);
  return item(`${kind} ${w}x${d}`, 2, [{ pb: a.pb, ax, ay, dx: 0, dy: 0 }], key, { door: a.metrics?.door, eave: a.metrics?.eave, withPerson: true });
}

/** Everything with a target height, in drawing order. */
export function referenceItems(): RefItem[] {
  const out: RefItem[] = [];
  out.push(person('person', 'person'));
  out.push(person('hat', 'personHat', { accessory: 2 }));
  out.push(person('elite', 'elite1', { elite: 1 }));
  out.push(person('elite+', 'elite2', { elite: 2 }));
  out.push(person('brute', 'hollowBrute', { special: 'hollow_brute' }));
  out.push(person('bandit boss', 'banditBoss', { special: 'bandit_boss' }));
  out.push(person('blight lord', 'hollowLord', { special: 'hollow_lord' }));
  out.push(beast('boar', 'boar', 'boar'));
  out.push(beast('wolf', 'wolf', 'wolf'));
  out.push(beast('bear', 'bear', 'bear'));
  out.push(beast('tiger', 'tiger', 'tiger'));
  out.push(beast('snake', 'snake', 'snake'));
  out.push(plant(O.Bush, 'bush', 'bush', 1, false));
  out.push(plant(O.Boulder, 'boulder', 'boulder', 1, false));
  out.push(plant(O.Reeds, 'reeds', 'reeds', 1, false));
  const lan = stoneLantern();
  out.push(item('stone lantern', 1, [{ pb: lan.pb, ax: lan.ax, ay: lan.ay, dx: 0, dy: 0 }], 'stoneLantern'));
  out.push(plant(O.Pine, 'pine', 'pine', 1));
  out.push(plant(O.Oak, 'oak', 'oak', 1));
  out.push(plant(O.Bamboo, 'bamboo', 'bamboo', 1));
  out.push(building('house', 3, 3, 3, 'houseEave'));
  out.push(building('inn', 5, 4, 3, 'innEave'));
  // fort wall: three connected tiles along x
  const wt = genWallTile(W_SE | W_NW, 1, false);
  out.push(item('fort wall', 2, [-1, 0, 1].map((i) => ({ pb: wt.pb, ax: wt.ax, ay: wt.ay, dx: i * 16, dy: i * 8 })), 'fortWall', { withPerson: true }));
  out.push(building('tower', 2, 2, 3, 'tower'));
  out.push(building('hall', 6, 5, 3, 'hall'));
  out.push(building('pagoda', 4, 4, 5, 'pagoda'));
  return out;
}

export { PERSON_PX, TARGETS };
