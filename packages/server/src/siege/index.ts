/**
 * Siege battles: makes the sim's raids and sieges visible (see docs/notes/siege-battles.md).
 *
 * The manager watches the sim's besieged settlements. While at least one online player is within sight of one, it runs
 * a `Battle` there (a war party that marches to the gate, defenders that fight it, the sim's result as the finale);
 * with nobody around it does nothing at all and leaves no entities behind. It owns the siege waves of the monster
 * module (which stops spawning its own ring of monsters once `delegateSieges` is called).
 */
import { dist, type SimEvent } from '@murim/shared';
import type { GameContext } from '../ctx';
import { getNpcLife, type NpcLifeApi } from '../npclife';
import '../systems/events';
import type { MonsterApi } from '../systems/monsters/state';
import { Battle, type BattleDeps } from './battle';
import { SIEGE_TUNING as T } from './tuning';

export { SIEGE_TUNING } from './tuning';
export { Battle } from './battle';
export type { BattlePhase, BattleStats } from './battle';

export interface SiegeApi {
  /** Running battles, by settlement id. */
  battles: ReadonlyMap<number, Battle>;
  /** Evaluate sieges and players near now (tests; normally every `scanMs`). */
  scan(): void;
  /** Run one battle step now (tests; normally every `stepMs`). */
  step(): void;
  /** Dev / tests: start a siege at a settlement through the sim state, as the sim would. */
  forceSiege(sid: number, by: string, strength: number, hours: number): boolean;
  /** Dev / tests: make the siege end at the next world hour (the sim rolls the result then). */
  forceEnd(sid: number): boolean;
  /** Entities of every running battle. */
  entityCount(): number;
}

const apis = new WeakMap<GameContext, SiegeApi>();

export function getSiege(ctx: GameContext): SiegeApi | undefined {
  return apis.get(ctx);
}

export class SiegeManager implements SiegeApi {
  readonly battles = new Map<number, Battle>();
  /** Settlements where a battle could not start (no gate, an error): do not try again before this time. */
  private readonly retryAt = new Map<number, number>();
  private readonly deps: BattleDeps;
  private readonly life: NpcLifeApi;

  constructor(
    private readonly ctx: GameContext,
    mon: MonsterApi,
  ) {
    this.life = getNpcLife(ctx);
    this.deps = { ctx, mon, life: this.life };
  }

  start(): void {
    const ctx = this.ctx;
    this.deps.mon.delegateSieges();
    apis.set(ctx, this);
    ctx.every(T.scanMs, () => this.scan());
    ctx.every(T.stepMs, () => this.step());
    ctx.onHour((events) => this.onHour(events));
    ctx.events.on('monsterKilled', (ev) => this.battles.get(ev.siege ?? -1)?.onPlayerKill(ev));
    ctx.onShutdown(() => this.teardownAll());
    // a player who fell in a battle is spared for a while after waking up (no death loop in the plaza)
    ctx.events.on('playerDied', ({ player }) => {
      if (this.battles.size) player.data.siegeSpareUntil = ctx.now() + T.spareMs;
    });
    ctx.onInteract('npc', (p, e) => {
      if (e.side !== 'def') return false;
      ctx.notify(p, 'info', `${e.name} is fighting for the town. Not now!`);
      return true;
    });
  }

  private besieged(sid: number): boolean {
    const s = this.ctx.sim.state.settlements[sid];
    return !!s && s.siegeUntil > 0;
  }

  private nearRadius(sid: number, extra: number): number {
    return (this.ctx.world.settlements[sid]?.radius ?? 12) + extra;
  }

  private playersNear(sid: number, extra: number): boolean {
    const s = this.ctx.world.settlements[sid];
    return !!s && this.ctx.players.near(s.x, s.y, this.nearRadius(sid, extra), true).length > 0;
  }

  /** Create battles where a siege is on and somebody is near; tear down those nobody watches. */
  scan(): void {
    const ctx = this.ctx;
    const now = ctx.now();
    for (const s of ctx.sim.state.settlements) {
      if (s.siegeUntil <= 0) continue;
      if (this.battles.has(s.id) || (this.retryAt.get(s.id) ?? 0) > now) continue;
      if (!this.playersNear(s.id, T.activateRadius)) continue;
      const by = s.siegeBy ?? 'blight';
      const b = new Battle(this.deps, s.id, by, now);
      let ok = false;
      try {
        ok = b.start(now);
      } catch (err) {
        ctx.log.error(`siege battle at ${s.id} failed to start`, err);
        b.teardown(now);
        this.retryAt.set(s.id, now + 15_000);
      }
      if (ok) this.battles.set(s.id, b);
      else if (!this.retryAt.has(s.id) || (this.retryAt.get(s.id) ?? 0) <= now) this.retryAt.set(s.id, now + 30_000);
    }
    for (const [sid, b] of [...this.battles]) {
      if (this.playersNear(sid, T.deactivateRadius)) b.lastNearAt = now;
      else if (now - b.lastNearAt > T.graceMs) {
        b.teardown(now);
        this.battles.delete(sid);
      }
    }
  }

  step(): void {
    if (this.battles.size === 0) return;
    const ctx = this.ctx;
    const now = ctx.now();
    for (const [sid, b] of [...this.battles]) {
      try {
        // The sim ended the siege without an event reaching us (tests, a fall by other means): resolve from the state.
        if (!this.besieged(sid) && b.phase !== 'finale' && b.phase !== 'done') b.onSimEnd([], now);
        b.step(now);
      } catch (err) {
        ctx.log.error(`siege battle at ${sid} failed`, err);
        b.teardown(now);
        this.retryAt.set(sid, now + 15_000);
      }
      if (b.phase === 'done') this.battles.delete(sid);
    }
  }

  private onHour(events: SimEvent[]): void {
    const now = this.ctx.now();
    for (const ev of events) {
      if (ev.k !== 'siege' || ev.start) continue;
      const b = this.battles.get(ev.settlementId);
      if (b) b.onSimEnd(events, now);
    }
  }

  teardownAll(): void {
    const now = this.ctx.now();
    for (const b of this.battles.values()) b.teardown(now);
    this.battles.clear();
  }

  entityCount(): number {
    let n = 0;
    for (const b of this.battles.values()) n += b.entities().length;
    return n;
  }

  forceSiege(sid: number, by: string, strength: number, hours: number): boolean {
    const ctx = this.ctx;
    const s = ctx.sim.state.settlements[sid];
    if (!s || s.status === 'fallen') return false;
    s.siegeUntil = ctx.sim.clock().totalHours + Math.max(1, Math.round(hours));
    s.siegeStrength = Math.round(strength * 10) / 10;
    s.siegeBy = by;
    s.status = 'besieged';
    const name = ctx.world.settlements[sid]?.name ?? `settlement ${sid}`;
    const text = by === 'blight' ? `Hollows pour out of the Blight and besiege ${name}!` : `Raiders lay siege to ${name}!`;
    const entry = ctx.sim.record(text, 2, sid, by === 'blight' ? 'blight' : 'faction');
    ctx.fanOut([
      { k: 'chron', entry },
      { k: 'siege', settlementId: sid, start: true },
      { k: 'settle', id: sid },
    ]);
    return true;
  }

  forceEnd(sid: number): boolean {
    const s = this.ctx.sim.state.settlements[sid];
    if (!s || s.siegeUntil <= 0) return false;
    s.siegeUntil = this.ctx.sim.clock().totalHours;
    return true;
  }
}

/** Nearest settlement to a point (dev trigger). */
export function nearestSettlementId(ctx: GameContext, x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (const s of ctx.world.settlements) {
    const d = dist(s.x, s.y, x, y);
    if (d < bd) {
      bd = d;
      best = s.id;
    }
  }
  return best;
}
