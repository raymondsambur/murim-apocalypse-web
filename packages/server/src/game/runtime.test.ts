import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../testkit';
import { nullLogger } from './log';
import { Persistence, SIM_SNAPSHOT_KEY } from './persist';
import { MAX_BEHIND_HOURS, MAX_HOURS_PER_TICK, Runtime, TIME_BROADCAST_MS } from './runtime';

let h: Harness;
let runtime: Runtime;
let persistence: Persistence;

beforeEach(() => {
  h = makeHarness({ WORLD_HOUR_MS: '1000', AUTOSAVE_MS: '1000', WORLD_SAVE_MS: '5000' });
  persistence = new Persistence(
    { db: h.db, sim: h.game.sim, players: h.game.playerMgr, log: nullLogger, seed: h.world.seed, snapshotKey: SIM_SNAPSHOT_KEY, autosaveMs: h.config.autosaveMs, worldSaveMs: h.config.worldSaveMs },
    h.clock.t,
  );
  runtime = new Runtime({ game: h.game, persistence, log: nullLogger, hourAnchor: h.clock.t });
});
afterEach(() => {
  runtime.stop();
  h.close();
});

/** Drive the loop by hand: advance the fake clock by 100 ms per tick. */
function drive(ms: number): void {
  for (let i = 0; i < ms / 100; i++) {
    h.clock.advance(100);
    runtime.runOnce();
  }
}

describe('Runtime', () => {
  it('advances one world hour per hourMs, anchored to the schedule', () => {
    drive(10_000);
    expect(runtime.stats.hours).toBe(10);
    expect(h.game.sim.clock().totalHours).toBe(10);
  });

  it('broadcasts the time every 5 seconds', () => {
    const { conn } = h.join('Hero');
    conn.clear();
    drive(TIME_BROADCAST_MS * 2 + 100);
    // 10 hour boundaries also broadcast `time` (fan-out), plus the periodic ones.
    const hourly = runtime.stats.hours;
    expect(conn.of('time').length).toBe(hourly + 2);
  });

  it('catches up a stall gradually and skips what cannot be simulated', () => {
    h.clock.advance(20_000);
    runtime.runOnce();
    expect(runtime.stats.hours).toBe(MAX_HOURS_PER_TICK);
    for (let i = 0; i < 10; i++) runtime.runOnce();
    expect(runtime.stats.hours).toBe(20);

    // 10 hours of simulation time pass, then the machine sleeps for far longer than the cap.
    const before = runtime.stats.hours;
    h.clock.advance((MAX_BEHIND_HOURS + 1000) * 1000);
    for (let i = 0; i < 60; i++) runtime.runOnce();
    expect(runtime.stats.hours - before).toBeLessThanOrEqual(MAX_BEHIND_HOURS + 1);
  });

  it('autosaves dirty players and writes the world snapshot on schedule', () => {
    const { p } = h.join('Hero');
    p.save.gold += 77;
    h.game.ctx.markDirty(p);
    drive(1100);
    expect(h.db.getCharacterById(p.charId)!.save.gold).toBe(p.save.gold);
    expect(h.db.kvGet(SIM_SNAPSHOT_KEY)).toBeUndefined();
    drive(4500);
    expect(h.db.kvGet(SIM_SNAPSHOT_KEY)).toBeDefined();
  });

  it('a throwing system never stops the loop', () => {
    h.game.ctx.onTick(() => {
      throw new Error('tick bug');
    });
    h.game.ctx.onHour(() => {
      throw new Error('hour bug');
    });
    h.game.ctx.every(100, () => {
      throw new Error('timer bug');
    });
    expect(() => drive(3000)).not.toThrow();
    expect(runtime.stats.hours).toBe(3);
  });

  it('runs system timers (every/after) on the game loop', () => {
    const log: string[] = [];
    h.game.ctx.after(250, () => log.push('after'));
    h.game.ctx.every(1000, () => log.push('every'));
    drive(3500);
    expect(log).toEqual(['after', 'every', 'every', 'every']);
  });

  it('shutdown kicks and saves everyone and writes the world', () => {
    const a = h.join('Alice');
    const b = h.join('Bob');
    a.p.save.gold = 4242;
    drive(500);
    runtime.shutdown('Maintenance');
    expect(a.conn.of('kick')[0].reason).toBe('Maintenance');
    expect(a.conn.closedWith).not.toBeNull();
    expect(b.conn.closedWith).not.toBeNull();
    expect(h.db.getCharacterById(a.p.charId)!.save.gold).toBe(4242);
    expect(h.db.kvGet(SIM_SNAPSHOT_KEY)).toBeDefined();
    expect(h.game.players.onlineCount()).toBe(0);
    // Idempotent and no more ticks afterwards.
    expect(() => runtime.shutdown()).not.toThrow();
  });

  it('real timers: start() ticks and stop() ends it', async () => {
    runtime.start();
    expect(runtime.isRunning).toBe(true);
    await new Promise((r) => setTimeout(r, 450));
    runtime.stop();
    const ticks = runtime.stats.ticks;
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(ticks).toBeLessThanOrEqual(6);
    await new Promise((r) => setTimeout(r, 250));
    expect(runtime.stats.ticks).toBe(ticks);
    expect(runtime.stats.avgMs).toBeLessThan(50);
  });
});
