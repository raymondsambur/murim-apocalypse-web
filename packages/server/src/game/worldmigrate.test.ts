import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateWorld } from '@murim/shared';
import { openDb } from '../db';
import { startServer } from '../server';
import { makeHarness, type Harness } from '../testkit';
import { nullLogger } from './log';
import { SIM_SNAPSHOT_KEY } from './persist';
import { relocateCharactersIfWorldChanged, simFitsWorld, worldSignature } from './worldmigrate';

let h: Harness | null = null;
afterEach(() => {
  h?.close();
  h = null;
});

describe('relocateCharactersIfWorldChanged', () => {
  it('moves characters to their last town once when the layout changes, then leaves them alone', () => {
    h = makeHarness();
    const a = h.join('Wanderer');
    const world = h.world;
    // Pretend the character was saved somewhere out in the old world.
    a.p.save.x = 3;
    a.p.save.y = 4;
    a.p.save.lastTown = 2;
    h.db.saveCharacter(a.p.save, h.clock.t);

    expect(relocateCharactersIfWorldChanged(h.db, world, nullLogger, h.clock.t)).toBe(1);
    const moved = h.db.getCharacterById(a.p.charId)!.save;
    expect(moved.x).toBe(world.settlements[2].spawn.x);
    expect(moved.y).toBe(world.settlements[2].spawn.y);

    // Same layout again: nothing moves, even if the character has since walked away.
    moved.x = 10;
    moved.y = 10;
    h.db.saveCharacter(moved, h.clock.t);
    expect(relocateCharactersIfWorldChanged(h.db, world, nullLogger, h.clock.t)).toBe(0);
    expect(h.db.getCharacterById(a.p.charId)!.save.x).toBe(10);
  });

  it('runs again when the world is regenerated differently', () => {
    h = makeHarness();
    const a = h.join('Pilgrim');
    expect(relocateCharactersIfWorldChanged(h.db, h.world, nullLogger, h.clock.t)).toBe(1);
    const other = generateWorld(h.world.seed + 1);
    expect(worldSignature(other)).not.toBe(worldSignature(h.world));
    expect(relocateCharactersIfWorldChanged(h.db, other, nullLogger, h.clock.t)).toBe(1);
    const town = other.settlements[a.p.save.lastTown] ?? other.settlements[0];
    expect(h.db.getCharacterById(a.p.charId)!.save.x).toBe(town.spawn.x);
  });

  it('does nothing on an empty database', () => {
    h = makeHarness();
    const fresh = h.db;
    expect(relocateCharactersIfWorldChanged(fresh, h.world, nullLogger, h.clock.t)).toBe(0);
  });
});

describe('simFitsWorld', () => {
  const world = generateWorld(1337);
  const npcsAt = (home: (sid: number) => { x: number; y: number }) =>
    JSON.stringify({ npcs: Array.from({ length: 20 }, (_, i) => ({ alive: true, settlementId: i % world.settlements.length, homeX: home(i % world.settlements.length).x, homeY: home(i % world.settlements.length).y })) });

  it('accepts a snapshot whose NPCs live in their own towns', () => {
    expect(simFitsWorld(world, { json: npcsAt((sid) => ({ x: world.settlements[sid].x + 3, y: world.settlements[sid].y - 2 })) })).toBe(true);
  });

  it('rejects a snapshot whose NPC homes lie far from their towns (the map was regenerated)', () => {
    expect(simFitsWorld(world, { json: npcsAt(() => ({ x: 3, y: 3 })) })).toBe(false);
  });

  it('does not judge a snapshot with too few NPCs, or one it cannot read', () => {
    expect(simFitsWorld(world, { json: JSON.stringify({ npcs: [{ alive: true, settlementId: 0, homeX: 3, homeY: 3 }] }) })).toBe(true);
    expect(simFitsWorld(world, { json: 'not json' })).toBe(true);
  });
});

describe('booting with a saved world from another map layout', () => {
  it('sets the old world aside and starts a fresh one, keeping accounts and characters', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murim-layout-'));
    const dbPath = path.join(dir, 'layout.db');
    const env = { PORT: '0', HOST: '127.0.0.1', DB_PATH: dbPath, WORLD_HOUR_MS: '60000', LOG_LEVEL: 'silent', STATIC_DIR: path.join(dir, 'none') };
    try {
      const first = await startServer({ env, log: nullLogger });
      const bornHomes = first.sim.npcs().filter((n) => n.alive).map((n) => ({ x: n.homeX, y: n.homeY }));
      expect(bornHomes.length).toBeGreaterThan(20);
      await first.close();

      // Make the stored world look like one saved before the towns moved: homes far away, no layout signature.
      const db = openDb(dbPath);
      const stored = JSON.parse(db.kvGet(SIM_SNAPSHOT_KEY)!) as { sim: { json: string } };
      const sim = JSON.parse(stored.sim.json) as { npcs: { homeX: number; homeY: number }[] };
      for (const n of sim.npcs) {
        n.homeX = 3;
        n.homeY = 3;
      }
      stored.sim.json = JSON.stringify(sim);
      db.kvSet(SIM_SNAPSHOT_KEY, JSON.stringify(stored));
      db.kvDelete(`${SIM_SNAPSHOT_KEY}.world_sig`);
      db.close();

      const second = await startServer({ env, log: nullLogger });
      const homes = second.sim.npcs().filter((n) => n.alive);
      const strays = homes.filter((n) => {
        const s = second.world.settlements[n.settlementId];
        return Math.hypot(n.homeX - s.x, n.homeY - s.y) > s.radius + 14;
      });
      expect(strays).toHaveLength(0);
      const backups = second.db.all<{ key: string }>("SELECT key FROM kv WHERE key LIKE 'sim.snapshot.stale.%'");
      expect(backups).toHaveLength(1);
      await second.close();

      // A third boot with the same layout keeps the world it saved.
      const third = await startServer({ env, log: nullLogger });
      expect(third.db.all("SELECT key FROM kv WHERE key LIKE 'sim.snapshot.stale.%'")).toHaveLength(1);
      await third.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
