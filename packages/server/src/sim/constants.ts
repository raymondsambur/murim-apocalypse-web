/**
 * Tuning knobs for the living-world simulation. Everything that shapes how the world
 * evolves lives here so soak tests (`scripts/sim-soak.ts`) can be iterated quickly.
 * Units: hours are world hours, days are world days (24 h).
 */
import type { WeatherKind } from '@murim/shared';

export const SIM_VERSION = 1;

// ---- Calendar ---------------------------------------------------------------------
/** totalHours = 0 is 06:00 on day 0 (dawn of the first day). */
export const START_HOUR = 6;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_SEASON = 30;
export const DAYS_PER_YEAR = 120;
/** Hour of day when mission boards are re-posted. */
export const BOARD_HOUR = 6;

// ---- Weather ----------------------------------------------------------------------
/** Hour at which morning fog may lift. */
export const FOG_LIFT_HOUR = 10;
export const FOG_LIFT_CHANCE = 0.7;

// ---- Blight -----------------------------------------------------------------------
export const BLIGHT = {
  /** Fraction of the gap to the neighbour mean closed per hour (4-neighbour mean form). */
  diffusion: 0.5,
  /** Proportional decay per hour (divided by the growth multiplier, so winter decays faster). */
  decayRate: 0.0006,
  /** Constant decay per hour, cuts the long faint tail. */
  decayConst: 0.006,
  /** Emission per cell per hour at the centre of an active heart with strength 100. */
  heartEmit: 4.5,
  heartRadius: 4,
  /** Daily regrowth of unsealed hearts (strength points). */
  heartRegen: 0.8,
  /** Strength a heart restarts at when its seal breaks. */
  heartRestart: 20,
  sealDays: [6, 10] as [number, number],
  /** Heart emission pulses: 1 + amp * sin(...) with a per-heart period in days. */
  pulseAmp: 0.35,
  pulsePeriod: [7, 12] as [number, number],
  /** Daily chance per active heart to flare (emission x flareMult for 1-2 days). */
  flareChance: 0.035,
  flareMult: 1.8,
  /** Emission per cell per hour inside a fallen settlement (fades over fallenFadeDays; the ruin never fades). */
  fallenEmit: 0.55,
  fallenFadeDays: 45,
  ruinEmit: 0.35,
  /** Suppression per cell per hour at the centre of a settlement with defense 100. */
  suppress: 0.9,
  /** Suppression radius = settlement radius + this. */
  suppressExtra: 6,
  /** Blight average radius = settlement radius + this (centre weighted). */
  avgExtra: 8,
  /** Weight falloff exponent of that average (lower = the whole disc counts more evenly). */
  avgPow: 0.6,
  /** Growth multipliers (emission x, decay /). Spring, Summer, Autumn, Winter. */
  season: [1.0, 1.2, 1.0, 0.6] as [number, number, number, number],
  weather: { clear: 1, cloudy: 1, fog: 1.05, rain: 0.75, storm: 0.7, snow: 0.85 } as Record<WeatherKind, number>,
  /** A tile is reported changed when value >> bucketShift changes (or it crosses zero). */
  bucketShift: 3,
  /** More changed tiles than this -> one event listing them all (the server sends a full map). */
  maxEventTiles: 4000,
  /** Kill effects (radius, amount) of blight-family kills. */
  killRadius: 3,
  killBase: 2.5,
  killPerLevel: 0.08,
  killElite: [0, 8, 30] as [number, number, number],
  /** Initial seeding around hearts. */
  initPeak: 200,
  initRadius: 16,
  initRuinPeak: 70,
};

// ---- Settlements ------------------------------------------------------------------
export const SETTLE = {
  baseDefense: { village: 32, hamlet: 18, town: 42, fort: 66, sectHall: 60, ruin: 0 } as Record<string, number>,
  /** Defense from the controller: min(cap, power * mult / sqrt(owned)). */
  factionDefMult: 0.32,
  factionDefCap: 22,
  capitalBonus: 8,
  /** Hidden fastnesses and sworn fanatics: extra defense by ideology of the controller. */
  ideologyDef: { righteous: 0, neutral: 0, heterodox: 14, outlaw: 22 } as Record<string, number>,
  blightDefPenalty: 0.28,
  /** Defense relaxes toward its target this fraction per hour. */
  defenseRelax: 0.04,
  /** Blight siege trigger: chance per day = (blight - threshold) / span, capped. */
  siegeBlight: 14,
  siegeBlightSpan: 50,
  siegeDailyCap: 0.45,
  siegeHours: [16, 30] as [number, number],
  siegeCooldownDays: 6,
  /** The starting village cannot be besieged by the Blight before this many days. */
  startGraceDays: 150,
  /** Fraction of the siege's strength removed per defend mission completed. */
  defendMissionHit: 0.12,
  /** siegeStrength reduction per matching kill near a siege. */
  siegeKillBase: 0.35,
  /** Retake rules for fallen settlements. */
  retakeBlight: 26,
  returnBlight: 18,
  returnDays: 18,
  /** Fallen population drains to this fraction quickly. */
  fallenPop: 0.1,
  /** Status hysteresis thresholds on the daily score. */
  thriveUp: 72,
  thriveDown: 62,
  struggleDown: 34,
  struggleUp: 44,
};

// ---- Economy ----------------------------------------------------------------------
export const ECON = {
  /** Consumption per inhabitant per day. */
  cons: { grain: 0.02, meat: 0.006, herb: 0.002, ore_iron: 0.0025, hide: 0.002, cloth: 0.003, wine: 0.003, pill_heal_s: 0.0012 } as Record<string, number>,
  farmGrain: 6,
  /** Grain per inhabitant from gardens, by settlement kind (forts and sects live off tribute). */
  gardenByKind: { village: 0.004, hamlet: 0.008, town: 0.004, fort: 0.013, sectHall: 0.014, ruin: 0 } as Record<string, number>,
  huntMeat: 0.0066,
  farmhouseMeat: 2,
  herbHut: 5,
  forageHerb: 0.0008,
  /** Herb gardens kept by sects and forts. */
  gardenHerb: { sectHall: 2.4, fort: 0.9 } as Record<string, number>,
  mineOre: 5,
  hideBase: 0.0026,
  marketCloth: 2.2,
  innWine: 1.6,
  teaWine: 0.8,
  alchemyPills: 1.5,
  /** Season multipliers (Spring..Winter). */
  grainSeason: [1, 1.2, 1.5, 0.25],
  herbSeason: [1.2, 1.1, 1, 0.5],
  /** Stock target (days of consumption) used for prices; famine thresholds (days of food). */
  priceTargetDays: 10,
  famineEnter: 3,
  famineLeave: 6,
  /** Spoilage / storage cap in days of consumption (with a floor in units). */
  storeDays: 60,
  storeFloor: 60,
  /** Caravan rules. */
  caravanSurplusDays: 14,
  caravanNeedDays: 10,
  caravanCap: 26,
  /** A caravan load of at least this many units earns a chronicle line. */
  caravanNoteUnits: 14,
  jadeCaravanMult: 1.6,
  roadBlockMean: 42,
  roadBlockHot: 120,
  roadBlockHotFrac: 0.25,
  priceMin: 0.6,
  priceMax: 2.5,
};

// ---- Factions ---------------------------------------------------------------------
export const FACT = {
  /** Hours between major actions. */
  actEvery: [24, 72] as [number, number],
  upkeepPerPower: 0.022,
  incomePerSettlement: 2.6,
  extraSettlementUpkeep: 0.9,
  exileIncome: 3.2,
  /** Wealth above this leaks away each day (charity, corruption, feasts) at wealthLeak per day. */
  wealthSoftCap: 80,
  wealthLeak: 0.04,
  /** Daily chance of a diplomatic incident between a random pair of factions. */
  incidentChance: 0.07,
  /** Expedition against a Blight heart: min power / wealth and cost. */
  expeditionPower: 55,
  expeditionWealth: 28,
  exilePowerFloor: 14,
  /** Power a landless faction rebuilds toward (enough to retake a fallen settlement). */
  exileTarget: 36,
  /** Fraction of the gap to the sustainable power closed per day. */
  powerRelax: 0.035,
  /** A faction below this power never raids. */
  raidMinPower: 30,
  /** Landless factions fight desperately: bonus to their siege strength. */
  exileRaidBonus: 6,
  /** Siege strength of a raid = power x this range (+ wealth bonus). */
  raidStrength: [0.7, 1.2] as [number, number],
  powerFloor: 5,
  relationDrift: 0.02,
  warDeclare: -60,
  warEndMinDays: 14,
  allianceAt: 62,
  allianceBreak: 35,
  truceDays: 24,
  raidRelation: -30,
  revoltChance: 0.025,
  /** A conquered settlement may rise for its old masters for this many days after the loss... */
  uprisingDays: 50,
  /** ...with this daily chance (when it is not prospering). */
  uprisingChance: 0.03,
  /** A faction never holds more than this many settlements by force. */
  maxHoldings: 4,
  /** Chance a revolting settlement declares for a rival instead of going free. */
  revoltHeirChance: 0.65,
  /** After an annexation or revolt the settlement cannot flip again for this many days. */
  lockDays: 30,
};

// ---- NPCs ---------------------------------------------------------------------------
export const NPC = {
  /** Old age: annual hazard = base * exp((effectiveAge - 65) / scale). */
  ageHazardBase: 0.035,
  ageHazardScale: 6.5,
  /** Murim cultivators live longer: effective age = age - level * this. */
  levelLongevity: 0.22,
  /** Dead NPCs are pruned from the roster after this many days. */
  pruneDays: 40,
  legendEvery: 2,
  legendWanderChance: 0.06,
  /** Daily chance per warring faction pair that two of their masters meet in a deadly feud. */
  feudChance: 0.012,
  /** Daily chance a new wandering legend arrives while the world is short of them. */
  legendArriveChance: 0.012,
};

// ---- Missions -----------------------------------------------------------------------
export const MISSION = {
  minOffers: 4,
  maxOffers: 8,
  expiresDays: [3, 7] as [number, number],
};

// ---- Chronicle ----------------------------------------------------------------------
export const CHRON = {
  size: 300,
  /** Daily caps for importance 1 and 2 (3 is always written). */
  dailyCap: [7, 9] as [number, number],
};

// ---- Local happenings -------------------------------------------------------------------
export const HAPPEN = {
  /** Chance per living settlement per day that something worth a line happens. */
  perSettlementDay: 0.34,
};
