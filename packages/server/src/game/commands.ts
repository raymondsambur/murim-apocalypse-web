/**
 * Built-in client commands: move, stop, interact, chat, title.
 *
 * Gameplay modules can replace any of them with `ctx.command(t, handler, {override: true})`, but
 * normally they just register `ctx.onInteract(kind, ...)` and let `interact` do the walking.
 */
import { dist } from '@murim/shared';
import { GameError, NPC_DATA, type Entity, type GameContext, type Player } from '../ctx';
import { TokenBucket } from '../net/ratelimit';
import type { Chat } from './chat';
import type { NpcManager } from './npcs';
import type { PlayerImpl } from './players';
import type { Registry } from './registry';

/** Distance (tiles) at which an interaction triggers without walking: adjacent, diagonals included. */
export const INTERACT_RANGE = 1.5;
export const MAX_TITLE_LENGTH = 24;
/** Path-finding requests (move / interact) per second per player: bounds the A* work a client can cause. */
export const PATH_REQUESTS_PER_SEC = 8;
export const PATH_REQUEST_BURST = 10;

const MOVE_FAILURES = {
  blocked: 'You cannot go there.',
  unreachable: 'There is no way to get there.',
  too_far: 'That is too far; travel in shorter hops.',
} as const;

export interface CoreCommandDeps {
  chat: Chat;
  npcs: NpcManager;
  registry: Registry;
}

export function registerCoreCommands(ctx: GameContext, deps: CoreCommandDeps): void {
  const { chat, npcs, registry } = deps;
  const pathBuckets = new WeakMap<Player, TokenBucket>();

  /** Throws when the player asks for paths faster than a human plausibly clicks. */
  const throttlePath = (p: Player): void => {
    const now = ctx.now();
    let b = pathBuckets.get(p);
    if (!b) {
      b = new TokenBucket(PATH_REQUESTS_PER_SEC, PATH_REQUEST_BURST, now);
      pathBuckets.set(p, b);
    }
    if (!b.take(now)) throw new GameError('slow_down', 'Slow down a little.');
  };

  /** Run the interact handlers for `e`; the first one returning true wins. */
  const dispatch = (p: Player, e: Entity): void => {
    if (!p.online || !ctx.entities.has(e.id)) return;
    if (e.kind === 'npc') npcs.attend(e, p);
    for (const h of [...(registry.interact.get(e.kind) ?? [])]) {
      let handled = false;
      try {
        handled = h(p, e);
      } catch (err) {
        registry.reportError(`interact:${e.kind}`, err);
      }
      if (handled) return;
    }
    const npcId = e.kind === 'npc' ? NPC_DATA.get(e)?.npcId : undefined;
    const npc = npcId !== undefined ? ctx.sim.npc(npcId) : undefined;
    if (npc) ctx.notify(p, 'info', `${npc.name}: ${ctx.sim.greeting(npc, p.name)}`);
    else ctx.notify(p, 'info', 'Nothing happens.');
  };

  ctx.command('move', (p, m) => {
    throttlePath(p);
    const reason = ctx.movement.canMove(p);
    if (reason) throw new GameError('cannot_move', reason);
    const r = ctx.movement.moveTo(p.entity, m.x, m.y);
    if (!r.ok) throw new GameError(r.reason, MOVE_FAILURES[r.reason]);
  });

  ctx.command('stop', (p) => {
    ctx.movement.stop(p.entity);
  });

  ctx.command('interact', (p, m) => {
    const target = ctx.entities.get(m.id);
    // Only entities the client has been told about can be targeted.
    if (!target || target.hidden || target.id === p.entity.id || !(p as PlayerImpl).known.has(target.id)) throw new GameError('not_found', 'There is nothing there.');
    const e = p.entity;
    if (!e.move && dist(e.x, e.y, target.x, target.y) <= INTERACT_RANGE) {
      dispatch(p, target);
      return;
    }
    throttlePath(p);
    const reason = ctx.movement.canMove(p);
    if (reason) throw new GameError('cannot_move', reason);
    const r = ctx.movement.approach(e, target, {
      range: INTERACT_RANGE,
      onArrive: (_ent, result) => {
        if (result === 'arrived') registry.safe('interact', () => dispatch(p, target));
      },
    });
    if (!r.ok) throw new GameError(r.reason, MOVE_FAILURES[r.reason]);
  });

  ctx.command('chat', (p, m) => {
    chat.handle(p as PlayerImpl, m.ch, m.text, m.to);
  });

  ctx.command('title', (p, m) => {
    if (p.mutedUntil > ctx.now()) throw new GameError('muted', 'You cannot change your title while muted.');
    const title = chat.clean(m.title, 64);
    if (Array.from(title).length > MAX_TITLE_LENGTH) throw new GameError('title_too_long', `Titles are at most ${MAX_TITLE_LENGTH} characters.`);
    if (title === p.save.title) return;
    p.save.title = title;
    ctx.markDirty(p);
    ctx.markMe(p);
  });
}
