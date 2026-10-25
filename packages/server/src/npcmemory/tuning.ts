/** Every tuning knob of the NPC memory / gossip system. Times are world hours (24 per day, 30 days per season). */
export const NPCMEM = {
  /** Default half-life of a remembered deed. */
  halfLifeHours: 24 * 20,
  /** Weight below which a decayed record is dropped. */
  pruneBelow: 0.04,
  /** Hard caps on stored rows (lowest decayed weight goes first). */
  maxTownRows: 3000,
  maxPersonalRows: 5000,
  /** Standing thresholds on the town's weighted sums (see `standingOf`). */
  standing: { noted: 1, welcomed: 5, honoured: 13, feared: 4.5, despised: 3.5 },
  /** Personal memory: talking to an NPC again within this many hours does not count as another visit. */
  talkCooldownHours: 2,
  /** How far from a settlement (tiles beyond its radius) a kill still counts as "near" it. */
  killRadiusExtra: 24,
  /** Cumulative magnitude at which a deed becomes worth a rumor (per place x player x kind). */
  rumorMilestones: { killedBandits: [8, 30, 100], killedHollows: [8, 30, 100], deliveredGoods: [5, 20], completedMission: [10, 40], duelWon: [3, 10], duelLost: [99], default: [1] } as Record<string, number[]>,
} as const;

export const RUMOR = {
  /** Active rumor cap; the least interesting one is dropped when exceeded. */
  maxRumors: 96,
  /** Lifespan by importance (1 minor, 2 notable, 3 world-shaking). */
  lifespanHours: { 1: 24 * 5, 2: 24 * 14, 3: 24 * 40 } as Record<number, number>,
  /** Max road hops a rumor of this importance travels from its origin. */
  maxHops: { 1: 1, 2: 3, 3: 99 } as Record<number, number>,
  /** Chance a minor chronicle line (importance 1) becomes a rumor at all. */
  minorChance: 0.45,
  /** Tiles a messenger covers per world hour (caravans and travellers; 40 per day). */
  tilesPerHour: 1.8,
  /** Delay jitter multiplier range. */
  delayJitter: [0.8, 1.35] as const,
  /** Hours a settlement keeps a rumor before it starts sending it on. */
  holdHours: 3,
  /** Hourly chance per (rumor x known settlement x open road) of dispatching a messenger, times the town's gossip level. */
  travelRate: 0.16,
  /** Dispatch rate multiplier when an end of the road is besieged (a few messengers slip through). */
  besiegedRate: 0.25,
  /** Delay multiplier on besieged roads. */
  besiegedDelay: 2,
  /** A road whose mean Blight is at or above this carries nothing (same threshold as the caravans). */
  blightRoad: 42,
  /** Hours an arriving messenger waits before giving up when the road is blocked on arrival. */
  retryHours: 12,
  maxRetries: 3,
  /** Hourly chance, times the town's gossip level, that one more NPC in a settlement hears a rumor. */
  inTownRate: 0.5,
  /** Truth lost on every hop, plus this much on every distortion. */
  hopTruthLoss: 0.04,
  distortTruthLoss: [0.07, 0.15] as const,
  /** Base chance a hop distorts the story; exaggerators raise it, honest/scholarly tellers lower it. */
  distortChance: 0.35,
  /** Truth below which a variant is too garbled to keep telling. */
  minTruth: 0.08,
  /** Chat boost: chance that the listener learns each rumor the teller knows. */
  chatShare: 0.4,
  /** Max NPCs remembered as knowing a rumor, per settlement. */
  maxKnowers: 24,
  /** A teller will not repeat a rumor to the same player within this many hours (unless there is nothing else). */
  tellCooldownHours: 72,
};

export type Importance = 1 | 2 | 3;
