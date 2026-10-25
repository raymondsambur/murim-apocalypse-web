import { ORIGINS, TALENTS, applyJobXp, deriveForCharacter, getItem, isPassable, type Dir, type ItemStack, type JobId, type NodeKind, type Rng } from '@murim/shared';
import { DataKey, type Entity, type GameContext, type Off, type Player } from '../ctx';
import { addItem, hasBuff, roomFor, setBuff } from './lib';
import './events';

/**
 * Resource nodes (herbs, ore) with timed gathering, and shrines.
 * Owner: gameplay-economy. See docs/GAMEPLAY_SPEC.md section 7 and docs/notes/gameplay-economy.md.
 *
 * Every `world.nodes` entry becomes a `kind:'node'` entity at boot. Blight hearts are only entities here: the
 * combat module owns their interaction (this module's `onInteract('node')` returns false for them).
 */

export const GATHER_MS = 3000;
export const RESPAWN_MIN_MS = 120_000;
export const RESPAWN_MAX_MS = 300_000;
/** Rare herbs need this herbalist level. */
export const RARE_HERB_LEVEL = 3;
/** The gatherer must still be this close (tiles) when the 3 s are up. */
export const GATHER_RANGE = 2.5;
export const SHRINE_COOLDOWN_MS = 10 * 60_000;
export const BLESSING_MS = 10 * 60_000;
export const BLESSING_BUFF = 'bless_blight';
export const SHRINE_HEAL = 0.5;
export const SHRINE_PURIFY = { radius: 6, amount: 30 } as const;
/** Respawned nodes appear within this many tiles of their original spot. */
const RESPAWN_SPREAD = 8;

interface NodeState {
  /** Index in `world.nodes`. */
  defId: number;
  kind: NodeKind;
  /** Where the world generator put it; respawns stay around here. */
  ax: number;
  ay: number;
  terrain: number;
  /** Character currently gathering this node. */
  busyWith: number | null;
}
export const NODE = new DataKey<NodeState>('node');

interface Gather {
  entityId: number;
  startedAt: number;
  off: Off;
}
const GATHER = new DataKey<Gather>('gather');

const NODE_INFO: Record<NodeKind, { name: string; sprite: string }> = {
  herb: { name: 'Qi-Gathering Grass', sprite: 'herb' },
  rareHerb: { name: 'Hundred-Year Ginseng', sprite: 'herb' },
  ore: { name: 'Iron Vein', sprite: 'ore' },
  shrine: { name: 'Wayside Shrine', sprite: 'shrine' },
  heart: { name: 'Blight Heart', sprite: 'heart' },
};

export interface GatherRoll {
  drops: ItemStack[];
  job: JobId;
  /** Job experience before talent / origin multipliers. */
  xp: number;
}

/** What one successful gather yields (pure given the rng). */
export function rollGather(rng: Rng, kind: 'herb' | 'rareHerb' | 'ore', jobLevel: number, fortune: number): GatherRoll {
  const bonus = Math.floor(jobLevel / 5) + (rng.chance(Math.min(0.5, Math.max(0, fortune) / 200)) ? 1 : 0);
  if (kind === 'herb') return { drops: [{ id: 'herb', qty: rng.int(1, 3) + bonus }], job: 'herbalist', xp: 5 };
  if (kind === 'rareHerb') return { drops: [{ id: 'herb_rare', qty: 1 + bonus }], job: 'herbalist', xp: 18 };
  const drops: ItemStack[] = [{ id: 'ore_iron', qty: rng.int(1, 3) + bonus }];
  let xp = 6;
  if (rng.chance(0.1)) {
    drops.push({ id: 'ore_silver', qty: 1 });
    xp += 10;
  }
  return { drops, job: 'miner', xp };
}

/** Talent (x1.3) and origin (x1.2) job experience bonuses. */
function jobXpMult(p: Player, job: JobId): number {
  let m = 1;
  if (p.save.talents.some((t) => TALENTS[t]?.jobXp?.includes(job))) m *= 1.3;
  if (ORIGINS[p.save.origin]?.jobBonus === job) m *= 1.2;
  return m;
}

function faceDir(from: Entity, to: Entity): Dir {
  const sx = to.x - to.y - (from.x - from.y);
  const sy = to.x + to.y - (from.x + from.y);
  if (sx >= 0) return sy >= 0 ? 0 : 3;
  return sy >= 0 ? 1 : 2;
}

export function register(ctx: GameContext): void {
  const gatherers = new Set<Player>();

  // ---- entities ------------------------------------------------------------------------------

  const spawn = (kind: NodeKind, defId: number, x: number, y: number, anchor: { ax: number; ay: number; terrain: number }): Entity => {
    const info = NODE_INFO[kind];
    const e = ctx.entities.create({ kind: 'node', name: info.name, x, y, sprite: info.sprite, nodeKind: kind });
    NODE.set(e, { defId, kind, ax: anchor.ax, ay: anchor.ay, terrain: anchor.terrain, busyWith: null });
    return e;
  };

  ctx.world.nodes.forEach((n) => {
    spawn(n.kind, n.id, n.x, n.y, { ax: n.x, ay: n.y, terrain: ctx.world.terrain[n.y * ctx.world.w + n.x] });
  });

  /** A free tile of the same terrain near the original spot, away from settlements and other nodes. */
  const pickSpot = (st: NodeState): { x: number; y: number } => {
    const w = ctx.world;
    for (let tries = 0; tries < 60; tries++) {
      const x = st.ax + ctx.rng.int(-RESPAWN_SPREAD, RESPAWN_SPREAD);
      const y = st.ay + ctx.rng.int(-RESPAWN_SPREAD, RESPAWN_SPREAD);
      if (Math.hypot(x - st.ax, y - st.ay) < 2) continue;
      if (!isPassable(w, x, y) || w.terrain[y * w.w + x] !== st.terrain) continue;
      if (w.settlements.some((s) => Math.hypot(s.x - x, s.y - y) <= s.radius + 2)) continue;
      if (ctx.entities.near(x, y, 1.5, (e) => e.kind === 'node').length > 0) continue;
      return { x, y };
    }
    return { x: st.ax, y: st.ay };
  };

  const deplete = (e: Entity, st: NodeState): void => {
    ctx.entities.remove(e);
    const delay = ctx.rng.int(RESPAWN_MIN_MS, RESPAWN_MAX_MS);
    ctx.after(delay, () => {
      const spot = pickSpot(st);
      spawn(st.kind, st.defId, spot.x, spot.y, st);
    });
  };

  // ---- gathering ---------------------------------------------------------------------------------

  const release = (p: Player): Gather | undefined => {
    const g = GATHER.get(p);
    if (!g) return undefined;
    g.off();
    GATHER.delete(p);
    gatherers.delete(p);
    const node = ctx.entities.get(g.entityId);
    const st = node ? NODE.get(node) : undefined;
    if (st && st.busyWith === p.charId) st.busyWith = null;
    if (p.entity.state === 'work' && !p.save.activity) {
      p.entity.state = 'idle';
      ctx.entities.touch(p.entity);
    }
    return g;
  };

  const cancel = (p: Player, say = true): void => {
    if (release(p) && say) ctx.notify(p, 'info', 'You stop gathering.');
  };

  const finish = (p: Player, startedAt: number): void => {
    const g = GATHER.get(p);
    if (!g || g.startedAt !== startedAt) return;
    const node = ctx.entities.get(g.entityId);
    const st = node ? NODE.get(node) : undefined;
    const interrupted = p.combatId !== null || p.entity.state === 'dead';
    release(p);
    if (!node || !st || interrupted || Math.hypot(node.x - p.entity.x, node.y - p.entity.y) > GATHER_RANGE) {
      ctx.notify(p, 'warn', 'Your gathering was interrupted.');
      return;
    }
    const kind = st.kind as 'herb' | 'rareHerb' | 'ore';
    const roll = rollGather(ctx.rng, kind, p.save.jobs[kind === 'ore' ? 'miner' : 'herbalist'].lv, p.save.stats.fortune);
    const got: string[] = [];
    let lost = false;
    for (const d of roll.drops) {
      const n = addItem(p.save, d);
      if (n < d.qty) lost = true;
      if (n > 0) got.push(`${n}x ${getItem(d.id)?.name ?? d.id}`);
    }
    const levels = applyJobXp(p.save, roll.job, Math.round(roll.xp * jobXpMult(p, roll.job)));
    if (levels > 0) ctx.notify(p, 'good', `Your ${roll.job} skill rose to level ${p.save.jobs[roll.job].lv}.`);
    ctx.notify(p, lost ? 'warn' : 'good', got.length ? `You gather ${got.join(', ')}${lost ? '. Your bag is full; the rest is lost' : ''}.` : 'Your bag is full; you gather nothing.');
    ctx.sendNear(node.x, node.y, 20, { t: 'fx', kind: 'gather', entity: node.id });
    ctx.events.emit('nodeGathered', { player: p, kind: st.kind, x: node.x, y: node.y });
    ctx.markDirty(p);
    ctx.markMe(p);
    deplete(node, st);
  };

  const startGather = (p: Player, node: Entity, st: NodeState): void => {
    if (p.entity.state === 'dead' || p.combatId !== null) return void ctx.notify(p, 'warn', 'You cannot gather right now.');
    if (p.save.activity) return void ctx.notify(p, 'warn', 'You are busy. Stop what you are doing first.');
    const cur = GATHER.get(p);
    if (cur?.entityId === node.id) return;
    if (st.busyWith !== null && st.busyWith !== p.charId) {
      const other = ctx.players.byCharId(st.busyWith);
      if (other && GATHER.get(other)?.entityId === node.id) return void ctx.notify(p, 'warn', 'Someone else is already working this spot.');
      st.busyWith = null;
    }
    if (st.kind === 'rareHerb' && p.save.jobs.herbalist.lv < RARE_HERB_LEVEL) {
      return void ctx.notify(p, 'warn', `You need Herbalist level ${RARE_HERB_LEVEL} to pick this safely.`);
    }
    const item = st.kind === 'ore' ? 'ore_iron' : st.kind === 'rareHerb' ? 'herb_rare' : 'herb';
    if (roomFor(p.save, item) <= 0) return void ctx.notify(p, 'warn', 'Your bag is full.');
    cancel(p, false);
    ctx.movement.stop(p.entity, true);
    const startedAt = ctx.now();
    st.busyWith = p.charId;
    GATHER.set(p, { entityId: node.id, startedAt, off: ctx.after(GATHER_MS, () => finish(p, startedAt)) });
    gatherers.add(p);
    p.entity.face = faceDir(p.entity, node);
    p.entity.state = 'work';
    ctx.entities.touch(p.entity);
  };

  const useShrine = (p: Player, shrine: Entity, st: NodeState): void => {
    if (p.entity.state === 'dead' || p.combatId !== null) return void ctx.notify(p, 'warn', 'You cannot pray right now.');
    const key = `shrine:${st.defId}`;
    const now = ctx.now();
    if (hasBuff(p.save, key, now)) {
      const mins = Math.ceil(((p.save.buffs?.[key] ?? now) - now) / 60_000);
      return void ctx.notify(p, 'info', `The shrine is quiet. Its blessing returns in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    const d = deriveForCharacter(p.save, now);
    p.save.hp = Math.min(d.maxHp, p.save.hp + Math.round(d.maxHp * SHRINE_HEAL));
    p.save.qi = Math.min(d.maxQi, p.save.qi + Math.round(d.maxQi * SHRINE_HEAL));
    setBuff(p.save, key, now + SHRINE_COOLDOWN_MS);
    setBuff(p.save, BLESSING_BUFF, now + BLESSING_MS);
    ctx.fanOut(ctx.sim.purify(shrine.x, shrine.y, SHRINE_PURIFY.radius, SHRINE_PURIFY.amount));
    ctx.sendNear(shrine.x, shrine.y, 20, { t: 'fx', kind: 'purify', entity: shrine.id });
    ctx.send(p, { t: 'fx', kind: 'heal', entity: p.entity.id, text: 'Blessed' });
    ctx.notify(p, 'good', 'The shrine warms you. Your wounds close, and a blessing steels you against the Blight for 10 minutes.');
    ctx.markDirty(p);
    ctx.markMe(p);
  };

  ctx.onInteract('node', (p, e) => {
    const st = NODE.get(e);
    if (!st) return false;
    if (st.kind === 'shrine') useShrine(p, e, st);
    else if (st.kind === 'heart') return false;
    else startGather(p, e, st);
    return true;
  });

  // ---- cancellation ---------------------------------------------------------------------------------
  // Moving (or interacting with something else) goes through the movement guards: cancel, then let it happen.
  ctx.movement.guards.push((p) => {
    if (GATHER.get(p)) cancel(p);
    return null;
  });
  // `stop` is a core command that only stops movement; wrap it so it also stops the gather.
  ctx.command(
    'stop',
    (p) => {
      cancel(p);
      ctx.movement.stop(p.entity);
    },
    { override: true },
  );
  ctx.onLogout((p) => cancel(p, false));
  ctx.onPlayerSync((p, e) => {
    // `markMe` re-derives the entity state from the save and would flatten our 'work'.
    if (GATHER.get(p) && p.combatId === null && e.state !== 'fight' && e.state !== 'dead') e.state = 'work';
  });
  // A fight (or death) ends the gather right away.
  ctx.onTick(() => {
    for (const p of gatherers) if (p.combatId !== null || p.entity.state === 'dead' || p.entity.state === 'fight') cancel(p);
  });
}
