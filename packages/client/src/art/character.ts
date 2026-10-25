/**
 * Layered paper-doll character generator (48x64 sprite, feet anchor at 24,54). A figure is assembled from parts - legs,
 * robe, torso, sash, accessories, arms, head, hair, weapon - painted with mask shading, rim light and a selective ink
 * outline, in a front (SE/SW) or back (NE/NW) view; west facings are mirrors. The outfit tier / rarity and the weapon /
 * accessory gear change what is drawn (see gear.ts); poses come from anim.ts. Pure (node-testable).
 */
import type { Dir, EntityState, NpcRole, WeaponType } from '@murim/shared';
import { type Pose, poseFor, FRAME_COUNTS, WIND_STATES, type CharState, type ToolKind } from './anim';
import { corrupt, css, hex, mix, rgba, type Col } from './color';
import { hf } from './draw';
import { selOutline, rotateNearest, resizePixels, resizeGlow } from './figure';
import { CHAR_K, SIZE_MULT } from './scale';
import { NO_GEAR, type GearAppearance } from './gear';
import { PixelBuffer } from './pixel';
import { Ctx, CHAR_AX, CHAR_AY, CHAR_H, CHAR_W, CX, INK, OY, paletteFor, type CharSpecBase, type SpecialStyle } from './charctx';
import {
  buildRig,
  paintArm,
  paintBackLayer,
  paintHand,
  paintLegs,
  paintSash,
  paintShoulders,
  paintSkirt,
  paintTorso,
} from './charbody';
import { paintHead, paintNeck } from './charhead';
import { paintArmTrinket, paintCauldron, paintTool, paintWornTrinket } from './trinkets';
import { drawEmptyScabbard, drawSmear, drawStreak, drawWeapon, fistGear, smearColor, weaponLength } from './weapons';

export { CHAR_AX, CHAR_AY, CHAR_H, CHAR_W, FRAME_COUNTS };
export type { CharState, SpecialStyle, ToolKind };

const QI = hex('#9fe8ff');
const EYE_PX = hex('#24161c');
const EYE_PX2 = hex('#3a2a30');

export interface CharSpec extends CharSpecBase {
  state: CharState;
  dir: Dir;
  frame: number;
  /** Attack variant (selects one of the 2-4 attack animations of the weapon). */
  variant?: number;
  /** Wind level 0 calm, 1 breezy, 2 storm (only read by idle-like states). */
  wind?: number;
  /** Idle fidgets: head turn -1/0/1, tilt -1/0/1, blink. */
  gaze?: number;
  tilt?: number;
  blink?: boolean;
  /** Keep the detailed design size (about 48 px tall) instead of the in-world size (portraits, gallery). */
  full?: boolean;
}

export function stateFromEntity(s: EntityState): CharState {
  switch (s) {
    case 'walk':
      return 'walk';
    case 'fight':
      return 'fight';
    case 'work':
      return 'work';
    case 'craft':
      return 'craft';
    case 'meditate':
      return 'meditate';
    case 'dead':
      return 'dead';
    default:
      return 'idle';
  }
}

/** Size of the person relative to a normal adult (see scale.ts). */
export function sizeMult(spec: Pick<CharSpec, 'special' | 'elite'>): number {
  const sp = spec.special ?? 'none';
  if (sp === 'hollow_lord') return SIZE_MULT.hollow_lord;
  if (sp === 'bandit_boss') return SIZE_MULT.bandit_boss;
  if (sp === 'hollow_brute') return SIZE_MULT.hollow_brute;
  if (spec.elite === 2) return SIZE_MULT.elite2;
  if (spec.elite === 1) return SIZE_MULT.elite1;
  return 1;
}

/** Total resample factor of the painted figure (`full` keeps the detailed design size, used by portraits). */
export function charScale(spec: Pick<CharSpec, 'special' | 'elite' | 'full'>): number {
  return (spec.full ? 1 : CHAR_K) * sizeMult(spec);
}

export interface CharSprite {
  pb: PixelBuffer;
  ax: number;
  ay: number;
  /** Top of the head / hat in sprite px (for name plate placement). */
  top: number;
  /** Additive glow layer (rarity shimmer, weapon glow, eyes), or null. */
  glow: PixelBuffer | null;
  /** Weapon tip in sprite px (for trail sparks), or null. */
  tip: [number, number] | null;
  /** Eye rects (2x2, sprite px) with the skin colour behind them, so blinks are drawn as a tiny overlay instead of new sprites. */
  eyes: { x: number; y: number; w: number; h: number; skin: string }[] | null;
  /** Rarity of weapon / outfit (for the render layer's dynamic effects). */
  wRar: number;
  oRar: number;
}

function paintFigure(c: Ctx): void {
  const { spec, p, rig, g } = c;
  const wpn: WeaponType | null = spec.weapon ?? null;
  const wT = Math.max(1, g.wT || 1);
  paintBackLayer(c);
  paintLegs(c);
  paintSkirt(c);
  if (p.tool === 'ladle' || (c.spec as CharSpec).state === 'craft') paintCauldron(c, (c.spec as CharSpec).frame);
  paintTorso(c);
  paintSash(c);
  paintShoulders(c);
  paintWornTrinket(c);

  // weapon carried at the hip (sword / blade): scabbard hangs from the sash
  const hipWeapon = (wpn === 'sword' || wpn === 'blade') && p.sheath > 0;
  if (hipWeapon) {
    const hx = rig.cx - 2.8;
    const hy = rig.waistY + 0.6;
    if (p.sheath === 2) drawEmptyScabbard(c.pb, wpn!, wT, hx, hy, 106);
    else c.tip = drawWeapon({ pb: c.pb, glow: c.glow, weapon: wpn!, tier: wT, rar: g.wR, hx, hy, ang: 106, sheathed: true });
  }

  const twoHandWeapon = (wpn === 'spear' || wpn === 'staff') && p.sheath === 0;
  const handR = (): [number, number] => [rig.cx + p.rhx, p.rhy + OY];
  const handL = (): [number, number] => [rig.cx + p.lhx, p.lhy + OY];

  // left (far) arm
  if (!twoHandWeapon) {
    const [lx, ly] = handL();
    const gl = paintArm(c, false, lx, ly);
    if (p.toolL) paintTool(c, p.toolL, gl.ex, gl.ey, 0);
  }
  paintNeck(c);
  paintHead(c);

  // right (near) arm with weapon / tool
  const [rx, ry] = handR();
  const fg = wpn === 'fist' && p.fists ? fistGear(wT) : null;
  const geom = paintArm(c, true, rx, ry, true);
  if (p.tool) {
    paintTool(c, p.tool, geom.ex, geom.ey, p.wAng);
  } else if (wpn && wpn !== 'fist' && p.sheath !== 1) {
    const frac = p.sheath === 2 || (hipWeapon && p.bladeFrac < 1) ? p.bladeFrac : 1;
    c.tip = drawWeapon({ pb: c.pb, glow: c.glow, weapon: wpn, tier: wT, rar: g.wR, hx: geom.ex + 0.4, hy: geom.ey + 0.2, ang: p.wAng, bladeFrac: frac });
  }
  paintHand(c, true, geom.ex, geom.ey, fg);
  c.handR = [geom.ex, geom.ey];
  paintArmTrinket(c, geom);
  if (twoHandWeapon) {
    const [lx, ly] = handL();
    paintArm(c, false, lx, ly);
  }
}

function reach(sx: number, sy: number, tx: number, ty: number, max: number): [number, number] {
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.hypot(dx, dy);
  if (d <= max) return [tx, ty];
  return [sx + (dx / d) * max, sy + (dy / d) * max];
}

/** Generate one frame. Directions 1 and 2 are mirrors of 0 and 3. */
export function genCharacter(spec: CharSpec): CharSprite {
  const mirror = spec.dir === 1 || spec.dir === 2;
  const back = spec.dir === 2 || spec.dir === 3;
  const g: GearAppearance = spec.gear ?? NO_GEAR;
  const sp = spec.special ?? 'none';
  const weapon = spec.weapon ?? null;
  const c0 = paletteFor(spec, g);
  const pose: Pose = poseFor({
    state: spec.state,
    frame: spec.frame,
    weapon,
    variant: spec.variant ?? 0,
    wind: WIND_STATES.has(spec.state) ? spec.wind ?? 0 : 0,
    look: spec.gaze ?? 0,
    tilt: spec.tilt ?? 0,
    blink: spec.blink ?? false,
    tool: spec.tool ?? null,
    hunch: sp.startsWith('hollow'),
    stiff: spec.role === 'guard',
  });
  let pb = new PixelBuffer(CHAR_W, CHAR_H);
  let glow = new PixelBuffer(CHAR_W, CHAR_H);
  const rig = buildRig(spec, pose, back);
  const ctx = new Ctx(pb, glow, spec, c0, pose, rig, g);
  paintFigure(ctx);
  let tip = ctx.tip;
  const fallen = pose.rot !== 0 || spec.state === 'dead';
  if (spec.state === 'dead' || pose.rot !== 0) {
    const rot = spec.state === 'dead' ? -90 : pose.rot;
    const k = Math.abs(rot) / 90;
    const sx = Math.round(5 * k);
    const sy = Math.round(11 * k);
    pb = rotateNearest(pb, rot, CX, 40 + OY, sx, sy);
    glow = rotateNearest(glow, rot, CX, 40 + OY, sx, sy);
    if (tip) {
      const a = (rot * Math.PI) / 180;
      const dx = tip[0] - CX;
      const dy = tip[1] - 40 - OY;
      tip = [CX + sx + dx * Math.cos(a) - dy * Math.sin(a), 40 + OY + sy + dx * Math.sin(a) + dy * Math.cos(a)];
    }
  }
  if (sp.startsWith('hollow')) {
    pb.map((col, x, y) => (hf(x, y, 4) < 0.05 ? mix(col, rgba(150, 70, 220), 0.5) : corrupt(col, 0.15)));
    // violet corruption drips under the hem and from the hands
    for (let i = 0; i < 4; i++) {
      const x = CX - 10 + ((i * 7) % 20);
      for (let y = 0; y < pb.h - 2; y++) {
        if (pb.px[y * pb.w + x] >>> 24 > 200 && y > 44 + OY && pb.px[(y + 1) * pb.w + x] >>> 24 === 0) {
          pb.set(x, y + 1, rgba(150, 70, 220));
          pb.set(x, y + 2 + (i & 1), rgba(110, 50, 170));
          break;
        }
      }
    }
  }
  const k = charScale(spec);
  if (k !== 1) {
    pb = resizePixels(pb, k);
    glow = resizeGlow(glow, k);
    if (tip) tip = [tip[0] * k, tip[1] * k];
  }
  // eyes are repainted at the final size (a 1 x 2 px pair stays legible where the 2 x 2 design eyes were averaged away)
  const eyeXY: [number, number][] = [];
  if (ctx.eyes && !fallen && k < 1) {
    for (const [ex, ey] of ctx.eyes) {
      const x = Math.floor((ex + 1) * k);
      const y = Math.floor((ey + 0.5) * k);
      eyeXY.push([x, y]);
      if (spec.blink) pb.set(x, y + 1, EYE_PX);
      else {
        pb.set(x, y, EYE_PX);
        pb.set(x, y + 1, EYE_PX2);
      }
    }
  }
  selOutline(pb, INK);
  // head top for the name plate: first opaque row near the head columns
  let top = pb.h;
  const hxk = rig.hx * k;
  const x0 = Math.max(0, Math.floor(hxk - 6 * k));
  const x1 = Math.min(pb.w - 1, Math.ceil(hxk + 6 * k));
  if (fallen) {
    const bb = pb.bounds();
    top = bb ? bb.y0 : 0;
  } else
    for (let y = 0; y < pb.h && top === pb.h; y++) for (let x = x0; x <= x1; x++) if (pb.px[y * pb.w + x] >>> 24 > 0) top = y;
  if (top === pb.h) top = 0;
  // weapon smear (after the outline so it stays translucent)
  if (spec.state === 'attack' && pose.smK > 0 && !fallen) {
    const col = smearColor(weapon ?? 'fist', g.wR);
    const sxk = rig.shRx;
    const syk = rig.shRy;
    const [cx0, cy0] = reach(sxk, syk, rig.cx + pose.pvx, pose.pvy + OY, 12.9);
    const [cx1, cy1] = reach(sxk, syk, rig.cx + pose.rhx, pose.rhy + OY, 12.9);
    if (weapon && weapon !== 'fist') {
      const len = weaponLength(weapon, g.wT || 1);
      if (pose.smKind === 1) {
        const a0 = (pose.sm0 * Math.PI) / 180;
        const a1 = (pose.sm1 * Math.PI) / 180;
        drawStreak(pb, (cx0 + Math.cos(a0) * len * 0.9) * k, (cy0 + Math.sin(a0) * len * 0.9) * k, (cx1 + Math.cos(a1) * len) * k, (cy1 + Math.sin(a1) * len) * k, col, pose.smK);
      } else drawSmear(pb, cx0 * k, cy0 * k, cx1 * k, cy1 * k, pose.sm0, pose.sm1, len * 0.45 * k, len * k, col, pose.smK);
    } else {
      drawStreak(pb, (cx0 - 2) * k, cy0 * k, (cx1 + 3) * k, cy1 * k, col, pose.smK);
      drawStreak(pb, (cx0 - 2) * k, (cy0 + 1.4) * k, (cx1 + 1) * k, (cy1 + 1.4) * k, col, pose.smK * 0.6);
    }
  }
  const mir = mirror ? pb.flipped() : pb;
  const mirGlow = mirror ? glow.flipped() : glow;
  let ax = mirror ? pb.w - 1 - Math.round(CHAR_AX * k) : Math.round(CHAR_AX * k);
  let ay = Math.round(CHAR_AY * k);
  let mtip: [number, number] | null = tip ? [mirror ? pb.w - 1 - tip[0] : tip[0], tip[1]] : null;
  // crop to the painted bounds (smaller canvases, cheaper blits)
  const bp = mir.bounds();
  const bg = mirGlow.bounds();
  let cx0 = bp ? bp.x0 : 0;
  let cy0 = bp ? bp.y0 : 0;
  let cx1 = bp ? bp.x1 : 0;
  let cy1 = bp ? bp.y1 : 0;
  if (bg) {
    cx0 = Math.min(cx0, bg.x0);
    cy0 = Math.min(cy0, bg.y0);
    cx1 = Math.max(cx1, bg.x1);
    cy1 = Math.max(cy1, bg.y1);
  }
  cx0 = Math.min(cx0, ax - 2);
  cx1 = Math.max(cx1, ax + 2);
  cy1 = Math.max(cy1, ay);
  const out = crop(mir, cx0, cy0, cx1, cy1);
  const outGlow = bg ? crop(mirGlow, cx0, cy0, cx1, cy1) : null;
  ax -= cx0;
  ay -= cy0;
  if (mtip) mtip = [mtip[0] - cx0, mtip[1] - cy0];
  let eyes: CharSprite['eyes'] = null;
  if (ctx.eyes && !fallen && !spec.blink) {
    const skin = css(c0.skin.b);
    if (k < 1) {
      eyes = eyeXY.map(([x, y]) => ({ x: (mirror ? pb.w - x - 1 : x) - cx0, y: y - cy0, w: 1, h: 2, skin }));
    } else {
      eyes = ctx.eyes.map(([ex, ey]) => {
        const w = Math.max(1, Math.round(2 * k));
        const x = Math.floor(ex * k);
        return { x: (mirror ? pb.w - x - w : x) - cx0, y: Math.floor(ey * k) - cy0, w, h: w, skin };
      });
    }
  }
  return { pb: out, ax, ay, top: Math.max(0, top - cy0), glow: outGlow, tip: mtip, eyes, wRar: g.wT ? g.wR : 0, oRar: g.oT ? g.oR : 0 };
}

function crop(src: PixelBuffer, x0: number, y0: number, x1: number, y1: number): PixelBuffer {
  const out = new PixelBuffer(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < out.h; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= src.h) continue;
    for (let x = 0; x < out.w; x++) {
      const sx = x + x0;
      if (sx >= 0 && sx < src.w) out.px[y * out.w + x] = src.px[sy * src.w + sx];
    }
  }
  return out;
}

export function defaultRoleWeapon(role: NpcRole | null | undefined): WeaponType | null {
  return role === 'guard' ? 'spear' : null;
}

export { QI };
export type { Col };
