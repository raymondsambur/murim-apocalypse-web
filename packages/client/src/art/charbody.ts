/**
 * Body painter: rig, legs and boots, robe / skirt, torso, collar, sash, shoulder pieces and arms, with the outfit tier
 * (1 patched hemp ... 5 immortal garment) and rarity finishing touches.
 */
import { type Look, type NpcRole } from '@murim/shared';
import { type Pose } from './anim';
import { hex, mix, rgba, type Col } from './color';
import { hf } from './draw';
import { ik2 } from './figure';
import { FITTING, JADE, rarityCol } from './gear';
import { CHAR_W, CX, Ctx, GROUND, OY, LEATHER, STEEL, BOOT, pickCut, type CharSpecBase, type Rig } from './charctx';
import { ramp, type Ramp } from './palette';
import { fistGear } from './weapons';

const TMP = [0, 0, 0, 0];

export function buildRig(spec: CharSpecBase, p: Pose, back: boolean): Rig {
  const l: Look = spec.look;
  const female = l.gender === 1;
  const sp = spec.special ?? 'none';
  const role: NpcRole | null | undefined = spec.role;
  const brute = sp === 'hollow_brute' || sp === 'bandit_boss' || sp === 'hollow_lord';
  const cut = pickCut(l);
  const longRobe = cut === 1 || cut === 3 || role === 'master' || role === 'legend' || sp === 'hollow_monk' || sp === 'hollow_lord';
  const cx = CX + p.dx;
  const crouch = p.crouch + (p.seated ? 7.5 : 0);
  const shY = 24 + OY + crouch * 0.95 + p.bob;
  const waistY = 33.4 + OY + crouch * 0.97 + p.bob * 0.5;
  const hipY = 37.6 + OY + crouch + p.bob * 0.3;
  const lx = p.lean * 0.55;
  const sh = (female ? 5.4 : 6.3) + (brute ? 1.4 : 0);
  const wa = (female ? 3.9 : 4.8) + (brute ? 1 : 0);
  const hipW = (female ? 5.8 : 5.4) + (brute ? 0.9 : 0);
  let hemY = p.seated ? 51.5 : role === 'master' || role === 'legend' || sp === 'hollow_lord' ? 51.5 : role === 'guard' ? 43 : cut === 3 ? 51.5 : cut === 1 ? 50.5 : cut === 2 ? 41.5 : 44.5;
  hemY += OY;
  if (!p.seated) hemY = Math.min(52.5 + OY, hemY + crouch * 0.55);
  const flare = cut === 3 || role === 'master' || role === 'legend' ? 2.8 : cut === 1 ? 1.9 : 1.0;
  const fwd = back ? -0.18 : 0.18;
  const flx = cx - 2.8 + p.flx;
  const frx = cx + 2.8 + p.frx;
  return {
    female,
    back,
    brute,
    cut,
    longRobe,
    cx,
    lx,
    shY,
    waistY,
    hipY,
    sh,
    wa,
    hipW,
    hemY,
    flare,
    hx: cx + 0.7 + p.lean * 0.78 + p.tilt * 0.9 + p.turn * 0.5,
    hy: 16.8 + OY + crouch * 0.95 + p.bob + p.hdy + Math.abs(p.tilt) * 0.4,
    hrx: (female ? 5.5 : 5.9) + (brute ? 0.4 : 0),
    hry: female ? 5.8 : 6.1,
    shLx: cx - sh * 0.92 + lx,
    shLy: shY + 1.6,
    shRx: cx + sh * 0.92 + lx,
    shRy: shY + 1.6,
    fLx: flx,
    fLy: GROUND - p.fly + flx * 0 + (p.flx - 0) * fwd,
    fRx: frx,
    fRy: GROUND - p.fry + (p.frx - 0) * fwd,
    seated: p.seated,
  };
}

// ---------------------------------------------------------------------------
// legs and boots
// ---------------------------------------------------------------------------

function boot(c: Ctx, fx: number, fy: number): void {
  const { pb, sh, rig } = c;
  const toe = rig.back ? 0.9 : 3.4;
  sh.clear().poly([fx - 2.2, fy - 5.8, fx + 2.1, fy - 5.8, fx + 2.2, fy - 2.6, fx + toe + 0.8, fy - 1.8, fx + toe + 1.0, fy + 0.4, fx - 2.5, fy + 0.4]);
  sh.shade(pb, BOOT, { seed: 9, grad: 0.4 });
  pb.hline(fx - 2.4, fx + toe + 0.8, fy - 0.1, BOOT.dd);
  if (c.tier >= 3) pb.hline(fx - 2, fx + 2, fy - 5.6, c.c.trim.b);
  if (c.tier >= 3 && c.c.pipe !== null) pb.hline(fx - 2, fx + 2, fy - 5, c.c.pipe);
  pb.set(fx - 1.2, fy - 4, BOOT.hl);
}

export function paintLegs(c: Ctx): void {
  const { rig, pb, sh, p } = c;
  if (rig.seated) return;
  const legs: [number, number, number, number][] = [
    [rig.cx - 2.3, rig.hipY, rig.fLx, rig.fLy],
    [rig.cx + 2.3, rig.hipY, rig.fRx, rig.fRy],
  ];
  for (let i = 0; i < 2; i++) {
    const [hx, hy, fx, fy] = legs[i];
    ik2(hx, hy, fx, fy - 0.4, 7.7, 7.7, -1, TMP);
    const [jx, jy, ex, ey] = TMP;
    const tr = i === 0 ? c.c.trousers : c.c.trousers;
    sh.clear().cap(hx, hy, jx, jy, 2.4 + (rig.brute ? 0.6 : 0), 2.0).cap(jx, jy, ex, ey - 1.5, 2.0, 1.55).shade(pb, tr, { seed: 3, lit: i === 0 ? -0.1 : 0, grad: 0.4 });
    if (!rig.longRobe) {
      // knee fold
      pb.set(jx - 1, jy, tr.dd);
      pb.set(jx, jy + 1, tr.d);
      // leg wraps at the shin (tier 1-2)
      if (c.tier <= 2) for (let k = 0; k < 3; k++) pb.hline(ex - 1.4, ex + 1.4, ey - 5 + k * 1.6, k % 2 ? tr.l : mix(tr.b, hex('#e8e0c8'), 0.45));
    }
    boot(c, ex, ey);
  }
  void p;
}

// ---------------------------------------------------------------------------
// robe / skirt
// ---------------------------------------------------------------------------

function hemEdge(c: Ctx, x0: number, x1: number, hemY: number, hemShift: number): void {
  const { pb, rig } = c;
  const t = c.tier;
  const trim = c.c.trim;
  if (t === 1 && c.worn) {
    // frayed hem: knock out a few pixels
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (hf(x, 4, 11) < 0.3) pb.put(x, Math.round(hemY) - 1, 0);
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (hf(x, 5, 12) < 0.2) pb.put(x, Math.round(hemY) - 2, 0);
  } else if (t === 2) {
    pb.hline(x0 + 1, x1 - 1, hemY - 1.6, trim.d);
    pb.hline(x0 + 1, x1 - 1, hemY - 0.8, trim.b);
  } else if (t >= 3) {
    const band = t === 3 ? 3 : 2.5;
    for (let y = 0; y < band; y++) {
      for (let x = Math.floor(x0 + 1); x <= Math.ceil(x1 - 1); x++) {
        const py = Math.round(hemY - 1 - (band - 1 - y));
        const pat = t === 3 ? ((x + y * 2) % 4 === 0 ? trim.hl : (x + y) % 4 === 1 ? trim.d : trim.b) : t === 4 ? (y === 0 ? trim.l : trim.b) : (y === 0 ? trim.hl : (x % 3 === 0 ? trim.l : trim.b));
        pb.set(x, py, pat);
      }
    }
    if (t === 5) {
      // scalloped cloud edge
      for (let x = Math.floor(x0 + 1); x <= Math.ceil(x1 - 1); x += 3) {
        pb.set(x, Math.round(hemY), trim.b);
        pb.set(x + 1, Math.round(hemY), trim.l);
      }
    }
    if (c.c.pipe !== null) c.pipeLine(x0 + 1, hemY - band - 0.6, x1 - 1, hemY - band - 0.6);
  }
  void rig;
  void hemShift;
}

export function paintSkirt(c: Ctx): void {
  const { rig, pb, sh, p } = c;
  const o = c.c.outfit;
  const t = c.tier;
  const cx = rig.cx;
  if (rig.seated) {
    // folded legs: low mound with knees out
    sh.clear().ell(cx, 48 + OY, 12.2, 4.8).shade(pb, c.c.trousers, { seed: 4 });
    const robe = rig.longRobe || rig.cut === 2;
    sh.clear().ell(cx - 7.8, 47.4 + OY, 3.4, 2.7).ell(cx + 7.8, 47.4 + OY, 3.4, 2.7).shade(pb, robe ? o : c.c.trousers, { seed: 5 });
    sh.clear().ell(cx, 45.8 + OY, 8.6, 3.6).shade(pb, o, { seed: 6 });
    sh.clear().ell(cx - 4, 51.4 + OY, 3.4, 1.4).ell(cx + 4, 51.4 + OY, 3.4, 1.4).shade(pb, BOOT, { noRim: true });
    if (t >= 3) pb.hline(cx - 9, cx + 9, 50 + OY, c.c.trim.b);
    return;
  }
  const top = rig.waistY - 1.2;
  const hs = p.hem;
  const hy = rig.hemY;
  // 5 outer pieces for flowing outer layers are handled in paintBackLayer / paintOuter
  const pts = [cx - rig.wa - 0.4, top, cx + rig.wa + 0.4, top, cx + rig.hipW + 0.7 + hs * 0.3, rig.hipY + 1, cx + rig.hipW + rig.flare + hs, hy, cx - rig.hipW - rig.flare + hs, hy, cx - rig.hipW - 0.7 + hs * 0.3, rig.hipY + 1];
  if (c.c.armour) {
    sh.clear().poly(pts).shade(pb, c.c.trousers, { seed: 12 });
    // tasset plates
    for (let k = 0; k < 4; k++) {
      const x0 = cx - rig.hipW - 0.5 + k * ((rig.hipW * 2 + 1) / 4) + hs * 0.6;
      sh.clear().poly([x0, rig.hipY + 0.5, x0 + 3.2, rig.hipY + 0.5, x0 + 3.0, hy, x0 + 0.2, hy]).shade(pb, STEEL, { seed: k });
      pb.hline(x0, x0 + 3, rig.hipY + 4, STEEL.dd);
    }
    pb.hline(cx - rig.hipW - 1, cx + rig.hipW + 1, hy - 0.5, STEEL.dd);
    return;
  }
  sh.clear().poly(pts).shade(pb, o, { seed: 10, grad: 0.42 });
  // folds: dark creases with a light edge, following the sway
  const nf = rig.longRobe ? 4 : 3;
  for (let k = 0; k < nf; k++) {
    const u = (k + 0.7) / (nf + 0.4);
    const x0 = cx - rig.hipW + u * rig.hipW * 2;
    const x1 = cx - rig.hipW - rig.flare + u * (rig.hipW + rig.flare) * 2 + hs;
    sh.line(pb, x0, rig.hipY + 1.5, x1, hy - 1.2, o.d);
    sh.line(pb, x0 - 1, rig.hipY + 2.5, x1 - 1, hy - 1.5, o.l);
  }
  if (rig.cut === 0 && !rig.longRobe) {
    // tunic side vents
    sh.line(pb, cx - rig.hipW - 0.5 + hs, hy - 2, cx - rig.hipW + hs, hy, o.dd);
    sh.line(pb, cx + rig.hipW + 0.5 + hs, hy - 2, cx + rig.hipW + hs, hy, o.dd);
  }
  // tier decoration on the skirt
  if (t === 1 && c.worn) {
    // patches + stitching
    const px = Math.round(cx + 1.5 + hs * 0.5);
    const py = Math.round(hy - 6);
    const patch = mix(o.b, hex('#b8a47a'), 0.42);
    sh.clear().poly([px, py, px + 3.6, py, px + 3.6, py + 3.6, px, py + 3.6]).shade(pb, ramp(patch, 0.8, 1.15), { noRim: true });
    pb.set(px, py, o.dd);
    pb.set(px + 3, py, o.dd);
    pb.set(px, py + 3, o.dd);
    pb.set(px + 3, py + 3, o.dd);
  } else if (t === 4 && !rig.back) {
    // layered silk panel over the front with a sheen
    const sil = ramp(mix(o.l, hex('#ffffff'), 0.12), 0.74, 1.15);
    const w2 = rig.hipW * 0.72;
    sh.clear().poly([cx - w2 + 1, rig.waistY + 1, cx + w2 + 1, rig.waistY + 1, cx + w2 + rig.flare * 0.6 + 1 + hs, hy - 3.5, cx - w2 - rig.flare * 0.6 + 1 + hs, hy - 2]).shade(pb, sil, { seed: 14, lit: 0.04 });
    sh.line(pb, cx - w2 * 0.4, rig.waistY + 3, cx - w2 * 0.5 - 0.5 + hs, hy - 3, sil.hl);
    sh.line(pb, cx + 1, rig.waistY + 3, cx + 1 + hs, hy - 4, sil.d);
    pb.hline(cx - w2 - rig.flare * 0.6 + hs, cx + w2 + rig.flare * 0.6 + 1 + hs, hy - 3, c.c.trim.b);
    pb.hline(cx - w2 - rig.flare * 0.6 + hs, cx + w2 + rig.flare * 0.6 + 1 + hs, hy - 2.2, c.c.trim.d);
    if (c.c.pipe !== null) c.pipeLine(cx - w2 - rig.flare * 0.6 + hs, hy - 3.9, cx + w2 + rig.flare * 0.6 + 1 + hs, hy - 3.9);
  } else if (t === 5) {
    // open outer skirt panel edges in gold
    sh.line(pb, cx - 0.5, rig.waistY + 2, cx - 1.5 + hs, hy - 1, c.c.trim.b);
    sh.line(pb, cx + 0.5, rig.waistY + 2, cx + 1 + hs, hy - 1, c.c.trim.l);
  }
  hemEdge(c, cx - rig.hipW - rig.flare + hs, cx + rig.hipW + rig.flare + hs, hy, hs);
}

/** Flowing outer layers behind the legs (tier 5): drifting panels with gold edges. */
export function paintBackLayer(c: Ctx): void {
  const { rig, pb, sh, p } = c;
  if (c.spec.role === 'merchant' && !rig.seated) {
    // travelling merchant's pack on the back: cloth bundle with a rope knot, peeking out behind the shoulders
    const pk = ramp('#8d6a3c', 0.6, 1.3);
    const px = rig.cx - rig.sh - 1.2 + p.hair * 0.3 + rig.lx * 0.5;
    const py = rig.shY + 5.5;
    sh.clear().ell(px, py, 4.6, 6.4).shade(pb, pk, { seed: 31 });
    sh.line(pb, px - 3, py - 2, px + 3, py - 2.5, pk.d);
    sh.line(pb, px - 3.4, py + 1.5, px + 3.2, py + 1.2, pk.d);
    pb.set(px, py - 6, hex('#5a3a28'));
    pb.set(px + 1, py - 5.4, hex('#5a3a28'));
    pb.set(px - 1, py - 5.6, hex('#3e2a1e'));
    pb.set(px - 1.4, py - 3, pk.hl);
  }
  if (c.tier < 5 || rig.seated) return;
  const o = c.c.outfit;
  const coat = ramp(mix(o.l, hex('#f4f1ea'), 0.42), 0.76, 1.1);
  const cx = rig.cx;
  const hs = p.hem * 1.9 - 1.2;
  const hy = Math.min(55.5 + OY, rig.hemY + 3.6);
  for (const side of [-1, 1]) {
    const x0 = cx + side * (rig.hipW + 0.4);
    const x1 = cx + side * (rig.hipW + 4.4) + hs;
    sh.clear().poly([x0 - side * 1.6, rig.waistY, x0 + side * 0.4, rig.waistY, x1 + side * 1.2, hy - 4, x1 + side * 0.4 - side * 2.4 + hs * 0.2, hy, x0 - side * 4, hy - 1.4]);
    sh.shade(pb, coat, { seed: 21 + side, lit: -0.04 });
    sh.line(pb, x0, rig.waistY + 2, x1 + side * 0.5, hy - 1, coat.d);
    pb.line(x1 + side * 1.2, hy - 4, x1 + side * 0.4 - side * 2.4 + hs * 0.2, hy, c.c.trim.b);
    if (c.c.pipe !== null) c.pipeLine(x1 + side * 1.6, hy - 4, x1 + side * 0.8 - side * 2.4 + hs * 0.2, hy);
  }
  void p;
}

// ---------------------------------------------------------------------------
// torso, collar, sash
// ---------------------------------------------------------------------------

export function paintTorso(c: Ctx): void {
  const { rig, pb, sh, p } = c;
  const o = c.c.outfit;
  const t = c.tier;
  const cx = rig.cx;
  const lx = rig.lx;
  const sY = rig.shY;
  const w = rig.waistY;
  const body = c.c.armour ? STEEL : o;
  const pts = [
    cx - rig.sh + lx, sY + 1.7,
    cx - 2.4 + lx * 0.8, sY - 0.4,
    cx + 2.4 + lx * 0.8, sY - 0.4,
    cx + rig.sh + lx, sY + 1.7,
    cx + rig.sh * 0.9 + lx * 0.7, sY + 7,
    cx + rig.wa + 0.2 + lx * 0.2, w,
    cx - rig.wa - 0.2 + lx * 0.2, w,
    cx - rig.sh * 0.9 + lx * 0.7, sY + 7,
  ];
  sh.clear().poly(pts).shade(pb, body, { seed: 13, grad: 0.44 });
  // body folds
  if (!c.c.armour) {
    sh.line(pb, cx - rig.sh * 0.55 + lx * 0.6, sY + 4, cx - rig.wa * 0.6, w - 0.5, body.d);
    sh.line(pb, cx + rig.sh * 0.5 + lx * 0.6, sY + 5, cx + rig.wa * 0.55, w - 0.5, body.d);
    if (p.lean > 1.5) sh.line(pb, cx - 2, sY + 3, cx + 3, sY + 7, body.dd);
  }
  if (rig.female && !c.c.armour) {
    // subtle bust shadow line
    sh.line(pb, cx - 2.6, sY + 6.4, cx + 2.8, sY + 6.4, body.d);
  }
  const back = rig.back;
  if (c.c.armour) {
    for (let y = sY + 3; y < w - 1; y += 3) sh.line(pb, cx - rig.sh, y, cx + rig.sh, y, STEEL.dd);
    for (let x = cx - rig.sh + 2; x < cx + rig.sh; x += 3.4) sh.line(pb, x, sY + 3, x, w - 1, STEEL.d);
    if (!back) {
      pb.set(cx, sY + 3, hex('#d9b867'));
      pb.set(cx - 1, sY + 4, hex('#d9b867'));
      pb.set(cx + 1, sY + 4, hex('#d9b867'));
      pb.set(cx, sY + 5, hex('#f0d58a'));
    }
    pb.hline(cx - 2.4 + lx * 0.8, cx + 2.4 + lx * 0.8, sY - 0.2, STEEL.l);
    return;
  }
  const cut = rig.cut;
  const longCut = cut === 1 || cut === 3 || rig.longRobe;
  const trim = c.c.trim;
  const inner = c.c.inner;
  if (!back) {
    if (longCut) {
      // crossed collar: V of the inner garment, right panel over left
      sh.clear().poly([cx - 2.6 + lx * 0.8, sY - 0.4, cx + 1.2 + lx * 0.8, sY - 0.4, cx + 1.4 + lx * 0.4, sY + 2.4, cx + 0.6, sY + 4.6, cx - 0.8, sY + 2]).shade(pb, inner, { noRim: true, lit: -0.06 });
      pb.set(cx - 1 + lx * 0.6, sY, c.c.skin.d);
      pb.set(cx + lx * 0.6, sY, c.c.skin.b);
      pb.set(cx + 1 + lx * 0.6, sY, c.c.skin.d);
      // overlapping lapel lines
      const lapL = [cx - 3 + lx * 0.8, sY - 0.2, cx + 2.4, w - 0.5];
      const lapR = [cx + 3 + lx * 0.8, sY - 0.2, cx - 1.6, w - 0.5];
      pb.line(lapR[0], lapR[1], lapR[2], lapR[3], t >= 3 ? trim.b : o.dd);
      pb.line(lapR[0] - 1, lapR[1], lapR[2] - 1, lapR[3], t >= 3 ? trim.l : o.l);
      pb.line(lapL[0], lapL[1], lapL[2], lapL[3], t >= 3 ? trim.d : o.d);
      if (t >= 3 && c.c.pipe !== null) c.pipeLine(lapR[0] + 1, lapR[1], lapR[2] + 1, lapR[3]);
    } else if (cut === 2) {
      // jacket: high collar, centre seam with toggles
      pb.vline(cx + 0.5 + lx * 0.3, sY + 1, w - 1, o.dd);
      for (let y = sY + 3; y < w - 1; y += 3) {
        pb.set(cx + 1 + lx * 0.3, y, t >= 3 ? trim.b : mix(o.l, hex('#d9b867'), 0.7));
        pb.set(cx + lx * 0.3, y, o.d);
      }
      pb.hline(cx - 2.6 + lx * 0.8, cx + 2.6 + lx * 0.8, sY - 0.3, t >= 3 ? trim.l : o.l);
      pb.hline(cx - 2.6 + lx * 0.8, cx + 2.6 + lx * 0.8, sY + 0.6, t >= 3 ? trim.b : o.d);
    } else {
      // tunic: round neckline with skin
      for (let k = -2; k <= 2; k++) pb.set(cx + k + lx * 0.7, sY - 0.1 + (Math.abs(k) === 2 ? 1 : 0), k < 0 ? c.c.skin.l : k > 0 ? c.c.skin.d : c.c.skin.b);
      pb.hline(cx - 2.6 + lx * 0.7, cx + 2.6 + lx * 0.7, sY + 1, inner.b);
    }
  } else {
    // back: seam + yoke
    pb.vline(cx + lx * 0.4, sY + 2, w - 1, o.d);
    pb.hline(cx - 3 + lx * 0.7, cx + 3 + lx * 0.7, sY + 1, longCut || t >= 3 ? trim.b : o.d);
    if (t >= 3) {
      pb.set(cx - 1, sY + 5, trim.l);
      pb.set(cx + 1, sY + 6, trim.l);
      pb.set(cx, sY + 4, trim.hl);
    }
  }
  // tier decorations on the torso
  if (t === 1 && c.worn) {
    const px = Math.round(cx - rig.sh * 0.55 + lx * 0.5);
    const py = Math.round(sY + 5);
    const patch = ramp(mix(o.b, hex('#b8a47a'), 0.42), 0.8, 1.15);
    sh.clear().poly([px, py, px + 3.6, py, px + 3.6, py + 3.6, px, py + 3.6]).shade(pb, patch, { noRim: true });
    pb.set(px, py, o.dd);
    pb.set(px + 3, py, o.dd);
    pb.set(px, py + 3, o.dd);
    pb.set(px + 3, py + 3, o.dd);
  } else if (t === 2 && !back) {
    // leather strap diagonal with studs
    sh.clear().poly([cx + rig.sh * 0.5 + lx, sY, cx + rig.sh * 0.5 + 2.2 + lx, sY, cx - rig.wa + 2.5, w, cx - rig.wa, w]).shade(pb, LEATHER, { seed: 2 });
    pb.set(cx + 2.2 + lx * 0.5, sY + 3.5, FITTING[2].hl);
    pb.set(cx - 0.8, sY + 7.5, FITTING[2].hl);
    pb.set(cx - 2.8, sY + 10, FITTING[2].l);
  } else if (t === 3) {
    // cloud embroidery motifs on the chest
    if (!back) {
      for (const sx of [-1, 1]) {
        const ex = cx + sx * rig.sh * 0.5 + lx * 0.6;
        const ey = sY + 6;
        pb.set(ex, ey, trim.hl);
        pb.set(ex + 1, ey, trim.b);
        pb.set(ex - 1, ey + 1, trim.b);
        pb.set(ex, ey + 1, trim.d);
        pb.set(ex + 1, ey + 2, trim.b);
        pb.set(ex + 2, ey + 1, trim.hl);
      }
    }
  } else if (t === 5 && !back) {
    // gold edges and fine ornaments
    for (let i = 0; i < 3; i++) pb.set(cx - 1 + i * 2 + lx * 0.5, sY + 5 + (i % 2) * 2, trim.hl);
  }
  // collar piping + shimmer
  if (c.c.pipe !== null) c.pipeLine(cx - 2.8 + lx * 0.8, sY - 0.4, cx + 2.8 + lx * 0.8, sY - 0.4);
  if (c.c.pipeRar === 1 || (t >= 3 && !c.c.pipe && c.g.oR === 1)) pb.set(cx + 2 + lx * 0.7, sY, trim.hl);
}

export function paintSash(c: Ctx): void {
  const { rig, pb, sh, p } = c;
  const s = c.c.sash;
  const t = c.tier;
  const cx = rig.cx;
  const w = rig.waistY;
  const hs = p.sash;
  const back = rig.back;
  const bandH = t === 1 && c.worn ? 2 : t === 1 || t === 2 ? 3 : t === 3 ? 4 : t === 4 ? 5 : 4;
  const y0 = w - bandH / 2 - 0.4;
  const half = rig.wa + 0.9;
  if (t === 1 && c.worn) {
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      pb.set(x, y0, x % 2 ? s.l : s.b);
      pb.set(x, y0 + 1, x % 2 ? s.d : s.dd);
    }
  } else {
    sh.clear().poly([cx - half, y0, cx + half, y0, cx + half - 0.3, y0 + bandH, cx - half + 0.3, y0 + bandH]).shade(pb, t === 5 ? ramp('#e6c04e', 0.66, 1.3) : s, { seed: 15, grad: 0.4 });
    if (t >= 3) {
      pb.hline(cx - half, cx + half, y0, c.c.trim.b);
      pb.hline(cx - half + 0.3, cx + half - 0.3, y0 + bandH - 0.5, c.c.trim.d);
    }
    if (t === 2 && !back) {
      // buckle
      pb.rect(cx - 1.5, y0, 3, bandH, FITTING[2].b);
      pb.rect(cx - 0.5, y0 + 1, 1, bandH - 2, FITTING[2].dd);
      pb.set(cx - 1.5, y0, FITTING[2].hl);
    }
    if (t === 4) {
      for (let k = -2; k <= 2; k++) {
        pb.rect(cx + k * 2.4 - 0.6, y0 + 1, 1.6, bandH - 2, FITTING[4].b);
        pb.set(cx + k * 2.4 - 0.6, y0 + 1, FITTING[4].hl);
      }
    }
    if (t === 5 && !back) {
      sh.clear().ell(cx + 0.3, y0 + bandH / 2, 2.4, 2.4).shade(pb, JADE, { seed: 3 });
      pb.set(cx - 0.4, y0 + bandH / 2 - 0.8, JADE.hl);
    }
  }
  if (c.c.pipe !== null && t >= 3) c.pipeLine(cx - half + 1, y0 - 0.6, cx + half - 1, y0 - 0.6);
  // knot and tails
  const kx = back ? cx - 1 : cx + rig.wa - 0.6;
  const ky = y0 + bandH / 2;
  sh.clear().ell(kx, ky, 1.8, 1.7).shade(pb, s, { seed: 8, noRim: true });
  const tl = t >= 4 ? 11 : t >= 2 ? 9 : 7;
  for (const tail of [0, 1]) {
    const dir = tail ? 1 : -0.4;
    const x0 = kx + (tail ? 0.8 : -0.6);
    const x1 = x0 + dir * 2 + hs * 0.9;
    sh.clear().poly([x0 - 1.1, ky + 1, x0 + 1.1, ky + 1, x1 + 1.5, ky + tl, x1 - 0.9, ky + tl - 0.6]).shade(pb, s, { seed: 20 + tail, noRim: true });
    pb.set(x1 + 0.3, ky + tl - 0.2, t >= 4 ? FITTING[4].b : s.dd);
    if (t >= 3) pb.hline(x1 - 0.8, x1 + 1.4, ky + tl - 0.4, c.c.trim.b);
  }
}

// ---------------------------------------------------------------------------
// shoulder pieces
// ---------------------------------------------------------------------------

export function paintShoulders(c: Ctx): void {
  const { rig, pb, sh } = c;
  const t = c.tier;
  const o = c.c.outfit;
  if (c.c.armour) {
    for (const x of [rig.shLx - 0.6, rig.shRx + 0.6]) {
      sh.clear().ell(x, rig.shY + 1.8, 3.6, 2.9).shade(pb, STEEL, { seed: 7 });
      pb.hline(x - 3, x + 3, rig.shY + 2.2, STEEL.dd);
      pb.set(x - 1, rig.shY + 0.8, STEEL.hl);
    }
    return;
  }
  if (t === 2) {
    sh.clear().ell(rig.shRx + 0.4, rig.shY + 1.6, 3, 2.3).shade(pb, LEATHER, { seed: 4 });
    pb.set(rig.shRx + 0.4, rig.shY + 1.2, FITTING[2].hl);
  } else if (t === 4) {
    const plate = ramp('#3b3f50', 0.6, 1.6);
    for (const x of [rig.shLx - 0.4, rig.shRx + 0.4]) {
      sh.clear().ell(x, rig.shY + 1.6, 3.7, 2.9).shade(pb, plate, { seed: 6 });
      pb.hline(x - 3, x + 3, rig.shY + 3.2, c.c.trim.b);
      pb.set(x - 1, rig.shY + 0.7, plate.hl);
      pb.set(x, rig.shY + 2.2, c.c.trim.hl);
      if (c.c.pipe !== null) c.pipeLine(x - 3, rig.shY + 0.2, x + 3, rig.shY + 0.2);
    }
  } else if (t === 5) {
    // mantle across the shoulders with scalloped hem and a jade clasp
    const cx = rig.cx;
    const man = ramp(mix(o.l, hex('#f6f2ea'), 0.45), 0.78, 1.08);
    const y = rig.shY;
    sh.clear().poly([cx - 2.8 + rig.lx * 0.8, y - 0.6, cx + 2.8 + rig.lx * 0.8, y - 0.6, cx + rig.sh + 2.8 + rig.lx, y + 2.6, cx + rig.sh + 1 + rig.lx, y + 6.4, cx + 3 + rig.lx * 0.5, y + 4.6, cx - 3 + rig.lx * 0.5, y + 4.6, cx - rig.sh - 1 + rig.lx, y + 6.4, cx - rig.sh - 2.8 + rig.lx, y + 2.6]);
    sh.shade(pb, man, { seed: 9, grad: 0.4 });
    for (let k = -3; k <= 3; k++) {
      pb.set(cx + k * 3 + rig.lx * 0.6, y + 5.3 + Math.abs(k) * 0.3, c.c.trim.b);
      pb.set(cx + k * 3 + 1 + rig.lx * 0.6, y + 5.3 + Math.abs(k) * 0.3, c.c.trim.l);
    }
    pb.hline(cx - rig.sh - 2.5 + rig.lx, cx - 3 + rig.lx * 0.5, y + 4.8, c.c.trim.d);
    pb.hline(cx + 3 + rig.lx * 0.5, cx + rig.sh + 2.5 + rig.lx, y + 4.8, c.c.trim.d);
    if (!rig.back) {
      sh.clear().ell(cx + rig.lx * 0.7, y + 1.6, 1.6, 1.6).shade(pb, JADE, { seed: 2 });
      pb.set(cx - 0.4 + rig.lx * 0.7, y + 1.1, JADE.hl);
    }
    if (c.c.pipe !== null) c.pipeLine(cx - rig.sh - 2.4 + rig.lx, y + 3.2, cx - 3 + rig.lx * 0.5, y + 5.2);
  }
}

// ---------------------------------------------------------------------------
// arms
// ---------------------------------------------------------------------------

export interface ArmGeom {
  sx: number;
  sy: number;
  jx: number;
  jy: number;
  ex: number;
  ey: number;
}

/** Paint an arm to the hand target (absolute px). `hand` is painted unless `skipHand`. */
export function paintArm(c: Ctx, near: boolean, tx: number, ty: number, skipHand = false): ArmGeom {
  const { rig, pb, sh, spec } = c;
  const sx = near ? rig.shRx : rig.shLx;
  const sy = near ? rig.shRy : rig.shLy;
  const wpn = spec.weapon;
  const fist = wpn === 'fist' && c.p.fists;
  const fg = fist ? fistGear(c.g.wT || 1) : null;
  ik2(sx, sy, tx, ty, 6.5, 6.7, near ? -1 : 1, TMP);
  const [jx, jy, ex, ey] = TMP;
  const t = c.tier;
  const wide = rig.cut === 1 || rig.cut === 3 || rig.longRobe;
  const jacketFit = rig.cut === 2;
  const armour = c.c.armour;
  const sleeve: Ramp = armour ? LEATHER : c.c.outfit;
  const r0 = (rig.female ? 2.25 : 2.55) + (rig.brute ? 0.6 : 0);
  const skin = c.c.skin;
  // upper arm
  sh.clear().cap(sx, sy, jx, jy, r0, r0 - 0.35).shade(pb, sleeve, { seed: near ? 3 : 4, lit: near ? 0 : -0.07, grad: 0.4 });
  // sleeve seam / trim ring at the elbow for fancier outfits
  if (t >= 3 && !armour && rig.cut !== 0) {
    const mx = (sx + jx) / 2;
    const my = (sy + jy) / 2;
    pb.set(mx, my, c.c.trim.b);
    pb.set(mx + 1, my, c.c.trim.d);
  }
  // forearm
  if (fg) {
    sh.clear().cap(jx, jy, ex, ey, 2.15, 1.85).shade(pb, fg.fore, { seed: 6, grad: 0.4 });
    if (fg.stud) {
      const mx = (jx + ex) / 2;
      const my = (jy + ey) / 2;
      pb.set(mx, my, fg.stud.hl);
    }
  } else if (wide) {
    sh.clear().cap(jx, jy, ex, ey, 2.3, 3.0).shade(pb, sleeve, { seed: 7, lit: near ? 0 : -0.07, grad: 0.4 });
    // hanging cuff
    const hang = t === 5 ? 7 : 4.8;
    const hs = c.p.sash * 0.35;
    sh.clear().poly([ex - 3.4, ey - 1.2, ex + 3.4, ey - 1.2, ex + 2.8 + hs, ey + hang, ex - 2.4 + hs, ey + hang + 0.8]).shade(pb, sleeve, { seed: 8, lit: -0.04 });
    const tr = c.c.trim;
    pb.line(ex - 3.4, ey - 1, ex + 3.4, ey - 1, t >= 3 ? tr.b : sleeve.dd);
    if (t >= 3) {
      pb.line(ex - 3, ey - 0.2, ex + 3, ey - 0.2, tr.d);
      pb.line(ex - 2.4 + hs, ey + hang + 0.4, ex + 2.8 + hs, ey + hang - 0.2, tr.b);
      if (c.c.pipe !== null) c.pipeLine(ex - 3.4, ey - 1.8, ex + 3.4, ey - 1.8);
    }
    if (t === 4) pb.line(ex - 3.4, ey + 0.6, ex + 3.4, ey + 0.6, FITTING[4].b);
  } else if (rig.cut === 0 && !armour) {
    // short tunic sleeve to the elbow, bare forearm with cloth wraps
    sh.clear().cap(jx, jy, ex, ey, 2.0, 1.7).shade(pb, skin, { seed: 9, lit: near ? 0 : -0.1, grad: 0.4 });
    sh.clear().cap(jx - (jx - sx) * 0.05, jy, jx + (ex - jx) * 0.18, jy + (ey - jy) * 0.18, 2.6, 2.4).shade(pb, sleeve, { seed: 10, noRim: true });
    if (t <= 2) for (let k = 0; k < 2; k++) pb.set(jx + (ex - jx) * (0.55 + k * 0.22), jy + (ey - jy) * (0.55 + k * 0.22), mix(skin.b, hex('#e8e0c8'), 0.7));
  } else {
    // fitted long sleeve (+ leather bracer from tier 2)
    sh.clear().cap(jx, jy, ex, ey, 2.15, 1.85).shade(pb, sleeve, { seed: 11, lit: near ? 0 : -0.07, grad: 0.4 });
    if (t >= 2 || armour) {
      const bx0 = jx + (ex - jx) * 0.45;
      const by0 = jy + (ey - jy) * 0.45;
      sh.clear().cap(bx0, by0, ex, ey, 2.2, 2.0).shade(pb, armour ? STEEL : t >= 4 ? ramp('#3b3f50', 0.6, 1.6) : LEATHER, { seed: 12, grad: 0.4 });
      pb.set(bx0 + 0.5, by0, FITTING[Math.max(2, t)].hl);
    }
  }
  if (!skipHand) paintHand(c, near, ex, ey, fg);
  if (near) c.handR = [ex, ey];
  else c.handL = [ex, ey];
  return { sx, sy, jx, jy, ex, ey };
}

export function paintHand(c: Ctx, near: boolean, ex: number, ey: number, fg: ReturnType<typeof fistGear> | null): void {
  const { pb, sh } = c;
  const skin = fg ? fg.hand : c.c.skin;
  const hollow = c.hollow;
  sh.clear().ell(ex + 0.4, ey + 0.2, fg ? 2.2 : 2.0, fg ? 2.3 : 2.2).shade(pb, skin, { seed: 5, lit: near ? 0 : -0.1, noRim: false });
  // knuckles / thumb
  if (fg) {
    if (fg.stud) for (let k = 0; k < 3; k++) pb.set(ex + 1.6, ey - 1 + k, fg.stud.hl);
    if (fg.cloth) {
      pb.hline(ex - 1.6, ex + 2.2, ey - 0.4, hex('#d8d0bc'));
      pb.hline(ex - 1.6, ex + 2.2, ey + 0.8, hex('#cfc7b0'));
    }
  } else {
    pb.set(ex + 1.4, ey - 0.8, skin.hl);
    pb.set(ex - 0.2, ey + 1.6, skin.dd);
    if (hollow) pb.set(ex + 1.4, ey + 1.4, rgba(150, 70, 220));
  }
}

export function chestPoint(c: Ctx): [number, number] {
  return [c.rig.cx + c.rig.lx * 0.7, c.rig.shY + 6];
}

export { CHAR_W, rarityCol };
export type { Col };
