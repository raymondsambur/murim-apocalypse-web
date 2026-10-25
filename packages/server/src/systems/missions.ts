import { MAX_ACTIVE_MISSIONS, dist, getItem, rankOf, type ActiveMission, type MissionOffer, type NpcState, type ItemStack } from '@murim/shared';
import { GameError, NPC_DATA, type Entity, type GameContext, type Player } from '../ctx';
import { clampVitals, rankLabel, requireIdle } from './econ';
import { addGold, addItem, addReputation, countItem, grantXp, removeItem } from './lib';
import { getServices } from './services';
import './events';

/**
 * Mission board, accept / abandon / turn in, progress tracking and expiry.
 * Owner: gameplay-economy. See docs/GAMEPLAY_SPEC.md section 6 and docs/notes/gameplay-economy.md.
 *
 * Missions live in `p.save.missions` (persisted with the character). Progress comes from `monsterKilled` events
 * (hunt, purify, defend, bounty), a low-frequency proximity poll (investigate) and the bag contents (gather,
 * deliver: checked when polled / opened / handed in). The player must carry deliver goods himself.
 */

/** Board queries need the player within settlement radius + this many tiles. */
export const BOARD_RANGE = 6;
/** Accepting needs the player within settlement radius + this many tiles. */
export const ACCEPT_RANGE = 4;
/** Tiles between the player and the NPC he hands a mission to. */
export const TURNIN_RANGE = 6;
/** NPC roles that take any mission in their settlement (the offer's own giver always may). */
export const TURNIN_ROLES: ReadonlySet<string> = new Set(['elder', 'guard', 'master', 'merchant']);
/** Investigate missions are checked this often (ms). */
export const POLL_MS = 1000;
/** Bounty targets despawn after 30 min in the monsters service; we respawn the target a little before that. */
export const BOUNTY_REFRESH_MS = 29 * 60 * 1000;
/** Default radius (tiles) for investigate when the offer carries none. */
const INVESTIGATE_RADIUS = 2;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The plain offer behind an active mission (what goes back to the board / into `recordMissionDone`). */
export function offerOf(m: ActiveMission): MissionOffer {
  const { progress: _progress, acceptedDay: _acceptedDay, done: _done, ...offer } = clone(m);
  return offer;
}

/** Where (settlement id) this mission must be handed in. */
export function turnInSettlement(m: ActiveMission): number {
  return m.type === 'deliver' ? (m.target.toSettlement ?? m.settlementId) : m.settlementId;
}

/** May this NPC take this mission? (Location and range are checked separately.) */
export function canTurnInAt(m: ActiveMission, npc: NpcState): boolean {
  return npc.alive && npc.settlementId === turnInSettlement(m) && (TURNIN_ROLES.has(npc.role) || npc.id === m.giverId);
}

const COLLECT_TYPES: ReadonlySet<string> = new Set(['gather', 'deliver']);

function push(ctx: GameContext, p: Player, m: ActiveMission): void {
  ctx.send(p, { t: 'mission', update: { ...m } });
}

/** Sync gather / deliver progress with the bag. Returns true when something changed (updates are pushed). */
export function refreshCollect(ctx: GameContext, p: Player): boolean {
  let changed = false;
  for (const m of p.save.missions) {
    if (!COLLECT_TYPES.has(m.type) || !m.target.item) continue;
    const have = countItem(p.save, m.target.item);
    const progress = Math.min(m.target.count, have);
    const done = have >= m.target.count;
    if (progress !== m.progress || done !== m.done) {
      m.progress = progress;
      m.done = done;
      push(ctx, p, m);
      changed = true;
    }
  }
  if (changed) {
    ctx.markDirty(p);
    ctx.markMe(p);
  }
  return changed;
}

/** Ids of the player's finished missions that `npc` can take. */
export function turnInsFor(ctx: GameContext, p: Player, npc: NpcState): string[] {
  refreshCollect(ctx, p);
  return p.save.missions.filter((m) => m.done && canTurnInAt(m, npc)).map((m) => m.id);
}

export function register(ctx: GameContext): void {
  const services = getServices(ctx);
  const day = (): number => ctx.sim.clock().day;

  const removeBounty = (p: Player): void => services.monsters?.removeBounty(p.charId);

  const spawnBounty = (p: Player, m: ActiveMission): Entity | null | undefined => {
    const svc = services.monsters;
    if (!svc || !m.target.monster) return undefined;
    svc.removeBounty(p.charId);
    const e = svc.spawnBounty(p, m.target.monster, m.level, m.target.elite === 2 ? 2 : 1, m.settlementId);
    if (e) p.data.bountyAt = ctx.now();
    return e;
  };

  /** Progress one mission by `n`; pushes the update and announces completion. */
  const advance = (p: Player, m: ActiveMission, n = 1): void => {
    if (m.done) return;
    m.progress = Math.min(m.target.count, m.progress + n);
    if (m.progress >= m.target.count) {
      m.done = true;
      ctx.notify(p, 'good', `Objective complete: ${m.title}. Report back to ${ctx.world.settlements[turnInSettlement(m)]?.name ?? 'the giver'}.`);
    }
    push(ctx, p, m);
    ctx.markDirty(p);
    ctx.markMe(p);
  };

  const removeMission = (p: Player, m: ActiveMission): void => {
    const i = p.save.missions.indexOf(m);
    if (i >= 0) p.save.missions.splice(i, 1);
    if (m.type === 'bounty') removeBounty(p);
  };

  /** Drop missions whose day has come and that are not finished. */
  const sweepExpired = (p: Player): void => {
    if (p.save.missions.length === 0) return;
    refreshCollect(ctx, p);
    const today = day();
    let any = false;
    for (const m of [...p.save.missions]) {
      if (m.expires > today || m.done) continue;
      removeMission(p, m);
      ctx.notify(p, 'warn', `Mission expired: ${m.title}.`);
      any = true;
    }
    if (any) {
      ctx.markDirty(p);
      ctx.markMe(p);
    }
  };

  // ---- board ------------------------------------------------------------------------------

  const settlementNear = (p: Player, id: number, extra: number): void => {
    const def = Number.isInteger(id) ? ctx.world.settlements[id] : undefined;
    if (!def) throw new GameError('not_found', 'There is no such settlement.');
    if (dist(p.entity.x, p.entity.y, def.x, def.y) > def.radius + extra) throw new GameError('too_far', `Walk into ${def.name} to use its board.`);
  };

  ctx.query('board', (p, args) => {
    settlementNear(p, args.settlement, BOARD_RANGE);
    return { offers: ctx.sim.board(args.settlement), settlement: ctx.sim.settlementView(args.settlement) };
  });

  // ---- accept / abandon / turn in -------------------------------------------------------------

  ctx.command('maccept', (p, m) => {
    requireIdle(p);
    settlementNear(p, m.settlement, ACCEPT_RANGE);
    if (typeof m.offer !== 'string') throw new GameError('bad_message', 'Invalid offer.');
    const save = p.save;
    const offer = ctx.sim.board(m.settlement).find((o) => o.id === m.offer);
    if (!offer) throw new GameError('gone', 'That job is no longer posted.');
    if (save.missions.some((a) => a.id === offer.id)) throw new GameError('duplicate', 'You have already taken that job.');
    if (save.missions.length >= MAX_ACTIVE_MISSIONS) throw new GameError('too_many', `You can only carry ${MAX_ACTIVE_MISSIONS} jobs at once.`);
    if (rankOf(save.level) < offer.minRank) throw new GameError('rank_low', `That job needs ${rankLabel(offer.minRank)} rank.`);
    if (offer.type === 'bounty' && save.missions.some((a) => a.type === 'bounty')) throw new GameError('one_bounty', 'You are already hunting a bounty target.');
    const taken = ctx.sim.takeOffer(m.settlement, offer.id);
    if (!taken) throw new GameError('gone', 'That job is no longer posted.');
    const active: ActiveMission = { ...clone(taken), progress: 0, acceptedDay: day(), done: false };
    if (active.type === 'bounty') {
      const e = spawnBounty(p, active);
      if (e === null) {
        ctx.sim.returnOffer(taken);
        throw new GameError('no_target', 'Nobody can say where the target lurks right now. Try again later.');
      }
    }
    save.missions.push(active);
    refreshCollect(ctx, p);
    ctx.notify(p, 'info', `Job accepted: ${active.title}.`);
    push(ctx, p, active);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('mabandon', (p, m) => {
    const mission = p.save.missions.find((a) => a.id === m.id);
    if (!mission) throw new GameError('not_found', 'You have no such job.');
    removeMission(p, mission);
    ctx.sim.returnOffer(offerOf(mission));
    ctx.notify(p, 'info', `Job abandoned: ${mission.title}.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('mturnin', (p, m) => {
    requireIdle(p);
    const save = p.save;
    refreshCollect(ctx, p);
    const mission = save.missions.find((a) => a.id === m.id);
    if (!mission) throw new GameError('not_found', 'You have no such job.');
    if (!mission.done) {
      const t = mission.target;
      const what = COLLECT_TYPES.has(mission.type) && t.item ? `You still need ${t.count - countItem(save, t.item)} more ${getItem(t.item)?.name ?? t.item}.` : 'That job is not finished yet.';
      throw new GameError('not_done', what);
    }
    // Who takes it: the named NPC, or any fitting NPC close by.
    const here = (ent: Entity): NpcState | undefined => {
      const id = NPC_DATA.get(ent)?.npcId;
      const npc = id !== undefined ? ctx.sim.npc(id) : undefined;
      return npc && canTurnInAt(mission, npc) && Math.hypot(ent.x - p.entity.x, ent.y - p.entity.y) <= TURNIN_RANGE ? npc : undefined;
    };
    let taker: NpcState | undefined;
    if (m.npc !== undefined) {
      const ent = ctx.npcEntity(m.npc);
      taker = ent ? here(ent) : undefined;
    } else {
      taker = ctx.entities
        .near(p.entity.x, p.entity.y, TURNIN_RANGE, (e) => e.kind === 'npc')
        .sort((a, b) => Math.hypot(a.x - p.entity.x, a.y - p.entity.y) - Math.hypot(b.x - p.entity.x, b.y - p.entity.y))
        .map(here)
        .find((n) => !!n);
    }
    if (!taker) {
      const place = ctx.world.settlements[turnInSettlement(mission)]?.name ?? 'the settlement';
      throw new GameError('no_taker', `Hand this in to the elder, a guard, a master or a merchant of ${place}.`);
    }

    // Take the goods and pay out atomically: a full bag refuses the hand-in and changes nothing.
    const bag = clone(save.inventory);
    const uidSeq = save.uidSeq;
    const restore = (): void => {
      save.inventory.splice(0, save.inventory.length, ...bag);
      save.uidSeq = uidSeq;
    };
    if (COLLECT_TYPES.has(mission.type) && mission.target.item && !removeItem(save, mission.target.item, mission.target.count)) {
      restore();
      throw new GameError('not_done', 'You no longer have the goods.');
    }
    const items: ItemStack[] = mission.reward.items ?? [];
    for (const it of items) {
      if (addItem(save, it) < it.qty) {
        restore();
        throw new GameError('bag_full', 'Make room in your bag to receive the reward.');
      }
    }
    const reward = mission.reward;
    addGold(save, reward.gold);
    if (reward.rep) addReputation(save, reward.rep.faction, reward.rep.amount);
    save.completedMissions++;
    removeMission(p, mission);
    grantXp(ctx, p, reward.xp);
    ctx.fanOut(ctx.sim.recordMissionDone(offerOf(mission), p.name));
    ctx.events.emit('missionCompleted', { player: p, mission });
    const extra = items.map((it) => `${it.qty}x ${getItem(it.id)?.name ?? it.id}`);
    ctx.notify(p, 'good', `Job complete: ${mission.title}. +${reward.xp} xp, +${reward.gold} gold${extra.length ? `, ${extra.join(', ')}` : ''}.`);
    clampVitals(ctx, p);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  // ---- progress -------------------------------------------------------------------------------

  ctx.events.on('monsterKilled', (ev) => {
    for (const p of ev.killers) {
      for (const m of p.save.missions) {
        if (m.done) continue;
        const t = m.target;
        switch (m.type) {
          case 'hunt':
            if (ev.bountyFor === null && (t.monster ? ev.defId === t.monster : ev.family === t.family)) advance(p, m);
            break;
          case 'purify':
            if (ev.family === (t.family ?? 'blight') && t.x !== undefined && t.y !== undefined && dist(ev.x, ev.y, t.x, t.y) <= (t.radius ?? 8)) advance(p, m);
            break;
          case 'defend':
            if (ev.siege === m.settlementId && ctx.sim.settlementView(m.settlementId).siege) advance(p, m);
            break;
          case 'bounty':
            if (ev.bountyFor === p.charId && (!t.monster || ev.defId === t.monster)) advance(p, m);
            break;
          default:
            break;
        }
      }
    }
  });

  // Investigate: reach the spot. Gather / deliver: keep the counters in step with the bag. Bounty targets expire in the monsters service.
  ctx.every(POLL_MS, (now) => {
    for (const p of ctx.players.online()) {
      if (p.save.missions.length === 0 || p.entity.state === 'dead') continue;
      for (const m of p.save.missions) {
        if (m.done) continue;
        if (m.type === 'investigate' && m.target.x !== undefined && m.target.y !== undefined) {
          if (dist(p.entity.x, p.entity.y, m.target.x, m.target.y) <= (m.target.radius ?? INVESTIGATE_RADIUS)) advance(p, m);
        } else if (m.type === 'bounty' && now - ((p.data.bountyAt as number | undefined) ?? now) > BOUNTY_REFRESH_MS) {
          spawnBounty(p, m);
        }
      }
      refreshCollect(ctx, p);
    }
  });

  // ---- expiry and session edges ----------------------------------------------------------------

  ctx.onHour(() => {
    for (const p of ctx.players.all()) sweepExpired(p);
  });

  ctx.onLogin((p) => {
    sweepExpired(p);
    refreshCollect(ctx, p);
    const bounty = p.save.missions.find((m) => m.type === 'bounty' && !m.done);
    if (bounty) spawnBounty(p, bounty);
  });

  ctx.onLogout((p) => {
    if (p.save.missions.some((m) => m.type === 'bounty')) removeBounty(p);
  });
}
