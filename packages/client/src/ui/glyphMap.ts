/**
 * Maps the CJK `glyph` characters that live in the shared game data (items, skills, monsters, jobs) to icon names.
 * The characters are NEVER rendered: the UI only ever shows the icon this table resolves to. This file is the one
 * place in the client (besides tests) that is allowed to contain CJK characters, because they are table keys.
 *
 * Resolution order for an item: id override -> glyph -> kind default. Skills: glyph -> school. Unknown input falls back
 * to a generic icon, never to the glyph character.
 */
import type { IconName } from './icons';

export interface GlyphItem {
  id: string;
  kind: string;
  glyph: string;
  weaponType?: string;
}
export interface GlyphSkill {
  id: string;
  school: string;
  glyph: string;
}
export interface GlyphMonster {
  id: string;
  family: string;
  glyph: string;
}
export interface GlyphJob {
  id: string;
  glyph: string;
}

/** Item glyph -> icon. */
export const ITEM_GLYPH_ICON: Record<string, IconName> = {
  劍: 'sword',
  刀: 'blade',
  槍: 'spear',
  棍: 'staff',
  拳: 'fist',
  衣: 'outfit',
  環: 'ring',
  帶: 'sash',
  骨: 'charm',
  佩: 'pendant',
  印: 'stamp',
  錢: 'coin',
  草: 'herb',
  蔘: 'ginseng',
  礦: 'ore',
  銀: 'ore',
  錠: 'ingot',
  皮: 'hide',
  牙: 'fang',
  肉: 'meat',
  穀: 'grain',
  布: 'cloth',
  酒: 'wine',
  令: 'badge',
  核: 'core',
  露: 'dew',
  丹: 'pillHeal',
  解: 'antidote',
  烤: 'cookedMeat',
  突: 'pillBreak',
  修: 'pillTrain',
  書: 'manual',
};

/** Specific item ids whose glyph is shared with different things (e.g. every pill uses the same character). */
export const ITEM_ID_ICON: Record<string, IconName> = {
  pill_qi_s: 'pillQi',
  pill_qi_m: 'pillQi',
};

const KIND_ICON: Record<string, IconName> = {
  weapon: 'sword',
  outfit: 'outfit',
  accessory: 'ring',
  material: 'ore',
  consumable: 'pillHeal',
  manual: 'manual',
};

export function itemIconName(def: GlyphItem | undefined | null): IconName {
  if (!def) return 'unknown';
  return ITEM_ID_ICON[def.id] ?? ITEM_GLYPH_ICON[def.glyph] ?? (def.weaponType ? (def.weaponType as IconName) : undefined) ?? KIND_ICON[def.kind] ?? 'unknown';
}

/** Skill glyph -> icon. */
export const SKILL_GLYPH_ICON: Record<string, IconName> = {
  劍: 'sword',
  雲: 'cloud',
  梅: 'blossom',
  蒼: 'sword',
  天: 'sparkle',
  萬: 'swords',
  刀: 'blade',
  血: 'bleed',
  月: 'moon',
  槍: 'spear',
  龍: 'dragon',
  棍: 'staff',
  雷: 'bolt',
  掌: 'palm',
  虎: 'claw',
  拳: 'fist',
  降: 'palm',
  山: 'mountain',
  醫: 'medicine',
  針: 'needle',
  淨: 'dew',
  毒: 'poison',
  霧: 'fog',
  息: 'breath',
  陽: 'sun',
  玉: 'jade',
  金: 'shield',
  日: 'sun',
  噬: 'devour',
  輕: 'feather',
  步: 'footprint',
  影: 'shadow',
  擊: 'fist',
};

export const SCHOOL_ICON: Record<string, IconName> = {
  sword: 'sword',
  blade: 'blade',
  spear: 'spear',
  staff: 'staff',
  fist: 'palm',
  internal: 'internal',
  movement: 'movement',
  medicine: 'medicine',
  poison: 'poison',
};

export function skillIconName(def: GlyphSkill | undefined | null): IconName {
  if (!def) return 'unknown';
  return SKILL_GLYPH_ICON[def.glyph] ?? SCHOOL_ICON[def.school] ?? 'unknown';
}

/** Monster glyph -> icon. */
export const MONSTER_GLYPH_ICON: Record<string, IconName> = {
  猪: 'paw',
  狼: 'paw',
  蛇: 'poison',
  熊: 'paw',
  虎: 'claw',
  匪: 'mask',
  弓: 'bow',
  劍: 'sword',
  首: 'crown',
  空: 'hollow',
  犬: 'paw',
  僧: 'hollow',
  獸: 'paw',
  疫: 'rot',
  王: 'crown',
};

const FAMILY_ICON: Record<string, IconName> = { beast: 'paw', bandit: 'mask', blight: 'hollow' };

export function monsterIconName(def: GlyphMonster | undefined | null): IconName {
  if (!def) return 'paw';
  return MONSTER_GLYPH_ICON[def.glyph] ?? FAMILY_ICON[def.family] ?? 'paw';
}

/** Job glyph -> icon. */
export const JOB_GLYPH_ICON: Record<string, IconName> = {
  草: 'herb',
  礦: 'pickaxe',
  農: 'grain',
  鍛: 'anvil',
  丹: 'cauldron',
};

export const JOB_ICON: Record<string, IconName> = {
  herbalist: 'herb',
  miner: 'pickaxe',
  farmer: 'grain',
  blacksmith: 'anvil',
  alchemist: 'cauldron',
};

export function jobIconName(def: GlyphJob | undefined | null): IconName {
  if (!def) return 'unknown';
  return JOB_ICON[def.id] ?? JOB_GLYPH_ICON[def.glyph] ?? 'unknown';
}
