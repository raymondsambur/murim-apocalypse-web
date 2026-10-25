import { MAX_LEVEL, deriveForCharacter, gearLook, getItem, isBreakthroughLevel, isEquipment, rankOf, xpToNext, type EquipSlot, type ItemDef, type ItemStack } from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { clampVitals, ensureUid, rankLabel, requireIdle, skillBlocker, learnSkill } from './econ';
import { freeSlots, grantXp, removeAt } from './lib';

/**
 * Inventory commands: equip, unequip, use, drop.
 * Owner: gameplay-economy. See docs/GAMEPLAY_SPEC.md section 4 and docs/notes/gameplay-economy.md.
 *
 * Every command carries the expected item `id` next to the bag index and is rejected when they disagree.
 * None of them works while dead or fighting.
 */

const SLOTS: readonly EquipSlot[] = ['weapon', 'outfit', 'accessory'];

/** Rank needed to wear a piece: accessories may be worn one rank early. */
export function requiredRank(def: ItemDef): number {
  return Math.max(1, def.slot === 'accessory' ? def.tier - 1 : def.tier);
}

function stackAt(p: Player, idx: number, id: string): ItemStack {
  const s = Number.isInteger(idx) && idx >= 0 ? p.save.inventory[idx] : undefined;
  if (!s || s.id !== id) throw new GameError('bad_item', 'That item is no longer there.');
  return s;
}

export function register(ctx: GameContext): void {
  /** After a gear change: recompute maxima, clamp, sync the visible weapon, persist and refresh the client. */
  const gearChanged = (p: Player): void => {
    clampVitals(ctx, p);
    const w = p.save.equipment.weapon;
    p.entity.weapon = w ? getItem(w.id)?.weaponType : undefined;
    p.entity.gear = gearLook(p.save.equipment);
    ctx.entities.touch(p.entity);
    ctx.markDirty(p);
    ctx.markMe(p);
  };

  ctx.command('equip', (p, m) => {
    requireIdle(p);
    const stack = stackAt(p, m.idx, m.id);
    const def = getItem(stack.id);
    if (!def || !isEquipment(def) || !def.slot) throw new GameError('not_equipment', 'That cannot be equipped.');
    const need = requiredRank(def);
    if (rankOf(p.save.level) < need) throw new GameError('rank_low', `${def.name} requires ${rankLabel(need)} rank.`);
    const slot = def.slot;
    const cur = p.save.equipment[slot];
    let piece: ItemStack;
    if (stack.qty > 1) {
      // Not produced by the game, but never trust a stack: split one off and park the old piece right behind it.
      if (cur && freeSlots(p.save) === 0) throw new GameError('bag_full', 'Your bag is full.');
      stack.qty -= 1;
      piece = { ...stack, qty: 1 };
      if (cur) p.save.inventory.splice(m.idx + 1, 0, ensureUid(p.save, cur));
    } else {
      piece = stack;
      // The old piece takes the slot the new one leaves, so a swap never needs spare room.
      p.save.inventory.splice(m.idx, 1, ...(cur ? [ensureUid(p.save, cur)] : []));
    }
    p.save.equipment[slot] = ensureUid(p.save, piece);
    gearChanged(p);
    ctx.notify(p, 'info', `You equip ${def.name}.`);
  });

  ctx.command('unequip', (p, m) => {
    requireIdle(p);
    if (!SLOTS.includes(m.slot)) throw new GameError('bad_slot', 'Unknown equipment slot.');
    const cur = p.save.equipment[m.slot];
    if (!cur) throw new GameError('nothing_equipped', 'Nothing is equipped there.');
    if (freeSlots(p.save) === 0) throw new GameError('bag_full', 'Your bag is full.');
    p.save.inventory.push(ensureUid(p.save, cur));
    p.save.equipment[m.slot] = null;
    gearChanged(p);
    ctx.notify(p, 'info', `You remove ${getItem(cur.id)?.name ?? cur.id}.`);
  });

  ctx.command('use', (p, m) => {
    requireIdle(p);
    const stack = stackAt(p, m.idx, m.id);
    const def = getItem(stack.id);
    if (!def?.use) throw new GameError('cannot_use', 'You cannot use that.');
    const save = p.save;

    if (def.kind === 'manual') {
      const skillId = def.use.teach;
      if (!skillId) throw new GameError('cannot_use', 'You cannot use that.');
      const blocker = skillBlocker(save, skillId);
      if (blocker) throw new GameError(blocker.code, blocker.text);
      removeAt(save, m.idx, m.id, 1);
      learnSkill(ctx, p, skillId);
      return;
    }

    const use = def.use;
    if (use.breakthrough !== undefined) throw new GameError('use_breakthrough', 'A breakthrough pill is consumed by the Breakthrough action, not eaten directly.');
    const d = deriveForCharacter(save, ctx.now());
    const hpGain = use.heal ? Math.max(0, Math.min(use.heal, d.maxHp - save.hp)) : 0;
    const qiGain = use.qi ? Math.max(0, Math.min(use.qi, d.maxQi - save.qi)) : 0;
    let xpGain = 0;
    if (use.xp) {
      const full = save.level >= MAX_LEVEL || (isBreakthroughLevel(save.level) && save.xp >= xpToNext(save.level));
      if (full) throw new GameError('xp_full', 'Your cultivation is already at its limit. Break through first.');
      xpGain = use.xp;
    }
    if (hpGain === 0 && qiGain === 0 && xpGain === 0) {
      throw new GameError('no_effect', use.qi && !use.heal ? 'Your Qi is already full.' : 'You are already at full health.');
    }
    removeAt(save, m.idx, m.id, 1);
    const parts: string[] = [];
    if (hpGain) {
      save.hp += hpGain;
      parts.push(`+${hpGain} health`);
    }
    if (qiGain) {
      save.qi += qiGain;
      parts.push(`+${qiGain} Qi`);
    }
    if (hpGain || qiGain) ctx.send(p, { t: 'fx', kind: 'heal', entity: p.entity.id, text: parts.join(', ') });
    if (xpGain) {
      const res = grantXp(ctx, p, xpGain);
      parts.push(`+${res.gained} cultivation`);
    }
    ctx.notify(p, 'good', `${def.name}: ${parts.join(', ')}.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('drop', (p, m) => {
    requireIdle(p);
    const stack = stackAt(p, m.idx, m.id);
    if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > stack.qty) throw new GameError('bad_qty', 'Invalid quantity.');
    const removed = removeAt(p.save, m.idx, m.id, m.qty);
    if (!removed) throw new GameError('bad_item', 'That item is no longer there.');
    ctx.notify(p, 'info', `You discard ${m.qty > 1 ? `${m.qty}x ` : ''}${getItem(removed.id)?.name ?? removed.id}.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });
}
