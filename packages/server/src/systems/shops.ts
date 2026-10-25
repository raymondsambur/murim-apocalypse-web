import {
  SKILLS,
  deriveForCharacter,
  getItem,
  isEquipment,
  stackValue,
  type CharacterSave,
  type ItemDef,
  type ItemStack,
  type NpcMenu,
  type NpcState,
  type ShopEntry,
  type TeachEntry,
} from '@murim/shared';
import { GameError, type Entity, type GameContext, type Player } from '../ctx';
import { distanceBetween, learnSkill, rateLimit, requireIdle, skillBlocker } from './econ';
import { addGold, addItem, removeAt, roomFor } from './lib';

/**
 * Shops, teaching and inns: commands buy, sell, learn, rest.
 * Owner: gameplay-economy. See docs/GAMEPLAY_SPEC.md section 5 and docs/notes/gameplay-economy.md.
 *
 * The price helpers are exported because the NPC menu (npcmenu.ts) shows exactly what the commands charge.
 */

/** Tiles between the player and the NPC for any service. */
export const SERVICE_RANGE = 6;
/** Reputation with the NPC's faction at or below which the NPC refuses all service. */
export const REFUSE_REP = -70;
export const MAX_TRADE_QTY = 99;
/** Markup on an item's base value when buying. */
export const BUY_MARKUP = 1.15;
/** Skills of this tier or higher need reputation >= TIER3_REP with the teacher's faction. */
export const TIER3_REP = 20;
/** Fraction of the price a master charges his own disciple. */
export const MASTER_DISCOUNT = 0.8;

// ---------------------------------------------------------------------------
// Price helpers
// ---------------------------------------------------------------------------

/** Player's reputation with the faction the NPC belongs to (0 for independents). */
export function repWith(save: CharacterSave, npc: NpcState): number {
  return npc.faction ? (save.reputation[npc.faction] ?? 0) : 0;
}

/** Price multiplier from reputation: 0.9 at >= 60, 0.95 at >= 30, 1.1 at <= -30. */
export function repDiscount(rep: number): number {
  if (rep >= 60) return 0.9;
  if (rep >= 30) return 0.95;
  if (rep <= -30) return 1.1;
  return 1;
}

export function refusesService(save: CharacterSave, npc: NpcState): boolean {
  return repWith(save, npc) <= REFUSE_REP;
}

/** Gold per unit the NPC charges for `itemId` right now. */
export function buyPrice(ctx: GameContext, p: Player, npc: NpcState, itemId: string): number {
  const def = getItem(itemId);
  if (!def) return 0;
  return Math.max(1, Math.ceil(def.value * BUY_MARKUP * ctx.sim.priceMult(npc.settlementId, itemId) * repDiscount(repWith(p.save, npc))));
}

/** Gold per unit the NPC pays for this exact stack (rarity matters for equipment). */
export function sellPrice(ctx: GameContext, npc: NpcState, stack: ItemStack, sellMult: number): number {
  const pm = Math.min(1.5, Math.max(0.6, ctx.sim.priceMult(npc.settlementId, stack.id)));
  return Math.max(1, Math.floor(stackValue(stack) * sellMult * pm));
}

/** What a shop of this kind (`NpcState.shop`) is willing to buy from players. */
export function shopAccepts(shop: string, def: ItemDef): boolean {
  switch (shop) {
    case 'general':
      return def.kind === 'material' || def.kind === 'consumable';
    case 'weapons':
      return isEquipment(def) || def.id.startsWith('ore_') || def.id.startsWith('ingot_');
    case 'medicine':
      return def.kind === 'consumable' || def.id.startsWith('herb') || def.id === 'blight_core' || def.id === 'spirit_dew';
    case 'food':
      return ['meat', 'cooked_meat', 'grain', 'wine'].includes(def.id);
    default:
      return false;
  }
}

/** Shop rows with the prices this player pays. Empty when the NPC has no shop. */
export function shopEntries(ctx: GameContext, p: Player, npc: NpcState): NonNullable<NpcMenu['shop']> | null {
  const listing = ctx.sim.shopFor(npc);
  if (!listing) return null;
  const entries: ShopEntry[] = [];
  for (const id of listing.items) if (getItem(id)) entries.push({ id, price: buyPrice(ctx, p, npc, id), stock: null });
  const sellPrices = p.save.inventory.map((stack) => {
    const def = getItem(stack.id);
    return def && shopAccepts(npc.shop, def) ? sellPrice(ctx, npc, stack, listing.sellMult) : 0;
  });
  return { entries, sellMult: listing.sellMult, kind: npc.shop, sellPrices };
}

/** Gold a master charges this player for a skill (own master: 20% off). */
export function learnPrice(p: Player, npc: NpcState, skillId: string): number {
  const base = SKILLS[skillId]?.req.gold ?? 0;
  return p.save.masterId === -npc.id ? Math.ceil(base * MASTER_DISCOUNT) : base;
}

export interface LearnStatus {
  ok: boolean;
  code?: string;
  reason?: string;
}

/** Whether `p` could learn `skillId` from `npc` right now (everything but distance / combat). */
export function learnStatus(p: Player, npc: NpcState, skillId: string): LearnStatus {
  const def = SKILLS[skillId];
  if (!def || !npc.teaches.includes(skillId)) return { ok: false, code: 'not_taught', reason: 'They do not teach that.' };
  const blocker = skillBlocker(p.save, skillId);
  if (blocker) return { ok: false, code: blocker.code, reason: blocker.text };
  if (npc.faction) {
    const need = def.tier >= 3 ? TIER3_REP : 0;
    if (repWith(p.save, npc) < need) return { ok: false, code: 'rep_low', reason: `Requires reputation ${need} with this faction.` };
  }
  const price = learnPrice(p, npc, skillId);
  if (p.save.gold < price) return { ok: false, code: 'no_gold', reason: `Costs ${price} gold.` };
  return { ok: true };
}

export function teachEntries(p: Player, npc: NpcState): TeachEntry[] {
  const out: TeachEntry[] = [];
  for (const skill of npc.teaches) {
    if (!SKILLS[skill]) continue;
    const learned = !!p.save.skills[skill];
    const st: LearnStatus = learned ? { ok: false, reason: 'Already learned.' } : learnStatus(p, npc, skill);
    const e: TeachEntry = { skill, gold: learnPrice(p, npc, skill), learned, ok: st.ok };
    if (!st.ok && st.reason) e.reason = st.reason;
    out.push(e);
  }
  return out;
}

/** Gold an innkeeper charges for a full rest. */
export function restPrice(p: Player): number {
  return 10 + p.save.level * 3;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function register(ctx: GameContext): void {
  /** Common checks for every NPC service: alive, out of fight, close enough, not hostile. */
  const serve = (p: Player, npcId: number): { npc: NpcState; ent: Entity } => {
    requireIdle(p);
    const npc = Number.isInteger(npcId) ? ctx.sim.npc(npcId) : undefined;
    const ent = npc ? ctx.npcEntity(npc.id) : undefined;
    if (!npc || !npc.alive || !ent) throw new GameError('not_found', 'There is nobody there.');
    if (distanceBetween(p.entity, ent) > SERVICE_RANGE) throw new GameError('too_far', `Walk closer to ${npc.name} first.`);
    if (refusesService(p.save, npc)) throw new GameError('refused', `${npc.name} refuses to deal with you.`);
    return { npc, ent };
  };

  ctx.command('buy', (p, m) => {
    const { npc } = serve(p, m.npc);
    rateLimit(ctx, p, 'trade', 12, 2000);
    if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > MAX_TRADE_QTY) throw new GameError('bad_qty', `Quantity must be 1 to ${MAX_TRADE_QTY}.`);
    const listing = ctx.sim.shopFor(npc);
    if (!listing) throw new GameError('no_shop', `${npc.name} sells nothing.`);
    const def = getItem(m.item);
    if (!def || !listing.items.includes(m.item)) throw new GameError('not_sold', `${npc.name} does not sell that.`);
    const unit = buyPrice(ctx, p, npc, m.item);
    const total = unit * m.qty;
    if (p.save.gold < total) throw new GameError('no_gold', `You need ${total} gold.`);
    if (roomFor(p.save, m.item) < m.qty) throw new GameError('bag_full', 'You do not have room in your bag.');
    const added = addItem(p.save, isEquipment(def) ? { id: m.item, qty: m.qty, r: 0, aff: [] } : { id: m.item, qty: m.qty });
    if (added !== m.qty) throw new GameError('bag_full', 'You do not have room in your bag.'); // unreachable after roomFor
    addGold(p.save, -total);
    ctx.sim.recordTrade(npc.settlementId, m.item, m.qty, 'buy');
    ctx.notify(p, 'info', `Bought ${m.qty > 1 ? `${m.qty}x ` : ''}${def.name} for ${total} gold.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('sell', (p, m) => {
    const { npc } = serve(p, m.npc);
    rateLimit(ctx, p, 'trade', 12, 2000);
    const stack = Number.isInteger(m.idx) && m.idx >= 0 ? p.save.inventory[m.idx] : undefined;
    if (!stack || stack.id !== m.id) throw new GameError('bad_item', 'That item is no longer there.');
    if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > Math.min(MAX_TRADE_QTY, stack.qty)) throw new GameError('bad_qty', 'Invalid quantity.');
    const listing = ctx.sim.shopFor(npc);
    if (!listing) throw new GameError('no_shop', `${npc.name} buys nothing.`);
    const def = getItem(stack.id);
    if (!def || !shopAccepts(npc.shop, def)) throw new GameError('shop_refuses', `${npc.name} is not interested in that.`);
    const unit = sellPrice(ctx, npc, stack, listing.sellMult);
    const removed = removeAt(p.save, m.idx, m.id, m.qty);
    if (!removed) throw new GameError('bad_item', 'That item is no longer there.');
    const total = unit * m.qty;
    addGold(p.save, total);
    ctx.sim.recordTrade(npc.settlementId, removed.id, m.qty, 'sell');
    ctx.notify(p, 'info', `Sold ${m.qty > 1 ? `${m.qty}x ` : ''}${def.name} for ${total} gold.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('learn', (p, m) => {
    const { npc } = serve(p, m.npc);
    const st = learnStatus(p, npc, m.skill);
    if (!st.ok) throw new GameError(st.code ?? 'cannot_learn', st.reason ?? 'You cannot learn that.');
    addGold(p.save, -learnPrice(p, npc, m.skill));
    learnSkill(ctx, p, m.skill);
  });

  ctx.command('rest', (p, m) => {
    const { npc } = serve(p, m.npc);
    if (npc.role !== 'innkeeper') throw new GameError('not_innkeeper', `${npc.name} does not rent rooms.`);
    const save = p.save;
    const injured = save.injuryStacks > 0 && save.injuryUntil > ctx.now();
    const before = deriveForCharacter(save, ctx.now());
    if (!injured && save.hp >= before.maxHp && save.qi >= before.maxQi) throw new GameError('not_needed', 'You are already fully rested.');
    const price = restPrice(p);
    if (save.gold < price) throw new GameError('no_gold', `A room costs ${price} gold.`);
    addGold(save, -price);
    save.injuryUntil = 0;
    save.injuryStacks = 0;
    const d = deriveForCharacter(save, ctx.now());
    save.hp = d.maxHp;
    save.qi = d.maxQi;
    ctx.send(p, { t: 'fx', kind: 'heal', entity: p.entity.id, text: 'Rested' });
    ctx.notify(p, 'good', `You rest at the inn for ${price} gold and wake fully recovered.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });
}
