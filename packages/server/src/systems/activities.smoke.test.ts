/** Activities against the real sim with every default system registered (boot-level smoke test). */
import { describe, expect, it } from 'vitest';
import { systems } from './index';
import { makeRealHarness } from './econ.testkit';

describe('activities with the real sim and all systems', () => {
  it('registers alongside every module and runs a shift through settlement', () => {
    const h = makeRealHarness();
    for (const reg of systems) reg(h.game.ctx);
    const { p, conn } = h.join('Hero');
    h.tick(3);
    const farm = h.world.settlements.flatMap((s) => s.sites).find((s) => s.kind === 'farm')!;
    h.game.movement.teleport(p.entity, farm.x, farm.y);
    p.save.inventory = [];
    h.clock.advance(2000);
    h.say(p, { t: 'astart', kind: 'shift', site: farm.id, job: 'farmer' });
    h.tick(2);
    expect(conn.last('err')).toBeUndefined();
    expect(p.save.activity?.kind).toBe('shift');
    h.clock.advance(3_600_000);
    h.tick(2); // minute timer settles
    expect(p.save.inventory.some((s) => s.id === 'grain')).toBe(true);
    h.say(p, { t: 'astop' });
    h.tick(1);
    expect(p.save.activity).toBeNull();
    h.close();
  });
});
