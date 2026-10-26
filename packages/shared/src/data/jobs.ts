import type { JobId } from '../types';
import type { WorkSiteKind } from '../terrain';
import { WEAPON_TYPES } from '../types';

export interface JobDef {
  id: JobId;
  name: string;
  glyph: string;
  desc: string;
  mode: 'gather' | 'craft';
  site: WorkSiteKind;
}

export const JOB_DEFS: Record<JobId, JobDef> = {
  herbalist: { id: 'herbalist', name: 'Herbalist', glyph: '草', desc: 'Gather medicinal herbs for alchemists and healers.', mode: 'gather', site: 'herbHut' },
  miner: { id: 'miner', name: 'Miner', glyph: '礦', desc: 'Dig ore from the mountains for smiths.', mode: 'gather', site: 'mine' },
  farmer: { id: 'farmer', name: 'Farmer', glyph: '農', desc: 'Grow grain that keeps towns fed. Harvests depend on the season.', mode: 'gather', site: 'farm' },
  blacksmith: { id: 'blacksmith', name: 'Blacksmith', glyph: '鍛', desc: 'Forge weapons and armor at a smithy.', mode: 'craft', site: 'smithy' },
  alchemist: { id: 'alchemist', name: 'Alchemist', glyph: '丹', desc: 'Brew pills, antidotes and breakthrough elixirs at an alchemy lab.', mode: 'craft', site: 'alchemyLab' },
};

export const JOB_MAX_LEVEL = 20;

export function jobXpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.3));
}

export interface ShiftYield {
  items: [string, number][];
  gold: number;
  xp: number;
}

/** Output per world-independent real hour of work. */
export function shiftYieldPerHour(job: JobId, level: number, seasonMult: number): ShiftYield {
  switch (job) {
    case 'herbalist':
      return { items: [['herb', (5 + level * 1.5) * seasonMult], ['herb_rare', 0.04 * level * seasonMult]], gold: 10 + level * 3, xp: 60 };
    case 'miner':
      return { items: [['ore_iron', 4 + level * 1.2], ['ore_silver', 0.05 * level]], gold: 14 + level * 3, xp: 60 };
    case 'farmer':
      return { items: [['grain', (10 + level * 2) * seasonMult]], gold: 8 + level * 2, xp: 60 };
    default:
      return { items: [], gold: 0, xp: 0 };
  }
}

export interface Recipe {
  id: string;
  job: JobId;
  name: string;
  level: number;
  inputs: [string, number][];
  output: [string, number];
  seconds: number;
  xp: number;
  /** Equipment recipes roll rarity. */
  gear?: boolean;
}

export const RECIPES: Record<string, Recipe> = {};
function recipe(r: Recipe): void {
  RECIPES[r.id] = r;
}

recipe({ id: 'r_ingot', job: 'blacksmith', name: 'Smelt Iron Ingot', level: 1, inputs: [['ore_iron', 3]], output: ['ingot_iron', 1], seconds: 12, xp: 6 });
for (const wt of WEAPON_TYPES) {
  const first: [string, number][] = wt === 'fist' ? [['cloth', 3], ['hide', 2]] : [['ingot_iron', 2], ['hide', 1]];
  recipe({ id: `r_w_${wt}_1`, job: 'blacksmith', name: `Forge ${wt} (tier 1)`, level: 1, inputs: first, output: [`w_${wt}_1`, 1], seconds: 40, xp: 14, gear: true });
  recipe({ id: `r_w_${wt}_2`, job: 'blacksmith', name: `Forge ${wt} (tier 2)`, level: 6, inputs: [['ingot_iron', 5], ['hide', 2], ['fang', 2]], output: [`w_${wt}_2`, 1], seconds: 90, xp: 40, gear: true });
  recipe({ id: `r_w_${wt}_3`, job: 'blacksmith', name: `Forge ${wt} (tier 3)`, level: 12, inputs: [['ingot_iron', 10], ['ore_silver', 3], ['hide', 4]], output: [`w_${wt}_3`, 1], seconds: 200, xp: 90, gear: true });
  recipe({ id: `r_w_${wt}_4`, job: 'blacksmith', name: `Forge ${wt} (tier 4)`, level: 17, inputs: [['ingot_iron', 16], ['ore_silver', 8], ['blight_core', 2]], output: [`w_${wt}_4`, 1], seconds: 420, xp: 160, gear: true });
}
recipe({ id: 'r_o_1', job: 'blacksmith', name: 'Sew Leather Vest', level: 1, inputs: [['hide', 4], ['cloth', 2]], output: ['o_1', 1], seconds: 40, xp: 14, gear: true });
recipe({ id: 'r_o_2', job: 'blacksmith', name: 'Craft Cloud Robe', level: 6, inputs: [['hide', 6], ['ingot_iron', 3], ['cloth', 3]], output: ['o_2', 1], seconds: 90, xp: 40, gear: true });
recipe({ id: 'r_o_3', job: 'blacksmith', name: 'Craft Silk Battle Robe', level: 12, inputs: [['hide', 8], ['cloth', 8], ['ore_silver', 2]], output: ['o_3', 1], seconds: 200, xp: 90, gear: true });
recipe({ id: 'r_o_4', job: 'blacksmith', name: 'Craft Immortal Garment', level: 17, inputs: [['hide', 12], ['cloth', 12], ['ore_silver', 6], ['spirit_dew', 2]], output: ['o_4', 1], seconds: 420, xp: 160, gear: true });

recipe({ id: 'r_meat', job: 'alchemist', name: 'Roast Meat', level: 1, inputs: [['meat', 2]], output: ['cooked_meat', 2], seconds: 10, xp: 4 });
recipe({ id: 'r_heal_s', job: 'alchemist', name: 'Minor Healing Pill', level: 1, inputs: [['herb', 3]], output: ['pill_heal_s', 3], seconds: 20, xp: 8 });
recipe({ id: 'r_qi_s', job: 'alchemist', name: 'Minor Qi Pill', level: 1, inputs: [['herb', 4]], output: ['pill_qi_s', 3], seconds: 20, xp: 8 });
recipe({ id: 'r_break_1', job: 'alchemist', name: 'Foundation Pill', level: 3, inputs: [['herb', 10], ['herb_rare', 2], ['blight_core', 1]], output: ['pill_break_1', 1], seconds: 150, xp: 60 });
recipe({ id: 'r_antidote', job: 'alchemist', name: 'Antidote', level: 4, inputs: [['herb', 3], ['blight_core', 1]], output: ['antidote', 2], seconds: 45, xp: 24 });
recipe({ id: 'r_heal_m', job: 'alchemist', name: 'Healing Pill', level: 5, inputs: [['herb', 4], ['herb_rare', 1]], output: ['pill_heal_m', 2], seconds: 60, xp: 30 });
recipe({ id: 'r_qi_m', job: 'alchemist', name: 'Qi Pill', level: 6, inputs: [['herb', 4], ['herb_rare', 1]], output: ['pill_qi_m', 2], seconds: 60, xp: 30 });
recipe({ id: 'r_train', job: 'alchemist', name: 'Cultivation Pill', level: 7, inputs: [['herb_rare', 2], ['herb', 6]], output: ['pill_train', 1], seconds: 90, xp: 45 });
recipe({ id: 'r_break_2', job: 'alchemist', name: 'Meridian-Opening Elixir', level: 8, inputs: [['herb_rare', 6], ['blight_core', 3], ['ore_silver', 1]], output: ['pill_break_2', 1], seconds: 400, xp: 120 });
recipe({ id: 'r_heal_l', job: 'alchemist', name: 'Greater Healing Pill', level: 10, inputs: [['herb_rare', 3], ['blight_core', 1]], output: ['pill_heal_l', 2], seconds: 120, xp: 80 });
recipe({ id: 'r_break_3', job: 'alchemist', name: 'Marrow-Cleansing Pill', level: 13, inputs: [['herb_rare', 12], ['blight_core', 6], ['spirit_dew', 2]], output: ['pill_break_3', 1], seconds: 900, xp: 220 });
recipe({ id: 'r_break_4', job: 'alchemist', name: 'Heavenly Qi Pill', level: 18, inputs: [['herb_rare', 24], ['blight_core', 12], ['spirit_dew', 6]], output: ['pill_break_4', 1], seconds: 1800, xp: 420 });

export const RECIPE_LIST = Object.values(RECIPES);

/** Seasonal farm/herb multiplier. Index = season (Spring..Winter). */
export const SEASON_YIELD: Record<'herbalist' | 'farmer', number[]> = {
  herbalist: [1.2, 1.1, 1, 0.5],
  farmer: [1, 1.2, 1.5, 0.25],
};
