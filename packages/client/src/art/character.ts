/**
 * Layered paper-doll character generator. A figure is assembled from parts (legs, robe, torso, sash, arms, head,
 * hair, accessory, weapon) drawn into a 28x44 pixel buffer, in a front (SE/SW) or back (NE/NW) view; the west
 * facings are mirrors. Animations: idle, walk, fight, meditate, work, dead. Pure (node-testable).
 */
import type { Dir, EntityState, Look, NpcRole, WeaponType } from '@murim/shared';
import { LOOK_RANGES } from '@murim/shared';
import { corrupt, hex, mix, rgba, scale, type Col } from './color';
import { bayer, hf, rampTone } from './draw';
import { PixelBuffer } from './pixel';
import { lookRamps, ramp, type Ramp } from './palette';

export const CHAR_W = 28;
export const CHAR_H = 44;
/** Feet anchor inside the sprite. */
export const CHAR_AX = 14;
export const CHAR_AY = 38;

export type CharState = 'idle' | 'walk' | 'fight' | 'meditate' | 'work' | 'dead';

export type SpecialStyle = 'none' | 'bandit' | 'bandit_boss' | 'hollow' | 'hollow_monk' | 'hollow_brute' | 'hollow_lord';

export interface CharSpec {
  look: Look;
  weapon?: WeaponType | null;
  state: CharState;
  dir: Dir;
  frame: number;
  role?: NpcRole | null;
  /** Colour of the faction sash for masters / guards (CSS). */
  faction?: string | null;
  /** 0 normal, 1 elite, 2 boss: scales the figure. */
  elite?: 0 | 1 | 2;
  special?: SpecialStyle;
  tool?: 'hammer' | 'hoe';
}

export const FRAME_COUNTS: Record<CharState, number> = { idle: 2, walk: 4, fight: 3, meditate: 2, work: 3, dead: 1 };

export function stateFromEntity(s: EntityState): CharState {
  switch (s) {
    case 'walk':
      return 'walk';
    case 'fight':
      return 'fight';
    case 'work':
    case 'craft':
      return 'work';
    case 'meditate':
      return 'meditate';
    case 'dead':
      return 'dead';
    default:
      return 'idle';
  }
}

const INK = rgba(30, 22, 34);
const BOOT = hex('#2a2420');
const BOOT_L = hex('#4a3f38');
const STEEL = ramp('#9aa3b0', 0.62, 1.3);
const LEATHER = ramp('#6a4a32', 0.66, 1.25);
const WHITE_ROBE = ramp('#e8e2d2', 0.74, 1.08);
const QI = hex('#9fe8ff');

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function shadeX(u: number, r: Ramp): Col {
  return u < 0.3 ? r.l : u > 0.72 ? r.d : r.b;
}

/** Polygon filled with left-lit three-tone shading across its horizontal extent. */
function shadedPoly(pb: PixelBuffer, pts: number[], r: Ramp, dither = true): void {
  let minX = 1e9;
  let maxX = -1e9;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
  }
  const w = Math.max(1, maxX - minX);
  pb.poly(pts, (x, y) => {
    const u = (x + 0.5 - minX) / w + (dither ? bayer(x, y) * 0.08 : 0);
    return shadeX(u, r);
  });
}

/** Thick segment with rounded ends, shaded left-to-right. */
function limb(pb: PixelBuffer, x0: number, y0: number, x1: number, y1: number, w: number, r: Ramp): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  const half = w / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let yy = Math.floor(y - half); yy <= Math.ceil(y + half); yy++)
      for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half); xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        if (dx * dx + dy * dy > half * half + 0.25) continue;
        const u = (dx + half) / (2 * half);
        pb.set(xx, yy, u < 0.34 ? r.l : u > 0.7 ? r.d : r.b);
      }
  }
}

function disc(pb: PixelBuffer, cx: number, cy: number, rx: number, ry: number, r: Ramp, seed = 0): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const ny = (y + 0.5 - cy) / ry;
    if (ny * ny > 1) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      let v = 0.55 - 0.34 * nx - 0.3 * ny + bayer(x, y) * 0.1 + (hf(x, y, seed) - 0.5) * 0.05;
      pb.set(x, y, rampTone(r, v));
    }
  }
}

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------

interface Colours {
  skin: Ramp;
  hair: Ramp;
  outfit: Ramp;
  trousers: Ramp;
  sash: Ramp;
  trim: Ramp;
  hairIdx: number;
}

function paletteFor(spec: CharSpec): Colours {
  const l = spec.look;
  let skin = lookRamps.skin(l.skin);
  let hair = lookRamps.hair(l.hairColor);
  let outfit = lookRamps.outfit(l.outfitColor);
  let sash = lookRamps.sash(l.sashColor);
  let trousers = ramp(mix(outfit.d, hex('#3a322c'), 0.55), 0.7, 1.2);
  const role = spec.role;
  const sp = spec.special ?? 'none';
  if (role === 'master') {
    outfit = WHITE_ROBE;
    trousers = ramp('#cfc8b8', 0.7, 1.1);
    if (spec.faction) sash = ramp(spec.faction, 0.72, 1.2);
  } else if (role === 'legend') {
    outfit = ramp('#e8d9a8', 0.72, 1.12);
    trousers = ramp('#bfae7a', 0.7, 1.1);
    sash = ramp('#d9b867', 0.72, 1.2);
  } else if (role === 'guard') {
    outfit = ramp('#4a5a6a', 0.7, 1.25);
    trousers = ramp('#3a3e48', 0.7, 1.2);
    if (spec.faction) sash = ramp(spec.faction, 0.72, 1.2);
  } else if (role === 'merchant') {
    outfit = ramp('#8a5a2a', 0.7, 1.25);
  } else if (role === 'physician') {
    outfit = ramp('#d8e2d0', 0.72, 1.1);
  } else if (role === 'alchemist') {
    outfit = ramp('#3e7a55', 0.7, 1.25);
  } else if (role === 'smith') {
    outfit = ramp('#5a4a3e', 0.7, 1.25);
  } else if (role === 'elder') {
    hair = ramp('#d9d6dc', 0.7, 1.05);
  }
  if (sp === 'bandit' || sp === 'bandit_boss') {
    outfit = ramp(sp === 'bandit_boss' ? '#3a2a2e' : '#33343c', 0.7, 1.35);
    trousers = ramp('#26262e', 0.7, 1.3);
    sash = ramp('#8a2a2a', 0.72, 1.25);
    skin = lookRamps.skin(Math.max(2, l.skin));
  } else if (sp.startsWith('hollow')) {
    skin = ramp('#a6b6a2', 0.72, 1.12);
    hair = ramp('#4a4a54', 0.7, 1.2);
    outfit = ramp(sp === 'hollow_monk' ? '#4a4650' : '#5a5a56', 0.68, 1.2);
    trousers = ramp('#3a3a3c', 0.7, 1.2);
    sash = ramp('#6a3a8a', 0.7, 1.4);
  }
  const trim = ramp(mix(outfit.l, hex('#ffffff'), 0.35), 0.75, 1.1);
  return { skin, hair, outfit, trousers, sash, trim, hairIdx: l.hairColor };
}

// ---------------------------------------------------------------------------
// pose
// ---------------------------------------------------------------------------

interface Pose {
  /** Whole upper-body offset (px). */
  bob: number;
  /** Forward lean (px toward facing). */
  lean: number;
  /** Leg lifts (px up) and forward offsets. */
  legLy: number;
  legRy: number;
  legLx: number;
  legRx: number;
  /** Hand targets relative to feet-anchor space, in px. */
  rhx: number;
  rhy: number;
  lhx: number;
  lhy: number;
  /** Weapon angle in degrees (0 right, 90 down, -90 up) and a swing flag for trails. */
  wAngle: number;
  swing: number;
  /** Crouch of the whole figure (px). */
  crouch: number;
  /** Head tilt down (px). */
  headDy: number;
  seated: boolean;
  prone: boolean;
}

function basePose(): Pose {
  return { bob: 0, lean: 0, legLy: 0, legRy: 0, legLx: 0, legRx: 0, rhx: 19.5, rhy: 26, lhx: 8.5, lhy: 26, wAngle: 80, swing: 0, crouch: 0, headDy: 0, seated: false, prone: false };
}

function poseFor(spec: CharSpec, weapon: WeaponType | null | undefined): Pose {
  const p = basePose();
  const f = spec.frame;
  const sp = spec.special ?? 'none';
  const hunch = sp.startsWith('hollow') ? 1 : 0;
  switch (spec.state) {
    case 'idle':
      p.bob = f % 2 ? -1 : 0;
      p.rhy += p.bob * 0.5;
      p.lhy += p.bob * 0.5;
      if (weapon === 'staff' || weapon === 'spear') {
        p.wAngle = -88;
        p.rhy = 24;
      }
      break;
    case 'walk': {
      const ph = f % 4;
      p.bob = ph === 1 || ph === 3 ? -1 : 0;
      const sw = ph === 0 ? 1 : ph === 2 ? -1 : 0;
      p.legLx = -sw * 1.5;
      p.legRx = sw * 1.5;
      p.legLy = ph === 2 ? 2 : 0;
      p.legRy = ph === 0 ? 2 : 0;
      p.lhx = 8.5 + sw * 1.5;
      p.lhy = 26 - sw * 1.2;
      p.rhx = 19.5 - sw * 1;
      p.rhy = 26 + sw * 1.2 + p.bob * 0.5;
      p.wAngle = weapon === 'staff' || weapon === 'spear' ? -86 : 80 + sw * 8;
      break;
    }
    case 'fight': {
      const ph = f % 3;
      p.lean = ph === 2 ? 2 : ph === 0 ? 0 : -1;
      p.legLx = -1.5;
      p.legRx = 2;
      p.lhx = 7.5;
      p.lhy = 22;
      if (ph === 0) {
        p.rhx = 21;
        p.rhy = 21;
        p.wAngle = weapon === 'spear' ? -6 : weapon === 'staff' ? -40 : -55;
      } else if (ph === 1) {
        p.rhx = 18.5;
        p.rhy = 16;
        p.wAngle = weapon === 'spear' ? -10 : weapon === 'staff' ? -105 : -118;
        p.bob = -1;
      } else {
        p.rhx = weapon === 'spear' || weapon === 'fist' ? 25 : 23.5;
        p.rhy = weapon === 'spear' ? 22 : 24;
        p.wAngle = weapon === 'spear' ? 0 : weapon === 'staff' ? 25 : 38;
        p.swing = 1;
      }
      break;
    }
    case 'work': {
      const ph = f % 3;
      p.rhx = ph === 0 ? 19 : ph === 1 ? 23 : 21;
      p.rhy = ph === 0 ? 14 : ph === 1 ? 26 : 22;
      p.lhx = ph === 1 ? 19 : 17;
      p.lhy = ph === 0 ? 17 : 26;
      p.wAngle = ph === 0 ? -100 : ph === 1 ? 70 : 10;
      p.lean = ph === 1 ? 2 : 0;
      p.bob = ph === 0 ? -1 : 0;
      p.crouch = ph === 1 ? 1 : 0;
      break;
    }
    case 'meditate':
      p.seated = true;
      p.bob = f % 2 ? -1 : 0;
      p.rhx = 15.5;
      p.rhy = 28;
      p.lhx = 12.5;
      p.lhy = 28;
      break;
    case 'dead':
      p.prone = true;
      break;
  }
  p.headDy += hunch;
  if (hunch) p.lean += 1;
  return p;
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

const rad = (d: number): number => (d * Math.PI) / 180;

function drawWeapon(pb: PixelBuffer, weapon: WeaponType, hx: number, hy: number, angle: number, swing: number, fight: boolean): void {
  const a = rad(angle);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const at = (t: number, off = 0): [number, number] => [hx + dx * t + px * off, hy + dy * t + py * off];
  switch (weapon) {
    case 'sword': {
      // grip, guard, blade
      for (let t = -2; t <= 1; t++) pb.set(...at(t), LEATHER.d);
      const g1 = at(1.5, -2);
      const g2 = at(1.5, 2);
      pb.line(g1[0], g1[1], g2[0], g2[1], hex('#d9b867'));
      for (let t = 2; t <= 14; t++) {
        const [x, y] = at(t);
        pb.set(x, y, t % 4 === 0 ? hex('#ffffff') : STEEL.l);
        const [x2, y2] = at(t, 1);
        pb.set(x2, y2, STEEL.d);
      }
      const [tx, ty] = at(15);
      pb.set(tx, ty, hex('#ffffff'));
      break;
    }
    case 'blade': {
      for (let t = -2; t <= 1; t++) pb.set(...at(t), LEATHER.d);
      const g1 = at(1.5, -1.5);
      const g2 = at(1.5, 1.5);
      pb.line(g1[0], g1[1], g2[0], g2[1], hex('#c0a04a'));
      for (let t = 2; t <= 13; t++) {
        const bend = Math.pow(t / 13, 2) * 2.2;
        const [x, y] = at(t, bend);
        pb.set(x, y, STEEL.l);
        const [x2, y2] = at(t, bend + 1);
        pb.set(x2, y2, t > 8 ? STEEL.b : STEEL.d);
        if (t > 3 && t < 12) {
          const [x3, y3] = at(t, bend + 2);
          pb.set(x3, y3, STEEL.d);
        }
      }
      const [tx, ty] = at(14, 3.2);
      pb.set(tx, ty, hex('#ffffff'));
      break;
    }
    case 'spear': {
      for (let t = -9; t <= 17; t++) {
        const [x, y] = at(t);
        pb.set(x, y, t % 5 === 0 ? LEATHER.dd : LEATHER.b);
      }
      for (let t = 18; t <= 23; t++) {
        const [x, y] = at(t);
        pb.set(x, y, t < 22 ? STEEL.l : hex('#ffffff'));
        if (t < 21) {
          const [x2, y2] = at(t, 1);
          pb.set(x2, y2, STEEL.d);
        }
      }
      const [rx, ry] = at(17, 0);
      pb.set(rx + 0, ry + 1, hex('#a8302a'));
      pb.set(rx - 1, ry + 1, hex('#c8452d'));
      break;
    }
    case 'staff': {
      for (let t = -11; t <= 16; t++) {
        const [x, y] = at(t);
        pb.set(x, y, t % 6 === 0 ? LEATHER.dd : LEATHER.l);
        const [x2, y2] = at(t, 1);
        pb.set(x2, y2, LEATHER.d);
      }
      const [x, y] = at(16);
      pb.set(x, y, hex('#d9b867'));
      const [x1, y1] = at(-11);
      pb.set(x1, y1, hex('#d9b867'));
      break;
    }
    case 'fist':
      break;
  }
  if (swing) {
    // slash trail
    const col = rgba(240, 248, 255, 190);
    const col2 = rgba(190, 220, 255, 140);
    const reach = weapon === 'spear' ? 20 : weapon === 'fist' ? 5 : 14;
    for (let i = 0; i < 9; i++) {
      const aa = a - 1.5 + i * 0.16;
      const rr = reach - (i % 2);
      const x = hx - Math.cos(aa) * 0 + Math.cos(aa) * rr;
      const y = hy + Math.sin(aa) * rr;
      if (weapon === 'spear') {
        pb.set(hx + 6 + i * 2, hy + 0.5, col2);
      } else {
        pb.set(x, y, i > 3 ? col : col2);
      }
    }
  }
  void fight;
}

interface Part {
  hat: boolean;
  faceMask: boolean;
}

function drawFront(pb: PixelBuffer, spec: CharSpec, c: Colours, p: Pose, back: boolean): Part {
  const l = spec.look;
  const female = l.gender === 1;
  const weapon = spec.weapon ?? null;
  const cut = ((l.outfit % LOOK_RANGES.outfit) + LOOK_RANGES.outfit) % LOOK_RANGES.outfit;
  const sp = spec.special ?? 'none';
  const cx = 14 + p.lean * 0.5;
  const bodyDy = p.bob + p.crouch;
  const yShoulder = 18 + bodyDy;
  const yWaist = 26 + p.crouch + p.bob * 0.4;
  const brute = sp === 'hollow_brute' || sp === 'bandit_boss' || sp === 'hollow_lord';
  const sh = (female ? 4.4 : 5.2) + (brute ? 1.2 : 0);
  const hip = (female ? 4.4 : 4) + (brute ? 0.8 : 0);
  const part: Part = { hat: false, faceMask: false };

  // ----- legs --------------------------------------------------------------
  const longRobe = cut === 1 || cut === 3 || spec.role === 'master' || spec.role === 'legend' || sp === 'hollow_monk' || sp === 'hollow_lord';
  const footY = 37;
  const legTop = yWaist + 1;
  if (!p.seated) {
    const legs: [number, number, number][] = [
      [cx - 2.2 + p.legLx, p.legLy, 0],
      [cx + 2.2 + p.legRx, p.legRy, 1],
    ];
    for (const [lx, lift] of legs) {
      limb(pb, lx, legTop, lx + (lift ? 0.3 : 0), footY - lift - 1, 3.1, c.trousers);
      // boot
      const by = footY - lift;
      pb.rect(Math.round(lx - 1.5), by - 2, 3, 2, BOOT);
      pb.set(Math.round(lx - 1.5), by - 2, BOOT_L);
      if (!back) pb.set(Math.round(lx + 1.5), by - 1, BOOT);
    }
  }

  // ----- robe skirt ------------------------------------------------------------
  const hemY = p.seated ? 36 : cut === 3 || spec.role === 'master' || spec.role === 'legend' || sp === 'hollow_lord' ? 36 : cut === 1 || sp === 'hollow_monk' ? 34 : cut === 0 ? 29 : 30;
  const flare = cut === 3 || spec.role === 'master' ? 1.8 : cut === 1 ? 1.2 : 0.6;
  const sway = spec.state === 'walk' ? (p.legLx + p.legRx) * 0.3 + (spec.frame % 2 ? 0 : 0) : 0;
  if (p.seated) {
    // folded legs: a wide low mound
    disc(pb, cx, 33, 9, 4.2, c.trousers, 4);
    disc(pb, cx, 31.5, 7.5, 3.4, c.outfit, 6);
    pb.rect(Math.round(cx - 6), 36, 4, 1, BOOT);
    pb.rect(Math.round(cx + 2), 36, 4, 1, BOOT);
  } else {
    const top = yWaist - 0.5;
    const skirt = [cx - hip - 0.2, top, cx + hip + 0.2, top, cx + hip + flare + sway, hemY, cx - hip - flare + sway, hemY];
    if (hemY > 29) {
      shadedPoly(pb, skirt, c.outfit);
      // hem trim
      pb.hline(cx - hip - flare + sway, cx + hip + flare + sway, hemY - 1, c.trim.b);
      // centre fold
      pb.vline(Math.round(cx + sway * 0.5), top + 2, hemY - 2, c.outfit.d);
    } else if (cut === 0 || cut === 2) {
      // short tunic skirt over trousers
      shadedPoly(pb, skirt, c.outfit);
    }
  }

  // ----- torso -------------------------------------------------------------------
  const torsoTop = yShoulder;
  const torso = [cx - sh, torsoTop, cx + sh, torsoTop, cx + sh - 0.8, yWaist, cx - sh + 0.8, yWaist];
  const armourRole = spec.role === 'guard';
  shadedPoly(pb, torso, armourRole ? STEEL : c.outfit);
  if (armourRole) {
    // lamellar bands + chest emblem
    for (let y = torsoTop + 2; y < yWaist - 1; y += 3) pb.hline(cx - sh + 1, cx + sh - 1, y, STEEL.dd);
    pb.set(Math.round(cx), torsoTop + 3, hex('#d9b867'));
    pb.set(Math.round(cx) - 1, torsoTop + 4, hex('#d9b867'));
    pb.set(Math.round(cx) + 1, torsoTop + 4, hex('#d9b867'));
  } else if (!back) {
    // lapels
    if (cut === 1 || cut === 3 || spec.role === 'master' || spec.role === 'legend') {
      pb.line(cx - 3, torsoTop, cx + 1, yWaist - 1, c.trim.l);
      pb.line(cx + 3, torsoTop, cx - 1, yWaist - 1, c.trim.b);
      pb.set(Math.round(cx), torsoTop, c.skin.d);
      pb.set(Math.round(cx) + 1, torsoTop, c.skin.b);
    } else if (cut === 2) {
      pb.vline(Math.round(cx) + 1, torsoTop + 1, yWaist - 1, c.outfit.dd);
      for (let y = torsoTop + 3; y < yWaist - 1; y += 3) pb.set(Math.round(cx) + 1, y, hex('#d9b867'));
      pb.hline(cx - sh, cx + sh, torsoTop, c.trim.b);
    } else {
      // tunic: round neckline
      pb.set(Math.round(cx), torsoTop, c.skin.b);
      pb.set(Math.round(cx) + 1, torsoTop, c.skin.d);
      pb.set(Math.round(cx) - 1, torsoTop, c.skin.l);
    }
  } else {
    // back: seam / dragon motif lines on robes
    if (cut === 3 || spec.role === 'master') {
      pb.vline(Math.round(cx), torsoTop + 1, yWaist - 1, c.trim.b);
      pb.set(Math.round(cx) - 1, torsoTop + 4, c.trim.l);
      pb.set(Math.round(cx) + 1, torsoTop + 5, c.trim.l);
    }
  }
  // collar
  if (!armourRole) pb.hline(cx - 2, cx + 2, torsoTop - 0 + 0, c.trim.b);

  // ----- sash --------------------------------------------------------------------
  const sashY = Math.round(yWaist - 2);
  for (let x = Math.round(cx - sh + 0.8); x <= Math.round(cx + sh - 0.8); x++) {
    pb.set(x, sashY, x < cx - 1 ? c.sash.l : c.sash.b);
    pb.set(x, sashY + 1, x < cx - 1 ? c.sash.b : c.sash.d);
  }
  // knot and tails
  const kx = Math.round(cx + sh - 1.5 + (back ? -4 : 0));
  pb.set(kx, sashY, c.sash.d);
  pb.set(kx, sashY + 1, c.sash.dd);
  for (let i = 0; i < 4; i++) {
    pb.set(kx + (i % 2 ? 0 : 1), sashY + 2 + i, i < 3 ? c.sash.b : c.sash.d);
    pb.set(kx - 1 + (i % 2), sashY + 2 + i, c.sash.d);
  }

  // ----- arms ------------------------------------------------------------------------
  const sleeveLong = cut === 1 || cut === 3 || spec.role === 'master' || spec.role === 'legend' || sp === 'hollow_monk';
  const armR = (hx: number, hy: number, front: boolean): void => {
    const sx = front ? cx + sh - 0.5 : cx - sh + 0.5;
    const sy = yShoulder + 1.2;
    const ex = (sx + hx) / 2 + (front ? 1.2 : -1.2);
    const ey = (sy + hy) / 2 + 1;
    const sleeve = armourRole ? STEEL : c.outfit;
    // upper arm
    limb(pb, sx, sy, ex, ey, brute ? 3.8 : 3.2, sleeve);
    // forearm: sleeve for long cuts, bracer or skin otherwise
    const cover = sleeveLong ? sleeve : cut === 2 || armourRole ? LEATHER : c.skin;
    limb(pb, ex, ey, hx, hy, sleeveLong ? 3.6 : 2.8, cover);
    if (sleeveLong) {
      // flared cuff
      pb.set(Math.round(hx), Math.round(hy) + 2, c.trim.b);
      pb.set(Math.round(hx) - 1, Math.round(hy) + 2, c.trim.l);
      pb.set(Math.round(hx) + 1, Math.round(hy) + 2, sleeve.d);
    }
    // hand
    const handCol = sp.startsWith('hollow') ? c.skin : c.skin;
    pb.set(Math.round(hx), Math.round(hy), handCol.b);
    pb.set(Math.round(hx) - 1, Math.round(hy), handCol.l);
    pb.set(Math.round(hx), Math.round(hy) + 1, handCol.d);
    if (weapon === 'fist') {
      // wraps
      pb.set(Math.round(hx), Math.round(hy), hex('#efe8d8'));
      pb.set(Math.round(hx) - 1, Math.round(hy), hex('#d8d0bc'));
      pb.set(Math.round(hx), Math.round(hy) - 1, hex('#efe8d8'));
      pb.set(Math.round(hx) + 1, Math.round(hy), hex('#d8d0bc'));
    }
  };
  const hasTool = spec.state === 'work';
  if (p.seated) {
    // hands joined in front of the belly
    limb(pb, cx - sh + 0.5, yShoulder + 1.5, cx - 1, yWaist + 2.5, 3.2, c.outfit);
    limb(pb, cx + sh - 0.5, yShoulder + 1.5, cx + 1, yWaist + 2.5, 3.2, c.outfit);
    pb.rect(Math.round(cx) - 1, Math.round(yWaist) + 2, 3, 2, c.skin.b);
  } else {
    armR(p.lhx, p.lhy + p.bob * 0.4, false);
  }

  // ----- head ------------------------------------------------------------------------
  const hx = cx + 0.6 + p.lean * 0.3;
  const hy = 11.5 + bodyDy + p.headDy;
  const hr = female ? 4.5 : 4.8;
  drawHeadAndHair(pb, spec, c, hx, hy, hr, back, part);

  // ----- right arm + weapon in front ------------------------------------------------
  if (!p.seated) {
    if (weapon && weapon !== 'fist' && !hasTool) {
      // weapon behind the hand for spear/staff shafts in front of body
      armR(p.rhx, p.rhy, true);
      drawWeapon(pb, weapon, p.rhx, p.rhy, p.wAngle, p.swing, spec.state === 'fight');
      // re-draw the hand over the grip
      pb.set(Math.round(p.rhx), Math.round(p.rhy), c.skin.b);
      pb.set(Math.round(p.rhx) - 1, Math.round(p.rhy), c.skin.l);
    } else if (hasTool) {
      armR(p.rhx, p.rhy, true);
      drawTool(pb, spec.tool ?? 'hammer', p.rhx, p.rhy, p.wAngle);
    } else {
      armR(p.rhx, p.rhy, true);
      if (weapon === 'fist' && p.swing) {
        pb.set(Math.round(p.rhx) + 2, Math.round(p.rhy), rgba(255, 255, 255, 200));
        pb.set(Math.round(p.rhx) + 3, Math.round(p.rhy) - 1, rgba(255, 240, 160, 160));
        pb.set(Math.round(p.rhx) + 3, Math.round(p.rhy) + 1, rgba(255, 240, 160, 160));
      }
    }
  } else if (weapon && weapon !== 'fist') {
    // weapon laid across the knees
    const lx = cx - 7;
    pb.line(lx, 35, lx + 14, 34, weapon === 'staff' || weapon === 'spear' ? LEATHER.b : STEEL.l);
  }
  return part;
}

function drawTool(pb: PixelBuffer, tool: 'hammer' | 'hoe', hx: number, hy: number, angle: number): void {
  const a = rad(angle);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  for (let t = -2; t <= 10; t++) pb.set(hx + dx * t, hy + dy * t, t % 4 === 0 ? LEATHER.dd : LEATHER.b);
  const ex = hx + dx * 10;
  const ey = hy + dy * 10;
  if (tool === 'hammer') {
    pb.rect(Math.round(ex) - 2, Math.round(ey) - 2, 5, 3, STEEL.b);
    pb.rect(Math.round(ex) - 2, Math.round(ey) - 2, 5, 1, STEEL.l);
  } else {
    // hoe blade perpendicular
    const px = -dy;
    const py = dx;
    for (let t = 0; t < 5; t++) pb.set(ex + px * t * 0.8 + dx, ey + py * t * 0.8 + dy, t < 4 ? STEEL.b : STEEL.l);
  }
}

// ----- head, face, hair, accessory ---------------------------------------------------

function drawHeadAndHair(pb: PixelBuffer, spec: CharSpec, c: Colours, hx: number, hy: number, hr: number, back: boolean, part: Part): void {
  const l = spec.look;
  const style = ((l.hairStyle % LOOK_RANGES.hairStyle) + LOOK_RANGES.hairStyle) % LOOK_RANGES.hairStyle;
  const acc = ((l.accessory % LOOK_RANGES.accessory) + LOOK_RANGES.accessory) % LOOK_RANGES.accessory;
  const sp = spec.special ?? 'none';
  const hollow = sp.startsWith('hollow');
  const female = l.gender === 1;
  const role = spec.role;
  const hair = c.hair;
  // back hair first (long styles hang behind the head)
  if (style === 2) {
    // long loose
    const len = female ? 14 : 12;
    shadedPoly(pb, [hx - hr - 0.5, hy - 1, hx + hr + 0.5, hy - 1, hx + hr + 1.5, hy + len, hx - hr - 1.5, hy + len], hair);
  } else if (style === 3) {
    // ponytail swinging behind
    const dir = back ? 0 : -1;
    limb(pb, hx - hr + 0.5, hy - 2, hx - hr - 3 + dir, hy + 4, 3, hair);
    limb(pb, hx - hr - 3 + dir, hy + 4, hx - hr - 2 + dir, hy + 9, 2.4, hair);
  }
  // head disc
  disc(pb, hx, hy, hr, hr - 0.2, c.skin, 7);
  // ears
  pb.set(Math.round(hx - hr), Math.round(hy + 0.5), c.skin.b);
  if (!back) pb.set(Math.round(hx + hr), Math.round(hy + 0.5), c.skin.d);
  if (!back) {
    // face turned slightly toward +x
    const ex = hx + 0.8;
    const ey = hy + 0.7;
    if (hollow) {
      pb.rect(Math.round(ex - 2.5), Math.round(ey - 1), 2, 2, hex('#14101a'));
      pb.rect(Math.round(ex + 1), Math.round(ey - 1), 2, 2, hex('#14101a'));
      pb.set(Math.round(ex - 2), Math.round(ey), hex('#b866ff'));
      pb.set(Math.round(ex + 2), Math.round(ey), hex('#b866ff'));
      pb.set(Math.round(ex), Math.round(ey + 3), hex('#2a1a38'));
      pb.set(Math.round(ex + 1), Math.round(ey + 3), hex('#2a1a38'));
      // drip of corruption
      pb.set(Math.round(ex + 1), Math.round(ey + 4), rgba(150, 70, 220));
      pb.set(Math.round(ex + 1), Math.round(ey + 5), rgba(110, 50, 170));
    } else {
      pb.set(Math.round(ex - 2), Math.round(ey), hex('#241a1e'));
      pb.set(Math.round(ex + 2), Math.round(ey), hex('#241a1e'));
      pb.set(Math.round(ex - 2), Math.round(ey - 1), mix(c.skin.d, hex('#241a1e'), 0.3));
      pb.set(Math.round(ex + 2), Math.round(ey - 1), mix(c.skin.d, hex('#241a1e'), 0.3));
      // nose + mouth
      pb.set(Math.round(ex + 0.5), Math.round(ey + 1.6), c.skin.d);
      pb.set(Math.round(ex + 0.5), Math.round(ey + 2.8), mix(c.skin.d, hex('#a04a4a'), 0.6));
      if (female) {
        pb.set(Math.round(ex - 3), Math.round(ey + 1), mix(c.skin.b, hex('#e07a8a'), 0.35));
        pb.set(Math.round(ex + 3), Math.round(ey + 1), mix(c.skin.b, hex('#e07a8a'), 0.35));
      }
    }
  }
  // ----- hair cap and style ------------------------------------------------------------
  const noHair = style === 5 || hollow && sp === 'hollow_monk';
  if (!noHair) {
    const capRy = back ? hr + 0.4 : hr * 0.62;
    // cap: top portion of head
    for (let y = Math.floor(hy - hr - 1); y <= Math.ceil(hy + capRy - hr + (back ? 2.5 : 0.2)); y++) {
      for (let x = Math.floor(hx - hr - 1); x <= Math.ceil(hx + hr + 1); x++) {
        const nx = (x + 0.5 - hx) / (hr + 0.6);
        const ny = (y + 0.5 - hy) / (hr + 0.5);
        if (nx * nx + ny * ny > 1) continue;
        if (!back) {
          // fringe line: hairline slopes slightly
          const hairline = hy - hr * 0.1 - nx * 0.9 + 1.2;
          if (y + 0.5 > hairline) continue;
        } else if (y + 0.5 > hy + hr * 0.55) continue;
        const v = 0.55 - 0.3 * nx - 0.45 * ny + bayer(x, y) * 0.14 + (hf(x, y, 3) - 0.5) * 0.1;
        pb.set(x, y, rampTone(hair, v));
      }
    }
    if (!back) {
      // sideburns
      pb.set(Math.round(hx - hr + 0.5), Math.round(hy + 1), hair.d);
      pb.set(Math.round(hx - hr + 0.5), Math.round(hy + 2), hair.dd);
    }
    switch (style) {
      case 1: {
        // topknot
        disc(pb, hx + 0.3, hy - hr - 1.8, 2.3, 2.3, hair, 11);
        pb.hline(hx - 1, hx + 2, hy - hr + 0.4, c.sash.b);
        break;
      }
      case 3:
        pb.set(Math.round(hx - hr + 1), Math.round(hy - hr + 1), c.sash.b);
        break;
      case 4: {
        // braid over the shoulder
        const bx = hx + (back ? -1 : hr - 0.5);
        for (let i = 0; i < 12; i++) {
          const xx = bx + (i % 2 ? 0.6 : -0.2);
          pb.set(xx, hy + 2 + i, i % 3 === 2 ? hair.d : hair.b);
          pb.set(xx + 1, hy + 2 + i, hair.d);
        }
        pb.set(Math.round(bx), Math.round(hy + 14), c.sash.b);
        break;
      }
      case 6: {
        // scholar cap (futou) with a short bun
        part.hat = true;
        const capC = ramp('#26222c', 0.7, 1.5);
        pb.rect(Math.round(hx - hr), Math.round(hy - hr - 1), Math.round(hr * 2 + 1), 4, capC.b);
        pb.rect(Math.round(hx - hr), Math.round(hy - hr - 1), Math.round(hr * 2 + 1), 1, capC.l);
        pb.rect(Math.round(hx - 2), Math.round(hy - hr - 4), 5, 3, capC.b);
        pb.rect(Math.round(hx - 2), Math.round(hy - hr - 4), 5, 1, capC.l);
        // tails
        pb.set(Math.round(hx - hr - 1), Math.round(hy - hr + 1), capC.d);
        pb.set(Math.round(hx - hr - 2), Math.round(hy - hr + 2), capC.d);
        pb.set(Math.round(hx - hr - 2), Math.round(hy - hr + 3), capC.dd);
        break;
      }
      default:
        break;
    }
  } else if (!hollow && !back) {
    // shaven scalp: a subtle highlight
    pb.set(Math.round(hx - 1), Math.round(hy - hr + 1), c.skin.l);
    pb.set(Math.round(hx), Math.round(hy - hr + 1), c.skin.l);
  }
  // ----- accessory ---------------------------------------------------------------------
  const roleHat = role === 'merchant' || role === 'wanderer' || role === 'physician' || role === 'guard';
  const bandit = sp === 'bandit' || sp === 'bandit_boss';
  if (role === 'guard' && sp === 'none') {
    // conical helmet with a red plume
    const helm = STEEL;
    for (let y = 0; y < 7; y++) {
      const w = 2.4 + y * 0.9;
      for (let x = Math.floor(hx - w); x <= Math.ceil(hx + w); x++) pb.set(x, Math.round(hy - hr - 2 + y), x < hx - w * 0.3 ? helm.l : x > hx + w * 0.5 ? helm.d : helm.b);
    }
    pb.set(Math.round(hx), Math.round(hy - hr - 3), hex('#a8302a'));
    pb.set(Math.round(hx), Math.round(hy - hr - 4), hex('#c8452d'));
    pb.set(Math.round(hx + 1), Math.round(hy - hr - 4), hex('#a8302a'));
    pb.hline(hx - hr - 0.5, hx + hr + 0.5, hy - hr + 4.4, helm.dd);
    part.hat = true;
  } else if ((acc === 2 || (role === 'wanderer' && acc !== 2) || (role === 'merchant')) && sp === 'none' && !(role === 'guard')) {
    // bamboo / straw hat: wide cone over the top half of the face
    part.hat = true;
    const straw = role === 'merchant' ? ramp('#c8a45a', 0.72, 1.2) : ramp('#c9b274', 0.72, 1.18);
    const wide = role === 'merchant' ? 9.5 : 9;
    for (let y = 0; y < 5; y++) {
      const w = 3.2 + y * (wide - 3.2) / 4;
      for (let x = Math.floor(hx - w); x <= Math.ceil(hx + w); x++) {
        const u = (x - (hx - w)) / (2 * w + 1);
        let col = u < 0.3 ? straw.l : u > 0.72 ? straw.d : straw.b;
        if ((x + y) % 3 === 0) col = scale(col, 0.92);
        pb.set(x, Math.round(hy - hr - 1.5 + y), col);
      }
    }
    pb.hline(hx - wide, hx + wide, Math.round(hy - hr + 3.5), straw.dd);
    pb.set(Math.round(hx), Math.round(hy - hr - 2.5), straw.l);
    pb.set(Math.round(hx - 1), Math.round(hy - hr - 2), straw.l);
    pb.set(Math.round(hx + 1), Math.round(hy - hr - 2), straw.b);
    // chin strap
    if (!back) {
      pb.set(Math.round(hx - hr + 0.5), Math.round(hy + 2), hex('#6a2a2a'));
      pb.set(Math.round(hx + hr - 0.5), Math.round(hy + 2), hex('#6a2a2a'));
    }
  } else if (acc === 1 || bandit) {
    // headband
    const band = bandit ? hex('#8a2a2a') : c.sash.b;
    const bandL = bandit ? hex('#b83a3a') : c.sash.l;
    for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) {
      const nx = (x + 0.5 - hx) / hr;
      if (Math.abs(nx) > 1) continue;
      const yy = Math.round(hy - hr * 0.35 - nx * 0.6 + 0.5);
      pb.set(x, yy, x < hx ? bandL : band);
      pb.set(x, yy + 1, band);
    }
    // knot tails at the back
    pb.set(Math.round(hx - hr - 1), Math.round(hy - 1), band);
    pb.set(Math.round(hx - hr - 2), Math.round(hy), bandL);
    pb.set(Math.round(hx - hr - 2), Math.round(hy + 1), band);
    pb.set(Math.round(hx - hr - 1), Math.round(hy + 2), band);
  } else if (acc === 4 && !back) {
    // hairpin with a gold ornament
    pb.line(hx + 2, hy - hr - 1, hx - 3, hy - hr + 2, hex('#d9b867'));
    pb.set(Math.round(hx + 2), Math.round(hy - hr - 2), hex('#ffe6a0'));
    pb.set(Math.round(hx + 3), Math.round(hy - hr - 1), hex('#c8452d'));
  } else if (acc === 4 && back) {
    pb.line(hx + 1, hy - hr - 1, hx - 2, hy - hr + 2, hex('#d9b867'));
  }
  if ((acc === 3 || bandit) && !back && !(acc === 2)) {
    // half mask over the lower face
    const mask = bandit ? ramp('#7a2a2a', 0.7, 1.3) : ramp('#2c2a34', 0.7, 1.5);
    for (let y = Math.round(hy + 1.5); y <= Math.round(hy + hr - 0.4); y++) {
      for (let x = Math.floor(hx - hr + 0.5); x <= Math.ceil(hx + hr - 0.5); x++) {
        const nx = (x + 0.5 - hx) / hr;
        const ny = (y + 0.5 - hy) / hr;
        if (nx * nx + ny * ny > 1) continue;
        pb.set(x, y, nx < -0.2 ? mask.l : nx > 0.4 ? mask.d : mask.b);
      }
    }
    part.faceMask = true;
  }
  void roleHat;
  if (sp === 'hollow_lord') {
    // crown of black thorns
    for (let i = -3; i <= 3; i++) {
      const hh = 3 + (Math.abs(i) % 2 ? 1 : 3);
      for (let k = 0; k < hh; k++) pb.set(Math.round(hx + i * 1.4), Math.round(hy - hr - 1 - k), k > hh - 2 ? hex('#b866ff') : hex('#2a1a38'));
    }
  }
  if (role === 'master' && sp === 'none' && !back) {
    // long white beard / moustache for old masters
    pb.set(Math.round(hx + 1), Math.round(hy + 3), hex('#ece8f0'));
    pb.set(Math.round(hx), Math.round(hy + 4), hex('#ece8f0'));
    pb.set(Math.round(hx + 1), Math.round(hy + 4), hex('#d6d2da'));
    pb.set(Math.round(hx + 1), Math.round(hy + 5), hex('#ece8f0'));
  }
}

// ---------------------------------------------------------------------------
// dead pose: lying on the ground
// ---------------------------------------------------------------------------

function drawProne(pb: PixelBuffer, spec: CharSpec, c: Colours): void {
  const y = 35;
  const weapon = spec.weapon;
  // legs
  limb(pb, 19, y, 26, y + 0.5, 3.2, c.trousers);
  pb.rect(26, y - 1, 2, 3, BOOT);
  // torso
  shadedPoly(pb, [9, y - 3.5, 19, y - 3.5, 19.5, y + 2.5, 9, y + 2.5], c.outfit);
  pb.vline(15, y - 3, y + 2, c.sash.b);
  pb.vline(16, y - 3, y + 2, c.sash.d);
  // arm
  limb(pb, 11, y - 2, 6, y + 2, 2.8, c.outfit);
  pb.set(6, y + 2, c.skin.b);
  limb(pb, 17, y - 1, 21, y + 3, 2.8, c.outfit);
  // head
  disc(pb, 6, y - 1.2, 4, 3.8, c.skin, 9);
  const style = spec.look.hairStyle;
  if (style !== 5) {
    for (let yy = y - 5; yy <= y - 1; yy++) for (let x = 2; x <= 9; x++) pb.set(x, yy, ((x + yy) & 1) === 0 ? c.hair.b : c.hair.d);
    if (style === 2) for (let x = 0; x < 5; x++) pb.set(x, y + 1 + (x & 1), c.hair.d);
  }
  pb.set(5, y - 1, hex('#241a1e'));
  pb.set(8, y - 1, hex('#241a1e'));
  if (weapon && weapon !== 'fist') {
    pb.line(2, y + 5, 14, y + 5, weapon === 'staff' || weapon === 'spear' ? LEATHER.b : STEEL.l);
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

function resampleNearest(src: PixelBuffer, k: number): PixelBuffer {
  const w = Math.round(src.w * k);
  const h = Math.round(src.h * k);
  const out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.h - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.floor(x / k));
      out.px[y * w + x] = src.px[sy * src.w + sx];
    }
  }
  return out;
}

export function charScale(spec: CharSpec): number {
  const sp = spec.special ?? 'none';
  if (sp === 'hollow_lord') return 1.55;
  if (sp === 'bandit_boss') return 1.38;
  if (sp === 'hollow_brute') return 1.32;
  if (spec.elite === 2) return 1.35;
  if (spec.elite === 1) return 1.15;
  return 1;
}

export interface CharSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  /** Top of the head / hat in sprite px (for name plate placement). */
  top: number;
}

/** Generate one frame. Directions 1 and 2 are mirrors of 0 and 3. */
export function genCharacter(spec: CharSpec): CharSprite {
  const mirror = spec.dir === 1 || spec.dir === 2;
  const back = spec.dir === 2 || spec.dir === 3;
  const c = paletteFor(spec);
  let pb = new PixelBuffer(CHAR_W, CHAR_H);
  const pose = poseFor(spec, spec.weapon);
  if (pose.prone) drawProne(pb, spec, c);
  else drawFront(pb, spec, c, pose, back);
  // Blight corruption for hollows
  if ((spec.special ?? 'none').startsWith('hollow')) {
    pb.map((col, x, y) => (hf(x, y, 4) < 0.06 ? mix(col, rgba(150, 70, 220), 0.5) : corrupt(col, 0.15)));
  }
  let k = charScale(spec);
  if (k !== 1) pb = resampleNearest(pb, k);
  pb.outline(INK, 1, 99);
  const b = pb.bounds();
  const out = mirror ? pb.flipped() : pb;
  const ax = mirror ? pb.w - 1 - Math.round(CHAR_AX * k) : Math.round(CHAR_AX * k);
  void k;
  k = 1;
  return { pb: out, ax, ay: Math.round(CHAR_AY * charScale(spec)), top: b ? b.y0 : 0 };
}

export { QI };
