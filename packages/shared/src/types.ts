/** Core data shapes shared by client and server. */

export const STAT_KEYS = ['might', 'agility', 'vitality', 'spirit', 'insight', 'fortune'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { name: string; short: string; desc: string }> = {
  might: { name: 'Might', short: 'MIG', desc: 'Raw physical power. Raises attack damage.' },
  agility: { name: 'Agility', short: 'AGI', desc: 'Speed and reflexes. Raises action speed, dodge and a little crit.' },
  vitality: { name: 'Vitality', short: 'VIT', desc: 'Body toughness. Raises health and defense.' },
  spirit: { name: 'Spirit', short: 'SPI', desc: 'Inner energy. Raises Qi pool and Qi recovery.' },
  insight: { name: 'Insight', short: 'INS', desc: 'Comprehension. Speeds learning and improves breakthrough odds.' },
  fortune: { name: 'Fortune', short: 'FOR', desc: 'Luck. Raises crit chance, drops and rare finds.' },
};

export type Stance = 'aggressive' | 'balanced' | 'defensive' | 'evasive';
export const STANCE_INFO: Record<Stance, { name: string; desc: string }> = {
  aggressive: { name: 'Aggressive', desc: '+15% damage dealt, -10% defense.' },
  balanced: { name: 'Balanced', desc: 'No modifiers.' },
  defensive: { name: 'Defensive', desc: '+20% defense, -10% damage dealt.' },
  evasive: { name: 'Evasive', desc: '+12 dodge, -8% damage dealt.' },
};

export type WeaponType = 'sword' | 'blade' | 'spear' | 'staff' | 'fist';
export const WEAPON_TYPES: WeaponType[] = ['sword', 'blade', 'spear', 'staff', 'fist'];
export type EquipSlot = 'weapon' | 'outfit' | 'accessory';

export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY_NAMES = ['Common', 'Fine', 'Rare', 'Epic', 'Legendary'] as const;
export const RARITY_COLORS = ['#b9b2a0', '#7ec26b', '#5fa4e8', '#b87ae6', '#f0a43a'] as const;
export const RARITY_MULT = [1, 1.15, 1.32, 1.55, 1.9] as const;

export type AffixKey = StatKey | 'hp' | 'atk' | 'def';
export interface ItemStack {
  /** Item definition id. */
  id: string;
  qty: number;
  /** Rarity for equipment. */
  r?: Rarity;
  /** Random affixes rolled on equipment. */
  aff?: [AffixKey, number][];
  /** Unique id for equipment so the client can address a specific piece. */
  uid?: string;
}

export interface Equipment {
  weapon: ItemStack | null;
  outfit: ItemStack | null;
  accessory: ItemStack | null;
}

/**
 * What other players can see of your equipment. `t` is the item tier (1-5), `r` the rarity (0-4).
 * Sent with the entity so the renderer can dress the sprite (robe finery, auras, weapon quality, trinkets).
 */
export interface GearLook {
  w?: { t: number; r: number };
  o?: { t: number; r: number };
  /** Accessory: which attribute it boosts (picks the trinket shape/colour). */
  a?: { k: StatKey; t: number; r: number };
}

/** Appearance indices; the client turns these into colours and shapes. */
export interface Look {
  gender: 0 | 1;
  skin: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  outfitColor: number;
  sashColor: number;
  accessory: number;
}

export const LOOK_RANGES = {
  skin: 6,
  hairStyle: 7,
  hairColor: 8,
  outfit: 4,
  outfitColor: 10,
  sashColor: 8,
  accessory: 5,
} as const;

// ---- Tactics ---------------------------------------------------------------

export type Cond =
  | { k: 'always' }
  | { k: 'hpBelow'; v: number }
  | { k: 'qiBelow'; v: number }
  | { k: 'qiAbove'; v: number }
  | { k: 'enemyHpBelow'; v: number }
  | { k: 'enemiesAtLeast'; v: number }
  | { k: 'targetBlighted' };

export type Act = { k: 'skill'; id: string } | { k: 'guard' } | { k: 'item'; id: string } | { k: 'flee' } | { k: 'basic' };

export interface TacticRule {
  cond: Cond;
  act: Act;
}

export interface Loadout {
  active: (string | null)[];
  internal: string | null;
  movement: string | null;
}

// ---- Jobs and activities -----------------------------------------------------

export type JobId = 'herbalist' | 'miner' | 'farmer' | 'blacksmith' | 'alchemist';
export const JOB_IDS: JobId[] = ['herbalist', 'miner', 'farmer', 'blacksmith', 'alchemist'];

/** `carry`: fractional leftovers (xp, gold, items) not yet granted; owned by the server activities system. */
export type Activity =
  | { kind: 'train'; since: number; settled: number; site: string; carry?: Record<string, number> }
  | { kind: 'shift'; job: JobId; since: number; settled: number; site: string; carry?: Record<string, number> }
  | { kind: 'craft'; recipe: string; remaining: number; since: number; settled: number; site: string; carry?: Record<string, number> };

// ---- Missions ---------------------------------------------------------------

export type MissionType = 'hunt' | 'gather' | 'deliver' | 'purify' | 'defend' | 'bounty' | 'investigate' | 'sect';

export interface MissionReward {
  xp: number;
  gold: number;
  rep?: { faction: string; amount: number };
  items?: ItemStack[];
}

export interface MissionOffer {
  id: string;
  type: MissionType;
  title: string;
  desc: string;
  settlementId: number;
  giverId?: number;
  /** Target description fields, interpretation depends on type. */
  target: {
    monster?: string;
    family?: string;
    item?: string;
    count: number;
    toSettlement?: number;
    x?: number;
    y?: number;
    radius?: number;
    elite?: number;
  };
  minRank: number;
  level: number;
  reward: MissionReward;
  /** World day on which the offer disappears. */
  expires: number;
}

export interface ActiveMission extends MissionOffer {
  progress: number;
  acceptedDay: number;
  done: boolean;
}

// ---- Character sheet ---------------------------------------------------------

export interface SkillState {
  lv: number;
  xp: number;
}

export interface CharacterSave {
  id: number;
  name: string;
  look: Look;
  origin: string;
  talents: string[];
  level: number;
  xp: number;
  stats: Stats;
  statPoints: number;
  hp: number;
  qi: number;
  gold: number;
  inventory: ItemStack[];
  equipment: Equipment;
  skills: Record<string, SkillState>;
  loadout: Loadout;
  stance: Stance;
  tactics: TacticRule[];
  jobs: Record<JobId, SkillState>;
  activity: Activity | null;
  missions: ActiveMission[];
  completedMissions: number;
  reputation: Record<string, number>;
  kills: number;
  deaths: number;
  x: number;
  y: number;
  lastTown: number;
  injuryUntil: number;
  injuryStacks: number;
  title: string;
  sectId: number | null;
  masterId: number | null;
  createdAt: number;
  lastSeen: number;
  rerolls: number;
  /** Counter for equipment uids (`c{charId}-s{n}`); see server systems/lib.ts `nextUid`. */
  uidSeq?: number;
  /** Timed blessings/buffs: key -> expiry (ms epoch), e.g. 'bless_blight'. */
  buffs?: Record<string, number>;}
