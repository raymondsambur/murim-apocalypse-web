import type { AffixKey, EquipSlot, Equipment, ItemStack, Rarity, StatKey, Stats, WeaponType } from '../types';
import { RARITY_MULT, STAT_KEYS, WEAPON_TYPES } from '../types';
import type { Rng } from '../rng';
import { SKILLS } from './skills';

export type ItemKind = 'weapon' | 'outfit' | 'accessory' | 'material' | 'consumable' | 'manual';

export interface ItemUse {
  heal?: number;
  qi?: number;
  cleanse?: boolean;
  /** Rank this pill lets you leave. */
  breakthrough?: number;
  teach?: string;
  /** Training XP granted. */
  xp?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  glyph: string;
  color: string;
  tier: number;
  value: number;
  stack: number;
  desc: string;
  slot?: EquipSlot;
  weaponType?: WeaponType;
  atk?: number;
  def?: number;
  hp?: number;
  stat?: { key: StatKey; value: number };
  use?: ItemUse;
}

export const ITEMS: Record<string, ItemDef> = {};

function add(d: ItemDef): void {
  ITEMS[d.id] = d;
}

// ---- Weapons ----------------------------------------------------------------------
const WEAPON_NAMES: Record<WeaponType, string[]> = {
  sword: ['Iron Jian', 'Steel Jian', 'Cloud-Pattern Sword', 'Azure Dragon Sword', 'Heaven-Piercing Sword'],
  blade: ['Iron Saber', 'Steel Dao', 'Crescent Blade', 'Blood Moon Blade', 'Demon-Cleaver'],
  spear: ['Wooden Spear', 'Iron Spear', 'Tiger-Head Spear', 'Dragon Coil Lance', 'Sky-Piercer'],
  staff: ['Oak Staff', 'Ironwood Staff', 'Bronze Staff', 'Thunder Staff', 'Immortal\'s Rod'],
  fist: ['Cloth Wraps', 'Iron Knuckles', 'Tiger Gauntlets', 'Dragon-Scale Gloves', 'Heaven\'s Fists'],
};
const WEAPON_GLYPH: Record<WeaponType, string> = { sword: '劍', blade: '刀', spear: '槍', staff: '棍', fist: '拳' };
export const WEAPON_ATK = [5, 12, 23, 38, 60];
const VALUES = [30, 120, 420, 1400, 4500];

for (const wt of WEAPON_TYPES) {
  for (let t = 1; t <= 5; t++) {
    add({
      id: `w_${wt}_${t}`,
      name: WEAPON_NAMES[wt][t - 1],
      kind: 'weapon',
      slot: 'weapon',
      weaponType: wt,
      glyph: WEAPON_GLYPH[wt],
      color: '#c9c3b2',
      tier: t,
      value: VALUES[t - 1],
      stack: 1,
      atk: WEAPON_ATK[t - 1],
      desc: `A tier ${t} ${wt} weapon. Skills of the ${wt} school gain 12% power while wielded.`,
    });
  }
}

// ---- Outfits ---------------------------------------------------------------------------
const OUTFITS = ['Hemp Clothes', 'Leather Vest', 'Cloud Robe', 'Silk Battle Robe', 'Immortal Garment'];
const OUTFIT_DEF = [4, 9, 17, 28, 44];
const OUTFIT_HP = [0, 20, 45, 90, 160];
for (let t = 1; t <= 5; t++) {
  add({ id: `o_${t}`, name: OUTFITS[t - 1], kind: 'outfit', slot: 'outfit', glyph: '衣', color: '#9aa3b5', tier: t, value: VALUES[t - 1], stack: 1, def: OUTFIT_DEF[t - 1], hp: OUTFIT_HP[t - 1], desc: `Tier ${t} outer garment.` });
}

// ---- Accessories -----------------------------------------------------------------------
const ACC: Record<StatKey, string> = {
  might: 'Iron Ring',
  agility: 'Silk Sash',
  vitality: 'Bone Charm',
  spirit: 'Jade Pendant',
  insight: 'Scholar\'s Seal',
  fortune: 'Lucky Coin',
};
const ACC_GLYPH: Record<StatKey, string> = { might: '環', agility: '帶', vitality: '骨', spirit: '佩', insight: '印', fortune: '錢' };
const ACC_VAL = [3, 6, 10, 16];
for (const key of STAT_KEYS) {
  for (let t = 1; t <= 4; t++) {
    add({ id: `a_${key}_${t}`, name: `${['Plain', 'Fine', 'Master\'s', 'Heavenly'][t - 1]} ${ACC[key]}`, kind: 'accessory', slot: 'accessory', glyph: ACC_GLYPH[key], color: '#d9b867', tier: t, value: VALUES[t - 1] * 0.8, stack: 1, stat: { key, value: ACC_VAL[t - 1] }, desc: `Grants +${ACC_VAL[t - 1]} ${key}.` });
  }
}

// ---- Materials ---------------------------------------------------------------------------
const mat = (id: string, name: string, glyph: string, color: string, tier: number, value: number, desc: string) =>
  add({ id, name, kind: 'material', glyph, color, tier, value, stack: 99, desc });
mat('herb', 'Qi-Gathering Grass', '草', '#7ec26b', 1, 6, 'A common medicinal herb. Alchemists use it in most pills.');
mat('herb_rare', 'Hundred-Year Ginseng', '蔘', '#d9a35a', 3, 70, 'A rare root rich in vital energy.');
mat('ore_iron', 'Iron Ore', '礦', '#8c93a1', 1, 8, 'Raw iron ore.');
mat('ore_silver', 'Silver Ore', '銀', '#cfd6e0', 3, 45, 'Valued by smiths and sects alike.');
mat('ingot_iron', 'Iron Ingot', '錠', '#a8afbd', 1, 30, 'Smelted iron, ready for the forge.');
mat('hide', 'Beast Hide', '皮', '#a97c50', 1, 10, 'Tough hide from a wild animal.');
mat('fang', 'Wolf Fang', '牙', '#e8e2cf', 1, 12, 'A sharp fang.');
mat('meat', 'Raw Meat', '肉', '#d9645a', 1, 5, 'Fresh meat. Towns always need it.');
mat('grain', 'Grain', '穀', '#e0c76a', 1, 4, 'Staple food. Shortages starve towns.');
mat('cloth', 'Cloth', '布', '#c9b8d8', 1, 9, 'Plain woven cloth.');
mat('wine', 'Rice Wine', '酒', '#d8c48a', 1, 14, 'Warm rice wine.');
mat('insignia', 'Bandit Insignia', '令', '#b0453a', 2, 24, 'Proof of a bandit kill. Magistrates pay bounties for these.');
mat('blight_core', 'Blight Core', '核', '#8a3fb0', 3, 55, 'A pulsing knot of corruption. Dangerous but valuable to alchemists.');
mat('spirit_dew', 'Spirit Dew', '露', '#8fd7e8', 4, 160, 'Condensed qi from sacred places.');

// ---- Consumables --------------------------------------------------------------------------
const con = (id: string, name: string, glyph: string, color: string, tier: number, value: number, use: ItemUse, desc: string) =>
  add({ id, name, kind: 'consumable', glyph, color, tier, value, stack: 99, use, desc });
con('pill_heal_s', 'Minor Healing Pill', '丹', '#e8574a', 1, 20, { heal: 90 }, 'Restores 90 health.');
con('pill_heal_m', 'Healing Pill', '丹', '#e8574a', 2, 70, { heal: 260 }, 'Restores 260 health.');
con('pill_heal_l', 'Greater Healing Pill', '丹', '#e8574a', 3, 240, { heal: 700 }, 'Restores 700 health.');
con('pill_qi_s', 'Minor Qi Pill', '丹', '#5fa4e8', 1, 22, { qi: 45 }, 'Restores 45 Qi.');
con('pill_qi_m', 'Qi Pill', '丹', '#5fa4e8', 2, 75, { qi: 130 }, 'Restores 130 Qi.');
con('antidote', 'Antidote', '解', '#7ec26b', 2, 55, { cleanse: true, heal: 40 }, 'Cleanses poison and rot and restores 40 health.');
con('cooked_meat', 'Roast Meat', '烤', '#c9763d', 1, 14, { heal: 60 }, 'A hearty meal. Restores 60 health.');
con('pill_break_1', 'Foundation Pill', '突', '#f0a43a', 1, 160, { breakthrough: 1 }, 'Required to break through from Third-Rate to Second-Rate.');
con('pill_break_2', 'Meridian-Opening Elixir', '突', '#f0a43a', 2, 520, { breakthrough: 2 }, 'Required to break through from Second-Rate to First-Rate.');
con('pill_break_3', 'Marrow-Cleansing Pill', '突', '#f0a43a', 3, 1800, { breakthrough: 3 }, 'Required to break through from First-Rate to Peak.');
con('pill_break_4', 'Heavenly Qi Pill', '突', '#f0a43a', 4, 6500, { breakthrough: 4 }, 'Required to break through from Peak to Transcendent.');
con('pill_train', 'Cultivation Pill', '修', '#b87ae6', 2, 90, { xp: 150 }, 'Instantly grants a burst of cultivation experience.');

// ---- Manuals ----------------------------------------------------------------------------------
for (const s of Object.values(SKILLS)) {
  add({ id: `manual_${s.id}`, name: `Manual: ${s.name}`, kind: 'manual', glyph: '書', color: '#d9b867', tier: s.tier, value: Math.round(s.req.gold * 1.6), stack: 1, use: { teach: s.id }, desc: `Study this manual to learn ${s.name}.` });
}

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id];
}

export function isEquipment(def: ItemDef): boolean {
  return def.kind === 'weapon' || def.kind === 'outfit' || def.kind === 'accessory';
}

export interface GearBonus {
  atk: number;
  def: number;
  hp: number;
  stats: Partial<Stats>;
}

export function itemBonus(stack: ItemStack): GearBonus {
  const out: GearBonus = { atk: 0, def: 0, hp: 0, stats: {} };
  const d = ITEMS[stack.id];
  if (!d) return out;
  const mult = RARITY_MULT[stack.r ?? 0];
  out.atk += Math.round((d.atk ?? 0) * mult);
  out.def += Math.round((d.def ?? 0) * mult);
  out.hp += Math.round((d.hp ?? 0) * mult);
  if (d.stat) out.stats[d.stat.key] = (out.stats[d.stat.key] ?? 0) + Math.round(d.stat.value * mult);
  for (const [k, v] of stack.aff ?? []) {
    if (k === 'atk') out.atk += v;
    else if (k === 'def') out.def += v;
    else if (k === 'hp') out.hp += v;
    else out.stats[k] = (out.stats[k] ?? 0) + v;
  }
  return out;
}

export function gearTotals(eq: Equipment): GearBonus {
  const total: GearBonus = { atk: 0, def: 0, hp: 0, stats: {} };
  for (const slot of ['weapon', 'outfit', 'accessory'] as const) {
    const it = eq[slot];
    if (!it) continue;
    const b = itemBonus(it);
    total.atk += b.atk;
    total.def += b.def;
    total.hp += b.hp;
    for (const k of STAT_KEYS) if (b.stats[k]) total.stats[k] = (total.stats[k] ?? 0) + b.stats[k]!;
  }
  return total;
}

export function itemName(stack: ItemStack): string {
  return ITEMS[stack.id]?.name ?? stack.id;
}

/** Gold value of a single unit. */
export function stackValue(stack: ItemStack): number {
  const d = ITEMS[stack.id];
  if (!d) return 0;
  const mult = isEquipment(d) ? RARITY_MULT[stack.r ?? 0] * RARITY_MULT[stack.r ?? 0] : 1;
  return Math.max(1, Math.round(d.value * mult));
}

const AFFIX_KEYS: AffixKey[] = ['might', 'agility', 'vitality', 'spirit', 'insight', 'fortune', 'hp', 'atk', 'def'];

export function rollRarity(rng: Rng, fortune: number, boost = 0): Rarity {
  const f = Math.min(40, fortune);
  const w: [Rarity, number][] = [
    [0, 70 - f * 0.6 - boost * 10],
    [1, 22 + f * 0.25 + boost * 4],
    [2, 6 + f * 0.25 + boost * 4],
    [3, 1.6 + f * 0.08 + boost * 1.6],
    [4, 0.2 + f * 0.02 + boost * 0.4],
  ];
  return rng.weighted(w.map(([r, v]) => [r, Math.max(0.05, v)] as const));
}

export function rollAffixes(rng: Rng, tier: number, rarity: Rarity): [AffixKey, number][] {
  const count = [0, 0, 1, 2, 3][rarity];
  const out: [AffixKey, number][] = [];
  const used = new Set<AffixKey>();
  for (let i = 0; i < count; i++) {
    let k = rng.pick(AFFIX_KEYS);
    for (let tries = 0; tries < 6 && used.has(k); tries++) k = rng.pick(AFFIX_KEYS);
    used.add(k);
    const scale = rng.float(0.75, 1.3);
    let v: number;
    if (k === 'hp') v = Math.round((14 + tier * 14) * scale);
    else if (k === 'atk') v = Math.round((2 + tier * 3) * scale);
    else if (k === 'def') v = Math.round((1 + tier * 2) * scale);
    else v = Math.max(1, Math.round((1 + tier * 1.4) * scale));
    out.push([k, v]);
  }
  return out;
}

/** Build a random equipment piece of a given tier, or null if no such item exists. */
export function makeEquipment(rng: Rng, tier: number, fortune: number, slot?: EquipSlot, boost = 0): ItemStack | null {
  const kinds: EquipSlot[] = ['weapon', 'outfit', 'accessory'];
  const s = slot ?? rng.pick(kinds);
  let id: string;
  if (s === 'weapon') id = `w_${rng.pick(WEAPON_TYPES)}_${Math.min(5, tier)}`;
  else if (s === 'outfit') id = `o_${Math.min(5, tier)}`;
  else id = `a_${rng.pick(STAT_KEYS)}_${Math.min(4, tier)}`;
  if (!ITEMS[id]) return null;
  const r = rollRarity(rng, fortune, boost);
  return { id, qty: 1, r, aff: rollAffixes(rng, tier, r) };
}
