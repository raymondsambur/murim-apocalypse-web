/**
 * Smoke test: the real simulation with the combat, monster and progression modules registered, a
 * few simulated hours, a player wandering into packs. Nothing may log an error or throw.
 */
import { describe, expect, it } from 'vitest';
import { Rng, deriveForCharacter, newCharacterSave, nearestWalkable, randomLook, rollCharacter } from '@murim/shared';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { Game } from '../game/context';
import { createLogger } from '../game/log';
import { createSim } from '../sim';
import { FakeClock, FakeConn, testWorld } from '../testkit';
import { register as registerCombat } from './combat';
import { getMonsterApi, register as registerMonsters } from './monsters';
import { register as registerProgression } from './progression';

describe('real sim smoke', () => {
  it('runs hours of world time with players near monsters without errors', () => {
    const errors: string[] = [];
    const log = createLogger('warn', 'smoke', { out: () => {}, err: (l) => void errors.push(l) });
    const config = loadConfig({ DB_PATH: ':memory:' });
    const db = openDb(':memory:');
    const clock = new FakeClock();
    const world = testWorld();
    const sim = createSim(world, { seed: world.seed, hourMs: config.hourMs, nowMs: clock.t, saved: null });
    const game = new Game({ world, sim, config, db, log, now: clock.now, rng: new Rng(7) });
    registerMonsters(game.ctx);
    registerCombat(game.ctx);
    registerProgression(game.ctx);
    game.start();
    const mon = getMonsterApi(game.ctx)!;
    expect(mon.population()).toBeGreaterThan(50);

    const conns: FakeConn[] = [];
    const players = [0, 1, 2].map((i) => {
      const user = db.createUser(`smoke${i}`, 'x', 'y', clock.t)!;
      const rng = new Rng(100 + i);
      const sp = world.spawnPoints[i * 7];
      const at = nearestWalkable(game.grid, sp.x, sp.y, 6)!;
      db.createCharacter(user.id, `Smoker${i}`, (id) => newCharacterSave({ id, name: `Smoker${i}`, look: randomLook(rng), roll: rollCharacter(rng), homeSettlement: 0, spawn: at, now: clock.t, rerolls: 0 }), clock.t);
      const conn = new FakeConn();
      conns.push(conn);
      const p = game.connect(conn, user)!;
      p.save.level = 12 + i * 4;
      for (const k of Object.keys(p.save.stats) as (keyof typeof p.save.stats)[]) p.save.stats[k] = 25 + i * 10;
      p.save.hp = deriveForCharacter(p.save, clock.t).maxHp;
      return p;
    });

    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        clock.advance(100);
        game.tick(clock.t, 100);
      }
    };
    const t0 = performance.now();
    for (let hour = 0; hour < 30; hour++) {
      tick(100);
      // Poke around: walk toward the nearest monster, re-roll the siege state of a settlement now and then.
      for (const p of players) {
        if (p.combatId === null && p.entity.state !== 'dead') {
          const m = game.entities.nearest(p.entity.x, p.entity.y, 25, (e) => e.kind === 'monster' && !e.hidden && e.state !== 'dead');
          if (m) game.receive(p, { t: 'interact', id: m.id });
        }
      }
      if (hour === 10) {
        const s = sim.state.settlements[3];
        s.siegeUntil = sim.clock().totalHours + 6;
        s.siegeStrength = 35;
        s.siegeBy = 'blight';
        game.fanOut([{ k: 'siege', settlementId: 3, start: true }], clock.t);
      }
      game.advanceHour(clock.t);
    }
    const perTick = (performance.now() - t0) / 3000;
    expect(perTick).toBeLessThan(25);
    expect(errors).toEqual([]);
    expect(conns.some((c) => c.of('combat').length > 0)).toBe(true);
    expect(conns.some((c) => c.of('cend').length > 0)).toBe(true);
    expect(mon.population()).toBeGreaterThan(30);
    db.close();
  }, 60000);
});
