/**
 * Smoke test: the real sim with every gameplay system that matters registered, two players standing in two
 * settlements, sieges forced into the sim and run through the real hourly roll. Nothing may log an error, the battles must
 * reach their finale and clean up, and the per-tick cost stays low.
 */
import { Rng, newCharacterSave, randomLook, rollCharacter, nearestWalkable } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { Game } from '../game/context';
import { createLogger } from '../game/log';
import { npcLifeController } from '../npclife';
import { createSim } from '../sim';
import { register as registerCombat } from '../systems/combat';
import { register as registerMonsters } from '../systems/monsters';
import { register as registerProgression } from '../systems/progression';
import { register as registerSiege } from '../systems/siege';
import { FakeClock, FakeConn, testWorld } from '../testkit';
import { getSiege } from './index';

describe('real sim smoke', () => {
  it('runs sieges through the sim roll with players looking on: no errors, clean finale, no leaks', () => {
    const errors: string[] = [];
    const log = createLogger('warn', 'smoke', { out: () => {}, err: (l) => void errors.push(l) });
    const config = loadConfig({ DB_PATH: ':memory:' });
    const db = openDb(':memory:');
    const clock = new FakeClock();
    const world = testWorld();
    const sim = createSim(world, { seed: world.seed, hourMs: config.hourMs, nowMs: clock.t, saved: null });
    const game = new Game({ world, sim, config, db, log, now: clock.now, rng: new Rng(11) });
    registerMonsters(game.ctx, { population: false });
    registerCombat(game.ctx);
    registerProgression(game.ctx);
    registerSiege(game.ctx);
    npcLifeController(game.ctx).start();
    game.start();
    const siege = getSiege(game.ctx)!;

    const sids = [0, 3];
    const players = sids.map((sid, i) => {
      const user = db.createUser(`smoke${i}`, 'x', 'y', clock.t)!;
      const rng = new Rng(100 + i);
      const at = nearestWalkable(game.grid, world.settlements[sid].spawn.x, world.settlements[sid].spawn.y, 6)!;
      db.createCharacter(user.id, `Looker${i}`, (id) => newCharacterSave({ id, name: `Looker${i}`, look: randomLook(rng), roll: rollCharacter(rng), homeSettlement: 0, spawn: at, now: clock.t, rerolls: 0 }), clock.t);
      const conn = new FakeConn();
      return { p: game.connect(conn, user)!, conn };
    });
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        clock.advance(100);
        game.tick(clock.t, 100);
      }
    };
    const t0 = performance.now();
    let ticks = 0;
    let finales = 0;
    const seen = new Set<number>();
    for (let hour = 0; hour < 12; hour++) {
      if (hour === 1) {
        siege.forceSiege(0, 'blight', 60, 4);
        sim.state.settlements[0].defense = 20;
      }
      if (hour === 2) {
        siege.forceSiege(3, 'blackwind', 40, 3);
        sim.state.settlements[3].defense = 80;
      }
      for (let i = 0; i < 6; i++) {
        tick(100);
        ticks += 100;
        for (const [sid, b] of siege.battles) {
          seen.add(sid);
          if (b.phase === 'finale') finales++;
        }
      }
      game.advanceHour(clock.t);
    }
    tick(500);
    ticks += 500;
    const perTick = (performance.now() - t0) / ticks;
    expect(perTick).toBeLessThan(25);
    expect(errors).toEqual([]);
    expect([...seen].sort()).toEqual([0, 3]);
    expect(finales).toBeGreaterThan(0);
    // every battle finished and left nothing behind
    expect(siege.battles.size).toBe(0);
    expect(game.entities.ofKind('monster')).toHaveLength(0);
    expect([...game.entities.all()].filter((e) => e.side)).toHaveLength(0);
    for (const s of sim.state.settlements) expect(s.siegeUntil).toBe(0);
    for (const n of sim.npcs()) expect(npcLifeController(game.ctx).isSeized(n.id)).toBe(false);
    void players;
    db.close();
  }, 120000);
});
