/**
 * Shared context for the character part painters (body, outfit, head, trinkets): colours, the rig derived from the pose,
 * and the buffers being painted.
 */
import { LOOK_RANGES, type Look, type NpcRole, type WeaponType } from '@murim/shared';
import { type Col, hex, mix, rgba } from './color';
import { Shaper } from './figure';
import { OUTFIT_TRIM, rarityCol, type GearAppearance } from './gear';
import { PixelBuffer } from './pixel';
import { lookRamps, ramp, type Ramp } from './palette';
import type { Pose, ToolKind } from './anim';

/** Paint canvas (generous so raised weapons and long strikes are never clipped; the result is cropped to its bounds). */
export const CHAR_W = 64;
export const CHAR_H = 80;
/** Feet anchor inside the paint canvas. */
export const CHAR_AX = 32;
export const CHAR_AY = 70;
export const CX = 32;
/** Vertical offset of the figure design (designed with the head near y=16) inside the canvas. */
export const OY = 16;
export const GROUND = 53 + OY;

export type SpecialStyle = 'none' | 'bandit' | 'bandit_boss' | 'hollow' | 'hollow_monk' | 'hollow_brute' | 'hollow_lord';

export const INK: Col = rgba(30, 22, 34);
export const BOOT = ramp('#2e2622', 0.62, 1.55);
export const STEEL = ramp('#9aa3b0', 0.62, 1.3);
export const LEATHER = ramp('#6a4a32', 0.62, 1.3);
export const WHITE_ROBE = ramp('#e8e2d2', 0.74, 1.08);

export interface Colours {
  skin: Ramp;
  hair: Ramp;
  outfit: Ramp;
  /** Under-garment / inner collar. */
  inner: Ramp;
  trousers: Ramp;
  sash: Ramp;
  trim: Ramp;
  /** Rarity piping colour (null for common / fine). */
  pipe: Col | null;
  pipeRar: number;
  armour: boolean;
}

export interface CharSpecBase {
  look: Look;
  weapon?: WeaponType | null;
  role?: NpcRole | null;
  faction?: string | null;
  elite?: 0 | 1 | 2;
  special?: SpecialStyle;
  tool?: ToolKind | null;
  gear?: GearAppearance;
}

export function pickCut(l: Look): number {
  return ((l.outfit % LOOK_RANGES.outfit) + LOOK_RANGES.outfit) % LOOK_RANGES.outfit;
}

export function paletteFor(spec: CharSpecBase, g: GearAppearance): Colours {
  const l = spec.look;
  let skin = lookRamps.skin(l.skin);
  let hair = lookRamps.hair(l.hairColor);
  let outfit = lookRamps.outfit(l.outfitColor);
  let sash = lookRamps.sash(l.sashColor);
  let trousers = ramp(mix(outfit.d, hex('#3a322c'), 0.55), 0.7, 1.25);
  const role = spec.role;
  const sp = spec.special ?? 'none';
  let armour = false;
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
    trousers = ramp('#3a3e48', 0.7, 1.25);
    armour = true;
    if (spec.faction) sash = ramp(spec.faction, 0.72, 1.2);
  } else if (role === 'merchant') outfit = ramp('#8a5a2a', 0.7, 1.25);
  else if (role === 'physician') outfit = ramp('#d8e2d0', 0.72, 1.1);
  else if (role === 'alchemist') outfit = ramp('#3e7a55', 0.7, 1.25);
  else if (role === 'smith') outfit = ramp('#5a4a3e', 0.7, 1.25);
  else if (role === 'elder') hair = ramp('#d9d6dc', 0.7, 1.05);
  if (sp === 'bandit' || sp === 'bandit_boss') {
    outfit = ramp(sp === 'bandit_boss' ? '#3a2a2e' : '#33343c', 0.7, 1.4);
    trousers = ramp('#26262e', 0.7, 1.35);
    sash = ramp('#8a2a2a', 0.72, 1.25);
    skin = lookRamps.skin(Math.max(2, l.skin));
  } else if (sp.startsWith('hollow')) {
    skin = ramp('#a6b6a2', 0.72, 1.14);
    hair = ramp('#4a4a54', 0.7, 1.25);
    outfit = ramp(sp === 'hollow_monk' ? '#4a4650' : '#5a5a56', 0.68, 1.25);
    trousers = ramp('#3a3a3c', 0.7, 1.25);
    sash = ramp('#6a3a8a', 0.7, 1.45);
  }
  const tier = Math.max(1, g.oT || 1);
  let trim: Ramp = OUTFIT_TRIM[tier];
  if (tier === 1) trim = ramp(mix(outfit.l, hex('#ffffff'), 0.3), 0.75, 1.1);
  const inner = ramp(mix(outfit.l, hex('#f2ead6'), 0.55), 0.74, 1.08);
  return { skin, hair, outfit, inner, trousers, sash, trim, pipe: g.oR >= 2 ? rarityCol(g.oR) : null, pipeRar: g.oR, armour };
}

/** Body measurements and joint positions for a pose. */
export interface Rig {
  female: boolean;
  back: boolean;
  brute: boolean;
  cut: number;
  longRobe: boolean;
  cx: number;
  lx: number;
  shY: number;
  waistY: number;
  hipY: number;
  /** Half widths. */
  sh: number;
  wa: number;
  hipW: number;
  hemY: number;
  flare: number;
  /** Head. */
  hx: number;
  hy: number;
  hrx: number;
  hry: number;
  /** Shoulder points (screen left = far, right = near). */
  shLx: number;
  shLy: number;
  shRx: number;
  shRy: number;
  /** Feet targets. */
  fLx: number;
  fLy: number;
  fRx: number;
  fRy: number;
  seated: boolean;
}

export class Ctx {
  readonly sh: Shaper;
  /** Sprite-space tip of the weapon (set when drawn). */
  tip: [number, number] | null = null;
  /** Top-left of the two eyes (2x2 px each, pre-scale paint coords) so the render layer can blink them. */
  eyes: [number, number][] | null = null;
  /** Hand positions after IK (sprite px). */
  handL: [number, number] = [0, 0];
  handR: [number, number] = [0, 0];
  constructor(
    readonly pb: PixelBuffer,
    readonly glow: PixelBuffer,
    readonly spec: CharSpecBase,
    readonly c: Colours,
    readonly p: Pose,
    readonly rig: Rig,
    readonly g: GearAppearance,
  ) {
    this.sh = new Shaper(pb.w, pb.h);
  }

  get tier(): number {
    return Math.max(1, this.g.oT || 1);
  }
  /** An outfit is equipped (tier >= 1), as opposed to the plain default garment. */
  get worn(): boolean {
    return this.g.oT > 0;
  }
  get special(): SpecialStyle {
    return this.spec.special ?? 'none';
  }
  get hollow(): boolean {
    return this.special.startsWith('hollow');
  }
  get bandit(): boolean {
    return this.special === 'bandit' || this.special === 'bandit_boss';
  }

  /** Mark pixels in the additive glow layer (rarity shimmer). */
  glowPx(x: number, y: number, r: number, a = 190): void {
    const c = rarityCol(r);
    this.glow.set(x, y, (c & 0x00ffffff) | (a << 24));
    this.glow.set(x - 1, y, (c & 0x00ffffff) | (Math.round(a * 0.3) << 24));
    this.glow.set(x + 1, y, (c & 0x00ffffff) | (Math.round(a * 0.3) << 24));
  }

  /** Piping line in the rarity colour (rare+), with glow for epic+. */
  pipeLine(x0: number, y0: number, x1: number, y1: number): void {
    if (this.c.pipe === null) return;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    let lx = -1e9;
    let ly = -1e9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.floor(x0 + (x1 - x0) * t);
      const y = Math.floor(y0 + (y1 - y0) * t);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      this.pb.set(x, y, this.c.pipe);
      if (this.c.pipeRar >= 3) this.glowPx(x, y, this.c.pipeRar, 170);
    }
  }
}
