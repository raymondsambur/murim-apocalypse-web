import type { MonsterFamily } from '../terrain';
import type { Rng } from '../rng';
import { makeCombatant, type Combatant } from '../combat';

export interface LootEntry {
  item: string;
  chance: number;
  min: number;
  max: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  family: MonsterFamily;
  /** Client sprite key. */
  sprite: string;
  glyph: string;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  xp: number;
  gold: [number, number];
  skills: string[];
  loot: LootEntry[];
  minLevel: number;
  maxLevel: number;
  /** Aggro radius in tiles. */
  aggro: number;
  /** Relative spawn frequency. */
  weight: number;
  elite?: boolean;
  boss?: boolean;
  /** Typical pack size multiplier (1 = uses spawn point size). */
  packy?: boolean;
}

export const MONSTERS: Record<string, MonsterDef> = {};

function add(d: MonsterDef): void {
  MONSTERS[d.id] = d;
}

// ---- Beasts -----------------------------------------------------------------
add({ id: 'boar', name: 'Wild Boar', family: 'beast', sprite: 'boar', glyph: '猪', hp: 52, atk: 10, def: 4, speed: 92, xp: 12, gold: [1, 4], skills: ['m_gore', 'm_bite'], loot: [{ item: 'meat', chance: 0.6, min: 1, max: 2 }, { item: 'hide', chance: 0.4, min: 1, max: 1 }], minLevel: 1, maxLevel: 8, aggro: 3, weight: 10 });
add({ id: 'wolf', name: 'Gray Wolf', family: 'beast', sprite: 'wolf', glyph: '狼', hp: 46, atk: 11, def: 3, speed: 112, xp: 14, gold: [1, 5], skills: ['m_bite', 'm_pounce'], loot: [{ item: 'fang', chance: 0.4, min: 1, max: 1 }, { item: 'hide', chance: 0.35, min: 1, max: 1 }, { item: 'meat', chance: 0.3, min: 1, max: 1 }], minLevel: 2, maxLevel: 14, aggro: 5, weight: 10, packy: true });
add({ id: 'viper', name: 'Bamboo Viper', family: 'beast', sprite: 'snake', glyph: '蛇', hp: 36, atk: 10, def: 2, speed: 104, xp: 14, gold: [1, 4], skills: ['m_venom', 'm_bite'], loot: [{ item: 'herb', chance: 0.3, min: 1, max: 2 }, { item: 'fang', chance: 0.25, min: 1, max: 1 }], minLevel: 3, maxLevel: 16, aggro: 3, weight: 6 });
add({ id: 'bear', name: 'Black Bear', family: 'beast', sprite: 'bear', glyph: '熊', hp: 130, atk: 17, def: 9, speed: 84, xp: 24, gold: [3, 10], skills: ['m_claw', 'm_slam'], loot: [{ item: 'hide', chance: 0.7, min: 1, max: 2 }, { item: 'meat', chance: 0.6, min: 1, max: 3 }], minLevel: 8, maxLevel: 24, aggro: 4, weight: 6 });
add({ id: 'tiger', name: 'Mountain Tiger', family: 'beast', sprite: 'tiger', glyph: '虎', hp: 230, atk: 25, def: 11, speed: 118, xp: 40, gold: [10, 30], skills: ['m_pounce', 'm_claw', 'm_roar'], loot: [{ item: 'hide', chance: 0.9, min: 2, max: 3 }, { item: 'fang', chance: 0.8, min: 1, max: 2 }, { item: 'herb_rare', chance: 0.2, min: 1, max: 1 }], minLevel: 14, maxLevel: 40, aggro: 6, weight: 4, elite: true });

// ---- Bandits ------------------------------------------------------------------
add({ id: 'thug', name: 'Bandit Thug', family: 'bandit', sprite: 'bandit', glyph: '匪', hp: 66, atk: 12, def: 6, speed: 98, xp: 16, gold: [4, 14], skills: ['m_slash'], loot: [{ item: 'insignia', chance: 0.25, min: 1, max: 1 }, { item: 'cloth', chance: 0.2, min: 1, max: 1 }, { item: 'wine', chance: 0.15, min: 1, max: 1 }], minLevel: 3, maxLevel: 18, aggro: 5, weight: 10, packy: true });
add({ id: 'archer', name: 'Bandit Archer', family: 'bandit', sprite: 'bandit', glyph: '弓', hp: 52, atk: 15, def: 4, speed: 108, xp: 18, gold: [5, 16], skills: ['m_arrow'], loot: [{ item: 'insignia', chance: 0.25, min: 1, max: 1 }, { item: 'hide', chance: 0.15, min: 1, max: 1 }], minLevel: 5, maxLevel: 22, aggro: 7, weight: 7 });
add({ id: 'swordsman', name: 'Bandit Swordsman', family: 'bandit', sprite: 'bandit', glyph: '劍', hp: 96, atk: 17, def: 9, speed: 106, xp: 24, gold: [8, 24], skills: ['m_slash', 'm_rally'], loot: [{ item: 'insignia', chance: 0.35, min: 1, max: 1 }, { item: 'pill_heal_s', chance: 0.15, min: 1, max: 1 }], minLevel: 8, maxLevel: 28, aggro: 5, weight: 6 });
add({ id: 'chief', name: 'Bandit Chief', family: 'bandit', sprite: 'bandit_boss', glyph: '首', hp: 250, atk: 24, def: 14, speed: 104, xp: 42, gold: [30, 90], skills: ['m_slam', 'm_rally', 'm_slash'], loot: [{ item: 'insignia', chance: 1, min: 1, max: 2 }, { item: 'pill_heal_m', chance: 0.4, min: 1, max: 2 }, { item: 'ore_silver', chance: 0.4, min: 1, max: 2 }], minLevel: 12, maxLevel: 38, aggro: 6, weight: 3, elite: true });

// ---- Blight ---------------------------------------------------------------------
add({ id: 'hollow', name: 'Hollow Villager', family: 'blight', sprite: 'hollow', glyph: '空', hp: 82, atk: 12, def: 5, speed: 80, xp: 18, gold: [0, 6], skills: ['m_claw', 'm_rot'], loot: [{ item: 'cloth', chance: 0.3, min: 1, max: 1 }, { item: 'blight_core', chance: 0.07, min: 1, max: 1 }], minLevel: 3, maxLevel: 26, aggro: 4, weight: 12, packy: true });
add({ id: 'hound', name: 'Blight Hound', family: 'blight', sprite: 'wolf_blight', glyph: '犬', hp: 72, atk: 15, def: 4, speed: 120, xp: 22, gold: [0, 4], skills: ['m_bite', 'm_rot'], loot: [{ item: 'fang', chance: 0.3, min: 1, max: 1 }, { item: 'blight_core', chance: 0.09, min: 1, max: 1 }], minLevel: 6, maxLevel: 30, aggro: 6, weight: 8, packy: true });
add({ id: 'monk', name: 'Rotting Monk', family: 'blight', sprite: 'hollow_monk', glyph: '僧', hp: 180, atk: 19, def: 12, speed: 92, xp: 34, gold: [4, 18], skills: ['m_rot', 'm_sunder', 'm_rally'], loot: [{ item: 'blight_core', chance: 0.18, min: 1, max: 1 }, { item: 'herb_rare', chance: 0.12, min: 1, max: 1 }, { item: 'spirit_dew', chance: 0.04, min: 1, max: 1 }], minLevel: 14, maxLevel: 40, aggro: 5, weight: 6 });
add({ id: 'brute', name: 'Blight Brute', family: 'blight', sprite: 'hollow_brute', glyph: '獸', hp: 400, atk: 28, def: 18, speed: 84, xp: 70, gold: [12, 40], skills: ['m_slam', 'm_infect'], loot: [{ item: 'blight_core', chance: 0.8, min: 1, max: 2 }, { item: 'spirit_dew', chance: 0.15, min: 1, max: 1 }], minLevel: 20, maxLevel: 48, aggro: 5, weight: 3, elite: true });
add({ id: 'bearer', name: 'Plague Bearer', family: 'blight', sprite: 'hollow_monk', glyph: '疫', hp: 290, atk: 24, def: 14, speed: 96, xp: 55, gold: [10, 30], skills: ['m_infect', 'm_rot'], loot: [{ item: 'blight_core', chance: 0.5, min: 1, max: 1 }, { item: 'antidote', chance: 0.25, min: 1, max: 1 }], minLevel: 26, maxLevel: 52, aggro: 6, weight: 3 });
add({ id: 'lord', name: 'Blight Lord', family: 'blight', sprite: 'hollow_lord', glyph: '王', hp: 1500, atk: 38, def: 26, speed: 100, xp: 400, gold: [200, 500], skills: ['m_infect', 'm_sunder', 'm_slam', 'm_roar'], loot: [{ item: 'blight_core', chance: 1, min: 3, max: 5 }, { item: 'spirit_dew', chance: 0.9, min: 1, max: 3 }], minLevel: 30, maxLevel: 60, aggro: 7, weight: 0, elite: true, boss: true });

export interface MonsterStats {
  maxHp: number;
  atk: number;
  def: number;
  speed: number;
  crit: number;
  dodge: number;
  xp: number;
  gold: [number, number];
}

/** Global health multiplier so fights last long enough for builds to matter. */
export const HP_SCALE = 3.2;

export function monsterStats(def: MonsterDef, level: number): MonsterStats {
  const l = level - 1;
  const xpMult = def.boss ? 8 : def.elite ? 2.2 : 1;
  return {
    maxHp: Math.round(def.hp * HP_SCALE * (1 + 0.18 * l)),
    atk: def.atk * (1 + 0.092 * l),
    def: def.def * (1 + 0.095 * l),
    speed: def.speed + level * 0.15,
    crit: 4 + level * 0.1,
    dodge: 2 + level * 0.12,
    xp: Math.round((def.xp + level * 4) * xpMult),
    gold: [Math.round(def.gold[0] * (1 + 0.1 * l)), Math.round(def.gold[1] * (1 + 0.1 * l))],
  };
}

export function buildMonsterCombatant(def: MonsterDef, level: number, id: number, side: 0 | 1 = 1): Combatant {
  const s = monsterStats(def, level);
  return makeCombatant({
    id,
    side,
    name: def.name,
    isPlayer: false,
    blighted: def.family === 'blight',
    level,
    maxHp: s.maxHp,
    atk: s.atk,
    def: s.def,
    speed: s.speed,
    crit: s.crit,
    dodge: s.dodge,
    maxQi: 0,
    qi: 0,
    skills: def.skills.map((sk) => ({ id: sk, level: 1, cd: 0 })),
    meter: 30 + (id % 7) * 5,
  });
}

export function levelForDanger(danger: number, rng: Rng): number {
  return Math.max(1, Math.min(48, Math.round(danger * 1.55 - 1) + rng.int(-1, 1)));
}

export function pickSpecies(rng: Rng, family: MonsterFamily, level: number, allowElite = false): MonsterDef {
  const all = Object.values(MONSTERS).filter((m) => m.family === family && !m.boss && (allowElite || !m.elite));
  const fit = all.filter((m) => level >= m.minLevel && level <= m.maxLevel);
  const pool = fit.length ? fit : [...all].sort((a, b) => Math.abs(a.minLevel - level) - Math.abs(b.minLevel - level)).slice(0, 2);
  return rng.weighted(pool.map((m) => [m, Math.max(1, m.weight)] as const));
}
