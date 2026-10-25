/**
 * Duel challenges. The fight itself belongs to the combat module (`getServices(ctx).combat.startDuel`).
 * Owner: gameplay-social.
 *
 * `challenge {id}` targets an ENTITY id (what the client sees on the map); `accept` / `decline` carry the
 * challenger's CHARACTER id (the `fromId` of the invite). The invite's `data` is `{ entity, stake }`.
 */
import { GameError, type GameContext, type Player } from '../ctx';
import { getServices } from './services';
import { Limiter, throttle } from './social';

export const DUEL_RANGE = 12;
export const DUEL_EXPIRY_MS = 30_000;
/** A stake may not exceed this share of the poorer fighter's gold. */
export const DUEL_STAKE_SHARE = 0.2;

interface Challenge {
  from: number;
  to: number;
  stake: number;
  expires: number;
}

export function register(ctx: GameContext): void {
  /** One open challenge per challenger, keyed by challenger character id. */
  const open = new Map<number, Challenge>();
  const senderLimit = new Limiter(ctx, 6, 60_000);
  const pairLimit = new Limiter(ctx, 1, 10_000);

  const inCombat = (p: Player): boolean => p.combatId !== null || !!getServices(ctx).combat?.inCombat(p);

  const liveChallenge = (fromId: number, toId: number): Challenge | undefined => {
    const c = open.get(fromId);
    if (!c || c.to !== toId) return undefined;
    if (c.expires <= ctx.now()) {
      open.delete(fromId);
      return undefined;
    }
    return c;
  };

  const maxStake = (a: Player, b: Player): number => Math.floor(Math.min(a.save.gold, b.save.gold) * DUEL_STAKE_SHARE);

  /** Shared checks at challenge and at accept time. */
  const validate = (a: Player, b: Player, stake: number): void => {
    if (!a.online || !b.online) throw new GameError('offline', 'Both fighters must be online.');
    if (a.entity.state === 'dead' || b.entity.state === 'dead') throw new GameError('dead', 'A fallen fighter cannot duel.');
    if (inCombat(a) || inCombat(b)) throw new GameError('in_combat', 'Both fighters must be out of combat.');
    if (Math.hypot(a.entity.x - b.entity.x, a.entity.y - b.entity.y) > DUEL_RANGE) throw new GameError('too_far', `You must be within ${DUEL_RANGE} tiles of each other.`);
    if (stake > maxStake(a, b)) throw new GameError('stake_high', `The stake may be at most ${maxStake(a, b)} gold (20% of the poorer fighter's gold).`);
  };

  const challenge = (p: Player, entityId: number, rawStake?: number): void => {
    const stake = Math.floor(rawStake ?? 0);
    if (!Number.isFinite(stake) || stake < 0) throw new GameError('bad_stake', 'Invalid stake.');
    const target = ctx.players.byEntityId(entityId);
    if (!target || !target.online) throw new GameError('not_found', 'There is nobody to challenge there.');
    if (target === p) throw new GameError('bad_target', 'You cannot duel yourself.');
    validate(p, target, stake);
    throttle(senderLimit, String(p.charId), 'You are issuing too many challenges.');
    throttle(pairLimit, `${p.charId}>${target.charId}`, 'You challenged them a moment ago.');
    open.set(p.charId, { from: p.charId, to: target.charId, stake, expires: ctx.now() + DUEL_EXPIRY_MS });
    ctx.send(target, { t: 'invite', kind: 'duel', fromId: p.charId, from: p.name, data: { entity: p.entity.id, stake } });
    ctx.notify(p, 'info', `You challenged ${target.name}${stake ? ` for ${stake} gold` : ''}. The challenge lasts 30 seconds.`);
  };

  const accept = (p: Player, fromId: number): void => {
    const c = liveChallenge(fromId, p.charId);
    const challenger = ctx.players.byCharId(fromId);
    if (!c || !challenger) throw new GameError('no_challenge', 'That challenge has expired.');
    open.delete(fromId);
    validate(challenger, p, c.stake);
    const combat = getServices(ctx).combat;
    if (!combat) throw new GameError('unavailable', 'Duels are not available right now.');
    if (!combat.startDuel(challenger, p, c.stake)) ctx.notify(p, 'warn', 'The duel could not begin.');
  };

  const decline = (p: Player, fromId: number): void => {
    const c = liveChallenge(fromId, p.charId);
    if (!c) throw new GameError('no_challenge', 'That challenge has expired.');
    open.delete(fromId);
    const challenger = ctx.players.byCharId(fromId);
    if (challenger?.online) ctx.notify(challenger, 'info', `${p.name} declined your challenge.`);
  };

  ctx.command('duel', (p, m) => {
    switch (m.op) {
      case 'challenge':
        return challenge(p, m.id, m.stake);
      case 'accept':
        return accept(p, m.id);
      case 'decline':
        return decline(p, m.id);
    }
  });

  ctx.onLogout((p) => {
    open.delete(p.charId);
    for (const [k, c] of open) if (c.to === p.charId) open.delete(k);
  });

  ctx.every(5_000, (now) => {
    for (const [k, c] of open) {
      if (c.expires > now) continue;
      open.delete(k);
      const from = ctx.players.byCharId(c.from);
      if (from?.online) ctx.notify(from, 'info', 'Your duel challenge expired.');
    }
  });
}
