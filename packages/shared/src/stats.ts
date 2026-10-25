import type { Rng } from './rng';
import { STAT_KEYS, type Look, type Stance, type Stats } from './types';
import { LOOK_RANGES } from './types';
import type { PassiveBonus } from './data/skills';
import { ORIGINS, TALENTS } from './data/origins';
import type { GearBonus } from './data/items';

export interface Roll {
  stats: Stats;
  talents: string[];
  origin: string;
  /** Short flavour line shown while rolling. */
  fate: string;
}

export function emptyStats(v = 0): Stats {
  return { might: v, agility: v, vitality: v, spirit: v, insight: v, fortune: v };
}

export function rollCharacter(rng: Rng): Roll {
  const stats = emptyStats();
  for (const k of STAT_KEYS) stats[k] = 5 + rng.bell(0, 8);
  const gifted = rng.pick(STAT_KEYS);
  stats[gifted] += 3;
  const weak = rng.pick(STAT_KEYS.filter((k) => k !== gifted));
  stats[weak] = Math.max(3, stats[weak] - 2);

  const nTalents = rng.weighted([[0, 25], [1, 55], [2, 20]] as const);
  const talentIds = Object.keys(TALENTS);
  const talents: string[] = [];
  while (talents.length < nTalents) {
    const t = rng.pick(talentIds);
    if (!talents.includes(t)) talents.push(t);
  }
  const origin = rng.pick(Object.keys(ORIGINS));

  for (const id of talents) for (const k of STAT_KEYS) stats[k] += TALENTS[id].mods[k] ?? 0;
  for (const k of STAT_KEYS) {
    stats[k] += ORIGINS[origin].mods[k] ?? 0;
    stats[k] = Math.max(1, stats[k]);
  }
  const fate = `${ORIGINS[origin].name}${talents.length ? ' · ' + talents.map((t) => TALENTS[t].name).join(', ') : ''}`;
  return { stats, talents, origin, fate };
}

export function randomLook(rng: Rng): Look {
  return {
    gender: rng.pick([0, 1] as const),
    skin: rng.int(0, LOOK_RANGES.skin - 1),
    hairStyle: rng.int(0, LOOK_RANGES.hairStyle - 1),
    hairColor: rng.int(0, LOOK_RANGES.hairColor - 1),
    outfit: rng.int(0, LOOK_RANGES.outfit - 1),
    outfitColor: rng.int(0, LOOK_RANGES.outfitColor - 1),
    sashColor: rng.int(0, LOOK_RANGES.sashColor - 1),
    accessory: rng.int(0, LOOK_RANGES.accessory - 1),
  };
}

export function clampLook(look: Look): Look {
  const c = (v: unknown, max: number) => Math.max(0, Math.min(max - 1, Math.floor(Number(v) || 0)));
  return {
    gender: look.gender === 1 ? 1 : 0,
    skin: c(look.skin, LOOK_RANGES.skin),
    hairStyle: c(look.hairStyle, LOOK_RANGES.hairStyle),
    hairColor: c(look.hairColor, LOOK_RANGES.hairColor),
    outfit: c(look.outfit, LOOK_RANGES.outfit),
    outfitColor: c(look.outfitColor, LOOK_RANGES.outfitColor),
    sashColor: c(look.sashColor, LOOK_RANGES.sashColor),
    accessory: c(look.accessory, LOOK_RANGES.accessory),
  };
}

export interface DerivedStats {
  maxHp: number;
  maxQi: number;
  atk: number;
  def: number;
  speed: number;
  crit: number;
  dodge: number;
  qiRegen: number;
  learnRate: number;
  healPower: number;
  antiBlight: number;
  lifesteal: number;
  resist: number;
  flee: number;
  /** Total stats including gear. */
  total: Stats;
}

export interface DeriveInput {
  stats: Stats;
  level: number;
  gear?: GearBonus;
  passives?: PassiveBonus[];
  injuryStacks?: number;
}

export function deriveStats(input: DeriveInput): DerivedStats {
  const { level } = input;
  const total = { ...input.stats };
  const gear = input.gear;
  if (gear) for (const k of STAT_KEYS) total[k] += gear.stats[k] ?? 0;

  const p: Required<PassiveBonus> = { maxHp: 0, maxQi: 0, atk: 0, def: 0, speed: 0, qiRegen: 0, crit: 0, dodge: 0, antiBlight: 0, lifesteal: 0, resist: 0, flee: 0 };
  for (const b of input.passives ?? []) for (const k of Object.keys(p) as (keyof PassiveBonus)[]) p[k] += b[k] ?? 0;

  const injury = 1 - 0.08 * (input.injuryStacks ?? 0);
  let maxHp = (70 + total.vitality * 7 + level * 9 + (gear?.hp ?? 0)) * (1 + p.maxHp);
  let maxQi = (30 + total.spirit * 6 + level * 4) * (1 + p.maxQi);
  let atk = (6 + total.might * 1.5 + level * 1.2 + (gear?.atk ?? 0)) * (1 + p.atk);
  let def = (2 + total.vitality * 0.9 + level * 0.8 + (gear?.def ?? 0)) * (1 + p.def);
  let speed = (100 + total.agility * 1.6 + level * 0.3) * (1 + p.speed);
  atk *= injury;
  def *= injury;
  speed *= injury;
  maxHp *= injury >= 1 ? 1 : 1 - (1 - injury) * 0.5;
  const crit = Math.min(60, 4 + total.fortune * 0.35 + total.agility * 0.15 + p.crit);
  const dodge = Math.min(45, 2 + total.agility * 0.45 + p.dodge);
  const qiRegen = (1.5 + total.spirit * 0.12) * (1 + p.qiRegen);
  return {
    maxHp: Math.round(maxHp),
    maxQi: Math.round(maxQi),
    atk: Math.round(atk * 10) / 10,
    def: Math.round(def * 10) / 10,
    speed: Math.round(speed * 10) / 10,
    crit: Math.round(crit * 10) / 10,
    dodge: Math.round(dodge * 10) / 10,
    qiRegen: Math.round(qiRegen * 100) / 100,
    learnRate: 1 + total.insight * 0.04,
    healPower: total.spirit * 6 + level * 4,
    antiBlight: p.antiBlight,
    lifesteal: p.lifesteal,
    resist: Math.min(0.9, p.resist),
    flee: p.flee,
    total,
  };
}

export function stanceMods(stance: Stance): { atk: number; def: number; dodge: number } {
  switch (stance) {
    case 'aggressive':
      return { atk: 1.15, def: 0.9, dodge: 0 };
    case 'defensive':
      return { atk: 0.9, def: 1.2, dodge: 0 };
    case 'evasive':
      return { atk: 0.92, def: 1, dodge: 12 };
    default:
      return { atk: 1, def: 1, dodge: 0 };
  }
}
