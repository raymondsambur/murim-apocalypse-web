/**
 * Test rig for the economy modules (not a test file): a harness with inventory, shops, npcmenu, missions and
 * nodes registered, one joined player with a blank bag, and helpers to run commands and queries.
 */
import { ITEMS, Rng, newCharacterSave, randomLook, rollCharacter, type C2S, type ItemStack, type MissionOffer, type NpcRole, type NpcState, type QueryName, type S2C } from '@murim/shared';
import { loadConfig } from '../config';
import type { Entity, GameContext } from '../ctx';
import { openDb } from '../db';
import { Game } from '../game/context';
import { nullLogger } from '../game/log';
import type { PlayerImpl } from '../game/players';
import { createSim } from '../sim';
import { FakeClock, FakeConn, makeHarness, testWorld, type Harness } from '../testkit';
import { register as registerInventory } from './inventory';
import { register as registerMissions } from './missions';
import { register as registerNodes } from './nodes';
import { register as registerNpcMenu } from './npcmenu';
import { register as registerShops } from './shops';

export interface Rig {
  h: Harness;
  ctx: GameContext;
  p: PlayerImpl;
  conn: FakeConn;
  sim: Harness['game']['sim'];
  /** Queue a command, run one tick, return the error (if any) and notes. */
  run(msg: C2S): { err: Extract<S2C, { t: 'err' }> | undefined; notes: string[] };
  /** Run a query and return the `res` message. */
  ask(name: QueryName, args: unknown): Extract<S2C, { t: 'res' }> | undefined;
  /** Make NPC `id` a different kind of NPC (the stub roster has elder 1, merchant 2, guards 3-4, villager 5 in settlement 0). */
  npc(id: number, patch?: Partial<NpcState>): { npc: NpcState; ent: Entity };
  /** Put the player next to an entity (and let the area-of-interest catch up). */
  stand(ent: Entity): void;
  /** A fake mission board; `sim.board / takeOffer / returnOffer` serve from it. */
  board: MissionOffer[];
}

export const NPC = { elder: 1, merchant: 2, guard: 3, guard2: 4, villager: 5 } as const;

/** A harness like `makeHarness()` but running the real world simulation instead of the stub. */
export function makeRealHarness(): Harness {
  const config = loadConfig({ DB_PATH: ':memory:' });
  const db = openDb(':memory:');
  const clock = new FakeClock();
  const world = testWorld();
  const sim = createSim(world, { seed: world.seed, hourMs: config.hourMs, nowMs: clock.t, saved: null });
  const game = new Game({ world, sim, config, db, log: nullLogger, now: clock.now, rng: new Rng(42) });
  game.start();
  let counter = 0;
  return {
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
      const created = db.createCharacter(user.id, name, (id) => newCharacterSave({ id, name, look: randomLook(rng), roll, homeSettlement: home.id, spawn: at ?? home.spawn, now: clock.t, rerolls: 0 }), clock.t);
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
}

export function makeRig(opts: { real?: boolean } = {}): Rig {
  const h = opts.real ? makeRealHarness() : makeHarness();
  const ctx = h.game.ctx;
  registerInventory(ctx);
  registerShops(ctx);
  registerNpcMenu(ctx);
  registerMissions(ctx);
  registerNodes(ctx);
  const { p, conn } = h.join('Hero');
  const sim = h.game.sim;
  // A blank, predictable character.
  p.save.inventory = [];
  p.save.gold = 0;
  p.save.level = 1;
  p.save.xp = 0;
  p.save.missions = [];
  p.save.reputation = {};
  p.save.equipment = { weapon: null, outfit: null, accessory: null };
  p.save.skills = {};
  p.save.loadout = { active: [null, null, null, null], internal: null, movement: null };
  p.save.stats = { might: 10, agility: 10, vitality: 10, spirit: 10, insight: 10, fortune: 10 };
  p.save.injuryStacks = 0;
  p.save.injuryUntil = 0;
  p.save.buffs = {};
  let qid = 0;
  const board: MissionOffer[] = [];
  if (!opts.real) {
    Object.assign(sim, {
      board: (sid: number) => board.filter((o) => o.settlementId === sid),
      takeOffer: (sid: number, id: string) => {
        const i = board.findIndex((o) => o.settlementId === sid && o.id === id);
        return i < 0 ? null : board.splice(i, 1)[0];
      },
      returnOffer: (o: MissionOffer) => {
        if (!board.some((b) => b.id === o.id)) board.push(o);
      },
    });
  }
  const rig: Rig = {
    h,
    ctx,
    p,
    conn,
    sim,
    board,
    run(msg) {
      conn.clear();
      h.say(p, msg);
      h.tick();
      return { err: conn.last('err'), notes: conn.of('note').map((n) => n.text) };
    },
    ask(name, args) {
      conn.clear();
      h.say(p, { t: 'q', id: ++qid, name, args } as C2S);
      return conn.last('res');
    },
    npc(id, patch = {}) {
      const npc = sim.npc(id);
      const ent = ctx.npcEntity(id);
      if (!npc || !ent) throw new Error(`no npc ${id}`);
      Object.assign(npc, patch);
      return { npc, ent };
    },
    stand(ent) {
      h.game.movement.teleport(p.entity, ent.x, ent.y);
      h.tick(2);
    },
  };
  h.tick(2);
  return rig;
}

export const stackOf = (id: string, qty = 1, extra: Partial<ItemStack> = {}): ItemStack => {
  if (!ITEMS[id]) throw new Error(`unknown item ${id}`);
  return { id, qty, ...extra };
};

export const role = (r: NpcRole): NpcRole => r;
