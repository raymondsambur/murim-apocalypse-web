import type { NpcMenu, NpcState } from '@murim/shared';
import { GameError, NPC_DATA, type GameContext, type Player } from '../ctx';
import { distanceBetween } from './econ';
import { turnInsFor } from './missions';
import { refusesService, restPrice, shopEntries, teachEntries } from './shops';

/**
 * The NPC menu: sent as `{t:'npc', menu}` when a player reaches an NPC, and returned by the `npc` query.
 * Owner: gameplay-economy. See docs/notes/gameplay-economy.md for the exact format.
 */

/** Other modules (e.g. social: master-disciple eligibility) add fields to the NPC menu by pushing a
 *  decorator here at register time. The builder calls every decorator after building the base menu. */
export const npcMenuDecorators: Array<(p: Player, npc: NpcState, menu: NpcMenu) => void> = [];

/** The `npc` query answers for NPCs within this many tiles. */
export const MENU_RANGE = 10;

/** Build the full menu a player sees when talking to `npc`. */
export function buildNpcMenu(ctx: GameContext, p: Player, npc: NpcState): NpcMenu {
  const hostile = refusesService(p.save, npc);
  const menu: NpcMenu = {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    title: npc.title,
    faction: npc.faction,
    settlementId: npc.settlementId,
    look: npc.look,
    level: npc.level,
    greeting: hostile ? `${npc.name} turns away from you.` : ctx.sim.greeting(npc, p.name),
    turnIns: hostile ? [] : turnInsFor(ctx, p, npc),
  };
  if (!hostile) {
    const shop = shopEntries(ctx, p, npc);
    if (shop) menu.shop = shop;
    if (npc.teaches.length > 0) menu.teaches = teachEntries(p, npc);
    if (npc.role === 'innkeeper') menu.restPrice = restPrice(p);
  }
  for (const decorate of npcMenuDecorators) {
    try {
      decorate(p, npc, menu);
    } catch (err) {
      ctx.log.warn('npc menu decorator failed', err);
    }
  }
  return menu;
}

export function register(ctx: GameContext): void {
  ctx.onInteract('npc', (p, e) => {
    const id = NPC_DATA.get(e)?.npcId;
    const npc = id !== undefined ? ctx.sim.npc(id) : undefined;
    if (!npc || !npc.alive) return false;
    ctx.send(p, { t: 'npc', menu: buildNpcMenu(ctx, p, npc) });
    return true;
  });

  ctx.query('npc', (p, args) => {
    const npc = Number.isInteger(args.id) ? ctx.sim.npc(args.id) : undefined;
    const ent = npc ? ctx.npcEntity(npc.id) : undefined;
    if (!npc || !npc.alive || !ent) throw new GameError('not_found', 'There is nobody there.');
    if (distanceBetween(p.entity, ent) > MENU_RANGE) throw new GameError('too_far', `Walk closer to ${npc.name} first.`);
    return buildNpcMenu(ctx, p, npc);
  });
}
