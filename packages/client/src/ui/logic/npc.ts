/** NPC dialog logic: which tabs exist, shop arithmetic, and mission-board gating. Pure. */
import { MAX_ACTIVE_MISSIONS, getItem, rankOf, stackValue, type ActiveMission, type ItemStack, type MeView, type MissionOffer, type NpcMenu, type ShopEntry } from '@murim/shared';

export type NpcTab = 'shop' | 'teach' | 'missions' | 'rest' | 'disciple' | 'talk';

/** Roles that post or review the settlement mission board. */
const BOARD_ROLES = new Set(['elder', 'guard', 'master', 'legend', 'innkeeper']);

export function npcTabs(menu: NpcMenu): NpcTab[] {
  const out: NpcTab[] = [];
  if (menu.shop) out.push('shop');
  if (menu.teaches && menu.teaches.length) out.push('teach');
  if (menu.turnIns.length > 0 || BOARD_ROLES.has(menu.role)) out.push('missions');
  if (menu.restPrice !== undefined) out.push('rest');
  if (menu.disciple) out.push('disciple');
  if (menu.talk) out.push('talk');
  return out;
}

export function sellPriceFor(stack: ItemStack, sellMult: number): number {
  return Math.max(1, Math.floor(stackValue(stack) * sellMult));
}

/** Most units of `entry` the player can buy with `gold` (respecting finite stock). */
export function maxBuy(entry: ShopEntry, gold: number): number {
  const byGold = entry.price > 0 ? Math.floor(gold / entry.price) : 99;
  const byStock = entry.stock === null ? 99 : entry.stock;
  return Math.max(0, Math.min(99, byGold, byStock));
}

/** Entries that exist as real items (unknown ids are hidden rather than shown broken). */
export function buyList(entries: readonly ShopEntry[]): ShopEntry[] {
  return entries.filter((e) => !!getItem(e.id));
}

/** Inventory stacks an NPC would buy, with price per unit. */
export function sellList(inv: readonly ItemStack[], sellMult: number, sellPrices?: readonly number[]): { idx: number; stack: ItemStack; unit: number }[] {
  const out: { idx: number; stack: ItemStack; unit: number }[] = [];
  inv.forEach((stack, idx) => {
    const def = getItem(stack.id);
    // Manuals are never bought by a shop (server: shopAccepts), breakthrough pills stay with the player.
    if (!def || def.kind === 'manual' || def.use?.breakthrough) return;
    // The server sends the exact per-slot payout (0 = this shop refuses the item) when it knows the shop type.
    if (sellPrices && sellPrices.length === inv.length) {
      if (sellPrices[idx] > 0) out.push({ idx, stack, unit: sellPrices[idx] });
      return;
    }
    out.push({ idx, stack, unit: sellPriceFor(stack, sellMult) });
  });
  return out;
}

export interface OfferGate {
  ok: boolean;
  /** i18n key when not ok. */
  reason?: string;
  accepted: boolean;
}

export function offerGate(offer: MissionOffer, me: MeView): OfferGate {
  const active = me.c.missions;
  if (active.some((m) => m.id === offer.id)) return { ok: false, reason: 'npc.mission.accepted', accepted: true };
  if (active.length >= MAX_ACTIVE_MISSIONS) return { ok: false, reason: 'npc.mission.full', accepted: false };
  if (rankOf(me.c.level) < offer.minRank) return { ok: false, reason: 'npc.mission.rank', accepted: false };
  // Server: one bounty at a time (`one_bounty`).
  if (offer.type === 'bounty' && active.some((m) => m.type === 'bounty')) return { ok: false, reason: 'npc.mission.oneBounty', accepted: false };
  return { ok: true, accepted: false };
}

export function turnInMissions(menu: NpcMenu, me: MeView): ActiveMission[] {
  return menu.turnIns.map((id) => me.c.missions.find((m) => m.id === id)).filter((m): m is ActiveMission => !!m);
}

/** True when a rest would do something: hurt, low on Qi or injured (the server only refuses `not_needed` otherwise). */
export function restNeeded(v: { hp: number; maxHp: number; qi: number; maxQi: number }, injuryStacks: number, injuryUntil: number, now: number): boolean {
  return v.hp < v.maxHp || v.qi < v.maxQi || (injuryStacks > 0 && injuryUntil > now);
}

/**
 * The real server never re-sends `npc` after buy / sell / learn / rest / hand-in (only `me`), so the dialog re-queries
 * the menu when this signature of the things a menu depends on changes.
 */
export function menuSignature(me: MeView): string {
  const c = me.c;
  const inv = c.inventory.map((s) => `${s.id}:${s.qty}`).join(',');
  const missions = c.missions.map((m) => `${m.id}:${m.done ? 1 : 0}`).join(',');
  return [c.gold, inv, Object.keys(c.skills).length, missions, c.reputation ? JSON.stringify(c.reputation) : '', c.level].join('|');
}
