/**
 * Every tuning knob of the siege battles in one place.
 * Times are real milliseconds unless the name says hours (WORLD hours: 1 hour = `sim.hourMs`, 60 s by default).
 */
export const SIEGE_TUNING = {
  // ---- when a battle is simulated ------------------------------------------------------------
  /** A battle runs while an online player is within settlement radius + this many tiles of the settlement centre. */
  activateRadius: 46,
  /** ... and is torn down (entities removed, nothing left behind) once nobody has been within radius + this for `graceMs`. */
  deactivateRadius: 58,
  graceMs: 8_000,
  /** The battle logic runs this often (the actual hits use their own per-unit timers). */
  stepMs: 400,
  /** How often the sieges of the sim are checked for players near (no work at all while nobody is near). */
  scanMs: 1_000,
  /** The current phase is re-sent to nearby players this often (so late arrivals see the fires, and the pulse continues). */
  heartbeatMs: 4_000,

  // ---- war parties ---------------------------------------------------------------------------
  /** Party size = clamp(round(strength / strengthPerUnit), partyMin, partyMax). */
  strengthPerUnit: 5,
  partyMin: 6,
  partyMax: 18,
  /** A captain per this many units (at least one), and one banner bearer. */
  unitsPerCaptain: 8,
  /** The party appears this many tiles (path length) from the gate along the approach road. */
  marchTiles: [26, 34] as readonly [number, number],
  /** Walking spacing of the column along the road (tiles between neighbours). */
  columnSpacing: 1.4,
  /** Raiders march at this speed multiplier (random in range) and run (charge) at `chargeSpeed`. */
  marchSpeed: [0.6, 0.74] as readonly [number, number],
  chargeSpeed: 1.55,
  /** Units start walking with this spread (ms) so the column stretches. */
  marchStagger: 2_600,
  /** The party stops at the forming line this far (tiles) from the gate, raises the banner, then charges. */
  lineDist: 11,
  /** Charge starts when the lead raider is within this many tiles of the gate, or after this long. */
  chargeDist: 14,
  marchTimeoutMs: 45_000,

  // ---- defenders -----------------------------------------------------------------------------
  /** Militia: armed villagers (at most this many) join the guards, masters and legends. */
  militiaMax: 8,
  /** Defenders as a share of the war party, scaled by sqrt(defense / strength) (clamped to the roster). */
  defenderShare: 1.0,
  defenderMin: 4,
  defenderMax: 22,
  /** Defenders only go for raiders within this many tiles of their line (they hold the line, the raiders come to them). */
  defendRange: 7,
  /** The defenders' line stands this many tiles inside the gate (in the open town, not in the forest outside). */
  holdInside: 3.5,
  /** Defenders run to the gate at this speed multiplier. */
  sortieSpeed: 1.5,
  /** Casualties are carried off this long after they fall. */
  corpseMs: 4_500,
  /** A defender who fell comes back (healed) when the wave is over, after this lull. */
  lullMs: [28_000, 46_000] as readonly [number, number],

  // ---- the skirmish (abstract hit exchange, no combat engine) --------------------------------
  /** Distance (tiles) at which two units are in contact. */
  reach: 1.9,
  /** Time between a unit's blows. */
  hitMs: [1_050, 1_650] as readonly [number, number],
  /** Chance that a blow connects. */
  hitChance: 0.82,
  critChance: 0.08,
  critMult: 1.6,
  /** Damage of a blow as a share of the target's max HP, before power, toughness and steering. */
  hitFrac: 0.15,
  /** Damage multipliers from the battle's momentum b in [-1, 1]: defenders x(1 + k b), raiders x(1 - k b). */
  steerK: 0.9,
  steerMin: 0.22,
  steerMax: 2.0,
  /** Units fight on a target at most this far (tiles) away. */
  leash: 44,
  /** Extra "distance" per foe already attacking a target (spreads the fights out instead of dog-piling). */
  loadPenalty: 2.4,
  /** A wave that is repelled leaves at most this share of the raiders standing: the rest rout. */
  routShare: 0.34,
  /** A wave never lasts longer than this once the melee began (the survivors rout). */
  waveMaxMs: 110_000,
  /** Path computations per battle step (the rest wait for the next step). */
  pathBudget: 10,
  /** Battle HP of defenders: round((base + perLevel * level) * role multiplier). */
  defHpBase: 70,
  defHpPerLevel: 22,
  /** Raiders and defenders the engine will model at once. */
  unitCap: 44,

  // ---- steering the outcome ------------------------------------------------------------------
  /** Waves before the last one are always repelled; their bias is clamp(waveBias + waveBiasK * m, lo, hi). */
  waveBias: 0.35,
  waveBiasK: 0.5,
  waveBiasRange: [0.1, 0.85] as readonly [number, number],
  /** Final wave bias limit (|b|). */
  finalBiasMax: 0.85,
  /** In the last wave, once no defender is left standing and the town is this unlikely to hold, the raiders pour into the town. */
  breachBelow: 0.2,
  /** The last wave starts when this many world hours of the siege are left (so it is mid-melee when the sim rolls). */
  finalLeadHours: 1.45,
  /** A player arriving with less than this left sees the fight already at the gate. */
  lateJoinHours: 0.5,
  /** Gap between waves comes from `lullMs`; waves shrink as the strength falls. */
  waveMinUnits: 4,

  // ---- players taking part -------------------------------------------------------------------
  /** Each raider a player kills lowers the siege strength by this much more than the sim does (per kill, x(1 + elite)). */
  tiltPerKill: 1.1,
  /** ... in total at most this much per siege. */
  tiltCap: 22,
  /** Raiders attack players within this many tiles (when the player may be attacked). */
  aggroRange: 6,
  /** A player who fell in a battle is left alone by the raiders for this long after waking up. */
  spareMs: 75_000,
  /** Players in a safe zone are left alone, except while raiders sack the town. */
  sackAttacksPlayers: true,

  // ---- the end -------------------------------------------------------------------------------
  /** The finale (rout and cheering, or the sack) plays this long after the sim has decided. */
  finaleMs: 38_000,
  /** The people of a town that held celebrate this long. */
  celebrateMs: 90_000,
  /** Chat shouts (speech bubbles): at most one per this many ms per battle. */
  shoutEveryMs: 7_000,
} as const;
