/**
 * Shared helpers for gameplay systems: inventory arithmetic, XP/gold/reputation grants.
 * Everything here mutates `p.save` (or a bare save for the pure inventory helpers) and, where it takes a
 * `ctx`, also schedules the save + client refresh. Keep game rules in `@murim/shared`.
 */
import {
  INVENTORY_SLOTS,
  TALENTS,
  applyXp,
  deriveForCharacter,
  getItem,
  isEquipment,
  levelLabel,
  type CharacterSave,
  type ItemStack,
  type XpResult,
} from '@murim/shared';
import type { GameContext, Player } from '../ctx';
import { getServices } from './services';
import './events';

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** Total quantity of an item id across all stacks (inventory only, not equipped gear). */
export function countItem(save: CharacterSave, id: string): number {
  let n = 0;
  for (const s of save.inventory) if (s.id === id) n += s.qty;
  return n;
}

export function freeSlots(save: CharacterSave): number {
  return Math.max(0, INVENTORY_SLOTS - save.inventory.length);
}

/** Next unique equipment id for this character. */
export function nextUid(save: CharacterSave): string {
  save.uidSeq = (save.uidSeq ?? 0) + 1;
  return `c${save.id}-s${save.uidSeq}`;
}

/** How many units of `id` could be added right now (merging into partial stacks first). */
export function roomFor(save: CharacterSave, id: string): number {
  const def = getItem(id);
  if (!def) return 0;
  if (isEquipment(def)) return freeSlots(save);
  let room = freeSlots(save) * def.stack;
  for (const s of save.inventory) if (s.id === id) room += def.stack - s.qty;
  return room;
}

/**
 * Add an item stack to the inventory, merging into partial stacks. Equipment is added one unit per
 * slot with a fresh uid (rarity/affixes preserved). Returns the quantity actually added (may be less
 * than requested when the bag is full; 0 for unknown ids). Does not call markDirty/markMe.
 */
export function addItem(save: CharacterSave, stack: ItemStack): number {
  const def = getItem(stack.id);
  if (!def || stack.qty <= 0) return 0;
  let left = Math.floor(stack.qty);
  let added = 0;
  if (isEquipment(def)) {
    while (left > 0 && save.inventory.length < INVENTORY_SLOTS) {
      save.inventory.push({ ...stack, qty: 1, uid: nextUid(save), aff: stack.aff ? stack.aff.map(([k, v]) => [k, v]) : undefined });
      left--;
      added++;
    }
    return added;
  }
  for (const s of save.inventory) {
    if (left <= 0) break;
    if (s.id !== stack.id || s.qty >= def.stack) continue;
    const put = Math.min(left, def.stack - s.qty);
    s.qty += put;
    left -= put;
    added += put;
  }
  while (left > 0 && save.inventory.length < INVENTORY_SLOTS) {
    const put = Math.min(left, def.stack);
    save.inventory.push({ id: stack.id, qty: put });
    left -= put;
    added += put;
  }
  return added;
}

/** Remove `qty` of an item id from the inventory (all-or-nothing). Returns false if not enough. */
export function removeItem(save: CharacterSave, id: string, qty: number): boolean {
  if (qty <= 0 || countItem(save, id) < qty) return false;
  let left = qty;
  for (let i = save.inventory.length - 1; i >= 0 && left > 0; i--) {
    const s = save.inventory[i];
    if (s.id !== id) continue;
    const take = Math.min(left, s.qty);
    s.qty -= take;
    left -= take;
    if (s.qty <= 0) save.inventory.splice(i, 1);
  }
  return true;
}

/**
 * Remove `qty` units from the stack at `idx`, verifying it is still `id` (clients send indexes).
 * Returns the removed stack (with its uid/rarity/affixes for equipment) or null if the check failed.
 */
export function removeAt(save: CharacterSave, idx: number, id: string, qty: number): ItemStack | null {
  const s = save.inventory[idx];
  if (!s || s.id !== id || qty <= 0 || qty > s.qty) return null;
  const out: ItemStack = { ...s, qty };
  s.qty -= qty;
  if (s.qty <= 0) save.inventory.splice(idx, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Currency, reputation, buffs
// ---------------------------------------------------------------------------

export function addGold(save: CharacterSave, amount: number): void {
  save.gold = Math.max(0, Math.floor(save.gold + amount));
}

export function addReputation(save: CharacterSave, faction: string, delta: number): number {
  const v = Math.max(-100, Math.min(100, (save.reputation[faction] ?? 0) + delta));
  save.reputation[faction] = v;
  return v;
}

export function hasBuff(save: CharacterSave, key: string, now: number): boolean {
  return (save.buffs?.[key] ?? 0) > now;
}

export function setBuff(save: CharacterSave, key: string, until: number): void {
  save.buffs = save.buffs ?? {};
  save.buffs[key] = until;
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/** Product of talent and registered (sect / master) XP multipliers for this player. */
export function xpMultiplier(ctx: GameContext, p: Player): number {
  let m = 1;
  for (const t of p.save.talents) m += TALENTS[t]?.xpBonus ?? 0;
  for (const f of getServices(ctx).xpModifiers) m *= f(p);
  return m;
}

/**
 * Give cultivation XP (multipliers applied unless `raw`). Handles level-ups: stat points, partial heal,
 * level-up fx + notification, `playerLevelUp` event, save + client refresh.
 */
export function grantXp(ctx: GameContext, p: Player, base: number, opts: { raw?: boolean } = {}): XpResult {
  const amount = opts.raw ? base : Math.round(base * xpMultiplier(ctx, p));
  const before = p.save.level;
  const wasFull = p.data.btFull === true;
  const res = applyXp(p.save, amount);
  if (res.levelsGained > 0) {
    const d = deriveForCharacter(p.save, ctx.now());
    p.save.hp = Math.max(p.save.hp, Math.round(d.maxHp * 0.6));
    p.save.qi = Math.max(p.save.qi, Math.round(d.maxQi * 0.6));
    ctx.send(p, { t: 'fx', kind: 'levelup', entity: p.entity.id, text: levelLabel(p.save.level) });
    ctx.notify(p, 'good', `You have reached ${levelLabel(p.save.level)}!`);
    ctx.events.emit('playerLevelUp', { player: p, from: before, to: p.save.level });
  }
  p.data.btFull = res.atBreakthrough;
  if (res.atBreakthrough && !wasFull) {
    ctx.notify(p, 'info', 'Your cultivation has reached its limit for this rank. Prepare a Breakthrough pill to advance.');
  }
  ctx.markDirty(p);
  ctx.markMe(p);
  return res;
}
