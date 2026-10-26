/**
 * Gear -> appearance mapping. The server sends `EntityView.gear` (tier 1-5 and rarity 0-4 of weapon / outfit /
 * accessory); this module turns it into the small integer record the sprite generator and the sprite cache key use, and
 * holds the per-tier palettes. NPCs get tiers by role. Pure (node-testable).
 */
import { RARITY_COLORS, type GearLook, type NpcRole, type StatKey, type WeaponType } from '@murim/shared';
import { hex, type Col } from './color';
import { ramp, type Ramp } from './palette';

export interface GearAppearance {
  /** Weapon tier (0 = none/unknown, 1-5) and rarity (0-4). */
  wT: number;
  wR: number;
  /** Outfit tier (0 = nothing equipped, 1-5) and rarity. */
  oT: number;
  oR: number;
  /** Accessory attribute (null = none), tier and rarity. */
  aK: StatKey | null;
  aT: number;
  aR: number;
}

export const NO_GEAR: GearAppearance = { wT: 0, wR: 0, oT: 0, oR: 0, aK: null, aT: 0, aR: 0 };

const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

export function gearAppearance(g: GearLook | null | undefined): GearAppearance {
  if (!g) return NO_GEAR;
  return {
    wT: g.w ? clampI(g.w.t, 1, 5) : 0,
    wR: g.w ? clampI(g.w.r, 0, 4) : 0,
    oT: g.o ? clampI(g.o.t, 1, 5) : 0,
    oR: g.o ? clampI(g.o.r, 0, 4) : 0,
    aK: g.a ? g.a.k : null,
    aT: g.a ? clampI(g.a.t, 1, 5) : 0,
    aR: g.a ? clampI(g.a.r, 0, 4) : 0,
  };
}

/** Compact cache key fragment for a gear record. */
export function gearKey(a: GearAppearance): string {
  return `${a.wT}${a.wR}${a.oT}${a.oR}${a.aK ? a.aK[0] + a.aK[1] : '-'}${a.aT}${a.aR}`;
}

/** Tiers worn by NPCs, by role (players use the server's gear). */
export const ROLE_GEAR: Record<NpcRole, GearLook> = {
  villager: { o: { t: 1, r: 0 } },
  guard: { o: { t: 3, r: 1 }, w: { t: 2, r: 0 } },
  merchant: { o: { t: 3, r: 0 }, a: { k: 'fortune', t: 3, r: 0 } },
  smith: { o: { t: 2, r: 0 }, w: { t: 2, r: 0 } },
  alchemist: { o: { t: 2, r: 0 }, a: { k: 'spirit', t: 2, r: 0 } },
  innkeeper: { o: { t: 2, r: 0 } },
  master: { o: { t: 4, r: 2 }, w: { t: 4, r: 2 }, a: { k: 'insight', t: 4, r: 1 } },
  elder: { o: { t: 3, r: 1 }, a: { k: 'insight', t: 3, r: 0 } },
  physician: { o: { t: 2, r: 1 }, a: { k: 'vitality', t: 2, r: 0 } },
  legend: { o: { t: 5, r: 4 }, w: { t: 5, r: 4 }, a: { k: 'spirit', t: 5, r: 3 } },
  wanderer: { o: { t: 2, r: 0 }, w: { t: 2, r: 0 }, a: { k: 'agility', t: 2, r: 0 } },
  disciple: { o: { t: 2, r: 0 }, w: { t: 1, r: 0 } },
};

/** Gear of hostile humans. */
export const SPECIAL_GEAR: Record<string, GearLook> = {
  bandit: { o: { t: 1, r: 0 }, w: { t: 2, r: 0 } },
  bandit_boss: { o: { t: 3, r: 1 }, w: { t: 3, r: 1 } },
  hollow: { o: { t: 1, r: 0 } },
  hollow_monk: { o: { t: 2, r: 0 }, w: { t: 3, r: 2 } },
  hollow_brute: { o: { t: 2, r: 0 }, w: { t: 3, r: 0 } },
  hollow_lord: { o: { t: 5, r: 3 } },
};

const gearCache = new WeakMap<GearLook, GearAppearance>();
const keyedCache = new Map<string, GearAppearance>();

/** Appearance for an entity: its own gear, else tiers by hostile style or NPC role. Cached (no per-frame allocation). */
export function gearFor(gear: GearLook | undefined, role: NpcRole | null | undefined, special: string | null | undefined): GearAppearance {
  if (gear) {
    let a = gearCache.get(gear);
    if (!a) {
      a = gearAppearance(gear);
      gearCache.set(gear, a);
    }
    return a;
  }
  const key = special && special !== 'none' && SPECIAL_GEAR[special] ? 's' + special : role && ROLE_GEAR[role] ? 'r' + role : '';
  if (!key) return NO_GEAR;
  let a = keyedCache.get(key);
  if (!a) {
    a = gearAppearance(key[0] === 's' ? SPECIAL_GEAR[key.slice(1)] : ROLE_GEAR[key.slice(1) as NpcRole]);
    keyedCache.set(key, a);
  }
  return a;
}

export const rarityCss = (r: number): string => RARITY_COLORS[clampI(r, 0, 4)];
export const rarityCol = (r: number): Col => hex(rarityCss(r));
/** RGB triplet string for gradients ("r,g,b"). */
export function rarityRgb(r: number): string {
  const c = rarityCss(r);
  return `${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)}`;
}

// ---------------------------------------------------------------------------
// per tier palettes
// ---------------------------------------------------------------------------

/** Blade / spearhead metal, indexed by tier 1-5. */
export const METAL: Ramp[] = [
  ramp('#7d7f86', 0.62, 1.3),
  ramp('#7d7f86', 0.62, 1.3),
  ramp('#aab6c4', 0.64, 1.28),
  ramp('#cfdae8', 0.7, 1.2),
  ramp('#8fb8ea', 0.62, 1.35),
  ramp('#e2fff2', 0.7, 1.15),
];
/** Guards, caps and fittings. */
export const FITTING: Ramp[] = [
  ramp('#555560', 0.62, 1.3),
  ramp('#555560', 0.62, 1.3),
  ramp('#a8763a', 0.62, 1.3),
  ramp('#d2a84a', 0.64, 1.3),
  ramp('#f0c860', 0.66, 1.3),
  ramp('#f6d98a', 0.68, 1.25),
];
/** Wood for staffs / shafts. */
export const WOOD: Ramp[] = [
  ramp('#7a5a3a', 0.62, 1.25),
  ramp('#7a5a3a', 0.62, 1.25),
  ramp('#6a4a30', 0.6, 1.3),
  ramp('#5a3a28', 0.6, 1.35),
  ramp('#3e2a22', 0.62, 1.5),
  ramp('#e8e0cc', 0.74, 1.1),
];
/** Grip wraps. */
export const WRAP: Ramp[] = [
  ramp('#6a4a32', 0.62, 1.25),
  ramp('#6a4a32', 0.62, 1.25),
  ramp('#3e2f26', 0.62, 1.3),
  ramp('#a8302a', 0.64, 1.3),
  ramp('#26222c', 0.7, 1.6),
  ramp('#f0ece0', 0.76, 1.08),
];
export const TASSEL: Ramp[] = [
  ramp('#a8302a', 0.64, 1.3),
  ramp('#a8302a', 0.64, 1.3),
  ramp('#a8302a', 0.64, 1.3),
  ramp('#c8452d', 0.64, 1.3),
  ramp('#d9a838', 0.66, 1.3),
  ramp('#f6efd8', 0.78, 1.05),
];

/** Trim colour of outfit by tier (leather, thread, gold, jade-gold). */
export const OUTFIT_TRIM: Ramp[] = [
  ramp('#c9bfa6', 0.7, 1.15),
  ramp('#c9bfa6', 0.7, 1.15),
  ramp('#7a5236', 0.62, 1.3),
  ramp('#e6d093', 0.72, 1.18),
  ramp('#d8b254', 0.66, 1.3),
  ramp('#f2d684', 0.7, 1.25),
];

/** Accessory metal by tier: bone/iron, bronze, silver, gold, gold with gem. */
export const TRINKET: Ramp[] = [
  ramp('#8a8680', 0.62, 1.3),
  ramp('#8a8680', 0.62, 1.3),
  ramp('#b0733a', 0.62, 1.3),
  ramp('#cfd6e0', 0.68, 1.2),
  ramp('#e6c04e', 0.66, 1.3),
  ramp('#f6d884', 0.68, 1.25),
];

export const JADE = ramp('#47c79a', 0.6, 1.35);
export const BONE = ramp('#eadfc4', 0.72, 1.08);
export const COIN = ramp('#e2b845', 0.62, 1.35);
export const SEAL = ramp('#b3322a', 0.6, 1.3);

export const TIER_NAMES: Record<'outfit' | 'weapon', string[]> = {
  outfit: ['plain', 'patched hemp', 'leather-trimmed', 'embroidered cloud robe', 'silk battle robe', 'immortal garment'],
  weapon: ['unarmed', 'iron', 'steel', 'fine steel', 'blue steel', 'jade-white'],
};

/** What the weapon hand holds for a weapon type when unarmed monsters / NPCs have no explicit weapon. */
export function defaultWeaponFor(role: NpcRole | null | undefined): WeaponType | null {
  return role === 'guard' ? 'spear' : null;
}
