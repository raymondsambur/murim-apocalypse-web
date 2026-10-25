/**
 * Test helpers for the NPC life system (not a test file). `makeLifeHarness` is `makeHarness` with a choice of
 * simulation (stub or the real sim), a fast world clock, and helpers to run world hours and read the clock.
 */
import { Rng, newCharacterSave, randomLook, rollCharacter, type C2S } from '@murim/shared';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { Game } from '../game/context';
import { nullLogger } from '../game/log';
import type { PlayerImpl } from '../game/players';
import { createSim } from '../sim/index';
import { createStubSim } from '../sim/stub';
import { FakeClock, FakeConn, testWorld } from '../testkit';
import { getNpcLife, npcLifeController } from './index';
import type { NpcLife } from './life';

export interface LifeHarness {
  game: Game;
  ctx: Game['ctx'];
  clock: FakeClock;
  hourMs: number;
  life: NpcLife;
  api: ReturnType<typeof getNpcLife>;
  join(name: string, at?: { x: number; y: number }): { p: PlayerImpl; conn: FakeConn };
  tick(n?: number): void;
  /** Run `n` world hours: ticks for one hour of fake time, then the sim's hourly step (as the runtime does). */
  hours(n: number): void;
  /** Set the world to this hour of day (0..24) without running the hours in between. */
  setHour(hour: number): void;
  /** Tick for `ms` of fake time. */
  run(ms: number): void;
  say(p: PlayerImpl, msg: C2S): void;
  close(): void;
}

export interface LifeHarnessOptions {
  real?: boolean;
  /** Real ms per world hour (default 6000 so a world day is 1440 ticks). */
  hourMs?: number;
  seed?: number;
  /** Register the NPC life system (default true). */
  life?: boolean;
  /** Register the system before `game.start()` spawns the NPC entities (the production order). */
  registerFirst?: boolean;
}

export function makeLifeHarness(opts: LifeHarnessOptions = {}): LifeHarness {
  const hourMs = opts.hourMs ?? 6000;
  const config = loadConfig({ SIM_STUB: opts.real ? undefined : '1', DB_PATH: ':memory:', WORLD_HOUR_MS: String(hourMs) });
  const db = openDb(':memory:');
  const clock = new FakeClock();
  const world = testWorld();
  const create = opts.real ? createSim : createStubSim;
  const sim = create(world, { seed: world.seed, hourMs, nowMs: clock.t, saved: null });
  const game = new Game({ world, sim, config, db, log: nullLogger, now: clock.now, rng: new Rng(opts.seed ?? 42) });
  const ctx = game.ctx;
  if (opts.registerFirst && opts.life !== false) npcLifeController(ctx).start();
  game.start();
  if (!opts.registerFirst && opts.life !== false) npcLifeController(ctx).start();
  let counter = 0;
  const h: LifeHarness = {
    game,
    ctx,
    clock,
    hourMs,
    life: npcLifeController(ctx),
    api: getNpcLife(ctx),
    join(name, at) {
      counter++;
      const user = db.createUser(`user${counter}_${name}`.slice(0, 20), 'x', 'y', clock.t);
      if (!user) throw new Error('could not create test user');
      const rng = new Rng(1000 + counter);
      const roll = rollCharacter(rng);
      const home = world.settlements[0];
      const created = db.createCharacter(user.id, name, (id) => newCharacterSave({ id, name, look: randomLook(rng), roll, homeSettlement: home.id, spawn: at ?? home.spawn, now: clock.t, rerolls: 0 }), clock.t);
      if (!created.ok) throw new Error('could not create test character');
      const conn = new FakeConn();
      const p = game.connect(conn, user);
      if (!p) throw new Error('connect failed');
      return { p, conn };
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        clock.advance(100);
        game.tick(clock.t, 100);
      }
    },
    hours(n) {
      for (let i = 0; i < n; i++) {
        h.run(hourMs);
        game.advanceHour(clock.t);
      }
    },
    setHour(hour) {
      const cur = sim.clock().hour;
      const delta = (((hour - cur) % 24) + 24) % 24;
      if (delta > 0) sim.state.clock.totalHours += delta;
    },
    run(ms) {
      h.tick(Math.round(ms / 100));
    },
    say(p, msg) {
      game.receive(p, msg);
    },
    close() {
      db.close();
    },
  };
  return h;
}
