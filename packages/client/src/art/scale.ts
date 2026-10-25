/**
 * World scale: the single table of target proportions. Everything (people, beasts, buildings, walls, trees, props) is sized
 * relative to one standing adult. Pure constants, no DOM; `scale.test.ts` measures the generated sprites against it so the
 * proportions cannot drift.
 *
 * Units: scene px (1 px = 1 art pixel = 2 world px; a tile is 32 x 16 scene px). Heights are measured from the ground point
 * (feet / footprint centre) to the highest opaque pixel.
 */

/** A standing adult (hair or hat included), the unit everything else is measured in. */
export const PERSON_PX = 30;
/** Height of the figure as painted by the paper doll code before the reduction to `PERSON_PX` (measured, incl. outline). */
export const DESIGN_PERSON_PX = 48;
/** Reduction applied to every painted human sprite (elites multiply it by `SIZE_MULT`). */
export const CHAR_K = PERSON_PX / DESIGN_PERSON_PX;
/**
 * Vertical stretch of building geometry (the Scene3D z axis). The buildings were modelled for a person about as tall as an
 * eave; with the person at `PERSON_PX` a normal house eave must stand at 2 persons and its door at 1.25.
 */
export const BUILDING_ZK = 1.8;

/** Size of special people relative to a normal adult (applied on top of `CHAR_K`). */
export const SIZE_MULT = {
  normal: 1,
  elite1: 1.18,
  elite2: 1.25,
  hollow_brute: 1.3,
  bandit_boss: 1.5,
  hollow_lord: 1.8,
} as const;

/** Target height ranges as a multiple of `PERSON_PX` (min / max inclusive). `want` is what the art aims for. */
export interface Target {
  want: number;
  min: number;
  max: number;
}
const t = (want: number, min: number, max: number): Target => ({ want, min, max });

export const TARGETS = {
  person: t(1, 0.95, 1.1),
  personHat: t(1.07, 0.95, 1.18),
  elite1: t(1.18, 1.12, 1.28),
  elite2: t(1.25, 1.15, 1.35),
  hollowBrute: t(1.3, 1.2, 1.45),
  banditBoss: t(1.5, 1.35, 1.7),
  hollowLord: t(1.8, 1.6, 2.05),
  // buildings
  houseDoor: t(1.25, 1.1, 1.4),
  houseEave: t(2, 1.7, 2.3),
  /** Two-storey inn, ridge height. */
  innEave: t(3.4, 2.8, 3.9),
  hall: t(3.6, 3, 4.4),
  pagoda: t(6, 5, 8),
  fortWall: t(2.7, 2.4, 3.1),
  tower: t(4.2, 3.6, 4.8),
  // vegetation
  pine: t(3.5, 3, 4.2),
  oak: t(3.3, 3, 4.2),
  bamboo: t(3.4, 3, 4.2),
  bush: t(0.55, 0.4, 0.65),
  boulder: t(0.7, 0.5, 1),
  reeds: t(0.8, 0.6, 0.95),
  // beasts (height of the sprite; bear and tiger are longer than tall)
  boar: t(0.58, 0.5, 0.65),
  wolf: t(0.58, 0.5, 0.65),
  bear: t(0.85, 0.75, 0.95),
  tiger: t(0.8, 0.7, 0.9),
  snake: t(0.3, 0.15, 0.45),
  // props
  stoneLantern: t(0.8, 0.65, 0.95),
  torii: t(1.8, 1.6, 2.1),
} as const satisfies Record<string, Target>;

export type TargetKey = keyof typeof TARGETS;

/** Target height in px for a key. */
export function targetPx(k: TargetKey): number {
  return Math.round(TARGETS[k].want * PERSON_PX);
}

/** Scale a design-unit height (px) of a vegetation / prop generator. */
export const vs = (n: number, k: number): number => Math.round(n * k);
