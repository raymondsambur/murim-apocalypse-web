/**
 * Shared helpers for server tests: a fully wired in-memory `Game` with the stub sim, a fake
 * clock, and fake socket connections that record what the server sends.
 * (Not a test file itself; imported by *.test.ts.)
 */
import { Rng, generateWorld, newCharacterSave, randomLook, rollCharacter, type C2S, type S2C, type WorldData } from '@murim/shared';
import { hashPassword } from './auth';
import { loadConfig, type Config } from './config';
import type { UserRow } from './db';
import { openDb, type Db } from './db';
import { Game } from './game/context';
import { nullLogger } from './game/log';
import type { ClientConn, PlayerImpl } from './game/players';
import { createStubSim } from './sim/stub';

let cachedWorld: WorldData | null = null;
/** The production-seed world, generated once per test file. */
export function testWorld(): WorldData {
  cachedWorld ??= generateWorld(1337);
  return cachedWorld;
}

export class FakeClock {
  constructor(public t = 1_700_000_000_000) {}
  now = (): number => this.t;
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
}

export class FakeConn implements ClientConn {
  static next = 1;
  readonly id = FakeConn.next++;
  readonly ip = '127.0.0.1';
  isOpen = true;
  closedWith: { code: number; reason: string } | null = null;
  readonly sent: S2C[] = [];
  get open(): boolean {
    return this.isOpen;
  }
  send(msg: S2C): void {
    if (this.isOpen) this.sent.push(msg);
  }
  sendRaw(json: string): void {
    if (this.isOpen) this.sent.push(JSON.parse(json) as S2C);
  }
  close(code: number, reason: string): void {
    this.isOpen = false;
    this.closedWith = { code, reason };
  }
  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.sent.filter((m): m is Extract<S2C, { t: T }> => m.t === t);
  }
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined {
    return this.of(t).at(-1);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

export interface Harness {
  config: Config;
  db: Db;
  clock: FakeClock;
  game: Game;
  world: WorldData;
  /** Create an account + character and connect it. */
  join(name: string, at?: { x: number; y: number }): { p: PlayerImpl; conn: FakeConn; user: UserRow };
  /** Run `n` game ticks, advancing the fake clock by 100 ms each. */
  tick(n?: number): void;
  /** Deliver a client message to a player (as the gateway would after validation). */
  say(p: PlayerImpl, msg: C2S): void;
  close(): void;
}

export function makeHarness(env: Record<string, string | undefined> = {}): Harness {
  const config = loadConfig({ SIM_STUB: '1', DB_PATH: ':memory:', ...env });
  const db = openDb(':memory:');
  const clock = new FakeClock();
  const world = testWorld();
  const sim = createStubSim(world, { seed: world.seed, hourMs: config.hourMs, nowMs: clock.t, saved: null });
  const game = new Game({ world, sim, config, db, log: nullLogger, now: clock.now, rng: new Rng(42) });
  game.start();
  let counter = 0;
  const h: Harness = {
    config,
    db,
    clock,
    game,
    world,
    join(name, at) {
      counter++;
      const user = db.createUser(`user${counter}_${name}`.slice(0, 20), 'x', 'y', clock.t);
      if (!user) throw new Error('could not create test user');
      const rng = new Rng(1000 + counter);
      const roll = rollCharacter(rng);
      const home = world.settlements[0];
      const created = db.createCharacter(
        user.id,
        name,
        (id) => newCharacterSave({ id, name, look: randomLook(rng), roll, homeSettlement: home.id, spawn: at ?? home.spawn, now: clock.t, rerolls: 0 }),
        clock.t,
      );
      if (!created.ok) throw new Error('could not create test character');
      const conn = new FakeConn();
      const p = game.connect(conn, user);
      if (!p) throw new Error('connect failed');
      return { p, conn, user };
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        clock.advance(100);
        game.tick(clock.t, 100);
      }
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

export { hashPassword };
