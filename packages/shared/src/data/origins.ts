import type { ItemStack, JobId, Stats } from '../types';
import type { PassiveBonus } from './skills';
import type { SettlementKind } from '../terrain';

export interface TalentDef {
  id: string;
  name: string;
  desc: string;
  mods: Partial<Stats>;
  passive?: PassiveBonus;
  /** XP multiplier for skills of these schools. */
  fastSchools?: string[];
  jobXp?: JobId[];
  xpBonus?: number;
  positive: boolean;
}

export const TALENTS: Record<string, TalentDef> = {};
function talent(t: TalentDef): void {
  TALENTS[t.id] = t;
}
talent({ id: 'heavenly_meridians', name: 'Heavenly Meridians', desc: 'Meridians that drink in qi. +4 Spirit, +10% Qi.', mods: { spirit: 4 }, passive: { maxQi: 0.1 }, positive: true });
talent({ id: 'iron_bones', name: 'Iron Bones', desc: 'A body built like a fortress. +4 Vitality, +8% health.', mods: { vitality: 4 }, passive: { maxHp: 0.08 }, positive: true });
talent({ id: 'swift_feet', name: 'Swift Feet', desc: 'Born quick. +4 Agility.', mods: { agility: 4 }, positive: true });
talent({ id: 'giant_strength', name: 'Giant Strength', desc: 'Strength beyond your years. +4 Might.', mods: { might: 4 }, positive: true });
talent({ id: 'sharp_mind', name: 'Sharp Mind', desc: 'Learns what others struggle with. +4 Insight.', mods: { insight: 4 }, positive: true });
talent({ id: 'lucky_star', name: 'Lucky Star', desc: 'Fortune smiles on you. +5 Fortune.', mods: { fortune: 5 }, positive: true });
talent({ id: 'sword_prodigy', name: 'Sword Prodigy', desc: 'Sword and blade arts improve 50% faster. +2 Agility.', mods: { agility: 2 }, fastSchools: ['sword', 'blade'], positive: true });
talent({ id: 'fist_prodigy', name: 'Fist Prodigy', desc: 'Fist, staff and spear arts improve 50% faster. +2 Might.', mods: { might: 2 }, fastSchools: ['fist', 'staff', 'spear'], positive: true });
talent({ id: 'green_thumb', name: 'Gentle Hands', desc: 'Herbalists and alchemists earn 30% more job experience.', mods: {}, jobXp: ['herbalist', 'alchemist', 'farmer'], positive: true });
talent({ id: 'old_soul', name: 'Old Soul', desc: 'Gain 8% more cultivation experience.', mods: { insight: 1 }, xpBonus: 0.08, positive: true });
talent({ id: 'cursed_meridians', name: 'Cursed Meridians', desc: 'Qi flows badly, but the mind compensates. -3 Spirit, +5 Insight.', mods: { spirit: -3, insight: 5 }, positive: false });
talent({ id: 'blight_touched', name: 'Blight-Touched', desc: 'The Blight marked you and left you alive. Resist rot, but frail. -2 Vitality, +2 Fortune.', mods: { vitality: -2, fortune: 2 }, passive: { resist: 0.6 }, positive: false });

export interface OriginDef {
  id: string;
  name: string;
  desc: string;
  mods: Partial<Stats>;
  gold: number;
  items: ItemStack[];
  skills: string[];
  jobBonus?: JobId;
  homeKinds: SettlementKind[];
  rep?: Record<string, number>;
}

export const ORIGINS: Record<string, OriginDef> = {};
function origin(o: OriginDef): void {
  ORIGINS[o.id] = o;
}
origin({ id: 'farmer_child', name: 'Farmer\'s Child', desc: 'Raised in the fields. Hard work and plain food built a sturdy body.', mods: { vitality: 2 }, gold: 20, items: [{ id: 'grain', qty: 5 }, { id: 'w_staff_1', qty: 1, r: 0 }], skills: [], jobBonus: 'farmer', homeKinds: ['hamlet', 'village'] });
origin({ id: 'plague_orphan', name: 'Plague Orphan', desc: 'The Blight took your village. You survived and learned to run.', mods: { fortune: 3, vitality: -1 }, gold: 5, items: [{ id: 'antidote', qty: 2 }, { id: 'w_fist_1', qty: 1, r: 0 }], skills: ['fist_iron'], homeKinds: ['village', 'hamlet'] });
origin({ id: 'merchant_heir', name: 'Merchant\'s Heir', desc: 'Your family trades across the roads. You know what things are worth.', mods: { insight: 2 }, gold: 120, items: [{ id: 'cloth', qty: 3 }, { id: 'w_blade_1', qty: 1, r: 0 }], skills: [], jobBonus: 'blacksmith', homeKinds: ['town'], rep: { jade: 15 } });
origin({ id: 'fallen_noble', name: 'Fallen Noble', desc: 'Your house fell with the old capital. You kept your education and your pride.', mods: { insight: 2, spirit: 1 }, gold: 60, items: [{ id: 'a_insight_1', qty: 1, r: 0 }, { id: 'w_sword_1', qty: 1, r: 0 }], skills: [], homeKinds: ['town', 'fort'] });
origin({ id: 'hunter_kid', name: 'Hunter\'s Kid', desc: 'You grew up in the woods with a spear in hand.', mods: { agility: 2 }, gold: 15, items: [{ id: 'w_spear_1', qty: 1, r: 0 }, { id: 'meat', qty: 3 }], skills: ['spear_pierce'], jobBonus: 'herbalist', homeKinds: ['hamlet', 'village'] });
origin({ id: 'physician_apprentice', name: 'Physician\'s Apprentice', desc: 'You learned herbs and needles before you learned to fight.', mods: { spirit: 2 }, gold: 30, items: [{ id: 'pill_heal_s', qty: 4 }, { id: 'herb', qty: 6 }], skills: ['med_mend'], jobBonus: 'alchemist', homeKinds: ['village', 'town'] });
origin({ id: 'disgraced_disciple', name: 'Disgraced Disciple', desc: 'Expelled from the Azure Cloud Sect. You kept the sword forms, and a grudge.', mods: { might: 2 }, gold: 10, items: [{ id: 'w_sword_1', qty: 1, r: 0 }], skills: ['sword_basic'], homeKinds: ['village', 'town'], rep: { azure: -15 } });
origin({ id: 'wandering_beggar', name: 'Wandering Beggar', desc: 'You have slept in every ditch between here and the sea. People underestimate you.', mods: { fortune: 2, agility: 1 }, gold: 3, items: [{ id: 'cooked_meat', qty: 2 }], skills: ['fist_iron'], homeKinds: ['village', 'hamlet', 'town'] });
