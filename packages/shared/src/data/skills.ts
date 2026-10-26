import type { Stats, WeaponType } from '../types';

export type SkillSchool = 'sword' | 'blade' | 'spear' | 'staff' | 'fist' | 'internal' | 'movement' | 'medicine' | 'poison';
export type SkillKind = 'active' | 'internal' | 'movement';
export type EffectKind = 'bleed' | 'poison' | 'stun' | 'slow' | 'guard' | 'buffAtk' | 'buffDef' | 'rot' | 'lifesteal' | 'qiDrain' | 'cleanse';

export interface SkillEffect {
  kind: EffectKind;
  /** Chance 0..1 for status effects. */
  chance: number;
  /** Duration in beats. */
  dur: number;
  /** Strength; meaning depends on the kind (fraction for buffs, multiplier for dots). */
  power: number;
}

export interface PassiveBonus {
  /** Fractions (0.1 = +10%). */
  maxHp?: number;
  maxQi?: number;
  atk?: number;
  def?: number;
  speed?: number;
  qiRegen?: number;
  /** Flat percentage points. */
  crit?: number;
  dodge?: number;
  /** Damage multiplier against Blight creatures. */
  antiBlight?: number;
  /** Fraction of damage dealt returned as health. */
  lifesteal?: number;
  /** Resist rot / poison (0..1). */
  resist?: number;
  /** Flee chance bonus (percentage points). */
  flee?: number;
}

export interface SkillDef {
  id: string;
  name: string;
  school: SkillSchool;
  kind: SkillKind;
  tier: number;
  glyph: string;
  desc: string;
  power?: number;
  hits?: number;
  target?: 'one' | 'all' | 'self';
  qiCost?: number;
  cooldown?: number;
  /** Heal as a multiple of caster Spirit * 6 + level * 4. */
  heal?: number;
  effects?: SkillEffect[];
  weapon?: WeaponType;
  passive?: PassiveBonus;
  /** Learning requirements. */
  req: { rank: number; stats?: Partial<Stats>; gold: number };
}

const g = (tier: number, base: number) => Math.round(base * Math.pow(tier, 2.4));

export const SKILLS: Record<string, SkillDef> = {};

function add(def: SkillDef): void {
  SKILLS[def.id] = def;
}

// ---- Sword ---------------------------------------------------------------
add({ id: 'sword_basic', name: 'Three-Strike Sword Form', school: 'sword', kind: 'active', tier: 1, glyph: '劍', weapon: 'sword', desc: 'The first form every sword student learns. Quick, reliable cuts.', power: 1.15, hits: 1, target: 'one', qiCost: 5, cooldown: 1, req: { rank: 1, gold: 30 } });
add({ id: 'sword_cloud', name: 'Flowing Cloud Slash', school: 'sword', kind: 'active', tier: 1, glyph: '雲', weapon: 'sword', desc: 'A sweeping cut that drags the foe off balance.', power: 1.45, hits: 1, target: 'one', qiCost: 9, cooldown: 3, effects: [{ kind: 'slow', chance: 0.35, dur: 3, power: 0.3 }], req: { rank: 1, stats: { agility: 8 }, gold: 90 } });
add({ id: 'sword_plum', name: 'Plum Blossom Thrust', school: 'sword', kind: 'active', tier: 2, glyph: '梅', weapon: 'sword', desc: 'Three lightning thrusts like falling petals. Each can crit.', power: 0.62, hits: 3, target: 'one', qiCost: 16, cooldown: 4, req: { rank: 2, stats: { agility: 14 }, gold: g(2, 80) } });
add({ id: 'sword_azure', name: 'Azure Cloud Sword', school: 'sword', kind: 'active', tier: 2, glyph: '蒼', weapon: 'sword', desc: 'The Azure Cloud Sect signature. A heavy cut that leaves you guarded.', power: 1.9, hits: 1, target: 'one', qiCost: 18, cooldown: 4, effects: [{ kind: 'guard', chance: 1, dur: 2, power: 0.25 }], req: { rank: 2, stats: { might: 14 }, gold: g(2, 100) } });
add({ id: 'sword_heaven', name: 'Heaven-Splitting Sword', school: 'sword', kind: 'active', tier: 3, glyph: '天', weapon: 'sword', desc: 'A single devastating stroke said to part clouds.', power: 3.2, hits: 1, target: 'one', qiCost: 32, cooldown: 6, req: { rank: 3, stats: { might: 22, insight: 14 }, gold: g(3, 90) } });
add({ id: 'sword_blades', name: 'Ten Thousand Blades Return', school: 'sword', kind: 'active', tier: 4, glyph: '萬', weapon: 'sword', desc: 'Qi-forged blades rain on every enemy.', power: 2.3, hits: 1, target: 'all', qiCost: 48, cooldown: 8, req: { rank: 4, stats: { spirit: 30, insight: 24 }, gold: g(4, 90) } });

// ---- Blade ---------------------------------------------------------------
add({ id: 'blade_wild', name: 'Wild Blade Cut', school: 'blade', kind: 'active', tier: 1, glyph: '刀', weapon: 'blade', desc: 'Brutal hacks that open wounds.', power: 1.3, hits: 1, target: 'one', qiCost: 7, cooldown: 2, effects: [{ kind: 'bleed', chance: 0.4, dur: 4, power: 0.22 }], req: { rank: 1, gold: 40 } });
add({ id: 'blade_blood', name: 'Bloodthirsty Blade', school: 'blade', kind: 'active', tier: 2, glyph: '血', weapon: 'blade', desc: 'Drinks the enemy\'s blood to mend its wielder.', power: 1.7, hits: 1, target: 'one', qiCost: 16, cooldown: 4, effects: [{ kind: 'lifesteal', chance: 1, dur: 0, power: 0.35 }], req: { rank: 2, stats: { might: 15 }, gold: g(2, 95) } });
add({ id: 'blade_moon', name: 'Crescent Moon Slash', school: 'blade', kind: 'active', tier: 3, glyph: '月', weapon: 'blade', desc: 'A moon-shaped wave of qi cuts through every foe.', power: 1.7, hits: 1, target: 'all', qiCost: 30, cooldown: 6, effects: [{ kind: 'bleed', chance: 0.3, dur: 4, power: 0.2 }], req: { rank: 3, stats: { might: 22, agility: 16 }, gold: g(3, 90) } });

// ---- Spear / Staff -----------------------------------------------------------
add({ id: 'spear_pierce', name: 'Piercing Spear', school: 'spear', kind: 'active', tier: 1, glyph: '槍', weapon: 'spear', desc: 'A long thrust that finds the gaps in armor.', power: 1.4, hits: 1, target: 'one', qiCost: 7, cooldown: 2, req: { rank: 1, gold: 40 } });
add({ id: 'spear_dragon', name: 'Dragon Coil Spear', school: 'spear', kind: 'active', tier: 3, glyph: '龍', weapon: 'spear', desc: 'The spear coils and strikes, rattling the foe.', power: 2.7, hits: 1, target: 'one', qiCost: 30, cooldown: 6, effects: [{ kind: 'stun', chance: 0.3, dur: 1, power: 1 }], req: { rank: 3, stats: { might: 20, agility: 18 }, gold: g(3, 90) } });
add({ id: 'staff_sweep', name: 'Sweeping Staff', school: 'staff', kind: 'active', tier: 1, glyph: '棍', weapon: 'staff', desc: 'A wide arc that strikes every enemy in reach.', power: 0.85, hits: 1, target: 'all', qiCost: 11, cooldown: 3, req: { rank: 1, gold: 50 } });
add({ id: 'staff_thunder', name: 'Thunder Staff', school: 'staff', kind: 'active', tier: 2, glyph: '雷', weapon: 'staff', desc: 'A crack like thunder that can stun.', power: 1.95, hits: 1, target: 'one', qiCost: 18, cooldown: 4, effects: [{ kind: 'stun', chance: 0.25, dur: 1, power: 1 }], req: { rank: 2, stats: { vitality: 14 }, gold: g(2, 95) } });

// ---- Fist / Palm ---------------------------------------------------------------
add({ id: 'fist_iron', name: 'Iron Palm Strike', school: 'fist', kind: 'active', tier: 1, glyph: '掌', weapon: 'fist', desc: 'A hardened palm strike.', power: 1.3, hits: 1, target: 'one', qiCost: 6, cooldown: 1, req: { rank: 1, gold: 30 } });
add({ id: 'fist_tiger', name: 'Tiger Claw', school: 'fist', kind: 'active', tier: 1, glyph: '虎', weapon: 'fist', desc: 'Raking claws that leave bleeding furrows.', power: 1.2, hits: 1, target: 'one', qiCost: 8, cooldown: 2, effects: [{ kind: 'bleed', chance: 0.45, dur: 4, power: 0.2 }], req: { rank: 1, stats: { might: 8 }, gold: 70 } });
add({ id: 'fist_thunder', name: 'Thunder Fist', school: 'fist', kind: 'active', tier: 2, glyph: '拳', weapon: 'fist', desc: 'A burst of force that hits like a hammer.', power: 2.05, hits: 1, target: 'one', qiCost: 18, cooldown: 4, req: { rank: 2, stats: { might: 16 }, gold: g(2, 95) } });
add({ id: 'palm_dragon', name: 'Dragon Subduing Palm', school: 'fist', kind: 'active', tier: 3, glyph: '降', weapon: 'fist', desc: 'A palm wave that rolls over all enemies and may stun.', power: 1.75, hits: 1, target: 'all', qiCost: 32, cooldown: 6, effects: [{ kind: 'stun', chance: 0.25, dur: 1, power: 1 }], req: { rank: 3, stats: { might: 22, vitality: 18 }, gold: g(3, 95) } });
add({ id: 'fist_mountain', name: 'Shattering Mountain Fist', school: 'fist', kind: 'active', tier: 4, glyph: '山', weapon: 'fist', desc: 'A single blow that could crack a cliff.', power: 3.9, hits: 1, target: 'one', qiCost: 46, cooldown: 7, req: { rank: 4, stats: { might: 32, vitality: 22 }, gold: g(4, 95) } });

// ---- Medicine / Poison -------------------------------------------------------------
add({ id: 'med_mend', name: 'Meridian Mending', school: 'medicine', kind: 'active', tier: 1, glyph: '醫', desc: 'Guide qi through your own meridians to heal wounds.', power: 0, target: 'self', qiCost: 12, cooldown: 4, heal: 1.1, req: { rank: 1, stats: { spirit: 8 }, gold: 80 } });
add({ id: 'med_needle', name: 'Needle of Revival', school: 'medicine', kind: 'active', tier: 2, glyph: '針', desc: 'Silver needles restore vitality in an instant.', power: 0, target: 'self', qiCost: 26, cooldown: 6, heal: 2.4, req: { rank: 2, stats: { spirit: 14, insight: 12 }, gold: g(2, 110) } });
add({ id: 'med_antidote', name: 'Purging Breath', school: 'medicine', kind: 'active', tier: 2, glyph: '淨', desc: 'Expel poison and rot from the body and recover a little health.', power: 0, target: 'self', qiCost: 14, cooldown: 5, heal: 0.6, effects: [{ kind: 'cleanse', chance: 1, dur: 0, power: 1 }], req: { rank: 2, stats: { insight: 12 }, gold: g(2, 90) } });
add({ id: 'poi_needle', name: 'Venom Needle', school: 'poison', kind: 'active', tier: 2, glyph: '毒', desc: 'A needle laced with slow poison.', power: 0.9, hits: 1, target: 'one', qiCost: 12, cooldown: 3, effects: [{ kind: 'poison', chance: 0.85, dur: 6, power: 0.28 }], req: { rank: 2, stats: { agility: 12, insight: 10 }, gold: g(2, 90) } });
add({ id: 'poi_mist', name: 'Rotting Mist', school: 'poison', kind: 'active', tier: 3, glyph: '霧', desc: 'A choking cloud poisons every enemy.', power: 0.7, hits: 1, target: 'all', qiCost: 28, cooldown: 6, effects: [{ kind: 'poison', chance: 0.9, dur: 6, power: 0.26 }], req: { rank: 3, stats: { insight: 20, spirit: 18 }, gold: g(3, 90) } });

// ---- Internal arts (one equipped at a time) -----------------------------------------
add({ id: 'int_dantian', name: 'Dantian Breathing', school: 'internal', kind: 'internal', tier: 1, glyph: '息', desc: 'The foundation of inner strength: a deeper Qi pool and faster recovery.', passive: { maxQi: 0.15, qiRegen: 0.25 }, req: { rank: 1, gold: 40 } });
add({ id: 'int_yang', name: 'Nine Yang Cultivation', school: 'internal', kind: 'internal', tier: 2, glyph: '陽', desc: 'A fierce yang art that sharpens every strike.', passive: { atk: 0.1, maxQi: 0.2, crit: 3 }, req: { rank: 2, stats: { spirit: 14 }, gold: g(2, 110) } });
add({ id: 'int_jade', name: 'Cold Jade Art', school: 'internal', kind: 'internal', tier: 2, glyph: '玉', desc: 'Cool, steady qi that hardens the body and steadies the mind.', passive: { def: 0.12, maxHp: 0.05, resist: 0.2 }, req: { rank: 2, stats: { vitality: 14 }, gold: g(2, 110) } });
add({ id: 'int_iron', name: 'Diamond Body', school: 'internal', kind: 'internal', tier: 2, glyph: '金', desc: 'An external-training art: skin like tempered iron.', passive: { maxHp: 0.2, def: 0.08 }, req: { rank: 2, stats: { vitality: 16 }, gold: g(2, 110) } });
add({ id: 'int_sun', name: 'Purifying Sun Method', school: 'internal', kind: 'internal', tier: 3, glyph: '日', desc: 'Orthodox sun-qi that burns away the Blight. Strong against Hollows and resists rot.', passive: { atk: 0.05, antiBlight: 0.3, resist: 0.5, qiRegen: 0.2 }, req: { rank: 3, stats: { spirit: 22, insight: 16 }, gold: g(3, 110) } });
add({ id: 'int_devour', name: 'Heaven Devouring Technique', school: 'internal', kind: 'internal', tier: 3, glyph: '噬', desc: 'A forbidden art that drinks life from every wound you cause.', passive: { lifesteal: 0.1, atk: 0.08, maxQi: 0.1 }, req: { rank: 3, stats: { spirit: 22, might: 20 }, gold: g(3, 120) } });

// ---- Movement arts ---------------------------------------------------------------------
add({ id: 'mov_light', name: 'Lightness Skill', school: 'movement', kind: 'movement', tier: 1, glyph: '輕', desc: 'Light feet: harder to hit and quicker to act.', passive: { dodge: 5, speed: 0.04, flee: 8 }, req: { rank: 1, gold: 50 } });
add({ id: 'mov_cloud', name: 'Cloud Stepping', school: 'movement', kind: 'movement', tier: 2, glyph: '步', desc: 'Drifting footwork: good for dodging and escaping a bad fight.', passive: { dodge: 8, speed: 0.06, flee: 20 }, req: { rank: 2, stats: { agility: 14 }, gold: g(2, 100) } });
add({ id: 'mov_shadow', name: 'Shadow Leap', school: 'movement', kind: 'movement', tier: 3, glyph: '影', desc: 'Blink between shadows.', passive: { dodge: 12, speed: 0.1, flee: 30 }, req: { rank: 3, stats: { agility: 22 }, gold: g(3, 100) } });

/** Skills taught by factions, by school. */
export const SKILL_LIST = Object.values(SKILLS);

export function skillPower(def: SkillDef, level: number): number {
  return (def.power ?? 0) * (1 + 0.06 * (level - 1));
}

export function skillQiCost(def: SkillDef, level: number): number {
  return Math.max(1, Math.round((def.qiCost ?? 0) * (1 - 0.01 * (level - 1))));
}

export const SKILL_MAX_LEVEL = 10;

export function skillXpToNext(level: number): number {
  return Math.round(30 * Math.pow(level, 1.5));
}

/** Monster-only attacks. */
export const MONSTER_SKILLS: Record<string, SkillDef> = {};
function m(def: Omit<SkillDef, 'kind' | 'tier' | 'glyph' | 'school' | 'req' | 'desc'> & { desc?: string }): void {
  MONSTER_SKILLS[def.id] = { kind: 'active', tier: 1, glyph: '?', school: 'fist', req: { rank: 1, gold: 0 }, desc: def.desc ?? '', ...def };
}
m({ id: 'm_bite', name: 'Bite', power: 1, hits: 1, target: 'one', qiCost: 0, cooldown: 0, effects: [{ kind: 'bleed', chance: 0.15, dur: 3, power: 0.18 }] });
m({ id: 'm_claw', name: 'Claw', power: 1.1, hits: 1, target: 'one', qiCost: 0, cooldown: 0 });
m({ id: 'm_pounce', name: 'Pounce', power: 1.6, hits: 1, target: 'one', qiCost: 0, cooldown: 4, effects: [{ kind: 'stun', chance: 0.2, dur: 1, power: 1 }] });
m({ id: 'm_gore', name: 'Gore', power: 1.5, hits: 1, target: 'one', qiCost: 0, cooldown: 3, effects: [{ kind: 'bleed', chance: 0.3, dur: 3, power: 0.2 }] });
m({ id: 'm_venom', name: 'Venom Fang', power: 0.9, hits: 1, target: 'one', qiCost: 0, cooldown: 3, effects: [{ kind: 'poison', chance: 0.8, dur: 5, power: 0.25 }] });
m({ id: 'm_roar', name: 'Roar', power: 0, target: 'self', qiCost: 0, cooldown: 7, effects: [{ kind: 'buffAtk', chance: 1, dur: 4, power: 0.25 }] });
m({ id: 'm_slam', name: 'Crushing Slam', power: 1.9, hits: 1, target: 'one', qiCost: 0, cooldown: 5, effects: [{ kind: 'stun', chance: 0.35, dur: 1, power: 1 }] });
m({ id: 'm_slash', name: 'Rusty Slash', power: 1.15, hits: 1, target: 'one', qiCost: 0, cooldown: 0, effects: [{ kind: 'bleed', chance: 0.2, dur: 3, power: 0.18 }] });
m({ id: 'm_arrow', name: 'Arrow Shot', power: 1.25, hits: 1, target: 'one', qiCost: 0, cooldown: 1 });
m({ id: 'm_rally', name: 'Rally Cry', power: 0, target: 'self', qiCost: 0, cooldown: 8, effects: [{ kind: 'buffDef', chance: 1, dur: 4, power: 0.3 }] });
m({ id: 'm_rot', name: 'Rotting Touch', power: 1, hits: 1, target: 'one', qiCost: 0, cooldown: 2, effects: [{ kind: 'rot', chance: 0.55, dur: 5, power: 0.2 }] });
m({ id: 'm_infect', name: 'Plague Breath', power: 0.75, hits: 1, target: 'all', qiCost: 0, cooldown: 6, effects: [{ kind: 'rot', chance: 0.6, dur: 5, power: 0.18 }] });
m({ id: 'm_sunder', name: 'Soul Sunder', power: 2.4, hits: 1, target: 'one', qiCost: 0, cooldown: 6, effects: [{ kind: 'qiDrain', chance: 1, dur: 0, power: 14 }] });

export function getSkill(id: string): SkillDef | undefined {
  return SKILLS[id] ?? MONSTER_SKILLS[id];
}
