/**
 * Town crowds: the two population tiers and the numbers that tie them together.
 *
 * Named tier: the sim's NPCs (guards, masters, shopkeepers, a few villagers) with names, memory, dialogue and a daily life.
 * Ambient tier: nameless townsfolk the server spawns only while a player is near, walking between the places of the
 * settlement and going indoors at night. They have no memory, dialogue or persistence.
 *
 * The population a settlement shows is the number of people who live there: named + ambient. `residentsOf` turns the
 * sim's abstract population (which the economy runs on) into that number, so what the world panel says is what you can
 * count in the streets at midday.
 */
import { T, type BuildingDef, type SettlementDef, type SettlementKind, type WorldData } from './terrain';
import type { Look } from './types';
import { gateDirs, gateTile } from './landmarks';

/** People living in a settlement at full strength (named and ambient together). */
export const RESIDENTS: Record<SettlementKind, number> = {
  hamlet: 12,
  village: 30,
  town: 70,
  fort: 44,
  sectHall: 38,
  ruin: 0,
};

/** Most the sim's population may swing the head-count: the settlement's growth cap is 1.6 of its base. */
const MAX_RATIO = 1.6;

/** The head-count of a settlement whose sim population is `simPop` against a base of `basePop`. */
export function residentTarget(kind: SettlementKind, simPop: number, basePop: number): number {
  if (kind === 'ruin' || basePop <= 0 || simPop <= 0) return 0;
  const ratio = Math.min(MAX_RATIO, Math.max(0, simPop / basePop));
  return Math.round(RESIDENTS[kind] * ratio);
}

/** What the settlement view reports: never fewer people than the named ones that live there. */
export function residentsOf(kind: SettlementKind, simPop: number, basePop: number, named: number): number {
  if (kind === 'ruin') return Math.max(0, named);
  return Math.max(named, residentTarget(kind, simPop, basePop));
}

/** Ambient townsfolk a settlement should have at full strength. */
export function ambientQuota(residents: number, named: number): number {
  return Math.max(0, residents - named);
}

/**
 * Share of the ambient quota that is out of doors at a world hour (0..24, may be fractional): everyone by day, the
 * odd late walker at night.
 */
const HOUR_FACTOR = [0.04, 0.03, 0.03, 0.03, 0.05, 0.2, 0.55, 0.85, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.95, 0.85, 0.65, 0.4, 0.22, 0.12, 0.07];

export function crowdHourFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const a = Math.floor(h);
  const f = h - a;
  return HOUR_FACTOR[a] * (1 - f) + HOUR_FACTOR[(a + 1) % 24] * f;
}

/** Global ceiling on ambient entities in the world, however many settlements are being watched. */
export const AMBIENT_GLOBAL_CAP = 220;

/** Ambient townsfolk spawn when a player is within this many tiles of the settlement's edge. */
export const AMBIENT_WATCH_MARGIN = 22;

/** Distinct looks the crowd draws from (the client caches a sprite sheet per look, so the number stays small). */
export const AMBIENT_LOOKS = 24;

const AMBIENT_OUTFITS = [0, 1, 2, 3];
const AMBIENT_OUTFIT_COLORS = [1, 2, 4, 5, 7, 8]; // plain, undyed tones
const AMBIENT_SASH_COLORS = [0, 1, 2, 3, 4, 5, 6];
const AMBIENT_HAIR_COLORS = [0, 1, 2, 3];

/** The look of crowd variant `v` (0 .. AMBIENT_LOOKS - 1): plain clothes, ordinary hair, no accessories. */
export function ambientLook(v: number): Look {
  const i = ((Math.floor(v) % AMBIENT_LOOKS) + AMBIENT_LOOKS) % AMBIENT_LOOKS;
  const gender = (i % 2) as 0 | 1;
  const k = Math.floor(i / 2);
  return {
    gender,
    skin: (k * 2 + gender) % 4,
    hairStyle: (k * 3 + gender) % 7,
    hairColor: AMBIENT_HAIR_COLORS[(k + gender) % AMBIENT_HAIR_COLORS.length],
    outfit: AMBIENT_OUTFITS[k % AMBIENT_OUTFITS.length],
    outfitColor: AMBIENT_OUTFIT_COLORS[(k * 5 + gender * 2) % AMBIENT_OUTFIT_COLORS.length],
    sashColor: AMBIENT_SASH_COLORS[(k * 3 + 1) % AMBIENT_SASH_COLORS.length],
    accessory: 0,
  };
}

export interface CrowdSpot {
  x: number;
  y: number;
  /** Relative chance of being chosen as a destination. */
  weight: number;
  /** What it is, for the time-of-day weights. */
  kind: 'plaza' | 'market' | 'inn' | 'shrine' | 'work' | 'gate';
}

export interface CrowdMap {
  /** Door tiles people leave from and return to. */
  homes: { x: number; y: number }[];
  /** Places people walk to. */
  spots: CrowdSpot[];
}

const SPOT_KIND: Partial<Record<BuildingDef['kind'], { kind: CrowdSpot['kind']; weight: number }>> = {
  market: { kind: 'market', weight: 4 },
  inn: { kind: 'inn', weight: 3 },
  teahouse: { kind: 'inn', weight: 2 },
  shrine: { kind: 'shrine', weight: 2 },
  pavilion: { kind: 'shrine', weight: 1 },
  smithy: { kind: 'work', weight: 1.5 },
  alchemy: { kind: 'work', weight: 1.5 },
  warehouse: { kind: 'work', weight: 1 },
  herbHut: { kind: 'work', weight: 0.8 },
  dojo: { kind: 'work', weight: 1 },
};

/** The places of one settlement that the crowd uses: house doors as homes; plaza, public doors and gates as spots. */
export function crowdMap(world: Pick<WorldData, 'buildings' | 'roads' | 'settlements' | 'terrain' | 'w'>, s: SettlementDef): CrowdMap {
  const homes: CrowdMap['homes'] = [];
  const spots: CrowdSpot[] = [];
  for (const b of world.buildings) {
    if (b.settlementId !== s.id) continue;
    if (b.kind === 'house' || b.kind === 'farmhouse' || b.kind === 'dormitory') homes.push({ x: b.door.x, y: b.door.y });
    const sk = SPOT_KIND[b.kind];
    if (sk) spots.push({ x: b.door.x, y: b.door.y, weight: sk.weight, kind: sk.kind });
  }
  // the plaza: a few tiles spread over it, the busiest place of the town
  const plaza: { x: number; y: number }[] = [];
  for (let y = s.y - 6; y <= s.y + 6; y++) {
    for (let x = s.x - 6; x <= s.x + 6; x++) {
      if (x < 0 || y < 0 || x >= world.w) continue;
      if (world.terrain[y * world.w + x] === T.Plaza) plaza.push({ x, y });
    }
  }
  const step = Math.max(1, Math.floor(plaza.length / 9));
  for (let i = 0; i < plaza.length; i += step) spots.push({ x: plaza[i].x, y: plaza[i].y, weight: 5 / Math.max(1, plaza.length / step / 3), kind: 'plaza' });
  for (const d of gateDirs(s, world.roads, world.settlements)) {
    const t = gateTile(s, d);
    spots.push({ x: t.x, y: t.y, weight: 1, kind: 'gate' });
  }
  return { homes, spots };
}

/**
 * Where townsfolk like to be at a world hour: a weight multiplier per kind of spot. Mornings and evenings at the market
 * and the gates, midday at the plaza and the work places, evenings at the inn and the shrine.
 */
export function spotMood(kind: CrowdSpot['kind'], hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  switch (kind) {
    case 'market':
      return h >= 7 && h < 12 ? 1.8 : h >= 12 && h < 17 ? 1.1 : 0.4;
    case 'work':
      return h >= 8 && h < 17 ? 1.4 : 0.2;
    case 'gate':
      return (h >= 6 && h < 9) || (h >= 16 && h < 19) ? 2 : 0.5;
    case 'inn':
      return h >= 17 || h < 1 ? 2.4 : h >= 11 && h < 14 ? 1.2 : 0.4;
    case 'shrine':
      return (h >= 5 && h < 8) || (h >= 17 && h < 20) ? 2 : 0.6;
    case 'plaza':
      return h >= 9 && h < 17 ? 1.3 : 1;
  }
}
