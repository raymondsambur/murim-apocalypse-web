/**
 * Every tuning knob of the NPC life system in one place.
 * Times given in "hours" are WORLD hours (1 world hour = `sim.hourMs` real ms, 60 s by default).
 */
export const NPCLIFE_TUNING = {
  // ---- cost bounds ---------------------------------------------------------------------------
  /** Ticks per full roster sweep: each NPC is looked at about once per second (10 ticks/s). */
  sweepTicks: 10,
  /** Hard cap on NPC visits per tick (a visit is a few comparisons unless something is due). */
  maxVisitsPerTick: 48,
  /** At most this many new activity decisions per tick (the rest wait for the next visit). */
  maxDecisionsPerTick: 6,
  /** Settlement "is a player nearby?" answers are cached this long (real ms). */
  nearTtlMs: 1000,
  /** A settlement is "near" when a player is within settlement radius + AOI radius + this margin. */
  nearMargin: 4,
  /** Settlement mood (weather, flags, siege) is cached this long (real ms). */
  moodTtlMs: 3000,

  // ---- places --------------------------------------------------------------------------------
  /** NPCs per ordinary house / farmhouse. */
  houseCapacity: 4,
  barracksCapacity: 8,
  /** Standing spots kept per place. */
  spotsPerPlace: 10,

  // ---- movement ------------------------------------------------------------------------------
  /** Random pause before leaving after an activity ends (real ms): crowds do not move in lockstep. */
  departJitterMs: [300, 4500] as const,
  /** Walk speed multiplier when hurrying (rain, alarm). The base speed is the NPC entity speed. */
  hurrySpeed: 1.6,
  travelMaxSteps: 140,
  travelMaxNodes: 4500,
  /** Re-tries of a cancelled walk before the NPC gives up on that place. */
  travelRetries: 3,
  /** A place that could not be reached is avoided for this many real ms. */
  avoidPlaceMs: 120_000,

  // ---- needs (units per world hour; the activity table in activities.ts overrides per activity) ----
  needs: {
    hunger: 0.11,
    rest: 0.06,
    company: 0.07,
    devotion: 0.05,
    duty: 0.12,
  },
  /** Needs are never advanced by more than this many world hours at once. */
  needsMaxDt: 12,

  // ---- scoring -------------------------------------------------------------------------------
  /** Random noise added to every candidate score. */
  scoreNoise: 0.12,
  /** Penalty for repeating the previous (non-routine) activity. */
  repeatPenalty: 0.25,
  /** Personal schedule offset, +-hours (hash of the NPC id), so dawn and dusk have stragglers. */
  phaseSpread: 0.75,
  /** Rain factor per weather kind (0..1): how much outdoor activities are disliked / shelter is wanted. */
  weather: { clear: 0, cloudy: 0, fog: 0.08, rain: 0.7, storm: 1, snow: 0.45 } as Record<string, number>,
  /** Settlement Blight (0..255) at which the Blight alarm sounds (guards rally, many villagers stay in). */
  blightAlarm: 120,
  /** Fraction of civilians that go indoors for a Blight alarm (by NPC hash). */
  blightHideShare: 0.6,
  /** Fraction of sheltering NPCs that step inside (the rest stand under the eaves). */
  shelterInsideShare: 0.55,
  /** Festival hours (world hour of day) during which the plaza crowd gathers. */
  festivalFrom: 10,
  festivalTo: 22,
  /** Fraction of ordinary villagers that choose the inn over home for a meal. */
  innMealShare: 0.28,

  // ---- social --------------------------------------------------------------------------------
  /** A waiting NPC and a newcomer pair up when closer than this (tiles). */
  chatRadius: 9,
  /** A new socialiser looks for someone waiting within this distance (tiles). */
  chatSeekRadius: 26,
  chatHours: [0.3, 0.7] as const,

  // ---- reactions -----------------------------------------------------------------------------
  /** How many neighbours gather when somebody dies, how long they stay (world hours), how long the call stays valid. */
  mourners: 5,
  mournHours: [1.2, 2.6] as const,
  mournCallHours: 7,
  /** Reactions interrupt NPCs after a random delay in this window (real ms). */
  interruptDelayMs: [800, 20_000] as const,

  // ---- observability -------------------------------------------------------------------------
  /** Radius (tiles) of `nearbyNpcs`. */
  nearbyRadius: 6,
} as const;

export type NpcLifeTuning = typeof NPCLIFE_TUNING;
