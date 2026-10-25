import { makeCombatant, type Combatant } from './combat';
import { activeSlots, rankOf } from './ranks';
import { deriveStats, type DerivedStats } from './stats';
import { STAT_KEYS, type CharacterSave, type Equipment, type ItemStack, type Loadout, type Stats, type TacticRule } from './types';
import { gearTotals, getItem } from './data/items';
import { getSkill, SKILLS, type PassiveBonus } from './data/skills';
import { ORIGINS, TALENTS } from './data/origins';
import { JOB_IDS } from './types';
import type { Roll } from './stats';
import type { Look } from './types';

export function characterPassives(save: Pick<CharacterSave, 'talents' | 'loadout'>): PassiveBonus[] {
  const out: PassiveBonus[] = [];
  for (const t of save.talents) {
    const p = TALENTS[t]?.passive;
    if (p) out.push(p);
  }
  const int = save.loadout.internal ? SKILLS[save.loadout.internal]?.passive : undefined;
  if (int) out.push(int);
  const mov = save.loadout.movement ? SKILLS[save.loadout.movement]?.passive : undefined;
  if (mov) out.push(mov);
  return out;
}

export function deriveForCharacter(save: CharacterSave, now = Date.now()): DerivedStats {
  const injured = save.injuryUntil > now ? save.injuryStacks : 0;
  return deriveStats({
    stats: save.stats,
    level: save.level,
    gear: gearTotals(save.equipment),
    passives: characterPassives(save),
    injuryStacks: injured,
  });
}

export const DEFAULT_TACTICS: TacticRule[] = [{ cond: { k: 'hpBelow', v: 35 }, act: { k: 'item', id: 'pill_heal_s' } }];

export function emptyEquipment(): Equipment {
  return { weapon: null, outfit: null, accessory: null };
}

export function buildPlayerCombatant(save: CharacterSave, id: number, side: 0 | 1, now = Date.now()): Combatant {
  const d = deriveForCharacter(save, now);
  const weapon = save.equipment.weapon ? getItem(save.equipment.weapon.id) : undefined;
  const skills = save.loadout.active
    .filter((s): s is string => !!s && !!save.skills[s])
    .map((s) => ({ id: s, level: save.skills[s].lv, cd: 0 }));
  const items: Combatant['items'] = {};
  for (const it of save.inventory) {
    const def = getItem(it.id);
    if (def?.kind === 'consumable' && def.use && (def.use.heal || def.use.qi || def.use.cleanse)) {
      const cur = items[it.id];
      items[it.id] = { count: (cur?.count ?? 0) + it.qty, heal: def.use.heal, qi: def.use.qi, cleanse: def.use.cleanse };
    }
  }
  return makeCombatant({
    id,
    side,
    name: save.name,
    isPlayer: true,
    level: save.level,
    maxHp: d.maxHp,
    hp: Math.min(save.hp, d.maxHp),
    maxQi: d.maxQi,
    qi: Math.min(save.qi, d.maxQi),
    atk: d.atk,
    def: d.def,
    speed: d.speed,
    crit: d.crit,
    dodge: d.dodge,
    qiRegen: d.qiRegen,
    healPower: d.healPower,
    lifesteal: d.lifesteal,
    resist: d.resist,
    antiBlight: d.antiBlight,
    flee: d.flee,
    weaponType: weapon?.weaponType,
    stance: save.stance,
    skills,
    tactics: save.tactics,
    items,
  });
}

/** Skills a character can currently place in each loadout slot type. */
export function autoLoadout(skills: Record<string, unknown>, rank: number, weaponType?: string): Loadout {
  const learned = Object.keys(skills).map((id) => SKILLS[id]).filter(Boolean);
  const actives = learned.filter((s) => s.kind === 'active');
  actives.sort((a, b) => {
    const wa = a.weapon && a.weapon === weaponType ? 1 : 0;
    const wb = b.weapon && b.weapon === weaponType ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return b.tier - a.tier;
  });
  const slots = activeSlots(rank);
  const active: (string | null)[] = [];
  for (let i = 0; i < slots; i++) active.push(actives[i]?.id ?? null);
  const internal = learned.filter((s) => s.kind === 'internal').sort((a, b) => b.tier - a.tier)[0]?.id ?? null;
  const movement = learned.filter((s) => s.kind === 'movement').sort((a, b) => b.tier - a.tier)[0]?.id ?? null;
  return { active, internal, movement };
}

export function sanitizeLoadout(save: CharacterSave, loadout: Loadout): Loadout {
  const rank = rankOf(save.level);
  const slots = activeSlots(rank);
  const seen = new Set<string>();
  const active: (string | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const id = loadout.active[i] ?? null;
    if (id && save.skills[id] && SKILLS[id]?.kind === 'active' && !seen.has(id)) {
      active.push(id);
      seen.add(id);
    } else active.push(null);
  }
  const internal = loadout.internal && save.skills[loadout.internal] && SKILLS[loadout.internal]?.kind === 'internal' ? loadout.internal : null;
  const movement = loadout.movement && save.skills[loadout.movement] && SKILLS[loadout.movement]?.kind === 'movement' ? loadout.movement : null;
  return { active, internal, movement };
}

export interface NewCharacterInput {
  id: number;
  name: string;
  look: Look;
  roll: Roll;
  homeSettlement: number;
  spawn: { x: number; y: number };
  now: number;
  rerolls: number;
}

export function newCharacterSave(input: NewCharacterInput): CharacterSave {
  const { roll } = input;
  const origin = ORIGINS[roll.origin];
  const inventory: ItemStack[] = [];
  const equipment = emptyEquipment();
  let uidCounter = 1;
  for (const item of origin.items) {
    const def = getItem(item.id);
    if (!def) continue;
    const stack: ItemStack = { ...item };
    if (def.slot) {
      stack.uid = `c${input.id}-s${uidCounter++}`;
      if (!equipment[def.slot]) {
        equipment[def.slot] = stack;
        continue;
      }
    }
    inventory.push(stack);
  }
  inventory.push({ id: 'pill_heal_s', qty: 3 });
  const skills: CharacterSave['skills'] = {};
  for (const s of origin.skills) skills[s] = { lv: 1, xp: 0 };
  if (!Object.keys(skills).some((s) => SKILLS[s]?.kind === 'active')) skills.fist_iron = { lv: 1, xp: 0 };
  const jobs = Object.fromEntries(JOB_IDS.map((j) => [j, { lv: 1, xp: 0 }])) as CharacterSave['jobs'];
  const weaponType = equipment.weapon ? getItem(equipment.weapon.id)?.weaponType : undefined;
  const loadout = autoLoadout(skills, 1, weaponType);
  const save: CharacterSave = {
    id: input.id,
    name: input.name,
    look: input.look,
    origin: roll.origin,
    talents: roll.talents,
    level: 1,
    xp: 0,
    stats: { ...roll.stats },
    statPoints: 0,
    hp: 1,
    qi: 1,
    gold: origin.gold,
    inventory,
    equipment,
    skills,
    loadout,
    stance: 'balanced',
    tactics: DEFAULT_TACTICS.map((r) => ({ cond: { ...r.cond }, act: { ...r.act } })),
    jobs,
    activity: null,
    missions: [],
    completedMissions: 0,
    reputation: { ...(origin.rep ?? {}) },
    kills: 0,
    deaths: 0,
    x: input.spawn.x,
    y: input.spawn.y,
    lastTown: input.homeSettlement,
    injuryUntil: 0,
    injuryStacks: 0,
    title: '',
    sectId: null,
    masterId: null,
    createdAt: input.now,
    lastSeen: input.now,
    rerolls: input.rerolls,
    uidSeq: uidCounter,
    buffs: {},
  };
  const d = deriveForCharacter(save, input.now);
  save.hp = d.maxHp;
  save.qi = d.maxQi;
  return save;
}

/** Spread stat points sensibly. Used by tests and offline tooling. */
export function autoAllocate(stats: Stats, points: number, weights: Partial<Stats>): Stats {
  const out = { ...stats };
  const total = STAT_KEYS.reduce((a, k) => a + (weights[k] ?? 0), 0) || 1;
  let left = points;
  for (const k of STAT_KEYS) {
    const share = Math.floor((points * (weights[k] ?? 0)) / total);
    out[k] += share;
    left -= share;
  }
  out[STAT_KEYS[0]] += left;
  return out;
}

export function skillSchoolOf(id: string): string | undefined {
  return getSkill(id)?.school;
}
