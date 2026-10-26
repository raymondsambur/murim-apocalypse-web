import { afterEach, describe, expect, it } from 'vitest';
import { generateWorld } from '@murim/shared';
import { makeHarness, type Harness } from '../testkit';
import { nullLogger } from './log';
import { relocateCharactersIfWorldChanged, worldSignature } from './worldmigrate';

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
