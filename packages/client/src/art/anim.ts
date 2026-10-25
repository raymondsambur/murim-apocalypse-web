/**
 * Character animation: states, frame counts / timings and the procedural pose generators (idle breathing, 8 frame walk
 * with contact and passing poses, run, weapon draw, per weapon attack variants with wind-up and follow-through, hit /
 * block / dodge / die, meditation, work, craft and the ambient NPC gestures). A pose is a bag of joint targets that
 * `character.ts` turns into pixels (two-bone IK for arms and legs). Pure and deterministic.
 */
import type { WeaponType } from '@murim/shared';

export type CharState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'draw'
  | 'fight'
  | 'attack'
  | 'hit'
  | 'block'
  | 'dodge'
  | 'die'
  | 'dead'
  | 'meditate'
  | 'work'
  | 'craft'
  | 'cheer'
  | 'loot'
  | 'stretch'
  | 'sweep'
  | 'chat'
  | 'fan'
  | 'wipe'
  | 'form'
  | 'eat'
  | 'pray'
  | 'rest'
  | 'trade'
  | 'shelter'
  | 'mourn';

export type ToolKind = 'hammer' | 'hoe' | 'pick' | 'sickle' | 'herb' | 'broom' | 'cloth' | 'fan' | 'ladle' | 'chop' | 'bowl' | 'abacus';

export const FRAME_COUNTS: Record<CharState, number> = {
  idle: 8,
  walk: 8,
  run: 6,
  draw: 3,
  fight: 4,
  attack: 6,
  hit: 3,
  block: 3,
  dodge: 4,
  die: 6,
  dead: 1,
  meditate: 4,
  work: 6,
  craft: 6,
  cheer: 4,
  loot: 4,
  stretch: 6,
  sweep: 6,
  chat: 6,
  fan: 4,
  wipe: 6,
  form: 8,
  eat: 6,
  pray: 4,
  rest: 4,
  trade: 6,
  shelter: 4,
  mourn: 6,
};

/** Milliseconds per frame for time-driven loops (walk / run follow the step time instead). */
export const FRAME_MS: Record<CharState, number> = {
  idle: 330,
  walk: 105,
  run: 80,
  draw: 90,
  fight: 220,
  attack: 90,
  hit: 100,
  block: 110,
  dodge: 90,
  die: 130,
  dead: 1000,
  meditate: 800,
  work: 150,
  craft: 220,
  cheer: 170,
  loot: 150,
  stretch: 330,
  sweep: 190,
  chat: 260,
  fan: 200,
  wipe: 210,
  form: 340,
  eat: 260,
  pray: 700,
  rest: 900,
  trade: 280,
  shelter: 140,
  mourn: 520,
};

/** States whose pose reads the wind level (others are keyed with wind 0 so the sprite cache stays small). */
export const WIND_STATES: ReadonlySet<CharState> = new Set<CharState>(['idle', 'fight', 'meditate', 'chat', 'fan', 'stretch', 'pray', 'rest', 'mourn']);

export const ATTACK_VARIANTS: Record<WeaponType | 'none', number> = { sword: 4, blade: 3, spear: 3, staff: 3, fist: 4, none: 2 };

export interface Pose {
  /** Downward body offset (px) and sideways shift. */
  bob: number;
  dx: number;
  /** Forward lean of the upper body (px at the head). */
  lean: number;
  /** Hips lowered (px). */
  crouch: number;
  /** Head: vertical offset, turn -1..1, tilt px, eyes closed. */
  hdy: number;
  turn: number;
  tilt: number;
  blink: boolean;
  talk: boolean;
  /** Foot x offsets (forward +) and lifts (px). */
  flx: number;
  fly: number;
  frx: number;
  fry: number;
  /** Hand targets: x relative to the figure centre, y absolute. */
  lhx: number;
  lhy: number;
  rhx: number;
  rhy: number;
  /** Weapon axis angle (deg, 0 = +x, 90 = down). */
  wAng: number;
  /** 0 = in hand, 1 = sheathed at the hip, 2 = being drawn (blade partly out). */
  sheath: number;
  bladeFrac: number;
  /** Off hand holds the shaft (spear / staff). */
  twoHand: boolean;
  /** Smear: angles and strength; kind 0 arc, 1 streak. */
  /** Previous-frame hand (x relative, y absolute) and weapon angle for the smear sweep. */
  pvx: number;
  pvy: number;
  sm0: number;
  sm1: number;
  smK: number;
  smKind: 0 | 1;
  seated: boolean;
  prone: boolean;
  /** Rotation of the whole figure (deg) for the fall. */
  rot: number;
  /** Cloth offsets: direct x shift in px (negative = trailing backwards): hem, sash tails, hair. */
  hem: number;
  sash: number;
  hair: number;
  /** Hold a tool in the right hand, and a prop (bowl, abacus) in the left. */
  tool: ToolKind | null;
  toolL: ToolKind | null;
  /** Fists clenched as weapon (gauntlets). */
  fists: boolean;
}

export function basePose(): Pose {
  return {
    bob: 0,
    dx: 0,
    lean: 0,
    crouch: 0,
    hdy: 0,
    turn: 0,
    tilt: 0,
    blink: false,
    talk: false,
    flx: 0,
    fly: 0,
    frx: 0,
    fry: 0,
    lhx: -6.5,
    lhy: 37.6,
    rhx: 6.7,
    rhy: 37.6,
    wAng: 85,
    sheath: 0,
    bladeFrac: 1,
    twoHand: false,
    pvx: 0,
    pvy: 0,
    sm0: 0,
    sm1: 0,
    smK: 0,
    smKind: 0,
    seated: false,
    prone: false,
    rot: 0,
    hem: 0,
    sash: 0,
    hair: 0,
    tool: null,
    toolL: null,
    fists: false,
  };
}

export interface PoseInput {
  state: CharState;
  frame: number;
  weapon: WeaponType | null;
  variant: number;
  /** 0 calm, 1 breezy, 2 storm. */
  wind: number;
  /** Idle head look -1/0/1 and tilt -1/0/1 and blink (fidgets chosen by the render driver). */
  look: number;
  tilt: number;
  blink: boolean;
  tool: ToolKind | null;
  /** Hunched / shambling (Blight creatures). */
  hunch: boolean;
  /** Guard posture (stiff, upright). */
  stiff: boolean;
}

const TAU = Math.PI * 2;

function legCycle(p: number, S: number, H: number, stance: number): [number, number] {
  p -= Math.floor(p);
  if (p < stance) {
    const q = p / stance;
    return [S * (1 - 2 * q), 0];
  }
  const q = (p - stance) / (1 - stance);
  const e = q * q * (3 - 2 * q);
  return [-S + 2 * S * e, H * Math.sin(Math.PI * q)];
}

/** [rhx, rhy, ang, lhx, lhy, lean, crouch, fwd] per frame. */
type AF = [number, number, number, number, number, number, number, number];

const SLASH: AF[] = [
  [9, 22, -105, -8, 33, -1.5, 0, -0.5],
  [7, 16, -128, -9, 31, -2.5, 0.5, -1],
  [15, 22, -35, -7, 31, 1.5, 0.5, 1],
  [18, 31, 35, -6, 30, 3, 1.5, 2],
  [15, 35, 65, -6, 31, 3, 1.5, 2],
  [11, 30, 15, -7, 32, 1, 0.5, 0.5],
];
const THRUST: AF[] = [
  [9, 30, -15, -7, 33, -1, 0, 0],
  [3, 31, 0, -8, 32, -2.5, 1.5, -1.5],
  [12, 30, 3, -7, 31, 1, 1, 1],
  [20, 30, 2, -7, 30, 3, 1, 3],
  [19, 30, 2, -7, 30, 3, 1, 3],
  [12, 31, -10, -7, 32, 1, 0.5, 1],
];
const OVERHEAD: AF[] = [
  [8, 20, -95, -8, 31, -1, 0, 0],
  [6, 11, -100, -7, 24, -2.5, 0, -0.5],
  [10, 13, -65, -7, 28, 0, 0.5, 1],
  [16, 28, 15, -7, 31, 3.5, 2, 2.5],
  [17, 35, 70, -7, 32, 4, 2.5, 3],
  [12, 31, 30, -7, 32, 1.5, 1, 1],
];
const SPIN: AF[] = [
  [6, 28, 145, -7, 31, -2, 1, -1],
  [0, 27, 190, -9, 30, -3, 1.5, -1.5],
  [9, 28, 105, -7, 30, 0, 1.5, 0],
  [17, 29, 25, -6, 30, 2.5, 1.5, 2],
  [20, 27, -12, -6, 31, 3, 1.5, 2.5],
  [12, 28, 15, -7, 32, 1, 0.5, 1],
];
const SWEEP: AF[] = [
  [5, 33, 160, -2, 30, -2, 1.5, -1],
  [1, 35, 175, -4, 31, -3, 2.5, -1.5],
  [10, 34, 120, 3, 31, 0, 2.5, 0],
  [17, 33, 50, 9, 31, 2.5, 2, 2],
  [21, 31, 15, 12, 31, 3, 2, 2.5],
  [13, 31, -20, 6, 30, 1, 1, 1],
];
const PUNCH: AF[] = [
  [8, 28, 0, 1, 27, -1, 0.5, -0.5],
  [6, 29, 0, 14, 27, 1, 0.5, 0.5],
  [7, 29, 0, 4, 28, 0, 0.5, 0],
  [20, 28, 0, -1, 29, 3, 0.5, 2.5],
  [21, 28, 0, -2, 29, 3.5, 0.5, 2.5],
  [10, 29, 0, 1, 28, 1, 0.5, 1],
];
const PALM: AF[] = [
  [8, 29, 0, -2, 29, -1, 1, 0],
  [5, 28, 0, 0, 28, -2, 1.5, -1],
  [14, 27, 0, 10, 27, 1.5, 1.5, 1],
  [21, 26, 0, 17, 26, 3.5, 1.5, 3],
  [21, 26, 0, 17, 26, 3.5, 1.5, 3],
  [11, 28, 0, 6, 28, 1, 1, 1],
];
const UPPER: AF[] = [
  [7, 32, 0, 0, 28, 0, 1, 0],
  [6, 36, 0, 0, 27, -1, 2.5, -1],
  [12, 30, 0, -1, 28, 1.5, 1.5, 1],
  [16, 18, 0, -3, 30, 3, 0, 2],
  [15, 15, 0, -3, 30, 3, 0, 2],
  [10, 29, 0, -1, 29, 1, 0.5, 0.5],
];
const BACKFIST: AF[] = [
  [6, 28, 0, -2, 28, -2, 0.5, -1],
  [-2, 27, 0, -4, 28, -3, 1, -1.5],
  [8, 26, 0, -3, 29, 0, 1, 0],
  [19, 25, 0, -3, 29, 2.5, 1, 2],
  [21, 27, 0, -3, 29, 3, 1, 2.5],
  [11, 29, 0, -2, 29, 1, 0.5, 1],
];

type Shape = { t: AF[]; strike: number[]; streak?: boolean };

function attackShape(weapon: WeaponType | null, v: number): Shape {
  switch (weapon) {
    case 'sword':
      return [{ t: SLASH, strike: [2, 3, 4] }, { t: THRUST, strike: [2, 3], streak: true }, { t: OVERHEAD, strike: [2, 3, 4] }, { t: SPIN, strike: [2, 3, 4] }][v % 4];
    case 'blade':
      return [{ t: SLASH, strike: [2, 3, 4] }, { t: OVERHEAD, strike: [2, 3, 4] }, { t: SPIN, strike: [2, 3, 4] }][v % 3];
    case 'spear':
      return [{ t: THRUST, strike: [2, 3], streak: true }, { t: SWEEP, strike: [2, 3, 4] }, { t: OVERHEAD, strike: [2, 3, 4] }][v % 3];
    case 'staff':
      return [{ t: OVERHEAD, strike: [2, 3, 4] }, { t: SWEEP, strike: [2, 3, 4] }, { t: THRUST, strike: [2, 3], streak: true }][v % 3];
    case 'fist':
      return [{ t: PUNCH, strike: [3, 4], streak: true }, { t: PALM, strike: [3, 4], streak: true }, { t: UPPER, strike: [3, 4], streak: true }, { t: BACKFIST, strike: [3, 4] }][v % 4];
    default:
      return [{ t: PUNCH, strike: [3, 4], streak: true }, { t: PALM, strike: [3, 4], streak: true }][v % 2];
  }
}

/** Frames of the attack shape that carry a smear (exported for tests). */
export function attackStrikeFrames(weapon: WeaponType | null, v: number): number[] {
  return attackShape(weapon, v).strike;
}

function setHandsFromAF(p: Pose, a: AF, weapon: WeaponType | null): void {
  p.rhx = a[0];
  p.rhy = a[1];
  p.wAng = a[2];
  p.lhx = a[3];
  p.lhy = a[4];
  p.lean = a[5];
  p.crouch = a[6];
  p.dx = a[7];
  p.twoHand = weapon === 'spear' || weapon === 'staff';
  p.fists = weapon === 'fist' || weapon === null;
  p.sheath = 0;
  if (p.twoHand) {
    // left hand slides along the shaft behind the right hand
    const ar = (a[2] * Math.PI) / 180;
    p.lhx = a[0] - Math.cos(ar) * 8;
    p.lhy = a[1] - Math.sin(ar) * 8;
    if (weapon === 'staff') {
      p.lhx = a[0] - Math.cos(ar) * 10;
      p.lhy = a[1] - Math.sin(ar) * 10;
    }
  }
}

function raw(inp: PoseInput, f: number): Pose {
  const p = basePose();
  const wpn = inp.weapon;
  const n = FRAME_COUNTS[inp.state];
  f = ((f % n) + n) % n;
  const u = f / n;
  p.blink = inp.blink;
  p.tilt = inp.tilt;
  p.turn = inp.look;
  const carried = wpn === 'spear' || wpn === 'staff';
  const hip = wpn === 'sword' || wpn === 'blade';
  const restWeapon = (): void => {
    if (hip) p.sheath = 1;
    if (carried) {
      p.wAng = -90;
      p.rhx = 8.8;
      p.rhy = 35 + p.bob * 0.4;
      p.twoHand = false;
    }
    p.fists = wpn === 'fist';
  };
  switch (inp.state) {
    case 'idle': {
      const B = [0, 0, -1, -1, -1, 0, 0, 0][f];
      p.bob = B;
      p.dx = [0, 0, 0.5, 0.5, 0.5, 0, -0.5, -0.5][f];
      p.lhy = 37.6 + B * 0.6;
      p.rhy = 37.6 + B * 0.6;
      p.lhx = -6.5 - p.dx * 0.5;
      p.rhx = 6.7 - p.dx * 0.5;
      if (inp.hunch) {
        p.lean += 1.5;
        p.hdy += 1;
        p.lhy += 1;
        p.rhy += 1.5;
        p.crouch += 0.5;
      }
      if (inp.stiff) p.lean -= 0.4;
      restWeapon();
      const amp = [0.4, 1, 1.9][inp.wind] ?? 0.4;
      p.hem = amp * (Math.sin(TAU * u) * 0.8 - 0.35);
      p.sash = amp * (Math.sin(TAU * u + 0.9) * 1.1 - 0.4);
      p.hair = amp * (Math.sin(TAU * u + 1.7) * 0.9 - 0.3);
      break;
    }
    case 'walk':
    case 'run': {
      const run = inp.state === 'run';
      const ph = u;
      const S = run ? 7.2 : 5.2;
      const H = run ? 7.2 : 4;
      const st = run ? 0.38 : 0.5;
      const [rx, rl] = legCycle(ph, S, H, st);
      const [lx, ll] = legCycle(ph + 0.5, S, H, st);
      p.frx = rx;
      p.fry = rl;
      p.flx = lx;
      p.fly = ll;
      const cyc = run ? 2 : 2;
      p.bob = run ? 1.6 * (0.5 + 0.5 * Math.cos(TAU * ph * cyc)) - 1.1 : 1.1 * (0.5 + 0.5 * Math.cos(TAU * ph * cyc));
      p.lean = run ? 3 : 0.9;
      p.crouch = run ? 0.8 : 0;
      p.dx = 0;
      const A = run ? 4.6 : 3.6;
      // arms swing opposite to the leg on the same side
      p.rhx = 6.8 - (rx / S) * A * (run ? 0.9 : 1);
      p.lhx = -6.6 - (lx / S) * A * (run ? 0.9 : 1);
      const rUp = Math.max(0, -rx / S);
      const lUp = Math.max(0, -lx / S);
      p.rhy = (run ? 31 : 37.4) - (run ? 2.5 : 1.8) * (1 - rUp) + p.bob * 0.3;
      p.lhy = (run ? 31 : 37.4) - (run ? 2.5 : 1.8) * (1 - lUp) + p.bob * 0.3;
      if (run) {
        p.rhx = 10 + 4.8 * Math.sin(TAU * ph);
        p.lhx = -9 - 4.8 * Math.sin(TAU * ph);
        p.rhy = 31 - 2.5 * Math.cos(TAU * ph);
        p.lhy = 31 + 2.5 * Math.cos(TAU * ph);
      }
      if (inp.hunch) {
        p.lean += 1.5;
        p.hdy += 1;
      }
      restWeapon();
      if (hip && run) p.sheath = 1;
      // trailing cloth: follows the leg cycle one frame late
      const lag = ph - 1 / n;
      p.hem = -1.2 - (run ? 1.6 : 0) + (run ? 1.6 : 1.1) * Math.sin(TAU * lag * 2);
      p.sash = -1.5 - (run ? 2 : 0.4) + 1.2 * Math.sin(TAU * lag * 2 + 0.5);
      p.hair = -1.2 - (run ? 2 : 0.5) + 1.1 * Math.sin(TAU * lag * 2 + 1.1);
      break;
    }
    case 'draw': {
      p.crouch = 0.5;
      p.flx = -1.5;
      p.frx = 2;
      if (hip) {
        const T: [number, number, number, number, number, number][] = [
          [-2.6, 33, 108, 0.35, 1, -0.5],
          [7, 26, -70, 1, 0, 0.5],
          [12, 25, -50, 1, 0, 0],
        ];
        const [x, y, a, bf, sh, ln] = T[f];
        p.rhx = x;
        p.rhy = y;
        p.wAng = a;
        p.bladeFrac = bf;
        p.sheath = sh === 1 && f === 0 ? 2 : 0;
        p.lean = ln;
        p.lhx = -8 + f;
        p.lhy = 32;
      } else if (carried) {
        p.wAng = [-90, -55, -30][f];
        p.rhx = [8.8, 10, 11][f];
        p.rhy = [35, 31, 29][f];
        p.twoHand = f > 0;
        p.lhx = 3;
        p.lhy = 30;
        if (f === 2) setStance(p, wpn, f);
      } else {
        p.fists = true;
        p.rhx = [7.6, 9, 10][f];
        p.rhy = [34, 30, 26][f];
        p.lhx = [-7, -4, 3][f];
        p.lhy = [34, 30, 27][f];
      }
      break;
    }
    case 'fight': {
      const k = f % 4;
      p.bob = k === 1 || k === 2 ? -1 : 0;
      p.crouch = 1;
      p.flx = -2.4;
      p.frx = 3;
      p.lean = 0.8 + (k === 2 ? 0.4 : 0);
      p.dx = [0, 0.3, 0.6, 0.3][k];
      setStance(p, wpn, k);
      p.hem = 0.6 * Math.sin(TAU * u) - 0.3;
      p.sash = 0.9 * Math.sin(TAU * u + 1) - 0.4;
      p.hair = 0.8 * Math.sin(TAU * u + 1.6) - 0.3;
      if (inp.hunch) {
        p.lean += 1;
        p.hdy += 1;
      }
      break;
    }
    case 'attack': {
      const sh = attackShape(wpn, inp.variant);
      const a = sh.t[f];
      setHandsFromAF(p, a, wpn);
      p.flx = -1.8 + a[7] * 0.5;
      p.frx = 3 + a[7] * 0.8;
      p.crouch += 0.4;
      if (sh.strike.includes(f)) {
        const prev = sh.t[Math.max(0, f - 1)];
        p.pvx = prev[0];
        p.pvy = prev[1];
        p.sm0 = prev[2];
        p.sm1 = a[2];
        p.smKind = sh.streak ? 1 : 0;
        p.smK = f === sh.strike[0] ? 0.75 : f === sh.strike[1] ? 1 : 0.55;
      }
      p.bob = f === 3 ? 0.5 : 0;
      const prevA = sh.t[Math.max(0, f - 1)];
      p.hem = -(a[5] - prevA[5]) * 0.9 - 0.4;
      p.sash = -(a[5] - prevA[5]) * 1.2 - 0.6;
      p.hair = -(a[5] - prevA[5]) * 1.3 - 0.6;
      if (inp.hunch) {
        p.lean += 1;
        p.hdy += 1;
      }
      break;
    }
    case 'hit': {
      const T: [number, number, number, number][] = [
        [-3, 1, -1.5, 1],
        [-4.2, 0.5, -2.2, 2],
        [-1.5, 0, -0.8, 0],
      ];
      const [ln, cr, dx, hd] = T[f];
      p.lean = ln;
      p.crouch = cr;
      p.dx = dx;
      p.hdy = hd;
      p.blink = f < 2;
      p.rhx = 3 + f * 2;
      p.rhy = 31 + f;
      p.lhx = -11 + f;
      p.lhy = 31 + f;
      p.flx = -1.5;
      p.frx = 2;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -70;
        p.rhx = 5 + f * 2;
        p.rhy = 31;
        p.twoHand = false;
      }
      p.fists = wpn === 'fist';
      p.hem = 1.4 - f * 0.5;
      p.sash = 1.8 - f * 0.6;
      p.hair = 2 - f * 0.7;
      break;
    }
    case 'block': {
      const T: [number, number, number, number][] = [
        [9, 26, -60, 0],
        [10, 23, -80, 1],
        [10, 23, -80, 1],
      ];
      const [x, y, a, c] = T[f];
      p.lean = -0.8;
      p.crouch = c + 0.5;
      p.flx = -2;
      p.frx = 2.6;
      p.dx = -0.5;
      p.rhx = x;
      p.rhy = y;
      p.lhx = 3;
      p.lhy = y + 2;
      p.wAng = wpn === 'spear' || wpn === 'staff' ? -8 : a;
      p.twoHand = carried;
      if (carried) {
        p.lhx = x - 9;
        p.lhy = y + 1;
      }
      if (wpn === 'fist' || wpn === null) {
        p.fists = true;
        p.rhx = 9;
        p.rhy = 22;
        p.lhx = 3;
        p.lhy = 23;
      }
      break;
    }
    case 'dodge': {
      const T: [number, number, number, number][] = [
        [-2, 1, 0, 0],
        [-3.2, 1.5, -3, 0.5],
        [-3.6, 1, -4.2, 0],
        [-2, 0.5, -2.2, 0],
      ];
      const [ln, cr, dx, lift] = T[f];
      p.lean = ln;
      p.crouch = cr;
      p.dx = dx;
      p.flx = -3;
      p.frx = 3 - dx * 0.4;
      p.fly = lift * 3;
      p.rhx = 9 + f;
      p.rhy = 30;
      p.lhx = -9;
      p.lhy = 31;
      setStance(p, wpn, 0);
      p.rhx += dx * 0.5;
      p.lhx += dx * 0.5;
      p.hem = 1.6;
      p.sash = 2;
      p.hair = 2.2;
      break;
    }
    case 'die': {
      const T: [number, number, number, number, number][] = [
        [-4, 1, -2, 2, 0],
        [-5, 3.5, -3, 3, 0],
        [-5.5, 7, -3.5, 3, 0],
        [-5.5, 7, -3.5, 3, -35],
        [-5.5, 7, -3.5, 3, -72],
        [0, 0, 0, 0, -90],
      ];
      const [ln, cr, dx, hd, rot] = T[f];
      p.lean = ln;
      p.crouch = cr;
      p.dx = dx;
      p.hdy = hd;
      p.rot = rot;
      p.blink = true;
      p.rhx = 5 - f;
      p.rhy = 32 + f * 1.5;
      p.lhx = -10;
      p.lhy = 32 + f;
      p.flx = -1.5;
      p.frx = 1.5;
      p.fly = f >= 2 ? 1 : 0;
      p.hem = 1.8;
      p.sash = 2.2;
      p.hair = 2.6;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -40 + f * 10;
        p.twoHand = false;
        p.rhx = 6;
      }
      break;
    }
    case 'dead':
      p.prone = true;
      break;
    case 'meditate': {
      p.seated = true;
      p.bob = [0, 0, -1, -1][f];
      p.blink = true;
      p.rhx = 1.8;
      p.rhy = 41;
      p.lhx = -1.8;
      p.lhy = 41;
      p.dx = 0;
      const amp = [0.4, 1, 1.9][inp.wind] ?? 0.4;
      p.hem = amp * (Math.sin(TAU * u) * 0.5);
      p.sash = amp * (Math.sin(TAU * u + 1) * 0.9);
      p.hair = amp * (Math.sin(TAU * u + 1.9) * 0.8 - 0.2);
      p.sheath = hip ? 1 : 0;
      break;
    }
    case 'cheer': {
      const T: [number, number, number, number, number][] = [
        [0.5, 1.5, 0, 9, 9],
        [-1, -3.2, 3, 14, 12],
        [-1, -4.4, 3.5, 15, 10],
        [0, 0.8, 0, 12, 14],
      ];
      const [ln, bob, lift, hy, hy2] = T[f];
      p.lean = ln;
      p.bob = bob;
      p.fly = lift;
      p.fry = lift;
      p.crouch = f === 0 || f === 3 ? 1 : 0;
      p.rhx = 11;
      p.rhy = 36 - hy * 1.3 - (f === 0 ? -10 : 0);
      p.lhx = -11;
      p.lhy = 36 - hy2 * 1.3 - (f === 0 ? -10 : 0);
      p.blink = f === 2;
      p.talk = f === 1 || f === 2;
      p.hem = 1.2;
      p.sash = 1.8;
      p.hair = 1.6;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.rhy = 24;
        p.rhx = 10;
      }
      break;
    }
    case 'loot': {
      const T: [number, number, number, number][] = [
        [3, 2, 10, 41],
        [4.5, 3.5, 13, 47],
        [4, 3, 11, 44],
        [0.5, 0.5, 9, 35],
      ];
      const [ln, cr, hx, hy] = T[f];
      p.lean = ln;
      p.crouch = cr;
      p.rhx = hx;
      p.rhy = hy;
      p.lhx = -4;
      p.lhy = 40 + f;
      p.flx = -2;
      p.frx = 2.5;
      p.hem = -0.8;
      p.sash = 0.6;
      p.hair = 1.4;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.twoHand = false;
      }
      break;
    }
    case 'stretch': {
      const T: [number, number, number, number][] = [
        [9, 24, 9, 26],
        [10, 16, 10, 18],
        [10, 8, 10, 9],
        [10, 7, 10, 8],
        [9, 18, 9, 20],
        [8, 30, 8, 32],
      ];
      const [rx, ry, lx, ly] = T[f];
      p.rhx = rx;
      p.rhy = ry;
      p.lhx = -lx;
      p.lhy = ly;
      p.lean = f >= 2 && f <= 3 ? -2.2 : f === 1 ? -1 : 0;
      p.hdy = f >= 2 && f <= 3 ? -1 : 0;
      p.bob = f >= 2 && f <= 3 ? -1 : 0;
      p.blink = f >= 1 && f <= 4;
      p.talk = f === 2 || f === 3;
      p.hem = 0.8;
      p.sash = 1;
      p.hair = 1;
      if (hip) p.sheath = 1;
      break;
    }
    case 'chat': {
      const T: [number, number, number, number][] = [
        [10, 28, -6, 33],
        [13, 24, -6, 33],
        [9, 26, -7, 31],
        [14, 23, -9, 28],
        [10, 27, -6, 33],
        [12, 25, -8, 30],
      ];
      const [rx, ry, lx, ly] = T[f];
      p.rhx = rx;
      p.rhy = ry;
      p.lhx = lx;
      p.lhy = ly;
      p.talk = f % 2 === 1;
      p.tilt = f === 3 ? 1 : f === 5 ? -1 : 0;
      p.hdy = f % 2;
      p.bob = f % 2 ? -1 : 0;
      p.lean = 0.4;
      p.turn = f < 3 ? 1 : 0;
      const amp = [0.4, 1, 1.9][inp.wind] ?? 0.4;
      p.hem = amp * (Math.sin(TAU * u) * 0.7 - 0.3);
      p.sash = amp * (Math.sin(TAU * u + 1) * 0.9 - 0.3);
      p.hair = amp * (Math.sin(TAU * u + 1.5) * 0.8 - 0.3);
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.rhx = 8.8;
        p.rhy = 35;
        p.lhx = -7;
        p.lhy = 36;
      }
      break;
    }
    case 'fan': {
      p.tool = 'fan';
      p.rhx = 11 + (f % 2) * 0.8;
      p.rhy = 28 + (f === 1 || f === 3 ? -1.5 : 0);
      p.wAng = -40 + f * 22;
      p.lhx = -5;
      p.lhy = 34;
      p.bob = f % 2 ? -1 : 0;
      p.lean = 0.3;
      p.tilt = f === 2 ? 1 : 0;
      p.hem = 0.5;
      p.sash = 0.8;
      p.hair = 0.9 * (f % 2 ? 1 : -1);
      break;
    }
    case 'wipe': {
      p.tool = 'cloth';
      const ang = TAU * u;
      p.rhx = 12 + 4 * Math.cos(ang);
      p.rhy = 34 + 1.1 * Math.sin(ang);
      p.wAng = 20 * Math.cos(ang);
      p.lhx = -3;
      p.lhy = 33;
      p.lean = 2 + Math.cos(ang);
      p.crouch = 1;
      p.hdy = 1;
      p.bob = 0;
      p.hem = -0.6;
      p.sash = 0.5;
      p.hair = 1.4;
      break;
    }
    case 'sweep': {
      p.tool = 'broom';
      const s = Math.sin(TAU * u);
      p.rhx = 11 + 3.2 * s;
      p.rhy = 33;
      p.lhx = 6 + 3.2 * s;
      p.lhy = 29;
      p.wAng = 62 - 8 * s;
      p.lean = 1.6 + s;
      p.crouch = 0.6;
      p.bob = f % 2 ? 0 : 0.5;
      p.hdy = 1;
      p.hem = -0.5 - 0.8 * s;
      p.sash = -0.4 - s;
      p.hair = 1 + s;
      break;
    }
    case 'form': {
      const T: [number, number, number, number, number, number, number, number][] = [
        // rhx rhy lhx lhy lean crouch dx stepOut
        [9, 31, -6, 31, 0, 1, 0, 2],
        [14, 27, -9, 25, 1, 1.5, 1, 3],
        [17, 22, -13, 22, 1.5, 2, 1.5, 4],
        [12, 20, -9, 22, 0.5, 2, 0.5, 4],
        [5, 26, -2, 27, -1, 1.5, -1, 3],
        [21, 26, -4, 31, 3.5, 2.5, 2.5, 5],
        [22, 26, -4, 31, 3.5, 2.5, 2.5, 5],
        [11, 30, -6, 31, 0.5, 1, 0.5, 2],
      ];
      const [rx, ry, lx, ly, ln, cr, dx, st] = T[f];
      p.rhx = rx;
      p.rhy = ry;
      p.lhx = lx;
      p.lhy = ly;
      p.lean = ln;
      p.crouch = cr;
      p.dx = dx;
      p.flx = -st * 0.6;
      p.frx = st;
      p.hem = -(ln - 0.5) * 0.9;
      p.sash = -(ln - 0.5) * 1.2;
      p.hair = -(ln - 0.5) * 1.4;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.twoHand = false;
      }
      break;
    }
    case 'eat': {
      p.tool = 'chop';
      p.toolL = 'bowl';
      p.lhx = 2;
      p.lhy = 31.5;
      const R: [number, number][] = [[5, 30], [5, 25], [4.5, 21], [4.5, 21], [5, 26], [5, 30]];
      p.rhx = R[f][0];
      p.rhy = R[f][1];
      p.wAng = -62;
      p.lean = f === 1 || f === 4 ? 0.8 : f === 2 || f === 3 ? 1.2 : 0.3;
      p.hdy = f === 2 || f === 3 ? 0.6 : 0;
      p.talk = f === 2;
      p.blink = f === 3;
      p.bob = f % 2 ? -0.4 : 0;
      p.hem = 0.2;
      p.sash = 0.3;
      p.hair = 0.4 * (f % 2 ? 1 : -1);
      if (hip) p.sheath = 1;
      break;
    }
    case 'pray': {
      p.lhx = -0.8;
      p.lhy = 29.5;
      p.rhx = 1.4;
      p.rhy = 29.5;
      p.lean = [0, 1.4, 2.6, 1.4][f];
      p.hdy = [0, 1, 2, 1][f];
      p.crouch = 0.3;
      p.blink = true;
      const amp = [0.4, 1, 1.9][inp.wind] ?? 0.4;
      p.hem = amp * (Math.sin(TAU * u) * 0.6 - 0.2) - p.lean * 0.3;
      p.sash = amp * (Math.sin(TAU * u + 1) * 0.8 - 0.3) - p.lean * 0.4;
      p.hair = amp * (Math.sin(TAU * u + 1.6) * 0.7) + p.lean * 0.3;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.rhx = 8.8;
        p.rhy = 35;
        p.lhx = -0.8;
        p.lhy = 30;
      }
      break;
    }
    case 'rest': {
      p.seated = true;
      p.rhx = 7.4;
      p.rhy = 43.6;
      p.lhx = -7.4;
      p.lhy = 43.6;
      p.lean = [0, 0.6, 1.2, 0.6][f];
      p.hdy = [0, 0.6, 1.4, 0.6][f];
      p.bob = [0, 0, 0.4, 0][f];
      p.tilt = f === 2 ? 1 : 0;
      p.blink = f !== 0;
      const amp = [0.4, 1, 1.9][inp.wind] ?? 0.4;
      p.hem = amp * Math.sin(TAU * u) * 0.5;
      p.sash = amp * Math.sin(TAU * u + 1) * 0.8;
      p.hair = amp * Math.sin(TAU * u + 1.9) * 0.7;
      if (hip) p.sheath = 1;
      break;
    }
    case 'trade': {
      p.toolL = 'abacus';
      const R: [number, number][] = [[12, 30], [16, 29], [17, 29], [12, 30], [10, 31], [12, 30]];
      p.rhx = R[f][0];
      p.rhy = R[f][1];
      p.lhx = f === 4 ? 1 : -1;
      p.lhy = f === 4 ? 30 : 31;
      p.talk = f === 1 || f === 2;
      p.lean = f === 1 || f === 2 ? 1.2 : 0.3;
      p.tilt = f === 3 ? 1 : 0;
      p.bob = f % 2 ? -0.5 : 0;
      p.hem = 0.2;
      p.sash = 0.4;
      p.hair = 0.4;
      if (hip) p.sheath = 1;
      break;
    }
    case 'shelter': {
      p.crouch = 5.2;
      p.lean = 2.2;
      p.hdy = 2;
      p.dx = [0.5, -0.5, 0.5, -0.5][f];
      p.rhx = 4.5;
      p.rhy = 21 + (f % 2);
      p.lhx = -3.5;
      p.lhy = 21 + ((f + 1) % 2);
      p.flx = -2.5;
      p.frx = 3;
      p.blink = true;
      p.hem = 1.2;
      p.sash = 1.6;
      p.hair = 1.8 * (f % 2 ? 1 : -1);
      if (hip) p.sheath = 1;
      break;
    }
    case 'mourn': {
      p.hdy = 2.4;
      p.lean = 2 + Math.sin(TAU * u) * 0.5;
      p.dx = Math.sin(TAU * u) * 0.5;
      p.rhx = 3.4;
      p.rhy = f % 2 ? 21.5 : 22.5;
      p.lhx = -5.5;
      p.lhy = 34.5;
      p.blink = true;
      p.hem = -0.3;
      p.sash = 0.4;
      p.hair = 1.6;
      if (hip) p.sheath = 1;
      if (carried) {
        p.wAng = -90;
        p.twoHand = false;
        p.lhx = -5.5;
      }
      break;
    }
    case 'work':
    case 'craft':
      workPose(p, inp, f);
      break;
  }
  return p;
}

function setStance(p: Pose, wpn: WeaponType | null, k: number): void {
  const b = k === 1 || k === 2 ? -0.6 : 0;
  switch (wpn) {
    case 'sword':
      p.rhx = 12.5;
      p.rhy = 26 + b;
      p.wAng = -52;
      p.lhx = -7;
      p.lhy = 31;
      break;
    case 'blade':
      p.rhx = 12;
      p.rhy = 27 + b;
      p.wAng = -48;
      p.lhx = -7;
      p.lhy = 31;
      break;
    case 'spear':
      p.rhx = 10.5;
      p.rhy = 30 + b;
      p.wAng = -14;
      p.twoHand = true;
      p.lhx = 4;
      p.lhy = 29 + b;
      break;
    case 'staff':
      p.rhx = 10;
      p.rhy = 29 + b;
      p.wAng = -34;
      p.twoHand = true;
      p.lhx = 2;
      p.lhy = 31 + b;
      break;
    default:
      p.fists = true;
      p.rhx = 10;
      p.rhy = 26.5 + b;
      p.lhx = 3.5;
      p.lhy = 27.5 + b;
  }
}

function workPose(p: Pose, inp: PoseInput, f: number): void {
  const tool = inp.tool ?? (inp.state === 'craft' ? 'ladle' : 'hammer');
  p.tool = tool;
  if (inp.state === 'craft') {
    const ang = TAU * (f / 6);
    p.tool = 'ladle';
    p.rhx = 12.5 + 3.2 * Math.cos(ang);
    p.rhy = 31.5 + 1.2 * Math.sin(ang);
    p.wAng = 80;
    p.lhx = -4;
    p.lhy = 33;
    p.lean = 1.8;
    p.crouch = 0.5;
    p.hdy = 1;
    p.bob = f % 2 ? 0 : 0.5;
    p.talk = false;
    p.hem = -0.4;
    p.sash = 0.4;
    p.hair = 1;
    return;
  }
  // [rhx, rhy, ang, lhx, lhy, lean, crouch]
  type WF = [number, number, number, number, number, number, number];
  let T: WF[];
  switch (tool) {
    case 'hoe':
      T = [
        [9, 22, -115, 5, 27, -1, 0],
        [8, 17, -125, 3, 22, -1.5, 0],
        [15, 28, -30, 9, 32, 1.5, 0.5],
        [19, 38, 25, 12, 38, 3.5, 1.5],
        [17, 36, 40, 10, 37, 3, 1.5],
        [12, 28, -60, 6, 31, 1, 0.5],
      ];
      break;
    case 'pick':
      T = [
        [9, 20, -100, 5, 26, -1, 0],
        [8, 11, -108, 4, 17, -2, 0],
        [14, 20, -40, 9, 27, 0.5, 0.5],
        [18, 33, 20, 12, 36, 3, 1.5],
        [17, 36, 35, 11, 37, 3.4, 1.8],
        [12, 28, -50, 6, 31, 1, 0.5],
      ];
      break;
    case 'sickle':
      T = [
        [9, 36, -20, -4, 38, 2, 2.5],
        [13, 38, 10, -4, 40, 3, 3],
        [17, 40, 40, -4, 41, 4, 3.5],
        [13, 41, 20, 4, 42, 3.5, 3.5],
        [9, 38, -30, 0, 40, 2.5, 3],
        [7, 34, -60, -3, 36, 1.5, 2],
      ];
      break;
    case 'herb':
      T = [
        [10, 38, 0, -2, 40, 3, 3],
        [13, 45, 0, -1, 46, 4.5, 5.5],
        [13, 47, 0, 1, 47, 5, 6],
        [11, 42, 0, 0, 44, 4, 5],
        [9, 33, 0, 4, 34, 1.5, 2],
        [9, 27, 0, 3, 31, 0.5, 0.5],
      ];
      break;
    default:
      // hammer
      T = [
        [9, 18, -100, 8, 33, -1, 0],
        [8, 12, -105, 8, 33, -2, 0],
        [15, 28, 20, 8, 33, 1.5, 0.5],
        [16, 34, 50, 8, 33, 3, 1.5],
        [13, 29, 12, 8, 33, 1.5, 1],
        [10, 22, -60, 8, 33, 0, 0],
      ];
  }
  const w = T[f];
  p.rhx = w[0];
  p.rhy = w[1];
  p.wAng = w[2];
  p.lhx = w[3];
  p.lhy = w[4];
  p.lean = w[5];
  p.crouch = w[6];
  p.hdy = w[6] > 2 ? 1 : 0;
  p.flx = -1.5;
  p.frx = 2;
  p.dx = w[5] * 0.3;
  p.hem = -(w[5]) * 0.7;
  p.sash = -(w[5]) * 0.9;
  p.hair = -(w[5]) * 1.1 + 0.8;
  if (tool === 'herb') p.tool = null;
}

/**
 * Pose for a frame, with the cloth offsets lagged by one frame: the garment follows the body so it trails on
 * acceleration. Deterministic.
 */
export function poseFor(inp: PoseInput): Pose {
  const n = FRAME_COUNTS[inp.state];
  const p = raw(inp, inp.frame);
  if (n > 1 && inp.state !== 'idle' && inp.state !== 'walk' && inp.state !== 'run') {
    const q = raw(inp, Math.max(0, inp.frame - 1));
    const dl = p.lean - q.lean + (p.dx - q.dx);
    p.hem += -dl * 0.5;
    p.sash += -dl * 0.7;
    p.hair += -dl * 0.8;
  }
  return p;
}
