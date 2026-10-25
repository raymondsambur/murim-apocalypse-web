/**
 * Small helpers shared by the economy modules (inventory, shops, npcmenu, missions, nodes).
 * Owner: gameplay-economy.
 */
import { RANKS, SKILLS, activeSlots, deriveForCharacter, rankOf, sanitizeLoadout, type CharacterSave, type ItemStack } from '@murim/shared';
import { GameError, type Entity, type GameContext, type Player } from '../ctx';
import { nextUid } from './lib';

/** Refuse actions for dead players and players in a fight. */
export function requireIdle(p: Player): void {
  if (p.entity.state === 'dead') throw new GameError('dead', 'You are dead.');
  if (p.combatId !== null) throw new GameError('in_combat', 'You cannot do that while fighting.');
}

/** Sliding-window limiter per player and key (timestamps live in `p.data`). Throws `slow_down` when exceeded. */
export function rateLimit(ctx: GameContext, p: Player, key: string, max: number, windowMs: number): void {
  const now = ctx.now();
  const all = (p.data.econRate ??= {}) as Record<string, number[]>;
  const list = (all[key] ??= []);
  while (list.length && now - list[0] >= windowMs) list.shift();
  if (list.length >= max) throw new GameError('slow_down', 'Slow down a little.');
  list.push(now);
}

export function distanceBetween(a: Entity, b: Entity): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Clamp hp / qi to the (possibly changed) derived maxima. */
export function clampVitals(ctx: GameContext, p: Player): void {
  const d = deriveForCharacter(p.save, ctx.now());
  p.save.hp = Math.max(0, Math.min(p.save.hp, d.maxHp));
  p.save.qi = Math.max(0, Math.min(p.save.qi, d.maxQi));
}

export function rankLabel(rank: number): string {
  return RANKS[Math.max(0, Math.min(RANKS.length - 1, rank - 1))].name;
}

export interface Blocker {
  code: string;
  text: string;
}

/** Why this character cannot learn `skillId` from a manual / master right now (requirements only, not gold). */
export function skillBlocker(save: CharacterSave, skillId: string): Blocker | null {
  const def = SKILLS[skillId];
  if (!def) return { code: 'bad_skill', text: 'Unknown skill.' };
  if (save.skills[skillId]) return { code: 'already_known', text: `You already know ${def.name}.` };
  if (rankOf(save.level) < def.req.rank) return { code: 'rank_low', text: `Requires ${rankLabel(def.req.rank)} rank.` };
  for (const [k, v] of Object.entries(def.req.stats ?? {})) {
    if (v !== undefined && (save.stats as Record<string, number>)[k] < v) return { code: 'stats_low', text: `Requires ${k} ${v}.` };
  }
  return null;
}

/** Put a freshly learned skill into an empty loadout slot of the right kind (if there is one). */
export function fillLoadout(save: CharacterSave, skillId: string): void {
  const def = SKILLS[skillId];
  if (!def) return;
  const slots = activeSlots(rankOf(save.level));
  const lo = { active: [...save.loadout.active], internal: save.loadout.internal, movement: save.loadout.movement };
  while (lo.active.length < slots) lo.active.push(null);
  if (def.kind === 'active') {
    const i = lo.active.findIndex((s, n) => n < slots && !s);
    if (i >= 0) lo.active[i] = skillId;
  } else if (def.kind === 'internal') {
    if (!lo.internal) lo.internal = skillId;
  } else if (!lo.movement) lo.movement = skillId;
  save.loadout = sanitizeLoadout(save, lo);
}

/** Learn a skill at level 1 and refresh everything. The caller already checked requirements and paid. */
export function learnSkill(ctx: GameContext, p: Player, skillId: string): void {
  const def = SKILLS[skillId];
  if (!def) return;
  p.save.skills[skillId] = { lv: 1, xp: 0 };
  fillLoadout(p.save, skillId);
  clampVitals(ctx, p);
  ctx.send(p, { t: 'fx', kind: 'learn', entity: p.entity.id, text: def.name });
  ctx.notify(p, 'good', `You have learned ${def.name}.`);
  ctx.markDirty(p);
  ctx.markMe(p);
}

/** Make sure an equipment stack carries a uid. */
export function ensureUid(save: CharacterSave, s: ItemStack): ItemStack {
  if (!s.uid) s.uid = nextUid(save);
  return s;
}
