/**
 * The game loop: a drift-corrected 100 ms tick, the world-hour scheduler, periodic time
 * broadcasts, persistence, tick-duration monitoring and graceful shutdown.
 *
 * Nothing in here may throw out of a timer callback: every phase is wrapped so a bug in one
 * system degrades that system, never the server.
 */
import { TICK_MS } from '@murim/shared';
import type { Game } from './context';
import type { Logger } from './log';
import type { Persistence } from './persist';

/** Real-time interval between `time` broadcasts. */
export const TIME_BROADCAST_MS = 5000;
/** At most this many world hours are simulated in one tick when catching up after a stall. */
export const MAX_HOURS_PER_TICK = 4;
/** Hours the scheduler may fall behind before the excess is skipped (machine slept...). */
export const MAX_BEHIND_HOURS = 48;
/** Ticks slower than this are logged (rate limited). */
export const SLOW_TICK_MS = 60;
const SESSION_PURGE_MS = 10 * 60 * 1000;
const STATS_LOG_MS = 5 * 60 * 1000;

export interface RuntimeDeps {
  game: Game;
  persistence: Persistence;
  log: Logger;
  /** Wall-clock ms at which the sim's current world hour began (the next hour is due one `hourMs` later). */
  hourAnchor: number;
  tickMs?: number;
}

export interface TickStats {
  ticks: number;
  /** Exponential moving average of tick duration, ms. */
  avgMs: number;
  /** Slowest tick since the last stats reset, ms. */
  maxMs: number;
  lastMs: number;
  /** Ticks that took longer than TICK_MS. */
  overruns: number;
  /** Ticks skipped because the loop fell too far behind. */
  skipped: number;
  hours: number;
}

export class Runtime {
  private readonly game: Game;
  private readonly persistence: Persistence;
  private readonly log: Logger;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private nextTickAt = 0;
  private lastTickWall = 0;
  private nextHourAt: number;
  private nextTimeAt = 0;
  private nextPurgeAt = 0;
  private nextStatsAt = 0;
  private lastSlowLog = 0;
  readonly stats: TickStats = { ticks: 0, avgMs: 0, maxMs: 0, lastMs: 0, overruns: 0, skipped: 0, hours: 0 };

  constructor(deps: RuntimeDeps) {
    this.game = deps.game;
    this.persistence = deps.persistence;
    this.log = deps.log.child('runtime');
    this.tickMs = deps.tickMs ?? TICK_MS;
    this.nextHourAt = deps.hourAnchor + deps.game.sim.hourMs;
    const now = deps.game.now();
    this.lastTickWall = now;
    this.nextTimeAt = now + TIME_BROADCAST_MS;
    this.nextPurgeAt = now + SESSION_PURGE_MS;
    this.nextStatsAt = now + STATS_LOG_MS;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start ticking (the caller has already run `game.start()`). */
  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.lastTickWall = this.game.now();
    this.nextTickAt = performance.now() + this.tickMs;
    this.schedule();
  }

  private schedule(): void {
    if (!this.running) return;
    const delay = Math.max(0, this.nextTickAt - performance.now());
    this.timer = setTimeout(() => this.loop(), delay);
  }

  private loop(): void {
    if (!this.running) return;
    const t0 = performance.now();
    try {
      this.runOnce();
    } catch (err) {
      this.log.error('tick failed', err);
    }
    const t1 = performance.now();
    const dur = t1 - t0;
    const s = this.stats;
    s.ticks++;
    s.lastMs = dur;
    s.avgMs = s.ticks === 1 ? dur : s.avgMs * 0.95 + dur * 0.05;
    if (dur > s.maxMs) s.maxMs = dur;
    if (dur > this.tickMs) s.overruns++;
    if (dur > SLOW_TICK_MS && t1 - this.lastSlowLog > 10000) {
      this.lastSlowLog = t1;
      this.log.warn(`slow tick: ${dur.toFixed(1)} ms (avg ${s.avgMs.toFixed(1)} ms, ${this.game.players.onlineCount()} online, ${this.game.entities.count()} entities)`);
    }
    // Drift-corrected schedule: aim for fixed boundaries, but never try to "catch up" a long stall.
    this.nextTickAt += this.tickMs;
    if (t1 - this.nextTickAt > this.tickMs * 5) {
      s.skipped += Math.floor((t1 - this.nextTickAt) / this.tickMs);
      this.nextTickAt = t1 + this.tickMs;
    }
    this.schedule();
  }

  /** One tick of everything. Public so tests can drive the loop manually. */
  runOnce(): void {
    const { game } = this;
    const now = game.now();
    const dt = Math.min(1000, Math.max(0, now - this.lastTickWall));
    this.lastTickWall = now;
    this.phase('game', () => game.tick(now, dt));
    this.phase('hours', () => this.runHours(now));
    this.phase('time', () => {
      if (now >= this.nextTimeAt) {
        this.nextTimeAt = now + TIME_BROADCAST_MS;
        game.broadcast({ t: 'time', time: game.sim.timeView(now) });
      }
    });
    this.phase('persist', () => this.persistence.tick(now));
    this.phase('maintenance', () => {
      if (now >= this.nextPurgeAt) {
        this.nextPurgeAt = now + SESSION_PURGE_MS;
        const n = game.db.purgeExpiredSessions(now);
        if (n) this.log.debug(`purged ${n} expired session(s)`);
      }
      if (now >= this.nextStatsAt) {
        this.nextStatsAt = now + STATS_LOG_MS;
        const s = this.stats;
        this.log.info(`status: ${game.players.onlineCount()} online, ${game.entities.count()} entities, tick avg ${s.avgMs.toFixed(1)} ms max ${s.maxMs.toFixed(1)} ms, ${s.overruns} overrun(s)`);
        s.maxMs = 0;
      }
    });
  }

  private phase(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log.error(`${name} phase failed`, err);
    }
  }

  /** Advance the sim for every world hour that is due. */
  private runHours(now: number): void {
    const hourMs = this.game.sim.hourMs;
    const behind = Math.floor((now - this.nextHourAt) / hourMs);
    if (behind > MAX_BEHIND_HOURS) {
      this.log.warn(`world clock fell ${behind} hours behind; skipping ${behind - MAX_BEHIND_HOURS}`);
      this.nextHourAt += (behind - MAX_BEHIND_HOURS) * hourMs;
    }
    for (let n = 0; n < MAX_HOURS_PER_TICK && now >= this.nextHourAt; n++) {
      const at = this.nextHourAt;
      this.nextHourAt += hourMs;
      this.stats.hours++;
      // The scheduled boundary (not `now`) anchors the sim clock, so lateness never accumulates.
      this.phase('hour', () => this.game.advanceHour(at));
    }
  }

  /** Stop ticking (idempotent). */
  stop(): void {
    this.running = false;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Stop, tell everyone, and write every character plus the world snapshot. */
  shutdown(reason = 'The server is restarting.'): void {
    this.stop();
    const now = this.game.now();
    try {
      this.game.disconnectAll(reason);
    } catch (err) {
      this.log.error('error while disconnecting players', err);
    }
    try {
      this.persistence.saveAll(now);
    } catch (err) {
      this.log.error('final save failed', err);
    }
  }
}
